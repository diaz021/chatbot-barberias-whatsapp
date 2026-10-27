/**
 * Panel del barbero, contraseñas, avisos y recordatorios.
 * Contra la base real, en modo simulado. Limpia lo suyo al terminar.
 */

import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

import { manejar } from '../src/motor/index.js';
import { simulado } from '../src/servicios/whatsapp.js';
import { consultar, consultarUna, cerrarPool } from '../src/db/pool.js';
import { hashear, verificar, generar } from '../src/servicios/claves.js';
import { formatearAgenda, agendaDe } from '../src/motor/panel.js';
import { plantilla } from '../src/servicios/avisos.js';
import { pendientes, VENTANA_DESDE, VENTANA_HASTA, CADA_MINUTOS } from '../src/servicios/recordatorios.js';
import { hoyEn } from '../src/config/fechas.js';

const TEL_BARBERO = '573001110000';
const CLAVE = 'ClaveDePrueba99';
const CLIENTE = '573007778888';

let barberia, barbero;

before(async () => {
  barberia = await consultarUna(
    `SELECT id, nombre, zona_horaria, direccion, ciudad, latitud, longitud,
            telefono_contacto, phone_number_id, firma
       FROM barberias WHERE nombre = 'Barbería Demo'`
  );
  // ⚠️ Un barbero PROPIO, creado para la prueba.
  //
  // Antes esta prueba le cambiaba el teléfono y la contraseña a un barbero
  // REAL y los restauraba al terminar. Eso salió mal de verdad: entre
  // corridas repetidas, la restauración escribió el teléfono de prueba
  // encima del real, y el barbero se quedó sin poder entrar al panel.
  //
  // Una prueba nunca debe mutar datos de producción. Aunque restaure bien
  // el 99% de las veces, el 1% es un dato real perdido en silencio.
  const creado = await consultar(
    `INSERT INTO barberos (barberia_id, nombre, telefono, password_hash, orden, activo)
     VALUES ($1, 'ZZZ Barbero panel', $2, $3, 98, TRUE) RETURNING id, nombre`,
    [barberia.id, TEL_BARBERO, await hashear(CLAVE)]
  );
  barbero = creado[0];

  // Una jornada cualquiera, para que la agenda tenga algo que mostrar.
  await consultar(
    `INSERT INTO horarios (barbero_id, dia_semana, turnos)
     SELECT $1, d, ARRAY['09:00','09:35','10:10']::time[] FROM generate_series(0,6) d`,
    [barbero.id]
  );
});

beforeEach(async () => {
  simulado.limpiar();
  await consultar('DELETE FROM sesiones WHERE telefono = ANY($1)', [[TEL_BARBERO, CLIENTE]]);
});

after(async () => {
  await consultar('DELETE FROM sesiones WHERE telefono = ANY($1)', [[TEL_BARBERO, CLIENTE]]);
  await consultar('DELETE FROM turnos WHERE cliente_telefono = ANY($1)', [[TEL_BARBERO, CLIENTE]]);
  await consultar('DELETE FROM barberos WHERE id = $1', [barbero.id]);   // cascada
  await cerrarPool();
});

const comoBarbero = (texto, idOpcion = null) =>
  manejar({ de: TEL_BARBERO, clase: idOpcion ? 'opcion' : 'texto', texto, idOpcion, barberia, nombrePerfil: 'Andrés' });

const textos = () => simulado.todos().filter(m => m.type === 'text').map(m => m.text.body);
const seEnvio = (frag) => textos().some(t => t.includes(frag));

// ═══════════════════════════════════════════════════════════════════
//  Contraseñas
// ═══════════════════════════════════════════════════════════════════

test('clave: la correcta verifica, la incorrecta no', async () => {
  const h = await hashear('MiClave123');
  assert.equal(await verificar('MiClave123', h), true);
  assert.equal(await verificar('MiClave124', h), false);
  assert.equal(await verificar('', h), false);
});

test('clave: nunca se guarda en claro', async () => {
  const h = await hashear('SuperSecreta');
  assert.ok(!h.includes('SuperSecreta'), 'la clave no puede aparecer en el hash');
  assert.ok(h.startsWith('scrypt$'));
});

test('clave: dos hashes de la misma clave son distintos (sal aleatoria)', async () => {
  const a = await hashear('igual');
  const b = await hashear('igual');
  assert.notEqual(a, b, 'sin sal, dos barberos con la misma clave tendrían el mismo hash');
  assert.equal(await verificar('igual', a), true);
  assert.equal(await verificar('igual', b), true);
});

test('clave: un hash corrupto no lanza, solo falla', async () => {
  for (const malo of ['', 'basura', 'scrypt$solo-una-parte', 'md5$aa$bb', null]) {
    assert.equal(await verificar('x', malo), false);
  }
});

test('clave generada: legible y sin caracteres que se confundan al dictarla', () => {
  const c = generar();
  assert.equal(c.length, 10);
  assert.ok(!/[O0lI1]/.test(c), `"${c}" tiene caracteres ambiguos`);
});

