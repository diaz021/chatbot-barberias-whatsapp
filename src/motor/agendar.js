/**
 * FLUJO DE AGENDAR
 *
 *   nombre → barbero → fecha → (jornada) → hora → confirmación
 *
 * El paso de jornada SE SALTA si todos los turnos libres caben en una lista.
 */

import * as horarios from '../servicios/horarios.js';
import * as turnos from '../servicios/turnos.js';
import * as sesiones from '../servicios/sesiones.js';
import * as construir from '../mensajes/construir.js';
import { enviar } from '../servicios/whatsapp.js';
import { T } from '../mensajes/textos.js';
import { fechaVisible, fechaCorta, horaVisible } from '../config/fechas.js';
import { enviarLista, navegacionCompleta, resolverEleccion, valorDe } from './comun.js';

const P = { BARBERO: 'barbero_', FECHA: 'fecha_', JORNADA: 'jornada_', HORA: 'hora_' };

// ═══════════════════════════════════════════════════════════════════
//  Paso 1 — nombre
// ═══════════════════════════════════════════════════════════════════

export async function pedirNombre(telefono, barberia) {
  await sesiones.guardar(telefono, barberia.id, sesiones.PASOS.NOMBRE, {});
  return enviar(construir.texto(telefono, T.pedirNombre), barberia);
}

export async function recibirNombre(telefono, barberia, texto) {
  const nombre = String(texto ?? '').trim().slice(0, 60);

  if (nombre.length < 2) {
    return enviar(construir.texto(telefono, T.pedirNombre), barberia);
  }

  return mostrarBarberos(telefono, barberia, { nombre });
}

// ═══════════════════════════════════════════════════════════════════
//  Paso 2 — barbero
// ═══════════════════════════════════════════════════════════════════

export async function mostrarBarberos(telefono, barberia, datos) {
  const lista = await horarios.barberosDe(barberia.id);

  if (lista.length === 0) {
    return enviar(construir.texto(telefono, T.sinAgenda), barberia);
  }

  return enviarLista(telefono, barberia, {
    cuerpo: T.elegirBarbero,
    textoBoton: 'Elegir barbero',
    pie: 'También puedes escribir el número',
    secciones: [{ titulo: 'BARBEROS', filas: lista.map(b => ({ id: P.BARBERO + b.id, titulo: b.nombre })) }],
    navegacion: navegacionCompleta,
  }, { paso: sesiones.PASOS.BARBERO, datos });
}

export async function recibirBarbero(telefono, barberia, sesion, { idOpcion, texto }) {
  const r = resolverEleccion({ idOpcion, texto, prefijo: P.BARBERO, sesion });
  if (r.tipo !== 'opcion') return r;

  const barberoId = Number(valorDe(r.id, P.BARBERO));
  const barbero = await horarios.barberoPorId(barberoId);

  if (!barbero || barbero.barberia_id !== barberia.id) {
    await enviar(construir.texto(telefono, T.noEntendi), barberia);
    return { tipo: 'manejado' };
  }

  await mostrarFechas(telefono, barberia, { ...sesion.datos, barberoId, barbero: barbero.nombre });
  return { tipo: 'manejado' };
}

// ═══════════════════════════════════════════════════════════════════
//  Paso 3 — fecha
// ═══════════════════════════════════════════════════════════════════

