import test from 'node:test';
import assert from 'node:assert/strict';
import { openPglite, applyMigrations } from '../server/db-pglite.js';
import { createHandler } from '../server/handler.js';
import * as svc from '../server/services.js';

const NIGHT = new Date('2026-09-26T21:00:00Z');
const later = (minutes, base = NIGHT) => new Date(base.getTime() + minutes * 60000);

async function setup(t) {
  const db = await openPglite();
  t.after(() => db.end());
  const id = async (name) => (await db.get('SELECT id FROM products WHERE name = ?', name)).id;
  const group = async (name) => (await db.get('SELECT id FROM product_groups WHERE name = ?', name)).id;
  return { db, id, group };
}

async function manual(db, date, product, bar, qty, at = NIGHT) {
  return svc.addManualDelivery(db, {
    date, product_id: product, bar_id: bar, qty, reason: 'Prueba', by: 'Carlos',
  }, { now: at });
}

test('solo cuenta lo entregado; conserva una reposición anulada y lo pendiente', async (t) => {
  const { db, id } = await setup(t);
  const product = await id('Larios 12');
  await svc.createRequest(db, { bar_id: 1, items: [{ product_id: product, qty: 4 }] }, { now: NIGHT });
  const line = await db.get('SELECT id FROM request_lines WHERE product_id = ?', product);
  await svc.deliver(db, line.id, { qty: 3, by: 'Luis' }, { now: later(1) });
  let r = await svc.informe(db, { period: 'night', date: '2026-09-26' });
  assert.equal(r.totals.bottles, 3);
  assert.equal(r.products.find((p) => p.product_id === product).unserved, 1);
  const delivery = await db.get('SELECT id FROM deliveries WHERE line_id = ?', line.id);
  await svc.correctDelivery(db, delivery.id, { qty: 0, reason: 'Anulada', by: 'Carlos' });
  r = await svc.informe(db, { period: 'night', date: '2026-09-26' });
  assert.equal(r.totals.bottles, 0);
  const detail = await svc.informeBotella(db, product, { period: 'night', date: '2026-09-26' });
  assert.equal(detail.unserved, 4);
  assert.equal(detail.deliveries[0].qty, 0);
  assert.equal(detail.deliveries[0].corrected, true);
  await svc.createRequest(db, { bar_id: 2, items: [{ product_id: product, qty: 2 }] }, { now: later(2) });
  assert.equal((await svc.informeBotella(db, product,
    { period: 'night', date: '2026-09-26', bar_id: '1' })).unserved, 4);
  assert.equal((await svc.informeBotella(db, product,
    { period: 'night', date: '2026-09-26', bar_id: '2' })).unserved, 2);
});

test('Hecho suma la reposición una vez en la noche de la solicitud', async (t) => {
  const { db, id } = await setup(t);
  const product = await id('Roku');
  await svc.createRequest(db, { bar_id: 1, items: [{ product_id: product, qty: 2 }] },
    { now: new Date('2026-09-27T09:55:00Z') }); // 11:55 en Madrid
  const line = await db.get('SELECT id FROM request_lines WHERE product_id = ?', product);
  await svc.completeLines(db, { items: [{ line_id: line.id, qty: 2, delivered: 0 }], by: 'Luis' },
    { now: new Date('2026-09-27T10:05:00Z') }); // 12:05 en Madrid
  assert.equal((await svc.informe(db, { period: 'night', date: '2026-09-26' })).totals.bottles, 2);
  assert.equal((await svc.informe(db, { period: 'night', date: '2026-09-27' })).totals.bottles, 0);
  const detail = await svc.informeBotella(db, product, { period: 'night', date: '2026-09-26' });
  assert.equal(detail.date, '2026-09-26');
  assert.equal(detail.deliveries[0].business_date, '2026-09-26');
});

test('jornada de Madrid cruza medianoche y los dos cambios de hora', async (t) => {
  const { db, id } = await setup(t);
  const product = await id('Roku');
  await svc.createRequest(db, { bar_id: 1, items: [{ product_id: product, qty: 1 }] }, { now: NIGHT });
  const line = await db.get('SELECT id FROM request_lines WHERE product_id = ?', product);
  await svc.deliver(db, line.id, { qty: 1 }, { now: later(6 * 60) }); // 05:00 en Madrid
  assert.equal((await svc.informe(db, { period: 'night', date: '2026-09-26' })).totals.bottles, 1);
  for (const at of ['2026-03-29T00:30:00Z', '2026-03-29T01:30:00Z']) {
    assert.equal(await svc.currentDate(db, new Date(at)), '2026-03-28');
  }
  for (const at of ['2026-10-25T00:30:00Z', '2026-10-25T01:30:00Z']) {
    assert.equal(await svc.currentDate(db, new Date(at)), '2026-10-24');
  }
  assert.equal(await svc.currentDate(db, new Date('2026-03-29T10:30:00Z')), '2026-03-29');
  assert.equal(await svc.currentDate(db, new Date('2026-10-25T11:30:00Z')), '2026-10-25');
  for (const [before, after, previous, today] of [
    ['2026-03-29T09:59:00Z', '2026-03-29T10:00:00Z', '2026-03-28', '2026-03-29'],
    ['2026-10-25T10:59:00Z', '2026-10-25T11:00:00Z', '2026-10-24', '2026-10-25'],
  ]) {
    assert.equal(await svc.currentDate(db, new Date(before)), previous);
    assert.equal(await svc.currentDate(db, new Date(after)), today);
  }
  for (const [before, after, date] of [
    ['2026-03-29T00:30:00Z', '2026-03-29T01:30:00Z', '2026-03-28'],
    ['2026-10-25T00:30:00Z', '2026-10-25T01:30:00Z', '2026-10-24'],
  ]) {
    await svc.createRequest(db, { bar_id: 2, items: [{ product_id: product, qty: 1 }] }, { now: new Date(before) });
    const dstLine = await db.get(`SELECT l.id FROM request_lines l JOIN sessions s ON s.id = l.session_id
      WHERE s.business_date = ? AND l.product_id = ?`, date, product);
    await svc.deliver(db, dstLine.id, { qty: 1 }, { now: new Date(after) });
    assert.equal((await svc.informe(db, { period: 'night', date })).totals.bottles, 1);
  }
});

