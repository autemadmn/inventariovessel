import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openPglite, migrationFiles } from '../server/db-pglite.js';
import { checkSchema } from '../server/schema.js';
import { createHandler } from '../server/handler.js';
import { importBackup } from '../server/import-backup.js';
import * as nec from '../server/necesidades.js';
import * as alm from '../server/almacen.js';
import * as viaje from '../server/viaje.js';
import * as svc from '../server/services.js';

// Simula un móvil que acaba de leer la unidad del producto.
async function setNeed(db, id, body, options) {
  const p = await db.get('SELECT per_case FROM products WHERE id = ?', id);
  return nec.setNeed(db, id, { unit: p?.per_case ? 'cajas' : 'botellas',
    per_case: p?.per_case ?? null, ...body }, options);
}

const NOW = new Date('2026-10-03T20:00:00.000Z');
const at = (min = 0) => new Date(NOW.getTime() + min * 60000);
const opts = { now: NOW };
async function setup(t, options) {
  const db = await openPglite(undefined, options);
  t.after(() => db.end());
  return db;
}
const product = async (db, slug = 'larios-12') => (await db.get('SELECT id FROM products WHERE slug = ?', slug)).id;
const count = (db, product_id, qty, store_id = 1) => alm.saveCounts(db,
  { store_id, items: [{ product_id, qty }], by: 'Ana' }, { now: at(-1) });
async function weekly(db, product_id, qty = 3, second = qty) {
  for (const [date, min, amount] of [['2026-09-19', -10, qty], ['2026-10-03', -5, second]]) {
    const s = await db.get(`INSERT INTO sessions (business_date, created_at) VALUES (?, ?)
      ON CONFLICT (business_date) DO UPDATE SET created_at = sessions.created_at RETURNING id`, date, at(min).toISOString());
    if (amount > 0) await db.run(`INSERT INTO deliveries (session_id, bar_id, product_id, qty, delivered_at, source)
      VALUES (?, 1, ?, ?, ?, 'lista')`, s.id, product_id, amount, at(min).toISOString());
  }
}
const line = (view, id) => view.lines.find((l) => l.product_id === id);
const status = (code, message) => (e) => e.status === code && (!message || e.message === message);

test('agotados: solo principal contado o marca de Reponer; ignora inactivos y sin identificar', async (t) => {
  const db = await setup(t), a = await product(db), b = await product(db, 'skyy');
  await count(db, a, 0);
  await count(db, a, 20, 8);
  let view = await nec.necesidades(db, opts);
  assert.equal(view.agotados.find((p) => p.product_id === a).reason, 'sin_stock');
  assert.equal(view.agotados.some((p) => p.product_id === b), false);
  await alm.addBreakage(db, { product_id: a, store_id: 1, qty: 1 }, opts);
  assert.equal((await nec.necesidades(db, opts)).agotados.find((p) => p.product_id === a).stock, -1);
  await svc.setOutOfStock(db, b, 1, { by: 'Ana', now: NOW });
  await svc.setOutOfStock(db, a, 1, { by: 'Ana', now: NOW });
  view = await nec.necesidades(db, opts);
  assert.equal(view.agotados.find((p) => p.product_id === b).reason, 'agotado_almacen');
  assert.equal(view.agotados.find((p) => p.product_id === a).reason, 'agotado_almacen', 'la marca tiene prioridad');
  await db.run('UPDATE products SET active = 0 WHERE id = ?', a);
  await db.run("UPDATE products SET status = 'sin_identificar' WHERE id = ?", b);
  assert.equal((await nec.necesidades(db, opts)).agotados.length, 0);
});

test('recomendación: principal, cajas hacia arriba, tope Out y descuento del pedido', async (t) => {
  const db = await setup(t), a = await product(db);
  await db.run('UPDATE products SET per_case = 6 WHERE id = ?', a);
  await weekly(db, a, 9);
  await count(db, a, 4);
  await count(db, a, 10, 8);
  await count(db, a, 20, 2);
  await alm.addTransfer(db, { product_id: a, from_store_id: 1, to_store_id: 8, qty: 1 }, opts);
  const view = await nec.necesidades(db, opts), l = line(view, a);
  assert.deepEqual([l.stock, l.weekly, l.out_stock, l.recommended, l.qty, l.unit], [3, 9, 20, 4, 4, 'cajas']);
  assert.deepEqual([l.state, l.rotation], ['queda_poco', 'alta']);
  assert.equal((await alm.suggestions(db, opts)).get(a), 20);
  await viaje.addTripLine(db, { product_id: a, qty_planned: 6 }, opts);
  const data = (await alm.recommendationData(db, opts)).products.get(a);
  assert.equal(data.bottles, 14, '27 − 3 − 6, limitado a 20 − 6');
  assert.equal(line(await nec.necesidades(db, opts), a), undefined, 'lo pedido sale del ticket');
});

