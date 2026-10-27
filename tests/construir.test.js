import { test } from 'node:test';
import assert from 'node:assert/strict';

import { listaConNavegacion, contarFilas, botones, texto, TOPES } from '../src/mensajes/construir.js';
import { partirEnJornadas, necesitaPantallaDeJornada } from '../src/servicios/horarios.js';

const filas = (n, prefijo = 'op') =>
  Array.from({ length: n }, (_, i) => ({ id: `${prefijo}_${i + 1}`, titulo: `Opción ${i + 1}` }));

const NAV = [
  { id: 'nav_volver', titulo: '⬅️ Volver' },
  { id: 'nav_menu',   titulo: '🏠 Menú principal' },
];

// ═══════════════════════════════════════════════════════════════════
//  El tope de 10 filas — el fallo más visible del bot
// ═══════════════════════════════════════════════════════════════════

test('lista: 8 opciones + 2 de navegación = exactamente 10', () => {
  const { mensaje } = listaConNavegacion('57300', { cuerpo: 'x', secciones: [{ titulo: 'S', filas: filas(8) }], navegacion: NAV });
  assert.equal(contarFilas(mensaje), 10);
});

test('lista: con 10 opciones se sacrifica navegación, NUNCA se pasa de 10', () => {
  // Este es el caso que rompía la cancelación cuando alguien tenía 10 turnos.
  const { mensaje } = listaConNavegacion('57300', { cuerpo: 'x', secciones: [{ titulo: 'S', filas: filas(10) }], navegacion: NAV });
  assert.equal(contarFilas(mensaje), 10);
});

test('lista: nunca excede el tope, con cualquier cantidad', () => {
  for (const n of [1, 5, 9, 10, 11, 16, 30]) {
    const { mensaje } = listaConNavegacion('57300', { cuerpo: 'x', secciones: [{ titulo: 'S', filas: filas(n) }], navegacion: NAV });
    assert.ok(contarFilas(mensaje) <= TOPES.FILAS, `con ${n} opciones dio ${contarFilas(mensaje)} filas`);
  }
});

test('lista: se sacrifica "Menú principal" antes que "Volver"', () => {
  const { mensaje } = listaConNavegacion('57300', { cuerpo: 'x', secciones: [{ titulo: 'S', filas: filas(9) }], navegacion: NAV });
  const ids = mensaje.interactive.action.sections.flatMap(s => s.rows.map(r => r.id));
  assert.ok(ids.includes('nav_volver'), 'Volver debe sobrevivir');
  assert.ok(!ids.includes('nav_menu'), 'Menú principal es el primero que se cae');
});

test('lista: las opciones reales nunca se recortan por la navegación', () => {
  const { mensaje } = listaConNavegacion('57300', { cuerpo: 'x', secciones: [{ titulo: 'S', filas: filas(10) }], navegacion: NAV });
  const ids = mensaje.interactive.action.sections.flatMap(s => s.rows.map(r => r.id));
  assert.equal(ids.filter(i => i.startsWith('op_')).length, 10);
});

// ═══════════════════════════════════════════════════════════════════
//  Numeración
// ═══════════════════════════════════════════════════════════════════

test('numeración: corre seguida ENTRE secciones', () => {
  // Si se reiniciara por sección, el cliente que escribe "3" elegiría algo
  // distinto de lo que ve numerado como 3 en la pantalla.
  const { mensaje } = listaConNavegacion('57300', {
    cuerpo: 'x',
    secciones: [
      { titulo: '☀️ MAÑANA', filas: filas(3, 'm') },
      { titulo: '🌤️ TARDE',  filas: filas(3, 't') },
    ],
    navegacion: NAV,
  });

  const titulos = mensaje.interactive.action.sections.flatMap(s => s.rows.map(r => r.title));
  assert.deepEqual(titulos.map(t => Number(t.split('.')[0])), [1, 2, 3, 4, 5, 6, 7, 8]);
});

test('numeración: el mapa devuelto coincide con lo que ve el cliente', () => {
  const { mensaje, numeracion } = listaConNavegacion('57300', {
    cuerpo: 'x', secciones: [{ titulo: 'S', filas: filas(3) }], navegacion: NAV,
  });

  const enPantalla = mensaje.interactive.action.sections.flatMap(s =>
    s.rows.map(r => ({ numero: Number(r.title.split('.')[0]), id: r.id }))
  );
  assert.deepEqual(numeracion, enPantalla);
  assert.equal(numeracion.find(n => n.numero === 4).id, 'nav_volver');
});

// ═══════════════════════════════════════════════════════════════════
//  Recortes de Meta
// ═══════════════════════════════════════════════════════════════════

