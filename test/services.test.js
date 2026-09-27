import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { openNodeDb } from '../server/db-node.js';
import { ensureSchema } from '../server/schema.js';
import { createHandler } from '../server/handler.js';
import * as svc from '../server/services.js';

// Sábado 26 sep 2026, 23:00 en Madrid.
const NIGHT = new Date('2026-09-26T21:00:00Z');
const later = (min, base = NIGHT) => new Date(base.getTime() + min * 60000);

async function setup() {
  const db = openNodeDb(':memory:');
  await ensureSchema(db);
  const id = (name) => db.raw.prepare('SELECT id FROM products WHERE name = ?').get(name).id;
  return { db, id };
}

test('catálogo inicial: botones por producto, dudosos por confirmar y sin datos inventados', async () => {
  const { db } = await setup();
  const visible = await svc.listProducts(db);
  assert.equal(visible.length, 17 + 10 + 9 + 12 + 1);
  assert.ok(visible.every((p) => p.capacity_ml === null && p.per_case === null));
  // Fotos de referencia solo en productos confirmados, y todas existen.
  assert.ok(visible.filter((p) => p.photo).length >= 25);
  assert.ok(visible.filter((p) => p.status !== 'confirmado').every((p) => p.photo === null));
  for (const p of visible.filter((x) => x.photo)) {
    assert.ok(existsSync(join(import.meta.dirname, '..', 'public', p.photo)), p.photo);
  }
  const pending = visible.filter((p) => p.status === 'pendiente').map((p) => p.name);
  assert.deepEqual(pending.sort(), ['Flor de Caña Añejo Reserva', 'Glenmorangie The Original', 'Old / Old Sport',
    'Puerto de Indias', 'The Macallan 12', 'Zacapa'].sort());
  const hidden = (await svc.listProducts(db, { all: true })).filter((p) => p.status === 'sin_identificar');
  assert.equal(hidden.length, 2);
  assert.ok(hidden.every((p) => !p.active));
});

test('los datos iniciales se crean una sola vez y no pisan cambios ni fotos propias', async () => {
  const { db, id } = await setup();
  await svc.updateProduct(db, id('Roku'), { name: 'Roku Gin' });
  await svc.setProductPhoto(db, id('SKYY'), { mime: 'image/jpeg', data: new Uint8Array([1, 2, 3]) });
  // Simula un arranque nuevo con otra versión del esquema.
  await db.run("UPDATE settings SET value = '0' WHERE key = 'schema_version'");
  await ensureSchema(db);
  const all = await svc.listProducts(db, { all: true });
  assert.equal(all.length, 51);
  assert.ok(!all.some((p) => p.name === 'Roku'));
  assert.match(all.find((p) => p.name === 'SKYY').photo, /^\/photos\/\d+$/);
});

test('solicitar, entregar parcialmente y registrar solo lo entregado', async () => {
  const { db, id } = await setup();
  const barcelo = id('Barceló Añejo');
  await svc.createRequest(db, { bar_id: 1, items: [{ product_id: barcelo, qty: 3 }], by: 'Ana' }, { now: NIGHT });
  let live = await svc.liveState(db, { now: later(1) });
  const line = live.lines[0];
  assert.equal(line.qty_pending, 3);

  // Una nueva petición del mismo producto y barra se suma a la línea abierta.
  await svc.createRequest(db, { bar_id: 1, items: [{ product_id: barcelo, qty: 1 }] }, { now: later(5) });
  live = await svc.liveState(db, { now: later(6) });
  assert.equal(live.lines.length, 1);
  assert.equal(live.lines[0].qty_requested, 4);

  await svc.deliver(db, line.id, { qty: 2, by: 'Luis' }, { now: later(10) });
  const after = await svc.cancelPending(db, line.id, { qty: 1, by: 'Ana' }, { now: later(12) });
  assert.equal(after.qty_delivered, 2);
  assert.equal(after.qty_pending, 1);

  const r = await svc.report(db, { period: 'night', date: '2026-09-26' });
  assert.equal(r.total, 2, 'solo cuentan las entregadas');
  assert.equal(r.unserved[barcelo], 1);
  assert.equal(r.consumption, false);
});