test('sin recuento principal, sin consumo y sin botellas por caja no se inventan datos', async (t) => {
  const db = await setup(t), a = await product(db), b = await product(db, 'skyy');
  await db.run('UPDATE products SET per_case = NULL WHERE id = ?', b);
  await count(db, a, 0);
  assert.equal((await alm.recommendationData(db, opts)).products.get(a).bottles, null);
  await weekly(db, a, 1);
  await weekly(db, b, 1);
  await count(db, b, 15, 8);
  assert.equal((await alm.recommendationData(db, opts)).products.get(b).bottles, null);
  await alm.addEntries(db, { store_id: 1, items: [{ product_id: b, qty: 2 }] }, opts);
  assert.equal((await alm.recommendationData(db, opts)).products.get(b).bottles, null, 'una entrada no es un recuento');
  await count(db, b, 0);
  const l = line(await nec.necesidades(db, opts), b);
  assert.deepEqual([l.unit, l.per_case, l.recommended], ['botellas', null, 1], 'descuenta la entrada posterior al recuento');
  await count(db, b, 0, 2);
  assert.equal((await alm.suggestions(db, opts)).get(b), undefined, 'Out conocido sin stock limita a cero');
});

test('recomendación de cuatro cajas con Out=20 pasa veinte botellas y Hecho no deja stock negativo', async (t) => {
  const db = await setup(t), a = await product(db);
  await db.run('UPDATE products SET per_case = 6 WHERE id = ?', a);
  await weekly(db, a, 9);
  await count(db, a, 3);
  await count(db, a, 20, 2);
  const view = await nec.necesidades(db, opts);
  assert.deepEqual([line(view, a).qty, line(view, a).recommended_bottles, line(view, a).bottles], [4, 20, 20]);
  assert.deepEqual(view.totals, { products: 1, cajas: 3, botellas: 2 });
  const added = await nec.needsToTrip(db, { key: 'out-cap' }, opts);
  assert.equal(added.lines[0].qty_planned, 20);
  await viaje.updateTripLine(db, added.lines[0].trip_line_id, { qty_loaded: 20 }, opts);
  await viaje.finishTrip(db, { trip_id: added.trip_id }, { now: at(1) });
  assert.equal((await alm.almacenBotella(db, a, { store: 2 }, { now: at(1) })).stock, 0);
  assert.equal((await alm.almacenBotella(db, a, { store: 1 }, { now: at(1) })).stock, 23);
  const audit = await db.get("SELECT after FROM audit WHERE action = 'necesidades_al_pedido'");
  assert.equal(JSON.parse(audit.after).qty_planned, 20);
});

test('un ajuste manual explícito igual a la recomendación sigue siendo manual', async (t) => {
  const db = await setup(t), a = await product(db);
  await db.run('UPDATE products SET per_case = 6 WHERE id = ?', a);
  await weekly(db, a, 9);
  await count(db, a, 3);
  await count(db, a, 20, 2);
  await setNeed(db, a, { qty: 4 }, opts);
  assert.equal((await nec.needsToTrip(db, {}, opts)).lines[0].qty_planned, 24);
  assert.equal((await viaje.tripView(db, opts)).lines[0].source, 'apunte');
});

