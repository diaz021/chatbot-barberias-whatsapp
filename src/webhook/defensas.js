/**
 * LAS CUATRO DEFENSAS DEL WEBHOOK
 *
 * No son opcionales. Cada una existe porque su ausencia ya causó un
 * problema real en producción, o porque Meta garantiza que lo causará.
 *
 *   1. Responder 200 ANTES de procesar   → va en rutas.js
 *   2. Deduplicar por message.id          → aquí
 *   3. Descartar mensajes viejos          → aquí
 *   4. Validar la firma X-Hub-Signature   → aquí
 *
 * ⚠️ REGLA DE ORO para 2 y 3: ANTE LA DUDA, SE PROCESA.
 * Si no hay id, o el timestamp no se entiende, el mensaje pasa. Perder un
 * mensaje real de un cliente es peor que procesar uno repetido.
 */

import crypto from 'node:crypto';
import { consultar } from '../db/pool.js';
import { env } from '../config/env.js';

// ═══════════════════════════════════════════════════════════════════
//  DEFENSA 4 — Firma de Meta
// ═══════════════════════════════════════════════════════════════════

/**
 * Valida la cabecera `X-Hub-Signature-256`: HMAC SHA-256 del cuerpo con el
 * App Secret.
 *
 * ⚠️ Se calcula sobre el CUERPO CRUDO, tal como llegó. Volver a serializar
 * el JSON cambia espacios y orden de claves, y la firma no coincide nunca.
 * Por eso app.js guarda el Buffer original en `req.rawBody`.
 *
 * Sin META_APP_SECRET la validación queda APAGADA y se avisa. Es deliberado:
 * permite desarrollar sin el secreto, pero nunca en silencio.
 */
export function firmaValida(rawBody, cabecera, secreto = env.META_APP_SECRET) {
  if (!secreto) return true;                  // apagada, ya se avisó al arrancar
  if (!cabecera || !rawBody) return false;

  const esperada = 'sha256=' + crypto
    .createHmac('sha256', secreto)
    .update(rawBody)
    .digest('hex');

  const a = Buffer.from(esperada);
  const b = Buffer.from(String(cabecera));

  // timingSafeEqual lanza si los largos difieren, así que se comprueba antes.
  // La comparación es de tiempo constante para no filtrar la firma correcta
  // byte a byte a quien mida cuánto tarda en fallar.
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// ═══════════════════════════════════════════════════════════════════
//  DEFENSA 2 — Deduplicación
// ═══════════════════════════════════════════════════════════════════

/**
 * ¿Es la primera vez que vemos este mensaje?
 *
 * Meta reenvía cuando cree que la entrega falló. Sin esto, el cliente recibe
 * dos y tres veces la misma respuesta sin haber escrito nada.
 *
 * El INSERT ... ON CONFLICT DO NOTHING es la prueba y la marca a la vez, en
 * una sola operación atómica. Dos procesos (o dos réplicas) que reciban el
 * mismo mensaje a la vez no pueden pasar los dos: el segundo inserta 0 filas.
 * Con un "SELECT y luego INSERT" sí habría hueco entre las dos consultas.
 */
export async function esMensajeNuevo(messageId) {
  if (!messageId) return true;   // ante la duda, se procesa

  const filas = await consultar(
    `INSERT INTO mensajes_vistos (message_id)
     VALUES ($1)
     ON CONFLICT (message_id) DO NOTHING
     RETURNING message_id`,
    [messageId]
  );

  return filas.length > 0;
}

// ═══════════════════════════════════════════════════════════════════
//  DEFENSA 3 — Mensajes viejos
// ═══════════════════════════════════════════════════════════════════

const MAX_ANTIGUEDAD_MS = 15 * 60 * 1000;

/**
 * Descarta lo que llega con mucho retraso.
 *
 * Cuando el webhook estuvo caído, Meta suelta de golpe toda su cola atrasada
 * al volver. Sin este filtro, decenas de clientes reciben a medianoche la
 * respuesta a lo que escribieron en la tarde.
 *
 * El timestamp de Meta viene en SEGUNDOS, no en milisegundos.
 */
export function esMensajeReciente(timestamp) {
  if (!timestamp) return true;   // ante la duda, se procesa

  const segundos = Number(timestamp);
  if (!Number.isFinite(segundos) || segundos <= 0) return true;

  return (Date.now() - segundos * 1000) < MAX_ANTIGUEDAD_MS;
}

// ═══════════════════════════════════════════════════════════════════
//  Limpieza periódica
// ═══════════════════════════════════════════════════════════════════

/**
 * Borra lo que ya no sirve. Sin esto, `mensajes_vistos` crece para siempre
 * y termina llenando el plan gratuito de Supabase con basura.
 *
 * 30 minutos de margen sobre los 15 de la defensa 3: si un mensaje ya es
 * demasiado viejo para procesarse, tampoco hace falta recordar que se vio.
 */
export async function purgar() {
  const [{ mensajes }] = await consultar(
    `WITH borrados AS (
       DELETE FROM mensajes_vistos
        WHERE visto_en < now() - INTERVAL '30 minutes'
       RETURNING 1
     )
     SELECT COUNT(*)::int AS mensajes FROM borrados`
  );

  const [{ sesiones }] = await consultar(
    `WITH borradas AS (
       DELETE FROM sesiones
        WHERE actualizada_en < now() - INTERVAL '10 minutes'
       RETURNING 1
     )
     SELECT COUNT(*)::int AS sesiones FROM borradas`
  );

  return { mensajes, sesiones };
}
