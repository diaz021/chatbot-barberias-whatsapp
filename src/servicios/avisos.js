/**
 * AVISOS AL BARBERO
 *
 * Un turno nuevo o una cancelación tienen que llegarle al barbero sin que él
 * haga nada. Estos mensajes salen EN FRÍO —el barbero no escribió primero—,
 * así que van por PLANTILLA aprobada por Meta.
 *
 * ⚠️ §24.4 — en el sistema anterior al barbero NO se le avisaba de las
 * cancelaciones. Solo se enteraba si abría su agenda, y podía quedarse
 * esperando a un cliente que ya no iba a llegar. Aquí sí se avisa.
 *
 * Las plantillas de utilidad enviadas dentro de una ventana de 24 h abierta
 * por el destinatario no se cobran; fuera de ella, sí. Por eso los avisos
 * son cortos y no se mandan dos veces por lo mismo.
 */

import { consultarUna } from '../db/pool.js';
import { enviar } from '../servicios/whatsapp.js';
import { env } from '../config/env.js';
import { fechaVisible, horaVisible } from '../config/fechas.js';
import { telefonoVisible } from './identidad.js';

/**
 * Arma un mensaje de plantilla.
 *
 * Los parámetros van POSICIONALES, en el orden exacto en que aparecen los
 * {{1}}, {{2}}… del cuerpo aprobado en Meta. Cambiar el orden en la plantilla
 * sin cambiarlo aquí manda el nombre del cliente donde va la hora, y Meta no
 * avisa: el mensaje sale igual, mal.
 */
export function plantilla(para, nombre, idioma, parametros) {
  return {
    messaging_product: 'whatsapp',
    to: para,
    type: 'template',
    template: {
      name: nombre,
      language: { code: idioma },
      components: [{
        type: 'body',
        parameters: parametros.map(p => ({ type: 'text', text: String(p ?? '') })),
      }],
    },
  };
}

async function telefonoDelBarbero(barberoId) {
  const b = await consultarUna(
    'SELECT nombre, telefono FROM barberos WHERE id = $1',
    [barberoId]
  );
  return b?.telefono ? b : null;
}

/**
 * Avisa de un turno nuevo.
 * Parámetros: cliente · barbero · fecha visible · hora · teléfono del cliente
 */
export async function turnoNuevo(barberia, { barberoId, fecha, hora, cliente, telefonoCliente }) {
  const barbero = await telefonoDelBarbero(barberoId);

  if (!barbero) {
    console.warn(`○ [${barberia.nombre}] barbero ${barberoId} sin teléfono: no se le avisa`);
    return false;
  }

  if (!env.PLANTILLA_TURNO_NUEVO) {
    console.warn(`○ [${barberia.nombre}] sin PLANTILLA_TURNO_NUEVO configurada`);
    return false;
  }

  return enviar(plantilla(barbero.telefono, env.PLANTILLA_TURNO_NUEVO, env.PLANTILLA_IDIOMA, [
    cliente,
    barbero.nombre,
    fechaVisible(fecha),
    horaVisible(hora),
    // Un cliente con nombre de usuario de WhatsApp no trae número: se le
    // dice al barbero en vez de mandarle un "CO.1000…" que no puede marcar.
    telefonoVisible(telefonoCliente),
  ]), barberia);
}

/**
 * Avisa de una cancelación. §24.4 — esto no existía.
 *
 * Si no hay plantilla de cancelación configurada, se intenta como texto
 * normal: si el barbero escribió al bot en las últimas 24 horas llegará
 * igual, y si no, no llega. Es mejor que no intentarlo — pero lo correcto
 * es crear la plantilla.
 */
export async function turnoCancelado(barberia, { barberoId, fecha, hora, cliente }) {
  const barbero = await telefonoDelBarbero(barberoId);
  if (!barbero) return false;

  const cuerpo =
    `❌ Turno cancelado\n\n` +
    `👤 ${cliente}\n` +
    `📅 ${fechaVisible(fecha)}\n` +
    `⏰ ${horaVisible(hora)}\n\n` +
    `Ese horario quedó libre.`;

  if (env.PLANTILLA_CANCELACION) {
    return enviar(plantilla(barbero.telefono, env.PLANTILLA_CANCELACION, env.PLANTILLA_IDIOMA, [
      cliente,
      barbero.nombre,
      fechaVisible(fecha),
      horaVisible(hora),
    ]), barberia);
  }

  return enviar({
    messaging_product: 'whatsapp',
    to: barbero.telefono,
    type: 'text',
    text: { body: cuerpo, preview_url: false },
  }, barberia);
}

/**
 * Recordatorio al cliente, una hora antes.
 *
 * Parámetros: nombre · BARBERÍA · barbero · fecha visible · hora
 *
 * ⚠️ La barbería va como parámetro, no escrita en la plantilla. Una sola
 * plantilla sirve a todas las barberías del sistema; si el nombre estuviera
 * dentro del texto aprobado, habría que crear y aprobar una por cada una.
 */
export async function recordatorio(barberia, turno) {
  if (!env.PLANTILLA_RECORDATORIO) {
    console.warn(`○ [${barberia.nombre}] sin PLANTILLA_RECORDATORIO configurada`);
    return false;
  }

  return enviar(plantilla(turno.cliente_telefono, env.PLANTILLA_RECORDATORIO, env.PLANTILLA_IDIOMA, [
    turno.cliente_nombre,
    barberia.nombre,
    turno.barbero,
    fechaVisible(turno.fecha),
    horaVisible(turno.hora),
  ]), barberia);
}