test('ediciones retrasadas rechazan cambios null→6, 6→null y 6→12 sin sustituir el ajuste', async (t) => {
  const db = await setup(t), a = await product(db);
  for (const [before, after] of [[null, 6], [6, null], [6, 12]]) {
    await db.run('UPDATE products SET per_case = ? WHERE id = ?', before, a);
    await setNeed(db, a, { qty: 7 }, opts);
    const history = await db.all('SELECT * FROM need_adjustments ORDER BY id');
    const audits = (await db.get('SELECT COUNT(*)::int AS n FROM audit')).n;
    await db.run('UPDATE products SET per_case = ? WHERE id = ?', after, a);
    await assert.rejects(nec.setNeed(db, a, { qty: 8, unit: before ? 'cajas' : 'botellas', per_case: before }, opts),
      status(409, 'Han cambiado las botellas por caja. Recarga y ajusta la cantidad.'));
    assert.deepEqual(await db.all('SELECT * FROM need_adjustments ORDER BY id'), history);
    assert.equal((await db.get('SELECT COUNT(*)::int AS n FROM audit')).n, audits);
  }
  await assert.rejects(nec.setNeed(db, a, { qty: 8 }, opts), status(400));
});

test('límites en botellas: rechaza 2.000 cajas; el máximo permitido puede cargarse', async (t) => {
  const db = await setup(t), a = await product(db);
  await db.run('UPDATE products SET per_case = 6 WHERE id = ?', a);
  await assert.rejects(setNeed(db, a, { qty: 2000 }, opts), status(400));
  assert.equal((await db.get('SELECT COUNT(*)::int AS n FROM need_adjustments')).n, 0);
  await setNeed(db, a, { qty: 1666 }, opts);
  const added = await nec.needsToTrip(db, {}, opts);
  assert.equal(added.lines[0].qty_planned, 9996);
  await viaje.updateTripLine(db, added.lines[0].trip_line_id, { qty_loaded: 9996 }, opts);
});

test('recomendación >10.000 devuelve 400, revierte todo el lote y permite reducirla', async (t) => {
  const db = await setup(t), a = await product(db), b = await product(db, 'skyy');
  await weekly(db, a, 6000);
  await count(db, a, 0);
  await setNeed(db, b, { qty: 2 }, opts);
  const history = await db.all('SELECT * FROM need_adjustments');
  const audits = (await db.get('SELECT COUNT(*)::int AS n FROM audit')).n;
  await assert.rejects(nec.needsToTrip(db, { key: 'over-limit' }, opts), (e) =>
    e.status === 400 && e.message.includes('Reduce la cantidad'));
  assert.equal((await db.get('SELECT COUNT(*)::int AS n FROM trips')).n, 0);
  assert.equal((await db.get('SELECT COUNT(*)::int AS n FROM trip_lines')).n, 0);
  assert.equal((await db.get('SELECT COUNT(*)::int AS n FROM stock_operations')).n, 0);
  assert.equal((await db.get('SELECT COUNT(*)::int AS n FROM audit')).n, audits);
  assert.deepEqual(await db.all('SELECT * FROM need_adjustments'), history);
  await setNeed(db, a, { qty: 10000 }, opts);
  assert.equal((await nec.needsToTrip(db, { key: 'over-limit' }, opts)).added, 2);
});

test('reintento después de terminar el viaje devuelve el resultado sin crear viajes ni auditoría', async (t) => {
  const db = await setup(t), a = await product(db);
  await setNeed(db, a, { qty: 2 }, opts);
  const first = await nec.needsToTrip(db, { key: 'finished-retry' }, opts);
  await viaje.updateTripLine(db, first.lines[0].trip_line_id, { checked: 1 }, opts);
  await viaje.finishTrip(db, { trip_id: first.trip_id }, { now: at(1) });
  const trips = await db.all('SELECT * FROM trips');
  const audits = (await db.get('SELECT COUNT(*)::int AS n FROM audit')).n;
  const replay = await nec.needsToTrip(db, { key: 'finished-retry' }, { now: at(2) });
  assert.deepEqual(replay.lines, first.lines);
  assert.equal(replay.trip_id, first.trip_id);
  assert.deepEqual(await db.all('SELECT * FROM trips'), trips);
  assert.equal((await db.get('SELECT COUNT(*)::int AS n FROM audit')).n, audits);
});

