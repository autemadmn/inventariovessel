import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openPglite, applyMigrations, migrationFiles } from '../server/db-pglite.js';
import { checkSchema } from '../server/schema.js';
import { POINT_KEYS, SHELF_ORDER } from '../server/catalog.js';
import { importBackup } from '../server/import-backup.js';
import { createHandler } from '../server/handler.js';
import * as alm from '../server/almacen.js';
import * as svc from '../server/services.js';
import * as viaje from '../server/viaje.js';
import * as control from '../server/control.js';

const NIGHT = new Date('2026-09-26T20:00:00.000Z');
const at = (min = 0) => new Date(NIGHT.getTime() + min * 60000);
async function setup(t, opts) {
  const db = await openPglite(undefined, opts);
  t.after(() => db.end());
  return db;
}
const product = async (db, slug = 'larios-12') => (await db.get('SELECT id FROM products WHERE slug = ?', slug)).id;
const count = (db, id, store_id, qty, min = 0, extra = {}) => alm.saveCounts(db,
  { store_id, items: [{ product_id: id, qty }], by: 'Ana', ...extra }, { now: at(min) });
const stock = async (db, id, store, min = 100) => (await alm.almacenBotella(db, id, { store }, { now: at(min) })).stock;
async function complete(db, id, qty, min = 1, bar_id = 1) {
  await svc.createRequest(db, { bar_id, items: [{ product_id: id, qty }] }, { now: at(min) });
  const line = (await svc.liveState(db, { now: at(min) })).lines.find((l) => l.product_id === id && l.bar_id === bar_id && l.qty_pending);
  await svc.completeLines(db, { items: [{ line_id: line.id, qty, delivered: line.qty_delivered }], by: 'Ana' }, { now: at(min) });
  return db.get('SELECT * FROM deliveries WHERE line_id = ? ORDER BY id DESC LIMIT 1', line.id);
}
const is400 = (message) => (e) => e.status === 400 && (!message || e.message === message);

test('0005: nueve puntos, RLS, sin productos nuevos y repetición sin pisar nombres', async (t) => {
  const db = await setup(t);
  const before = (await db.all('SELECT id, name FROM products ORDER BY id'));
  assert.equal(before.length, 90);
  await applyMigrations(db);
  const stores = await db.all('SELECT * FROM stores ORDER BY sort, id');
  assert.equal(stores.length, 10);
  assert.deepEqual(stores.filter((s) => s.in_vessel).map((s) => s.map_key), POINT_KEYS);
  assert.equal(new Set(stores.map((s) => s.id)).size, 10);
  assert.deepEqual([stores[0].id, stores[0].name, stores[0].map_key], [1, 'Almacén alcohol', 'alm-alcohol']);
  assert.ok((await db.all('SELECT main_store_id FROM products WHERE id <= 51')).every((p) => p.main_store_id === 1));
  const rls = await db.all(`SELECT relname, relrowsecurity FROM pg_class
    WHERE relnamespace = current_schema()::regnamespace AND relname IN ('stores', 'products', 'deliveries')`);
  assert.equal(rls.length, 3);
  assert.ok(rls.every((r) => r.relrowsecurity));
  assert.equal((await db.get('SELECT COUNT(*)::int AS n FROM pg_policies WHERE schemaname = current_schema()')).n, 0);
  await db.run("UPDATE stores SET name = 'X' WHERE id = 1");
  await applyMigrations(db);
  assert.equal((await db.get('SELECT name FROM stores WHERE id = 1')).name, 'X');
  assert.deepEqual(await db.all('SELECT id, name FROM products ORDER BY id'), before);
  await checkSchema(db);
});

