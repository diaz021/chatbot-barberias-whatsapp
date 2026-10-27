/**
 * PANEL DEL BARBERO — por WhatsApp
 *
 * El barbero escribe su contraseña desde su número registrado y entra a ver
 * su agenda. No hay app, no hay web, no hay que instalar nada: es el mismo
 * chat donde ya está.
 *
 * ⚠️ La contraseña solo se comprueba si el mensaje viene de un teléfono que
 * YA está registrado como barbero. Sin ese filtro previo, cada mensaje de
 * cada cliente dispararía un scrypt —que es lento a propósito— y el bot se
 * arrastraría.
 */

import { consultar, consultarUna } from '../db/pool.js';
import * as sesiones from '../servicios/sesiones.js';
import * as construir from '../mensajes/construir.js';
import { enviar } from '../servicios/whatsapp.js';
import { verificar } from '../servicios/claves.js';
import { fechaVisible, horaVisible, hoyEn, sumarDias, diaSemana } from '../config/fechas.js';
import { enviarLista, resolverEleccion, valorDe } from './comun.js';
import { T } from '../mensajes/textos.js';
import { telefonoVisible } from '../servicios/identidad.js';

const P = { OPCION: 'panel_' };
export const PASO_PANEL = 'panel';
export const PASO_PANEL_FECHA = 'panel_fecha';

/**
 * ¿El mensaje es la contraseña de un barbero de esta barbería?
 * Devuelve el barbero, o null.
 */
export async function intentarEntrar(telefono, barberiaId, texto) {
  if (!texto || texto.length < 4 || texto.length > 64) return null;

  const barbero = await consultarUna(
    `SELECT id, nombre, password_hash
       FROM barberos
      WHERE barberia_id = $1 AND telefono = $2 AND activo
        AND password_hash IS NOT NULL`,
    [barberiaId, telefono]
  );

  if (!barbero) return null;
  return await verificar(texto, barbero.password_hash) ? barbero : null;
}

export async function abrir(telefono, barberia, barbero) {
  await enviar(construir.texto(telefono, T.panelBienvenida(barbero.nombre)), barberia);

  return enviarLista(telefono, barberia, {
    cuerpo: '¿Qué desea ver?',
    textoBoton: 'Ver agenda',
    secciones: [{
      titulo: 'AGENDA',
      filas: [
        { id: P.OPCION + 'hoy',    titulo: 'Ver agenda de hoy' },
        { id: P.OPCION + 'manana', titulo: 'Ver agenda de mañana' },
        { id: P.OPCION + 'fecha',  titulo: 'Buscar por fecha' },
        { id: P.OPCION + 'salir',  titulo: 'Salir del panel' },
      ],
    }],
    navegacion: [],   // el panel no usa Volver: tiene su propia salida
  }, { paso: PASO_PANEL, datos: { barberoId: barbero.id, barberoNombre: barbero.nombre } });
}

/**
 * La agenda de un día, hora por hora.
 *
 * ⚠️ Muestra los turnos históricos aunque su hora YA NO esté en la jornada
 * configurada. Si al barbero le cambian el horario, los turnos ya agendados
 * en las horas viejas no desaparecen — si no aparecieran, el barbero se
 * quedaría esperando a un cliente que sí tiene cita.
 */
export async function agendaDe(barberoId, fecha) {
  const configurados = await consultar(
    `SELECT unnest(turnos) AS hora FROM horarios WHERE barbero_id = $1 AND dia_semana = $2`,
    [barberoId, diaSemana(fecha)]
  );

  const ocupados = await consultar(
    `SELECT hora, tipo, cliente_nombre, cliente_telefono
       FROM turnos
      WHERE barbero_id = $1 AND fecha = $2 AND estado = 'Confirmado'`,
    [barberoId, fecha]
  );

  const porHora = new Map(ocupados.map(t => [t.hora, t]));

  // La unión de lo configurado y lo ocupado, para que nada se pierda.
  const horas = [...new Set([
    ...configurados.map(c => c.hora),
    ...ocupados.map(o => o.hora),
  ])].sort();

  return horas.map(hora => {
    const t = porHora.get(hora);
    if (!t) return { hora, libre: true };
    return {
      hora,
      libre: false,
      bloqueo: t.tipo === 'bloqueo',
      nombre: t.cliente_nombre,
      telefono: t.cliente_telefono,
    };
  });
}