export async function mostrarFechas(telefono, barberia, datos) {
  const dias = await horarios.proximosDias(datos.barberoId, barberia.zona_horaria, 7);

  // ⚠️ Nunca mostrarle una lista vacía: se avisa y se le devuelve a los
  // barberos, para que no se quede mirando una pantalla sin salida.
  if (dias.length === 0) {
    await enviar(construir.texto(telefono, T.barberoSinHorario(datos.barbero)), barberia);
    await mostrarBarberos(telefono, barberia, { nombre: datos.nombre });
    return;
  }

  return enviarLista(telefono, barberia, {
    cuerpo: T.elegirFecha(datos.barbero),
    textoBoton: 'Elegir fecha',
    secciones: [{
      titulo: 'FECHAS',
      filas: dias.map(d => ({
        id: P.FECHA + d.fecha,
        titulo: fechaCorta(d.fecha),
        descripcion: d.libres > 0
          ? `${fechaVisible(d.fecha)} · ${d.libres} turnos libres`
          : `${fechaVisible(d.fecha)} · ❌ sin cupos`,
      })),
    }],
    navegacion: navegacionCompleta,
  }, { paso: sesiones.PASOS.FECHA, datos });
}

export async function recibirFecha(telefono, barberia, sesion, { idOpcion, texto }) {
  const r = resolverEleccion({ idOpcion, texto, prefijo: P.FECHA, sesion });
  if (r.tipo !== 'opcion') return r;

  const fecha = valorDe(r.id, P.FECHA);
  const datos = { ...sesion.datos, fecha };

  const libres = await horarios.turnosLibres(datos.barberoId, fecha, barberia.zona_horaria);

  if (libres.length === 0) {
    await enviar(construir.texto(telefono, T.sinCuposEseDia), barberia);
    await mostrarFechas(telefono, barberia, datos);
    return { tipo: 'manejado' };
  }

  // Si todo cabe en una lista, la pantalla de jornada sobra.
  if (!horarios.necesitaPantallaDeJornada(libres)) {
    await mostrarHoras(telefono, barberia, datos, libres, null);
  } else {
    await mostrarJornadas(telefono, barberia, datos, libres);
  }

  return { tipo: 'manejado' };
}

// ═══════════════════════════════════════════════════════════════════
//  Paso 4 — jornada (solo si hace falta)
// ═══════════════════════════════════════════════════════════════════

const ETIQUETA = {
  manana:     { emoji: '☀️', nombre: 'Mañana' },
  tarde:      { emoji: '🌤️', nombre: 'Tarde' },
  tardenoche: { emoji: '🌙', nombre: 'Tarde-noche' },
};

export async function mostrarJornadas(telefono, barberia, datos, libres) {
  // ⚠️ La referencia es el horario COMPLETO del día, no lo que queda libre.
  // Con lo libre, el bloque de tarde-noche aparecería y desaparecería según
  // cuánta gente hubiera agendado, y el cliente vería una pantalla distinta
  // cada vez. Es un error que ya se cometió.
  const completo = await horarios.turnosDelDia(datos.barberoId, datos.fecha);
  const j = horarios.partirEnJornadas(libres, completo);

  const conCupos = Object.entries(j).filter(([, turnos]) => turnos.length > 0);

  if (conCupos.length <= 1) {
    return mostrarHoras(telefono, barberia, datos, libres, null);
  }

  return enviarLista(telefono, barberia, {
    cuerpo: T.elegirJornada(fechaVisible(datos.fecha), datos.barbero),
    textoBoton: 'Elegir jornada',
    secciones: [{
      titulo: 'JORNADAS',
      filas: conCupos.map(([clave, turnos]) => ({
        id: P.JORNADA + clave,
        titulo: `${ETIQUETA[clave].emoji} ${ETIQUETA[clave].nombre}`,
        descripcion: `${turnos.length} turno${turnos.length === 1 ? '' : 's'} disponible${turnos.length === 1 ? '' : 's'}`,
      })),
    }],
    navegacion: navegacionCompleta,
  }, { paso: sesiones.PASOS.JORNADA, datos });
}

export async function recibirJornada(telefono, barberia, sesion, { idOpcion, texto }) {
  const r = resolverEleccion({ idOpcion, texto, prefijo: P.JORNADA, sesion });
  if (r.tipo !== 'opcion') return r;

  const jornada = valorDe(r.id, P.JORNADA);
  const datos = sesion.datos;

  const libres = await horarios.turnosLibres(datos.barberoId, datos.fecha, barberia.zona_horaria);
  const completo = await horarios.turnosDelDia(datos.barberoId, datos.fecha);
  const j = horarios.partirEnJornadas(libres, completo);

  await mostrarHoras(telefono, barberia, datos, j[jornada] ?? [], jornada);
  return { tipo: 'manejado' };
}