test('0005 conserva recuentos, roturas y reposiciones de In Vessel; detecta esquema antiguo', async (t) => {
  const db = await setup(t, { migrate: false });
  const files = migrationFiles();
  for (const f of files.filter((f) => !f.endsWith('0005_puntos.sql') && !f.endsWith('0009_pedir_secciones.sql'))) await db.exec(readFileSync(f, 'utf8'));
  await assert.rejects(checkSchema(db), (e) => e.status === 503 && e.message === 'Faltan las migraciones de Supabase.');
  const id = await product(db);
  await db.run(`INSERT INTO stock_counts (store_id, product_id, qty, counted_at) VALUES (1, ?, 30, ?)`, id, at(0).toISOString());
  await db.run(`INSERT INTO stock_moves (product_id, from_store_id, qty, kind, created_at)
    VALUES (?, 1, 1, 'rotura', ?)`, id, at(1).toISOString());
  const s = await db.get(`INSERT INTO sessions (business_date, created_at) VALUES ('2026-09-26', ?) RETURNING id`, at(0).toISOString());
  await db.run(`INSERT INTO deliveries (session_id, bar_id, product_id, qty, delivered_at, source)
    VALUES (?, 1, ?, 4, ?, 'lista')`, s.id, id, at(2).toISOString());
  const oldCounts = await db.all('SELECT * FROM stock_counts');
  const oldMoves = await db.all('SELECT * FROM stock_moves');
  await db.exec(readFileSync(files.find((f) => f.endsWith('0005_puntos.sql')), 'utf8'));
  await db.exec(readFileSync(files.find((f) => f.endsWith('0009_pedir_secciones.sql')), 'utf8'));
  assert.deepEqual(await db.all('SELECT * FROM stock_counts'), oldCounts.map(c=>({...c,event_order:0})));
  assert.deepEqual(await db.all('SELECT * FROM stock_moves'), oldMoves.map(m=>({...m,event_order:0,client_key:null})));
  assert.equal((await db.get('SELECT from_store_id FROM deliveries')).from_store_id, 1);
  assert.equal(await stock(db, id, 1), 25);
  assert.equal((await alm.liveStock(db, { now: at(3) }))[id], 29);
  const detail = await alm.almacenBotella(db, id, { store: 1 }, { now: at(3) });
  assert.equal(detail.store.name, 'Almacén alcohol');
  assert.deepEqual(new Set(detail.history.map((h) => h.type)), new Set(['recuento', 'rotura', 'reposicion']));
  await checkSchema(db);
  await db.run("UPDATE stores SET map_key = NULL WHERE id = 1");
  await assert.rejects(checkSchema(db), (e) => e.status === 503);
});

test('copias antiguas recuperan puntos y nombres de barras; las nuevas conservan columnas e historia', async (t) => {
  const db = await setup(t);
  const id = await product(db);
  await count(db, id, 1, 30);
  await complete(db, id, 4);
  await svc.updateSettings(db, { bars: [{ id: 1, name: 'Barra grande' }], stores: [{ id: 2, name: 'Fuera' }] });
  const backup = await svc.exportData(db);
  const old = structuredClone(backup);
  old.tables.stores = old.tables.stores.filter((s) => [1, 2].includes(s.id)).map(({ id, name, kind, sort }) => ({ id, name, kind, sort }));
  old.tables.products = old.tables.products.map(({ main_store_id, ...p }) => p);
  old.tables.deliveries = old.tables.deliveries.map(({ from_store_id, ...d }) => d);
  const imported = await setup(t);
  const result = await importBackup(imported, old);
  assert.equal(result.counts.stores, 10);
  assert.equal((await imported.get('SELECT name FROM stores WHERE id = 1')).name, 'Almacén alcohol');
  assert.equal((await imported.get('SELECT name FROM stores WHERE id = 2')).name, 'Fuera');
  assert.equal((await imported.get('SELECT name FROM stores WHERE id = 8')).name, 'Barra grande');
  assert.ok((await imported.all('SELECT main_store_id FROM products WHERE id <= 51')).every((p) => p.main_store_id === 1));
  assert.equal((await imported.get('SELECT from_store_id FROM deliveries')).from_store_id, 1);
  assert.equal(await stock(imported, id, 'in'), 30);
  await checkSchema(imported);
  await svc.updateSettings(db, { stores: [{ id: 3, name: 'Vino frío' }] });
  await count(db, id, 8, 5, 2);
  await alm.addTransfer(db, { product_id: id, from_store_id: 1, to_store_id: 9, qty: 2 }, { now: at(3) });
  const fresh = await svc.exportData(db);
  // Una copia nueva es la fuente de los nombres, aunque no coincidan con bars.
  fresh.tables.stores.find((s) => s.id === 8).name = 'Nombre conservado de la copia';
  await importBackup(imported, fresh, { force: true });
  const roundTrip = await svc.exportData(imported);
  for (const table of svc.BACKUP_TABLES.filter((table) => table !== 'settings')) {
    assert.deepEqual(roundTrip.tables[table], fresh.tables[table], table);
  }
  assert.deepEqual(await alm.liveStock(imported, { now: at(4) }), await alm.liveStock(db, { now: at(4) }));
  const noStores = structuredClone(old);
  delete noStores.tables.stores;
  await importBackup(imported, noStores, { force: true });
  assert.equal((await imported.get('SELECT COUNT(*)::int AS n FROM stores')).n, 10);
});

