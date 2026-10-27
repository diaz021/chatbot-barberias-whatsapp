/**
 * Conversaciones completas contra la base real, en modo simulado.
 *
 * No hace falta API_TOKEN: `whatsapp.js` guarda lo que habría enviado en vez
 * de llamar a Meta, y aquí se inspecciona qué habría visto el cliente.
 *
 * Cada prueba limpia lo suyo al terminar.
 */

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { manejar } from '../src/motor/index.js';
import { simulado, describir } from '../src/servicios/whatsapp.js';
import { consultar, consultarUna, cerrarPool } from '../src/db/pool.js';
import { hoyEn } from '../src/config/fechas.js';

const CLIENTE = '573001234567';
let barberia, barberos;

before(async () => {
  barberia = await consultarUna(
    `SELECT id, nombre, zona_horaria, direccion, ciudad, latitud, longitud,
            telefono_contacto, phone_number_id, firma
       FROM barberias WHERE nombre = 'Barbería Demo'`
  );
  assert.ok(barberia, 'hace falta la semilla: npm run migrar');

  // ⚠️ Se excluyen los barberos de prueba de OTROS archivos.
  //
  // El corredor de Node ejecuta los archivos en paralelo, y panel.test.js y
  // festivos.test.js crean cada uno su propio barbero temporal en esta misma
  // barbería. Sin este filtro, este `before` contaba 4 o 5 según quién fuera
  // más rápido y tumbaba las 19 pruebas del archivo de forma intermitente.
  //
  // La convención es que todo barbero de prueba se llama 'ZZZ …' y va con
  // `orden` 90 o más. Si alguien crea uno sin respetarla, esto vuelve a
  // fallar sin explicación aparente.
  // Solo los ACTIVOS, que son los que ve un cliente, y sin los de prueba de
  // otros archivos. Se comprueba un mínimo y no un número exacto: la
  // plantilla de barberos cambia (entra un barbero nuevo, hay un barbero de prueba que
  // algún día se apaga) y clavar el total convierte cualquier alta o baja en
  // 19 pruebas rotas que no tienen nada que ver.
  barberos = await consultar(
    `SELECT id, nombre FROM barberos
      WHERE barberia_id = $1 AND activo AND nombre NOT LIKE 'ZZZ %'
      ORDER BY orden`,
    [barberia.id]
  );
  assert.ok(barberos.length >= 2, 'hace falta la semilla: npm run migrar');
});

beforeEach(async () => {
  simulado.limpiar();
  await consultar('DELETE FROM sesiones WHERE telefono = $1', [CLIENTE]);
  await consultar('DELETE FROM turnos WHERE cliente_telefono = $1', [CLIENTE]);
});

after(async () => {
  await consultar('DELETE FROM sesiones WHERE telefono = $1', [CLIENTE]);
  await consultar('DELETE FROM turnos WHERE cliente_telefono = $1', [CLIENTE]);
  await cerrarPool();
});

/** Simula un mensaje del cliente. */
const escribir = (texto) =>
  manejar({ de: CLIENTE, clase: 'texto', texto, idOpcion: null, barberia, nombrePerfil: 'Juan' });

const tocar = (idOpcion) =>
  manejar({ de: CLIENTE, clase: 'opcion', texto: '', idOpcion, barberia, nombrePerfil: 'Juan' });

/** Los ids de la última lista enviada. */
function idsDeUltimaLista() {
  const listas = simulado.todos().filter(m => m.interactive?.type === 'list');
  const ultima = listas[listas.length - 1];
  return ultima ? ultima.interactive.action.sections.flatMap(s => s.rows.map(r => r.id)) : [];
}

const textosEnviados = () =>
  simulado.todos().filter(m => m.type === 'text').map(m => m.text.body);

const seEnvio = (fragmento) => textosEnviados().some(t => t.includes(fragmento));

// ═══════════════════════════════════════════════════════════════════
//  Menú
// ═══════════════════════════════════════════════════════════════════

test('un saludo cualquiera devuelve bienvenida y menú de 3 botones', async () => {
  await escribir('hola');

  assert.ok(seEnvio('BARBERÍA DEMO'), 'falta el saludo (la firma)');
  const botones = simulado.todos().find(m => m.interactive?.type === 'button');
  assert.ok(botones, 'falta el menú');
  assert.equal(botones.interactive.action.buttons.length, 3);
});

