/**
 * Pruebas de las defensas del webhook.
 *
 * Sin dependencias: usa el corredor que ya trae Node (`node --test`).
 * Solo cubre las funciones puras; la deduplicación necesita base de datos
 * y se prueba en la comprobación de extremo a extremo.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { firmaValida, esMensajeReciente } from '../src/webhook/defensas.js';
import { normalizar } from '../src/webhook/despachar.js';

const SECRETO = 'secreto-de-prueba';
const firmar = (cuerpo) =>
  'sha256=' + crypto.createHmac('sha256', SECRETO).update(cuerpo).digest('hex');

// ═══════════════════════════════════════════════════════════════════
//  DEFENSA 4 — firma
// ═══════════════════════════════════════════════════════════════════

test('firma: acepta una firma correcta', () => {
  const cuerpo = Buffer.from('{"hola":"mundo"}');
  assert.equal(firmaValida(cuerpo, firmar(cuerpo), SECRETO), true);
});

test('firma: rechaza una firma de otro cuerpo', () => {
  const cuerpo = Buffer.from('{"hola":"mundo"}');
  const otra   = firmar(Buffer.from('{"hola":"otro"}'));
  assert.equal(firmaValida(cuerpo, otra, SECRETO), false);
});

test('firma: rechaza si falta la cabecera', () => {
  assert.equal(firmaValida(Buffer.from('{}'), null, SECRETO), false);
  assert.equal(firmaValida(Buffer.from('{}'), '', SECRETO), false);
});

test('firma: rechaza una cabecera de largo distinto sin lanzar', () => {
  // timingSafeEqual lanza si los largos difieren. Si esa comprobación previa
  // se cae, esto deja de devolver false y empieza a tumbar el webhook.
  assert.equal(firmaValida(Buffer.from('{}'), 'sha256=corta', SECRETO), false);
});

test('firma: sin secreto configurado, la validación queda apagada', () => {
  // Es deliberado: permite desarrollar sin el secreto. El aviso sale al arrancar.
  assert.equal(firmaValida(Buffer.from('{}'), null, null), true);
});

test('firma: el mismo cuerpo reserializado NO valida', () => {
  // La razón por la que hay que guardar el cuerpo crudo en req.rawBody.
  // Reserializar produce JSON equivalente pero BYTES distintos —aquí, sin
  // los espacios del original— y el HMAC deja de coincidir.
  const crudo = Buffer.from('{"a": 1, "b": [2, 3]}');
  const reserializado = Buffer.from(JSON.stringify(JSON.parse(crudo.toString())));

  assert.notEqual(crudo.toString(), reserializado.toString(), 'los bytes deben diferir');
  assert.equal(firmaValida(crudo, firmar(crudo), SECRETO), true);
  assert.equal(firmaValida(reserializado, firmar(crudo), SECRETO), false);
});

// ═══════════════════════════════════════════════════════════════════
//  DEFENSA 3 — mensajes viejos
// ═══════════════════════════════════════════════════════════════════

const ahoraSeg = () => Math.floor(Date.now() / 1000);

test('antigüedad: un mensaje de ahora se procesa', () => {
  assert.equal(esMensajeReciente(String(ahoraSeg())), true);
});

test('antigüedad: uno de 5 minutos se procesa', () => {
  assert.equal(esMensajeReciente(String(ahoraSeg() - 5 * 60)), true);
});

test('antigüedad: uno de 20 minutos se descarta', () => {
  assert.equal(esMensajeReciente(String(ahoraSeg() - 20 * 60)), false);
});

test('antigüedad: ante la duda, se procesa', () => {
  // Perder un mensaje real de un cliente es peor que procesar uno de más.
  assert.equal(esMensajeReciente(null), true);
  assert.equal(esMensajeReciente(undefined), true);
  assert.equal(esMensajeReciente('no-es-un-numero'), true);
  assert.equal(esMensajeReciente('0'), true);
});

test('antigüedad: el timestamp de Meta viene en SEGUNDOS', () => {
  // Si se interpretara como milisegundos, un mensaje actual parecería de
  // 1970 y se descartaría todo lo que llega.
  const enMilisegundos = String(Date.now());
  assert.equal(esMensajeReciente(enMilisegundos), true);
  assert.equal(esMensajeReciente(String(ahoraSeg())), true);
});

// ═══════════════════════════════════════════════════════════════════
//  Normalizar mensajes
// ═══════════════════════════════════════════════════════════════════

test('normalizar: texto libre', () => {
  const r = normalizar({ type: 'text', text: { body: '  hola  ' } });
  assert.equal(r.clase, 'texto');
  assert.equal(r.texto, 'hola');
  assert.equal(r.idOpcion, null);
});

test('normalizar: botón interactivo', () => {
  const r = normalizar({
    type: 'interactive',
    interactive: { type: 'button_reply', button_reply: { id: '1', title: '📅 Agendar turno' } },
  });
  assert.equal(r.clase, 'opcion');
  assert.equal(r.idOpcion, '1');
});

test('normalizar: fila de lista', () => {
  const r = normalizar({
    type: 'interactive',
    interactive: { type: 'list_reply', list_reply: { id: 'barbero_3', title: 'Camilo Rojas' } },
  });
  assert.equal(r.clase, 'opcion');
  assert.equal(r.idOpcion, 'barbero_3');
  assert.equal(r.texto, 'Camilo Rojas');
});

test('normalizar: audio e imagen caen en "otro"', () => {
  assert.equal(normalizar({ type: 'audio' }).clase, 'otro');
  assert.equal(normalizar({ type: 'image' }).clase, 'otro');
  assert.equal(normalizar({ type: 'sticker' }).clase, 'otro');
  assert.equal(normalizar({ type: 'location' }).clase, 'otro');
});

test('normalizar: reacciones y avisos de sistema se ignoran', () => {
  // Responderlos confunde al cliente, que no escribió nada.
  assert.equal(normalizar({ type: 'reaction' }).clase, 'ignorar');
  assert.equal(normalizar({ type: 'system' }).clase, 'ignorar');
});

test('normalizar: no lanza con un mensaje incompleto', () => {
  // Meta manda formas raras. Nada de esto puede tumbar el proceso.
  assert.doesNotThrow(() => normalizar({ type: 'text' }));
  assert.doesNotThrow(() => normalizar({ type: 'interactive' }));
  assert.doesNotThrow(() => normalizar({ type: 'interactive', interactive: {} }));
  assert.equal(normalizar({ type: 'text' }).texto, '');
});
