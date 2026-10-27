/**
 * TURNOS — agendar, cancelar y consultar
 *
 * Regla de oro: un turno ocupado nunca se vende dos veces, y un fallo del
 * sistema nunca puede parecer "no hay cupos". Es preferible decirle al
 * cliente "no puedo consultar ahora" que mentirle.
 */

import { consultar, consultarUna } from '../db/pool.js';
import { instanteDe } from '../config/fechas.js';

/** Postgres devuelve este código cuando se viola una restricción de unicidad. */
const UNICIDAD = '23505';

export const MAX_POR_DIA = 2;

/**
 * Cuántos turnos confirmados tiene ese teléfono ese día en esa barbería.
 * Los barberos están exentos: necesitan poder agendarse entre ellos.
 */
export async function turnosDelClienteEseDia(barberiaId, telefono, fecha) {
  const fila = await consultarUna(
    `SELECT COUNT(*)::int AS n
       FROM turnos
      WHERE barberia_id = $1 AND cliente_telefono = $2
        AND fecha = $3 AND estado = 'Confirmado' AND tipo = 'cita'`,
    [barberiaId, telefono, fecha]
  );
  return fila.n;
}

export async function esBarbero(barberiaId, telefono) {
  const fila = await consultarUna(
    `SELECT 1 AS si FROM barberos WHERE barberia_id = $1 AND telefono = $2`,
    [barberiaId, telefono]
  );
  return Boolean(fila);
}

/**
 * Agenda un turno.
 *
 * Devuelve { ok: true, turno } o { ok: false, motivo }, donde motivo es
 * 'ocupado' | 'limite'. Nunca lanza por un turno ya tomado: eso no es un
 * error del sistema, es una carrera normal entre dos clientes.
 *
 * ⚠️ NO hay un "comprobar si está libre y después insertar". Se INTENTA
 * insertar, y si la restricción UNIQUE de la base lo rechaza, es que otro
 * llegó primero. Comprobar antes dejaría una ventana de milisegundos entre
 * la lectura y la escritura — que es exactamente el punto 9 de MEJORAS.md.
 */
export async function agendar({ barberia, barberoId, fecha, hora, nombre, telefono }) {
  // Esta sí es una comprobación previa legítima: el límite diario es una
  // regla de negocio, no una carrera. Un doble envío del mismo cliente en el
  // mismo instante es un escenario que no ocurre en la práctica.
  if (!await esBarbero(barberia.id, telefono)) {
    const yaTiene = await turnosDelClienteEseDia(barberia.id, telefono, fecha);
    if (yaTiene >= MAX_POR_DIA) {
      return { ok: false, motivo: 'limite' };
    }
  }

  const inicio = instanteDe(fecha, hora, barberia.zona_horaria);

  try {
    const filas = await consultar(
      `INSERT INTO turnos
         (barberia_id, barbero_id, fecha, hora, tipo, estado,
          cliente_nombre, cliente_telefono, inicio_en)
       VALUES ($1, $2, $3, $4, 'cita', 'Confirmado', $5, $6, $7)
       RETURNING id, fecha, hora`,
      [barberia.id, barberoId, fecha, hora, nombre, telefono, inicio]
    );
    return { ok: true, turno: filas[0] };
  } catch (error) {
    if (error.code === UNICIDAD) {
      return { ok: false, motivo: 'ocupado' };
    }
    throw error;   // cualquier otra cosa sí es un fallo real
  }
}

/**
 * Los turnos próximos de un cliente, para la pantalla de cancelación.
 *
 * "Próximos" significa que todavía no han pasado, comparado contra el
 * instante absoluto: un turno de hoy a las 6pm sigue siendo cancelable a las
 * 3pm, pero no a las 7pm.
 */
export async function proximosDelCliente(barberiaId, telefono) {
  return consultar(
    `SELECT t.id, t.fecha, t.hora, t.cliente_nombre, b.nombre AS barbero
       FROM turnos t
       JOIN barberos b ON b.id = t.barbero_id
      WHERE t.barberia_id = $1 AND t.cliente_telefono = $2
        AND t.estado = 'Confirmado' AND t.tipo = 'cita'
        AND t.inicio_en > now()
      ORDER BY t.inicio_en
      LIMIT 20`,
    [barberiaId, telefono]
  );
}

/**
 * Cancela un turno.
 *
 * ⚠️ El WHERE comprueba que el turno sea DE ESE TELÉFONO y siga confirmado.
 * Sin eso, un id manipulado —o un id viejo que el cliente tocó más arriba en
 * el historial— podría cancelarle la cita a otra persona. En el sistema
 * anterior esto era un riesgo real porque se apuntaba por número de fila.
 *
 * Devuelve el turno cancelado, o null si no era suyo o ya no estaba activo.
 */
export async function cancelar(barberiaId, telefono, turnoId) {
  const filas = await consultar(
    `UPDATE turnos t
        SET estado = 'Cancelado', cancelado_en = now()
       FROM barberos b
      WHERE t.id = $1
        AND t.barbero_id = b.id
        AND t.barberia_id = $2
        AND t.cliente_telefono = $3
        AND t.estado = 'Confirmado'
      RETURNING t.id, t.barbero_id, t.fecha, t.hora, t.cliente_nombre,
                b.nombre AS barbero, b.telefono AS barbero_telefono`,
    [turnoId, barberiaId, telefono]
  );
  return filas[0] ?? null;
}

/** Un turno por id, para confirmar antes de cancelar. */
export async function porId(barberiaId, telefono, turnoId) {
  return consultarUna(
    `SELECT t.id, t.fecha, t.hora, t.cliente_nombre, b.nombre AS barbero
       FROM turnos t
       JOIN barberos b ON b.id = t.barbero_id
      WHERE t.id = $1 AND t.barberia_id = $2
        AND t.cliente_telefono = $3 AND t.estado = 'Confirmado'`,
    [turnoId, barberiaId, telefono]
  );
}
