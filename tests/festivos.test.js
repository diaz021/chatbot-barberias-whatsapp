/**
 * Festivos colombianos.
 *
 * La mayoría son cálculo puro y no tocan la base. Las últimas dos sí: crean
 * su PROPIO barbero y lo borran, porque comprueban que el bot y el panel
 * eligen la misma jornada en un festivo, y eso solo se ve de punta a punta.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

import {
  domingoDePascua, festivosDe, esFestivo, nombreDelFestivo, diaDeHorario,
} from '../src/config/festivos.js';
import { diaSemana } from '../src/config/fechas.js';
import { turnosDelDia } from '../src/servicios/horarios.js';
import { armarSemana, lunesDeLaSemana } from '../src/servicios/agendaSemana.js';
import { consultar, consultarUna, cerrarPool } from '../src/db/pool.js';

// ═══════════════════════════════════════════════════════════════════
//  La Pascua
// ═══════════════════════════════════════════════════════════════════

test('la Pascua cae donde cayó de verdad', () => {
  // Años comprobados contra el calendario. Si alguien toca el algoritmo,
  // esto salta antes de que un Jueves Santo aparezca como día laboral.
  const conocidos = {
    2024: '2024-03-31',
    2025: '2025-04-20',
    2026: '2026-04-05',
    2027: '2027-03-28',
    2028: '2028-04-16',
  };

  for (const [anio, esperado] of Object.entries(conocidos)) {
    assert.equal(domingoDePascua(Number(anio)), esperado, `Pascua de ${anio}`);
  }
});

test('la Pascua siempre cae en domingo', () => {
  for (let anio = 2026; anio <= 2050; anio++) {
    assert.equal(diaSemana(domingoDePascua(anio)), 0, `Pascua de ${anio}`);
  }
});

// ═══════════════════════════════════════════════════════════════════
//  El calendario
// ═══════════════════════════════════════════════════════════════════

test('son 18 festivos, o 17 cuando dos caen el mismo día', () => {
  for (let anio = 2026; anio <= 2060; anio++) {
    const n = festivosDe(anio).size;
    assert.ok(n === 18 || n === 17, `festivos de ${anio}: ${n}`);
  }
});

test('cuando dos festivos chocan, no se pierde el día', () => {
  // Caso real: en 2030 San Pedro y San Pablo se corre al lunes 1 de julio,
  // que es el mismo día al que llega el Sagrado Corazón. Ese año Colombia
  // tiene 17 festivos, no 18 — pero el 1 de julio sigue siendo festivo.
  assert.equal(festivosDe(2030).size, 17);
  assert.ok(esFestivo('2030-07-01'));
  assert.equal(nombreDelFestivo('2030-07-01'), 'San Pedro y San Pablo');
  assert.equal(diaDeHorario('2030-07-01'), 0, 'se trabaja como domingo');
});

test('los de fecha fija no se mueven', () => {
  for (const f of ['2026-01-01', '2026-05-01', '2026-07-20',
                   '2026-08-07', '2026-12-08', '2026-12-25']) {
    assert.ok(esFestivo(f), `${f} debería ser festivo`);
  }

  assert.equal(nombreDelFestivo('2026-01-01'), 'Año Nuevo');
  assert.equal(nombreDelFestivo('2026-12-25'), 'Navidad');
});

test('la Ley Emiliani corre el festivo al lunes siguiente', () => {
  // Reyes 2026 cae martes 6 → se celebra el lunes 12.
  assert.equal(esFestivo('2026-01-06'), false, 'el 6 ya no es festivo');
  assert.equal(nombreDelFestivo('2026-01-12'), 'Reyes Magos');

  // Todos los Santos 2026 cae en domingo 1 → lunes 2.
  assert.equal(nombreDelFestivo('2026-11-02'), 'Todos los Santos');

  // Día de la Raza 2026 YA cae en lunes: se queda donde está.
  assert.equal(nombreDelFestivo('2026-10-12'), 'Día de la Raza');
});

test('ningún festivo trasladable cae fuera de un lunes', () => {
  const trasladables = new Set([
    'Reyes Magos', 'San José', 'San Pedro y San Pablo', 'Asunción de la Virgen',
    'Día de la Raza', 'Todos los Santos', 'Independencia de Cartagena',
    'Ascensión del Señor', 'Corpus Christi', 'Sagrado Corazón de Jesús',
  ]);

  for (let anio = 2026; anio <= 2040; anio++) {
    for (const [fecha, nombre] of festivosDe(anio)) {
      if (trasladables.has(nombre)) {
        assert.equal(diaSemana(fecha), 1, `${nombre} de ${anio} (${fecha}) no es lunes`);
      }
    }
  }
});

test('los festivos de Semana Santa cuentan desde la Pascua', () => {
  // Pascua 2026 = domingo 5 de abril.
  assert.equal(nombreDelFestivo('2026-04-02'), 'Jueves Santo');
  assert.equal(nombreDelFestivo('2026-04-03'), 'Viernes Santo');

  // Y estos además se corren al lunes.
  assert.equal(nombreDelFestivo('2026-05-18'), 'Ascensión del Señor');
  assert.equal(nombreDelFestivo('2026-06-08'), 'Corpus Christi');
  assert.equal(nombreDelFestivo('2026-06-15'), 'Sagrado Corazón de Jesús');
});

test('un día cualquiera no es festivo', () => {
  for (const f of ['2026-09-14', '2026-02-11', '2026-07-21', '2026-12-26']) {
    assert.equal(esFestivo(f), false, `${f} no debería ser festivo`);
    assert.equal(nombreDelFestivo(f), null);
  }
});

test('no se cae con una fecha vacía', () => {
  assert.equal(esFestivo(null), false);
  assert.equal(esFestivo(''), false);
  assert.equal(nombreDelFestivo(undefined), null);
});

// ═══════════════════════════════════════════════════════════════════
//  La regla del negocio
// ═══════════════════════════════════════════════════════════════════

test('un festivo se atiende con la jornada del domingo', () => {
  // Lunes 12 de octubre de 2026, Día de la Raza.
  assert.equal(diaSemana('2026-10-12'), 1, 'es lunes');
  assert.equal(diaDeHorario('2026-10-12'), 0, 'pero se trabaja como domingo');
});

test('un día normal usa su propio día de la semana', () => {
  for (const f of ['2026-09-14', '2026-09-15', '2026-09-19', '2026-09-20']) {
    assert.equal(diaDeHorario(f), diaSemana(f), f);
  }
});

test('un festivo que ya es domingo sigue siendo domingo', () => {
  // 1 de noviembre de 2026 cae en domingo; el festivo se corre al lunes 2,
  // así que el domingo 1 NO es festivo — y aun así toca jornada de domingo.
  assert.equal(diaSemana('2026-11-01'), 0);
  assert.equal(diaDeHorario('2026-11-01'), 0);
});

// ═══════════════════════════════════════════════════════════════════
//  De punta a punta: el bot y el panel tienen que coincidir
// ═══════════════════════════════════════════════════════════════════

const FESTIVO = '2026-10-12';   // lunes, Día de la Raza
const NORMAL = '2026-10-19';    // el lunes siguiente, normal

const DOMINGO = ['09:00:00', '09:30:00'];
const LUNES = ['14:00:00', '14:30:00', '15:00:00'];

let barberia, barbero;

before(async () => {
  barberia = await consultarUna(
    `SELECT id, zona_horaria FROM barberias WHERE nombre = 'Barbería Demo'`
  );

  // Un barbero PROPIO, con domingo y lunes deliberadamente distintos, para
  // que se note cuál de los dos se aplicó. Se borra al terminar.
  //
  // ⚠️ `activo = FALSE` a propósito: así no aparece nunca en la lista que ve
  // un cliente (`barberosDe()` filtra por activo) mientras otros archivos de
  // prueba corren en paralelo. Ni `turnosDelDia()` ni `armarSemana()` miran
  // esa columna —trabajan sobre un barbero ya elegido—, así que para lo que
  // se comprueba aquí da igual.
  const creado = await consultar(
    `INSERT INTO barberos (barberia_id, nombre, telefono, orden, activo)
     VALUES ($1, 'ZZZ Barbero festivos', '573001110002', 97, FALSE) RETURNING id`,
    [barberia.id]
  );
  barbero = creado[0];

  await consultar(
    `INSERT INTO horarios (barbero_id, dia_semana, turnos)
     VALUES ($1, 0, $2::time[]), ($1, 1, $3::time[])`,
    [barbero.id, DOMINGO, LUNES]
  );
});

after(async () => {
  await consultar('DELETE FROM barberos WHERE id = $1', [barbero.id]);   // cascada
  await cerrarPool();
});

test('el bot ofrece la jornada del domingo en un festivo', async () => {
  assert.deepEqual(await turnosDelDia(barbero.id, FESTIVO), DOMINGO);
});

test('el bot ofrece la jornada del lunes en un lunes normal', async () => {
  assert.deepEqual(await turnosDelDia(barbero.id, NORMAL), LUNES);
});

/** Las horas que ese día NO están cerradas, en orden. */
const abiertas = (dia) =>
  Object.entries(dia.celdas)
    .filter(([, celda]) => celda.estado !== 'cerrado')
    .map(([hora]) => hora)
    .sort();

