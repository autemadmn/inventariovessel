import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../server/db.js';
import { createApp } from '../server/app.js';
import * as svc from '../server/services.js';

// Sábado 26 sep 2026, 23:00 en Madrid.
const NIGHT = new Date('2026-09-26T21:00:00Z');
const later = (min, base = NIGHT) => new Date(base.getTime() + min * 60000);

function setup() {
  const db = openDb(':memory:');
  const id = (name) => db.prepare('SELECT id FROM products WHERE name = ?').get(name).id;
  return { db, id };
}

test('catálogo inicial: botones por producto, dudosos por confirmar y sin datos inventados', () => {
  const { db } = setup();
  const visible = svc.listProducts(db);
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
  const hidden = svc.listProducts(db, { all: true }).filter((p) => p.status === 'sin_identificar');
  assert.equal(hidden.length, 2);
  assert.ok(hidden.every((p) => !p.active));
});

test('solicitar, entregar parcialmente y registrar solo lo entregado', () => {
  const { db, id } = setup();
  const barcelo = id('Barceló Añejo');
  const [line] = svc.createRequest(db, { bar_id: 1, items: [{ product_id: barcelo, qty: 3 }], by: 'Ana' }, { now: NIGHT });
  assert.equal(line.qty_pending, 3);

  // Una nueva petición del mismo producto y barra se suma a la línea abierta.
  const [merged] = svc.createRequest(db, { bar_id: 1, items: [{ product_id: barcelo, qty: 1 }] }, { now: later(5) });
  assert.equal(merged.id, line.id);
  assert.equal(merged.qty_requested, 4);

  svc.deliver(db, line.id, { qty: 2, by: 'Luis' }, { now: later(10) });
  const after = svc.cancelPending(db, line.id, { qty: 1, by: 'Ana' }, { now: later(12) });
  assert.equal(after.qty_delivered, 2);
  assert.equal(after.qty_pending, 1);

  const r = svc.report(db, { period: 'night', date: '2026-09-26' });
  assert.equal(r.total, 2, 'solo cuentan las entregadas');
  assert.equal(r.unserved[barcelo], 1);
  assert.equal(r.consumption, false);
});

test('dos personas no pueden entregar la misma botella pendiente', () => {
  const { db, id } = setup();
  const [line] = svc.createRequest(db, { bar_id: 2, items: [{ product_id: id('Larios 12'), qty: 2 }] }, { now: NIGHT });
  svc.deliver(db, line.id, { qty: 2, by: 'Luis' }, { now: later(1) });
  assert.throws(() => svc.deliver(db, line.id, { qty: 1, by: 'Marta' }, { now: later(2) }), { status: 409 });
  const [line2] = svc.createRequest(db, { bar_id: 2, items: [{ product_id: id('Roku'), qty: 3 }] }, { now: NIGHT });
  svc.deliver(db, line2.id, { qty: 2 }, { now: later(1) });
  assert.throws(() => svc.deliver(db, line2.id, { qty: 2 }, { now: later(1) }), /Solo quedan 1/);
});

test('las reposiciones después de medianoche pertenecen a la misma noche', () => {
  const { db, id } = setup();
  svc.createRequest(db, { bar_id: 1, items: [{ product_id: id('Roku'), qty: 1 }] }, { now: NIGHT });
  svc.createRequest(db, { bar_id: 1, items: [{ product_id: id('SKYY'), qty: 1 }] }, { now: later(5 * 60) }); // 04:00
  const sessions = db.prepare('SELECT business_date FROM sessions').all();
  assert.deepEqual(sessions.map((s) => s.business_date), ['2026-09-26']);
  const live = svc.liveState(db, { now: later(5 * 60) });
  assert.equal(live.lines.length, 2);
});

test('deshacer y corregir conservan constancia del cambio', () => {
  const { db, id } = setup();
  const [line] = svc.createRequest(db, { bar_id: 1, items: [{ product_id: id('Brugal Añejo'), qty: 2 }] }, { now: NIGHT });
  const l = svc.deliver(db, line.id, { qty: 2 }, { now: later(1) });
  const delivery = db.prepare('SELECT id FROM deliveries WHERE line_id = ?').get(l.id);

  assert.throws(() => svc.undoDelivery(db, delivery.id, {}, { now: later(30) }), { status: 409 });
  svc.undoDelivery(db, delivery.id, { by: 'Luis' }, { now: later(3) });
  assert.equal(svc.liveState(db, { now: later(4) }).lines[0].qty_pending, 2);

  const l2 = svc.deliver(db, line.id, { qty: 2 }, { now: later(5) });
  const d2 = db.prepare('SELECT id FROM deliveries WHERE line_id = ? AND qty > 0').get(l2.id);
  assert.throws(() => svc.correctDelivery(db, d2.id, { qty: 1 }), /motivo/);
  svc.correctDelivery(db, d2.id, { qty: 1, bar_id: 2, reason: 'Era para la barra 2', by: 'Encargado' });
  const r = svc.report(db, { period: 'night', date: '2026-09-26' });
  assert.equal(r.byBar[2], 1);
  assert.equal(r.byBar[1], undefined);

  const log = svc.listAudit(db, { entity: 'reposicion' });
  const corr = log.find((a) => a.action === 'corregir');
  assert.equal(corr.reason, 'Era para la barra 2');
  assert.deepEqual(corr.before, { botellas: 2, barra: 1, producto: 'Brugal Añejo' });
  assert.ok(log.some((a) => a.action === 'deshacer'));
});

