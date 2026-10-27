/**
 * TEXTOS — la voz del negocio, toda en un sitio
 *
 * VARIANTE B: acento morado.
 *
 * WhatsApp no tiene colores ni tipografías. La identidad de la barbería
 * entra por cuatro sitios y solo uno es texto:
 *   · la foto de perfil del número (el logo) — el de mayor impacto
 *   · el nombre visible
 *   · el perfil del negocio
 *   · y esto: la voz
 *
 * Cuatro decisiones detrás de cada texto:
 *
 *   1. SE TRATA DE USTED. Es una barbería de gama alta y el trato formal es
 *      parte de esa imagen. Nunca se tutea al cliente.
 *
 *   2. EL MORADO ES EL SELLO. 🟣 y el poste 💈 abren y cierran los mensajes
 *      importantes; en las confirmaciones, emojis funcionales (✂️ 📅 ⏰ 👤 ✅)
 *      dejan leer barbero, fecha y hora de un vistazo. WhatsApp no tiene
 *      color real: estos emojis son la única forma de traer el morado adentro.
 *
 *   3. LA FIRMA LA DEFINE LA BARBERÍA, en la columna `barberias.firma`, y se
 *      muestra tal cual. La barbería piloto la pidió en dos líneas: "💈NOMBRE💈 / BARBERSHOP".
 *      Abre la bienvenida y cierra la confirmación.
 *
 *   4. EL DATO PRIMERO. Barbero, fecha y hora antes que cualquier cortesía:
 *      un turno se lee de un vistazo o no sirve de nada.
 */

/** El marcador de marca. Uno por mensaje, siempre al inicio de la cabecera. */
const M = '🟣';

/**
 * Separa las letras de un nombre: "Barbería Demo" → "B A R B E R Í A   D E M O".
 * Solo se usa cuando la barbería no tiene `firma` propia en la base;
 * con nombres largos queda feo y por eso la columna existe.
 */
export function espaciar(nombre) {
  return String(nombre ?? '')
    .toUpperCase()
    .split(' ')
    .map(p => p.split('').join(' '))
    .join('   ');
}

/**
 * El bloque de marca de la barbería (cabecera de la bienvenida y cierre de
 * la confirmación).
 *
 * Si la barbería tiene `firma` en la base, se usa TAL CUAL: ese texto ya trae
 * el formato que la barbería quiere, con sus propios emojis y saltos de línea
 * (por ejemplo "💈NOMBRE💈\n    BARBERSHOP"). Solo cuando NO hay firma se
 * arma un fallback espaciando el nombre, entre 🟣 y 💈.
 */
export const firma = (barberia) =>
  barberia?.firma || `${M} ${espaciar(barberia?.nombre)} 💈`;

export const T = {
  // ── Entrada ────────────────────────────────────────────────────
  // La bienvenida para un cliente nuevo: se presenta el chat y para qué
  // sirve. La cabecera es la firma —el sello tipográfico de la marca—, no
  // el nombre corrido. Neutro en género: "Le damos la bienvenida" sirve para
  // cualquier persona, que "Bienvenido" no.
  saludo: (nombre, barberia) =>
    `${firma(barberia)}\n\n` +
    `Le damos la bienvenida${nombre ? `, ${nombre}` : ''}.\n` +
    `Este es el chat oficial de la barbería.\n\n` +
    `Reserve su turno en un minuto, sin llamadas ni esperas.`,

  menuCuerpo: '¿Qué desea hacer?',

  // ── Agendar ────────────────────────────────────────────────────
  pedirNombre:
    '👤 ¿A nombre de quién es el turno?\n\n' +
    '_Ejemplo: Juan Pérez_\n\n' +
    'Escriba *menu* para volver al inicio.',

  elegirBarbero: '✂️ ¿Con quién desea atenderse?',

  elegirFecha: (barbero) =>
    `✂️ *${barbero}*\n\n📅 ¿Para qué día?`,

  elegirJornada: (fecha, barbero) =>
    `📅 *${fecha}*\ncon *${barbero}*\n\n¿Qué jornada prefiere?`,

  elegirHora: (barbero, fecha) =>
    `✂️ *${barbero}*\n📅 ${fecha}\n\n⏰ Elija su hora:`,

  turnoConfirmado: ({ nombre, barbero, fecha, hora, barberia }) =>
    `✅ *TURNO CONFIRMADO*\n\n` +
    `✂️ ${barbero}\n` +
    `📅 ${fecha}\n` +
    `⏰ ${hora}\n` +
    `👤 ${nombre}\n\n` +
    `Le esperamos 5 minutos antes.\n` +
    `Para cancelar, escriba *menu*.\n\n` +
    firma(barberia),

  // ── Cancelar ───────────────────────────────────────────────────
  sinTurnos: 'No tiene turnos pendientes.',

  elegirTurnoACancelar: '🗓️ *Sus turnos*\n\n¿Cuál desea cancelar?',

  confirmarCancelacion: ({ barbero, fecha, hora }) =>
    `¿Confirma que cancela este turno?\n\n` +
    `✂️ *${barbero}*\n📅 ${fecha}\n⏰ ${hora}`,

  turnoCancelado: ({ barbero, fecha, hora }) =>
    `🟣 *TURNO CANCELADO*\n\n` +
    `✂️ ${barbero}\n📅 ${fecha} · ⏰ ${hora}\n\n` +
    `Ese cupo quedó libre.`,

  turnoYaNoActivo: 'Ese turno ya no está activo.\nQuizá ya lo habían cancelado.',
  cancelacionAbortada: 'Listo, su turno sigue en pie.',

  // ── Ubicación ──────────────────────────────────────────────────
  ubicacion: (barberia) =>
    `${firma(barberia)}\n\n📍 Aquí nos encuentra:\n\n` +
    (barberia.direccion ? `${barberia.direccion}\n` : '') +
    (barberia.ciudad ? `${barberia.ciudad}\n` : '') +
    (barberia.telefono_contacto ? `\n📞 ${barberia.telefono_contacto}\n` : '') +
    `\nLe esperamos 💈`,

  // ── Errores y avisos ───────────────────────────────────────────
  limiteDiario: 'Ya tiene 2 turnos ese día.\nEs el máximo por persona.',

  horarioTomado: 'Ese horario lo acaban de tomar.\nElija otro, por favor 👇',

  sinAgenda: 'No puedo ver la agenda en este momento.\nIntente en un minuto, por favor 🙏',

  barberoSinHorario: (barbero) =>
    `*${barbero}* no tiene horarios abiertos.\nElija otro barbero 💈`,

  sinCuposEseDia: 'Ese día ya se llenó.\nElija otra fecha, por favor.',

  sesionExpirada: 'Pasó un rato y se cerró la conversación.\n\nEscriba *menu* y seguimos.',

  demasiadosErrores: 'Creo que nos enredamos.\n\nEscriba *menu* y empezamos de nuevo.',

  soloTexto: 'Por ahora solo leo *texto* 🙏',

  procesoCancelado: 'Listo, lo dejamos ahí.\nEscriba *menu* cuando quiera.',

  // ⚠️ §13.3 — distingue una respuesta de la pantalla actual de un botón
  // viejo que el cliente tocó más arriba en el historial del chat.
  opcionDeMenuAnterior:
    'Esa opción es de un menú anterior.\n\n' +
    'Siga donde iba, o escriba *menu* para empezar de nuevo.',

  noEntendi: 'No entendí esa opción.\nElija una de la lista o escriba *menu*.',

  // ── Panel del barbero ──────────────────────────────────────────
  panelBienvenida: (nombre) => `💈 *Bienvenido ${nombre}*\n\n¿Qué desea ver?`,
  panelSalida: 'Salió del panel.',
  panelPedirFecha: '📅 ¿Qué día desea ver?\n\n_Formato: DD/MM/AAAA — ejemplo: 25/12/2026_',
  panelFechaInvalida: 'No entendí esa fecha.\n\nEscríbala así: DD/MM/AAAA',
  panelFechaImposible: 'Esa fecha no existe. Intente de nuevo.',
};