test('categorías nuevas, punto principal por defecto y cambios de categoría respetan la elección', async (t) => {
  const db = await setup(t);
  const boot = await svc.bootstrap(db, {});
  assert.deepEqual(boot.categories.slice(-4).map((c) => [c.id, c.name]),
    [['cerveza', 'Cervezas'], ['refresco', 'Refrescos'], ['vino', 'Vinos'], ['otros', 'Otros / sin clasificar']]);
  const beer = await svc.createProduct(db, { name: 'Prueba cerveza', category: 'cerveza' });
  assert.equal(beer.group_id, null);
  assert.equal(beer.main_store_id, 4);
  const wine = await svc.createProduct(db, { name: 'Prueba vino', category: 'vino' });
  assert.equal(wine.main_store_id, 3);
  assert.equal((await svc.createProduct(db, { name: 'Prueba refresco', category: 'refresco' })).main_store_id, 4);
  assert.equal((await svc.updateProduct(db, beer.id, { category: 'vino' })).main_store_id, 3);
  await svc.updateProduct(db, wine.id, { main_store_id: 7 });
  assert.equal((await svc.updateProduct(db, wine.id, { category: 'cerveza' })).main_store_id, 7);
  for (const main_store_id of [8, 2, 999, null]) {
    await assert.rejects(svc.createProduct(db, { name: 'Punto inválido', main_store_id }), is400('Punto principal no válido.'));
    await assert.rejects(svc.updateProduct(db, beer.id, { main_store_id }), is400('Punto principal no válido.'));
  }
  await db.run('UPDATE products SET main_store_id = NULL WHERE id = ?', beer.id);
  assert.equal(await alm.mainStoreId(db, beer.id), 3);
  assert.equal((await svc.updateProduct(db, beer.id, { category: 'ron' })).main_store_id, 1);
  assert.ok((await svc.bootstrap(db, {})).products.filter((p) => [beer.id, wine.id].includes(p.id)).every((p) => p.group_id === null));
});

test('Reponer Hecho sale del principal, entra en barra y Deshacer devuelve ambos puntos', async (t) => {
  const db = await setup(t); const id = await product(db);
  await count(db, id, 1, 30);
  await count(db, id, 8, 5);
  const d = await complete(db, id, 4, 1);
  assert.equal(d.from_store_id, 1);
  assert.equal(await stock(db, id, 1), 26);
  assert.equal(await stock(db, id, 8), 9);
  assert.equal((await alm.liveStock(db, { now: at(2) }))[id], 35);
  assert.equal((await alm.almacenBotella(db, id, { store: 1 }, { now: at(2) })).history.find((h) => h.type === 'reposicion').sign, '-');
  assert.equal((await alm.almacenBotella(db, id, { store: 8 }, { now: at(2) })).history.find((h) => h.type === 'reposicion').sign, '+');
  const total = await alm.almacenBotella(db, id, { store: 'in' }, { now: at(2) });
  assert.equal(total.result, null);
  assert.equal(total.history.find((h) => h.type === 'reposicion').sign, '');
  assert.deepEqual(total.by_point.map((p) => [p.store_id, p.stock]), [[1, 26], [8, 9]]);
  const historyKeys = ['type', 'id', 'at', 'by', 'qty', 'sign', 'note', 'from_store_id', 'from_store_name',
    'to_store_id', 'to_store_name', 'store_name', 'bar_id', 'date', 'trip_id', 'result'].sort();
  for (const h of total.history) assert.deepEqual(Object.keys(h).sort(), historyKeys);
  await svc.undoDelivery(db, d.id, { by: 'Ana' }, { now: at(2) });
  assert.equal(await stock(db, id, 1), 30);
  assert.equal(await stock(db, id, 8), 5);
  assert.equal((await db.get('SELECT COUNT(*)::int AS n FROM stock_moves')).n, 0, 'las reposiciones no se duplican como movimientos');
  // Una barra sin recuento parte de cero antes de la primera reposición.
  await complete(db, id, 2, 3, 2);
  assert.equal(await stock(db, id, 9), 2);
});