test('recortes: títulos, descripciones y secciones respetan los topes', () => {
  const { mensaje } = listaConNavegacion('57300', {
    cuerpo: 'c',
    secciones: [{
      titulo: 'UNA SECCIÓN CON UN NOMBRE RIDÍCULAMENTE LARGO',
      filas: [{ id: 'x', titulo: 'Un título larguísimo que jamás cabría', descripcion: 'D'.repeat(200) }],
    }],
  });

  for (const s of mensaje.interactive.action.sections) {
    assert.ok(s.title.length <= TOPES.TITULO_SECCION, s.title);
    for (const r of s.rows) {
      assert.ok(r.title.length <= TOPES.TITULO_FILA, r.title);
      if (r.description) assert.ok(r.description.length <= TOPES.DESCRIPCION_FILA);
    }
  }
});

test('recortes: el cuerpo de un texto respeta el tope de 1024', () => {
  const m = texto('57300', 'x'.repeat(3000));
  assert.ok(m.text.body.length <= TOPES.CUERPO);
});

test('botones: nunca más de 3', () => {
  const m = botones('57300', 'Elige', [
    { id: '1', titulo: 'Uno' }, { id: '2', titulo: 'Dos' },
    { id: '3', titulo: 'Tres' }, { id: '4', titulo: 'Cuatro' },
  ]);
  assert.equal(m.interactive.action.buttons.length, 3);
});

test('botones: el texto respeta el tope de 20 caracteres', () => {
  const m = botones('57300', 'x', [{ id: '1', titulo: '📅 Agendar un turno ahora mismo' }]);
  assert.ok(m.interactive.action.buttons[0].reply.title.length <= TOPES.TEXTO_BOTON);
});

// ═══════════════════════════════════════════════════════════════════
//  Jornadas — la regla que el sistema anterior tuvo mal
// ═══════════════════════════════════════════════════════════════════

const MANANA = ['09:00:00', '09:35:00', '10:10:00', '10:45:00', '11:20:00', '11:55:00'];
const TARDE  = ['13:30:00', '14:05:00', '14:40:00', '15:15:00', '15:50:00', '16:25:00'];
const NOCHE  = ['17:00:00', '17:30:00', '18:00:00', '18:30:00'];
const DIA_COMPLETO = [...MANANA, ...TARDE, ...NOCHE];   // 16 turnos: el caso exigente

test('jornadas: un día de 16 turnos se parte en tres', () => {
  const j = partirEnJornadas(DIA_COMPLETO, DIA_COMPLETO);
  assert.equal(j.manana.length, 6);
  assert.equal(j.tarde.length, 6);
  assert.equal(j.tardenoche.length, 4);
});

test('jornadas: si la tarde cabe entera, no se parte en tres', () => {
  const corto = [...MANANA, '13:30:00', '14:05:00', '17:00:00'];
  const j = partirEnJornadas(corto, corto);
  assert.equal(j.tardenoche.length, 0);
  assert.equal(j.tarde.length, 3, 'la tarde-noche se fusiona con la tarde');
});

test('jornadas: la decisión se toma sobre el día COMPLETO, no sobre lo libre', () => {
  // EL error real del sistema anterior. Con casi todo el día ocupado, quedan
  // pocos libres; si se decidiera con esos, la tarde-noche desaparecería y el
  // cliente vería una pantalla distinta según cuánta gente hubiera agendado.
  const soloQuedan = ['13:30:00', '17:00:00'];

  const conReferencia = partirEnJornadas(soloQuedan, DIA_COMPLETO);
  assert.equal(conReferencia.tardenoche.length, 1, 'la tarde-noche se mantiene');

  const sinReferencia = partirEnJornadas(soloQuedan, null);
  assert.equal(sinReferencia.tardenoche.length, 0, 'sin referencia se fusiona: pantalla inestable');
});

test('jornadas: los cortes son 12:00 y 17:00', () => {
  const j = partirEnJornadas(['11:59:00', '12:00:00', '16:59:00', '17:00:00'], DIA_COMPLETO);
  assert.deepEqual(j.manana, ['11:59:00']);
  assert.deepEqual(j.tarde, ['12:00:00', '16:59:00']);
  assert.deepEqual(j.tardenoche, ['17:00:00']);
});

test('jornadas: con 8 turnos libres o menos se salta la pantalla', () => {
  assert.equal(necesitaPantallaDeJornada(new Array(8).fill('x')), false);
  assert.equal(necesitaPantallaDeJornada(new Array(9).fill('x')), true);
});

test('jornadas: no lanza con un día vacío', () => {
  const j = partirEnJornadas([], []);
  assert.deepEqual(j, { manana: [], tarde: [], tardenoche: [] });
});
