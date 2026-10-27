/**
 * POOL DE CONEXIONES
 *
 * Un único pool para todo el proceso. Abrir una conexión por consulta contra
 * un pooler de Supabase agota el cupo enseguida.
 *
 * ⚠️ Ningún error de aquí debe llegar al usuario con la cadena de conexión
 * dentro: lleva la contraseña. `limpiar()` la borra de cualquier mensaje
 * antes de que se imprima o se propague.
 */

import pg from 'pg';
import { env } from '../config/env.js';

/** Borra cualquier cadena de conexión que se haya colado en un texto. */
export function limpiar(texto) {
  return String(texto ?? '').replace(/postgres(?:ql)?:\/\/[^\s'"]+/gi, '[conexión oculta]');
}

/**
 * Postgres devuelve DATE como objeto Date, convertido a la zona del servidor.
 * Railway corre en UTC, así que un turno del 15 se podía leer como el 14.
 * Es exactamente el error de zona horaria del sistema anterior, pero entrando
 * por otro lado. Aquí las fechas se leen como texto plano 'YYYY-MM-DD' y las
 * horas como 'HH:MM:SS', y se interpretan siempre en la zona del negocio.
 */
pg.types.setTypeParser(1082, v => v);   // DATE
pg.types.setTypeParser(1083, v => v);   // TIME
pg.types.setTypeParser(1266, v => v);   // TIMETZ

/**
 * TLS solo fuera de la máquina local. Supabase lo exige (con su certificado
 * gestionado); un Postgres en Docker para desarrollo no lo tiene, y forzarlo
 * da "The server does not support SSL connections".
 */
export const sslPara = (url) =>
  /@(localhost|127\.0\.0\.1)[:/]/.test(String(url ?? '')) ? false : { rejectUnauthorized: false };

export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  ssl: sslPara(env.DATABASE_URL),
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

// Sin este manejador, un corte de red en una conexión ociosa tumba el
// proceso entero con un error no capturado — y con él, el bot de todas
// las barberías a la vez.
pool.on('error', error => {
  console.error('✗ Error en una conexión ociosa del pool:', limpiar(error.message));
});

/** Atajo para consultas sueltas. Devuelve directamente las filas. */
export async function consultar(sql, parametros = []) {
  const { rows } = await pool.query(sql, parametros);
  return rows;
}

/** La primera fila, o null. Para los casos de "busca uno". */
export async function consultarUna(sql, parametros = []) {
  const filas = await consultar(sql, parametros);
  return filas[0] ?? null;
}

/**
 * Corre varias sentencias en una transacción. Si algo lanza, se deshace todo.
 * La conexión se libera siempre, pase lo que pase.
 */
export async function enTransaccion(trabajo) {
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    const resultado = await trabajo(cliente);
    await cliente.query('COMMIT');
    return resultado;
  } catch (error) {
    await cliente.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    cliente.release();
  }
}

/** Comprueba que la base responde. Se llama al arrancar. */
export async function verificarConexion() {
  const fila = await consultarUna('SELECT current_database() AS db');
  return fila.db;
}

export async function cerrarPool() {
  await pool.end();
}