test('dos personas no pueden entregar la misma botella pendiente', async () => {
  const { db, id } = await setup();
  await svc.createRequest(db, { bar_id: 2, items: [{ product_id: id('Larios 12'), qty: 2 }, { product_id: id('Roku'), qty: 3 }] }, { now: NIGHT });
  const [larios, roku] = (await svc.liveState(db, { now: later(1) })).lines;
  // Dos entregas simultáneas de las mismas 2 botellas: solo una puede registrarse.
  const results = await Promise.allSettled([
    svc.deliver(db, larios.id, { qty: 2, by: 'Luis' }, { now: later(1) }),
    svc.deliver(db, larios.id, { qty: 2, by: 'Marta' }, { now: later(1) }),
  ]);
  assert.equal(results.filter((x) => x.status === 'fulfilled').length, 1);
  assert.equal(results.find((x) => x.status === 'rejected').reason.status, 409);
  await svc.deliver(db, roku.id, { qty: 2 }, { now: later(1) });
  await assert.rejects(svc.deliver(db, roku.id, { qty: 2 }, { now: later(1) }), /Solo quedan 1/);
  const r = await svc.report(db, { period: 'night', date: '2026-09-26' });
  assert.equal(r.total, 4);
});

test('«Hecho» completa la lista de una vez, respeta lo que se lleva y no duplica', async () => {
  const { db, id } = await setup();
  await svc.createRequest(db, { bar_id: 1, items: [
    { product_id: id('Larios Rosé'), qty: 4 }, { product_id: id('SKYY'), qty: 3 }] }, { now: NIGHT });
  await svc.createRequest(db, { bar_id: 2, items: [{ product_id: id('Roku'), qty: 2 }] }, { now: NIGHT });
  const lines = (await svc.liveState(db, { now: later(1) })).lines;
  const bar1 = lines.filter((l) => l.bar_id === 1);
  // De SKYY solo se llevan 2 de 3; la barra 2 no se toca.
  const items = bar1.map((l) => ({ line_id: l.id, qty: l.product_name === 'SKYY' ? 2 : l.qty_pending, delivered: l.qty_delivered }));
  const [a, b] = await Promise.all([
    svc.completeLines(db, { items, by: 'Luis' }, { now: later(10) }),
    svc.completeLines(db, { items, by: 'Marta' }, { now: later(10) }),
  ]);
  assert.equal(a.bottles + b.bottles, 6, 'dos «Hecho» a la vez no duplican');
  const after = (await svc.liveState(db, { now: later(11) })).lines.filter((l) => l.qty_pending > 0);
  assert.deepEqual(after.map((l) => [l.product_name, l.qty_pending]).sort(), [['Roku', 2], ['SKYY', 1]]);
  const r = await svc.report(db, { period: 'night', date: '2026-09-26' });
  assert.equal(r.total, 6);
  assert.ok((await svc.listAudit(db, { entity: 'reposicion' })).some((x) => x.action === 'hecho'));

  // Si se piden más mientras se reponía, lo nuevo sigue pendiente.
  await svc.createRequest(db, { bar_id: 2, items: [{ product_id: id('Roku'), qty: 1 }] }, { now: later(12) });
  const roku = lines.find((l) => l.product_name === 'Roku');
  await svc.completeLines(db, { items: [{ line_id: roku.id, qty: 2, delivered: 0 }] }, { now: later(13) });
  const left = (await svc.liveState(db, { now: later(14) })).lines.find((l) => l.id === roku.id);
  assert.equal(left.qty_pending, 1);
});

test('«Voy yo» no deja que otra persona coja la misma línea', async () => {
  const { db, id } = await setup();
  await svc.createRequest(db, { bar_id: 1, items: [{ product_id: id('SKYY'), qty: 1 }] }, { now: NIGHT });
  const [line] = (await svc.liveState(db, { now: later(1) })).lines;
  await svc.claimLine(db, line.id, { by: 'Luis' });
  await assert.rejects(svc.claimLine(db, line.id, { by: 'Marta' }), /Luis ya la está llevando/);
  const done = await svc.deliver(db, line.id, { qty: 1, by: 'Luis' }, { now: later(2) });
  assert.equal(done.claimed_by, null);
});

