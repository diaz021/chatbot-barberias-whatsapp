/**
 * AYUDANTES DEL MOTOR
 *
 * Lo que comparten todos los pasos: enviar listas recordando su numeración, y
 * entender qué eligió el cliente tanto si tocó como si escribió.
 */

import * as construir from '../mensajes/construir.js';
import * as sesiones from '../servicios/sesiones.js';
import { enviar } from '../servicios/whatsapp.js';
import { NAV, numeroEscrito, esIdDeNavegacion, idEsDe } from '../mensajes/textos.js';

/**
 * Envía una lista y GUARDA en la sesión qué número quedó asignado a cada id.
 *
 * Sin esto, el cliente que responde escribiendo "3" en vez de tocar la fila
 * no puede ser entendido: el número que ve en pantalla depende de cuántas
 * filas se hayan mostrado y de si la navegación cupo o no.
 */
export async function enviarLista(telefono, barberia, opciones, { paso, datos = {} } = {}) {
  const { mensaje, numeracion } = construir.listaConNavegacion(telefono, opciones);

  if (paso) {
    await sesiones.guardar(telefono, barberia.id, paso, { ...datos, numeracion });
  }

  return enviar(mensaje, barberia);
}

/** Las dos filas de navegación de siempre. */
export const navegacionCompleta = [NAV.VOLVER, NAV.MENU];

/**
 * Traduce lo que respondió el cliente a un id de opción.
 *
 * Devuelve:
 *   { tipo: 'opcion', id }     eligió algo de esta pantalla
 *   { tipo: 'navegacion', id } volver o menú
 *   { tipo: 'vieja' }          tocó un botón de un menú anterior
 *   { tipo: 'nada' }           no se entendió
 *
 * ⚠️ El caso 'vieja' es el que justifica que todos los ids lleven prefijo.
 * Sin él, tocar un botón viejo del historial descuadra el flujo en silencio:
 * el cliente está en el paso de la hora y el bot interpreta su toque como si
 * fuera la respuesta de esa pantalla.
 */
export function resolverEleccion({ idOpcion, texto, prefijo, sesion }) {
  if (idOpcion) {
    if (esIdDeNavegacion(idOpcion)) return { tipo: 'navegacion', id: idOpcion };
    if (idEsDe(idOpcion, prefijo))  return { tipo: 'opcion', id: idOpcion };
    return { tipo: 'vieja' };
  }

  const numero = numeroEscrito(texto);
  if (numero !== null) {
    const encontrado = (sesion?.datos?.numeracion ?? []).find(n => n.numero === numero);
    if (encontrado) {
      return esIdDeNavegacion(encontrado.id)
        ? { tipo: 'navegacion', id: encontrado.id }
        : { tipo: 'opcion', id: encontrado.id };
    }
  }

  return { tipo: 'nada' };
}

/** Quita el prefijo de un id: 'barbero_7' → '7'. */
export const valorDe = (id, prefijo) => String(id).slice(prefijo.length);
