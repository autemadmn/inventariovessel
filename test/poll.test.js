import test from 'node:test';
import assert from 'node:assert/strict';
import { pollDelay } from '../public/js/poll.js';

const MIN = 60000;

test('consulta deprisa solo donde hace falta', () => {
  assert.equal(pollDelay('reponer', 0), 6000);
  assert.equal(pollDelay('reponer', 60 * MIN), 6000, 'Reponer no se frena aunque nadie toque');
  assert.equal(pollDelay('pedir', 0), 5000);
  assert.equal(pollDelay('almacen', 0), 15000);
  assert.equal(pollDelay('pedir', 5 * MIN), 30000);
  assert.equal(pollDelay('gestion', 20 * MIN), 120000);
});

test('una pantalla olvidada encendida gasta poco', () => {
  // 24 horas en Pedir sin que nadie la toque: menos de 1.000 consultas al día.
  const perDay = (24 * 60 * MIN) / pollDelay('pedir', 60 * MIN);
  assert.ok(perDay < 1000, `${perDay} consultas`);
  // Antes eran 21.600 (una cada 4 segundos).
});
