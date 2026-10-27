/**
 * Panel web — acceso, sesión y aislamiento entre barberías.
 *
 * ⚠️ La prueba central es el AISLAMIENTO. En multi-tenant, exigir sesión no
 * basta: si el dueño de la barbería A cambia un id en la petición y ve la
 * agenda de la B, da igual lo buena que sea la pantalla de acceso.
 *
 * Crea una segunda barbería de mentira y la borra al terminar.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { consultar, consultarUna, cerrarPool } from '../src/db/pool.js';
import * as sesionPanel from '../src/servicios/sesionPanel.js';
import * as acceso from '../src/servicios/acceso.js';

const BASE = 'http://localhost:3000';
const TEL_LOCAL = '3990000001';
const TEL_BARBERO = '57' + TEL_LOCAL;
const CLAVE = 'ClaveDePrueba99';

let demo, otraBarberia, barberoAlta, barberoOtra, hayServidor = false;
let barberoPrueba, telefonoOriginal, hashOriginal;

before(async () => {
  demo = await consultarUna(`SELECT id FROM barberias WHERE nombre = 'Barbería Demo'`);
  barberoAlta = await consultarUna(
    'SELECT id FROM barberos WHERE barberia_id = $1 ORDER BY orden LIMIT 1', [demo.id]
  );

  const b = await consultar(
    `INSERT INTO barberias (nombre, zona_horaria, activa)
     VALUES ('ZZZ Barbería de prueba', 'America/Bogota', TRUE) RETURNING id`
  );
  otraBarberia = b[0];

  const bb = await consultar(
    `INSERT INTO barberos (barberia_id, nombre, orden, activo)
     VALUES ($1, 'Barbero Ajeno', 1, TRUE) RETURNING id`,
    [otraBarberia.id]
  );
  barberoOtra = bb[0];

  await consultar(
    `INSERT INTO horarios (barbero_id, dia_semana, turnos)
     SELECT $1, d, ARRAY['10:00','11:00']::time[] FROM generate_series(0,6) d
     ON CONFLICT DO NOTHING`,
    [barberoOtra.id]
  );

  // ⚠️ Un barbero PROPIO, no uno real de la barbería.
  //
  // La primera versión le cambiaba el teléfono y la contraseña al primer
  // barbero de la barbería demo. Otro archivo de pruebas hacía lo mismo con el
  // mismo barbero, y el que corría después pisaba al anterior: cinco
  // pruebas fallaban según el orden. Dos archivos no pueden mutar la misma
  // fila y esperar que sus restauraciones cuadren.
  const { hashear } = await import('../src/servicios/claves.js');

  const creado = await consultar(
    `INSERT INTO barberos (barberia_id, nombre, telefono, password_hash, orden, activo)
     VALUES ($1, 'ZZZ Barbero de prueba', $2, $3, 99, TRUE) RETURNING id`,
    [demo.id, TEL_BARBERO, await hashear(CLAVE)]
  );
  barberoPrueba = creado[0];

  await consultar(
    `INSERT INTO horarios (barbero_id, dia_semana, turnos)
     SELECT $1, d, ARRAY['10:00','11:00']::time[] FROM generate_series(0,6) d`,
    [barberoPrueba.id]
  );

  await consultar(
    `INSERT INTO admins (barberia_id, barbero_id, telefono, nombre)
     VALUES ($1, $2, $3, 'Barbero de prueba')`,
    [demo.id, barberoPrueba.id, TEL_BARBERO]);

  // Solo interesa si HAY un servidor escuchando, no si se considera sano.
  // Un servidor local va en modo simulado, y desde entonces `/salud` devuelve
  // 503 a propósito (las tareas de fondo están apagadas): mirar `r.ok` haría
  // que estas pruebas se saltaran siempre, sin que nadie se diera cuenta.
  hayServidor = await fetch(`${BASE}/salud`).then(() => true).catch(() => false);
});

after(async () => {
  await consultar('DELETE FROM barberias WHERE id = $1', [otraBarberia.id]);   // cascada
  await consultar('DELETE FROM admins WHERE telefono = $1', [TEL_BARBERO]);
  await consultar('DELETE FROM barberos WHERE id = $1', [barberoPrueba.id]);   // cascada
  await consultar("DELETE FROM solicitudes_codigo WHERE clave LIKE '%prueba%' OR clave LIKE '%disp-%'");
  await cerrarPool();
});

/** Petición con una cookie de sesión fabricada para ese admin. */
function comoAdmin({ barberiaId, barberoId = null }) {
  const cookie = sesionPanel.crear({
    telefono: '570000000001', nombre: 'Admin de prueba', barberiaId, barberoId,
  });
  return (ruta) => fetch(BASE + ruta, { headers: { Cookie: `sesion=${cookie}` } });
}

