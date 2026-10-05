import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { openPglite, applyMigrations } from '../server/db-pglite.js';
import { checkSchema } from '../server/schema.js';
import { createHandler } from '../server/handler.js';
import { HABITUAL_SLUGS, INITIAL_CATALOG, slugify } from '../server/catalog.js';
import { importBackup } from '../server/import-backup.js';
import { toPg } from '../server/sql.js';
import { buildSeedSql, SEED_FILE } from '../scripts/db/build-seed.mjs';
import * as svc from '../server/services.js';

// Sábado 26 sep 2026, 23:00 en Madrid.
const NIGHT = new Date('2026-09-26T21:00:00Z');
const later = (min, base = NIGHT) => new Date(base.getTime() + min * 60000);

// Una base PGlite nueva (en memoria) por test, con las migraciones aplicadas.
async function setup(t) {
  const db = await openPglite();
  t.after(() => db.end());
  const id = async (name) => (await db.get('SELECT id FROM products WHERE name = ?', name)).id;
  return { db, id };
}

const slugsOf = async (db, groupName) => (await db.all(`SELECT p.slug FROM products p
  JOIN product_groups g ON g.id = p.group_id WHERE g.name = ? ORDER BY p.group_order, p.id`, groupName)).map((r) => r.slug);

const REST_SLUGS = ['brockmans', 'bulldog-london-dry', 'gvine-floraison', 'hendricks', 'macaronesian-white-gin',
  'martin-millers', 'nordes', 'roku', 'zeeland-pink-n12', 'beluga-noble', 'belvedere-organic', 'ciroc-apple',
  'ciroc-french-vanilla', 'ciroc-original', 'ciroc-pineapple', 'ciroc-red-berry', 'titos-handmade-vodka',
  'chivas-regal-12', 'glenmorangie-the-original', 'monkey-shoulder', 'the-macallan-12', 'abuelo-12', 'abuelo-anejo',
  'barcelo-imperial', 'brugal-1888', 'brugal-doble-reserva', 'flor-de-cana-12', 'flor-de-cana-anejo-reserva', 'zacapa',
  'don-julio-reposado'];

// Se mantienen las correcciones de 0008 y se añaden los productos de 0009.
const USUAL_NOW = [...HABITUAL_SLUGS.map((s) => (s === 'old-old-sport' ? 'boldcrew-original' : s)),
  'flor-de-cana-anejo-reserva', 'cutty-sark', 'aperol'];
const REST_NOW = [...REST_SLUGS.filter((s) => s !== 'flor-de-cana-anejo-reserva'),
  'larios-150-aniversario', 'talisker-10', 'johnnie-walker-black-label-12', 'ciroc-summer-colada'];

// ------------------------------------------------------------------ catálogo y semilla

test('catálogo inicial: botones por producto, alcoholes confirmados y sin datos inventados', async (t) => {
  const { db } = await setup(t);
  const visible = await svc.listProducts(db);
  assert.equal(visible.length, 88);
  const seedSlugs = new Set(Object.values(INITIAL_CATALOG).flat().map((p) => slugify(p.name)));
  assert.ok(visible.filter((p) => seedSlugs.has(p.slug)).every((p) => p.capacity_ml === null && p.per_case === null));
  // Fotos de referencia solo en productos confirmados, y todas existen.
  assert.ok(visible.filter((p) => p.status !== 'confirmado').every((p) => p.photo === null));
  for (const p of visible.filter((x) => x.photo)) {
    assert.ok(existsSync(join(import.meta.dirname, '..', 'public', p.photo)), p.photo);
  }
  // 0007 quita «Dudoso» de los alcoholes que la semilla dejó por confirmar.
  assert.ok(visible.every((p) => p.status === 'confirmado' && p.note === null));
  const hidden = (await svc.listProducts(db, { all: true })).filter((p) => p.status === 'sin_identificar');
  assert.equal(hidden.length, 2);
  assert.ok(hidden.every((p) => !p.active));
  assert.ok(visible.every((p) => !('habitual' in p) && typeof p.slug === 'string'));
});

test('la semilla se aplica una sola vez y no pisa cambios ni fotos propias', async (t) => {
  const { db, id } = await setup(t);
  await svc.updateProduct(db, await id('Roku'), { name: 'Roku Gin' });
  await svc.setProductPhoto(db, await id('SKYY'), { mime: 'image/jpeg', data: new Uint8Array([1, 2, 3]) });
  await applyMigrations(db);
  await applyMigrations(db);
  const all = await svc.listProducts(db, { all: true });
  assert.equal(all.length, 90);
  assert.ok(!all.some((p) => p.name === 'Roku'));
  assert.equal(all.find((p) => p.name === 'Roku Gin').slug, 'roku', 'el slug no cambia al renombrar');
  assert.match(all.find((p) => p.name === 'SKYY').photo, /^\/photos\/\d+$/);
  assert.equal((await db.get('SELECT count(*)::int AS n FROM product_groups')).n, 8);
  assert.equal((await db.get('SELECT count(*)::int AS n FROM staff')).n, 3);
});

test('confirmar los alcoholes se aplica una vez: un producto nuevo por confirmar sigue así', async (t) => {
  const { db } = await setup(t);
  const p = await svc.createProduct(db, { name: 'Ginebra nueva', category: 'ginebra' });
  assert.equal(p.status, 'pendiente');
  await applyMigrations(db);
  assert.equal((await db.get('SELECT status FROM products WHERE id = ?', p.id)).status, 'pendiente');
});

