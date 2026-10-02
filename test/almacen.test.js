import test from 'node:test';
import assert from 'node:assert/strict';
import { openPglite, applyMigrations } from '../server/db-pglite.js';
import { checkSchema } from '../server/schema.js';
import { createHandler } from '../server/handler.js';
import { importBackup } from '../server/import-backup.js';
import * as svc from '../server/services.js';
import * as alm from '../server/almacen.js';

const NIGHT = new Date('2026-09-26T21:00:00.000Z');
// Las pruebas del antiguo almacén In Vessel se aplican ahora a Almacén alcohol.
const pointStock = async (db,{now}={}) => Object.fromEntries((await alm.stockRows(db,1,(now??new Date()).toISOString())).map(r=>[r.product_id,r.stock]));
const iso = (minutes) => new Date(NIGHT.getTime() + minutes * 60000).toISOString();
async function setup(t) {
  const db = await openPglite();
  t.after(() => db.end());
  const id = async (slug) => (await db.get('SELECT id FROM products WHERE slug = ?', slug)).id;
  return { db, id };
}
async function count(db, product_id, qty, minutes = 0, more = {}) {
  return alm.saveCounts(db, { items: [{ product_id, qty }], counted_at: iso(minutes), by: 'Ana', ...more },
    { now: new Date(iso(Math.max(minutes, 0))) });
}
async function delivery(db, product_id, qty, minutes, date = '2026-09-26') {
  await db.run('INSERT INTO sessions (business_date, created_at) VALUES (?, ?) ON CONFLICT (business_date) DO NOTHING', date, iso(minutes));
  const session = await db.get('SELECT id FROM sessions WHERE business_date = ?', date);
  return db.get(`INSERT INTO deliveries (session_id, bar_id, product_id, qty, delivered_at, source)
    VALUES (?, 1, ?, ?, ?, 'lista') RETURNING id`, session.id, product_id, qty, iso(minutes));
}

test('migración idempotente, almacenes, ajuste y esquema', async (t) => {
  const { db } = await setup(t);
  assert.deepEqual((await db.all('SELECT id, name, kind FROM stores ORDER BY id')).map((x) => x.kind),
    ['local', 'central', ...Array(8).fill('local')]);
  assert.equal((await svc.publicSettings(db)).trip_weeks, 2);
  await db.run("DELETE FROM settings WHERE key = 'trip_weeks'");
  assert.equal((await svc.publicSettings(db)).trip_weeks, 2);
  assert.equal((await alm.almacen(db)).trip_weeks, 2);
  await applyMigrations(db);
  assert.equal((await db.get('SELECT count(*)::int AS n FROM stores')).n, 10);
  await checkSchema(db);
});

test('reintentar el mismo recuento no duplica la entrada ni altera el stock', async (t) => {
  const { db, id } = await setup(t);
  const product_id = await id('larios-12');
  const body = { items: [{ product_id, qty: 10 }], counted_at: iso(0), key: 'movil-123' };
  await alm.saveCounts(db, body, { now: NIGHT });
  await delivery(db, product_id, 2, 1);
  await alm.saveCounts(db, body, { now: new Date(iso(2)) });
  assert.equal((await db.get('SELECT count(*)::int AS n FROM stock_counts WHERE product_id = ?', product_id)).n, 1);
  assert.equal((await pointStock(db, { now: new Date(iso(2)) }))[product_id], 8);
  await assert.rejects(alm.saveCounts(db, { ...body, items: [{ product_id, qty: 9 }] },
    { now: new Date(iso(3)) }), /identificador/);
});