// ═══════════════════════════════════════════════════════════════════
//  Cookie de sesión
// ═══════════════════════════════════════════════════════════════════

test('la cookie firmada se puede leer de vuelta', () => {
  const c = sesionPanel.crear({ telefono: '573001112233', nombre: 'Juan', barberiaId: 7 });
  const datos = sesionPanel.leer(c);
  assert.equal(datos.telefono, '573001112233');
  assert.equal(datos.barberiaId, 7);
});

test('una cookie manipulada se rechaza', () => {
  // Lo que impide que alguien se ascienda a administrador global editando
  // la cookie en el navegador.
  const c = sesionPanel.crear({ telefono: '573001112233', nombre: 'Juan', barberiaId: 7 });
  const [carga, firma] = c.split('.');

  const falsa = Buffer.from(JSON.stringify({
    telefono: '573001112233', nombre: 'Juan', barberiaId: null, vence: Date.now() + 99999999,
  })).toString('base64url');

  assert.equal(sesionPanel.leer(`${falsa}.${firma}`), null, 'carga cambiada, firma vieja');
  assert.equal(sesionPanel.leer(`${carga}.${firma}x`), null, 'firma alterada');
  assert.equal(sesionPanel.leer('basura'), null);
  assert.equal(sesionPanel.leer(''), null);
});

test('una cookie vencida se rechaza, aunque la firma sea correcta', () => {
  // Firmada de verdad, pero caducada ayer. Si esto pasara, una sesión robada
  // valdría para siempre.
  const caducada = sesionPanel.crear({
    telefono: '573001112233', nombre: 'Juan', barberiaId: null, duracionDias: -1,
  });

  assert.equal(sesionPanel.leer(caducada), null, 'vencida: fuera');

  // Y la misma, viva, sí entra — así se comprueba que el rechazo vino del
  // vencimiento y no de un problema de firma.
  const viva = sesionPanel.crear({
    telefono: '573001112233', nombre: 'Juan', barberiaId: null, duracionDias: 1,
  });
  assert.ok(sesionPanel.leer(viva), 'viva: entra');
});

test('la cookie lleva HttpOnly, SameSite y Secure', () => {
  const h = sesionPanel.cabecera('x');
  assert.ok(h.includes('HttpOnly'), 'sin HttpOnly, un XSS se lleva la sesión');
  assert.ok(h.includes('SameSite=Lax'), 'sin SameSite, queda expuesta a CSRF');
  assert.ok(h.includes('Secure'), 'sin Secure, viaja en claro por HTTP');
});

// ═══════════════════════════════════════════════════════════════════
//  Acceso por contraseña
//
//  Antes era un código de 6 dígitos por WhatsApp. Falló en el uso real:
//  el código salía como mensaje libre y Meta solo entrega esos dentro de la
//  ventana de 24 h que abre el usuario. Si el barbero no le había escrito al
//  bot ese día, el código no llegaba — y la pantalla no lo decía.
// ═══════════════════════════════════════════════════════════════════

test('la contraseña correcta abre, y devuelve el alcance', async () => {
  const r = await acceso.entrar(TEL_BARBERO, CLAVE, 'disp-prueba-ok');
  assert.equal(r.ok, true, 'debería entrar');
  assert.equal(r.admin.barberoId, barberoPrueba.id, 'con alcance a su propia agenda');
  assert.equal(r.admin.barberiaId, demo.id);
});

test('la contraseña incorrecta no abre', async () => {
  const r = await acceso.entrar(TEL_BARBERO, 'equivocada', 'disp-prueba-mala');
  assert.equal(r.ok, false);
  assert.equal(r.admin, undefined);
});

test('un número que no es administrador no abre', async () => {
  const r = await acceso.entrar('573999999999', 'loquesea', 'disp-prueba-nadie');
  assert.equal(r.ok, false);
});

test('el número sirve con o sin código de país', async () => {
  // La gente escribe su número como lo marca; en la base está con el 57.
  const con = await acceso.entrar('57' + TEL_LOCAL, CLAVE, 'disp-var-1');
  const sin = await acceso.entrar(TEL_LOCAL, CLAVE, 'disp-var-2');
  assert.equal(con.ok, true, 'con código de país');
  assert.equal(sin.ok, true, 'sin código de país');
});

