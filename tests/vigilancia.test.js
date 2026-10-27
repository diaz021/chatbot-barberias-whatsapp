/**
 * Vigilancia del webhook — la defensa contra el fallo silencioso.
 *
 * No tocan la red: las consultas a Meta se sustituyen por respuestas de
 * mentira para poder probar los casos que no se pueden provocar de verdad
 * (webhook apuntando a otro sitio, número desconectado, Meta caído).
 *
 * ⚠️ NO TOCAN LA BARBERÍA REAL. La versión anterior de este archivo le ponía
 * a la barbería real `ultimo_entrante_en = NULL` en cada prueba, y una de ellas le
 * BORRABA el phone_number_id por un momento: si un cliente escribía justo
 * entonces, el webhook no encontraba la barbería, lo ignoraba, y además esa
 * ausencia quedaba 30 s en caché. Ahora todo se hace sobre una barbería de
 * prueba propia, 'ZZZ Barbería vigilancia', que se crea y se borra.
 */

import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

import { consultar, consultarUna, cerrarPool } from '../src/db/pool.js';
import {
  revisarUrl, revisarConexion, enSilencio, silencioEnHorario, registrarEntrante,
  tocaAvisar, olvidarAlertas, CADA_MINUTOS, SILENCIO_HORAS,
} from '../src/servicios/vigilancia.js';

let prueba;

before(async () => {
  // Número de mentira: nunca coincidirá con un webhook real.
  const b = await consultar(
    `INSERT INTO barberias (nombre, phone_number_id, zona_horaria, activa)
     VALUES ('ZZZ Barbería vigilancia', 'ZZZ-vigilancia', 'America/Bogota', TRUE)
     RETURNING id, nombre, zona_horaria`
  );
  prueba = b[0];

  // Un barbero que trabaja todo el día, todos los días: así "¿está abierta?"
  // no depende de a qué hora corran las pruebas.
  const bb = await consultar(
    `INSERT INTO barberos (barberia_id, nombre, orden, activo)
     VALUES ($1, 'ZZZ Barbero vigilancia', 99, TRUE) RETURNING id`,
    [prueba.id]
  );
  await consultar(
    `INSERT INTO horarios (barbero_id, dia_semana, turnos)
     SELECT $1, d, ARRAY(SELECT make_time(h, m, 0) FROM generate_series(0,23) h,
                                                     unnest(ARRAY[0,30]) m ORDER BY 1)
       FROM generate_series(0,6) d`,
    [bb[0].id]
  );
});

beforeEach(async () => {
  olvidarAlertas();
  await consultar(
    'UPDATE barberias SET ultimo_entrante_en = NULL, alertada_en = NULL WHERE id = $1',
    [prueba.id]
  );
});

after(async () => {
  await consultar('DELETE FROM barberias WHERE id = $1', [prueba.id]);   // cascada
  await cerrarPool();
});

// ═══════════════════════════════════════════════════════════════════
//  1. La URL registrada en Meta
// ═══════════════════════════════════════════════════════════════════

const META = {
  bien:        { ok: true, url: 'https://mi-dominio.com/webhook', suscritoAMensajes: true },
  otraUrl:     { ok: true, url: 'https://tunel-viejo.trycloudflare.com/webhook', suscritoAMensajes: true },
  sinMensajes: { ok: true, url: 'https://mi-dominio.com/webhook', suscritoAMensajes: false },
  caido:       { ok: false, motivo: 'Error validating application' },
};

const revisar = (respuesta, urlPublica = 'https://mi-dominio.com') =>
  revisarUrl({ consultarMeta: async () => respuesta, urlPublica });

test('URL correcta y suscrito a messages → bien', async () => {
  assert.equal((await revisar(META.bien)).estado, 'bien');
});

test('Meta apunta a OTRA URL → mal', async () => {
  // Esta es la falla del 10 de agosto de 2026, exactamente: el servidor
  // responde perfecto y Meta está entregando los mensajes en otro sitio.
  const r = await revisar(META.otraUrl);
  assert.equal(r.estado, 'mal');
  assert.ok(r.detalle.includes('tunel-viejo'), r.detalle);
  assert.ok(r.detalle.includes('mi-dominio'), 'debe decir ambas para poder arreglarlo');
});