test('rotación por tercios con empates y orden del ticket por estado y consumo', async (t) => {
  const db = await setup(t);
  const ids = (await db.all("SELECT id FROM products WHERE active = 1 AND status = 'confirmado' ORDER BY id LIMIT 7")).map((p) => p.id);
  for (let i = 0; i < 6; i++) {
    const quantities = [[9, 9], [4, 4], [3, 3], [1, 1], [1, 0], [1, 0]][i];
    await weekly(db, ids[i], ...quantities);
    await count(db, ids[i], 0);
  }
  const ls = await nec.needLines(db, { now: NOW, productIds: ids });
  assert.deepEqual(ls.map((l) => l.rotation), ['alta', 'alta', 'media', 'media', 'baja', 'baja', null]);
  await count(db, ids[0], 1);
  await count(db, ids[1], 9); // 2,25 semanas: sin estado de queda poco, pero necesita mercancía.
  const ticket = (await nec.necesidades(db, opts)).lines;
  assert.deepEqual(ticket.slice(0, 2).map((l) => l.product_id), ids.slice(2, 4));
  assert.deepEqual(ticket.slice(2, 4).map((l) => l.product_id).sort((a, b) => a - b), ids.slice(4, 6));
  assert.deepEqual(ticket.slice(-2).map((l) => l.product_id), [ids[0], ids[1]]);
});

test('PUT compartido: conserva historial, actor, recomendado, auditoría y permite cero', async (t) => {
  const db = await setup(t), a = await product(db);
  await db.run('UPDATE products SET per_case = 6 WHERE id = ?', a);
  await weekly(db, a, 9);
  await count(db, a, 3);
  assert.equal((await setNeed(db, a, { qty: 3, by: 'Ana' }, opts)).line.adjusted, true);
  const mobile = await nec.necesidades(db, opts);
  assert.deepEqual([line(mobile, a).qty, line(mobile, a).recommended], [3, 4]);
  const r = await setNeed(db, a, { qty: 0, by: 'Luis' }, { now: at(1) });
  assert.equal(r.line.qty, 0);
  assert.equal(line(await nec.necesidades(db, { now: at(1) }), a).qty, 0);
  const history = await db.all('SELECT status, qty, created_by, closed_by FROM need_adjustments WHERE product_id = ? ORDER BY id', a);
  assert.deepEqual(history, [{ status: 'sustituido', qty: 3, created_by: 'Ana', closed_by: 'Luis' },
    { status: 'activo', qty: 0, created_by: 'Luis', closed_by: null }]);
  assert.equal((await db.get("SELECT COUNT(*)::int AS n FROM audit WHERE action = 'necesidad_ajuste'")).n, 2);
  assert.deepEqual((await nec.necesidades(db, { now: at(1) })).totals, { products: 0, cajas: 0, botellas: 0 });
  assert.ok((await svc.liveState(db, opts)).almacen_rev > 0);
});

test('PUT e incluir validan cantidades, producto apto y presencia en el pedido', async (t) => {
  const db = await setup(t), a = await product(db), b = await product(db, 'skyy');
  for (const qty of [-1, 1.5, null, 10001, 'no']) await assert.rejects(setNeed(db, a, { qty }, opts), status(400, 'Cantidad: debe ser un número entero.'));
  await assert.rejects(setNeed(db, 9999, { qty: 1 }, opts), status(400, 'Hay un producto que no existe.'));
  await db.run('UPDATE products SET active = 0 WHERE id = ?', b);
  await assert.rejects(setNeed(db, b, { qty: 1 }, opts), status(400, 'Esta botella no se puede pedir.'));
  await assert.rejects(nec.includeNeed(db, b, {}, opts), status(400));
  await db.run("UPDATE products SET active = 1, status = 'sin_identificar' WHERE id = ?", b);
  await assert.rejects(setNeed(db, b, { qty: 1 }, opts), status(400, 'Esta botella no se puede pedir.'));
  await assert.rejects(nec.includeNeed(db, 9999, {}, opts), status(400, 'Hay un producto que no existe.'));
  await viaje.addTripLine(db, { product_id: a, qty_planned: 1 }, opts);
  await assert.rejects(setNeed(db, a, { qty: 1 }, opts), status(409, 'Ya está en el pedido.'));
  await assert.rejects(nec.includeNeed(db, a, {}, opts), status(409, 'Ya está en el pedido.'));
});

