/**
 * DE QUIÉN ES EL MENSAJE
 *
 * ⚠️ Estas pruebas nacen de un fallo real en producción. Durante un día, el
 * 9 % de los mensajes (12 de 134) llegó de Meta sin `messages[].from`, y el
 * bot intentó responder sin destinatario: Meta devolvía 400 y NUEVE clientes
 * reales quedaron sin respuesta, en silencio.
 *
 * Lo que fijan:
 *   · el respaldo `contacts[].wa_id` cuando `from` viene vacío
 *   · que sin remitente NO se intente enviar nada
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { remitenteDe, nombreDe } from '../src/webhook/remitente.js';
import { despachar } from '../src/webhook/despachar.js';
import { simulado } from '../src/servicios/whatsapp.js';

// ═══════════════════════════════════════════════════════════════════
//  Resolver el remitente
// ═══════════════════════════════════════════════════════════════════

test('el caso normal: el número viene en messages[].from', () => {
  const m = { from: '573001234567', type: 'text', text: { body: 'Hola' } };
  assert.equal(remitenteDe(m, [{ wa_id: '573001234567' }]), '573001234567');
});

test('⚠️ sin `from`, se usa el respaldo contacts[].wa_id', () => {
  // Este es EXACTAMENTE el caso que dejó a nueve clientes sin respuesta.
  const m = { type: 'text', text: { body: 'Si tiene turnito para hoy?' } };
  assert.equal(remitenteDe(m, [{ wa_id: '573009990001' }]), '573009990001');
});

test('`from` manda sobre el respaldo si los dos vienen', () => {
  const m = { from: '573001110000' };
  assert.equal(remitenteDe(m, [{ wa_id: '573009999999' }]), '573001110000');
});

test('con varios mensajes juntos, cada uno toma el contacto de su posición', () => {
  const contactos = [{ wa_id: '573001110000' }, { wa_id: '573002220000' }];
  assert.equal(remitenteDe({}, contactos, 0), '573001110000');
  assert.equal(remitenteDe({}, contactos, 1), '573002220000');
});

test('si esa posición no existe, cae al primer contacto', () => {
  const contactos = [{ wa_id: '573001110000' }];
  assert.equal(remitenteDe({}, contactos, 3), '573001110000');
});

test('sin `from` y sin contactos, devuelve null — no inventa un número', () => {
  assert.equal(remitenteDe({ type: 'text' }, []), null);
  assert.equal(remitenteDe({}, undefined), null);
  assert.equal(remitenteDe({}), null);
});

test('un wa_id numérico se devuelve como texto', () => {
  // Si llegara como número, concatenarlo en la URL de Meta daría "undefined".
  assert.equal(remitenteDe({}, [{ wa_id: 573001234567 }]), '573001234567');
  assert.equal(typeof remitenteDe({}, [{ wa_id: 573001234567 }]), 'string');
});

test('el nombre del perfil sigue el mismo criterio de posición', () => {
  const c = [{ profile: { name: 'Ana' } }, { profile: { name: 'Luis' } }];
  assert.equal(nombreDe(c, 0), 'Ana');
  assert.equal(nombreDe(c, 1), 'Luis');
  assert.equal(nombreDe(c, 9), 'Ana');
  assert.equal(nombreDe([]), null);
  assert.equal(nombreDe(), null);
});

// ═══════════════════════════════════════════════════════════════════
//  No enviar a ciegas
// ═══════════════════════════════════════════════════════════════════

test('⚠️ despachar() sin remitente NO intenta enviar nada', async () => {
  simulado.limpiar();

  await despachar({
    mensaje: { id: 'x1', type: 'text', text: { body: 'Hola' } },
    barberia: { id: 1, nombre: 'Barbería Demo' },
    nombrePerfil: 'Alguien',
    de: null,
  });

  assert.equal(simulado.todos().length, 0,
    'antes se enviaban 2 mensajes sin destinatario y Meta devolvía 400');
});

// ═══════════════════════════════════════════════════════════════════
//  Clientes con nombre de usuario de WhatsApp (BSUID)
//
//  ⚠️ Caso real del 19/09/2026: un cliente con nombre de usuario escribió
//  "Buenos días", "Necesito agendar un turno para hoy en la tarde" y
//  "3 o 4 de las tarde", y no recibió respuesta. Su mensaje no traía `from`
//  ni `wa_id`: tiene nombre de usuario y oculta su número, así que Meta solo
//  manda `from_user_id`. El sobre de abajo es el que quedó guardado.
// ═══════════════════════════════════════════════════════════════════

import { esBsuid, paraMeta, telefonoVisible } from '../src/servicios/identidad.js';
import { enviar } from '../src/servicios/whatsapp.js';

const SOBRE_REAL = {
  contacts: [{ profile: { name: 'Cliente Ejemplo', username: 'cliente_demo' }, user_id: 'CO.10000000000000001' }],
  messages: [{ id: 'wamid.x', type: 'text', text: { body: 'Buenos días' }, timestamp: '1789821208',
               from_user_id: 'CO.10000000000000001' }],
};

test('⚠️ sin teléfono, se usa el ID de usuario (from_user_id)', () => {
  assert.equal(remitenteDe(SOBRE_REAL.messages[0], SOBRE_REAL.contacts), 'CO.10000000000000001');
});

test('sin from_user_id, sirve el user_id de contacts', () => {
  assert.equal(remitenteDe({ type: 'text' }, [{ user_id: 'CO.555' }]), 'CO.555');
});

test('si viene teléfono Y user_id, gana el teléfono', () => {
  // Todo el sistema (barberos, panel, turnos viejos) está por teléfono.
  const m = { from: '573001234567', from_user_id: 'CO.999' };
  assert.equal(remitenteDe(m, [{ wa_id: '573001234567', user_id: 'CO.999' }]), '573001234567');
  assert.equal(remitenteDe({ from_user_id: 'CO.999' }, [{ wa_id: '573001234567' }]), '573001234567');
});

test('esBsuid distingue un ID de usuario de un teléfono', () => {
  assert.equal(esBsuid('CO.10000000000000001'), true);
  assert.equal(esBsuid('US.13491208655302741918'), true);
  assert.equal(esBsuid('573001234567'), false);
  assert.equal(esBsuid(''), false);
  assert.equal(esBsuid(null), false);
});

test('⚠️ a un BSUID se le envía en `recipient`, nunca en `to`', () => {
  // Meta rechaza un BSUID en `to`. Esto es lo que dejaba mudo al cliente.
  const m = paraMeta({ messaging_product: 'whatsapp', to: 'CO.10000000000000001', type: 'text', text: { body: 'x' } });
  assert.equal(m.recipient, 'CO.10000000000000001');
  assert.equal(m.recipient_type, 'individual');
  assert.equal('to' in m, false, 'no puede quedar `to` con un BSUID');
});

test('a un teléfono el mensaje sale intacto, con `to`', () => {
  const original = { messaging_product: 'whatsapp', to: '573001234567', type: 'text' };
  assert.equal(paraMeta(original), original);
});

test('paraMeta no modifica el mensaje original', () => {
  const original = { to: 'CO.123', type: 'text' };
  paraMeta(original);
  assert.equal(original.to, 'CO.123');
});

test('enviar() convierte el destinatario en la única puerta de salida', async () => {
  simulado.limpiar();
  await enviar({ messaging_product: 'whatsapp', to: 'CO.10000000000000001', type: 'text', text: { body: 'Hola' } },
               { nombre: 'Prueba' });
  const salido = simulado.ultimo();
  assert.equal(salido.recipient, 'CO.10000000000000001');
  assert.equal(salido.to, undefined);
  assert.equal(simulado.paraDe('CO.10000000000000001').length, 1);
});

test('al barbero se le muestra algo legible, no el ID', () => {
  assert.equal(telefonoVisible('CO.10000000000000001'), 'sin número (usuario de WhatsApp)');
  assert.equal(telefonoVisible('573001234567'), '3001234567');
  assert.equal(telefonoVisible(''), '');
});