test('app NO suscrita al campo messages → mal', async () => {
  const r = await revisar(META.sinMensajes);
  assert.equal(r.estado, 'mal');
  assert.ok(r.detalle.includes('messages'));
});

test('si Meta no responde, NO se da por bueno', async () => {
  const r = await revisar(META.caido);
  assert.equal(r.estado, 'sin_comprobar');
  assert.ok(!r.url);
});

test('sin URL_PUBLICA no se inventa un veredicto', async () => {
  const r = await revisar(META.bien, null);
  assert.equal(r.estado, 'sin_comprobar');
  assert.ok(r.detalle.includes('URL_PUBLICA'));
});

test('una barra sobrante en URL_PUBLICA no provoca falsa alarma', async () => {
  for (const u of ['https://mi-dominio.com/', 'https://mi-dominio.com///']) {
    assert.equal((await revisar(META.bien, u)).estado, 'bien', u);
  }
});

// ═══════════════════════════════════════════════════════════════════
//  2. La conexión de cada número
// ═══════════════════════════════════════════════════════════════════

const BARBERIA = { id: 1, nombre: 'Barbería X', phone_number_id: '111', waba_id: '222' };
const conMeta = (respuesta) =>
  revisarConexion({ barberias: [BARBERIA], consultarMeta: async () => respuesta });

test('número CONNECTED y app suscrita → bien', async () => {
  const r = await conMeta({ ok: true, estado: 'CONNECTED', suscrita: true });
  assert.equal(r.estado, 'bien');
});

test('⚠️ número desconectado → mal, y dice cómo está', async () => {
  const r = await conMeta({ ok: true, estado: 'DISCONNECTED', suscrita: true });
  assert.equal(r.estado, 'mal');
  assert.ok(r.detalle[0].motivo.includes('DISCONNECTED'));
});

test('⚠️ app desuscrita de la cuenta → mal', async () => {
  // Meta deja de entregarnos los mensajes de ese número, sin error visible.
  const r = await conMeta({ ok: true, estado: 'CONNECTED', suscrita: false });
  assert.equal(r.estado, 'mal');
  assert.ok(r.detalle[0].motivo.includes('suscrita'));
});

test('si no se pudo comprobar la suscripción, no se da la alarma', async () => {
  const r = await conMeta({ ok: true, estado: 'CONNECTED', suscrita: null });
  assert.equal(r.estado, 'bien');
});

test('si Meta no responde → sin comprobar, nunca "mal"', async () => {
  // Una alarma por no poder preguntar sería un falso positivo.
  const r = await conMeta({ ok: false, motivo: 'timeout' });
  assert.equal(r.estado, 'sin_comprobar');
});

test('con varias barberías, basta una mal para el estado global', async () => {
  const r = await revisarConexion({
    barberias: [BARBERIA, { ...BARBERIA, id: 2, nombre: 'Otra' }],
    consultarMeta: async (b) => ({ ok: true, estado: b.id === 2 ? 'FLAGGED' : 'CONNECTED', suscrita: true }),
  });
  assert.equal(r.estado, 'mal');
  assert.equal(r.detalle.filter(d => d.estado === 'mal')[0].barberia.nombre, 'Otra');
});

// ═══════════════════════════════════════════════════════════════════
//  3. El silencio — contado solo en horario abierto
// ═══════════════════════════════════════════════════════════════════

test('⚠️ la noche NO cuenta como silencio', () => {
  // Caso real: último mensaje a las 10 p.m., la barbería abre a las 9 a.m.
  // A las 9:30 "llevaba" 11,5 h sin mensajes, y la alarma saltaba cada
  // mañana antes del primer cliente. Solo cuenta la media hora abierta.
  const h = silencioEnHorario({ horasDesdeUltimo: 11.5, apertura: 9 * 60, cierre: 21 * 60, ahora: 9 * 60 + 30 });
  assert.equal(h, 0.5);
});

test('si el último mensaje fue hoy, cuenta desde ese mensaje', () => {
  const h = silencioEnHorario({ horasDesdeUltimo: 2, apertura: 9 * 60, cierre: 21 * 60, ahora: 15 * 60 });
  assert.equal(h, 2);
});