test('el freno corta tras varios intentos fallidos', async () => {
  // ⚠️ Se limpian las huellas ANTES de empezar. Sin esto la prueba depende
  // de cuántas veces se haya corrido la suite antes: los intentos se
  // acumulan en la base y al segundo pase ya arranca frenada.
  const tel = '573999999998';
  const disp = 'disp-prueba-fuerza-bruta';
  await consultar('DELETE FROM solicitudes_codigo WHERE clave = ANY($1)',
    [[`tel:${tel}`, `disp:${disp}`]]);

  const r = [];
  for (let i = 0; i < acceso.MAX_INTENTOS + 1; i++) {
    r.push((await acceso.entrar(tel, 'mala', disp)).frenado);
  }

  assert.equal(r[0], false, 'el primero pasa');
  assert.equal(r[r.length - 1], true, 'el último ya está frenado');

  await consultar('DELETE FROM solicitudes_codigo WHERE clave = ANY($1)',
    [[`tel:${tel}`, `disp:${disp}`]]);
});

test('entrar bien limpia el contador de fallos', async () => {
  const disp = 'disp-prueba-limpia';
  await acceso.entrar(TEL_BARBERO, 'mala', disp);
  await acceso.entrar(TEL_BARBERO, 'mala', disp);

  const bien = await acceso.entrar(TEL_BARBERO, CLAVE, disp);
  assert.equal(bien.ok, true);

  // Un olvido de ayer no puede dejar fuera a quien ya demostró que es él.
  const otra = await acceso.entrar(TEL_BARBERO, CLAVE, disp);
  assert.equal(otra.frenado, false);
});

// ═══════════════════════════════════════════════════════════════════
//  AISLAMIENTO — la prueba que importa
// ═══════════════════════════════════════════════════════════════════

test('el admin de una barbería NO ve la agenda de otra', async (t) => {
  if (!hayServidor) return t.skip('hace falta el servidor en localhost:3000');

  const pedir = comoAdmin({ barberiaId: demo.id });

  const propia = await pedir(`/panel/api/semana?barbero=${barberoAlta.id}`);
  assert.equal(propia.status, 200, 'debe ver la suya');

  // El mismo admin, cambiando el id a un barbero de otra barbería.
  const ajena = await pedir(`/panel/api/semana?barbero=${barberoOtra.id}`);
  assert.equal(ajena.status, 404, 'NO puede ver la de otra barbería');
});

test('tampoco puede leer los horarios de otra barbería', async (t) => {
  if (!hayServidor) return t.skip('hace falta el servidor');

  const pedir = comoAdmin({ barberiaId: demo.id });
  const r = await pedir(`/panel/api/horarios?barbero=${barberoOtra.id}`);
  assert.equal(r.status, 404);
});

test('el administrador global SÍ ve las dos', async (t) => {
  if (!hayServidor) return t.skip('hace falta el servidor');

  const pedir = comoAdmin({ barberiaId: null });

  assert.equal((await pedir(`/panel/api/semana?barbero=${barberoAlta.id}`)).status, 200);
  assert.equal((await pedir(`/panel/api/semana?barbero=${barberoOtra.id}`)).status, 200);

  const yo = await (await pedir('/panel/api/yo')).json();
  assert.equal(yo.global, true);
  assert.ok(yo.barberias.length >= 2, 'debe ver las dos barberías');
});

test('sin cookie, la API responde 401', async (t) => {
  if (!hayServidor) return t.skip('hace falta el servidor');

  for (const ruta of ['/panel/api/yo', '/panel/api/semana?barbero=1', '/panel/api/horarios?barbero=1']) {
    assert.equal((await fetch(BASE + ruta)).status, 401, ruta);
  }
});

test('un barbero con alcance propio NO ve a sus compañeros', async (t) => {
  if (!hayServidor) return t.skip('hace falta el servidor');

  // Alcance limitado al barbero de la barbería demo.
  const pedir = comoAdmin({ barberiaId: demo.id, barberoId: barberoPrueba.id });

  assert.equal((await pedir(`/panel/api/semana?barbero=${barberoPrueba.id}`)).status, 200,
    've la suya');

  // Otro barbero de SU MISMA barbería: tampoco.
  const companero = await consultarUna(
    'SELECT id FROM barberos WHERE barberia_id = $1 AND id <> $2 AND activo LIMIT 1',
    [demo.id, barberoPrueba.id]
  );
  if (companero) {
    assert.equal((await pedir(`/panel/api/semana?barbero=${companero.id}`)).status, 404,
      'NO puede ver la de un compañero');
  }

  const yo = await (await pedir('/panel/api/yo')).json();
  assert.equal(yo.soloUnBarbero, true, 'el panel oculta el selector');
  assert.equal(yo.barberos.length, 1, 'solo se ve a sí mismo');
});