test('incluir agotado sin datos empieza en cero; incluir una recomendación no escribe dos veces', async (t) => {
  const db = await setup(t), a = await product(db), b = await product(db, 'skyy');
  await svc.setOutOfStock(db, a, 1, { by: 'Ana', now: NOW });
  const included = await nec.includeNeed(db, a, { by: 'Ana' }, opts);
  assert.deepEqual([included.already, included.line.qty, included.line.recommended], [false, 0, null]);
  assert.equal((await nec.includeNeed(db, a, {}, opts)).already, true);
  await weekly(db, b, 1);
  await count(db, b, 0);
  const recommended = await nec.includeNeed(db, b, {}, opts);
  assert.equal(recommended.already, true);
  assert.ok(recommended.line.recommended > 0);
  assert.equal((await db.get('SELECT COUNT(*)::int AS n FROM need_adjustments')).n, 1);
  assert.equal((await db.get("SELECT COUNT(*)::int AS n FROM audit WHERE action = 'necesidad_incluir'")).n, 1);
});

test('ficha principal y ticket comparten el dato; barras, neveras, Out y otro principal no lo muestran', async (t) => {
  const db = await setup(t), a = await product(db);
  await db.run('UPDATE products SET per_case = 6 WHERE id = ?', a);
  await weekly(db, a, 3);
  await count(db, a, 0);
  assert.deepEqual((await alm.almacenBotella(db, a, { store: 1 }, opts)).need, line(await nec.necesidades(db, opts), a));
  const adjusted = (await setNeed(db, a, { qty: 2, by: 'Ana' }, opts)).line;
  assert.deepEqual((await alm.almacenBotella(db, a, { store: 1 }, opts)).need, adjusted);
  for (const store of [8, 3, 2, 'in', 4]) assert.equal((await alm.almacenBotella(db, a, { store }, opts)).need, null);
  await db.run('UPDATE products SET main_store_id = 4 WHERE id = ?', a);
  assert.equal((await alm.almacenBotella(db, a, { store: 4 }, opts)).need.qty, 2);
  assert.equal((await alm.almacenBotella(db, a, { store: 1 }, opts)).need, null);
  await viaje.addTripLine(db, { product_id: a, qty_planned: 12 }, opts);
  assert.equal((await alm.almacenBotella(db, a, { store: 4 }, opts)).need, null);
});

test('cambiar botellas por caja convierte ajustes entre unidades sin perder historia', async (t) => {
  const db = await setup(t), a = await product(db);
  await db.run('UPDATE products SET per_case = NULL WHERE id = ?', a);
  await setNeed(db, a, { qty: 7 }, opts);
  await db.run('UPDATE products SET per_case = 6 WHERE id = ?', a);
  assert.deepEqual([line(await nec.necesidades(db, opts), a).qty, line(await nec.necesidades(db, opts), a).unit], [2, 'cajas']);
  await setNeed(db, a, { qty: 3 }, opts);
  await db.run('UPDATE products SET per_case = NULL WHERE id = ?', a);
  assert.equal(line(await nec.necesidades(db, opts), a).qty, 18);
});

test('Añadir al pedido crea viaje, convierte cajas y conserva la vinculación; cero queda en ticket', async (t) => {
  const db = await setup(t), a = await product(db), b = await product(db, 'skyy'), c = await product(db, 'roku');
  await db.run('UPDATE products SET per_case = 6 WHERE id = ?', a);
  await db.run('UPDATE products SET per_case = NULL WHERE id IN (?, ?)', b, c);
  await weekly(db, a, 3);
  await count(db, a, 0);
  await setNeed(db, b, { qty: 3, by: 'Ana' }, opts);
  await setNeed(db, c, { qty: 0, by: 'Ana' }, opts);
  const res = await nec.needsToTrip(db, { key: 'ticket-a', by: 'Ana' }, opts);
  assert.equal(res.added, 2);
  assert.ok(res.trip_id);
  assert.equal(res.lines.find((l) => l.product_id === a).qty_planned, 12);
  assert.equal(res.lines.find((l) => l.product_id === b).qty_planned, 3);
  assert.deepEqual(res.necesidades.lines.map((l) => l.product_id), [c]);
  assert.equal(res.necesidades.pedido.lines, 2);
  const adjustments = await db.all("SELECT * FROM need_adjustments WHERE status = 'pedido' ORDER BY product_id");
  assert.equal(adjustments.length, 2);
  for (const row of adjustments) {
    assert.equal(row.trip_id, res.trip_id);
    assert.equal(row.trip_line_id, res.lines.find((l) => l.product_id === row.product_id).trip_line_id);
    assert.equal(row.closed_by, 'Ana');
  }
  const trip = await viaje.tripView(db, opts);
  assert.equal(trip.lines.find((l) => l.product_id === a).source, 'sugerido');
  assert.equal(trip.lines.find((l) => l.product_id === b).source, 'apunte');
  assert.equal((await db.get("SELECT COUNT(*)::int AS n FROM audit WHERE action = 'necesidades_al_pedido'")).n, 2);
});