test('entregas parciales, manuales y corregidas guardan o conservan el origen correspondiente', async (t) => {
  const db = await setup(t); const id = await product(db);
  const beer = await svc.createProduct(db, { name: 'Prueba cerveza', category: 'cerveza' });
  await svc.updateProduct(db, id, { main_store_id: 7 });
  await count(db, id, 7, 20);
  await count(db, id, 8, 0);
  await svc.createRequest(db, { bar_id: 1, items: [{ product_id: id, qty: 3 }] }, { now: at(1) });
  const line = (await svc.liveState(db, { now: at(1) })).lines[0];
  await svc.deliver(db, line.id, { qty: 2 }, { now: at(2) });
  const d = await db.get('SELECT * FROM deliveries WHERE line_id = ?', line.id);
  assert.equal(d.from_store_id, 7);
  assert.equal(await stock(db, id, 7), 18);
  assert.equal(await stock(db, id, 8), 2);
  await svc.updateProduct(db, id, { main_store_id: 1 });
  assert.equal((await svc.correctDelivery(db, d.id, { qty: 1, reason: 'Cantidad real' })).from_store_id, 7);
  assert.equal((await svc.correctDelivery(db, d.id, { product_id: beer.id, reason: 'Producto real' })).from_store_id, 4);
  const audit = await db.get("SELECT after FROM audit WHERE action = 'corregir' ORDER BY id DESC LIMIT 1");
  assert.equal(JSON.parse(audit.after).from_store_id, 4);
  const manual = await svc.addManualDelivery(db, { date: '2026-09-26', bar_id: 2,
    product_id: beer.id, qty: 2, reason: 'Olvidada' }, { now: at(3) });
  assert.equal(manual.from_store_id, 4);
});

test('viaje y entradas In Vessel distribuyen cada producto a su punto principal', async (t) => {
  const db = await setup(t); const id = await product(db);
  const beer = await svc.createProduct(db, { name: 'Prueba cerveza', category: 'cerveza' });
  const wine = await svc.createProduct(db, { name: 'Prueba vino', category: 'vino' });
  await count(db, id, 1, 30);
  await count(db, id, 2, 50);
  const first = await viaje.addTripLine(db, { product_id: id, qty_planned: 12 }, { now: at(1) });
  const second = await viaje.addTripLine(db, { product_id: beer.id, qty_planned: 8 }, { now: at(1) });
  assert.deepEqual(first.to, { id: null, key: 'in', name: 'In Vessel', kind: 'local' });
  assert.deepEqual(second.lines.map((l) => l.to_store_id), [1, 4]);
  assert.equal(second.lines.find((l) => l.product_id === beer.id).to_store_name, 'Almacén cerveza y refrescos');
  for (const line of second.lines) await viaje.updateTripLine(db, line.id, { checked: 1 }, { now: at(1) });
  await viaje.finishTrip(db, { trip_id: first.trip.id }, { now: at(2) });
  assert.equal(await stock(db, id, 1), 42);
  assert.equal(await stock(db, id, 2), 38);
  assert.equal(await stock(db, beer.id, 4), 8);
  const events = await control.historial(db, { period: 'todo' }, { now: at(3) });
  const trip = events.events.find((e) => e.type === 'viaje');
  assert.equal(trip.store_id, null);
  assert.equal(trip.store_name, 'In Vessel');
  assert.deepEqual(trip.lines.map((l) => l.to_store_id), [1, 4]);
  const result = await alm.addEntries(db, { store_id: 'in', items: [
    { product_id: beer.id, qty: 3 }, { product_id: wine.id, qty: 4 }], by: 'Ana' }, { now: at(4) });
  assert.deepEqual(result, { ok: true, saved: 2 });
  assert.equal(await stock(db, beer.id, 4), 11);
  assert.equal(await stock(db, wine.id, 3), 4);
  const audit = await db.all("SELECT after FROM audit WHERE action = 'entrada' ORDER BY id");
  assert.deepEqual(audit.map((r) => JSON.parse(r.after).store_id), [4, 3]);
});

