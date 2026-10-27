import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  diaSemana, sumarDias, fechaVisible, fechaCorta,
  horaVisible, horaEnMinutos, horaNormal, instanteDe, hoyEn,
} from '../src/config/fechas.js';

const BOGOTA = 'America/Bogota';

test('diaSemana: 0 es domingo', () => {
  assert.equal(diaSemana('2026-09-13'), 0);   // domingo
  assert.equal(diaSemana('2026-09-14'), 1);   // lunes
  assert.equal(diaSemana('2026-09-19'), 6);   // sábado
});

test('sumarDias: cruza fin de mes y de año', () => {
  assert.equal(sumarDias('2026-09-30', 1), '2026-10-01');
  assert.equal(sumarDias('2026-12-31', 1), '2027-01-01');
  assert.equal(sumarDias('2028-02-28', 1), '2028-02-29');   // bisiesto
});

test('fechaVisible y fechaCorta', () => {
  assert.equal(fechaVisible('2026-09-19'), 'Sábado 19 de septiembre');
  assert.equal(fechaCorta('2026-09-19'), 'Sábado 19');
});

test('fechaCorta cabe en el tope de 24 caracteres de Meta', () => {
  // Miércoles es el día más largo; 31 el número más largo.
  assert.ok(fechaCorta('2026-12-30').length <= 24, fechaCorta('2026-12-30'));
});

test('horaVisible: el formato exacto que ya usan los clientes', () => {
  assert.equal(horaVisible('09:00:00'), '9am');
  assert.equal(horaVisible('10:45:00'), '10:45am');
  assert.equal(horaVisible('13:30:00'), '1:30pm');
  assert.equal(horaVisible('17:00:00'), '5pm');
  assert.equal(horaVisible('18:30:00'), '6:30pm');
});

test('horaVisible: mediodía y medianoche no se confunden', () => {
  assert.equal(horaVisible('12:00:00'), '12pm');
  assert.equal(horaVisible('00:00:00'), '12am');
  assert.equal(horaVisible('12:30:00'), '12:30pm');
});

test('horaEnMinutos', () => {
  assert.equal(horaEnMinutos('00:00:00'), 0);
  assert.equal(horaEnMinutos('09:35:00'), 575);
  assert.equal(horaEnMinutos('13:30:00'), 810);
});

test('horaNormal rellena a HH:MM:SS', () => {
  assert.equal(horaNormal('9:00'), '09:00:00');
  assert.equal(horaNormal('09:05:00'), '09:05:00');
});

test('instanteDe: 9am en Bogotá son las 14:00 UTC', () => {
  // Colombia es UTC-5 todo el año.
  const t = instanteDe('2026-09-19', '09:00:00', BOGOTA);
  assert.equal(t.toISOString(), '2026-09-19T14:00:00.000Z');
});

test('instanteDe: un turno de las 6:30pm NO se pasa al día siguiente', () => {
  // Este es EL error de zona horaria del sistema anterior. 18:30 en Bogotá
  // son las 23:30 UTC del MISMO día. Si el cálculo se corriera una hora más,
  // el turno saltaría al día siguiente y desaparecería de la agenda.
  const t = instanteDe('2026-09-19', '18:30:00', BOGOTA);
  assert.equal(t.toISOString(), '2026-09-19T23:30:00.000Z');
});

test('instanteDe: funciona con una zona que sí tiene horario de verano', () => {
  // Madrid en verano es UTC+2, en invierno UTC+1. Si el desfase estuviera
  // fijo en el código, uno de los dos saldría mal.
  const verano   = instanteDe('2026-07-15', '12:00:00', 'Europe/Madrid');
  const invierno = instanteDe('2026-01-15', '12:00:00', 'Europe/Madrid');
  assert.equal(verano.toISOString(),   '2026-07-15T10:00:00.000Z');
  assert.equal(invierno.toISOString(), '2026-01-15T11:00:00.000Z');
});

test('hoyEn devuelve formato YYYY-MM-DD', () => {
  assert.match(hoyEn(BOGOTA), /^\d{4}-\d{2}-\d{2}$/);
});

test('hoyEn: Bogotá y Tokio no siempre están en el mismo día', () => {
  // No se afirma cuál es cuál (depende de la hora real al correr la prueba),
  // solo que la zona SE TIENE EN CUENTA y no se usa la del servidor.
  const bogota = hoyEn(BOGOTA);
  const tokio  = hoyEn('Asia/Tokyo');
  assert.ok(tokio >= bogota, `Tokio (${tokio}) nunca va detrás de Bogotá (${bogota})`);
});