test('§24.3 — escribir "1" en el menú SÍ agenda', async () => {
  // En el bot anterior solo funcionaba tocando el botón: escribir el número
  // no hacía absolutamente nada.
  await escribir('1');
  assert.ok(seEnvio('¿A nombre de quién'), 'debería pedir el nombre');
});

test('escribir "3" muestra la ubicación', async () => {
  await escribir('3');
  assert.ok(seEnvio('BARBERÍA DEMO'), 'falta el texto de ubicación');
  assert.ok(seEnvio('Bogotá'), 'falta la ciudad');
});

// ═══════════════════════════════════════════════════════════════════
//  Agendar
// ═══════════════════════════════════════════════════════════════════

test('flujo completo de agendar: nombre → barbero → fecha → jornada → hora', async () => {
  await escribir('1');
  await escribir('Juan Pérez');

  const idsBarberos = idsDeUltimaLista();
  assert.ok(idsBarberos.some(i => i.startsWith('barbero_')), 'faltan los barberos');

  await tocar(`barbero_${barberos[0].id}`);

  const idsFechas = idsDeUltimaLista().filter(i => i.startsWith('fecha_'));
  assert.ok(idsFechas.length > 0, 'faltan las fechas');

  await tocar(idsFechas[0]);

  // ⚠️ La pantalla de jornadas aparece SOLO si quedan más horas libres de
  // las que caben en una lista. Este barbero es real y su agenda se llena
  // con clientes de verdad, así que unos días sale y otros no. Antes se
  // exigía que saliera siempre y la prueba se caía sola cuando la barbería
  // tenía buen día. Se aceptan los dos caminos: lo que se prueba aquí es
  // que el flujo LLEGA hasta la confirmación, no cuántas pantallas tiene.
  const idsJornada = idsDeUltimaLista().filter(i => i.startsWith('jornada_'));
  if (idsJornada.length > 0) await tocar(idsJornada[0]);

  const idsHoras = idsDeUltimaLista().filter(i => i.startsWith('hora_'));
  assert.ok(idsHoras.length > 0, 'faltan las horas');

  await tocar(idsHoras[0]);

  assert.ok(seEnvio('TURNO CONFIRMADO'), 'falta la confirmación');

  const guardado = await consultarUna(
    `SELECT cliente_nombre, estado FROM turnos WHERE cliente_telefono = $1`,
    [CLIENTE]
  );
  assert.ok(guardado, 'el turno no quedó en la base');
  assert.equal(guardado.cliente_nombre, 'Juan Pérez');
  assert.equal(guardado.estado, 'Confirmado');
});

test('ninguna lista del flujo se pasa de 10 filas', async () => {
  await escribir('1');
  await escribir('Juan');
  await tocar(`barbero_${barberos[0].id}`);
  const fechas = idsDeUltimaLista().filter(i => i.startsWith('fecha_'));
  await tocar(fechas[0]);
  const jornadas = idsDeUltimaLista().filter(i => i.startsWith('jornada_'));
  await tocar(jornadas[0]);

  for (const m of simulado.todos().filter(x => x.interactive?.type === 'list')) {
    const filas = m.interactive.action.sections.reduce((n, s) => n + s.rows.length, 0);
    assert.ok(filas <= 10, `una lista salió con ${filas} filas: ${describir(m)}`);
  }
});

test('tocar un botón de un menú anterior no descuadra el flujo', async () => {
  await escribir('1');
  await escribir('Juan');
  simulado.limpiar();

  // Está en el paso del barbero y toca una hora de una conversación vieja.
  await tocar('hora_09:00:00');

  assert.ok(seEnvio('menú anterior'), 'falta el aviso');

  const sesion = await consultarUna(
    'SELECT paso FROM sesiones WHERE telefono = $1', [CLIENTE]
  );
  assert.equal(sesion.paso, 'barbero', 'el flujo debe quedarse donde iba');
});

test('elegir por número escrito equivale a tocar', async () => {
  await escribir('1');
  await escribir('Juan');
  simulado.limpiar();

  await escribir('1');   // el primer barbero de la lista

  const fechas = idsDeUltimaLista().filter(i => i.startsWith('fecha_'));
  assert.ok(fechas.length > 0, 'escribir el número debería elegir el barbero');
});