test('Mover crea base cero en destino, figura como traslado y se puede anular', async (t) => {
  const db = await setup(t); const id = await product(db);
  await count(db, id, 1, 30);
  const result = await alm.addTransfer(db, { product_id: id, from_store_id: 1, to_store_id: 9, qty: 2,
    note: 'Para la apertura', by: 'Ana' }, { now: at(1) });
  assert.equal(result.store.id, 1);
  assert.equal(result.stock, 28);
  assert.equal(await stock(db, id, 9), 2);
  assert.equal((await alm.liveStock(db, { now: at(2) }))[id], 30);
  const row = await db.get("SELECT * FROM stock_moves WHERE kind = 'traslado'");
  assert.equal(row.trip_id, null);
  const history = await control.historial(db, { period: 'todo' }, { now: at(2) });
  const transfer = history.events.find((e) => e.type === 'traslado');
  assert.equal(transfer.key, `traslado-move-${row.id}`);
  assert.deepEqual([transfer.from_store_id, transfer.store_id], [1, 9]);
  assert.equal((await alm.almacenBotella(db, id, { store: 9 }, { now: at(2) })).history[0].sign, '+');
  assert.equal(result.history.find((h) => h.type === 'traslado').sign, '-');
  const total = await alm.almacenBotella(db, id, {}, { now: at(2) });
  assert.equal(total.history.find((h) => h.type === 'traslado').sign, '');
  await control.voidMove(db, row.id, { reason: 'Duplicado', by: 'Ana' }, { now: at(3) });
  assert.equal(await stock(db, id, 1), 30);
  assert.equal(await stock(db, id, 9), null);
  assert.ok(!(await alm.almacenBotella(db, id, {}, { now: at(4) })).history.some((h) => h.type === 'traslado'));
  for (const [from_store_id, to_store_id, qty, message] of [
    [1, 1, 1, 'Elige otro punto.'], [1, 2, 1, 'Solo se puede mover entre puntos de In Vessel.'],
    [2, 9, 1, 'Solo se puede mover entre puntos de In Vessel.'], [1, 9, 0], [1, 9, 10001], [1, 9, 1.5],
  ]) await assert.rejects(alm.addTransfer(db, { product_id: id, from_store_id, to_store_id, qty }), is400(message));
});

test('roturas restan solo en su punto y la cola antigua sigue usando Almacén alcohol', async (t) => {
  const db = await setup(t); const id = await product(db);
  await count(db, id, 1, 30);
  await count(db, id, 8, 5);
  const result = await alm.addBreakage(db, { product_id: id, store_id: 8, qty: 1 }, { now: at(1) });
  assert.equal(result.store.id, 8);
  assert.equal(result.stock, 4);
  assert.equal(await stock(db, id, 1), 30);
  await alm.addBreakage(db, { product_id: id, qty: 1 }, { now: at(2) });
  assert.equal(await stock(db, id, 1), 29);
  for (const store_id of [2, 'out', 'in']) await assert.rejects(
    alm.addBreakage(db, { product_id: id, store_id, qty: 1 }), is400('Las roturas se apuntan en un punto de In Vessel.'));
  await assert.rejects(count(db, id, 'in', 1), is400('Elige un punto para contar.'));
  const legacy = await alm.saveCounts(db, { items: [{ product_id: id, qty: 28 }] }, { now: at(3) });
  assert.equal(legacy.results[0].store_id, 1);
});