test('«consumo» solo cuando todas las noches tienen el mismo nivel', () => {
  const { db, id } = setup();
  const [line] = svc.createRequest(db, { bar_id: 1, items: [{ product_id: id('Roku'), qty: 1 }] }, { now: NIGHT });
  svc.deliver(db, line.id, { qty: 1 }, { now: later(1) });
  const s = svc.findSession(db, '2026-09-26');
  svc.updateSession(db, s.id, { same_level: true });
  assert.equal(svc.report(db, { period: 'week', date: '2026-09-26' }).consumption, true);
  svc.updateSession(db, s.id, { same_level: null });
  assert.equal(svc.report(db, { period: 'week', date: '2026-09-26' }).consumption, false);
});

test('agotado en almacén: visible, reversible y avisa en la previsión', () => {
  const { db, id } = setup();
  const zacapa = id('Zacapa');
  svc.setOutOfStock(db, zacapa, true, { by: 'Luis', now: NIGHT });
  const [line] = svc.createRequest(db, { bar_id: 1, items: [{ product_id: zacapa, qty: 1 }] }, { now: later(1) });
  assert.equal(line.out_of_stock, 1, 'la solicitud sigue visible y marcada');
  svc.setOutOfStock(db, zacapa, false, { by: 'Luis', now: later(60) });

  const f = svc.forecast(db, { base_from: '2026-09-20', base_to: '2026-09-27', target_from: '2026-09-28', target_to: '2026-10-04', weekdays: [5, 6] },
    { now: new Date('2026-09-28T12:00:00Z') });
  const row = f.rows.find((r) => r.product_id === zacapa);
  assert.ok(row.warnings.some((w) => w.code === 'stockout'));
  assert.ok(row.warnings.some((w) => w.code === 'unserved'));
  assert.equal(row.need, 0, 'lo pendiente no se cuenta como consumo');
  assert.equal(f.plannedDates.length, 2);
});

test('previsión desde el historial real', () => {
  const { db, id } = setup();
  const larios = id('Larios 12');
  // Cuatro sábados con 5 botellas cada uno.
  for (const day of ['2026-09-05', '2026-09-12', '2026-09-19', '2026-09-26']) {
    const t = new Date(`${day}T22:00:00Z`);
    const [l] = svc.createRequest(db, { bar_id: 1, items: [{ product_id: larios, qty: 5 }] }, { now: t });
    svc.deliver(db, l.id, { qty: 5 }, { now: later(5, t) });
  }
  const f = svc.forecast(db, {
    base_from: '2026-09-01', base_to: '2026-09-30', target_from: '2026-10-01', target_to: '2026-10-31', weekdays: [6],
  }, { now: new Date('2026-09-28T12:00:00Z') });
  assert.equal(f.summary.baseNights, 4);
  assert.equal(f.summary.plannedNights, 5); // sábados de octubre de 2026
  const row = f.rows.find((r) => r.product_id === larios);
  assert.equal(row.need, 25);
  assert.equal(row.safety, 2.5);
});

test('botellas sin identificar: se resuelven sin crear duplicados', () => {
  const { db, id } = setup();
  const malla = id('Botella de ron con malla');
  const resolved = svc.resolveUnidentified(db, malla, { action: 'duplicate', target_id: id('Brugal Añejo') });
  assert.equal(resolved.status, 'descartado');
  assert.equal(resolved.active, 0);
  const before = svc.listProducts(db).length;
  const small = id('Botella pequeña y oscura');
  const p = svc.resolveUnidentified(db, small, { action: 'new', name: 'Producto confirmado', category: 'whisky' });
  assert.equal(p.status, 'pendiente');
  assert.equal(svc.listProducts(db).length, before + 1);
});

test('lista de compra guardada con propuesta calculada y cantidad final editable', () => {
  const { db, id } = setup();
  svc.updateProduct(db, id('Roku'), { per_case: 6, capacity_ml: 700 });
  const list = svc.savePurchase(db, null, {
    title: 'Octubre',
    lines: [{ product_id: id('Roku'), need: 20, safety: 2, stock: 5, other_out: 1, incoming: 3, final: 3, unit: 'cajas' }],
  });
  assert.equal(list.lines[0].proposed, 15);
  assert.equal(list.lines[0].final, 3);
  assert.equal(list.lines[0].unit, 'cajas');
});

test('API: código de acceso para el personal y PIN para el encargado', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'inv-'));
  const db = openDb(':memory:');
  const app = createApp(db, { dataDir: dir, env: { STAFF_CODE: 'barra', MANAGER_PIN: '4321' }, log: {} });
  const server = createServer(app).listen(0);
  const base = `http://localhost:${server.address().port}`;
  try {
    assert.equal((await fetch(`${base}/api/live`)).status, 401);
    assert.equal((await fetch(`${base}/api/live`, { headers: { 'X-Access-Code': 'mal' } })).status, 401);
    assert.equal((await fetch(`${base}/api/live`, { headers: { 'X-Access-Code': 'barra' } })).status, 200);
    assert.equal((await fetch(`${base}/api/report`, { headers: { 'X-Access-Code': 'barra' } })).status, 401);
    assert.equal((await fetch(`${base}/api/report`, { headers: { 'X-Access-Code': 'barra', 'X-Manager-Pin': '4321' } })).status, 200);
    const page = await fetch(`${base}/`);
    assert.equal(page.status, 200);
    assert.equal((await fetch(`${base}/../server/db.js`)).status, 404);
    assert.equal((await fetch(`${base}/js/shared/forecast.js`)).status, 200);
  } finally {
    app.close();
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