test('grupos iniciales: Habituales y Premium conservan su orden y añaden las altas al final', async (t) => {
  const { db } = await setup(t);
  assert.deepEqual(await slugsOf(db, 'Habituales'), USUAL_NOW);
  assert.deepEqual(await slugsOf(db, 'Premium'), REST_NOW);
  const bold = await db.get("SELECT name, category, status FROM products WHERE slug = 'boldcrew-original'");
  assert.deepEqual({ ...bold }, { name: 'BoldCrew Original', category: 'whisky', status: 'confirmado' });
  const loose = await db.all('SELECT slug FROM products WHERE group_id IS NULL ORDER BY slug');
  assert.deepEqual(loose.map((r) => r.slug), ['botella-de-ron-con-malla', 'botella-pequena-y-oscura']);
  const staff = await svc.listStaff(db);
  assert.deepEqual(staff.map((s) => s.name), ['Carlos', 'Sergio', 'Alejandro']);
});

test('la semilla del repositorio coincide con la que genera build-seed', () => {
  const file = readFileSync(SEED_FILE, 'utf8').replace(/\r\n/g, '\n');
  assert.equal(file, buildSeedSql());
});

test('slugify: nombres del catálogo, caracteres raros y colisiones', async (t) => {
  const expected = {
    'Bulldog London Dry': 'bulldog-london-dry', 'Brockmans': 'brockmans', 'Hendrick’s': 'hendricks', 'Roku': 'roku',
    'G’Vine Floraison': 'gvine-floraison', 'Macaronesian White Gin': 'macaronesian-white-gin', 'Nordés': 'nordes',
    'Martin Miller’s': 'martin-millers', 'Tanqueray London Dry': 'tanqueray-london-dry', 'Larios Rosé': 'larios-rose',
    'Larios Pomelo': 'larios-pomelo', 'Larios 12': 'larios-12', 'Master’s London Dry': 'masters-london-dry',
    'Master’s Pink': 'masters-pink', 'Puerto de Indias': 'puerto-de-indias', 'Zeeland Nº8': 'zeeland-n8',
    'Zeeland Pink Nº12': 'zeeland-pink-n12', 'Belvedere Organic': 'belvedere-organic', 'Beluga Noble': 'beluga-noble',
    'Tito’s Handmade Vodka': 'titos-handmade-vodka', 'Cîroc Original': 'ciroc-original', 'Cîroc Apple': 'ciroc-apple',
    'Cîroc Red Berry': 'ciroc-red-berry', 'Cîroc French Vanilla': 'ciroc-french-vanilla',
    'Cîroc Pineapple': 'ciroc-pineapple', 'SKYY': 'skyy', 'Moskovskaya': 'moskovskaya',
    'Jack Daniel’s Old No. 7': 'jack-daniels-old-no-7', 'Dewar’s White Label': 'dewars-white-label',
    'Johnnie Walker Red Label': 'johnnie-walker-red-label', 'J&B Rare': 'j-b-rare', 'DYC 8': 'dyc-8',
    'Glenmorangie The Original': 'glenmorangie-the-original', 'Monkey Shoulder': 'monkey-shoulder',
    'Chivas Regal 12': 'chivas-regal-12', 'The Macallan 12': 'the-macallan-12', 'Cacique Añejo': 'cacique-anejo',
    'Barceló Añejo': 'barcelo-anejo', 'Barceló Imperial': 'barcelo-imperial',
    'Flor de Caña Añejo Reserva': 'flor-de-cana-anejo-reserva', 'Flor de Caña 12': 'flor-de-cana-12',
    'Abuelo Añejo': 'abuelo-anejo', 'Abuelo 12': 'abuelo-12', 'Brugal Doble Reserva': 'brugal-doble-reserva',
    'Brugal 1888': 'brugal-1888', 'Brugal Añejo': 'brugal-anejo', 'Zacapa': 'zacapa', 'Old / Old Sport': 'old-old-sport',
    'Don Julio Reposado': 'don-julio-reposado',
  };
  const names = Object.values(INITIAL_CATALOG).flat().map((p) => p.name);
  assert.equal(names.length, 49);
  for (const n of names) assert.equal(slugify(n), expected[n], n);
  assert.equal(slugify('Nuevo &  Raro!!'), 'nuevo-raro');
  assert.equal(slugify('¡!'), 'producto');

  const { db } = await setup(t);
  const a = await svc.createProduct(db, { name: 'Roku', category: 'ginebra' });
  const b = await svc.createProduct(db, { name: 'Róku', category: 'ginebra' });
  assert.equal(a.slug, 'roku-2');
  assert.equal(b.slug, 'roku-3');
});

// ------------------------------------------------------------------ adaptador

