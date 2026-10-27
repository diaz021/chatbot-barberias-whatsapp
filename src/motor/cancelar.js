/**
 * FLUJO DE CANCELAR
 *
 *   listar turnos → elegir → confirmar → resultado
 *
 * ⚠️ Aquí vive la corrección de §24.1, la falla más grave del bot anterior:
 * escribir "cancelar" dentro de este flujo respondía "✅ Proceso cancelado"
 * SIN cancelar el turno. El cliente leía el ✅, creía que había cancelado, y
 * no aparecía a su cita. Ver `intencion()` en mensajes/textos.js.
 */

import * as turnos from '../servicios/turnos.js';
import * as sesiones from '../servicios/sesiones.js';
import * as construir from '../mensajes/construir.js';
import { enviar } from '../servicios/whatsapp.js';
import { T } from '../mensajes/textos.js';
import { fechaVisible, fechaCorta, horaVisible } from '../config/fechas.js';
import { enviarLista, navegacionCompleta, resolverEleccion, valorDe } from './comun.js';

const P = { TURNO: 'cancelar_' };

export async function mostrarTurnos(telefono, barberia) {
  const lista = await turnos.proximosDelCliente(barberia.id, telefono);

  if (lista.length === 0) {
    await sesiones.borrar(telefono, barberia.id);
    await enviar(construir.texto(telefono, T.sinTurnos), barberia);
    return { tipo: 'menu' };
  }

  // ⚠️ §24.6 — con 10 o más turnos, la lista perdía las filas de navegación
  // y el cliente quedaba atrapado sin salida. `listaConNavegacion` ya impide
  // pasarse del tope, pero además se limita a 8 para que Volver y Menú
  // siempre quepan. Nadie tiene más de 8 turnos próximos en una barbería.
  const mostrables = lista.slice(0, 8);

  await enviarLista(telefono, barberia, {
    cuerpo: T.elegirTurnoACancelar,
    textoBoton: 'Elegir turno',
    secciones: [{
      titulo: 'TURNOS CONFIRMADOS',
      filas: mostrables.map(t => ({
        id: P.TURNO + t.id,
        titulo: `${fechaCorta(t.fecha)} · ${horaVisible(t.hora)}`,
        descripcion: `${fechaVisible(t.fecha)} · 💈 ${t.barbero}`,
      })),
    }],
    navegacion: navegacionCompleta,
  }, { paso: sesiones.PASOS.CANCELAR, datos: {} });

  return { tipo: 'manejado' };
}

export async function recibirTurno(telefono, barberia, sesion, { idOpcion, texto }) {
  const r = resolverEleccion({ idOpcion, texto, prefijo: P.TURNO, sesion });
  if (r.tipo !== 'opcion') return r;

  const turnoId = Number(valorDe(r.id, P.TURNO));

  // Se relee para confirmar que sigue activo y que es suyo. Entre que vio la
  // lista y tocó pueden haber pasado minutos.
  const turno = await turnos.porId(barberia.id, telefono, turnoId);

  if (!turno) {
    await enviar(construir.texto(telefono, T.turnoYaNoActivo), barberia);
    return mostrarTurnos(telefono, barberia);
  }

  await sesiones.guardar(telefono, barberia.id, sesiones.PASOS.CONFIRMAR, { turnoId });

  await enviar(construir.botones(
    telefono,
    T.confirmarCancelacion({
      barbero: turno.barbero,
      fecha: fechaVisible(turno.fecha),
      hora: horaVisible(turno.hora),
    }),
    [
      { id: 'confirmar_si', titulo: 'Sí, cancelar' },
      { id: 'confirmar_no', titulo: 'No, dejarlo' },
      { id: 'nav_volver',   titulo: 'Volver' },
    ]
  ), barberia);

  return { tipo: 'manejado' };
}

export async function recibirConfirmacion(telefono, barberia, sesion, { idOpcion, intencion }) {
  // Se acepta el botón, el número (via numeración) y la palabra escrita.
  // §24.2: "si", "sí", "ok" y "dale" funcionan igual que tocar el botón.
  const dijoSi = idOpcion === 'confirmar_si' || intencion === 'confirmar_si';
  const dijoNo = idOpcion === 'confirmar_no' || intencion === 'confirmar_no';

  if (!dijoSi && !dijoNo) return { tipo: 'nada' };

  if (dijoNo) {
    await sesiones.borrar(telefono, barberia.id);
    await enviar(construir.texto(telefono, T.cancelacionAbortada), barberia);
    return { tipo: 'menu' };
  }

  const cancelado = await turnos.cancelar(barberia.id, telefono, sesion.datos.turnoId);
  await sesiones.borrar(telefono, barberia.id);

  if (!cancelado) {
    await enviar(construir.texto(telefono, T.turnoYaNoActivo), barberia);
    return { tipo: 'menu' };
  }

  await enviar(construir.texto(telefono, T.turnoCancelado({
    barbero: cancelado.barbero,
    fecha: fechaVisible(cancelado.fecha),
    hora: horaVisible(cancelado.hora),
  })), barberia);

  // ⚠️ §24.4 — al barbero NO se le avisaba de las cancelaciones en el sistema
  // anterior: solo se enteraba si abría su agenda, y podía quedarse esperando
  // a un cliente que ya no venía. Se devuelve para que el motor lo notifique.
  return { tipo: 'manejado', cancelado };
}

export { P as PREFIJOS };
