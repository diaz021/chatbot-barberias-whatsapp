/**
 * EJECUTOR DE MIGRACIONES
 *
 *   npm run migrar
 *
 * Corre en orden todos los .sql de esta carpeta que empiecen por número, y
 * lleva registro en la tabla `migraciones` para no repetir ninguno. Volver a
 * ejecutarlo cuando no hay nada nuevo no hace nada.
 *
 * Cada archivo corre dentro de una TRANSACCIÓN: si una sentencia falla, se
 * deshace el archivo entero. Nunca queda una migración a medias.
 *
 * ⚠️ Este archivo jamás imprime DATABASE_URL ni parte de ella. La cadena
 * lleva la contraseña dentro y los errores de `pg` a veces la arrastran, así
 * que todo mensaje de error pasa por `limpiar()` antes de mostrarse.
 */

import 'dotenv/config';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const AQUI = dirname(fileURLToPath(import.meta.url));

/** Quita cualquier cadena de conexión que se haya colado en un mensaje. */
function limpiar(texto) {
  return String(texto ?? '').replace(/postgres(?:ql)?:\/\/[^\s'"]+/gi, '[conexión oculta]');
}

async function main() {
  const url = process.env.DATABASE_URL;

  if (!url || !url.trim()) {
    console.error('\n✗ Falta DATABASE_URL en el archivo .env\n');
    console.error('  Supabase → Connect → Connection String → Session pooler');
    console.error('  Acuérdate de reemplazar [YOUR-PASSWORD] por tu contraseña.\n');
    process.exit(1);
  }

  if (url.includes('[YOUR-PASSWORD]') || url.includes('CONTRASENA')) {
    console.error('\n✗ DATABASE_URL todavía tiene el marcador de la contraseña.');
    console.error('  Reemplaza [YOUR-PASSWORD] por tu contraseña real (sin corchetes).\n');
    process.exit(1);
  }

  // Supabase exige TLS. `rejectUnauthorized: false` acepta su certificado
  // gestionado, que es lo que recomienda su propia documentación.
  const cliente = new pg.Client({
    connectionString: url,
    ssl: /@(localhost|127\.0\.0\.1)[:/]/.test(url) ? false : { rejectUnauthorized: false },
    connectionTimeoutMillis: 20000,
  });

  try {
    await cliente.connect();
  } catch (error) {
    console.error('\n✗ No se pudo conectar a la base de datos.');
    console.error(' ', limpiar(error.message));
    console.error('\n  Revisa que la contraseña sea la correcta y que el');
    console.error('  proyecto de Supabase no esté pausado.\n');
    process.exit(1);
  }

  const { rows: [{ db, usuario }] } = await cliente.query(
    'SELECT current_database() AS db, current_user AS usuario'
  );
  console.log(`\n● Conectado a "${db}" como "${usuario}"\n`);

  await cliente.query(`
    CREATE TABLE IF NOT EXISTS migraciones (
      archivo    TEXT        PRIMARY KEY,
      aplicada_en TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const { rows } = await cliente.query('SELECT archivo FROM migraciones');
  const yaAplicadas = new Set(rows.map(r => r.archivo));

  const archivos = (await readdir(AQUI))
    .filter(n => n.endsWith('.sql') && /^\d/.test(n))
    .sort();

  if (archivos.length === 0) {
    console.log('  No hay archivos .sql en db/\n');
    await cliente.end();
    return;
  }

  let aplicadas = 0;

  for (const archivo of archivos) {
    if (yaAplicadas.has(archivo)) {
      console.log(`  ○ ${archivo}  — ya estaba aplicada`);
      continue;
    }

    const sql = await readFile(join(AQUI, archivo), 'utf8');

    try {
      await cliente.query('BEGIN');
      await cliente.query(sql);
      await cliente.query(
        'INSERT INTO migraciones (archivo) VALUES ($1)',
        [archivo]
      );
      await cliente.query('COMMIT');

      console.log(`  ✓ ${archivo}`);
      aplicadas++;
    } catch (error) {
      await cliente.query('ROLLBACK').catch(() => {});
      console.error(`\n  ✗ ${archivo} falló. No se aplicó nada de ese archivo.\n`);
      console.error('   ', limpiar(error.message));
      if (error.hint)     console.error('    pista:', limpiar(error.hint));
      if (error.position) console.error('    posición en el archivo:', error.position);
      console.error('');
      await cliente.end();
      process.exit(1);
    }
  }

  console.log(
    aplicadas > 0
      ? `\n● Listo. ${aplicadas} migración(es) aplicada(s).\n`
      : '\n● Todo estaba al día. Nada que hacer.\n'
  );

  await cliente.end();
}

main().catch(error => {
  console.error('\n✗ Error inesperado:', limpiar(error.message), '\n');
  process.exit(1);
});