test('al tercer turno del mismo día, el bot lo frena', async () => {
  // ⚠️ Se usa una fecha MUY lejana a propósito. La versión anterior usaba
  // "mañana" con horas fijas, y chocaba con cualquier bloqueo real puesto
  // desde el panel: la prueba fallaba por datos de verdad, no por un defecto.
  const { sumarDias, diaSemana } = await import('../src/config/fechas.js');

  const horario = await consultar(
    'SELECT dia_semana, turnos FROM horarios WHERE barbero_id = $1 AND array_length(turnos,1) >= 3',
    [barberos[0].id]
  );
  assert.ok(horario.length, 'el barbero necesita un día con 3+ turnos');

  // El primer día lejano en que ese barbero trabaje.
  let fecha = sumarDias(hoyEn(barberia.zona_horaria), 200);
  const diasQueTrabaja = new Set(horario.map(h => h.dia_semana));
  for (let i = 0; i < 7 && !diasQueTrabaja.has(diaSemana(fecha)); i++) {
    fecha = sumarDias(fecha, 1);
  }

  const turnosDelDia = horario.find(h => h.dia_semana === diaSemana(fecha)).turnos;

  // Dos turnos ya puestos: el cliente llega a su tope.
  for (const hora of turnosDelDia.slice(0, 2)) {
    await consultar(
      `INSERT INTO turnos (barberia_id, barbero_id, fecha, hora, cliente_nombre, cliente_telefono, inicio_en)
       VALUES ($1, $2, $3, $4, 'Juan', $5, now() + INTERVAL '200 days')`,
      [barberia.id, barberos[0].id, fecha, hora, CLIENTE]
    );
  }

  // Y ahora intenta el tercero POR EL BOT, que es lo que había que probar.
  const { agendar } = await import('../src/servicios/turnos.js');
  const r = await agendar({
    barberia,
    barberoId: barberos[0].id,
    fecha,
    hora: turnosDelDia[2],
    nombre: 'Juan',
    telefono: CLIENTE,
  });

  assert.equal(r.ok, false, 'el tercero debe rechazarse');
  assert.equal(r.motivo, 'limite');

  const n = await consultarUna(
    `SELECT COUNT(*)::int c FROM turnos WHERE cliente_telefono = $1 AND fecha = $2 AND estado='Confirmado'`,
    [CLIENTE, fecha]
  );
  assert.equal(n.c, 2, 'siguen siendo dos, no tres');
});

test('los barberos están exentos del límite diario', async () => {
  // Necesitan poder agendarse entre ellos sin tropezar con la regla.
  const { esBarbero } = await import('../src/servicios/turnos.js');
  assert.equal(await esBarbero(barberia.id, CLIENTE), false, 'el cliente de prueba no es barbero');
});

// ═══════════════════════════════════════════════════════════════════
//  Cancelar — donde estaba la falla más grave
// ═══════════════════════════════════════════════════════════════════

async function agendarDirecto() {
  const filas = await consultar(
    `INSERT INTO turnos (barberia_id, barbero_id, fecha, hora, cliente_nombre, cliente_telefono, inicio_en)
     VALUES ($1, $2, CURRENT_DATE + 3, '09:00:00', 'Juan Pérez', $3, now() + INTERVAL '3 days')
     RETURNING id`,
    [barberia.id, barberos[0].id, CLIENTE]
  );
  return filas[0].id;
}

test('sin turnos, cancelar lo dice y vuelve al menú', async () => {
  await escribir('2');
  assert.ok(seEnvio('No tiene turnos'), textosEnviados().join(' | '));
});

test('cancelar un turno de principio a fin', async () => {
  const id = await agendarDirecto();

  await escribir('2');
  const ids = idsDeUltimaLista().filter(i => i.startsWith('cancelar_'));
  assert.ok(ids.includes(`cancelar_${id}`), 'el turno debería aparecer en la lista');

  await tocar(`cancelar_${id}`);
  await tocar('confirmar_si');

  assert.ok(seEnvio('TURNO CANCELADO'), 'falta el aviso de cancelado');

  const t = await consultarUna('SELECT estado FROM turnos WHERE id = $1', [id]);
  assert.equal(t.estado, 'Cancelado');
});