test('recuento, entregas corregidas y deshechas, rotura, anulación y parcial', async (t) => {
  const { db, id } = await setup(t);
  const a = await id('larios-12');
  const b = await id('skyy');
  await db.run('UPDATE products SET per_case = 6 WHERE id = ?', a);
  await delivery(db, a, 5, -10);
  const first = await count(db, a, 10);
  assert.deepEqual(first, { ok: true, saved: 1,
    results: [{ product_id: a, store_id: 1, qty: 10, expected: null, diff: null, kind: null }] });
  assert.equal((await db.get('SELECT expected FROM stock_counts WHERE product_id = ?', a)).expected, null);
  let list = await alm.almacen(db, { store: 1 }, { now: new Date(iso(1)) });
  assert.equal(list.products.find((x) => x.product_id === a).stock, 10);
  assert.deepEqual(list.products.find((x) => x.product_id === a).cases, { full: 1, loose: 4 });
  assert.equal(list.products.find((x) => x.product_id === b).section, 'sin_contar');
  const d = await delivery(db, a, 3, 2);
  assert.equal((await pointStock(db, { now: new Date(iso(3)) }))[a], 7);
  await db.run('UPDATE deliveries SET qty = 1, corrected = 1 WHERE id = ?', d.id);
  assert.equal((await pointStock(db, { now: new Date(iso(3)) }))[a], 9);
  await db.run('UPDATE deliveries SET product_id = ? WHERE id = ?', b, d.id);
  assert.equal((await pointStock(db, { now: new Date(iso(3)) }))[a], 10);
  assert.ok(!Object.hasOwn(await pointStock(db, { now: new Date(iso(3)) }), b));
  await db.run('UPDATE deliveries SET product_id = ?, qty = 0 WHERE id = ?', a, d.id);
  assert.equal((await pointStock(db, { now: new Date(iso(3)) }))[a], 10);
  await alm.addBreakage(db, { product_id: a, qty: 2, note: 'Se cayó', by: 'Luis' }, { now: new Date(iso(4)) });
  assert.equal((await pointStock(db, { now: new Date(iso(5)) }))[a], 8);
  const broken = await db.get("SELECT id FROM stock_moves WHERE kind = 'rotura' AND product_id = ?", a);
  await db.run('UPDATE stock_moves SET voided = 1 WHERE id = ?', broken.id);
  assert.equal((await pointStock(db, { now: new Date(iso(5)) }))[a], 10);
  const second = await count(db, a, 7, 6);
  assert.deepEqual(second, { ok: true, saved: 1,
    results: [{ product_id: a, store_id: 1, qty: 7, expected: 10, diff: -3, kind: 'descuadre' }] });
  assert.equal((await db.get('SELECT expected FROM stock_counts WHERE product_id = ? ORDER BY id DESC LIMIT 1', a)).expected, 10);
  assert.equal((await pointStock(db, { now: new Date(iso(7)) }))[a], 7);
});

test('stock negativo y agotado automático solo para controladas', async (t) => {
  const { db, id } = await setup(t);
  const a = await id('larios-12');
  const b = await id('skyy');
  await count(db, a, 1);
  await alm.addBreakage(db, { product_id: a, store_id: 1, qty: 3 }, { now: new Date(iso(2)) });
  const live = await svc.liveState(db, { now: new Date(iso(3)) });
  assert.equal(live.stock[a], -2);
  assert.ok(!Object.hasOwn(live.stock, b));
  assert.deepEqual(live.outOfStock, []);
  const list = await alm.almacen(db, { store: 1 }, { now: new Date(iso(3)) });
  const row = list.products.find((x) => x.product_id === a);
  assert.equal(row.state, 'no_queda');
  assert.equal(row.review, true);
  assert.equal(row.cases, null);
  assert.equal(row.duration, null);
  assert.equal(list.products[0].product_id, a);
});

test('consumo por semanas activas, duración y detalle agrupado por noche', async (t) => {
  const { db, id } = await setup(t);
  const a = await id('larios-12');
  await count(db, a, 20, -1);
  await delivery(db, a, 2, 2, '2026-09-12');
  await delivery(db, a, 3, 3, '2026-09-26');
  await delivery(db, a, 1, 4, '2026-09-26');
  const view = await alm.almacen(db, { store: 1 }, { now: new Date(iso(5)) });
  assert.equal(view.has_consumption, true);
  assert.equal(view.products.find((x) => x.product_id === a).weekly, 3);
  const detail = await alm.almacenBotella(db, a, {}, { now: new Date(iso(5)) });
  assert.equal(detail.history.filter((x) => x.type === 'reposicion').length, 2);
  assert.equal(detail.history.find((x) => x.date === '2026-09-26').qty, 4);
  assert.equal(alm.durationLabel(1, 2), 'menos de 1 semana');
  assert.equal(alm.durationLabel(1, 1), '≈ 1 semana');
  assert.equal(alm.durationLabel(8, 1), '≈ 8 semanas');
  assert.equal(alm.durationLabel(9, 1), '≈ 2 meses');
  assert.equal(alm.durationLabel(52, 1), '≈ 12 meses');
  assert.equal(alm.durationLabel(60, 1), 'más de 1 año');
  assert.equal(alm.durationLabel(5, 0), 'sin consumo reciente');
});