test('ejemplo completo: descuadre en almacén, consumo en barras y filtro con totales completos', async (t) => {
  const db = await setup(t); const id = await product(db);
  await svc.updateProduct(db, id, { per_case: 6 });
  await count(db, id, 1, 30);
  await count(db, id, 8, 5);
  await alm.addEntries(db, { store_id: 'in', items: [{ product_id: id, qty: 12 }] }, { now: at(1) });
  await complete(db, id, 4, 2);
  await alm.addBreakage(db, { product_id: id, store_id: 1, qty: 1 }, { now: at(3) });
  await alm.addTransfer(db, { product_id: id, from_store_id: 1, to_store_id: 9, qty: 2 }, { now: at(4) });
  assert.equal((await alm.liveStock(db, { now: at(5) }))[id], 46);
  const warehouse = await count(db, id, 1, 33, 6, { key: 'ejemplo-alcohol' });
  assert.deepEqual(warehouse.results[0], { product_id: id, store_id: 1, qty: 33, expected: 35, diff: -2, kind: 'descuadre' });
  const bar1 = await count(db, id, 8, 3, 7);
  assert.deepEqual(bar1.results[0], { product_id: id, store_id: 8, qty: 3, expected: 9, diff: -6, kind: 'consumo', consumption: 6 });
  assert.equal((await count(db, id, 9, 0, 8)).results[0].consumption, 2);
  const retry = await count(db, id, 1, 33, 9, { key: 'ejemplo-alcohol' });
  assert.deepEqual(retry, warehouse, 'el reintento devuelve el resultado original');
  // Un descuadre de otro almacén y de Out Vessel verifica el filtro sin recortar totales.
  await count(db, id, 4, 6, 9);
  await count(db, id, 4, 8, 10);
  await count(db, id, 'out', 20, 9);
  await count(db, id, 2, 19, 10);
  const all = await control.descuadres(db, { period: 'todo' }, { now: at(11) });
  assert.deepEqual(all.points.map((p) => p.store_id), [1, 4, 2]);
  assert.equal(all.items.length, 3);
  assert.ok(all.items.every((i) => ![8, 9].includes(i.store_id)));
  assert.deepEqual(all.totals.map((s) => [s.store_id, s.missing, s.extra, s.count]), [[1, 2, 0, 1], [4, 0, 2, 1], [2, 1, 0, 1]]);
  const filtered = await control.descuadres(db, { period: 'todo', store: '1' }, { now: at(11) });
  assert.equal(filtered.items.length, 1);
  assert.equal(filtered.items[0].store_key, 'alm-alcohol');
  assert.deepEqual(filtered.totals, all.totals);
  await assert.rejects(control.descuadres(db, { store: 8 }), is400('Punto no válido.'));
  await assert.rejects(control.descuadres(db, { store: 3 }), is400('Punto no válido.'));
  const map = await alm.points(db);
  assert.equal(map.points.find((p) => p.id === 1).status, 'descuadre');
  assert.equal(map.points.find((p) => p.id === 8).status, 'normal');
  assert.equal(map.points.find((p) => p.id === 9).status, 'normal');
});

