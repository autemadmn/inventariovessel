import test from 'node:test';
import assert from 'node:assert/strict';
import { computeForecast, computePurchase, casesFor } from '../public/js/shared/forecast.js';
import { businessDate, periodRange, weekday } from '../server/dates.js';

const nights = (dates) => dates.map((date) => ({ date, weekday: weekday(date) }));
const products = [{ id: 1, name: 'A' }, { id: 2, name: 'B' }];

function monthOfFridaysAndSaturdays() {
  // 12 noches: vie y sáb de 6 semanas de septiembre-octubre 2026.
  const out = [];
  for (let w = 0; w < 6; w++) {
    const fri = new Date(Date.UTC(2026, 8, 4 + 7 * w));
    const sat = new Date(Date.UTC(2026, 8, 5 + 7 * w));
    out.push(fri.toISOString().slice(0, 10), sat.toISOString().slice(0, 10));
  }
  return out;
}

test('50 botellas en un mes → previsión de unas 50 si el siguiente tiene las mismas noches', () => {
  const base = monthOfFridaysAndSaturdays();
  // Reparto irregular que suma 50.
  const deliveries = base.map((date, i) => ({ product_id: 1, date, qty: i < 2 ? 5 : 4 }));
  assert.equal(deliveries.reduce((a, d) => a + d.qty, 0), 50);
  const r = computeForecast({ products, baseNights: nights(base), deliveries, plannedNights: nights(base), method: 'average' });
  assert.equal(r.rows[0].need, 50);
  assert.equal(r.rows[0].baseTotal, 50);
  assert.equal(r.rows[1].need, 0);
});

test('si cambian las noches de apertura se usa el promedio por noche', () => {
  const base = monthOfFridaysAndSaturdays();
  const deliveries = base.map((date) => ({ product_id: 1, date, qty: 5 })); // 60 en 12 noches
  const planned = [...base, '2026-10-16', '2026-10-17', '2026-10-15']; // 15 noches
  const r = computeForecast({ products, baseNights: nights(base), deliveries, plannedNights: nights(planned), method: 'average' });
  assert.equal(r.rows[0].avgPerNight, 5);
  assert.equal(r.rows[0].need, 75);
});

test('días de la semana: solo con historial suficiente y reflejando la diferencia entre jornadas', () => {
  const base = monthOfFridaysAndSaturdays();
  const deliveries = base.map((date) => ({ product_id: 1, date, qty: weekday(date) === 6 ? 8 : 2 }));
  const planned = nights(['2026-10-23', '2026-10-24', '2026-10-31']); // vie, sáb, sáb
  const r = computeForecast({ products, baseNights: nights(base), deliveries, plannedNights: planned, method: 'auto' });
  assert.equal(r.summary.weekdayAvailable, true);
  assert.equal(r.summary.methodUsed, 'weekday');
  assert.equal(r.rows[0].need, 2 + 8 + 8);

  // Con solo 2 noches de cada día no se distinguen días.
  const few = base.slice(0, 4);
  const r2 = computeForecast({ products, baseNights: nights(few), deliveries, plannedNights: planned, method: 'weekday' });
  assert.equal(r2.summary.weekdayAvailable, false);
  assert.equal(r2.summary.methodUsed, 'average');
  assert.equal(r2.rows[0].need, 5 * 3);
});

test('evento especial, margen de seguridad y estimación manual', () => {
  const base = monthOfFridaysAndSaturdays();
  const deliveries = base.map((date) => ({ product_id: 1, date, qty: 5 }));
  const r = computeForecast({
    products, baseNights: nights(base), deliveries, plannedNights: nights(base.slice(0, 2)),
    method: 'average', eventPct: 20, safetyPct: 10, manual: { 2: 7 },
  });
  assert.equal(r.rows[0].calculated, 10);
  assert.equal(r.rows[0].need, 12);
  assert.equal(r.rows[0].safety, 1.2);
  assert.equal(r.rows[0].total, 13.2);
  assert.equal(r.rows[1].manual, 7);
  assert.equal(r.rows[1].need, 8.4);
});

test('avisos: pocos datos, agotado y solicitudes no servidas (sin sumarlas)', () => {
  const base = ['2026-09-04'];
  const r = computeForecast({
    products, baseNights: nights(base), deliveries: [{ product_id: 1, date: base[0], qty: 3 }],
    plannedNights: nights(base), stockoutNights: { 1: 1 }, unserved: { 1: 4 },
  });
  assert.equal(r.summary.lowData, true);
  const codes = r.rows[0].warnings.map((w) => w.code);
  assert.deepEqual(codes.sort(), ['low_data', 'stockout', 'unserved']);
  assert.equal(r.rows[0].need, 3, 'las no servidas no se suman');
});

test('compra = necesidad + margen − existencias disponibles − entregas previstas', () => {
  assert.equal(computePurchase({ need: 50, safety: 5, stock: 20, incoming: 10 }).bottles, 25);
  // Nunca negativo.
  assert.equal(computePurchase({ need: 10, safety: 1, stock: 40 }).bottles, 0);
  // Se redondea hacia arriba a botellas enteras.
  assert.equal(computePurchase({ need: 12.2, safety: 1.2 }).bottles, 14);
  assert.equal(computePurchase({ need: 5, safety: 0 }).bottles, 5);
  // Las salidas a otros destinos reducen lo disponible, sin bajar de 0.
  assert.equal(computePurchase({ need: 20, stock: 15, otherOut: 5 }).bottles, 10);
  assert.equal(computePurchase({ need: 20, stock: 3, otherOut: 10 }).bottles, 20);
});

test('expresión en cajas con unidades adicionales', () => {
  assert.deepEqual(casesFor(27, 12), { perCase: 12, fullCases: 2, loose: 3, casesRoundedUp: 3, extraIfCases: 9 });
  assert.equal(casesFor(27, null).perCase, null);
  const r = computePurchase({ need: 24, perCase: 6 });
  assert.equal(r.fullCases, 4);
  assert.equal(r.loose, 0);
});

test('la noche de trabajo continúa después de medianoche', () => {
  // Septiembre en Madrid = UTC+2.
  assert.equal(businessDate(new Date('2026-09-26T21:00:00Z'), 'Europe/Madrid', 12), '2026-09-26'); // 23:00
  assert.equal(businessDate(new Date('2026-09-26T23:30:00Z'), 'Europe/Madrid', 12), '2026-09-26'); // 01:30
  assert.equal(businessDate(new Date('2026-09-27T04:00:00Z'), 'Europe/Madrid', 12), '2026-09-26'); // 06:00
  assert.equal(businessDate(new Date('2026-09-27T10:30:00Z'), 'Europe/Madrid', 12), '2026-09-27'); // 12:30
});

test('rangos de semana y mes', () => {
  assert.deepEqual(periodRange('week', '2026-09-27').from, '2026-09-21');
  assert.deepEqual(periodRange('week', '2026-09-27').to, '2026-09-27');
  assert.deepEqual(periodRange('month', '2026-02-10').to, '2026-02-28');
});
