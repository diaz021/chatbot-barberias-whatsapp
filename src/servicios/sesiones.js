/**
 * SESIONES — en dónde va cada cliente en la conversación
 *
 * Cierra el punto 5 de MEJORAS.md. En el sistema anterior esto vivía en RAM:
 * cada despliegue le borraba el progreso a quien estuviera agendando, y era
 * imposible correr más de una réplica porque dos mensajes de la misma persona
 * podían caer en procesos distintos con ideas distintas de en qué paso iba.
 *
 * La clave es teléfono + barbería: la misma persona puede estar agendando en
 * dos barberías a la vez sin que una pise a la otra.
 */

import { consultar, consultarUna } from '../db/pool.js';

/** Inactividad tras la cual la sesión se considera vencida. */
export const VENCE_MINUTOS = 10;

/** Errores seguidos antes de devolver al cliente al menú. */
export const MAX_ERRORES = 3;

export const PASOS = {
  NOMBRE:    'nombre',
  BARBERO:   'barbero',
  FECHA:     'fecha',
  JORNADA:   'jornada',
  HORA:      'hora',
  CANCELAR:  'cancelar',
  CONFIRMAR: 'confirmar',
};

/**
 * Lee la sesión, o null si no hay o ya venció.
 *
 * El vencimiento se decide en la BASE (`now()`), no en el servidor: es la
 * misma referencia para todas las réplicas, y no depende de la hora local
 * del proceso.
 */
export async function leer(telefono, barberiaId) {
  return consultarUna(
    `SELECT telefono, barberia_id, paso, datos, errores,
            actualizada_en < now() - INTERVAL '${VENCE_MINUTOS} minutes' AS vencida
       FROM sesiones
      WHERE telefono = $1 AND barberia_id = $2`,
    [telefono, barberiaId]
  ).then(s => (!s || s.vencida ? null : s));
}

/**
 * ¿Había una sesión que acaba de vencer?
 *
 * Se pregunta aparte para poder decirle al cliente "tu sesión expiró" en vez
 * de saludarlo de cero, que es lo que hacía el sistema anterior: el cliente
 * estaba escribiendo su nombre y de pronto le daban la bienvenida otra vez.
 */
export async function habiaVencida(telefono, barberiaId) {
  const fila = await consultarUna(
    `SELECT 1 AS si FROM sesiones
      WHERE telefono = $1 AND barberia_id = $2
        AND actualizada_en < now() - INTERVAL '${VENCE_MINUTOS} minutes'`,
    [telefono, barberiaId]
  );
  return Boolean(fila);
}

/** Crea o reemplaza la sesión. `datos` se mezcla con lo que ya había. */
export async function guardar(telefono, barberiaId, paso, datos = {}) {
  const filas = await consultar(
    `INSERT INTO sesiones (telefono, barberia_id, paso, datos, errores, actualizada_en)
     VALUES ($1, $2, $3, $4::jsonb, 0, now())
     ON CONFLICT (telefono, barberia_id) DO UPDATE
       SET paso = EXCLUDED.paso,
           datos = sesiones.datos || EXCLUDED.datos,
           errores = 0,
           actualizada_en = now()
     RETURNING paso, datos, errores`,
    [telefono, barberiaId, paso, JSON.stringify(datos)]
  );
  return filas[0];
}

/** Suma un error y devuelve cuántos seguidos van. */
export async function sumarError(telefono, barberiaId) {
  const filas = await consultar(
    `UPDATE sesiones
        SET errores = errores + 1, actualizada_en = now()
      WHERE telefono = $1 AND barberia_id = $2
      RETURNING errores`,
    [telefono, barberiaId]
  );
  return filas[0]?.errores ?? 0;
}

export async function borrar(telefono, barberiaId) {
  await consultar(
    `DELETE FROM sesiones WHERE telefono = $1 AND barberia_id = $2`,
    [telefono, barberiaId]
  );
}

/**
 * Retrocede un paso conservando lo ya elegido.
 *
 * `volver` desde la hora debe llevar a la fecha con el barbero todavía
 * puesto; si se borrara todo, "volver" sería lo mismo que "menú" y el
 * cliente tendría que empezar de cero.
 */
export async function retroceder(telefono, barberiaId, pasoAnterior, borrarClaves = []) {
  const sesion = await leer(telefono, barberiaId);
  if (!sesion) return null;

  const datos = { ...sesion.datos };
  borrarClaves.forEach(k => delete datos[k]);

  const filas = await consultar(
    `UPDATE sesiones
        SET paso = $3, datos = $4::jsonb, errores = 0, actualizada_en = now()
      WHERE telefono = $1 AND barberia_id = $2
      RETURNING paso, datos`,
    [telefono, barberiaId, pasoAnterior, JSON.stringify(datos)]
  );
  return filas[0];
}