test('noche, semana, mes y fechas comparan con su periodo anterior; semana cerrada queda a cero', async (t) => {
  const { db, id } = await setup(t);
  const product = await id('Roku');
  await manual(db, '2026-09-19', product, 1, 2);
  await manual(db, '2026-09-26', product, 1, 5);
  const night = await svc.informe(db, { period: 'night', date: '2026-09-26' });
  assert.equal(night.previousRange.from, '2026-09-19');
  assert.deepEqual([night.totals.bottles, night.totals.previous, night.totals.diff], [5, 2, 3]);
  const week = await svc.informe(db, { period: 'week', date: '2026-09-26' });
  assert.deepEqual([week.range.from, week.range.to, week.previousRange.from],
    ['2026-09-21', '2026-09-27', '2026-09-14']);
  assert.deepEqual([week.totals.bottles, week.totals.previous, week.totals.diff], [5, 2, 3]);
  const month = await svc.informe(db, { period: 'month', date: '2026-09-26' });
  assert.deepEqual([month.range.from, month.range.to, month.previousRange.from],
    ['2026-09-01', '2026-09-30', '2026-08-01']);
  assert.equal(month.totals.bottles, 7);
  const custom = await svc.informe(db, { period: 'custom', from: '2026-09-25', to: '2026-09-27' });
  assert.deepEqual([custom.previousRange.from, custom.previousRange.to], ['2026-09-22', '2026-09-24']);
  const crossYear = await svc.informe(db, { period: 'custom', from: '2025-12-30', to: '2026-01-02' });
  assert.equal(crossYear.range.label, 'Del 30 dic 2025 al 2 ene 2026');
  const closed = await svc.informe(db, { period: 'week', date: '2026-10-10' });
  assert.equal(closed.totals.bottles, 0);
  assert.equal(closed.basis, 'repuestas');
  assert.deepEqual(closed.nights, []);
  const earliest = await svc.informe(db, { period: 'night', date: '2026-09-19' });
  assert.equal(earliest.previousRange, null);
  assert.equal(earliest.totals.diff, 0);
});

test('cajas y resto, dos barras, Otras y grupo actual', async (t) => {
  const { db, id, group } = await setup(t);
  const habitual = await id('Larios 12');
  const other = await id('Roku');
  const outside = await id('SKYY');
  const habituales = await group('Habituales');
  const otras = await svc.createGroup(db, { name: 'Otras' });
  await svc.updateProduct(db, habitual, { per_case: 6 });
  await svc.updateProduct(db, other, { group_id: otras.id });
  await svc.updateProduct(db, outside, { group_id: null });
  await manual(db, '2026-09-26', habitual, 1, 8);
  await manual(db, '2026-09-26', habitual, 2, 6);
  await manual(db, '2026-09-26', other, 2, 3);
  await manual(db, '2026-09-26', outside, 1, 2);
  const all = await svc.informe(db, { period: 'night', date: '2026-09-26' });
  assert.equal(all.totals.bottles, 19);
  assert.deepEqual(all.products.find((p) => p.product_id === habitual).cases, { full: 2, loose: 2 });
  assert.equal(all.products.find((p) => p.product_id === other).cases, null);
  assert.deepEqual(all.totals.byBar, { 1: 10, 2: 9 });
  assert.equal(all.byGroup.reduce((sum, g) => sum + g.bottles, 0), all.totals.bottles);
  assert.equal(all.byGroup.find((g) => g.name === 'Otras').bottles, 3);
  assert.equal(all.byGroup.find((g) => g.group_id === null).bottles, 2);
  const selected = await svc.informe(db, { period: 'night', date: '2026-09-26', group: String(habituales), bar_id: '1' });
  assert.equal(selected.totals.bottles, 8);
  assert.deepEqual(selected.totals.byBar, { 1: 8 });
  assert.equal(selected.byGroup.reduce((sum, g) => sum + g.bottles, 0), 10);
  const none = await svc.informe(db, { period: 'night', date: '2026-09-26', group: 'none' });
  assert.equal(none.totals.bottles, 2);
  await svc.updateProduct(db, habitual, { group_id: otras.id });
  const moved = await svc.informe(db, { period: 'night', date: '2026-09-26', group: String(otras.id) });
  assert.equal(moved.totals.bottles, 17);
});