test('dos móviles y reintentos: sin duplicados y clave incompatible devuelve 409', async (t) => {
  const db = await setup(t), a = await product(db), b = await product(db, 'skyy');
  await setNeed(db, a, { qty: 2 }, opts);
  await setNeed(db, b, { qty: 1 }, opts);
  const responses = await Promise.all([
    nec.needsToTrip(db, { key: 'mobile-a', by: 'Ana' }, opts),
    nec.needsToTrip(db, { key: 'mobile-b', by: 'Luis' }, opts),
  ]);
  assert.equal(responses.reduce((n, r) => n + r.added, 0), 2);
  assert.equal((await viaje.tripView(db, opts)).count, 2);
  assert.equal(responses[0].trip_id, responses[1].trip_id);
  const retry = await nec.needsToTrip(db, { key: 'mobile-a', by: 'Ana' }, opts);
  assert.deepEqual(retry.lines, responses[0].lines);
  assert.equal(retry.added, responses[0].added);
  assert.equal((await viaje.tripView(db, opts)).count, 2);
  await assert.rejects(nec.needsToTrip(db, { key: 'mobile-a', by: 'Luis' }, opts), status(409));
  assert.equal((await nec.needsToTrip(db, {}, opts)).added, 0);
});

test('apuntar y sugerido cierran el ajuste activo también si la línea ya existía', async (t) => {
  const db = await setup(t), a = await product(db), b = await product(db, 'skyy');
  await setNeed(db, a, { qty: 2 }, opts);
  const added = await viaje.addTripLine(db, { product_id: a, qty_planned: 2 }, opts);
  assert.equal((await db.get('SELECT trip_line_id FROM need_adjustments WHERE product_id = ?', a)).trip_line_id, added.added.id);
  await weekly(db, b, 1);
  await count(db, b, 0);
  await setNeed(db, b, { qty: 4 }, opts);
  const suggested = await viaje.addSuggested(db, {}, opts);
  assert.equal((await db.get('SELECT status FROM need_adjustments WHERE product_id = ?', b)).status, 'pedido');
  // Simula una copia antigua con un ajuste activo y una línea ya apuntada.
  await db.run(`INSERT INTO need_adjustments (product_id, qty, unit, created_at)
    VALUES (?, 1, 'botellas', ?)`, a, NOW.toISOString());
  assert.equal((await viaje.addTripLine(db, { product_id: a }, opts)).already, true);
  assert.equal((await db.get("SELECT COUNT(*)::int AS n FROM need_adjustments WHERE status = 'activo'")).n, 0);
  await db.run(`INSERT INTO need_adjustments (product_id, qty, unit, created_at)
    VALUES (?, 1, 'botellas', ?)`, b, NOW.toISOString());
  await viaje.addSuggested(db, {}, opts);
  assert.equal((await db.get("SELECT trip_line_id FROM need_adjustments WHERE product_id = ? ORDER BY id DESC LIMIT 1", b)).trip_line_id,
    suggested.lines.find((l) => l.product_id === b).id);
});

test('0006 idempotente, RLS sin políticas y detección cuando falta la migración', async (t) => {
  const db = await setup(t, { migrate: false });
  for (const file of migrationFiles().filter((f) => !f.endsWith('0006_necesidades.sql'))) await db.exec(readFileSync(file, 'utf8'));
  await assert.rejects(checkSchema(db), status(503, 'Faltan las migraciones de Supabase.'));
  const sql = readFileSync(migrationFiles().find((f) => f.endsWith('0006_necesidades.sql')), 'utf8');
  await db.exec(sql);
  const a = await product(db);
  await setNeed(db, a, { qty: 2, by: 'Ana' }, opts);
  const before = await db.all('SELECT * FROM need_adjustments');
  await db.exec(sql);
  assert.deepEqual(await db.all('SELECT * FROM need_adjustments'), before);
  await checkSchema(db);
  assert.equal((await db.get("SELECT relrowsecurity FROM pg_class WHERE oid = 'need_adjustments'::regclass")).relrowsecurity, true);
  assert.equal((await db.get("SELECT COUNT(*)::int AS n FROM pg_policies WHERE schemaname = current_schema() AND tablename = 'need_adjustments'")).n, 0);
});

