import test from 'node:test';
import assert from 'node:assert/strict';
import { openPglite } from '../server/db-pglite.js';
import { createHandler } from '../server/handler.js';
import { importBackup } from '../server/import-backup.js';
import * as alm from '../server/almacen.js';
import * as viaje from '../server/viaje.js';
import * as svc from '../server/services.js';

const NOW = new Date('2026-09-26T21:00:00.000Z');
const at = (min = 0) => new Date(NOW.getTime() + min * 60000);
async function setup(t) {
  const db = await openPglite();
  t.after(() => db.end());
  const product = async (slug) => (await db.get('SELECT id FROM products WHERE slug = ?', slug)).id;
  return { db, product };
}
async function count(db, product_id, qty, store_id = 1) {
  await alm.saveCounts(db, { store_id, items: [{ product_id, qty }] }, { now: at(-1) });
}
async function weekly(db, product_id, qty = 3) {
  for (const [date, min] of [['2026-09-12', -10], ['2026-09-26', -5]]) {
    const session = await db.get(`INSERT INTO sessions (business_date, created_at)
      VALUES (?, ?) ON CONFLICT (business_date) DO UPDATE SET created_at = sessions.created_at RETURNING id`, date, at(min).toISOString());
    await db.run(`INSERT INTO deliveries (session_id, bar_id, product_id, qty, delivered_at, source)
      VALUES (?, 1, ?, ?, ?, 'lista')`, session.id, product_id, qty, at(min).toISOString());
  }
}

test('sugerencias: cajas, tope, descuento, retirada y semanas con actividad', async (t) => {
  const { db, product } = await setup(t);
  const a = await product('larios-12');
  const b = await product('skyy');
  await db.run('UPDATE products SET per_case = 6 WHERE id = ?', a);
  await db.run('UPDATE products SET per_case = NULL WHERE id = ?', b);
  await count(db, a, 2);
  await weekly(db, a);
  await weekly(db, b, 1);
  // fase-2.md: solo cuenta el recuento del punto principal, nunca el stock de las barras.
  assert.equal((await alm.suggestions(db, { now: NOW })).get(a), 12);
  assert.equal((await alm.suggestions(db, { now: NOW })).get(b), undefined);
  await count(db, b, 0);
  assert.equal((await alm.suggestions(db, { now: NOW })).get(b), 3);
  await count(db, a, 20, 2);
  await viaje.addTripLine(db, { product_id: a, qty_planned: 6 }, { now: NOW });
  assert.equal((await alm.suggestions(db, { now: NOW })).get(a), 6, 'el pedido descuenta 6, quedan 3 × 3 − 2 − 6 botellas por cubrir');
  await count(db, a, 5, 2);
  assert.equal((await alm.suggestions(db, { now: NOW })).get(a), undefined);
  const view = await viaje.addSuggested(db, {}, { now: NOW });
  assert.equal(view.added, 1); // La botella apuntada ya tiene su propia línea.
  assert.equal((await viaje.addSuggested(db, {}, { now: NOW })).added, 0);
  await viaje.removeTripLine(db, view.lines.find((x) => x.product_id === a).id, {}, { now: NOW });
  assert.equal((await alm.suggestions(db, { now: NOW })).get(a), 5);
  await count(db, a, 0, 2);
  assert.equal((await alm.suggestions(db, { now: NOW })).get(a), undefined);
});

