/**
 * CONTRASEÑAS DE LOS BARBEROS
 *
 * En el sistema anterior cada barbero tenía su variable de entorno
 * (`PASSWORD_BARBERO1`, `PASSWORD_BARBERO2`…). Con una sola barbería funcionaba;
 * con cinco barberías y tres o cuatro barberos cada una serían veinte
 * variables que hay que recordar, y un despliegue nuevo por cada barbero que
 * entra o sale. No escala.
 *
 * Ahora van en la base, HASHEADAS. Nunca se guarda la contraseña en claro,
 * ni siquiera cifrada de forma reversible: si alguien llegara a leer la
 * tabla, no obtiene las contraseñas.
 *
 * Se usa scrypt, que viene en Node y está diseñado para ser lento a
 * propósito: hace inviable probar millones de combinaciones.
 */

import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);

const LARGO_SAL = 16;
const LARGO_CLAVE = 64;

/** Devuelve 'scrypt$<sal>$<hash>', listo para guardar en password_hash. */
export async function hashear(clave) {
  const sal = crypto.randomBytes(LARGO_SAL);
  const derivada = await scrypt(String(clave), sal, LARGO_CLAVE);
  return `scrypt$${sal.toString('hex')}$${derivada.toString('hex')}`;
}

/**
 * ¿Coincide la contraseña con lo guardado?
 *
 * La comparación es de tiempo constante: comparar con `===` filtra, por lo
 * que tarda en fallar, cuántos caracteres iniciales acertó quien prueba.
 */
export async function verificar(clave, guardado) {
  if (!clave || !guardado) return false;

  const partes = String(guardado).split('$');
  if (partes.length !== 3 || partes[0] !== 'scrypt') return false;

  const [, salHex, hashHex] = partes;

  try {
    const esperado = Buffer.from(hashHex, 'hex');
    const derivada = await scrypt(String(clave), Buffer.from(salHex, 'hex'), esperado.length);
    return crypto.timingSafeEqual(derivada, esperado);
  } catch {
    return false;
  }
}

/** Una contraseña legible pero difícil de adivinar, para dársela al barbero. */
export function generar() {
  // Sin caracteres que se confundan al dictarlos por teléfono: O/0, l/I/1.
  const letras = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  return Array.from(crypto.randomBytes(10))
    .map(b => letras[b % letras.length])
    .join('');
}
