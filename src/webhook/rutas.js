/**
 * RUTAS DEL WEBHOOK
 *
 *   GET  /webhook  → verificación de Meta (una vez, al conectar)
 *   POST /webhook  → todos los mensajes entrantes
 */

import { Router } from 'express';
import { env } from '../config/env.js';
import { firmaValida, esMensajeNuevo, esMensajeReciente } from './defensas.js';
import { porPhoneNumberId } from '../servicios/barberias.js';
import { despachar } from './despachar.js';
import { registrarEntrante } from '../servicios/vigilancia.js';
import { remitenteDe, nombreDe, anotarSinRemitente } from './remitente.js';

export const rutasWebhook = Router();

// ═══════════════════════════════════════════════════════════════════
//  GET — verificación
//
//  Meta llama una sola vez al registrar la URL. Hay que devolver el
//  hub.challenge TAL CUAL, en texto plano. Si se devuelve JSON, o con
//  comillas, Meta rechaza el webhook sin decir por qué.
// ═══════════════════════════════════════════════════════════════════
rutasWebhook.get('/webhook', (req, res) => {
  const modo      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (modo === 'subscribe' && token === env.WEBHOOK_VERIFY_TOKEN) {
    console.log('✓ Webhook verificado por Meta');
    return res.status(200).type('text/plain').send(challenge);
  }

  console.warn('✗ Verificación rechazada: el token no coincide');
  return res.sendStatus(403);
});

// ═══════════════════════════════════════════════════════════════════
//  POST — mensajes entrantes
// ═══════════════════════════════════════════════════════════════════
rutasWebhook.post('/webhook', (req, res) => {
  // ── DEFENSA 4 ── La firma se valida ANTES de responder. Es un HMAC,
  // tarda microsegundos, y un cuerpo no firmado no merece un 200.
  if (!firmaValida(req.rawBody, req.get('x-hub-signature-256'))) {
    console.warn('✗ Firma inválida — cuerpo descartado');
    return res.sendStatus(403);
  }

  // ── DEFENSA 1 ── Responder 200 AHORA, antes de procesar nada.
  //
  // Si Meta espera a que terminemos de leer la base y enviar mensajes, da la
  // entrega por fallida y REENVÍA. El cliente recibe respuestas duplicadas
  // que nunca pidió. Esto costó horas de bot mudo en el sistema anterior.
  res.sendStatus(200);

  // A partir de aquí Meta ya se fue. Nada de lo que siga puede responder
  // por HTTP, y ningún error de aquí puede tumbar el proceso: se atrapan
  // todos, porque este proceso atiende a TODAS las barberías a la vez.
  procesarEnSegundoPlano(req.body).catch(error => {
    console.error('✗ Error procesando el webhook:', error.message);
    console.error(error.stack);
  });
});

/**
 * Recorre la estructura que manda Meta y despacha cada mensaje.
 *
 * La forma del cuerpo es siempre:
 *   entry[] → changes[] → value → { metadata, messages[], statuses[], contacts[] }
 *
 * Se recorre con guardas en cada nivel: Meta manda eventos que no son
 * mensajes (estados de entrega, avisos de sistema) y la estructura no
 * siempre trae todos los campos.
 */
async function procesarEnSegundoPlano(cuerpo) {
  for (const entrada of cuerpo?.entry ?? []) {
    for (const cambio of entrada?.changes ?? []) {
      const valor = cambio?.value;
      if (!valor) continue;

      // Acuses de entrega y de lectura. Se ignoran a propósito: no son
      // mensajes de nadie y responderlos generaría un bucle.
      if (valor.statuses) continue;

      const mensajes = valor.messages ?? [];
      if (mensajes.length === 0) continue;

      // ── EL ENRUTAMIENTO MULTI-TENANT ──
      // Este campo es toda la magia: dice por qué número entró el mensaje,
      // y con eso sabemos de qué barbería es.
      const phoneNumberId = valor.metadata?.phone_number_id;
      const barberia = await porPhoneNumberId(phoneNumberId);

      if (!barberia) {
        console.warn(`✗ Mensaje a un número no registrado (${phoneNumberId}) — ignorado`);
        continue;
      }

      // Llegó algo: se marca para la vigilancia del §7. Es el único dato
      // que distingue "nadie ha escrito" de "no nos está llegando nada".
      await registrarEntrante(barberia.id).catch(() => {});

      const contactos = valor.contacts ?? [];

      for (const [indice, mensaje] of mensajes.entries()) {
        // ⚠️ QUIÉN ESCRIBIÓ SE RESUELVE AQUÍ, y con respaldo. Meta manda el
        // número en `messages[].from` y también en `contacts[].wa_id`; hubo
        // un día entero en que el primero llegó vacío en el 9 % de los
        // mensajes y el bot intentó responder sin destinatario. Ver
        // remitente.js.
        const de = remitenteDe(mensaje, contactos, indice);

        if (!de) {
          // Sin número no hay a quién responder. Se guarda el sobre entero
          // en vez de intentar un envío que Meta va a rechazar igual.
          await anotarSinRemitente({ barberia, phoneNumberId, mensaje, valor });
          continue;
        }

        await procesarUno(mensaje, barberia, nombreDe(contactos, indice), de);
      }
    }
  }
}

async function procesarUno(mensaje, barberia, nombrePerfil, de) {
  // ── DEFENSA 3 ── ¿Llega con mucho retraso?
  if (!esMensajeReciente(mensaje.timestamp)) {
    console.log(`○ Mensaje viejo descartado (${mensaje.id})`);
    return;
  }

  // ── DEFENSA 2 ── ¿Ya lo habíamos visto?
  if (!await esMensajeNuevo(mensaje.id)) {
    console.log(`○ Mensaje repetido ignorado (${mensaje.id})`);
    return;
  }

  try {
    await despachar({ mensaje, barberia, nombrePerfil, de });
  } catch (error) {
    // Todo camino termina en algo. Un fallo aquí no puede dejar al cliente
    // esperando en silencio ni arrastrar al resto de las barberías.
    console.error(
      `✗ Fallo atendiendo a ${de} en ${barberia.nombre}:`,
      error.message
    );
  }
}