test('las reposiciones después de medianoche pertenecen a la misma noche', async () => {
  const { db, id } = await setup();
  await svc.createRequest(db, { bar_id: 1, items: [{ product_id: id('Roku'), qty: 1 }] }, { now: NIGHT });
  await svc.createRequest(db, { bar_id: 1, items: [{ product_id: id('SKYY'), qty: 1 }] }, { now: later(5 * 60) }); // 04:00
  const sessions = await db.all('SELECT business_date FROM sessions');
  assert.deepEqual(sessions.map((s) => s.business_date), ['2026-09-26']);
  const live = await svc.liveState(db, { now: later(5 * 60) });
  assert.equal(live.lines.length, 2);
});

test('deshacer y corregir conservan constancia del cambio', async () => {
  const { db, id } = await setup();
  await svc.createRequest(db, { bar_id: 1, items: [{ product_id: id('Brugal Añejo'), qty: 2 }] }, { now: NIGHT });
  const [line] = (await svc.liveState(db, { now: later(1) })).lines;
  await svc.deliver(db, line.id, { qty: 2 }, { now: later(1) });
  const delivery = await db.get('SELECT id FROM deliveries WHERE line_id = ?', line.id);

  await assert.rejects(svc.undoDelivery(db, delivery.id, {}, { now: later(30) }), { status: 409 });
  await svc.undoDelivery(db, delivery.id, { by: 'Luis' }, { now: later(3) });
  await assert.rejects(svc.undoDelivery(db, delivery.id, {}, { now: later(4) }), { status: 409 });
  assert.equal((await svc.liveState(db, { now: later(4) })).lines[0].qty_pending, 2);

  await svc.deliver(db, line.id, { qty: 2 }, { now: later(5) });
  const d2 = await db.get('SELECT id FROM deliveries WHERE line_id = ? AND qty > 0', line.id);
  await assert.rejects(svc.correctDelivery(db, d2.id, { qty: 1 }), /motivo/);
  await svc.correctDelivery(db, d2.id, { qty: 1, bar_id: 2, reason: 'Era para la barra 2', by: 'Encargado' });
  const r = await svc.report(db, { period: 'night', date: '2026-09-26' });
  assert.equal(r.byBar[2], 1);
  assert.equal(r.byBar[1], undefined);

  const log = await svc.listAudit(db, { entity: 'reposicion' });
  const corr = log.find((a) => a.action === 'corregir');
  assert.equal(corr.reason, 'Era para la barra 2');
  assert.deepEqual(corr.before, { botellas: 2, barra: 1, producto: 'Brugal Añejo' });
  assert.ok(log.some((a) => a.action === 'deshacer'));
});

test('«consumo» solo cuando todas las noches tienen el mismo nivel', async () => {
  const { db, id } = await setup();
  await svc.createRequest(db, { bar_id: 1, items: [{ product_id: id('Roku'), qty: 1 }] }, { now: NIGHT });
  const [line] = (await svc.liveState(db, { now: later(1) })).lines;
  await svc.deliver(db, line.id, { qty: 1 }, { now: later(1) });
  const s = await svc.findSession(db, '2026-09-26');
  await svc.updateSession(db, s.id, { same_level: true });
  assert.equal((await svc.report(db, { period: 'week', date: '2026-09-26' })).consumption, true);
  await svc.updateSession(db, s.id, { same_level: null });
  assert.equal((await svc.report(db, { period: 'week', date: '2026-09-26' })).consumption, false);
});

test('agotado en almacén: visible, reversible y avisa en la previsión', async () => {
  const { db, id } = await setup();
  const zacapa = id('Zacapa');
  await svc.setOutOfStock(db, zacapa, true, { by: 'Luis', now: NIGHT });
  await svc.createRequest(db, { bar_id: 1, items: [{ product_id: zacapa, qty: 1 }] }, { now: later(1) });
  const live = await svc.liveState(db, { now: later(2) });
  assert.equal(live.lines[0].out_of_stock, 1, 'la solicitud sigue visible y marcada');
  assert.deepEqual(live.outOfStock, [zacapa]);
  await svc.setOutOfStock(db, zacapa, false, { by: 'Luis', now: later(60) });

  const f = await svc.forecast(db, { base_from: '2026-09-20', base_to: '2026-09-27', target_from: '2026-09-28', target_to: '2026-10-04', weekdays: [5, 6] },
    { now: new Date('2026-09-28T12:00:00Z') });
  const row = f.rows.find((r) => r.product_id === zacapa);
  assert.ok(row.warnings.some((w) => w.code === 'stockout'));
  assert.ok(row.warnings.some((w) => w.code === 'unserved'));
  assert.equal(row.need, 0, 'lo pendiente no se cuenta como consumo');
  assert.equal(f.plannedDates.length, 2);
});