// ═══════════════════════════════════════════════════════════════════
//  Navegación global
// ═══════════════════════════════════════════════════════════════════

export const NAV = {
  VOLVER: { id: 'nav_volver', titulo: 'Volver' },
  MENU:   { id: 'nav_menu',   titulo: 'Menú principal' },
};

/**
 * Los tres del menú principal. Máximo 20 caracteres cada uno (Meta), contando
 * el emoji: ✂️ + " Agendar turno" = 16, el más largo 🗓️ + " Cancelar turno"
 * = 18. Los ids ('1','2','3') son lo que se compara, no el título, así que el
 * emoji es solo decoración segura.
 */
export const BOTONES_MENU = [
  { id: '1', titulo: '✂️ Agendar turno' },
  { id: '2', titulo: '🗓️ Cancelar turno' },
  { id: '3', titulo: '📍 Dónde estamos' },
];

const quitarTildes = (t) =>
  String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/**
 * Qué quiso decir el cliente al escribir texto suelto.
 *
 * ⚠️ §24.1 — LA CORRECCIÓN MÁS IMPORTANTE.
 * En el bot anterior, escribir "cancelar" DENTRO del flujo de cancelación
 * respondía "✅ Proceso cancelado" sin cancelar el turno. El cliente leía ese
 * ✅, creía que había cancelado, y no aparecía a su cita. Era la falla más
 * grave detectada.
 *
 * Por eso `dentroDeCancelacion` cambia el significado de esa palabra: ahí
 * "cancelar" quiere decir "sí, cancela mi turno", no "abandona el proceso".
 */
export function intencion(texto, { dentroDeCancelacion = false } = {}) {
  const t = quitarTildes(texto);

  if (t === 'menu' || t === 'inicio') return 'menu';
  if (t === 'volver' || t === 'atras') return 'volver';

  if (t === 'cancelar' || t === 'salir') {
    return dentroDeCancelacion ? 'confirmar_si' : 'salir';
  }

  // §24.2 — el bot anterior solo aceptaba el número o el botón. Un "sí" o un
  // "ok" no hacían nada, que es lo que cualquiera responde de forma natural.
  if (['si', 'sii', 'sip', 'ok', 'okay', 'dale', 'claro', 'confirmo', 'dele'].includes(t)) {
    return 'confirmar_si';
  }
  if (['no', 'nop', 'nel', 'negativo'].includes(t)) return 'confirmar_no';

  return null;
}

/** El número que escribió el cliente, o null. Acepta "3" y "3." */
export function numeroEscrito(texto) {
  const m = String(texto ?? '').trim().match(/^(\d{1,2})\.?$/);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= 99 ? n : null;
}

/**
 * ¿Este id pertenece a la pantalla en la que está el cliente?
 *
 * Los ids llevan prefijo con nombre (`barbero_`, `fecha_`, `hora_`…) justo
 * para poder distinguir una respuesta de la pantalla actual de un botón que
 * el cliente tocó más arriba en el historial.
 */
export function idEsDe(id, prefijo) {
  return typeof id === 'string' && id.startsWith(prefijo);
}

export const esIdDeNavegacion = (id) => idEsDe(id, 'nav_');
