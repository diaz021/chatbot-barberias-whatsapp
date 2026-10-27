/**
 * DESPACHAR — normaliza lo que llega de Meta y se lo pasa al motor
 *
 * Meta manda una forma distinta por cada tipo de mensaje. El resto del
 * sistema no debería tener que saber eso: aquí todo se reduce a
 * { clase, texto, idOpcion }.
 */

import { manejar } from '../motor/index.js';

/**
 * Devuelve siempre { clase, texto, idOpcion }:
 *   clase 'texto'   → el cliente escribió
 *   clase 'opcion'  → tocó un botón o una fila de lista (idOpcion es la llave)
 *   clase 'ignorar' → reacciones y avisos de sistema: no se responden
 *   clase 'otro'    → audio, imagen, sticker… se responde que solo leemos texto
 */
export function normalizar(mensaje) {
  switch (mensaje.type) {
    case 'text':
      return { clase: 'texto', texto: mensaje.text?.body?.trim() ?? '', idOpcion: null };

    case 'interactive': {
      const i = mensaje.interactive;
      // Los botones y las listas guardan el id en sitios distintos.
      const id = i?.button_reply?.id ?? i?.list_reply?.id ?? null;
      const titulo = i?.button_reply?.title ?? i?.list_reply?.title ?? '';
      return { clase: id ? 'opcion' : 'otro', texto: titulo, idOpcion: id };
    }

    // Los botones de plantilla llegan como 'button', no como 'interactive'.
    case 'button':
      return { clase: 'texto', texto: mensaje.button?.text?.trim() ?? '', idOpcion: null };

    // Reacciones y avisos de sistema se ignoran a propósito: responderlos
    // confunde al cliente, que no escribió nada.
    case 'reaction':
    case 'system':
      return { clase: 'ignorar', texto: '', idOpcion: null };

    default:
      // audio · image · sticker · document · location · video · contacts
      return { clase: 'otro', texto: '', idOpcion: null };
  }
}

/**
 * ⚠️ `de` llega YA RESUELTO desde rutas.js, no se lee aquí de `mensaje.from`.
 * Ese campo viene vacío en una parte de los mensajes y hubo que añadirle un
 * respaldo; la decisión vive en un solo sitio para que no se vuelva a
 * duplicar. Ver `remitente.js`.
 */
export async function despachar({ mensaje, barberia, nombrePerfil, de }) {
  const { clase, texto, idOpcion } = normalizar(mensaje);

  if (clase === 'ignorar') return;

  if (!de) {
    // No debería llegar aquí: rutas.js filtra antes. Es un cinturón por si
    // alguien llama a despachar() desde otro sitio en el futuro.
    console.error('✗ despachar() sin remitente — no se responde');
    return;
  }

  console.log(
    `→ [${barberia.nombre}] ${de} · ${clase}` +
    (idOpcion ? ` · id=${idOpcion}` : '') +
    (texto ? ` · "${texto.slice(0, 60)}"` : '')
  );

  await manejar({ de, clase, texto, idOpcion, barberia, nombrePerfil });
}
