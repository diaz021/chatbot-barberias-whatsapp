/**
 * FESTIVOS DE COLOMBIA
 *
 * No se importan de ninguna parte: se CALCULAN. Los 18 festivos salen de dos
 * reglas que son ley, no un calendario que alguien publique cada año:
 *
 *   · unos tienen fecha fija;
 *   · otros se corren al lunes siguiente (Ley 51 de 1983, "Ley Emiliani");
 *   · cinco dependen de la Pascua, que se calcula con aritmética.
 *
 * ⚠️ POR QUÉ NO HAY TABLA NI API. Una tabla cargada año por año funciona
 * perfecto hasta el 1 de enero que a nadie se le ocurrió cargar el año
 * siguiente: ese día el bot ofrece el horario de un lunes normal y el fallo
 * es MUDO, nadie se entera hasta que llega un cliente a una barbería cerrada.
 * Una API mete una llamada de red en mitad del camino de agendar. Calculado
 * no hay nada que mantener, ni nada que se pueda caer.
 *
 * ⚠️ ESTO ES SOLO COLOMBIA. Si algún día entra una barbería de otro país,
 * hace falta una columna `barberias.pais` y un juego de reglas por país; no
 * vale con traducir los nombres. Hoy todas están en Colombia.
 *
 * Las fechas entran y salen como texto 'YYYY-MM-DD', igual que en fechas.js.
 */

import { diaSemana, sumarDias } from './fechas.js';

// ═══════════════════════════════════════════════════════════════════
//  Las reglas
// ═══════════════════════════════════════════════════════════════════

/** Fecha fija, no se mueve nunca. [mes, día, nombre] */
const FIJOS = [
  [1, 1, 'Año Nuevo'],
  [5, 1, 'Día del Trabajo'],
  [7, 20, 'Grito de Independencia'],
  [8, 7, 'Batalla de Boyacá'],
  [12, 8, 'Inmaculada Concepción'],
  [12, 25, 'Navidad'],
];

/** Ley Emiliani: se celebran el lunes siguiente. [mes, día, nombre] */
const AL_LUNES = [
  [1, 6, 'Reyes Magos'],
  [3, 19, 'San José'],
  [6, 29, 'San Pedro y San Pablo'],
  [8, 15, 'Asunción de la Virgen'],
  [10, 12, 'Día de la Raza'],
  [11, 1, 'Todos los Santos'],
  [11, 11, 'Independencia de Cartagena'],
];

/** Cuentan desde el Domingo de Pascua y NO se mueven. [días, nombre] */
const DE_PASCUA = [
  [-3, 'Jueves Santo'],
  [-2, 'Viernes Santo'],
];

/**
 * Cuentan desde la Pascua y ADEMÁS se corren al lunes. [días, nombre]
 *
 * Se guardan los desplazamientos litúrgicos reales (39, 60, 68) y el traslado
 * se aplica después, en vez de anotar directamente 43, 64 y 71. Da lo mismo
 * al ejecutarlo, pero así se ve de dónde sale cada número.
 */
const DE_PASCUA_AL_LUNES = [
  [39, 'Ascensión del Señor'],
  [60, 'Corpus Christi'],
  [68, 'Sagrado Corazón de Jesús'],
];

// ═══════════════════════════════════════════════════════════════════
//  El cálculo
// ═══════════════════════════════════════════════════════════════════

/**
 * Domingo de Pascua de un año — algoritmo gregoriano anónimo
 * (Meeus / Jones / Butcher). Válido para todo el calendario gregoriano.
 *
 * No se explica paso a paso a propósito: es aritmética modular sin
 * significado individual por línea. Lo que sí importa es que está fijada por
 * las pruebas contra años conocidos, así que si alguien la toca, salta.
 */
export function domingoDePascua(anio) {
  const a = anio % 19;
  const b = Math.floor(anio / 100);
  const c = anio % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);

  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;

  return `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

/** Corre una fecha al lunes siguiente. Si ya es lunes, se queda. */
function alLunes(fecha) {
  return sumarDias(fecha, (8 - diaSemana(fecha)) % 7);
}

const fecha = (anio, mes, dia) =>
  `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;

/**
 * Caché por año. Son 18 fechas y el cálculo es barato, pero `turnosDelDia()`
 * se llama en bucle al armar la lista de próximos días y no tiene sentido
 * recalcular la Pascua treinta veces seguidas.
 */
const cache = new Map();

/** Los festivos de un año, como Map 'YYYY-MM-DD' → nombre. */
export function festivosDe(anio) {
  const guardado = cache.get(anio);
  if (guardado) return guardado;

  const pascua = domingoDePascua(anio);
  const dias = new Map();

  /**
   * ⚠️ DOS FESTIVOS PUEDEN CAER EL MISMO DÍA, y pasa de verdad: en 2030 y en
   * 2038, San Pedro y San Pablo se corre al mismo lunes que el Sagrado
   * Corazón. Esos años Colombia tiene 17 festivos, no 18.
   *
   * Se conserva el PRIMERO y no se pisa. Da igual para decidir si se
   * trabaja —el día es festivo de las dos formas—, pero evita que el panel
   * anuncie un nombre y el calendario de la pared diga otro.
   */
  const anotar = (cuando, nombre) => {
    if (!dias.has(cuando)) dias.set(cuando, nombre);
  };

  for (const [mes, dia, nombre] of FIJOS) {
    anotar(fecha(anio, mes, dia), nombre);
  }
  for (const [mes, dia, nombre] of AL_LUNES) {
    anotar(alLunes(fecha(anio, mes, dia)), nombre);
  }
  for (const [desplazamiento, nombre] of DE_PASCUA) {
    anotar(sumarDias(pascua, desplazamiento), nombre);
  }
  for (const [desplazamiento, nombre] of DE_PASCUA_AL_LUNES) {
    anotar(alLunes(sumarDias(pascua, desplazamiento)), nombre);
  }

  cache.set(anio, dias);
  return dias;
}

/** ¿Es festivo esa fecha 'YYYY-MM-DD'? */
export function esFestivo(fechaTexto) {
  if (!fechaTexto) return false;
  return festivosDe(Number(String(fechaTexto).slice(0, 4))).has(fechaTexto);
}

/** 'Día de la Raza', o null si ese día no es festivo. */
export function nombreDelFestivo(fechaTexto) {
  if (!fechaTexto) return null;
  return festivosDe(Number(String(fechaTexto).slice(0, 4))).get(fechaTexto) ?? null;
}

// ═══════════════════════════════════════════════════════════════════
//  La regla del negocio
// ═══════════════════════════════════════════════════════════════════

/**
 * Con qué día de la semana se atiende una fecha: 0=Domingo … 6=Sábado.
 *
 * ⚠️ ESTE ES EL ÚNICO SITIO donde se decide qué jornada toca. Lo usan
 * `turnosDelDia()` (el bot) y `armarSemana()` (el panel). Si cada uno mirara
 * `diaSemana()` por su cuenta, en un festivo el cliente vería unas horas y el
 * barbero otras — que es exactamente cómo se estropeó esta misma lógica en el
 * sistema anterior cuando estuvo duplicada.
 *
 * Los barberos de la barbería piloto trabajan "domingos y festivos" con el mismo
 * horario reducido, así que un festivo se atiende con la jornada del domingo.
 */
export function diaDeHorario(fechaTexto) {
  return esFestivo(fechaTexto) ? 0 : diaSemana(fechaTexto);
}