test('recuento diferido usa la hora del recuento; fechas fuera de margen usan el servidor', async (t) => {
  const { db, id } = await setup(t);
  const a = await id('larios-12');
  await delivery(db, a, 2, -90);
  await count(db, a, 10, -120, { counted_at: iso(-120) });
  assert.equal((await pointStock(db, { now: NIGHT }))[a], 8);
  await alm.saveCounts(db, { items: [{ product_id: a, qty: 7 }], counted_at: iso(2) }, { now: NIGHT });
  assert.equal((await pointStock(db, { now: NIGHT }))[a], 7);
  await alm.saveCounts(db, { items: [{ product_id: a, qty: 6 }], counted_at: iso(-13 * 60) }, { now: new Date(iso(1)) });
  assert.equal((await pointStock(db, { now: new Date(iso(1)) }))[a], 6);
});

test('semanas sin apertura no cuentan, límite de ocho semanas y estado de poco', async (t) => {
  const { db, id } = await setup(t);
  const a = await id('larios-12');
  await count(db, a, 10, -1);
  for (let i = 0; i < 9; i++) {
    const date = new Date(Date.UTC(2026, 8, 26 - i * 7)).toISOString().slice(0, 10);
    await delivery(db, a, i === 8 ? 80 : 2, -200 - i, date);
  }
  const view = await alm.almacen(db, { store: 1 }, { now: new Date(iso(1)) });
  const row = view.products.find((x) => x.product_id === a);
  assert.equal(row.weekly, 2);
  assert.equal(row.stock, 10);
  assert.equal(row.duration.label, '≈ 5 semanas');
  await db.run("UPDATE settings SET value = '6' WHERE key = 'trip_weeks'");
  assert.equal((await alm.almacen(db, { store: 1 }, { now: new Date(iso(1)) })).products.find((x) => x.product_id === a).state,
    'queda_poco');
});

test('corregir y deshacer mediante los servicios originales actualiza el stock', async (t) => {
  const { db, id } = await setup(t);
  const a = await id('larios-12');
  await count(db, a, 10);
  const d = await delivery(db, a, 3, 1);
  await svc.correctDelivery(db, d.id, { qty: 1, reason: 'Apuntado de más' }, { now: new Date(iso(2)) });
  assert.equal((await pointStock(db, { now: new Date(iso(2)) }))[a], 9);
  // Otra entrega no corregida conserva el deshacer desde Reponer.
  const fresh = await delivery(db, a, 2, 3);
  assert.equal((await pointStock(db, { now: new Date(iso(4)) }))[a], 7);
  await svc.undoDelivery(db, fresh.id, { by: 'Ana' }, { now: new Date(iso(4)) });
  assert.equal((await pointStock(db, { now: new Date(iso(4)) }))[a], 9);
});