// ═══════════════════════════════════════════════════════════════════
//  Entrar al panel
// ═══════════════════════════════════════════════════════════════════

test('el barbero entra escribiendo su contraseña', async () => {
  await comoBarbero(CLAVE);
  assert.ok(seEnvio(`Bienvenido ${barbero.nombre}`), textos().join(' | '));
});

test('una contraseña incorrecta NO abre el panel: lo trata como cliente', async () => {
  await comoBarbero('ClaveEquivocada');
  assert.ok(!seEnvio('Bienvenido ' + barbero.nombre), 'no debe entrar');
  assert.ok(seEnvio('BARBERÍA DEMO'), 'debe verlo como cliente normal');
});

test('la contraseña desde OTRO teléfono no abre el panel', async () => {
  await manejar({ de: CLIENTE, clase: 'texto', texto: CLAVE, idOpcion: null, barberia, nombrePerfil: 'Otro' });
  assert.ok(!seEnvio(`Bienvenido ${barbero.nombre}`), 'la clave sola no basta: el número importa');
});

test('el barbero también puede agendar como cliente normal', async () => {
  // Escribir su clave abre el panel, pero cualquier otra cosa no.
  await comoBarbero('hola');
  assert.ok(seEnvio('BARBERÍA DEMO'), 'debe poder usar el bot como cliente');
});

test('el menú del panel tiene las 4 opciones', async () => {
  await comoBarbero(CLAVE);
  const lista = simulado.todos().filter(m => m.interactive?.type === 'list').pop();
  const ids = lista.interactive.action.sections.flatMap(s => s.rows.map(r => r.id));
  assert.deepEqual(ids, ['panel_hoy', 'panel_manana', 'panel_fecha', 'panel_salir']);
});

test('ver la agenda de hoy', async () => {
  await comoBarbero(CLAVE);
  simulado.limpiar();
  await comoBarbero('', 'panel_hoy');
  assert.ok(seEnvio(`Agenda ${barbero.nombre} - Hoy`), textos().join(' | '));
});

test('salir del panel', async () => {
  await comoBarbero(CLAVE);
  simulado.limpiar();
  await comoBarbero('', 'panel_salir');
  assert.ok(seEnvio('Salió del panel'));
  const s = await consultarUna('SELECT 1 x FROM sesiones WHERE telefono = $1', [TEL_BARBERO]);
  assert.equal(s, null, 'la sesión debe cerrarse');
});

test('buscar por fecha: rechaza un formato inválido sin romperse', async () => {
  await comoBarbero(CLAVE);
  await comoBarbero('', 'panel_fecha');
  simulado.limpiar();
  await comoBarbero('mañana');
  assert.ok(seEnvio('No entendí esa fecha'));
});

test('buscar por fecha: acepta DD/MM/AAAA', async () => {
  await comoBarbero(CLAVE);
  await comoBarbero('', 'panel_fecha');
  simulado.limpiar();
  await comoBarbero('25/12/2026');
  assert.ok(seEnvio('Agenda'), textos().join(' | '));
});

// ═══════════════════════════════════════════════════════════════════
//  Formato de la agenda
// ═══════════════════════════════════════════════════════════════════

test('agenda: libres en verde, ocupados en rojo, teléfono sin código de país', () => {
  const t = formatearAgenda('Andrés', 'Hoy', [
    { hora: '09:00:00', libre: true },
    { hora: '09:35:00', libre: false, nombre: 'Juan', telefono: '573001112233' },
    { hora: '10:10:00', libre: false, bloqueo: true },
  ]);

  assert.ok(t.includes('🟢 9am - Libre'));
  assert.ok(t.includes('🔴 9:35am - Juan'));
  assert.ok(t.includes('📱 3001112233'), 'el teléfono va sin el 57');
  assert.ok(t.includes('🔴 10:10am - Descanso'));
  assert.ok(t.includes('2 de 3 ocupados'));
});

test('agenda: un día sin jornada lo dice, no sale vacío', () => {
  const t = formatearAgenda('Andrés', 'Hoy', []);
  assert.ok(t.includes('No hay jornada configurada'));
});

test('agenda: un turno en una hora YA NO configurada igual aparece', async () => {
  // Si al barbero le cambian el horario, los turnos ya agendados en las horas
  // viejas no pueden desaparecer: se quedaría esperando a un cliente que sí
  // tiene cita.
  const hoy = hoyEn(barberia.zona_horaria);
  await consultar(
    `INSERT INTO turnos (barberia_id, barbero_id, fecha, hora, cliente_nombre, cliente_telefono, inicio_en)
     VALUES ($1, $2, $3, '04:17:00', 'Cliente Viejo', $4, now())`,
    [barberia.id, barbero.id, hoy, CLIENTE]
  );

  const filas = await agendaDe(barbero.id, hoy);
  const raro = filas.find(f => f.hora === '04:17:00');

  assert.ok(raro, 'el turno histórico debe aparecer');
  assert.equal(raro.nombre, 'Cliente Viejo');
  assert.equal(filas[0].hora, '04:17:00', 'y debe quedar ordenado por hora');

  await consultar('DELETE FROM turnos WHERE cliente_telefono = $1', [CLIENTE]);
});