test('viaje hecho traslada, conserva originales y pasa lo no cargado', async (t) => {
  const { db, product } = await setup(t);
  const a = await product('larios-12');
  const b = await product('skyy');
  await count(db, a, 2);
  await count(db, a, 20, 2);
  await assert.rejects(viaje.addTripLine(db, { product_id: a, qty_planned: 0 }, { now: NOW }), (e) => e.status === 400);
  const one = await viaje.addTripLine(db, { product_id: a, qty_planned: 6, by: 'Ana' }, { now: NOW });
  assert.equal(one.to.name, 'In Vessel');
  assert.equal(one.to.id, null);
  const two = await viaje.addTripLine(db, { product_id: b, qty_planned: 3 }, { now: NOW });
  const note = await viaje.addTripLine(db, { text: 'tónica' }, { now: NOW });
  await viaje.updateTripLine(db, one.added.id, { checked: 1 }, { now: NOW });
  await assert.rejects(viaje.updateTripLine(db, one.added.id, { qty_planned: 0 }, { now: NOW }), (e) => e.status === 400);
  await viaje.updateTripLine(db, one.added.id, { qty_planned: 8 }, { now: NOW });
  assert.equal((await db.get('SELECT qty_loaded FROM trip_lines WHERE id = ?', one.added.id)).qty_loaded, 8);
  await viaje.updateTripLine(db, note.added.id, { checked: 1 }, { now: NOW });
  const done = await viaje.finishTrip(db, { trip_id: one.trip.id, by: 'Ana' }, { now: at(1) });
  assert.deepEqual([done.moves, done.carried], [1, 1]);
  assert.ok(done.next_trip_id);
  const move = await db.get("SELECT * FROM stock_moves WHERE kind = 'traslado'");
  assert.deepEqual([move.from_store_id, move.to_store_id, move.qty, move.trip_id], [2, 1, 8, one.trip.id]);
  assert.equal((await alm.liveStock(db, { now: at(2) }))[a], 10);
  const out = await alm.almacen(db, { store: 2 }, { now: at(2) });
  assert.equal(out.products.find((p) => p.product_id === a).stock, 12);
  assert.equal((await db.get('SELECT status FROM trips WHERE id = ?', one.trip.id)).status, 'hecho');
  const carried = await db.get('SELECT * FROM trip_lines WHERE trip_id = ?', done.next_trip_id);
  assert.equal(carried.product_id, b);
  assert.equal((await db.get('SELECT trip_id FROM trip_lines WHERE id = ?', two.added.id)).trip_id, one.trip.id);
  await assert.rejects(viaje.finishTrip(db, { trip_id: one.trip.id }, { now: at(2) }), (e) => e.status === 409);
  await assert.rejects(viaje.updateTripLine(db, one.added.id, { checked: 0 }), (e) => e.status === 409);
});

test('viaje abierto único, edición, retirada y viaje sin cargados', async (t) => {
  const { db, product } = await setup(t);
  const a = await product('larios-12');
  const b = await product('skyy');
  const [one, two] = await Promise.all([
    viaje.addTripLine(db, { product_id: a, qty_planned: 2 }, { now: NOW }),
    viaje.addTripLine(db, { product_id: b, qty_planned: 3 }, { now: NOW }),
  ]);
  assert.equal((await db.get("SELECT count(*)::int AS n FROM trips WHERE status = 'abierto'")).n, 1);
  assert.equal((await viaje.tripView(db)).count, 2);
  assert.equal((await viaje.addTripLine(db, { product_id: a }, { now: NOW })).already, true);
  const id = (await viaje.tripView(db)).lines.find((x) => x.product_id === a).id;
  await viaje.updateTripLine(db, id, { checked: 1 }, { now: NOW });
  assert.equal((await viaje.openTripSummary(db)).checked, 1);
  await viaje.updateTripLine(db, id, { checked: 0 }, { now: NOW });
  assert.equal((await db.get('SELECT qty_loaded FROM trip_lines WHERE id = ?', id)).qty_loaded, null);
  await assert.rejects(viaje.finishTrip(db, { trip_id: one.trip.id }), (e) => e.status === 400);
  await viaje.removeTripLine(db, id, {}, { now: NOW });
  assert.equal((await db.get('SELECT removed FROM trip_lines WHERE id = ?', id)).removed, 1);
  assert.equal((await viaje.tripView(db)).count, 1);
  const remaining = (await viaje.tripView(db)).lines[0];
  await viaje.updateTripLine(db, remaining.id, { checked: 1 }, { now: NOW });
  const done = await viaje.finishTrip(db, { trip_id: two.trip.id }, { now: NOW });
  assert.equal(done.next_trip_id, null);
  assert.equal(await viaje.openTripSummary(db), null);
});