test('estantería a ciegas, noche con corte Madrid y consulta del stock del punto', async (t) => {
  const db = await setup(t); const id = await product(db);
  const other = await product(db, 'skyy');
  await count(db, id, 8, 9, -1440);
  let shelf = await alm.punto(db, 8, {}, { now: at(0) });
  assert.equal(shelf.mode, 'contar');
  assert.equal(shelf.night, '2026-09-26');
  const uncounted = shelf.products.find((p) => p.product_id === id);
  for (const key of ['stock', 'cases', 'controlled', 'last_count_at', 'state', 'result']) assert.equal(uncounted[key], null, key);
  assert.equal(uncounted.counted_tonight, false);
  await count(db, id, 8, 3, 540); // madrugada, misma noche del 26
  shelf = await alm.punto(db, 8, {}, { now: at(541) });
  const counted = shelf.products.find((p) => p.product_id === id);
  assert.equal(counted.stock, null);
  assert.equal(counted.counted_tonight, true);
  assert.equal(counted.result.consumption, 6);
  assert.equal(shelf.products.find((p) => p.product_id === other).result, null);
  const consult = await alm.punto(db, 8, { modo: 'consultar' }, { now: at(541) });
  assert.equal(consult.products.find((p) => p.product_id === id).stock, 3);
  assert.equal(consult.products.find((p) => p.product_id === id).controlled, true);
  const nextNight = await alm.punto(db, 8, {}, { now: at(1440) });
  assert.equal(nextNight.products.find((p) => p.product_id === id).result, null);
  for (const pointId of [3, 4, 5, 6, 7]) assert.ok((await alm.punto(db, pointId, {}, { now: at(0) })).products.every((p) => p.product_id > 51));
  const initial = await svc.bootstrap(db, {});
  const selectedIds = initial.products.filter((p) => p.group_id !== null).map((p) => p.id).sort((a, b) => a - b);
  for (const bar of [8, 9, 10]) assert.deepEqual((await alm.punto(db, bar, {}, { now: at(0) })).products.map((p) => p.product_id).sort((a, b) => a - b), selectedIds);
  const alcohol = await alm.punto(db, 1, {}, { now: at(0) });
  const categories = [...new Set(alcohol.products.map((p) => p.category))];
  assert.deepEqual(categories, SHELF_ORDER.filter((c) => categories.includes(c)));
  await assert.rejects(alm.punto(db, 2), is400('Punto no válido.'));
  await assert.rejects(alm.punto(db, 999), is400('Punto no válido.'));
});

test('membresía de punto: principal, selección, recuentos y movimientos no anulados sin duplicados', async (t) => {
  const db = await setup(t); const id = await product(db);
  const outside = await svc.createProduct(db, { name: 'Prueba fuera de selección' });
  assert.equal((await alm.punto(db, 10, {}, { now: at(0) })).products.some((p) => p.product_id === outside.id), false);
  await count(db, outside.id, 10, 0, 1);
  assert.equal((await alm.punto(db, 10, {}, { now: at(2) })).products.some((p) => p.product_id === outside.id), true);
  await alm.addTransfer(db, { product_id: id, from_store_id: 1, to_store_id: 5, qty: 2 }, { now: at(3) });
  const shelf = await alm.punto(db, 5, { modo: 'consultar' }, { now: at(4) });
  const movedProduct = shelf.products.find((p) => p.product_id === id);
  assert.equal(movedProduct.stock, 2);
  assert.equal(movedProduct.last_count_at, null);
  const move = await db.get('SELECT id FROM stock_moves');
  await control.voidMove(db, move.id, { reason: 'Fallo' });
  assert.ok(!(await alm.punto(db, 5, {}, { now: at(4) })).products.some((p) => p.product_id === id));
  const main = await alm.punto(db, 1, {}, { now: at(4) });
  assert.equal(new Set(main.products.map((p) => p.product_id)).size, main.products.length);
});

test('mapa sin contar; neveras con consumo se mantienen normales', async (t) => {
  const db = await setup(t); const id = await product(db);
  let map = await alm.points(db);
  assert.equal(map.points.length, 9);
  assert.ok(map.points.every((p) => p.status === 'sin_contar' && p.last_count_at === null));
  assert.deepEqual(map.out, { id: 2, name: 'Out Vessel' });
  await count(db, id, 3, 10);
  await count(db, id, 3, 4, 1);
  const consult = await alm.punto(db, 3, { modo: 'consultar' }, { now: at(2) });
  assert.equal(consult.products.find((p) => p.product_id === id).result.kind, 'consumo');
  assert.equal(consult.products.find((p) => p.product_id === id).result.consumption, 6);
  map = await alm.points(db);
  assert.equal(map.points.find((p) => p.id === 3).status, 'normal');
  assert.equal((await control.descuadres(db, { period: 'todo' })).items.length, 0);
});

