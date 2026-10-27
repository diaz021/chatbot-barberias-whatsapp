/**
 * ENVIAR A WHATSAPP — única salida hacia Meta
 *
 * Todo lo que sale del sistema pasa por aquí. Tener una sola puerta permite
 * registrar, limitar y —sobre todo— SIMULAR.
 *
 * MODO SIMULADO: sin API_TOKEN, en vez de fallar se guarda lo que se habría
 * enviado y se registra en el log. Así se puede recorrer una conversación
 * completa y comprobar qué vería el cliente, sin credenciales de Meta y sin
 * gastar un solo mensaje. Es lo que usan las pruebas.
 */

import { env } from '../config/env.js';
import { paraMeta } from './identidad.js';

/** Lo enviado en modo simulado, para que las pruebas lo inspeccionen. */
const bandeja = [];

export const simulado = {
  /**
   * ⚠️ MODO_SIMULADO=1 fuerza la simulación aunque haya API_TOKEN.
   *
   * Lo pone `tests/preparar.mjs` antes de cargar nada. Sin esto, la suite
   * cambiaba de comportamiento según si había un token en .env: con token,
   * las pruebas intentaban ENVIAR MENSAJES REALES por WhatsApp. Los números
   * de prueba no están verificados y Meta los rechazaba, pero con un número
   * real la suite le habría escrito a alguien de verdad.
   *
   * Que una prueba pueda tener efectos en el mundo real es un defecto, no
   * una configuración.
   */
  get activo() { return process.env.MODO_SIMULADO === '1' || !env.API_TOKEN; },
  todos: () => [...bandeja],
  ultimo: () => bandeja[bandeja.length - 1] ?? null,
  paraDe: (telefono) => bandeja.filter(m => (m.to ?? m.recipient) === telefono),
  limpiar: () => { bandeja.length = 0; },
};

/** Resumen legible de un mensaje, para el log y para depurar. */
export function describir(mensaje) {
  if (mensaje.type === 'text') {
    return `texto: "${mensaje.text.body.slice(0, 70).replace(/\n/g, ' ⏎ ')}"`;
  }
  if (mensaje.type === 'location') {
    return `ubicación: ${mensaje.location.name}`;
  }
  if (mensaje.interactive?.type === 'button') {
    const b = mensaje.interactive.action.buttons.map(x => x.reply.title).join(' | ');
    return `botones: [${b}]`;
  }
  if (mensaje.interactive?.type === 'list') {
    const filas = mensaje.interactive.action.sections.flatMap(s => s.rows.map(r => r.title));
    return `lista (${filas.length}): ${filas.join(' | ')}`;
  }
  return mensaje.type;
}

/**
 * Envía un mensaje ya armado.
 *
 * Nunca lanza hacia arriba por un fallo de red: un error de Meta no puede
 * tumbar la conversación de otro cliente ni el proceso de otra barbería.
 * Devuelve true/false para que quien llama decida.
 */
export async function enviar(original, barberia) {
  const etiqueta = barberia?.nombre ?? '—';

  // ⚠️ Un cliente con nombre de usuario de WhatsApp no tiene teléfono sino
  // un BSUID, y Meta exige mandárselo en `recipient`, no en `to`. Se hace
  // AQUÍ, en la única puerta de salida, para que ningún mensaje —texto,
  // lista, botones o plantilla— se escape sin convertir. Ver identidad.js.
  const mensaje = paraMeta(original);

  if (simulado.activo) {
    bandeja.push(mensaje);
    console.log(`  ← [${etiqueta}] (simulado) ${describir(mensaje)}`);
    return true;
  }

  const phoneNumberId = barberia?.phone_number_id;
  if (!phoneNumberId) {
    console.error(`✗ [${etiqueta}] sin phone_number_id: no se puede enviar`);
    return false;
  }

  const url = `https://graph.facebook.com/${env.API_VERSION}/${phoneNumberId}/messages`;

  try {
    const respuesta = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(mensaje),
      signal: AbortSignal.timeout(15_000),
    });

    if (!respuesta.ok) {
      const detalle = await respuesta.text().catch(() => '');
      console.error(`✗ [${etiqueta}] Meta devolvió ${respuesta.status}: ${detalle.slice(0, 300)}`);
      return false;
    }

    console.log(`  ← [${etiqueta}] ${describir(mensaje)}`);
    return true;
  } catch (error) {
    console.error(`✗ [${etiqueta}] fallo de red enviando a WhatsApp: ${error.message}`);
    return false;
  }
}

/**
 * Envía varios en orden.
 *
 * En serie a propósito: WhatsApp muestra los mensajes en el orden en que los
 * recibe, y en paralelo el saludo podría aparecer después del menú.
 */
export async function enviarVarios(mensajes, barberia) {
  let todos = true;
  for (const m of mensajes) {
    if (!await enviar(m, barberia)) todos = false;
  }
  return todos;
}
