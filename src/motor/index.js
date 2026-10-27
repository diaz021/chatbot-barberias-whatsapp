/**
 * EL MOTOR — la máquina de estados de la conversación
 *
 * Todo mensaje entra por `manejar()`. El orden de las comprobaciones importa
 * y está pensado para que el cliente nunca quede sin respuesta.
 */

import * as sesiones from '../servicios/sesiones.js';
import * as construir from '../mensajes/construir.js';
import * as agendar from './agendar.js';
import * as cancelar from './cancelar.js';
import * as panel from './panel.js';
import * as avisos from '../servicios/avisos.js';
import { enviar } from '../servicios/whatsapp.js';
import { T, intencion, numeroEscrito, BOTONES_MENU } from '../mensajes/textos.js';
import { resolverEleccion } from './comun.js';

/** Ids del menú principal. Son los únicos sin prefijo, como en el bot anterior. */
const MENU = { AGENDAR: '1', CANCELAR: '2', UBICACION: '3' };

// ═══════════════════════════════════════════════════════════════════
//  Menú principal
// ═══════════════════════════════════════════════════════════════════

export async function enviarMenu(telefono, barberia, { conSaludo = false, nombrePerfil = null } = {}) {
  await sesiones.borrar(telefono, barberia.id);

  if (conSaludo) {
    await enviar(construir.texto(telefono, T.saludo(nombrePerfil, barberia)), barberia);
  }

  return enviar(construir.botones(telefono, T.menuCuerpo, BOTONES_MENU), barberia);
}

async function enviarUbicacion(telefono, barberia) {
  if (barberia.latitud != null && barberia.longitud != null) {
    await enviar(construir.ubicacion(telefono, {
      latitud: barberia.latitud,
      longitud: barberia.longitud,
      nombre: `${barberia.nombre} 💈`,
      direccion: [barberia.direccion, barberia.ciudad].filter(Boolean).join(', '),
    }), barberia);
  }

  return enviar(construir.texto(telefono, T.ubicacion(barberia)), barberia);
}

/**
 * Una opción del menú principal.
 *
 * ⚠️ §24.3 — en el bot anterior, escribir "1" en el menú principal no hacía
 * NADA: solo funcionaba tocando el botón. Aquí el número vale igual, porque
 * es lo primero que intenta cualquiera que no ve bien los botones.
 */
async function elegirDelMenu(opcion, telefono, barberia) {
  switch (opcion) {
    case MENU.AGENDAR:
      return agendar.pedirNombre(telefono, barberia);

    case MENU.CANCELAR: {
      const r = await cancelar.mostrarTurnos(telefono, barberia);
      if (r.tipo === 'menu') await enviarMenu(telefono, barberia);
      return r;
    }

    case MENU.UBICACION:
      await enviarUbicacion(telefono, barberia);
      return enviarMenu(telefono, barberia);

    default:
      return null;
  }
}

// ═══════════════════════════════════════════════════════════════════
//  Retroceso
// ═══════════════════════════════════════════════════════════════════

/** A dónde lleva "volver" desde cada paso, y qué se olvida al retroceder. */
const ATRAS = {
  [sesiones.PASOS.BARBERO]: { destino: null, olvidar: [] },                       // → menú
  [sesiones.PASOS.FECHA]:   { destino: 'barbero', olvidar: ['barberoId', 'barbero'] },
  [sesiones.PASOS.JORNADA]: { destino: 'fecha',   olvidar: ['fecha'] },
  [sesiones.PASOS.HORA]:    { destino: 'fecha',   olvidar: ['fecha', 'jornada'] },
  [sesiones.PASOS.CONFIRMAR]: { destino: 'cancelar', olvidar: ['turnoId'] },
};

async function retroceder(telefono, barberia, sesion) {
  const regla = ATRAS[sesion.paso];

  if (!regla || !regla.destino) {
    return enviarMenu(telefono, barberia);
  }

  const datos = { ...sesion.datos };
  regla.olvidar.forEach(k => delete datos[k]);

  switch (regla.destino) {
    case 'barbero':  return agendar.mostrarBarberos(telefono, barberia, datos);
    case 'fecha':    return agendar.mostrarFechas(telefono, barberia, datos);
    case 'cancelar': return cancelar.mostrarTurnos(telefono, barberia);
    default:         return enviarMenu(telefono, barberia);
  }
}

// ═══════════════════════════════════════════════════════════════════
//  Entrada principal
// ═══════════════════════════════════════════════════════════════════