test('API de puntos, traslados, total In Vessel y stock_total Out con una consulta de stock en live', async (t) => {
  const db = await setup(t); const id = await product(db);
  await count(db, id, 1, 30);
  await count(db, id, 8, 5);
  await count(db, id, 2, 20);
  let stockQueries = 0;
  const tracked = { ...db, all: (sql, ...args) => {
    if (sql.startsWith('WITH pts AS')) stockQueries++;
    return db.all(sql, ...args);
  } };
  const live = await svc.liveState(tracked, { now: at(1) });
  assert.equal(live.stock[id], 35);
  assert.equal(stockQueries, 1);
  assert.equal((await alm.almacen(db, {}, { now: at(1) })).store.id, null);
  assert.equal((await alm.almacen(db, { store: 'in' }, { now: at(1) })).products.find((p) => p.product_id === id).stock, 35);
  assert.equal((await alm.almacen(db, { store: 8 }, { now: at(1) })).products.find((p) => p.product_id === id).stock, 5);
  const out = await alm.almacen(db, { store: 'out' }, { now: at(1) });
  assert.equal(out.products.find((p) => p.product_id === id).stock_total, 55);
  const handler = createHandler({ getDb: async () => db, env: { STAFF_CODE: 'personal', MANAGER_PIN: 'encargado' } });
  const req = (path, method = 'GET', body, code = 'personal') => handler(new Request(`https://test.local${path}`, {
    method, headers: { 'x-access-code': code, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
  }));
  for (const url of ['/api/almacen/puntos', '/api/almacen/punto/8?modo=contar', '/api/almacen/punto/8?modo=consultar']) {
    assert.equal((await req(url, 'GET', null, '')).status, 401);
    assert.equal((await req(url)).status, 200);
  }
  assert.equal((await req('/api/almacen/punto/2')).status, 400);
  const body = { product_id: id, from_store_id: 1, to_store_id: 9, qty: 2 };
  assert.equal((await req('/api/almacen/traslados', 'POST', body, '')).status, 401);
  assert.equal((await req('/api/almacen/traslados', 'POST', body)).status, 200);
  assert.equal((await req('/api/almacen/recuentos', 'POST', { store_id: 'in', items: [{ product_id: id, qty: 1 }] })).status, 400);
});

test('Ajustes sincroniza los nombres de barras y puntos en ambas direcciones con auditoría', async (t) => {
  const db = await setup(t);
  await svc.updateSettings(db, { bars: [{ id: 1, name: 'Principal' }] }, { by: 'Ana' });
  assert.equal((await db.get('SELECT name FROM stores WHERE id = 8')).name, 'Principal');
  await svc.updateSettings(db, { stores: [{ id: 9, name: 'Segunda' }] }, { by: 'Ana' });
  assert.equal((await db.get('SELECT name FROM bars WHERE id = 2')).name, 'Segunda');
  assert.equal((await db.get("SELECT COUNT(*)::int AS n FROM audit WHERE entity = 'ajustes'")).n, 2);
  const boot = await svc.bootstrap(db, {});
  assert.equal(boot.stores.length, 10);
  assert.equal(boot.stores.find((s) => s.id === 8).bar_id, 1);
});

test('dos recuentos simultáneos del mismo punto se guardan en serie y conservan expected', async (t) => {
  const db = await setup(t); const id = await product(db);
  await count(db, id, 1, 30);
  const results = await Promise.all([count(db, id, 1, 28, 1), count(db, id, 1, 26, 1)]);
  const rows = await db.all('SELECT qty, expected FROM stock_counts WHERE store_id = 1 ORDER BY id');
  assert.deepEqual(rows, [{ qty: 30, expected: null }, { qty: 28, expected: 30 }, { qty: 26, expected: 28 }]);
  assert.equal(results[1].results[0].expected, 28);
  assert.equal(await stock(db, id, 1), 26);
});
