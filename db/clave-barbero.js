/**
 * CONTRASEÑAS DEL PANEL
 *
 *   npm run clave -- --listar
 *   npm run clave -- "Andrés" "#andres01"             barbero
 *   npm run clave -- "Andrés"                        se genera una
 *   npm run clave -- --admin "573001234567" "clave"  administrador global
 *
 * ⚠️ UNA SOLA CONTRASEÑA POR PERSONA, para los dos paneles:
 *
 *   · el panel web    → agenda/bloqueos/horarios, desde el navegador
 *   · el panel por WhatsApp → ver la agenda del día escribiéndola al bot
 *
 * Dos credenciales para la misma persona se olvidan, se desincronizan y no
 * aportan nada. La del barbero vive en `barberos.password_hash`; el login
 * del panel web la busca ahí cuando el admin tiene alcance de barbero.
 *
 * ⚠️ La contraseña se muestra UNA vez, al crearla. Después solo queda su
 * hash y no hay forma de recuperarla: si se pierde, se genera otra.
 */

import 'dotenv/config';
import { consultar, consultarUna, cerrarPool } from '../src/db/pool.js';
import { hashear, generar } from '../src/servicios/claves.js';

const args = process.argv.slice(2);

function mostrar(quien, donde, clave) {
  console.log(`\n✓ Contraseña de ${quien} (${donde})\n`);
  console.log('    ┌──────────────────────────────┐');
  console.log(`    │  ${clave.padEnd(26)}  │`);
  console.log('    └──────────────────────────────┘\n');
  console.log('  Sirve para el panel web Y para ver la agenda por WhatsApp.');
  console.log('  No se vuelve a mostrar.\n');
}

async function listar() {
  const filas = await consultar(
    `SELECT ba.nombre AS barberia, b.nombre AS barbero, b.activo,
            b.telefono IS NOT NULL      AS tiene_telefono,
            b.password_hash IS NOT NULL AS tiene_clave,
            EXISTS (SELECT 1 FROM admins a WHERE a.barbero_id = b.id) AS entra_al_panel
       FROM barberos b
       JOIN barberias ba ON ba.id = b.barberia_id
      ORDER BY ba.nombre, b.orden`
  );

  console.log('\nBARBEROS\n');
  for (const f of filas) {
    console.log(
      `  ${f.activo ? '✓' : '○'} ${f.barbero.padEnd(16)} ${f.barberia.padEnd(24)} ` +
      `tel: ${f.tiene_telefono ? 'sí ' : 'NO '} ` +
      `clave: ${f.tiene_clave ? 'sí ' : 'NO '} ` +
      `panel web: ${f.entra_al_panel ? 'sí' : 'NO'}`
    );
  }

  const admins = await consultar(
    `SELECT a.nombre, a.telefono, a.barberia_id, a.barbero_id,
            a.password_hash IS NOT NULL AS tiene_clave
       FROM admins a ORDER BY a.barberia_id NULLS FIRST, a.nombre`
  );

  console.log('\nADMINISTRADORES\n');
  for (const a of admins) {
    const alcance = !a.barberia_id ? 'TODAS las barberías'
                  : a.barbero_id   ? 'solo su propia agenda'
                                   : 'toda su barbería';
    console.log(`  · ${a.nombre.padEnd(18)} ${a.telefono.padEnd(14)} ${alcance.padEnd(24)} ` +
                `clave: ${a.tiene_clave || a.barbero_id ? 'sí' : 'NO'}`);
  }
  console.log('');
}

/**
 * Le pone contraseña a un barbero y le da acceso al panel web, con alcance
 * limitado a su propia agenda: no puede ver ni bloquear la de sus compañeros.
 */
async function asignarBarbero(nombre, claveDada) {
  const barberos = await consultar(
    `SELECT b.id, b.nombre, b.telefono, b.barberia_id, ba.nombre AS barberia
       FROM barberos b JOIN barberias ba ON ba.id = b.barberia_id
      WHERE lower(b.nombre) = lower($1) AND b.activo`,
    [nombre]
  );

  if (barberos.length === 0) {
    console.error(`\n✗ No hay ningún barbero activo llamado "${nombre}".`);
    console.error('  Usa --listar para ver los nombres exactos.\n');
    process.exit(1);
  }

  // Con varias barberías puede haber dos barberos con el mismo nombre, y
  // cambiarle la clave al que no era sería un fallo silencioso.
  if (barberos.length > 1) {
    console.error(`\n✗ Hay ${barberos.length} barberos llamados "${nombre}":`);
    barberos.forEach(b => console.error(`    id ${b.id} — ${b.barberia}`));
    console.error('  Renómbralos o asigna la clave por id desde SQL.\n');
    process.exit(1);
  }

  const b = barberos[0];

  if (!b.telefono) {
    console.error(`\n✗ ${b.nombre} no tiene teléfono.`);
    console.error('  Sin él no puede entrar al panel ni recibir avisos.\n');
    process.exit(1);
  }

  const clave = claveDada || generar();
  await consultar('UPDATE barberos SET password_hash = $1 WHERE id = $2', [await hashear(clave), b.id]);

  // Acceso al panel web, limitado a su propia agenda.
  await consultar(
    `INSERT INTO admins (barberia_id, barbero_id, telefono, nombre)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (telefono, barberia_id) DO UPDATE
       SET barbero_id = EXCLUDED.barbero_id, nombre = EXCLUDED.nombre`,
    [b.barberia_id, b.id, b.telefono, b.nombre]
  );

  mostrar(b.nombre, b.barberia + ' · solo su agenda', clave);
}

/** Administrador global: ve y gestiona todas las barberías. */
async function asignarAdmin(telefono, claveDada, nombre) {
  const tel = String(telefono).replace(/\D/g, '');
  const clave = claveDada || generar();
  const hash = await hashear(clave);

  const existe = await consultarUna(
    'SELECT id, nombre FROM admins WHERE telefono = $1 AND barberia_id IS NULL', [tel]
  );

  if (existe) {
    await consultar('UPDATE admins SET password_hash = $1 WHERE id = $2', [hash, existe.id]);
    mostrar(existe.nombre, 'TODAS las barberías', clave);
  } else {
    await consultar(
      'INSERT INTO admins (barberia_id, barbero_id, telefono, nombre, password_hash) VALUES (NULL, NULL, $1, $2, $3)',
      [tel, nombre ?? 'Administrador', hash]
    );
    mostrar(nombre ?? 'Administrador', 'TODAS las barberías', clave);
  }
}

try {
  if (args.length === 0 || args[0] === '--listar') {
    await listar();
  } else if (args[0] === '--admin') {
    await asignarAdmin(args[1], args[2], args[3]);
  } else {
    await asignarBarbero(args[0], args[1]);
  }
} finally {
  await cerrarPool();
}
