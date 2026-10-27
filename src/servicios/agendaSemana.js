/**
 * AGENDA DE LA SEMANA — para el panel web
 *
 * Arma una cuadrícula de horas × días. Solo mira: no escribe nada.
 *
 * ⚠️ Cada día puede tener horarios distintos — un barbero puede
 * trabajar solo de tarde el miércoles, por ejemplo. Por eso las filas son la UNIÓN de todas las horas
 * de la semana, y donde un barbero NO trabaja a esa hora ese día la celda
 * queda como `cerrado`, que no es lo mismo que `libre`.
 *
 * Es una distinción que importa: sobre una celda libre se puede bloquear un
 * descanso; sobre una cerrada no hay nada que bloquear porque nadie iba a
 * trabajar. Pintarlas igual hace que el dueño crea que tiene cupos donde no.
 */

import { consultar } from '../db/pool.js';
import {
  diaSemana, sumarDias, horaEnMinutos, horaVisible, hoyEn, DIAS, MESES,
} from '../config/fechas.js';
import { diaDeHorario, nombreDelFestivo } from '../config/festivos.js';
import { telefonoVisible } from './identidad.js';

/** El lunes de la semana a la que pertenece esa fecha. */
export function lunesDeLaSemana(fecha) {
  const dia = diaSemana(fecha);
  // El domingo pertenece a la semana que TERMINA, no a la que empieza.
  return sumarDias(fecha, dia === 0 ? -6 : -(dia - 1));
}

/** Los 7 días de la semana que empieza ese lunes. */
export function diasDeLaSemana(lunes, hoy) {
  return Array.from({ length: 7 }, (_, i) => {
    const fecha = sumarDias(lunes, i);
    const d = diaSemana(fecha);
    const [, mes, numero] = fecha.split('-').map(Number);

    return {
      fecha,
      nombre: DIAS[d],
      corto: DIAS[d].slice(0, 3),
      numero,
      mes: MESES[mes - 1],
      esHoy: fecha === hoy,
      esPasado: fecha < hoy,
      // Un festivo se trabaja con la jornada del domingo. Sin decirlo, el
      // barbero ve un lunes con horas de domingo y parece un error del panel.
      festivo: nombreDelFestivo(fecha),
    };
  });
}

/** "10 – 16 de agosto", o con los dos meses si la semana los cruza. */
export function rotuloSemana(dias) {
  const a = dias[0], z = dias[dias.length - 1];
  return a.mes === z.mes
    ? `${a.numero} – ${z.numero} de ${a.mes}`
    : `${a.numero} de ${a.mes} – ${z.numero} de ${z.mes}`;
}

/**
 * La semana completa de un barbero.
 *
 * Devuelve { horas, dias, rotulo }, donde cada día trae sus celdas indexadas
 * por hora. Dos consultas en total, no una por día: con 7 días y varias
 * barberías, consultar día a día multiplica el trabajo sin necesidad.
 */
export async function armarSemana(barberoId, lunes, zona) {
  const hoy = hoyEn(zona);
  const dias = diasDeLaSemana(lunes, hoy);
  const domingo = dias[6].fecha;

  const horarios = await consultar(
    `SELECT dia_semana, turnos FROM horarios WHERE barbero_id = $1`,
    [barberoId]
  );
  const porDia = new Map(horarios.map(h => [h.dia_semana, h.turnos ?? []]));

  const ocupados = await consultar(
    `SELECT id, fecha, hora, tipo, cliente_nombre, cliente_telefono
       FROM turnos
      WHERE barbero_id = $1 AND fecha BETWEEN $2 AND $3 AND estado = 'Confirmado'`,
    [barberoId, lunes, domingo]
  );

  const clave = (fecha, hora) => `${fecha}|${hora}`;
  const porCelda = new Map(ocupados.map(t => [clave(t.fecha, t.hora), t]));

  const horas = new Set();

  for (const dia of dias) {
    // ⚠️ `diaDeHorario` y no `diaSemana`: en un festivo la jornada es la del
    // domingo. Tiene que ser la MISMA decisión que toma `turnosDelDia()`, o
    // el panel y el bot enseñarían horas distintas ese día.
    const configuradas = porDia.get(diaDeHorario(dia.fecha)) ?? [];
    dia.trabaja = configuradas.length > 0;
    dia.celdas = {};

    // La unión de lo configurado y lo ocupado: un turno en una hora que ya no
    // está en la jornada sigue existiendo y no puede desaparecer del panel.
    const delDia = new Set([
      ...configuradas,
      ...ocupados.filter(t => t.fecha === dia.fecha).map(t => t.hora),
    ]);

    for (const hora of delDia) {
      horas.add(hora);
      const t = porCelda.get(clave(dia.fecha, hora));

      dia.celdas[hora] = t
        ? {
            estado: t.tipo === 'bloqueo' ? 'bloqueado' : 'ocupado',
            turnoId: t.id,
            nombre: t.cliente_nombre ?? '',
            // Sin el código de país, que es como lo marca el barbero.
            telefono: telefonoVisible(t.cliente_telefono),
            // Un turno en una hora que ya no está en la jornada configurada.
            fueraDeJornada: !configuradas.includes(hora),
          }
        : { estado: 'libre' };
    }
  }

  // Las horas sin celda en un día concreto son CERRADO, no libre.
  const ordenadas = [...horas].sort((a, b) => horaEnMinutos(a) - horaEnMinutos(b));

  for (const dia of dias) {
    for (const hora of ordenadas) {
      if (!dia.celdas[hora]) dia.celdas[hora] = { estado: 'cerrado' };
    }
  }

  return {
    lunes,
    rotulo: rotuloSemana(dias),
    horas: ordenadas.map(h => ({ valor: h, visible: horaVisible(h) })),
    dias,
  };
}