test('cantidad cargada editable: marca, conserva lo real y llega al principal; notas sin cantidad', async (t) => {
  const { db, product } = await setup(t);
  const a = await product('larios-12'), b = await product('skyy');
  await db.run('UPDATE products SET main_store_id = 4 WHERE id = ?', a);
  await count(db, a, 0, 4);
  const planned = await viaje.addTripLine(db, { product_id: a, qty_planned: 18 }, { now: NOW });
  assert.equal(planned.added.category, 'ginebra');
  await viaje.addTripLine(db, { product_id: b, qty_planned: 3 }, { now: NOW });
  const note = await viaje.addTripLine(db, { text: 'algo más' }, { now: NOW });
  assert.equal(note.added.category, null);
  for (const qty_loaded of [0, -1, 1.5, null, 10001]) {
    await assert.rejects(viaje.updateTripLine(db, planned.added.id, { qty_loaded }, { now: NOW }), (e) => e.status === 400);
  }
  await assert.rejects(viaje.updateTripLine(db, note.added.id, { qty_loaded: 1 }, { now: NOW }),
    (e) => e.status === 400 && e.message === 'Una nota no lleva cantidad.');
  await assert.rejects(viaje.updateTripLine(db, planned.added.id, { qty_loaded: 10, checked: 0 }, { now: NOW }),
    (e) => e.status === 400 && e.message === 'Cargado no válido.');
  await assert.rejects(viaje.updateTripLine(db, planned.added.id, {}, { now: NOW }),
    (e) => e.status === 400 && e.message === 'No hay cambios.');
  const loaded = await viaje.updateTripLine(db, planned.added.id, { qty_loaded: 10, by: 'Ana' }, { now: NOW });
  const row = loaded.lines.find((l) => l.id === planned.added.id);
  assert.deepEqual([row.checked, row.qty_loaded, row.qty_planned], [1, 10, 18]);
  const kept = await viaje.updateTripLine(db, row.id, { checked: 1 }, { now: NOW });
  assert.equal(kept.lines.find((l) => l.id === row.id).qty_loaded, 10, 'remarcar conserva la carga real');
  const audit = await db.get("SELECT after FROM audit WHERE action = 'viaje_editar' ORDER BY id DESC LIMIT 1");
  assert.equal(JSON.parse(audit.after).qty_loaded, 10);
  const done = await viaje.finishTrip(db, { trip_id: planned.trip.id }, { now: at(1) });
  assert.equal(done.carried, 2, 'solo pasan las líneas sin marcar, nunca la diferencia de carga');
  const move = await db.get('SELECT qty, to_store_id FROM stock_moves WHERE trip_id = ?', planned.trip.id);
  assert.deepEqual(move, { qty: 10, to_store_id: 4 });
  await assert.rejects(viaje.finishTrip(db, { trip_id: planned.trip.id }, { now: at(2) }), (e) => e.status === 409);
  await assert.rejects(viaje.updateTripLine(db, row.id, { qty_loaded: 9 }, { now: at(2) }), (e) => e.status === 409);
});

