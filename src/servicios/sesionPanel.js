/**
 * SESIÓN DEL PANEL — cookie firmada
 *
 * Sin librería de sesiones ni almacén: la cookie lleva los datos y una firma
 * HMAC. El servidor no guarda nada, así que reiniciar no cierra sesiones.
 *
 * ⚠️ Firmada, NO cifrada. El contenido se puede leer (teléfono, nombre, a qué
 * barbería pertenece); lo que no se puede es modificarlo sin el secreto. Por
 * eso aquí no va nada que deba permanecer oculto.
 *
 * ⚠️ Sin SESION_SECRETO se genera uno al azar al arrancar: el panel funciona,
 * pero cada despliegue cierra todas las sesiones. Se avisa al arrancar.
 */

import crypto from 'node:crypto';
import { env } from '../config/env.js';

export const NOMBRE_COOKIE = 'sesion';
export const DURACION_DIAS = 30;

const SECRETO = env.SESION_SECRETO || crypto.randomBytes(32).toString('hex');

const base64url = (buf) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const desdeBase64url = (texto) =>
  Buffer.from(String(texto).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

const firmar = (carga) =>
  base64url(crypto.createHmac('sha256', SECRETO).update(carga).digest());

/**
 * Empaqueta y firma. Devuelve el valor de la cookie.
 *
 * `duracionDias` existe para poder fabricar en las pruebas una cookie ya
 * vencida pero CORRECTAMENTE FIRMADA: sin eso no se puede distinguir si el
 * rechazo vino del vencimiento o de la firma, que es justo lo que hay que
 * comprobar.
 */
export function crear({ telefono, nombre, barberiaId, barberoId, duracionDias = DURACION_DIAS }) {
  const datos = {
    telefono,
    nombre,
    barberiaId: barberiaId ?? null,   // null = administrador global
    barberoId: barberoId ?? null,     // null = ve toda su barbería
    vence: Date.now() + duracionDias * 86400_000,
  };

  const carga = base64url(JSON.stringify(datos));
  return `${carga}.${firmar(carga)}`;
}

/**
 * Verifica y devuelve los datos, o null.
 *
 * La comparación de firmas es de tiempo constante: con `===`, quien pruebe
 * firmas puede deducirlas byte a byte midiendo cuánto tarda en fallar.
 */
export function leer(cookie) {
  if (!cookie || typeof cookie !== 'string') return null;

  const punto = cookie.lastIndexOf('.');
  if (punto < 1) return null;

  const carga = cookie.slice(0, punto);
  const firmaRecibida = cookie.slice(punto + 1);

  const esperada = Buffer.from(firmar(carga));
  const recibida = Buffer.from(firmaRecibida);

  if (esperada.length !== recibida.length) return null;
  if (!crypto.timingSafeEqual(esperada, recibida)) return null;

  try {
    const datos = JSON.parse(desdeBase64url(carga).toString('utf8'));
    if (!datos.vence || datos.vence < Date.now()) return null;
    return datos;
  } catch {
    return null;
  }
}

/** La cabecera Set-Cookie, con las tres protecciones puestas. */
export function cabecera(valor, { borrar = false } = {}) {
  const partes = [
    `${NOMBRE_COOKIE}=${borrar ? '' : valor}`,
    'Path=/',
    // HttpOnly: ningún script de la página puede leerla, así que un XSS no
    // se lleva la sesión. SameSite=Lax: no viaja en peticiones que vengan de
    // otro sitio, lo que corta el CSRF. Secure: solo por HTTPS.
    'HttpOnly',
    'SameSite=Lax',
    'Secure',
    borrar ? 'Max-Age=0' : `Max-Age=${DURACION_DIAS * 86400}`,
  ];
  return partes.join('; ');
}

/** Lee la cookie de sesión de la cabecera Cookie, sin dependencias. */
export function deLaPeticion(req) {
  const crudo = req.headers?.cookie;
  if (!crudo) return null;

  for (const par of crudo.split(';')) {
    const i = par.indexOf('=');
    if (i < 0) continue;
    if (par.slice(0, i).trim() === NOMBRE_COOKIE) {
      return leer(decodeURIComponent(par.slice(i + 1).trim()));
    }
  }
  return null;
}

/**
 * Middleware: deja `req.sesion` puesto, o corta con 401.
 *
 * Devuelve JSON y no una redirección porque lo consume la API del panel; la
 * página se encarga de llevar al login cuando ve un 401.
 */
export function requiereSesion(req, res, siguiente) {
  const sesion = deLaPeticion(req);

  if (!sesion) {
    return res.status(401).json({ error: 'sin sesión' });
  }

  req.sesion = sesion;
  siguiente();
}