test('detalle: noches sin entregas, orden descendente, agotado reversible y consumo', async (t) => {
  const { db, id } = await setup(t);
  const product = await id('Roku');
  await manual(db, '2026-09-25', product, 1, 2, later(-1440));
  await svc.ensureSession(db, '2026-09-26', NIGHT);
  await svc.setOutOfStock(db, product, true, { by: 'Luis', now: NIGHT });
  await manual(db, '2026-09-26', product, 2, 3, later(2));
  const sessions = await db.all("SELECT id FROM sessions WHERE business_date IN ('2026-09-25', '2026-09-26')");
  for (const s of sessions) await svc.updateSession(db, s.id, { same_level: true });
  let detail = await svc.informeBotella(db, product, { period: 'week', date: '2026-09-26' });
  assert.equal(detail.basis, 'consumo');
  assert.equal(detail.deliveries[0].business_date, '2026-09-26');
  assert.equal(detail.stockout_nights, 1);
  assert.equal(detail.product.out_of_stock, true);
  assert.equal(detail.product.out_of_stock_since, NIGHT.toISOString());
  assert.equal(detail.stockouts[0].ended_at, null);
  assert.equal(detail.nights.find((n) => n.business_date === '2026-09-26').out_of_stock, true);
  await svc.ensureSession(db, '2026-09-27', later(24 * 60));
  detail = await svc.informeBotella(db, product, { period: 'week', date: '2026-09-26', bar_id: '1' });
  assert.equal(detail.bottles, 2);
  assert.equal(detail.nights.find((n) => n.business_date === '2026-09-27').bottles, 0);
  assert.equal(detail.basis, 'repuestas');
  await svc.setOutOfStock(db, product, false, { by: 'Ana', now: later(60) });
  detail = await svc.informeBotella(db, product, { period: 'week', date: '2026-09-26' });
  assert.equal(detail.product.out_of_stock, false);
  assert.equal(detail.product.out_of_stock_since, null);
  assert.equal(detail.stockouts[0].ended_at, later(60).toISOString());
  await assert.rejects(svc.informeBotella(db, 99999, { period: 'week' }),
    { status: 404, message: 'Producto no encontrado' });
});

test('filtros inválidos, migración idempotente y acceso de personal al estado agotado', async (t) => {
  const { db, id } = await setup(t);
  await applyMigrations(db);
  const product = await id('Roku');
  await assert.rejects(db.run('UPDATE products SET per_case = 0 WHERE id = ?', product));
  for (const params of [{ period: 'año' }, { group: 'abc' }, { group: '999' },
    { period: 'custom', from: '2026-09-27', to: '2026-09-26' },
    { period: 'custom', from: '2026-02-30', to: '2026-03-01' },
    { period: 'custom', from: '2025-01-01', to: '2026-09-26' }, { bar_id: '99' }]) {
    await assert.rejects(svc.informe(db, params), { status: 400 });
  }
  await assert.rejects(svc.updateProduct(db, product, { per_case: 0 }), { status: 400 });
  await svc.updateProduct(db, product, { per_case: 6 });
  assert.equal((await svc.informeBotella(db, product)).product.per_case, 6);
  await svc.updateProduct(db, product, { per_case: null });
  assert.equal((await svc.informeBotella(db, product)).cases, null);

  const handle = createHandler({ getDb: async () => db, env: { STAFF_CODE: 'barra', MANAGER_PIN: '1234' } });
  const call = (path, options = {}) => handle(new Request(`https://example.test${path}`, options));
  const staff = { 'X-Access-Code': 'barra' };
  const manager = { 'X-Manager-Pin': '1234' };
  for (const path of ['/api/informe', `/api/informe/botella/${product}`]) {
    assert.equal((await call(path, { headers: staff })).status, 401);
    assert.equal((await call(path, { headers: manager })).status, 200);
  }
  assert.equal((await call('/api/informe/botella/abc', { headers: manager })).status, 404);
  const perCase = await call(`/api/products/${product}`, {
    method: 'PUT', headers: { ...manager, 'Content-Type': 'application/json' },
    body: JSON.stringify({ per_case: 12, by: 'Encargado' }),
  });
  assert.equal(perCase.status, 200);
  assert.equal((await (await call(`/api/informe/botella/${product}`, { headers: manager })).json()).product.per_case, 12);
  for (const out_of_stock of [true, false]) {
    const response = await call(`/api/products/${product}/stock`, {
      method: 'POST', headers: { ...staff, 'Content-Type': 'application/json' },
      body: JSON.stringify({ out_of_stock, by: 'Cualquier persona de barra' }),
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).out_of_stock, out_of_stock ? 1 : 0);
  }
});