test('entradas, central total, ajustes, API y copia de seguridad', async (t) => {
  const { db, product } = await setup(t);
  const a = await product('larios-12');
  await count(db, a, 2);
  await count(db, a, 10, 2);
  await weekly(db, a, 1);
  await alm.addEntries(db, { store_id: 2, items: [{ product_id: a, qty: 4 }] }, { now: NOW });
  await alm.addEntries(db, { store_id: 1, items: [{ product_id: a, qty: 3 }] }, { now: NOW });
  const out = await alm.almacen(db, { store: 2 }, { now: at(1) });
  const row = out.products.find((p) => p.product_id === a);
  assert.equal(row.stock, 14);
  assert.equal(row.stock_total, 21);
  assert.equal(row.duration.label, '≈ 5 meses');
  assert.notEqual(row.state, 'queda_poco');
  const session = await db.get('SELECT id FROM sessions WHERE business_date = ?', '2026-09-26');
  await db.run(`INSERT INTO deliveries (session_id, bar_id, product_id, qty, delivered_at, source)
    VALUES (?, 1, ?, 7, ?, 'lista')`, session.id, a, at(0).toISOString());
  const afterDelivery = (await alm.almacen(db, { store: 2 }, { now: at(1) })).products.find((p) => p.product_id === a);
  assert.equal((await alm.liveStock(db, { now: at(1) }))[a], 7);
  assert.equal(afterDelivery.stock_total, 21);
  await count(db, a, 300, 2);
  const surplus = (await alm.almacen(db, { store: 2 }, { now: at(1) })).products.find((p) => p.product_id === a);
  assert.equal(surplus.state, 'sobra');
  assert.equal(surplus.duration.label, 'más de 1 año');
  await assert.rejects(alm.addEntries(db, { store_id: 999, items: [{ product_id: a, qty: 1 }] }), (e) => e.status === 400);
  await assert.rejects(alm.addEntries(db, { store_id: 2, items: [{ product_id: a, qty: 0 }] }), (e) => e.status === 400);
  await assert.rejects(alm.addEntries(db, { store_id: 2, items: [{ product_id: a, qty: 1 }, { product_id: a, qty: 2 }] }), (e) => e.status === 400);
  const beforeRev = (await svc.bootstrap(db, {})).catalog_rev;
  await svc.updateSettings(db, { trip_weeks: 4, stores: [{ id: 1, name: 'Dentro' }, { id: 2, name: 'Fuera' }] });
  assert.equal((await svc.bootstrap(db, {})).catalog_rev, beforeRev + 1);
  assert.equal((await svc.bootstrap(db, {})).stores.find((s) => s.id === 2).name, 'Fuera');
  await assert.rejects(svc.updateSettings(db, { trip_weeks: 0 }), (e) => e.status === 400);
  await assert.rejects(svc.updateSettings(db, { stores: [{ id: 1, name: '' }] }), (e) => e.status === 400);
  const handler = createHandler({ getDb: async () => db,
    env: { STAFF_CODE: 'staff', MANAGER_PIN: 'manager' }, log: { error: () => {} } });
  const req = (path, method = 'GET', body, headers = {}) => handler(new Request(`https://test.local${path}`, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  }));
  assert.equal((await req('/api/almacen/viaje')).status, 401);
  assert.equal((await req('/api/almacen/entradas', 'POST', { store_id: 2, items: [{ product_id: a, qty: 1 }] })).status, 401);
  assert.equal((await req('/api/settings')).status, 401);
  const staff = { 'x-access-code': 'staff' };
  assert.equal((await req('/api/almacen/viaje', 'GET', null, staff)).status, 200);
  assert.equal((await req('/api/almacen/entradas', 'POST', { store_id: 2, items: [{ product_id: a, qty: 1 }] }, staff)).status, 200);
  assert.equal((await req('/api/settings', 'GET', null, { ...staff, 'x-manager-pin': 'manager' })).status, 200);
  const initial = await (await req('/api/live', 'GET', null, staff)).json();
  const add = await req('/api/almacen/viaje/lineas', 'POST', { product_id: a, qty_planned: 2 }, staff);
  assert.equal(add.status, 200);
  const trip = await add.json();
  const line = trip.added.id;
  assert.equal((await req(`/api/almacen/viaje/lineas/${line}`, 'PUT', { checked: 1 }, staff)).status, 200);
  assert.equal((await req('/api/almacen/viaje/hecho', 'POST', { trip_id: trip.trip.id }, staff)).status, 200);
  const live = await (await req('/api/live', 'GET', null, staff)).json();
  assert.ok(live.almacen_rev > initial.almacen_rev);
  assert.equal(live.trip, null);
  const extra = await viaje.addTripLine(db, { text: 'otra nota' }, { now: at(2) });
  await viaje.removeTripLine(db, extra.added.id, {}, { now: at(2) });
  const backup = await (await req('/api/backup', 'GET', null, { ...staff, 'x-manager-pin': 'manager' })).json();
  const other = await openPglite();
  t.after(() => other.end());
  await importBackup(other, backup);
  assert.deepEqual(await alm.liveStock(other), await alm.liveStock(db));
  assert.equal((await other.get("SELECT COUNT(*)::int AS n FROM stock_moves WHERE kind = 'traslado'")).n, 1);
  assert.equal((await other.get('SELECT removed FROM trip_lines WHERE id = ?', extra.added.id)).removed, 1);
});
