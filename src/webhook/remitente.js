/**
 * DE QUIÉN ES EL MENSAJE
 *
 * ⚠️ ESTE ARCHIVO EXISTE POR UN FALLO REAL, y caro. Durante al menos un día
 * el 9 % de los mensajes (12 de 134) llegó de Meta SIN el número de quien
 * escribía. El bot los leía, armaba la respuesta y la enviaba sin
 * destinatario:
 *
 *   → [Barbería Demo] undefined · texto · "Si tiene turnito para hoy?"
 *   ✗ Meta devolvió 400: "The parameter to is required."
 *
 * Nueve clientes reales quedaron sin respuesta —"Buenos días", "Oe mano",
 * "Agendar turno"— y nadie se enteró hasta que el dueño preguntó por una
 * persona concreta. Para el cliente, el bot simplemente lo dejó en visto.
 *
 * DOS COSAS LO CAUSABAN:
 *
 *   1. Se leía el remitente de UN solo sitio (`messages[].from`). Meta manda
 *      el mismo número también en `contacts[].wa_id`, y no se miraba.
 *   2. Cuando faltaba, se intentaba responder igual en vez de detectarlo.
 *
 * Ahora se mira el respaldo, y si aun así no hay a quién responder NO se
 * intenta enviar: se guarda el sobre entero para poder averiguar por qué.
 */

import { consultar } from '../db/pool.js';

/**
 * El teléfono de quien escribió, o null si Meta no lo mandó por ningún lado.
 *
 * `contacts` es un arreglo paralelo a `messages`: cuando llegan varios
 * mensajes juntos, el contacto de cada uno puede estar en su misma posición.
 * Se prueba esa posición primero y el primer contacto después, porque con un
 * solo mensaje —el caso normal— ambos son el mismo.
 */
export function remitenteDe(mensaje, contactos = [], indice = 0) {
  const propio = contactos?.[indice];
  const primero = contactos?.[0];

  // En orden de preferencia. El TELÉFONO va primero siempre que exista: los
  // barberos, el panel y los turnos viejos están todos por teléfono.
  //
  // ⚠️ Los dos últimos son el BSUID: el ID que manda Meta cuando el cliente
  // tiene nombre de usuario de WhatsApp y oculta su número. Sin ellos, ese
  // cliente se quedaba sin respuesta aunque su mensaje llegara bien — pasó
  // de verdad el 19/09/2026 con tres mensajes seguidos. Ver identidad.js.
  const candidato =
    mensaje?.from ??
    propio?.wa_id ??
    mensaje?.from_user_id ??
    propio?.user_id ??
    primero?.wa_id ??
    primero?.user_id;

  return candidato ? String(candidato) : null;
}

/** El nombre del perfil, con el mismo criterio de posición. */
export function nombreDe(contactos = [], indice = 0) {
  return contactos?.[indice]?.profile?.name ?? contactos?.[0]?.profile?.name ?? null;
}

/**
 * Guarda el sobre completo de un mensaje que no se pudo atribuir a nadie.
 *
 * Nunca lanza: esto corre dentro del procesamiento del webhook y un fallo
 * guardando el diagnóstico no puede tumbar la atención de las demás
 * barberías. Si no se puede guardar, al menos queda en el registro.
 */
export async function anotarSinRemitente({ barberia, phoneNumberId, mensaje, valor }) {
  const texto = mensaje?.text?.body ?? mensaje?.button?.text ?? null;

  console.error(
    `✗ MENSAJE SIN REMITENTE en ${barberia?.nombre ?? phoneNumberId} — ` +
    `no hay a quién responder. id=${mensaje?.id ?? '?'} tipo=${mensaje?.type ?? '?'}` +
    (texto ? ` texto="${texto.slice(0, 60)}"` : '')
  );

  try {
    await consultar(
      `INSERT INTO mensajes_sin_remitente
         (barberia_id, phone_number_id, message_id, tipo, texto, cuerpo)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [
        barberia?.id ?? null,
        phoneNumberId ?? null,
        mensaje?.id ?? null,
        mensaje?.type ?? null,
        texto,
        JSON.stringify(valor ?? {}),
      ]
    );
  } catch (error) {
    console.error('✗ Además falló guardar el diagnóstico:', error.message);
  }
}