test('previsión desde el historial real', async () => {
  const { db, id } = await setup();
  const larios = id('Larios 12');
  // Cuatro sábados con 5 botellas cada uno.
  for (const day of ['2026-09-05', '2026-09-12', '2026-09-19', '2026-09-26']) {
    const t = new Date(`${day}T22:00:00Z`);
    await svc.createRequest(db, { bar_id: 1, items: [{ product_id: larios, qty: 5 }] }, { now: t });
    const [l] = (await svc.liveState(db, { now: later(1, t) })).lines;
    await svc.deliver(db, l.id, { qty: 5 }, { now: later(5, t) });
  }
  const f = await svc.forecast(db, {
    base_from: '2026-09-01', base_to: '2026-09-30', target_from: '2026-10-01', target_to: '2026-10-31', weekdays: [6],
  }, { now: new Date('2026-09-28T12:00:00Z') });
  assert.equal(f.summary.baseNights, 4);
  assert.equal(f.summary.plannedNights, 5); // sábados de octubre de 2026
  const row = f.rows.find((r) => r.product_id === larios);
  assert.equal(row.need, 25);
  assert.equal(row.safety, 2.5);
});

test('botellas sin identificar: se resuelven sin crear duplicados', async () => {
  const { db, id } = await setup();
  const malla = id('Botella de ron con malla');
  const resolved = await svc.resolveUnidentified(db, malla, { action: 'duplicate', target_id: id('Brugal Añejo') });
  assert.equal(resolved.status, 'descartado');
  assert.equal(resolved.active, 0);
  const before = (await svc.listProducts(db)).length;
  const small = id('Botella pequeña y oscura');
  const p = await svc.resolveUnidentified(db, small, { action: 'new', name: 'Producto confirmado', category: 'whisky' });
  assert.equal(p.status, 'pendiente');
  assert.equal((await svc.listProducts(db)).length, before + 1);
});

test('lista de compra guardada con propuesta calculada y cantidad final editable', async () => {
  const { db, id } = await setup();
  await svc.updateProduct(db, id('Roku'), { per_case: 6, capacity_ml: 700 });
  const list = await svc.savePurchase(db, null, {
    title: 'Octubre',
    lines: [{ product_id: id('Roku'), need: 20, safety: 2, stock: 5, other_out: 1, incoming: 3, final: 3, unit: 'cajas' }],
  });
  assert.equal(list.lines[0].proposed, 15);
  assert.equal(list.lines[0].final, 3);
  assert.equal(list.lines[0].unit, 'cajas');
});

test('API: código de acceso para el personal, PIN para el encargado, fotos y copia', async () => {
  const { db, id } = await setup();
  const handle = createHandler({ getDb: async () => db, env: { STAFF_CODE: 'barra', MANAGER_PIN: '4321' }, log: {} });
  const call = (path, init = {}) => handle(new Request(`http://x${path}`, init));
  assert.equal(await call('/index.html'), null, 'lo que no es API lo sirven los archivos estáticos');
  assert.equal((await call('/api/live')).status, 401);
  assert.equal((await call('/api/live', { headers: { 'X-Access-Code': 'mal' } })).status, 401);
  assert.equal((await call('/api/live', { headers: { 'X-Access-Code': 'barra' } })).status, 200);
  assert.equal((await call('/api/report', { headers: { 'X-Access-Code': 'barra' } })).status, 401);
  const mgr = { 'X-Access-Code': 'barra', 'X-Manager-Pin': '4321', 'Content-Type': 'application/json' };
  assert.equal((await call('/api/report', { headers: mgr })).status, 200);

  // Foto propia guardada en la base de datos y servida en /photos/:id.
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const res = await call(`/api/products/${id('SKYY')}/photo`, { method: 'POST', headers: mgr, body: JSON.stringify({ data: png }) });
  assert.equal(res.status, 200);
  const { photo } = await res.json();
  const img = await call(photo);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/png');

  const backup = await call('/api/backup', { headers: mgr });
  const data = await backup.json();
  assert.ok(data.tables.products.length > 40);
  assert.ok(!data.tables.settings.some((r) => r.key === 'manager_pin'));
});
