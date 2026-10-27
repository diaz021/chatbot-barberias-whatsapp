/**
 * LA TRABA DE LAS TAREAS DE FONDO
 *
 * El barrido de recordatorios NO es de solo lectura: marca
 * `recordatorio_enviado = TRUE` cuando el envío sale bien, y en modo simulado
 * "sale bien" siempre. Dos procesos contra la misma base se pisan, y el que
 * va en simulado deja a un cliente real sin su recordatorio, en silencio.
 *
 * `tareasDeFondo()` lee `process.env` en cada llamada —no el objeto `env`,
 * que se congela al arrancar—, así que se puede probar cambiando el entorno
 * y devolviéndolo como estaba.
 */

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { tareasDeFondo, env } from '../src/config/env.js';

const ORIGINAL = {
  TAREAS_DE_FONDO: process.env.TAREAS_DE_FONDO,
  MODO_SIMULADO: process.env.MODO_SIMULADO,
};

/** Pone una variable, o la quita si el valor es undefined. */
function poner(nombre, valor) {
  if (valor === undefined) delete process.env[nombre];
  else process.env[nombre] = valor;
}

afterEach(() => {
  for (const [nombre, valor] of Object.entries(ORIGINAL)) poner(nombre, valor);
});

test('en las pruebas están apagadas, y por eso no se pisan con producción', () => {
  // `tests/preparar.mjs` pone MODO_SIMULADO=1 antes de cargar nada.
  assert.equal(process.env.MODO_SIMULADO, '1', 'la suite debe correr en modo simulado');

  // Se quita TAREAS_DE_FONDO porque se revisa ANTES que el modo simulado, y
  // el .env de desarrollo recomienda ponerla en 0: con ella puesta, el motivo
  // sería otro y esta prueba fallaba en cualquier máquina configurada así.
  poner('TAREAS_DE_FONDO', undefined);

  const r = tareasDeFondo();
  assert.equal(r.activas, false);
  assert.equal(r.motivo, 'MODO_SIMULADO=1');
});

test('TAREAS_DE_FONDO=0 las apaga, que es lo que se pone en local', () => {
  poner('MODO_SIMULADO', undefined);
  poner('TAREAS_DE_FONDO', '0');

  const r = tareasDeFondo();
  assert.equal(r.activas, false);
  assert.equal(r.motivo, 'TAREAS_DE_FONDO=0');
});

test('el modo simulado las apaga aunque no se pida', () => {
  poner('TAREAS_DE_FONDO', undefined);
  poner('MODO_SIMULADO', '1');

  assert.equal(tareasDeFondo().activas, false);
});

test('⚠️ sin API_TOKEN también se apagan', () => {
  // Sin token, `whatsapp.js` cae en simulado por su cuenta y el barrido
  // marcaría turnos como recordados sin mandar nada. Es el caso peligroso:
  // un despliegue que pierde el token quemaría los recordatorios de todos
  // sin un solo error en los logs.
  poner('MODO_SIMULADO', undefined);
  poner('TAREAS_DE_FONDO', undefined);

  if (env.API_TOKEN) return;   // con token configurado, este caso no aplica

  const r = tareasDeFondo();
  assert.equal(r.activas, false);
  assert.equal(r.motivo, 'no hay API_TOKEN');
});

test('encendidas por defecto: el despliegue no puede quedarse mudo por olvido', () => {
  poner('MODO_SIMULADO', undefined);
  poner('TAREAS_DE_FONDO', undefined);

  const { activas, motivo } = tareasDeFondo();

  // Con API_TOKEN configurado en .env, sin ninguna variable puestas deben
  // quedar ENCENDIDAS. Si hiciera falta activarlas a mano, el día que a
  // Railway se le olvidara la variable se apagarían sin que nadie se entere.
  if (motivo === 'no hay API_TOKEN') return;   // no hay token en este entorno
  assert.equal(activas, true, 'por defecto van encendidas');
  assert.equal(motivo, null);
});

test('un valor distinto de "0" no las apaga', () => {
  poner('MODO_SIMULADO', undefined);

  for (const valor of ['1', 'si', 'true', '']) {
    poner('TAREAS_DE_FONDO', valor);
    const { motivo } = tareasDeFondo();
    assert.notEqual(motivo, 'TAREAS_DE_FONDO=0', `"${valor}" no debería apagarlas`);
  }
});
