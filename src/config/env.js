/**
 * VARIABLES DE ENTORNO — todas en un solo sitio
 *
 * ⚠️ Se leen UNA SOLA VEZ, al arrancar. Cambiar una variable con el proceso
 * ya corriendo no tiene ningún efecto. En el sistema anterior esto hizo que
 * una prueba pasara por la razón equivocada: creía estar probando el cambio
 * y estaba leyendo el valor viejo.
 *
 * Filosofía heredada, y es deliberada: **casi nada tumba el arranque**.
 * Falta algo, se avisa fuerte en los logs y el proceso sigue. Es preferible
 * un bot a medias que avisa, a un bot que no arranca y deja a la barbería
 * sin nada. La única excepción es DATABASE_URL: sin base no hay nada que
 * hacer, y fallar callado sería peor.
 */

import 'dotenv/config';

const leer = (nombre, porDefecto = null) => {
  const valor = process.env[nombre];
  return valor && valor.trim() ? valor.trim() : porDefecto;
};

export const env = {
  // ── Base de datos ────────────────────────────────────────────────
  DATABASE_URL: leer('DATABASE_URL'),

  // ── WhatsApp Cloud API ───────────────────────────────────────────
  API_TOKEN:            leer('API_TOKEN'),
  API_VERSION:          leer('API_VERSION', 'v21.0'),
  WEBHOOK_VERIFY_TOKEN: leer('WEBHOOK_VERIFY_TOKEN'),
  META_APP_SECRET:      leer('META_APP_SECRET'),
  META_APP_ID:          leer('META_APP_ID'),

  // ── Plantillas aprobadas por Meta ────────────────────────────────
  PLANTILLA_TURNO_NUEVO:  leer('PLANTILLA_TURNO_NUEVO'),
  PLANTILLA_RECORDATORIO: leer('PLANTILLA_RECORDATORIO'),
  PLANTILLA_CANCELACION:  leer('PLANTILLA_CANCELACION'),
  PLANTILLA_IDIOMA:       leer('PLANTILLA_IDIOMA', 'es'),

  // ── IA (fase 5) ──────────────────────────────────────────────────
  ANTHROPIC_API_KEY: leer('ANTHROPIC_API_KEY'),

  // ── Panel y servidor ─────────────────────────────────────────────
  SESION_SECRETO: leer('SESION_SECRETO'),
  URL_PUBLICA:    leer('URL_PUBLICA'),
  PORT:           Number(leer('PORT', '3000')),

  get ENTORNO() {
    return leer('NODE_ENV', 'development');
  },
};

/**
 * ¿Debe este proceso correr las tareas de fondo (recordatorios y vigilancia)?
 *
 * ⚠️ EL BARRIDO DE RECORDATORIOS NO ES SOLO DE LECTURA. `barrer()` marca
 * `recordatorio_enviado = TRUE` cuando el envío sale bien, y en modo simulado
 * "sale bien" siempre. Un segundo proceso corriendo contra la MISMA base —el
 * portátil de alguien con `npm start`— le roba el recordatorio a un cliente
 * real: lo marca como enviado y a nadie le llega nada. Sin modo simulado el
 * daño es el opuesto, dos recordatorios por el mismo turno.
 *
 * Hay tres formas de quedar apagado, y las tres se anuncian al arrancar:
 *
 *   · `TAREAS_DE_FONDO=0` — lo que pone un desarrollador en su `.env` local.
 *   · `MODO_SIMULADO=1`   — las pruebas y cualquier prueba a mano.
 *   · sin `API_TOKEN`     — `whatsapp.js` cae en simulado por su cuenta, y
 *                           entonces el barrido marcaría turnos sin enviar.
 *
 * El valor por defecto es ENCENDIDO a propósito. Si hubiera que activarlas
 * con una variable, el día que a Railway se le olvide ponerla los
 * recordatorios se apagan y nadie se entera: otro fallo mudo. Así, lo peor
 * que pasa por defecto es que funcionen.
 */
export function tareasDeFondo() {
  if (leer('TAREAS_DE_FONDO') === '0') {
    return { activas: false, motivo: 'TAREAS_DE_FONDO=0' };
  }
  if (leer('MODO_SIMULADO') === '1') {
    return { activas: false, motivo: 'MODO_SIMULADO=1' };
  }
  if (!env.API_TOKEN) {
    return { activas: false, motivo: 'no hay API_TOKEN' };
  }
  return { activas: true, motivo: null };
}

/**
 * Avisa de lo que falta, con la consecuencia concreta de cada ausencia.
 * Un log que dice "falta META_APP_SECRET" no sirve de nada si no dice qué
 * deja de funcionar por eso.
 */
export function revisarEntorno() {
  const avisos = [];

  if (!env.API_TOKEN)            avisos.push('API_TOKEN — el bot no puede ENVIAR ningún mensaje');
  if (!env.WEBHOOK_VERIFY_TOKEN) avisos.push('WEBHOOK_VERIFY_TOKEN — Meta no puede verificar el webhook');
  if (!env.META_APP_SECRET)      avisos.push('META_APP_SECRET — la validación de firma queda APAGADA');
  if (!env.SESION_SECRETO)       avisos.push('SESION_SECRETO — cada despliegue cerrará las sesiones del panel');
  if (!env.URL_PUBLICA)          avisos.push('URL_PUBLICA — sin ella no se puede vigilar si el webhook apunta aquí');
  if (!env.META_APP_ID)          avisos.push('META_APP_ID — no se puede comprobar la URL registrada en Meta');
  if (!env.PLANTILLA_TURNO_NUEVO)  avisos.push('PLANTILLA_TURNO_NUEVO — al barbero no le llega el aviso de turno nuevo');
  if (!env.PLANTILLA_RECORDATORIO) avisos.push('PLANTILLA_RECORDATORIO — no salen los recordatorios de 1 hora antes');

  if (avisos.length) {
    console.warn('\n⚠ Variables sin configurar:');
    avisos.forEach(a => console.warn('   ·', a));
    console.warn('');
  }

  // La única que sí detiene el arranque.
  if (!env.DATABASE_URL) {
    console.error('✗ Falta DATABASE_URL. Sin base de datos no hay nada que hacer.\n');
    process.exit(1);
  }

  return avisos;
}