test('el panel enseña lo mismo que el bot en un festivo', async () => {
  const semana = await armarSemana(barbero.id, lunesDeLaSemana(FESTIVO), barberia.zona_horaria);
  const lunes = semana.dias.find(d => d.fecha === FESTIVO);

  assert.equal(lunes.festivo, 'Día de la Raza', 'el panel lo marca como festivo');
  assert.deepEqual(abiertas(lunes), DOMINGO, 'abre las horas del domingo');
  assert.deepEqual(await turnosDelDia(barbero.id, FESTIVO), abiertas(lunes),
    'y son exactamente las mismas que le ofrece el bot al cliente');
});

test('el panel enseña las horas del lunes en un lunes normal', async () => {
  const semana = await armarSemana(barbero.id, lunesDeLaSemana(NORMAL), barberia.zona_horaria);
  const lunes = semana.dias.find(d => d.fecha === NORMAL);

  assert.equal(lunes.festivo, null);
  assert.deepEqual(abiertas(lunes), LUNES);
  assert.deepEqual(await turnosDelDia(barbero.id, NORMAL), abiertas(lunes));
});

test('en una semana sin festivos el panel no marca ninguno', async () => {
  const semana = await armarSemana(barbero.id, lunesDeLaSemana(NORMAL), barberia.zona_horaria);
  assert.equal(semana.dias.every(d => d.festivo === null), true);
});
