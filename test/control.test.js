import test from 'node:test';
import assert from 'node:assert/strict';
import { openPglite } from '../server/db-pglite.js';
import { createHandler } from '../server/handler.js';
import * as alm from '../server/almacen.js';
import * as control from '../server/control.js';
import * as svc from '../server/services.js';

const base = new Date('2026-10-10T20:00:00.000Z');
const at = (mins = 0) => new Date(base.getTime() + mins * 60_000).toISOString();
async function setup(t) {
  const db = await openPglite();
  t.after(() => db.end());
  const product = await db.get("SELECT id, name FROM products WHERE slug = 'larios-12'");
  return { db, product };
}
async function count(db, product_id, qty, mins, store_id = 1) {
  return alm.saveCounts(db, { store_id, items: [{ product_id, qty }], counted_at: at(mins), by: 'Ana' },
    { now: new Date(at(mins)) });
}
async function delivery(db, product_id, qty, mins) {
  await db.run('INSERT INTO sessions (business_date, created_at) VALUES (?, ?) ON CONFLICT (business_date) DO NOTHING',
    '2026-10-10', at(mins));
  const session = await db.get('SELECT id FROM sessions WHERE business_date = ?', '2026-10-10');
  return db.get(`INSERT INTO deliveries (session_id, bar_id, product_id, qty, delivered_at, source)
    VALUES (?, 1, ?, ?, ?, 'lista') RETURNING id`, session.id, product_id, qty, at(mins));
}
async function move(db, product_id, kind, qty, mins, fields = {}) {
  const defaults = kind === 'entrada' ? [null, 2] : kind === 'rotura' ? [1, null] : [2, 1];
  return db.get(`INSERT INTO stock_moves (product_id, from_store_id, to_store_id, qty, kind, trip_id,
      created_at, created_by, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
  product_id, fields.from ?? defaults[0], fields.to ?? defaults[1], qty, kind, fields.trip_id ?? null,
  at(mins), fields.by ?? 'Luis', fields.note ?? null);
}

test('descuadres conservan expected, calculan diferencia y totales por almacén', async (t) => {
  const { db, product } = await setup(t);
  await count(db, product.id, 10, -4);
  await delivery(db, product.id, 3, -2);
  await count(db, product.id, 5, -1);
  await count(db, product.id, 4, 0, 2); // expected null, no debe computar
  const result = await control.descuadres(db, {}, { now: base });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].expected, 7);
  assert.equal(result.items[0].diff, -2);
  assert.equal(result.totals.find((x) => x.store_id === 1).missing, 2);
  assert.equal(result.totals.find((x) => x.store_id === 2).missing, 0);
  assert.deepEqual(result.totals.map((x) => x.store_id), [1, 4, 2]);
  assert.equal(result.items[0].store_name, 'Almacén alcohol');
  await count(db, product.id, 8, 1);
  const withSurplus = await control.descuadres(db, {}, { now: new Date(at(2)) });
  assert.equal(withSurplus.items.length, 2);
  assert.equal(withSurplus.items.find((x) => x.diff > 0).diff, 3);
  assert.equal(withSurplus.totals.find((x) => x.store_id === 1).missing, 2);
  assert.equal(withSurplus.totals.find((x) => x.store_id === 1).extra, 3);
  assert.equal((await db.get('SELECT expected FROM stock_counts WHERE store_id = 1 ORDER BY id DESC LIMIT 1')).expected, 5);
});

test('descuadres filtran por mes de jornada y rechazan periodo inválido', async (t) => {
  const { db, product } = await setup(t);
  // 00:30 UTC del 1 de octubre es la noche de trabajo del 30 de septiembre en Madrid.
  const sep = '2026-10-01T00:30:00.000Z';
  await alm.saveCounts(db, { items: [{ product_id: product.id, qty: 10 }], counted_at: sep, by: 'Ana' }, { now: new Date(sep) });
  const later = '2026-10-01T01:00:00.000Z';
  await alm.saveCounts(db, { items: [{ product_id: product.id, qty: 8 }], counted_at: later, by: 'Ana' }, { now: new Date(later) });
  assert.equal((await control.descuadres(db, { period: 'mes' }, { now: base })).items.length, 0);
  assert.equal((await control.descuadres(db, { period: 'mes_pasado' }, { now: base })).items.length, 1);
  assert.equal((await control.descuadres(db, { period: 'todo' }, { now: base })).items.length, 1);
  await assert.rejects(control.descuadres(db, { period: 'year' }), /Periodo no válido/);
});

test('anular movimiento conserva auditoría y restaura stock calculado', async (t) => {
  const { db, product } = await setup(t);
  await count(db, product.id, 10, -3);
  const broken = await move(db, product.id, 'rotura', 2, -2);
  assert.equal((await alm.liveStock(db, { now: new Date(at(0)) }))[product.id], 8);
  const result = await control.voidMove(db, broken.id, { reason: 'Apuntada dos veces', by: 'Marta' }, { now: base });
  assert.equal(result.move.voided, 1);
  assert.equal(result.move.voided_by, 'Marta');
  assert.equal(result.move.void_reason, 'Apuntada dos veces');
  assert.equal((await alm.liveStock(db, { now: new Date(at(1)) }))[product.id], 10);
  const audit = await db.get("SELECT * FROM audit WHERE entity = 'almacen' AND action = 'anular'");
  assert.equal(audit.reason, 'Apuntada dos veces');
  assert.deepEqual(JSON.parse(audit.before), { voided: 0 });
  assert.equal(JSON.parse(audit.after).voided, 1);
  assert.equal((await svc.liveState(db, { now: base })).almacen_rev, audit.id);
  await assert.rejects(control.voidMove(db, broken.id, { reason: 'Otra vez' }), /ya está anulado/);
  await assert.rejects(control.voidMove(db, 99999, { reason: 'Fallo' }), (e) => e.status === 404);
  await assert.rejects(control.voidMove(db, broken.id, { reason: ' ' }), /Escribe el motivo/);
  assert.equal((await db.get('SELECT count(*)::int AS n FROM stock_moves')).n, 1);
});

test('anular traslados y entradas ajusta únicamente sus movimientos', async (t) => {
  const { db, product } = await setup(t);
  await count(db, product.id, 5, -5, 1);
  await count(db, product.id, 12, -5, 2);
  const transfer = await move(db, product.id, 'traslado', 3, -4);
  const entry = await move(db, product.id, 'entrada', 4, -3);
  assert.equal((await alm.liveStock(db, { now: new Date(at(0)) }))[product.id], 8);
  await control.voidMove(db, transfer.id, { reason: 'Viaje duplicado' }, { now: base });
  await control.voidMove(db, entry.id, { reason: 'Entrada incorrecta' }, { now: base });
  assert.equal((await alm.liveStock(db, { now: new Date(at(1)) }))[product.id], 5);
});

test('historial agrupa entradas y recuentos, incluye anulados y ordena recientes primero', async (t) => {
  const { db, product } = await setup(t);
  await count(db, product.id, 10, -5);
  await count(db, product.id, 9, -4);
  const trip = await db.get("INSERT INTO trips (status, created_at, created_by, done_at, done_by) VALUES ('hecho', ?, 'Ana', ?, 'Ana') RETURNING id", at(-4), at(-3));
  const transfer = await move(db, product.id, 'traslado', 2, -3, { trip_id: trip.id });
  const e1 = await move(db, product.id, 'entrada', 1, -2, { note: 'Entrega' });
  await move(db, product.id, 'entrada', 2, -2, { note: 'Entrega' });
  const broken = await move(db, product.id, 'rotura', 1, -1, { note: 'Caída' });
  await control.voidMove(db, broken.id, { reason: 'Duplicada', by: 'Marta' }, { now: base });
  const result = await control.historial(db, { period: 'todo' }, { now: base });
  assert.equal(result.truncated, false);
  assert.deepEqual(result.events.map((x) => x.type), ['rotura', 'entrada', 'viaje', 'recuento']);
  assert.equal(result.events.find((x) => x.type === 'entrada').lines.length, 2);
  assert.equal(result.events.find((x) => x.type === 'viaje').lines[0].move_id, transfer.id);
  assert.equal(result.events.find((x) => x.type === 'recuento').lines.length, 2);
  const brokenLine = result.events.find((x) => x.type === 'rotura').lines[0];
  assert.equal(brokenLine.voided, 1);
  assert.equal(brokenLine.void_reason, 'Duplicada');
  assert.equal(result.events[1].lines[0].move_id, e1.id);
});

test('rutas de control exigen PIN de encargado y no anulan sin autenticación', async (t) => {
  const { db, product } = await setup(t);
  const broken = await move(db, product.id, 'rotura', 1, 0);
  const handler = createHandler({ getDb: async () => db,
    env: { STAFF_CODE: 'staff-secret', MANAGER_PIN: 'manager-secret' }, log: { error() {} } });
  const request = (path, method = 'GET', body, headers = {}) => handler(new Request(`https://test${path}`, {
    method, headers: { ...headers, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  }));
  const urls = ['/api/almacen/descuadres', '/api/almacen/historial'];
  for (const url of urls) {
    assert.equal((await request(url, 'GET', null, { 'x-access-code': 'staff-secret' })).status, 401);
    assert.equal((await request(url, 'GET', null, { 'x-manager-pin': 'wrong' })).status, 403);
    assert.equal((await request(url, 'GET', null, { 'x-manager-pin': 'manager-secret' })).status, 200);
  }
  const path = `/api/almacen/movimientos/${broken.id}/anular`;
  assert.equal((await request(path, 'POST', { reason: 'Sin PIN' }, { 'x-access-code': 'staff-secret' })).status, 401);
  assert.equal((await request(path, 'POST', { reason: 'PIN incorrecto' }, { 'x-manager-pin': 'wrong' })).status, 403);
  const response = await request(path, 'POST', { reason: 'Corregido', by: 'Ana' }, { 'x-manager-pin': 'manager-secret' });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).move.voided, 1);
});