test('fuera del horario no hay silencio que medir', () => {
  assert.equal(silencioEnHorario({ horasDesdeUltimo: 30, apertura: 540, cierre: 1260, ahora: 300 }), null);
  assert.equal(silencioEnHorario({ horasDesdeUltimo: 30, apertura: 540, cierre: 1260, ahora: 1300 }), null);
});

test('sin registro de entrada, no aparece', async () => {
  // Un sistema recién desplegado no ha recibido nada todavía.
  const lista = await enSilencio();
  assert.ok(!lista.some(b => b.id === prueba.id));
});

test('con un mensaje reciente, no aparece', async () => {
  await consultar('UPDATE barberias SET ultimo_entrante_en = now() WHERE id = $1', [prueba.id]);
  assert.ok(!(await enSilencio()).some(b => b.id === prueba.id));
});

test('⚠️ enSilencio trae el phone_number_id', async () => {
  // Faltaba, y por eso cada alerta fallaba con "sin phone_number_id: no se
  // puede enviar" — 85 veces en cuatro días. Si vuelve a desaparecer, esto
  // salta. La barbería de prueba abre las 24 h, así que con 30 h de
  // silencio entra en la lista siempre que el día lleve ≥ 5 h.
  await consultar(
    `UPDATE barberias SET ultimo_entrante_en = now() - INTERVAL '30 hours' WHERE id = $1`,
    [prueba.id]
  );
  const b = (await enSilencio()).find(x => x.id === prueba.id);
  if (b) assert.equal(b.phone_number_id, 'ZZZ-vigilancia');
});

test('no se repite mientras dura el silencio', async () => {
  await consultar(
    `UPDATE barberias SET ultimo_entrante_en = now() - INTERVAL '30 hours', alertada_en = now()
      WHERE id = $1`, [prueba.id]
  );
  assert.ok(!(await enSilencio()).some(b => b.id === prueba.id), 'ya se anotó hace poco');
});

test('registrar un entrante borra la marca de alerta', async () => {
  await consultar(
    `UPDATE barberias SET ultimo_entrante_en = now() - INTERVAL '30 hours', alertada_en = now()
      WHERE id = $1`, [prueba.id]
  );
  await registrarEntrante(prueba.id);
  const fila = await consultarUna(
    'SELECT ultimo_entrante_en, alertada_en FROM barberias WHERE id = $1', [prueba.id]
  );
  assert.equal(fila.alertada_en, null);
  assert.ok(fila.ultimo_entrante_en);
});

// ═══════════════════════════════════════════════════════════════════
//  El freno de las alertas
// ═══════════════════════════════════════════════════════════════════

test('⚠️ una avería no se avisa cada 15 minutos', () => {
  // Antes una alerta que no se enviaba se reintentaba en cada ronda.
  const t0 = Date.now();
  assert.equal(tocaAvisar('x', t0), true, 'la primera vez sí');
  assert.equal(tocaAvisar('x', t0 + 15 * 60_000), false, '15 min después no');
  assert.equal(tocaAvisar('x', t0 + 5 * 3600_000), false, '5 h después tampoco');
  assert.equal(tocaAvisar('x', t0 + 7 * 3600_000), true, 'pasadas 6 h, otra vez');
});

test('cada avería tiene su propio freno', () => {
  const t0 = Date.now();
  assert.equal(tocaAvisar('webhook', t0), true);
  assert.equal(tocaAvisar('conexion:1', t0), true, 'otra avería distinta sí se avisa');
});

// ═══════════════════════════════════════════════════════════════════
//  Coherencia
// ═══════════════════════════════════════════════════════════════════

test('se revisa más seguido de lo que tarda en saltar la alerta', () => {
  assert.ok(CADA_MINUTOS < SILENCIO_HORAS * 60);
});

test('la barbería real no se toca', async () => {
  // Guarda contra el regreso del fallo: ninguna prueba de este archivo
  // debe haber alterado el número de la barbería demo.
  const real = await consultarUna(
    `SELECT phone_number_id FROM barberias WHERE nombre = 'Barbería Demo'`
  );
  assert.equal(real?.phone_number_id, 'DEMO-0000000001');
});
