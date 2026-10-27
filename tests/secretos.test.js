/**
 * NINGÚN SECRETO DENTRO DEL CÓDIGO
 *
 * Heredado del sistema anterior, donde esta prueba ya existía y hacía falta:
 * las contraseñas de los barberos estuvieron escritas en el código hasta que
 * alguien las sacó, y esta prueba es lo que impide que vuelvan.
 *
 * Revisar a mano antes de cada commit funciona hasta el día que se olvida.
 * Como prueba, no se olvida.
 *
 * Si esto falla: el valor NO va en el código. Va en `.env` y se lee con
 * `env.js`. Si es de un barbero, va hasheado en la base (`npm run clave`).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');

const CARPETAS = ['src', 'db', 'tests'];
const SUELTOS = ['.env.example', 'package.json'];
const EXTENSIONES = ['.js', '.mjs', '.sql', '.json', '.md'];

/**
 * Textos que PARECEN secretos pero son marcadores de posición.
 * Si un valor real coincidiera con uno de estos, tendríamos otro problema.
 */
const MARCADORES = [
  'CONTRASENA', 'YOUR-PASSWORD', 'PEGA_AQUI', 'TU_', 'xxxx', 'XXXX',
  'CAMBIAME', 'ejemplo', 'EJEMPLO', 'abcdefghijk', 'PONER_AQUI',
];

const REGLAS = [
  {
    nombre: 'token de acceso de Meta',
    patron: /\bEAA[A-Za-z0-9_-]{30,}/g,
    ayuda: 'va en .env como API_TOKEN',
  },
  {
    nombre: 'cadena de conexión con contraseña',
    patron: /\bpostgres(?:ql)?:\/\/[A-Za-z0-9._%-]+:[^\s@'"`]{3,}@/g,
    ayuda: 'va en .env como DATABASE_URL',
  },
  {
    nombre: 'clave de API de Anthropic',
    patron: /\bsk-ant-[A-Za-z0-9-]{10,}/g,
    ayuda: 'va en .env como ANTHROPIC_API_KEY',
  },
  {
    nombre: 'App Secret de Meta',
    // 32 hex asignados a algo que se llama secret/secreto/app_secret.
    patron: /\b(?:app_?secret|secreto_?app|META_APP_SECRET)\b\s*[:=]\s*['"`][0-9a-f]{32}['"`]/gi,
    ayuda: 'va en .env como META_APP_SECRET',
  },
  {
    nombre: 'contraseña escrita en el código',
    patron: /\b(?:password|contrasena|contraseña|clave)\s*[:=]\s*['"`][^'"`\n]{8,}['"`]/gi,
    ayuda: 'las de barbero van hasheadas en la base — usa: npm run clave',
    // Las pruebas necesitan contraseñas de mentira para poder probar el
    // hasheo y el panel. Esas son datos de prueba, no credenciales.
    // Las demás reglas —tokens de Meta, cadenas de conexión, claves de
    // API— sí se aplican también aquí: eso nunca es un dato de prueba.
    omitirEn: /^tests\//,
  },
];

function archivos(dir, salida = []) {
  if (!existsSync(dir)) return salida;
  for (const nombre of readdirSync(dir)) {
    if (nombre === 'node_modules' || nombre === '.git') continue;
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) archivos(ruta, salida);
    else if (EXTENSIONES.some(e => nombre.endsWith(e))) salida.push(ruta);
  }
  return salida;
}

function revisar(ruta) {
  const contenido = readFileSync(ruta, 'utf8');
  const relativa = relative(RAIZ, ruta).replace(/\\/g, '/');
  const hallazgos = [];

  for (const regla of REGLAS) {
    if (regla.omitirEn?.test(relativa)) continue;

    for (const encontrado of contenido.matchAll(regla.patron)) {
      const texto = encontrado[0];

      // Marcadores de posición: no son secretos.
      if (MARCADORES.some(m => texto.includes(m))) continue;

      // Esta misma prueba contiene los patrones, por definición.
      if (relativa.includes('secretos.test.js')) continue;

      const linea = contenido.slice(0, encontrado.index).split('\n').length;
      hallazgos.push({
        archivo: relativa,
        linea,
        regla: regla.nombre,
        ayuda: regla.ayuda,
        // Solo los primeros caracteres: el mensaje de error NO puede
        // convertirse él mismo en una filtración del secreto.
        muestra: texto.slice(0, 12) + '…',
      });
    }
  }

  return hallazgos;
}

test('no hay secretos escritos en el código', () => {
  const revisables = [
    ...CARPETAS.flatMap(c => archivos(join(RAIZ, c))),
    ...SUELTOS.map(f => join(RAIZ, f)).filter(existsSync),
  ];

  assert.ok(revisables.length > 20, `solo se revisaron ${revisables.length} archivos: ¿ruta mal?`);

  const hallazgos = revisables.flatMap(revisar);

  if (hallazgos.length > 0) {
    const detalle = hallazgos
      .map(h => `\n  ${h.archivo}:${h.linea}\n    ${h.regla} → "${h.muestra}"\n    ${h.ayuda}`)
      .join('');
    assert.fail(`Se encontraron ${hallazgos.length} secreto(s) en el código:${detalle}\n`);
  }
});

test('.env está en .gitignore', () => {
  const ignorados = readFileSync(join(RAIZ, '.gitignore'), 'utf8')
    .split('\n').map(l => l.trim());

  for (const obligatorio of ['.env', 'node_modules/']) {
    assert.ok(ignorados.includes(obligatorio), `falta "${obligatorio}" en .gitignore`);
  }
});

test('git no está rastreando ningún archivo .env', () => {
  let rastreados;
  try {
    rastreados = execFileSync('git', ['ls-files'], { cwd: RAIZ, encoding: 'utf8' });
  } catch {
    return;   // sin repositorio todavía: nada que comprobar
  }

  const colados = rastreados.split('\n')
    .map(l => l.trim())
    .filter(l => l === '.env' || l.startsWith('.env.') && l !== '.env.example');

  assert.deepEqual(colados, [], `git está rastreando archivos con secretos: ${colados.join(', ')}`);
});

// ═══════════════════════════════════════════════════════════════════
//  Las pruebas no pueden tocar el mundo real
// ═══════════════════════════════════════════════════════════════════

test('la suite corre SIEMPRE en modo simulado', async () => {
  // Sin esto, la suite cambia de comportamiento según si hay un API_TOKEN
  // en .env: con token, las pruebas intentan enviar WhatsApps de verdad.
  // Pasó una vez. Esta prueba es para que no vuelva a pasar en silencio.
  const { simulado } = await import('../src/servicios/whatsapp.js');

  assert.equal(
    simulado.activo, true,
    'Las pruebas NO están simulando: podrían enviar mensajes reales.\n' +
    '    Córrelas con "npm test", que carga tests/preparar.mjs.'
  );
});