test('adaptador: ? entre comillas, batch atómico, rollback, RETURNING y tipos numéricos', async (t) => {
  assert.equal(toPg("SELECT '¿?' AS a, ? AS b, 'it''s ?' AS c, ?"), "SELECT '¿?' AS a, $1 AS b, 'it''s ?' AS c, $2");
  const { db, id } = await setup(t);
  assert.equal((await db.get("SELECT '¿?' AS q")).q, '¿?');

  await assert.rejects(db.batch([
    ["INSERT INTO settings (key, value) VALUES ('prueba', '1')"],
    ['INSERT INTO bars (id, name) VALUES (?, NULL)', 9],
  ]));
  assert.equal(await db.get("SELECT 1 AS ok FROM settings WHERE key = 'prueba'"), null, 'batch no deja nada a medias');

  await assert.rejects(db.tx(async (tx) => {
    await tx.run("INSERT INTO settings (key, value) VALUES ('prueba', '1')");
    throw new Error('falla');
  }), /falla/);
  assert.equal(await db.get("SELECT 1 AS ok FROM settings WHERE key = 'prueba'"), null, 'tx hace rollback');

  const r = await db.run("INSERT INTO product_groups (name, sort, created_at) VALUES ('Tmp', 99, 'x') RETURNING id");
  assert.equal(r.changes, 1);
  assert.equal(typeof r.lastId, 'number');

  const roku = await id('Roku');
  await svc.createRequest(db, { bar_id: 1, items: [{ product_id: roku, qty: 3 }] }, { now: NIGHT });
  const [line] = (await svc.liveState(db, { now: later(1) })).lines;
  await svc.deliver(db, line.id, { qty: 2 }, { now: later(2) });
  const live = await svc.liveState(db, { now: later(3) });
  assert.equal(typeof live.lines[0].qty_delivered, 'number');
  assert.equal(live.lines[0].qty_delivered, 2);
  assert.equal(live.lines[0].slug, 'roku');
  assert.equal(live.recent[0].slug, 'roku');
  assert.equal(typeof live.catalog_rev, 'number');
  const rep = await svc.report(db, { period: 'night', date: '2026-09-26' });
  assert.equal(rep.total, 2);
  const [s] = await svc.listSessions(db, { from: '2026-09-01', to: '2026-09-30' });
  assert.equal(s.delivered, 2);
  assert.equal(s.unserved, 1);
});

// ------------------------------------------------------------------ reposición

