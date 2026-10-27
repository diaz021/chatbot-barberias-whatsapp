/**
 * ACCESO AL PANEL — teléfono y contraseña
 *
 * ⚠️ POR QUÉ NO ES UN CÓDIGO POR WHATSAPP
 *
 * La primera versión mandaba un código de 6 dígitos al WhatsApp del
 * administrador. Falló en el uso real por una razón que no se ve al
 * construirlo: el código salía como MENSAJE LIBRE, y Meta solo entrega esos
 * dentro de la ventana de 24 horas que abre el propio usuario al escribir.
 *
 * Si el barbero no le había escrito al bot ese día, el código no llegaba
 * — justo cuando más falta hace entrar al panel. Y como la pantalla responde
 * lo mismo exista o no el número, el fallo era mudo.
 *
 * Se podría arreglar con una plantilla de autenticación, que sí se entrega
 * siempre. Pero esas se cobran por envío y hay que pedirle aprobación a Meta.
 * Para tres personas, una contraseña es más simple y no depende de nadie.
 *
 * ⚠️ LO QUE SE CONSERVA de la versión anterior es el freno de intentos, que
 * ahora importa más: una contraseña sí se puede adivinar a fuerza bruta.
 */

import { consultar, consultarUna } from '../db/pool.js';
import { verificar } from './claves.js';

export const MAX_INTENTOS = 5;
export const VENTANA_MINUTOS = 10;

/** Código de país que se asume cuando alguien escribe su número local. */
export const PAIS_POR_DEFECTO = '57';

/** Solo dígitos. '+57 300 123 4567' → '573001234567' */
export function normalizarTelefono(texto) {
  return String(texto ?? '').replace(/\D/g, '');
}

/**
 * Las formas en que ese mismo número puede estar guardado.
 *
 * La gente escribe su número como lo marca ("3001234567"); en la base está
 * en el formato de Meta, con código de país ("573001234567"). Se prueban las
 * dos en vez de obligar a acordarse del formato.
 */
export function variantes(telefono) {
  const d = normalizarTelefono(telefono);
  if (!d) return [];

  const formas = new Set([d]);
  if (d.length === 10) formas.add(PAIS_POR_DEFECTO + d);
  if (d.startsWith(PAIS_POR_DEFECTO) && d.length > 10) formas.add(d.slice(PAIS_POR_DEFECTO.length));

  return [...formas];
}

// ═══════════════════════════════════════════════════════════════════
//  Freno de intentos
// ═══════════════════════════════════════════════════════════════════

/**
 * Se cuenta contra la forma MÁS LARGA del número. Si se usara la escrita,
 * alternar entre "3001234567" y "573001234567" daría dos contadores y se
 * saltaría el límite.
 */
const canonica = (formas) => formas.reduce((a, b) => (b.length > a.length ? b : a), '');

async function intentosRecientes(clave) {
  const fila = await consultarUna(
    `SELECT COUNT(*)::int AS n FROM solicitudes_codigo
      WHERE clave = $1 AND creada_en > now() - ($2 || ' minutes')::interval`,
    [clave, VENTANA_MINUTOS]
  );
  return fila.n;
}

async function anotarIntento(clave) {
  await consultar('INSERT INTO solicitudes_codigo (clave) VALUES ($1)', [clave]);
}

async function limpiarIntentos(clave) {
  await consultar('DELETE FROM solicitudes_codigo WHERE clave = $1', [clave]);
}

// ═══════════════════════════════════════════════════════════════════
//  Entrar
// ═══════════════════════════════════════════════════════════════════

/**
 * Comprueba teléfono y contraseña.
 *
 * Devuelve { ok, frenado, admin }.
 *
 * ⚠️ La contraseña de un barbero vive en `barberos.password_hash`, no en
 * `admins`: así UNA sola contraseña sirve para el panel web y para el panel
 * por WhatsApp. Dos credenciales para la misma persona se olvidan, se
 * desincronizan y no aportan nada.
 */
export async function entrar(telefonoCrudo, contrasena, huellaDispositivo) {
  const formas = variantes(telefonoCrudo);
  const claves = [`tel:${canonica(formas)}`, `disp:${huellaDispositivo}`];

  for (const clave of claves) {
    if (await intentosRecientes(clave) >= MAX_INTENTOS) {
      return { ok: false, frenado: true };
    }
  }

  if (!formas.length || !contrasena) {
    for (const c of claves) await anotarIntento(c);
    return { ok: false, frenado: false };
  }

  const admin = await consultarUna(
    `SELECT a.telefono, a.nombre, a.barberia_id, a.barbero_id,
            COALESCE(a.password_hash, b.password_hash) AS hash
       FROM admins a
       LEFT JOIN barberos b ON b.id = a.barbero_id
      WHERE a.telefono = ANY($1)
      LIMIT 1`,
    [formas]
  );

  // Se anota el intento ANTES de responder, exista o no el administrador:
  // así el freno protege igual contra quien prueba números al azar.
  for (const c of claves) await anotarIntento(c);

  if (!admin?.hash) return { ok: false, frenado: false };
  if (!await verificar(contrasena, admin.hash)) return { ok: false, frenado: false };

  // Entró: se limpia su contador para que un olvido de ayer no lo frene hoy.
  await limpiarIntentos(claves[0]);

  return {
    ok: true,
    frenado: false,
    admin: {
      telefono: admin.telefono,
      nombre: admin.nombre,
      barberiaId: admin.barberia_id,
      barberoId: admin.barbero_id,
    },
  };
}

/** Limpieza de lo que ya no sirve. La llama la purga periódica. */
export async function purgar() {
  await consultar(`DELETE FROM solicitudes_codigo WHERE creada_en < now() - INTERVAL '1 hour'`);
  await consultar(`DELETE FROM codigos_acceso WHERE creado_en < now() - INTERVAL '1 hour'`);
}