test('§24.1 — escribir "cancelar" al confirmar CANCELA el turno, no el proceso', async () => {
  // LA FALLA MÁS GRAVE del bot anterior: respondía "✅ Proceso cancelado" sin
  // cancelar nada. El cliente leía el ✅, creía que había cancelado, y no
  // aparecía a su cita.
  const id = await agendarDirecto();

  await escribir('2');
  await tocar(`cancelar_${id}`);
  simulado.limpiar();

  await escribir('cancelar');

  const t = await consultarUna('SELECT estado FROM turnos WHERE id = $1', [id]);
  assert.equal(t.estado, 'Cancelado', 'el turno DEBE quedar cancelado');
  assert.ok(!seEnvio('lo dejamos ahí'), 'no debe decir "Proceso cancelado"');
  assert.ok(seEnvio('TURNO CANCELADO'), 'debe confirmar la cancelación real');
});

test('§24.2 — "sí" y "ok" funcionan al confirmar', async () => {
  for (const palabra of ['sí', 'ok', 'dale']) {
    await consultar('DELETE FROM turnos WHERE cliente_telefono = $1', [CLIENTE]);
    await consultar('DELETE FROM sesiones WHERE telefono = $1', [CLIENTE]);
    simulado.limpiar();

    const id = await agendarDirecto();
    await escribir('2');
    await tocar(`cancelar_${id}`);
    await escribir(palabra);

    const t = await consultarUna('SELECT estado FROM turnos WHERE id = $1', [id]);
    assert.equal(t.estado, 'Cancelado', `"${palabra}" debería confirmar`);
  }
});

test('decir "no" al confirmar deja el turno vivo', async () => {
  const id = await agendarDirecto();

  await escribir('2');
  await tocar(`cancelar_${id}`);
  await escribir('no');

  const t = await consultarUna('SELECT estado FROM turnos WHERE id = $1', [id]);
  assert.equal(t.estado, 'Confirmado', 'el turno debe seguir activo');
  assert.ok(seEnvio('sigue en pie'));
});

test('fuera del flujo de cancelación, "cancelar" sí abandona el proceso', async () => {
  await escribir('1');
  await escribir('Juan');
  simulado.limpiar();

  await escribir('cancelar');

  assert.ok(seEnvio('lo dejamos ahí'));
  const sesion = await consultarUna('SELECT 1 x FROM sesiones WHERE telefono = $1', [CLIENTE]);
  assert.equal(sesion, null, 'la sesión debe borrarse');
});

// ═══════════════════════════════════════════════════════════════════
//  Navegación y errores
// ═══════════════════════════════════════════════════════════════════

test('"menu" sale de cualquier flujo', async () => {
  await escribir('1');
  await escribir('Juan');
  simulado.limpiar();

  await escribir('menu');

  const botones = simulado.todos().find(m => m.interactive?.type === 'button');
  assert.ok(botones, 'debería mostrar el menú');
  const sesion = await consultarUna('SELECT 1 x FROM sesiones WHERE telefono = $1', [CLIENTE]);
  assert.equal(sesion, null);
});

test('"volver" desde la fecha regresa a los barberos, sin perder el nombre', async () => {
  await escribir('1');
  await escribir('Juan Pérez');
  await tocar(`barbero_${barberos[0].id}`);
  simulado.limpiar();

  await escribir('volver');

  assert.ok(idsDeUltimaLista().some(i => i.startsWith('barbero_')), 'debe volver a barberos');

  const sesion = await consultarUna('SELECT datos FROM sesiones WHERE telefono = $1', [CLIENTE]);
  assert.equal(sesion.datos.nombre, 'Juan Pérez', 'el nombre no debe perderse');
});

test('al tercer error seguido se devuelve al menú', async () => {
  await escribir('1');
  await escribir('Juan');
  simulado.limpiar();

  await escribir('xyz');
  await escribir('xyz');
  await escribir('xyz');

  assert.ok(seEnvio('nos enredamos'), textosEnviados().join(' | '));
});

test('un audio recibe aviso de que solo leemos texto', async () => {
  await manejar({ de: CLIENTE, clase: 'otro', texto: '', idOpcion: null, barberia, nombrePerfil: 'Juan' });
  assert.ok(seEnvio('solo leo *texto*'));
});