test('copia restaura ajustes activos, sustituidos y pedidos; admite copia sin la tabla nueva', async (t) => {
  const db = await setup(t), a = await product(db), b = await product(db, 'skyy');
  await setNeed(db, a, { qty: 2, by: 'Ana' }, opts);
  await setNeed(db, a, { qty: 1, by: 'Luis' }, opts);
  await viaje.addTripLine(db, { product_id: a, qty_planned: 1 }, opts);
  await setNeed(db, b, { qty: 0, by: 'Ana' }, opts);
  const backup = await svc.exportData(db, opts);
  assert.equal(backup.tables.need_adjustments.length, 3);
  const other = await setup(t);
  await importBackup(other, backup);
  assert.deepEqual((await svc.exportData(other, opts)).tables.need_adjustments, backup.tables.need_adjustments);
  await assert.rejects(importBackup(other, backup), /ya tiene datos de operación/);
  const old = structuredClone(backup);
  delete old.tables.need_adjustments;
  const legacy = await setup(t);
  assert.equal((await importBackup(legacy, old)).counts.need_adjustments, 0);
});

test('rutas Necesidades son staff y Pedido mantiene todos los alias antiguos', async (t) => {
  const db = await setup(t), a = await product(db);
  const handler = createHandler({ getDb: async () => db, env: { STAFF_CODE: 'staff', MANAGER_PIN: 'manager' } });
  const req = (path, method = 'GET', body, access = true) => handler(new Request(`https://test.local${path}`, {
    method, headers: access ? { 'x-access-code': 'staff' } : {}, body: body ? JSON.stringify(body) : undefined,
  }));
  assert.equal((await req('/api/viajes/necesidades', 'GET', null, false)).status, 401);
  assert.equal((await req('/api/viajes/necesidades')).status, 200);
  assert.equal((await req(`/api/viajes/necesidades/${a}`, 'PUT', { qty: 2, unit: 'botellas', per_case: null, by: 'Ana' })).status, 200);
  assert.equal((await req(`/api/viajes/necesidades/${a}/incluir`, 'POST', {})).status, 200);
  const added = await req('/api/viajes/necesidades/pedido', 'POST', { key: 'route-ticket', by: 'Ana' });
  assert.equal(added.status, 200);
  const trip = await (await req('/api/viajes/pedido')).json();
  assert.deepEqual(await (await req('/api/almacen/viaje')).json(), trip);
  const id = trip.lines[0].id;
  for (const base of ['/api/viajes/pedido', '/api/almacen/viaje']) {
    assert.equal((await req(base+'/lineas', 'POST', { product_id: a })).status, 200);
    assert.equal((await req(base+`/lineas/${id}`, 'PUT', { qty_loaded: 1 })).status, 200);
  }
  const backup = await req('/api/backup', 'GET');
  assert.equal(backup.status, 401, 'la copia sigue reservada al encargado');
  const note = await (await req('/api/viajes/pedido/lineas', 'POST', { text: 'nota de prueba' })).json();
  assert.equal((await req(`/api/viajes/pedido/lineas/${note.added.id}/quitar`, 'POST', {})).status, 200);
  assert.equal((await req(`/api/almacen/viaje/lineas/${id}/quitar`, 'POST', {})).status, 200);
  const next = await (await req('/api/almacen/viaje/lineas', 'POST', { product_id: a, qty_planned: 1 })).json();
  await req(`/api/viajes/pedido/lineas/${next.added.id}`, 'PUT', { checked: 1 });
  assert.equal((await req('/api/viajes/pedido/hecho', 'POST', { trip_id: next.trip.id })).status, 200);
  assert.equal((await req('/api/almacen/viaje/hecho', 'POST', { trip_id: next.trip.id })).status, 409);
});