test('API de personal, validación y copia de seguridad con ida y vuelta', async (t) => {
  const { db, id } = await setup(t);
  const a = await id('larios-12');
  const handler = createHandler({ getDb: async () => db,
    env: { STAFF_CODE: 'staff', MANAGER_PIN: 'manager' }, log: { error: () => {} } });
  const request = (path, method = 'GET', body, headers = {}) => handler(new Request(`https://example.test${path}`, {
    method, headers: { ...headers, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  }));
  assert.equal((await request('/api/almacen')).status, 401);
  const auth = { 'x-access-code': 'staff' };
  const save = await request('/api/almacen/recuentos', 'POST', { items: [{ product_id: a, qty: 6 }] }, auth);
  assert.equal(save.status, 200);
  const live = await (await request('/api/live', 'GET', null, auth)).json();
  assert.equal(live.stock[a], 6);
  assert.ok(Number.isFinite(Date.parse(live.server_time)));
  assert.equal((await request('/api/almacen', 'GET', null, auth)).status, 200);
  assert.equal((await request(`/api/almacen/botella/${a}`, 'GET', null, auth)).status, 200);
  assert.equal((await request('/api/almacen?store=999', 'GET', null, auth)).status, 400);
  assert.equal((await request('/api/almacen/recuentos', 'POST', { items: [{ product_id: a, qty: -1 }] }, auth)).status, 400);
  assert.equal((await request('/api/almacen/roturas', 'POST', { product_id: a, qty: 1 }, auth)).status, 200);
  const backup = await (await request('/api/backup', 'GET', null, { 'x-access-code': 'staff', 'x-manager-pin': 'manager' })).json();
  for (const table of ['stores', 'stock_counts', 'stock_moves', 'trips', 'trip_lines']) {
    assert.ok(Array.isArray(backup.tables[table]), table);
  }
  const other = await openPglite();
  t.after(() => other.end());
  await importBackup(other, backup);
  assert.deepEqual(await pointStock(other), await pointStock(db));
  await assert.rejects(importBackup(other, backup), /--force/);
  const older = structuredClone(backup);
  for (const table of ['stores', 'stock_counts', 'stock_moves', 'trips', 'trip_lines']) delete older.tables[table];
  await importBackup(other, older, { force: true });
  assert.equal((await other.get('SELECT count(*)::int AS n FROM stores')).n, 10);
  await checkSchema(other);
});

test('mercancía de una botella sin contar: cuenta desde la llegada y descuenta lo repuesto después', async (t) => {
  const { db, id } = await setup(t);
  const a = await id('roku');
  await delivery(db, a, 5, -60); // antes de que llegue nada: no cuenta
  await alm.addEntries(db, { store_id: 1, items: [{ product_id: a, qty: 12 }], by: 'Ana' }, { now: new Date(iso(-30)) });
  let row = (await alm.stockRows(db, { id: 1, kind: 'local' }, iso(0))).find((r) => r.product_id === a);
  assert.equal(row.stock, 12, 'la entrada se ve aunque nunca se haya contado');
  assert.equal(row.count_id, null);
  await delivery(db, a, 3, 10);
  row = (await alm.stockRows(db, { id: 1, kind: 'local' }, iso(20))).find((r) => r.product_id === a);
  assert.equal(row.stock, 9);
  const view = await alm.almacen(db, { store: 1 }, { now: new Date(iso(20)) });
  const item = view.products.find((p) => p.product_id === a);
  assert.equal(item.controlled, true);
  assert.equal(item.stock, 9);
  assert.equal(item.last_count_at, null, 'no se inventa un recuento');
  assert.equal((await pointStock(db, { now: new Date(iso(20)) }))[a], 9);
  // El primer recuento ya tiene valor esperado: el descuadre se puede ver.
  await count(db, a, 8, 30);
  const c = await db.get('SELECT expected FROM stock_counts WHERE product_id = ? ORDER BY id DESC LIMIT 1', a);
  assert.equal(c.expected, 9);
  // En Out Vessel no aparece: la entrada fue al local.
  assert.equal((await alm.stockRows(db, { id: 2, kind: 'central' }, iso(40))).some((r) => r.product_id === a), false);
});

test('botellas por caja desde Almacén, con acceso de personal', async (t) => {
  const { db, id } = await setup(t);
  const a = await id('roku');
  const handler = createHandler({ getDb: async () => db,
    env: { STAFF_CODE: 'staff', MANAGER_PIN: 'manager' }, log: { error: () => {} } });
  const put = (body, headers) => handler(new Request(`https://example.test/api/almacen/botella/${a}/caja`, {
    method: 'PUT', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }));
  assert.equal((await put({ per_case: 6 }, {})).status, 401);
  const res = await put({ per_case: 6, store_id: 2, by: 'Ana' }, { 'x-access-code': 'staff' });
  assert.equal(res.status, 200);
  const view = await res.json();
  assert.equal(view.product.per_case, 6);
  assert.equal(view.store.id, 2);
  assert.equal((await db.get('SELECT per_case FROM products WHERE id = ?', a)).per_case, 6);
  assert.equal((await put({ per_case: 0 }, { 'x-access-code': 'staff' })).status, 400);
  assert.equal((await put({ per_case: null }, { 'x-access-code': 'staff' })).status, 200);
  assert.equal((await db.get('SELECT per_case FROM products WHERE id = ?', a)).per_case, null);
});