// ═══════════════════════════════════════════════════════════════════
//  Bloquear y liberar
//
//  ⚠️ Desde el panel NO se cancela el turno de un cliente. Se quitó a
//  propósito: un toque de más sobre la celda equivocada borraba una cita ya
//  confirmada, y el cliente no se enteraba. La comprobación vive en el
//  servidor, no en la página: quitar el botón del HTML no protege de un POST
//  hecho a mano.
// ═══════════════════════════════════════════════════════════════════

/** POST con una cookie de sesión fabricada. */
function comoAdminPost({ barberiaId, barberoId = null }) {
  const cookie = sesionPanel.crear({
    telefono: '570000000001', nombre: 'Admin de prueba', barberiaId, barberoId,
  });
  return (ruta, cuerpo) => fetch(BASE + ruta, {
    method: 'POST',
    headers: { Cookie: `sesion=${cookie}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo),
  });
}

/** Una fecha lejana, para no chocar con bloqueos puestos a mano. */
const LEJOS = new Date(Date.now() + 250 * 86400_000).toISOString().slice(0, 10);

test('un bloqueo se pone y se libera desde el panel', async (t) => {
  if (!hayServidor) return t.skip('hace falta el servidor');

  const post = comoAdminPost({ barberiaId: demo.id });

  const puesto = await post('/panel/api/bloquear',
    { barbero: barberoPrueba.id, fecha: LEJOS, hora: '10:00' });
  assert.equal(puesto.status, 200);
  const { turnoId } = await puesto.json();

  const liberado = await post('/panel/api/liberar', { turno: Number(turnoId) });
  assert.equal(liberado.status, 200);
  assert.equal((await liberado.json()).era, 'bloqueo');

  const fila = await consultarUna('SELECT estado FROM turnos WHERE id = $1', [turnoId]);
  assert.equal(fila.estado, 'Cancelado', 'el bloqueo quedó liberado');
});

test('el turno de un cliente NO se cancela desde el panel', async (t) => {
  if (!hayServidor) return t.skip('hace falta el servidor');

  const creado = await consultar(
    `INSERT INTO turnos (barberia_id, barbero_id, fecha, hora, tipo, estado,
                         cliente_nombre, cliente_telefono, inicio_en)
     VALUES ($1, $2, $3, '11:00', 'cita', 'Confirmado', 'Cliente de prueba',
             '573009998877', ($3::date + '11:00'::time) AT TIME ZONE 'America/Bogota')
     RETURNING id`,
    [demo.id, barberoPrueba.id, LEJOS]
  );
  const cita = creado[0].id;

  const r = await comoAdminPost({ barberiaId: demo.id })('/panel/api/liberar', { turno: Number(cita) });
  assert.equal(r.status, 403, 'el servidor lo rechaza');

  const fila = await consultarUna('SELECT estado FROM turnos WHERE id = $1', [cita]);
  assert.equal(fila.estado, 'Confirmado', 'la cita del cliente sigue en pie');
});

test('un administrador global tampoco puede cancelar la cita de un cliente', async (t) => {
  if (!hayServidor) return t.skip('hace falta el servidor');

  const creado = await consultar(
    `INSERT INTO turnos (barberia_id, barbero_id, fecha, hora, tipo, estado,
                         cliente_nombre, cliente_telefono, inicio_en)
     VALUES ($1, $2, $3, '12:00', 'cita', 'Confirmado', 'Cliente de prueba',
             '573009998877', ($3::date + '12:00'::time) AT TIME ZONE 'America/Bogota')
     RETURNING id`,
    [demo.id, barberoPrueba.id, LEJOS]
  );
  const cita = creado[0].id;

  // barberiaId null = alcance total. Ni con eso.
  const r = await comoAdminPost({ barberiaId: null })('/panel/api/liberar', { turno: Number(cita) });
  assert.equal(r.status, 403);

  const fila = await consultarUna('SELECT estado FROM turnos WHERE id = $1', [cita]);
  assert.equal(fila.estado, 'Confirmado');
});