// ═══════════════════════════════════════════════════════════════════
//  Paso 5 — hora
// ═══════════════════════════════════════════════════════════════════

export async function mostrarHoras(telefono, barberia, datos, libres, jornada) {
  if (libres.length === 0) {
    await enviar(construir.texto(telefono, T.sinCuposEseDia), barberia);
    return mostrarFechas(telefono, barberia, datos);
  }

  let secciones;

  if (jornada) {
    // Viene de elegir jornada: una sola sección, con su nombre.
    secciones = [{
      titulo: `${ETIQUETA[jornada].emoji} ${ETIQUETA[jornada].nombre.toUpperCase()}`,
      filas: libres.map(h => ({ id: P.HORA + h, titulo: horaVisible(h) })),
    }];
  } else {
    // Cabe todo: se agrupa por jornada pero se muestra de una sola vez.
    const completo = await horarios.turnosDelDia(datos.barberoId, datos.fecha);
    const j = horarios.partirEnJornadas(libres, completo);

    secciones = Object.entries(j)
      .filter(([, turnos]) => turnos.length > 0)
      .map(([clave, turnos]) => ({
        titulo: `${ETIQUETA[clave].emoji} ${ETIQUETA[clave].nombre.toUpperCase()}`,
        filas: turnos.map(h => ({ id: P.HORA + h, titulo: horaVisible(h) })),
      }));
  }

  return enviarLista(telefono, barberia, {
    cuerpo: T.elegirHora(datos.barbero, fechaVisible(datos.fecha)),
    textoBoton: 'Elegir hora',
    secciones,
    navegacion: navegacionCompleta,
  }, { paso: sesiones.PASOS.HORA, datos: { ...datos, jornada } });
}

export async function recibirHora(telefono, barberia, sesion, { idOpcion, texto }) {
  const r = resolverEleccion({ idOpcion, texto, prefijo: P.HORA, sesion });
  if (r.tipo !== 'opcion') return r;

  const hora = valorDe(r.id, P.HORA);
  const datos = sesion.datos;

  const resultado = await turnos.agendar({
    barberia,
    barberoId: datos.barberoId,
    fecha: datos.fecha,
    hora,
    nombre: datos.nombre,
    telefono,
  });

  if (!resultado.ok) {
    // ⚠️ §24.5 — todo camino termina en un mensaje. Un fallo aquí no puede
    // dejar al cliente esperando en silencio: se le dice qué pasó y se le
    // vuelve a ofrecer la pantalla de horas, ya sin el turno que se perdió.
    const aviso = resultado.motivo === 'limite' ? T.limiteDiario : T.horarioTomado;
    await enviar(construir.texto(telefono, aviso), barberia);

    if (resultado.motivo === 'limite') {
      await sesiones.borrar(telefono, barberia.id);
      return { tipo: 'menu' };
    }

    const libres = await horarios.turnosLibres(datos.barberoId, datos.fecha, barberia.zona_horaria);
    await mostrarHoras(telefono, barberia, datos, libres, datos.jornada ?? null);
    return { tipo: 'manejado' };
  }

  await sesiones.borrar(telefono, barberia.id);

  await enviar(construir.texto(telefono, T.turnoConfirmado({
    nombre: datos.nombre,
    barbero: datos.barbero,
    fecha: fechaVisible(datos.fecha),
    hora: horaVisible(hora),
    barberia,
  })), barberia);

  return { tipo: 'manejado', turno: resultado.turno, avisarBarbero: datos.barberoId };
}

export { P as PREFIJOS };