test('solicitar, entregar parcialmente y registrar solo lo entregado', async (t) => {
  const { db, id } = await setup(t);
  const barcelo = await id('Barceló Añejo');
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

test('dos pedidos simultáneos del mismo producto y barra no crean dos líneas', async (t) => {
  const { db, id } = await setup(t);
  const skyy = await id('SKYY');
  await Promise.all([
    svc.createRequest(db, { bar_id: 1, items: [{ product_id: skyy, qty: 1 }] }, { now: NIGHT }),
    svc.createRequest(db, { bar_id: 1, items: [{ product_id: skyy, qty: 2 }] }, { now: NIGHT }),
  ]);
  const { lines } = await svc.liveState(db, { now: later(1) });
  assert.equal(lines.length, 1);
  assert.equal(lines[0].qty_requested, 3);
});

test('dos personas no pueden entregar la misma botella pendiente', async (t) => {
  const { db, id } = await setup(t);
  await svc.createRequest(db, { bar_id: 2, items: [{ product_id: await id('Larios 12'), qty: 2 }, { product_id: await id('Roku'), qty: 3 }] }, { now: NIGHT });
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

test('«Hecho» completa la lista de una vez, respeta lo que se lleva y el segundo recibe 409', async (t) => {
  const { db, id } = await setup(t);
  await svc.createRequest(db, { bar_id: 1, items: [
    { product_id: await id('Larios Rosé'), qty: 4 }, { product_id: await id('SKYY'), qty: 3 }] }, { now: NIGHT });
  await svc.createRequest(db, { bar_id: 2, items: [{ product_id: await id('Roku'), qty: 2 }] }, { now: NIGHT });
  const lines = (await svc.liveState(db, { now: later(1) })).lines;
  const bar1 = lines.filter((l) => l.bar_id === 1);
  // De SKYY solo se llevan 2 de 3; la barra 2 no se toca.
  const items = bar1.map((l) => ({ line_id: l.id, qty: l.product_name === 'SKYY' ? 2 : l.qty_pending, delivered: l.qty_delivered }));
  const results = await Promise.allSettled([
    svc.completeLines(db, { items, by: 'Luis' }, { now: later(10) }),
    svc.completeLines(db, { items, by: 'Marta' }, { now: later(10) }),
  ]);
  const ok = results.filter((x) => x.status === 'fulfilled');
  assert.equal(ok.length, 1, 'dos «Hecho» a la vez no duplican');
  assert.equal(ok[0].value.bottles, 6);
  const failed = results.find((x) => x.status === 'rejected').reason;
  assert.equal(failed.status, 409);
  assert.match(failed.message, /Ya estaba hecho/);
  const after = (await svc.liveState(db, { now: later(11) })).lines.filter((l) => l.qty_pending > 0);
  assert.deepEqual(after.map((l) => [l.product_name, l.qty_pending]).sort(), [['Roku', 2], ['SKYY', 1]]);
  const r = await svc.report(db, { period: 'night', date: '2026-09-26' });
  assert.equal(r.total, 6);
  assert.ok((await svc.listAudit(db, { entity: 'reposicion' })).some((x) => x.action === 'hecho'));

  // Si se piden más mientras se reponía, lo nuevo sigue pendiente.
  await svc.createRequest(db, { bar_id: 2, items: [{ product_id: await id('Roku'), qty: 1 }] }, { now: later(12) });
  const roku = lines.find((l) => l.product_name === 'Roku');
  await svc.completeLines(db, { items: [{ line_id: roku.id, qty: 2, delivered: 0 }] }, { now: later(13) });
  const left = (await svc.liveState(db, { now: later(14) })).lines.find((l) => l.id === roku.id);
  assert.equal(left.qty_pending, 1);
});

test('«Voy yo» no deja que otra persona coja la misma línea', async (t) => {
  const { db, id } = await setup(t);
  await svc.createRequest(db, { bar_id: 1, items: [{ product_id: await id('SKYY'), qty: 1 }] }, { now: NIGHT });
  const [line] = (await svc.liveState(db, { now: later(1) })).lines;
  await svc.claimLine(db, line.id, { by: 'Luis' });
  await assert.rejects(svc.claimLine(db, line.id, { by: 'Marta' }), /Luis ya la está llevando/);
  const done = await svc.deliver(db, line.id, { qty: 1, by: 'Luis' }, { now: later(2) });
  assert.equal(done.claimed_by, null);
});

test('las reposiciones después de medianoche pertenecen a la misma noche', async (t) => {
  const { db, id } = await setup(t);
  await svc.createRequest(db, { bar_id: 1, items: [{ product_id: await id('Roku'), qty: 1 }] }, { now: NIGHT });
  await svc.createRequest(db, { bar_id: 1, items: [{ product_id: await id('SKYY'), qty: 1 }] }, { now: later(5 * 60) }); // 04:00
  const sessions = await db.all('SELECT business_date FROM sessions');
  assert.deepEqual(sessions.map((s) => s.business_date), ['2026-09-26']);
  const live = await svc.liveState(db, { now: later(5 * 60) });
  assert.equal(live.lines.length, 2);
});

test('deshacer y corregir conservan constancia del cambio', async (t) => {
  const { db, id } = await setup(t);
  await svc.createRequest(db, { bar_id: 1, items: [{ product_id: await id('Brugal Añejo'), qty: 2 }] }, { now: NIGHT });
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
  assert.deepEqual(corr.before, { botellas: 2, barra: 1, producto: 'Brugal Añejo', from_store_id: 1 });
  assert.equal(corr.after.from_store_id, 1);
  assert.ok(log.some((a) => a.action === 'deshacer'));
});

test('«consumo» solo cuando todas las noches tienen el mismo nivel', async (t) => {
  const { db, id } = await setup(t);
  await svc.createRequest(db, { bar_id: 1, items: [{ product_id: await id('Roku'), qty: 1 }] }, { now: NIGHT });
  const [line] = (await svc.liveState(db, { now: later(1) })).lines;
  await svc.deliver(db, line.id, { qty: 1 }, { now: later(1) });
  const s = await svc.findSession(db, '2026-09-26');
  await svc.updateSession(db, s.id, { same_level: true });
  assert.equal((await svc.report(db, { period: 'week', date: '2026-09-26' })).consumption, true);
  await svc.updateSession(db, s.id, { same_level: null });
  assert.equal((await svc.report(db, { period: 'week', date: '2026-09-26' })).consumption, false);
});

test('agotado en almacén: visible, reversible y avisa en la previsión', async (t) => {
  const { db, id } = await setup(t);
  const zacapa = await id('Zacapa');
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

test('previsión desde el historial real', async (t) => {
  const { db, id } = await setup(t);
  const larios = await id('Larios 12');
  // Cuatro sábados con 5 botellas cada uno.
  for (const day of ['2026-09-05', '2026-09-12', '2026-09-19', '2026-09-26']) {
    const at = new Date(`${day}T22:00:00Z`);
    await svc.createRequest(db, { bar_id: 1, items: [{ product_id: larios, qty: 5 }] }, { now: at });
    const [l] = (await svc.liveState(db, { now: later(1, at) })).lines;
    await svc.deliver(db, l.id, { qty: 5 }, { now: later(5, at) });
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

test('botellas sin identificar: se resuelven sin crear duplicados', async (t) => {
  const { db, id } = await setup(t);
  const malla = await id('Botella de ron con malla');
  const resolved = await svc.resolveUnidentified(db, malla, { action: 'duplicate', target_id: await id('Brugal Añejo') });
  assert.equal(resolved.status, 'descartado');
  assert.equal(resolved.active, 0);
  assert.equal(resolved.group_id, null);
  const before = (await svc.listProducts(db)).length;
  const small = await id('Botella pequeña y oscura');
  const resto = (await svc.listGroups(db)).find((g) => g.name === 'Premium');
  const p = await svc.resolveUnidentified(db, small, { action: 'new', name: 'Producto confirmado', category: 'whisky', group_id: resto.id });
  assert.equal(p.status, 'pendiente');
  assert.equal(p.slug, 'producto-confirmado', 'al identificarlo se recalcula el slug');
  assert.equal(p.group_id, resto.id);
  assert.equal(p.group_order, 35);
  assert.equal((await svc.listProducts(db)).length, before + 1);
});

test('lista de compra guardada con propuesta calculada y cantidad final editable', async (t) => {
  const { db, id } = await setup(t);
  await svc.updateProduct(db, await id('Roku'), { per_case: 6, capacity_ml: 700 });
  const list = await svc.savePurchase(db, null, {
    title: 'Octubre',
    lines: [{ product_id: await id('Roku'), need: 20, safety: 2, stock: 5, other_out: 1, incoming: 3, final: 3, unit: 'cajas' }],
  });
  assert.equal(list.lines[0].proposed, 15);
  assert.equal(list.lines[0].final, 3);
  assert.equal(list.lines[0].unit, 'cajas');
});

// ------------------------------------------------------------------ selección

test('grupos: crear, validar, renombrar, ordenar y borrar moviendo sus botellas', async (t) => {
  const { db } = await setup(t);
  const g = await svc.createGroup(db, { name: '  Novedades ' }, { by: 'Encargado' });
  assert.deepEqual({ ...g }, { id: g.id, name: 'Novedades', sort: 90, section: 'alcohol' });
  await assert.rejects(svc.createGroup(db, { name: 'NOVEDADES' }), { status: 409, message: 'Ya existe un grupo con ese nombre.' });
  await assert.rejects(svc.createGroup(db, { name: '   ' }), { status: 400, message: 'El nombre debe tener entre 1 y 40 caracteres.' });
  await assert.rejects(svc.createGroup(db, { name: 'x'.repeat(41) }), { status: 400 });

  const renamed = await svc.renameGroup(db, g.id, { name: 'Nuevas' }, { by: 'Encargado' });
  assert.equal(renamed.name, 'Nuevas');
  await assert.rejects(svc.renameGroup(db, g.id, { name: 'premium' }), { status: 409 });

  const groups = await svc.listGroups(db);
  const [usual, rest] = groups;
  await assert.rejects(svc.orderGroups(db, { ids: [g.id, usual.id] }), { status: 400, message: 'La lista no coincide: recarga e inténtalo de nuevo.' });
  const ordered = await svc.orderGroups(db, { ids: [g.id, ...groups.filter((x) => x.id !== g.id).map((x) => x.id)] });
  assert.deepEqual(ordered.map((x) => [x.name, x.sort]), [['Nuevas', 10], ['Habituales', 20], ['Premium', 30], ['Nevera', 40], ['Chupitos', 50], ['Cervezas especiales', 60], ['Refrescos', 70], ['Zumos', 80], ['Otros', 90]]);

  // Borrar Habituales moviendo sus productos al final de Nuevas (vacío), en su orden.
  await assert.rejects(svc.deleteGroup(db, usual.id, {}), { status: 400, message: 'Indica a dónde van las botellas del grupo.' });
  await assert.rejects(svc.deleteGroup(db, usual.id, { move_to: String(usual.id) }), { status: 400, message: 'Grupo de destino no válido.' });
  await assert.rejects(svc.deleteGroup(db, usual.id, { move_to: '999' }), { status: 400 });
  await assert.rejects(svc.deleteGroup(db, usual.id, { move_to: 'abc' }), { status: 400 });
  const res = await svc.deleteGroup(db, usual.id, { move_to: String(g.id), by: 'Encargado' });
  assert.deepEqual(res, { ok: true, moved: USUAL_NOW.length });
  assert.deepEqual(await slugsOf(db, 'Nuevas'), USUAL_NOW);
  const orders = (await db.all('SELECT group_order FROM products WHERE group_id = ? ORDER BY group_order', g.id)).map((r) => r.group_order);
  assert.deepEqual(orders, USUAL_NOW.map((_, i) => i + 1));

  // Borrar Premium dejando sus botellas fuera de la selección.
  await svc.deleteGroup(db, rest.id, { move_to: 'none' });
  assert.equal((await db.get('SELECT count(*)::int AS n FROM products WHERE group_id IS NULL')).n, 2 + REST_NOW.length);
  await assert.rejects(svc.deleteGroup(db, rest.id, { move_to: 'none' }), { status: 404 });

  const log = await svc.listAudit(db, { entity: 'seleccion' });
  assert.deepEqual([...new Set(log.map((a) => a.action))].sort(),
    ['borrar grupo', 'crear grupo', 'ordenar grupos', 'renombrar grupo']);
  const del = log.find((a) => a.action === 'borrar grupo' && a.after.destino === 'Nuevas');
  assert.deepEqual(del.before, { name: 'Habituales', botellas: USUAL_NOW.length });
});

test('orden de botellas: mover entre grupos, renumerar, validar sin aplicar nada y quitar', async (t) => {
  const { db, id } = await setup(t);
  const [usual, rest] = await svc.listGroups(db);
  const roku = await id('Roku');
  const skyy = await id('SKYY');
  const moskovskaya = await id('Moskovskaya');

  // Roku pasa a Habituales, en segunda posición; los Habituales se envían completos.
  const usualIds = (await db.all('SELECT id FROM products WHERE group_id = ? ORDER BY group_order', usual.id)).map((r) => r.id);
  const wantedUsual = [usualIds[0], roku, ...usualIds.slice(1)];
  const res = await svc.orderProducts(db, {
    items: wantedUsual.map((pid, i) => ({ id: pid, group_id: usual.id, group_order: i + 1 })), by: 'Encargado',
  });
  assert.equal(res.ok, true);
  assert.equal(typeof res.catalog_rev, 'number');
  const inUsual = res.items.filter((x) => x.group_id === usual.id);
  assert.deepEqual(inUsual.map((x) => x.id), wantedUsual);
  assert.deepEqual(inUsual.map((x) => x.group_order), wantedUsual.map((_, i) => i + 1));
  // El grupo de origen (Premium) se renumera sin huecos.
  const restOrders = res.items.filter((x) => x.group_id === rest.id).map((x) => x.group_order);
  assert.deepEqual(restOrders, restOrders.map((_, i) => i + 1));
  assert.equal(restOrders.length, REST_NOW.length - 1);

  // Grupo inválido: 400 y nada aplicado.
  const before = await db.all('SELECT id, group_id, group_order FROM products ORDER BY id');
  await assert.rejects(svc.orderProducts(db, { items: [
    { id: skyy, group_id: rest.id, group_order: 1 }, { id: moskovskaya, group_id: 999, group_order: 1 }] }),
  { status: 400, message: 'Grupo no válido.' });
  await assert.rejects(svc.orderProducts(db, { items: [{ id: 99999, group_id: rest.id, group_order: 1 }] }),
    { status: 400, message: 'Hay un producto que no existe.' });
  await assert.rejects(svc.orderProducts(db, { items: [] }), { status: 400, message: 'No hay cambios que guardar.' });
  await assert.rejects(svc.orderProducts(db, { items: [{ id: await id('Botella pequeña y oscura'), group_id: rest.id, group_order: 1 }] }),
    { status: 400, message: 'Identifica «Botella pequeña y oscura» antes de añadirlo a la selección.' });
  assert.deepEqual(await db.all('SELECT id, group_id, group_order FROM products ORDER BY id'), before);

  // Quitar de la selección.
  await svc.orderProducts(db, { items: [{ id: skyy, group_id: null, group_order: 5 }] });
  const s = await db.get('SELECT group_id, group_order FROM products WHERE id = ?', skyy);
  assert.deepEqual({ ...s }, { group_id: null, group_order: null });
  assert.ok((await svc.bootstrap(db, { managerRequired: false })).products.some((p) => p.id === skyy),
    'fuera de la selección sigue en el catálogo');

  // PUT /api/products/:id con group_id: al final del grupo.
  const p = await svc.updateProduct(db, skyy, { group_id: rest.id });
  assert.equal(p.group_id, rest.id);
  assert.equal(p.group_order, REST_NOW.length);
  const out = await svc.updateProduct(db, skyy, { group_id: null });
  assert.equal(out.group_order, null);

  // Crear producto: con grupo va al final; sin grupo, fuera de la selección.
  const n1 = await svc.createProduct(db, { name: 'Nueva ginebra', category: 'ginebra', group_id: usual.id });
  assert.equal(n1.group_order, USUAL_NOW.length + 1); // Habituales + Roku − SKYY
  const n2 = await svc.createProduct(db, { name: 'Otra nueva', category: 'ginebra' });
  assert.equal(n2.group_id, null);
  await assert.rejects(svc.createProduct(db, { name: 'X', group_id: 999 }), { status: 400, message: 'Grupo no válido.' });
  assert.ok((await svc.listAudit(db, { entity: 'seleccion' })).some((a) => a.action === 'ordenar botellas'));
});

// ------------------------------------------------------------------ personal

test('personal: alta, repetidos, reactivar, renombrar, retirar y ordenar', async (t) => {
  const { db } = await setup(t);
  const ana = await svc.createStaff(db, { name: 'Ana' }, { by: 'Encargado' });
  assert.equal(ana.sort, 40);
  assert.equal(ana.active, 1);
  await assert.rejects(svc.createStaff(db, { name: 'carlos' }), { status: 409, message: 'Ya existe una persona con ese nombre.' });
  await assert.rejects(svc.createStaff(db, { name: '' }), { status: 400 });

  const renamed = await svc.updateStaff(db, ana.id, { name: 'Ana María' });
  assert.equal(renamed.name, 'Ana María');
  await assert.rejects(svc.updateStaff(db, ana.id, { name: 'Sergio' }), { status: 409 });
  await assert.rejects(svc.updateStaff(db, 999, { name: 'Nadie' }), { status: 404, message: 'Persona no encontrada' });

  const carlos = (await svc.listStaff(db)).find((s) => s.name === 'Carlos');
  await svc.updateStaff(db, carlos.id, { active: false });
  const boot = await svc.bootstrap(db, { managerRequired: false });
  assert.ok(!boot.staff.some((s) => s.name === 'Carlos'), 'retirado: no sale al elegir');
  const all = await svc.listStaff(db, { all: true });
  assert.equal(all.at(-1).name, 'Carlos');
  assert.equal(all.at(-1).active, 0);

  // Alta con el nombre de un retirado: se reactiva al final.
  const again = await svc.createStaff(db, { name: 'CARLOS' });
  assert.equal(again.id, carlos.id);
  assert.equal(again.active, 1);
  assert.equal((await svc.listStaff(db)).at(-1).id, carlos.id);

  await svc.updateStaff(db, carlos.id, { active: false });
  const active = (await svc.listStaff(db)).map((s) => s.id);
  await assert.rejects(svc.orderStaff(db, { ids: [...active, carlos.id] }), { status: 400 });
  const ordered = await svc.orderStaff(db, { ids: [...active].reverse() });
  assert.deepEqual(ordered.filter((s) => s.active).map((s) => s.id), [...active].reverse());
  const actions = (await svc.listAudit(db, { entity: 'personal' })).map((a) => a.action);
  for (const a of ['crear', 'renombrar', 'retirar', 'reactivar', 'ordenar']) assert.ok(actions.includes(a), a);
});

// ------------------------------------------------------------------ catalog_rev

test('catalog_rev: sube con catálogo, selección, personal y barras; no con la operación', async (t) => {
  const { db, id } = await setup(t);
  const rev = () => svc.catalogRev(db);
  const r0 = await rev();
  assert.equal(r0, 5, 'la semilla la deja en 1; 0007, 0008, 0009 y 0010 la suben una vez cada una');
  assert.equal((await svc.bootstrap(db, { managerRequired: false })).catalog_rev, r0);
  assert.equal((await svc.liveState(db, { now: NIGHT })).catalog_rev, r0);

  const roku = await id('Roku');
  await svc.createRequest(db, { bar_id: 1, items: [{ product_id: roku, qty: 2 }] }, { now: NIGHT });
  const [line] = (await svc.liveState(db, { now: later(1) })).lines;
  await svc.claimLine(db, line.id, { by: 'Luis' });
  await svc.deliver(db, line.id, { qty: 1 }, { now: later(2) });
  await svc.completeLines(db, { items: [{ line_id: line.id, qty: 1, delivered: 1 }] }, { now: later(3) });
  await svc.setOutOfStock(db, roku, true, { now: later(4) });
  await svc.updateSettings(db, { safety_pct: 15 });
  assert.equal(await rev(), r0, 'la operación no toca el catálogo');

  let expected = r0;
  const bumps = [
    () => svc.updateProduct(db, roku, { note: 'Nota' }),
    () => svc.createGroup(db, { name: 'Nuevas' }),
    async () => {
      const [usual] = await svc.listGroups(db);
      return svc.orderProducts(db, { items: [{ id: roku, group_id: usual.id, group_order: 1 }] });
    },
    () => svc.createStaff(db, { name: 'Ana' }),
    () => svc.updateSettings(db, { bars: [{ id: 1, name: 'Barra grande' }] }),
  ];
  for (const fn of bumps) {
    await fn();
    expected += 1;
    assert.equal(await rev(), expected);
  }
});

// ------------------------------------------------------------------ copia de seguridad

test('import: copia antigua con habituales, sin slugs, grupos ni personal', async (t) => {
  const { db: src, id } = await setup(t);
  await svc.updateProduct(src, await id('Larios 12'), { name: 'Larios Doce' });
  const data = await svc.exportData(src);
  const habitual = { roku: 1, skyy: 2 };
  const legacy = {
    exported_at: data.exported_at,
    tables: {
      ...data.tables,
      settings: [...data.tables.settings, { key: 'schema_version', value: '3' }, { key: 'habitual_init', value: '1' }],
      products: data.tables.products.map(({ slug, group_id, group_order, ...p }) => ({
        ...p,
        photo: slug === 'brockmans' ? '/photos/9' : p.photo,
        habitual: habitual[slug] ? 1 : 0,
        habitual_order: habitual[slug] ?? null,
      })),
    },
  };
  delete legacy.tables.product_groups;
  delete legacy.tables.staff;

  const { db } = await setup(t);
  const r = await importBackup(db, legacy);
  assert.equal(r.legacy, true);
  assert.equal(r.photosCleared, 1);
  assert.deepEqual(await slugsOf(db, 'Habituales'), ['roku', 'skyy']);
  assert.equal((await slugsOf(db, 'Premium')).length, 86);
  assert.equal((await slugsOf(db, 'Premium'))[0], 'brockmans');
  const doce = await db.get("SELECT slug FROM products WHERE name = 'Larios Doce'");
  assert.equal(doce.slug, 'larios-12', 'el slug sale de la ruta de su foto');
  assert.equal((await db.get("SELECT photo FROM products WHERE slug = 'brockmans'")).photo, null);
  assert.deepEqual((await svc.listStaff(db)).map((s) => s.name), ['Carlos', 'Sergio', 'Alejandro']);
  assert.equal(await db.get("SELECT 1 AS ok FROM settings WHERE key = 'schema_version'"), null);
  await checkSchema(db);

  // Secuencias ajustadas: lo nuevo no choca con los ids importados.
  const { m } = await db.get('SELECT MAX(id)::int AS m FROM products');
  const p = await svc.createProduct(db, { name: 'Tras importar' });
  assert.ok(p.id > m);
  const g = await svc.createGroup(db, { name: 'Tras importar' });
  assert.ok(g.id > 2);
});

test('import: ida y vuelta idéntica y no pisa datos de operación sin --force', async (t) => {
  const { db: src, id } = await setup(t);
  await svc.createRequest(src, { bar_id: 1, items: [{ product_id: await id('Roku'), qty: 3 }], by: 'Ana' }, { now: NIGHT });
  const [line] = (await svc.liveState(src, { now: later(1) })).lines;
  await svc.deliver(src, line.id, { qty: 2, by: 'Luis' }, { now: later(2) });
  await svc.createStaff(src, { name: 'Ana' });
  const data = await svc.exportData(src);

  const { db } = await setup(t);
  const r = await importBackup(db, data);
  assert.equal(r.legacy, false);
  for (const table of svc.BACKUP_TABLES.filter((x) => x !== 'settings')) {
    assert.equal(r.counts[table], data.tables[table].length, table);
    assert.equal((await db.all(`SELECT ${table === 'stock_operations' ? 'key' : 'id'} FROM ${table}`)).length, data.tables[table].length, table);
  }
  const strip = ({ catalog_rev, ...rest }) => rest;
  assert.deepEqual(strip(await svc.liveState(db, { now: later(3) })), strip(await svc.liveState(src, { now: later(3) })));

  await assert.rejects(importBackup(db, data), /--force/);
  await importBackup(db, data, { force: true });
  assert.equal((await db.all('SELECT id FROM deliveries')).length, 1);
});

// ------------------------------------------------------------------ API HTTP

test('API: código de acceso para el personal, PIN para el encargado, fotos y copia', async (t) => {
  const { db, id } = await setup(t);
  const handle = createHandler({ getDb: async () => db, env: { STAFF_CODE: 'barra', MANAGER_PIN: '4321' }, log: {} });
  const call = (path, init = {}) => handle(new Request(`http://x${path}`, init));
  assert.equal(await call('/index.html'), null, 'lo que no es API lo sirven los archivos estáticos');
  assert.equal((await call('/api/live')).status, 401);
  assert.equal((await call('/api/live', { headers: { 'X-Access-Code': 'mal' } })).status, 401);
  assert.equal((await call('/api/live', { headers: { 'X-Access-Code': 'barra' } })).status, 200);
  assert.equal((await call('/api/report', { headers: { 'X-Access-Code': 'barra' } })).status, 401);
  const staffH = { 'X-Access-Code': 'barra', 'Content-Type': 'application/json' };
  const mgr = { ...staffH, 'X-Manager-Pin': '4321' };
  assert.equal((await call('/api/report', { headers: mgr })).status, 200);

  // Rutas nuevas: solo encargado.
  for (const [method, path] of [['GET', '/api/staff'], ['POST', '/api/staff'], ['PUT', '/api/staff/order'],
    ['POST', '/api/groups'], ['PUT', '/api/groups/order'], ['PUT', '/api/groups/1'], ['DELETE', '/api/groups/1'],
    ['PUT', '/api/products/order']]) {
    const res = await call(path, { method, headers: staffH, body: ['GET', 'DELETE'].includes(method) ? undefined : '{}' });
    assert.equal(res.status, 401, `${method} ${path}`);
  }

  const boot = await (await call('/api/bootstrap', { headers: staffH })).json();
  assert.deepEqual(boot.groups.map((g) => g.name), ['Habituales', 'Premium', 'Nevera', 'Chupitos', 'Cervezas especiales', 'Refrescos', 'Zumos', 'Otros']);
  assert.deepEqual(boot.staff.map((s) => s.name), ['Carlos', 'Sergio', 'Alejandro']);
  assert.equal(typeof boot.catalog_rev, 'number');
  assert.ok(boot.products.every((p) => !('habitual' in p) && 'group_id' in p && 'slug' in p));

  // /api/groups/order no cae en /api/groups/:id.
  const ids = boot.groups.map((g) => g.id).reverse();
  const ord = await call('/api/groups/order', { method: 'PUT', headers: mgr, body: JSON.stringify({ ids, by: 'E' }) });
  assert.equal(ord.status, 200);
  assert.deepEqual((await ord.json()).map((g) => g.id), ids);
  const bad = await call('/api/groups/order', { method: 'PUT', headers: mgr, body: JSON.stringify({ ids: [ids[0]] }) });
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).error, 'La lista no coincide: recarga e inténtalo de nuevo.');

  const created = await (await call('/api/groups', { method: 'POST', headers: mgr, body: JSON.stringify({ name: 'Nuevas', by: 'E' }) })).json();
  const dup = await call('/api/groups', { method: 'POST', headers: mgr, body: JSON.stringify({ name: 'nuevas' }) });
  assert.equal(dup.status, 409);
  const [usual] = boot.groups;
  const noDest = await call(`/api/groups/${usual.id}?by=E`, { method: 'DELETE', headers: mgr });
  assert.equal(noDest.status, 400);
  const del = await call(`/api/groups/${usual.id}?move_to=${created.id}&by=E`, { method: 'DELETE', headers: mgr });
  assert.equal(del.status, 200);
  assert.deepEqual(await del.json(), { ok: true, moved: USUAL_NOW.length });

  // Foto propia guardada en la base de datos y servida en /photos/:id.
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const res = await call(`/api/products/${await id('SKYY')}/photo`, { method: 'POST', headers: mgr, body: JSON.stringify({ data: png }) });
  assert.equal(res.status, 200);
  const { photo } = await res.json();
  const img = await call(photo);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/png');
  assert.equal((await img.arrayBuffer()).byteLength, 70);

  const backup = await call('/api/backup', { headers: mgr });
  const data = await backup.json();
  assert.ok(data.tables.products.length > 40);
  assert.equal(data.tables.product_groups.length, 8);
  assert.equal(data.tables.staff.length, 3);
  assert.ok(!data.tables.settings.some((r) => r.key === 'manager_pin'));
});

test('sin migraciones: 503 «Faltan las migraciones de Supabase.»', async (t) => {
  const db = await openPglite(undefined, { migrate: false });
  t.after(() => db.end());
  await assert.rejects(checkSchema(db), { status: 503, message: 'Faltan las migraciones de Supabase.' });
  const handle = createHandler({
    getDb: async () => { await checkSchema(db); return db; }, env: {}, log: {},
  });
  const res = await handle(new Request('http://x/api/auth'));
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error, 'Faltan las migraciones de Supabase.');
});
