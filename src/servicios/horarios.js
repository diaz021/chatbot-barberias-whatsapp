/**
 * HORARIOS Y DISPONIBILIDAD
 *
 * Fuente única de qué turnos existe y cuáles están libres. El bot y el panel
 * llaman aquí los dos. Cuando esta lógica estuvo duplicada en el sistema
 * anterior, una copia se quedó vieja y el cliente y el barbero vieron cosas
 * distintas.
 */

import { consultar } from '../db/pool.js';
import { horaEnMinutos, hoyEn, ahoraEnMinutos, sumarDias } from '../config/fechas.js';
import { diaDeHorario } from '../config/festivos.js';

/** Dónde corta cada jornada, en minutos desde medianoche. */
export const CORTE_TARDE = 12 * 60;        // 12:00pm
export const CORTE_TARDE_NOCHE = 17 * 60;  // 5:00pm

/** Cuántos turnos caben en una lista de WhatsApp dejando sitio a la navegación. */
export const MAX_POR_LISTA = 8;

// ═══════════════════════════════════════════════════════════════════
//  Lectura
// ═══════════════════════════════════════════════════════════════════

export async function barberosDe(barberiaId) {
  return consultar(
    `SELECT id, nombre, telefono, orden
       FROM barberos
      WHERE barberia_id = $1 AND activo
      ORDER BY orden, id`,
    [barberiaId]
  );
}

export async function barberoPorId(barberoId) {
  const filas = await consultar(
    `SELECT id, barberia_id, nombre, telefono FROM barberos WHERE id = $1 AND activo`,
    [barberoId]
  );
  return filas[0] ?? null;
}

/**
 * Los turnos configurados de un barbero en una fecha. Vacío = no trabaja.
 *
 * ⚠️ La jornada la elige `diaDeHorario()`, no `diaSemana()`: un festivo se
 * atiende con el horario del domingo. Ver `src/config/festivos.js`.
 */
export async function turnosDelDia(barberoId, fecha) {
  const filas = await consultar(
    `SELECT turnos FROM horarios WHERE barbero_id = $1 AND dia_semana = $2`,
    [barberoId, diaDeHorario(fecha)]
  );
  return filas[0]?.turnos ?? [];
}

/**
 * Las horas ya tomadas de un barbero ese día: citas confirmadas y bloqueos.
 *
 * ⚠️ Lee SIEMPRE fresco, sin caché. Entre que el cliente ve la lista y toca
 * una hora pueden pasar minutos, y otro cliente pudo tomarla. En el sistema
 * anterior esta era la defensa principal contra la doble reserva; aquí es la
 * segunda, porque la primera la pone la restricción UNIQUE de la base.
 */
export async function horasOcupadas(barberoId, fecha) {
  const filas = await consultar(
    `SELECT hora FROM turnos
      WHERE barbero_id = $1 AND fecha = $2 AND estado = 'Confirmado'`,
    [barberoId, fecha]
  );
  return new Set(filas.map(f => f.hora));
}

/**
 * Los turnos LIBRES de un barbero en una fecha.
 *
 * Si la fecha es hoy, descarta los que ya pasaron: ofrecer las 9am a las 4pm
 * es una forma segura de perder un cliente.
 */
export async function turnosLibres(barberoId, fecha, zona) {
  const todos = await turnosDelDia(barberoId, fecha);
  if (todos.length === 0) return [];

  const ocupadas = await horasOcupadas(barberoId, fecha);
  const esHoy = fecha === hoyEn(zona);
  const ahora = esHoy ? ahoraEnMinutos(zona) : -1;

  return todos.filter(h => !ocupadas.has(h) && (!esHoy || horaEnMinutos(h) > ahora));
}

/**
 * Los próximos días que se le ofrecen al cliente: aquellos en los que el
 * barbero TIENE turnos configurados. Los días vacíos se saltan.
 *
 * ⚠️ El tope de 30 días de búsqueda no es decorativo. Sin él, un barbero sin
 * ningún día configurado deja el bucle girando para siempre.
 */
export async function proximosDias(barberoId, zona, cuantos = 7) {
  const dias = [];
  let fecha = hoyEn(zona);

  for (let i = 0; i < 30 && dias.length < cuantos; i++) {
    const configurados = await turnosDelDia(barberoId, fecha);

    if (configurados.length > 0) {
      const libres = await turnosLibres(barberoId, fecha, zona);
      // Hoy solo entra si todavía queda algo por delante.
      if (!(fecha === hoyEn(zona) && libres.length === 0)) {
        dias.push({ fecha, libres: libres.length, total: configurados.length });
      }
    }

    fecha = sumarDias(fecha, 1);
  }

  return dias;
}

// ═══════════════════════════════════════════════════════════════════
//  Reparto en jornadas
// ═══════════════════════════════════════════════════════════════════

function repartir(turnos) {
  const manana = [], tarde = [], tardenoche = [];

  for (const h of turnos ?? []) {
    const min = horaEnMinutos(h);
    if (min < CORTE_TARDE) manana.push(h);
    else if (min < CORTE_TARDE_NOCHE) tarde.push(h);
    else tardenoche.push(h);
  }

  return { manana, tarde, tardenoche };
}

/**
 * Reparte los turnos de un día en mañana, tarde y tarde-noche.
 *
 * ⚠️ LA TERCERA JORNADA NO EXISTE PORQUE SÍ. Existe solo porque una lista de
 * WhatsApp no admite más de 10 filas. Si la tarde entera cabe, no se parte.
 *
 * ⚠️ Y LA DECISIÓN SE TOMA SOBRE `referencia` —el horario COMPLETO del día—
 * NO sobre los turnos que quedan libres. Este fue un error real del sistema
 * anterior: mirando solo lo libre, el bloque de tarde-noche aparecía y
 * desaparecía según cuánta gente hubiera agendado ese día, y el cliente veía
 * una pantalla distinta cada vez que entraba.
 */
export function partirEnJornadas(turnos, referencia = null, maximo = MAX_POR_LISTA) {
  const reparto = repartir(turnos);
  const base = referencia ? repartir(referencia) : reparto;

  if (base.tarde.length + base.tardenoche.length <= maximo) {
    return {
      manana: reparto.manana,
      tarde: [...reparto.tarde, ...reparto.tardenoche],
      tardenoche: [],
    };
  }

  return reparto;
}

/** ¿Hace falta la pantalla de jornadas, o caben todos los libres de una? */
export function necesitaPantallaDeJornada(libres, maximo = MAX_POR_LISTA) {
  return libres.length > maximo;
}
