/**
 * ARMAR LOS MENSAJES DE META
 *
 * ⚠️ TODA lista del sistema pasa por `listaConNavegacion()`. No es un capricho
 * de organización: es la defensa contra el fallo más visible del bot.
 *
 * Si una lista se pasa de 10 filas, Meta RECHAZA EL MENSAJE ENTERO. El cliente
 * no recibe nada —ni la lista, ni un error, ni un aviso— y se queda mirando la
 * pantalla. Ya pasó con las listas de cancelación cuando alguien tenía 10 o más
 * turnos: se perdían las filas de navegación y quedaba atrapado.
 *
 * Topes de Meta, todos comprobados aquí:
 *   · 10 filas por lista            · título de fila 24 caracteres
 *   · descripción de fila 72        · título de sección 24
 *   · texto de botón 20             · cuerpo 1024
 *   · 3 botones por mensaje
 */

export const TOPES = {
  FILAS: 10,
  TITULO_FILA: 24,
  DESCRIPCION_FILA: 72,
  TITULO_SECCION: 24,
  TEXTO_BOTON: 20,
  CUERPO: 1024,
  BOTONES: 3,
};

/** Corta sin partir el texto a la mitad de una palabra cuando se puede. */
function recortar(texto, maximo) {
  const t = String(texto ?? '').trim();
  if (t.length <= maximo) return t;

  const cortado = t.slice(0, maximo - 1);
  const espacio = cortado.lastIndexOf(' ');
  return (espacio > maximo * 0.6 ? cortado.slice(0, espacio) : cortado) + '…';
}

export function texto(para, cuerpo) {
  return {
    messaging_product: 'whatsapp',
    to: para,
    type: 'text',
    text: { body: recortar(cuerpo, TOPES.CUERPO), preview_url: false },
  };
}

export function botones(para, cuerpo, opciones, pie = null) {
  if (opciones.length > TOPES.BOTONES) {
    console.warn(`⚠ ${opciones.length} botones pedidos, Meta admite ${TOPES.BOTONES}. Se recortó.`);
  }

  return {
    messaging_product: 'whatsapp',
    to: para,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: recortar(cuerpo, TOPES.CUERPO) },
      ...(pie ? { footer: { text: recortar(pie, 60) } } : {}),
      action: {
        buttons: opciones.slice(0, TOPES.BOTONES).map(o => ({
          type: 'reply',
          reply: { id: o.id, title: recortar(o.titulo, TOPES.TEXTO_BOTON) },
        })),
      },
    },
  };
}

export function ubicacion(para, { latitud, longitud, nombre, direccion }) {
  return {
    messaging_product: 'whatsapp',
    to: para,
    type: 'location',
    location: {
      latitude: Number(latitud),
      longitude: Number(longitud),
      name: nombre,
      address: direccion,
    },
  };
}

/**
 * Arma una lista con sus filas de navegación, garantizando el tope de 10.
 *
 * `secciones` es [{ titulo, filas: [{ id, titulo, descripcion }] }].
 * `navegacion` es [{ id, titulo, descripcion }] — normalmente Volver y Menú.
 *
 * Si no cabe todo, se sacrifica navegación EMPEZANDO POR EL FINAL (primero
 * "Menú principal", después "Volver") y se deja aviso en el log. Nunca se
 * recortan las opciones reales: perder una hora disponible es peor que perder
 * un atajo que el cliente también puede escribir.
 *
 * La numeración CORRE SEGUIDA entre secciones. Si se reiniciara en cada una,
 * el cliente que escribe "3" no elegiría lo que ve en la pantalla como 3.
 */
export function listaConNavegacion(para, {
  cuerpo,
  textoBoton = 'Ver opciones',
  encabezado = null,
  pie = null,
  secciones = [],
  navegacion = [],
}) {
  const reales = secciones.reduce((n, s) => n + s.filas.length, 0);
  let nav = [...navegacion];

  while (reales + nav.length > TOPES.FILAS && nav.length > 0) {
    const quitada = nav.pop();
    console.warn(
      `⚠ Lista de ${reales} opciones: no cabe "${quitada.titulo}". ` +
      `El cliente todavía puede escribir "menu" o "volver".`
    );
  }

  if (reales > TOPES.FILAS) {
    // No debería ocurrir: quien llama reparte en jornadas antes. Si pasa,
    // es preferible una lista recortada a un mensaje que Meta tira entero.
    console.error(`✗ ${reales} opciones exceden el tope de ${TOPES.FILAS}. Se recortaron.`);
  }

  let numero = 0;
  const seccionesMeta = [];
  let restantes = TOPES.FILAS - nav.length;

  for (const seccion of secciones) {
    if (restantes <= 0) break;

    const filas = seccion.filas.slice(0, restantes).map(f => {
      numero++;
      return {
        id: f.id,
        title: recortar(`${numero}. ${f.titulo}`, TOPES.TITULO_FILA),
        ...(f.descripcion ? { description: recortar(f.descripcion, TOPES.DESCRIPCION_FILA) } : {}),
      };
    });

    restantes -= filas.length;
    if (filas.length) {
      seccionesMeta.push({ title: recortar(seccion.titulo, TOPES.TITULO_SECCION), rows: filas });
    }
  }

  if (nav.length) {
    seccionesMeta.push({
      title: 'MÁS OPCIONES',
      rows: nav.map(f => {
        numero++;
        return {
          id: f.id,
          title: recortar(`${numero}. ${f.titulo}`, TOPES.TITULO_FILA),
          ...(f.descripcion ? { description: recortar(f.descripcion, TOPES.DESCRIPCION_FILA) } : {}),
        };
      }),
    });
  }

  return {
    mensaje: {
      messaging_product: 'whatsapp',
      to: para,
      type: 'interactive',
      interactive: {
        type: 'list',
        ...(encabezado ? { header: { type: 'text', text: recortar(encabezado, 60) } } : {}),
        body: { text: recortar(cuerpo, TOPES.CUERPO) },
        ...(pie ? { footer: { text: recortar(pie, 60) } } : {}),
        action: { button: recortar(textoBoton, TOPES.TEXTO_BOTON), sections: seccionesMeta },
      },
    },
    // El motor necesita saber qué número quedó asignado a cada id, para
    // entender al cliente que responde escribiendo "3" en vez de tocar.
    numeracion: seccionesMeta.flatMap(s =>
      s.rows.map(r => ({ numero: Number(r.title.split('.')[0]), id: r.id }))
    ),
  };
}

/** Cuenta las filas de un mensaje de lista ya armado. Para las pruebas. */
export function contarFilas(mensaje) {
  return (mensaje.interactive?.action?.sections ?? [])
    .reduce((n, s) => n + s.rows.length, 0);
}