/**
 * El teléfono sin el código de país, que es como lo marca el barbero.
 * Un cliente con nombre de usuario de WhatsApp no tiene número: ver
 * identidad.js.
 */
const telefonoLocal = telefonoVisible;

export function formatearAgenda(nombreBarbero, titulo, filas) {
  if (filas.length === 0) {
    return `💈 Agenda ${nombreBarbero} - ${titulo}\n\nNo hay jornada configurada para ese día.`;
  }

  const lineas = filas.map(f => {
    if (f.libre) return `🟢 ${horaVisible(f.hora)} - Libre`;
    if (f.bloqueo) return `🔴 ${horaVisible(f.hora)} - Descanso\n📱`;
    return `🔴 ${horaVisible(f.hora)} - ${f.nombre ?? ''}\n📱 ${telefonoLocal(f.telefono)}`;
  });

  const ocupados = filas.filter(f => !f.libre).length;

  return `💈 Agenda ${nombreBarbero} - ${titulo}\n\n${lineas.join('\n\n')}\n\n` +
         `📊 ${ocupados} de ${filas.length} ocupados`;
}

async function mostrarAgenda(telefono, barberia, sesion, fecha, titulo) {
  const filas = await agendaDe(sesion.datos.barberoId, fecha);
  const texto = formatearAgenda(sesion.datos.barberoNombre, titulo, filas);

  // El tope de cuerpo son 1024 caracteres. Una jornada de 16 turnos con
  // nombres y teléfonos se pasa, así que se parte en varios mensajes.
  const trozos = partirTexto(texto, 1000);
  for (const t of trozos) {
    await enviar(construir.texto(telefono, t), barberia);
  }

  return abrir(telefono, barberia, {
    id: sesion.datos.barberoId,
    nombre: sesion.datos.barberoNombre,
  });
}

/** Parte por líneas, sin cortar un turno a la mitad. */
function partirTexto(texto, maximo) {
  if (texto.length <= maximo) return [texto];

  const trozos = [];
  let actual = '';

  for (const bloque of texto.split('\n\n')) {
    if ((actual + '\n\n' + bloque).length > maximo && actual) {
      trozos.push(actual);
      actual = bloque;
    } else {
      actual = actual ? `${actual}\n\n${bloque}` : bloque;
    }
  }

  if (actual) trozos.push(actual);
  return trozos;
}

export async function manejarOpcion(telefono, barberia, sesion, { idOpcion, texto }) {
  const r = resolverEleccion({ idOpcion, texto, prefijo: P.OPCION, sesion });
  if (r.tipo !== 'opcion') return r;

  const opcion = valorDe(r.id, P.OPCION);
  const hoy = hoyEn(barberia.zona_horaria);

  switch (opcion) {
    case 'hoy':
      await mostrarAgenda(telefono, barberia, sesion, hoy, 'Hoy');
      return { tipo: 'manejado' };

    case 'manana':
      await mostrarAgenda(telefono, barberia, sesion, sumarDias(hoy, 1), 'Mañana');
      return { tipo: 'manejado' };

    case 'fecha':
      await sesiones.guardar(telefono, barberia.id, PASO_PANEL_FECHA, sesion.datos);
      await enviar(construir.texto(telefono, T.panelPedirFecha), barberia);
      return { tipo: 'manejado' };

    case 'salir':
      await sesiones.borrar(telefono, barberia.id);
      await enviar(construir.texto(telefono, T.panelSalida), barberia);
      return { tipo: 'menu' };

    default:
      return { tipo: 'nada' };
  }
}

export async function recibirFecha(telefono, barberia, sesion, texto) {
  const m = String(texto ?? '').trim().match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);

  if (!m) {
    await enviar(construir.texto(telefono, T.panelFechaInvalida), barberia);
    return { tipo: 'manejado' };
  }

  const [, d, mes, a] = m;
  const fecha = `${a}-${String(Number(mes)).padStart(2, '0')}-${String(Number(d)).padStart(2, '0')}`;

  if (Number(mes) > 12 || Number(d) > 31) {
    await enviar(construir.texto(telefono, T.panelFechaImposible), barberia);
    return { tipo: 'manejado' };
  }

  await sesiones.guardar(telefono, barberia.id, PASO_PANEL, sesion.datos);
  await mostrarAgenda(telefono, barberia, sesion, fecha, fechaVisible(fecha));
  return { tipo: 'manejado' };
}

export { P as PREFIJOS };