// ═══════════════════════════════════════════════════════════════════
//  Plantillas
// ═══════════════════════════════════════════════════════════════════

test('plantilla: la estructura es la que espera Meta', () => {
  const m = plantilla('573001112233', 'turno_nuevo', 'es', ['Juan', 'Andrés', 'Lunes 1', '9am', '3001112233']);

  assert.equal(m.type, 'template');
  assert.equal(m.template.name, 'turno_nuevo');
  assert.equal(m.template.language.code, 'es');
  assert.equal(m.template.components[0].type, 'body');
  assert.equal(m.template.components[0].parameters.length, 5);
  assert.deepEqual(m.template.components[0].parameters[0], { type: 'text', text: 'Juan' });
});

test('plantilla: los parámetros conservan el orden', () => {
  const m = plantilla('57300', 'x', 'es', ['primero', 'segundo', 'tercero']);
  assert.deepEqual(
    m.template.components[0].parameters.map(p => p.text),
    ['primero', 'segundo', 'tercero']
  );
});

test('plantilla: un parámetro nulo no rompe el envío', () => {
  const m = plantilla('57300', 'x', 'es', ['a', null, undefined]);
  assert.equal(m.template.components[0].parameters[1].text, '');
});

// ═══════════════════════════════════════════════════════════════════
//  Recordatorios
// ═══════════════════════════════════════════════════════════════════

test('la frecuencia del barrido cubre la ventana', () => {
  // ⚠️ Están atadas: con una ventana de 10 minutos, un barrido más espaciado
  // dejaría turnos que nunca caen dentro y se quedan sin recordatorio.
  const ventana = VENTANA_HASTA - VENTANA_DESDE;
  assert.ok(CADA_MINUTOS <= ventana, `barrido cada ${CADA_MINUTOS} min con ventana de ${ventana}`);
});

test('recordatorios: encuentra un turno dentro de la ventana', async () => {
  const filas = await consultar(
    `INSERT INTO turnos (barberia_id, barbero_id, fecha, hora, cliente_nombre, cliente_telefono, inicio_en)
     VALUES ($1, $2, CURRENT_DATE, '23:59:00', 'Juan', $3, now() + INTERVAL '60 minutes')
     RETURNING id`,
    [barberia.id, barbero.id, CLIENTE]
  );

  const lista = await pendientes();
  assert.ok(lista.some(t => t.id === filas[0].id), 'debería estar en la lista');

  await consultar('DELETE FROM turnos WHERE id = $1', [filas[0].id]);
});

test('recordatorios: un BLOQUEO nunca entra en la lista', async () => {
  // Sin este filtro, el sistema intentaría mandarle WhatsApp a un teléfono
  // vacío cada 5 minutos, para siempre. Era una trampa real del bot anterior.
  const filas = await consultar(
    `INSERT INTO turnos (barberia_id, barbero_id, fecha, hora, tipo, cliente_nombre, inicio_en)
     VALUES ($1, $2, CURRENT_DATE, '23:58:00', 'bloqueo', 'Descanso', now() + INTERVAL '60 minutes')
     RETURNING id`,
    [barberia.id, barbero.id]
  );

  const lista = await pendientes();
  assert.ok(!lista.some(t => t.id === filas[0].id), 'un bloqueo no lleva recordatorio');

  await consultar('DELETE FROM turnos WHERE id = $1', [filas[0].id]);
});

test('recordatorios: uno ya enviado no se repite', async () => {
  const filas = await consultar(
    `INSERT INTO turnos (barberia_id, barbero_id, fecha, hora, cliente_nombre, cliente_telefono,
                         inicio_en, recordatorio_enviado)
     VALUES ($1, $2, CURRENT_DATE, '23:57:00', 'Juan', $3, now() + INTERVAL '60 minutes', TRUE)
     RETURNING id`,
    [barberia.id, barbero.id, CLIENTE]
  );

  const lista = await pendientes();
  assert.ok(!lista.some(t => t.id === filas[0].id));

  await consultar('DELETE FROM turnos WHERE id = $1', [filas[0].id]);
});

test('recordatorios: uno de mañana todavía no entra', async () => {
  const filas = await consultar(
    `INSERT INTO turnos (barberia_id, barbero_id, fecha, hora, cliente_nombre, cliente_telefono, inicio_en)
     VALUES ($1, $2, CURRENT_DATE + 1, '23:56:00', 'Juan', $3, now() + INTERVAL '20 hours')
     RETURNING id`,
    [barberia.id, barbero.id, CLIENTE]
  );

  const lista = await pendientes();
  assert.ok(!lista.some(t => t.id === filas[0].id), 'solo entran los de dentro de ~1 hora');

  await consultar('DELETE FROM turnos WHERE id = $1', [filas[0].id]);
});