export async function manejar({ de, clase, texto, idOpcion, barberia, nombrePerfil }) {
  // Audio, imagen, sticker, documento, ubicación.
  if (clase === 'otro') {
    await enviar(construir.texto(de, T.soloTexto), barberia);
    return;
  }

  // ── ¿Es un barbero escribiendo su contraseña? ──
  // Se comprueba antes que nada, pero solo para textos: un barbero también
  // es cliente del bot y puede querer agendar, así que esto no lo secuestra
  // salvo que escriba EXACTAMENTE su clave.
  if (clase === 'texto' && texto) {
    const barbero = await panel.intentarEntrar(de, barberia.id, texto);
    if (barbero) {
      console.log(`   panel: entró ${barbero.nombre}`);
      return panel.abrir(de, barberia, barbero);
    }
  }

  const sesion = await sesiones.leer(de, barberia.id);

  // ⚠️ El significado de "cancelar" depende de dónde esté el cliente. Dentro
  // del flujo de cancelación quiere decir "sí, cancela mi turno" — §24.1.
  const enCancelacion = sesion?.paso === sesiones.PASOS.CONFIRMAR
                     || sesion?.paso === sesiones.PASOS.CANCELAR;
  const quiso = intencion(texto, { dentroDeCancelacion: enCancelacion });

  if (quiso === 'menu') {
    return enviarMenu(de, barberia);
  }

  if (quiso === 'salir') {
    await sesiones.borrar(de, barberia.id);
    return enviar(construir.texto(de, T.procesoCancelado), barberia);
  }

  // ── Sin sesión activa ──
  if (!sesion) {
    if (await sesiones.habiaVencida(de, barberia.id)) {
      await sesiones.borrar(de, barberia.id);
      await enviar(construir.texto(de, T.sesionExpirada), barberia);
      return enviarMenu(de, barberia);
    }

    // Del menú principal: tocado o escrito.
    const opcion = idOpcion ?? (numeroEscrito(texto) !== null ? String(numeroEscrito(texto)) : null);
    if (opcion && Object.values(MENU).includes(opcion)) {
      return elegirDelMenu(opcion, de, barberia);
    }

    return enviarMenu(de, barberia, { conSaludo: true, nombrePerfil });
  }

  if (quiso === 'volver') {
    return retroceder(de, barberia, sesion);
  }

  return dentroDeUnFlujo({ de, texto, idOpcion, barberia, sesion, quiso });
}

async function dentroDeUnFlujo({ de, texto, idOpcion, barberia, sesion, quiso }) {
  let resultado;

  switch (sesion.paso) {
    case sesiones.PASOS.NOMBRE:
      await agendar.recibirNombre(de, barberia, texto);
      return;

    case sesiones.PASOS.BARBERO:
      resultado = await agendar.recibirBarbero(de, barberia, sesion, { idOpcion, texto });
      break;

    case sesiones.PASOS.FECHA:
      resultado = await agendar.recibirFecha(de, barberia, sesion, { idOpcion, texto });
      break;

    case sesiones.PASOS.JORNADA:
      resultado = await agendar.recibirJornada(de, barberia, sesion, { idOpcion, texto });
      break;

    case sesiones.PASOS.HORA:
      resultado = await agendar.recibirHora(de, barberia, sesion, { idOpcion, texto });
      if (resultado?.turno) {
        // El aviso NO bloquea la confirmación al cliente: ya la recibió. Si
        // Meta falla aquí, se registra pero el turno sigue siendo válido.
        await avisos.turnoNuevo(barberia, {
          barberoId: resultado.avisarBarbero,
          fecha: resultado.turno.fecha,
          hora: resultado.turno.hora,
          cliente: sesion.datos.nombre,
          telefonoCliente: de,
        }).catch(e => console.error('✗ Aviso de turno nuevo:', e.message));
      }
      break;

    case sesiones.PASOS.CANCELAR:
      resultado = await cancelar.recibirTurno(de, barberia, sesion, { idOpcion, texto });
      break;

    case sesiones.PASOS.CONFIRMAR:
      resultado = await cancelar.recibirConfirmacion(de, barberia, sesion, { idOpcion, intencion: quiso });
      if (resultado?.cancelado) {
        // §24.4 — avisarle al barbero, que antes no se enteraba nunca.
        await avisos.turnoCancelado(barberia, {
          barberoId: resultado.cancelado.barbero_id ?? sesion.datos.barberoId,
          fecha: resultado.cancelado.fecha,
          hora: resultado.cancelado.hora,
          cliente: resultado.cancelado.cliente_nombre,
        }).catch(e => console.error('✗ Aviso de cancelación:', e.message));
      }
      break;

    case panel.PASO_PANEL:
      resultado = await panel.manejarOpcion(de, barberia, sesion, { idOpcion, texto });
      break;

    case panel.PASO_PANEL_FECHA:
      resultado = await panel.recibirFecha(de, barberia, sesion, texto);
      break;

    default:
      return enviarMenu(de, barberia);
  }

  return segunResultado(resultado, { de, barberia, sesion });
}

async function segunResultado(resultado, { de, barberia, sesion }) {
  switch (resultado?.tipo) {
    case 'manejado':
      return resultado;

    case 'menu':
      return enviarMenu(de, barberia);

    case 'navegacion':
      return resultado.id === 'nav_menu'
        ? enviarMenu(de, barberia)
        : retroceder(de, barberia, sesion);

    // Tocó un botón de un menú anterior del historial. Se le dice qué pasó
    // sin sacarlo de donde iba: el flujo sigue intacto.
    case 'vieja':
      return enviar(construir.texto(de, T.opcionDeMenuAnterior), barberia);

    default: {
      // ⚠️ Al tercer error seguido se le devuelve al menú. Sin este freno, un
      // cliente confundido puede quedar rebotando en la misma pantalla.
      const errores = await sesiones.sumarError(de, barberia.id);

      if (errores >= sesiones.MAX_ERRORES) {
        await enviar(construir.texto(de, T.demasiadosErrores), barberia);
        return enviarMenu(de, barberia);
      }

      return enviar(construir.texto(de, T.noEntendi), barberia);
    }
  }
}

export { MENU };
