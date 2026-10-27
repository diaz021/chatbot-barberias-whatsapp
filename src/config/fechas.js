/**
 * FECHAS Y HORAS — siempre en la zona del NEGOCIO
 *
 * ⚠️ La trampa que costó turnos en el sistema anterior: Railway corre en UTC.
 * Entre las 7pm y medianoche en Colombia, `new Date()` en el servidor ya está
 * en el día siguiente. "Hoy" apunta a mañana, los turnos de esta noche
 * desaparecen de la lista y los recordatorios salen a destiempo.
 *
 * Por eso aquí NADA usa la hora del servidor sin pasarle la zona de la
 * barbería. Cada barbería trae la suya en `zona_horaria`.
 *
 * Las fechas viajan como texto 'YYYY-MM-DD' y las horas como 'HH:MM:SS',
 * nunca como objetos Date, que se reinterpretan solos al cruzar capas.
 */

const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
               'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** 'YYYY-MM-DD' de hoy, en la zona del negocio. */
export function hoyEn(zona) {
  // 'en-CA' da exactamente el formato ISO corto que necesitamos.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: zona, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

/** Minutos transcurridos desde medianoche, en la zona del negocio. */
export function ahoraEnMinutos(zona) {
  const partes = new Intl.DateTimeFormat('en-GB', {
    timeZone: zona, hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date());

  const valor = (tipo) => Number(partes.find(p => p.type === tipo)?.value ?? 0);
  return valor('hour') * 60 + valor('minute');
}

/**
 * Día de la semana de una fecha 'YYYY-MM-DD'. 0=Domingo … 6=Sábado.
 * Se calcula en UTC a propósito: la cadena no lleva zona, y usar la local
 * la correría un día para quien esté al oeste de Greenwich.
 */
export function diaSemana(fecha) {
  const [a, m, d] = fecha.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d)).getUTCDay();
}

/** Suma días a una fecha 'YYYY-MM-DD' y devuelve otra 'YYYY-MM-DD'. */
export function sumarDias(fecha, dias) {
  const [a, m, d] = fecha.split('-').map(Number);
  const t = new Date(Date.UTC(a, m - 1, d));
  t.setUTCDate(t.getUTCDate() + dias);
  return t.toISOString().slice(0, 10);
}

/** 'Sábado 2 de mayo' — para el cuerpo de los mensajes. */
export function fechaVisible(fecha) {
  const [a, m, d] = fecha.split('-').map(Number);
  return `${DIAS[diaSemana(fecha)]} ${d} de ${MESES[m - 1]}`;
}

/**
 * 'Sábado 2' — para el título de una fila de lista.
 * Meta corta los títulos a 24 caracteres, y el nombre del mes no cabe.
 */
export function fechaCorta(fecha) {
  const d = Number(fecha.split('-')[2]);
  return `${DIAS[diaSemana(fecha)]} ${d}`;
}

// ═══════════════════════════════════════════════════════════════════
//  Horas
// ═══════════════════════════════════════════════════════════════════

/**
 * '09:00:00' → '9am' · '10:45:00' → '10:45am' · '13:30:00' → '1:30pm'
 *
 * Es el formato exacto que la barbería lleva usando desde el principio y que
 * los clientes ya reconocen. Se conserva tal cual: en punto va sin minutos.
 */
export function horaVisible(hora) {
  const [h, m] = String(hora).split(':').map(Number);
  const sufijo = h >= 12 ? 'pm' : 'am';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12}${sufijo}` : `${h12}:${String(m).padStart(2, '0')}${sufijo}`;
}

/** Minutos desde medianoche de una hora 'HH:MM:SS'. */
export function horaEnMinutos(hora) {
  const [h, m] = String(hora).split(':').map(Number);
  return h * 60 + m;
}

/** Normaliza a 'HH:MM:SS' para comparar y guardar. */
export function horaNormal(hora) {
  const [h, m] = String(hora).split(':');
  return `${String(Number(h)).padStart(2, '0')}:${String(Number(m ?? 0)).padStart(2, '0')}:00`;
}

// ═══════════════════════════════════════════════════════════════════
//  Instante exacto
// ═══════════════════════════════════════════════════════════════════

/**
 * Convierte fecha + hora locales del negocio a un instante absoluto (Date).
 * Es lo que se guarda en `turnos.inicio_en` y lo que usa el recordatorio.
 *
 * Se calcula midiendo el desfase real de la zona ESE día concreto, en vez de
 * asumir uno fijo: así el cálculo sigue siendo correcto donde haya horario de
 * verano. Colombia no lo tiene, pero la próxima barbería puede estar en otro
 * país y este es el tipo de suposición que envejece mal.
 */
export function instanteDe(fecha, hora, zona) {
  const [a, m, d] = fecha.split('-').map(Number);
  const [hh, mm] = String(hora).split(':').map(Number);

  const comoUTC = Date.UTC(a, m - 1, d, hh, mm, 0);

  // Cómo se ve ese instante UTC desde la zona del negocio.
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: zona, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(new Date(comoUTC));

  const v = (tipo) => Number(partes.find(p => p.type === tipo)?.value ?? 0);
  const visto = Date.UTC(v('year'), v('month') - 1, v('day'), v('hour') % 24, v('minute'), v('second'));

  // La diferencia entre lo que pedimos y lo que se ve es el desfase de la zona.
  return new Date(comoUTC + (comoUTC - visto));
}

export { DIAS, MESES };
