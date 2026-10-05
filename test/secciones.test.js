import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openPglite, applyMigrations, migrationFiles } from '../server/db-pglite.js';
import { checkSchema } from '../server/schema.js';
import { SECTIONS, ORDER_UNITS, slugify } from '../server/catalog.js';
import { createHandler } from '../server/handler.js';
import { importBackup } from '../server/import-backup.js';
import * as svc from '../server/services.js';

const NIGHT = new Date('2026-09-26T21:00:00Z');
const GROUPS = [
  ['Habituales', 'alcohol'], ['Premium', 'alcohol'], ['Nevera', 'nevera'],
  ['Chupitos', 'chupiteria'], ['Cervezas especiales', 'chupiteria'],
  ['Refrescos', 'refrescos'], ['Zumos', 'refrescos'], ['Otros', 'otros'],
];
// Tabla del contrato: nombre, slug, categoría, unidad, unidades por caja, grupo, punto.
const PRODUCTS = [
  ['Cutty Sark', 'cutty-sark', 'whisky', 'botella', null, 'Habituales', 'alm-alcohol'],
  ['Aperol', 'aperol', 'otros', 'botella', null, 'Habituales', 'alm-alcohol'],
  ['Larios 150 Aniversario', 'larios-150-aniversario', 'ginebra', 'botella', null, 'Premium', 'alm-alcohol'],
  ['Talisker 10', 'talisker-10', 'whisky', 'botella', null, 'Premium', 'alm-alcohol'],
  ['Johnnie Walker Black Label 12', 'johnnie-walker-black-label-12', 'whisky', 'botella', null, 'Premium', 'alm-alcohol'],
  ['Cîroc Summer Colada', 'ciroc-summer-colada', 'vodka', 'botella', null, 'Premium', 'alm-alcohol'],
  ['Estrella Galicia', 'estrella-galicia', 'cerveza', 'caja', 24, 'Nevera', 'neveras-cerveza'],
  ['Heineken', 'heineken', 'cerveza', 'botella', 24, 'Nevera', 'neveras-especial'],
  ['Red Bull', 'red-bull', 'refresco', 'caja', 24, 'Nevera', 'alm-cerveza'],
  ['Red Bull Sugarfree', 'red-bull-sugarfree', 'refresco', 'caja', 24, 'Nevera', 'alm-cerveza'],
  ['Agua Cabreiroá 33 cl', 'agua-cabreiroa-33-cl', 'refresco', 'caja', 35, 'Nevera', 'alm-cerveza'],
  ['Jägermeister', 'jagermeister', 'licor', 'botella', null, 'Chupitos', 'chupiteria'],
  ['Fireball', 'fireball', 'licor', 'botella', null, 'Chupitos', 'chupiteria'],
  ['Buen Amigo Oro', 'buen-amigo-oro', 'licor', 'botella', null, 'Chupitos', 'chupiteria'],
  ['DIEX Crema de Fresas con Tequila', 'diex-crema-de-fresas-con-tequila', 'licor', 'botella', null, 'Chupitos', 'chupiteria'],
  ['Desperados', 'desperados', 'cerveza', 'botella', 24, 'Cervezas especiales', 'neveras-especial'],
  ['1906 Reserva Especial', '1906-reserva-especial', 'cerveza', 'botella', 24, 'Cervezas especiales', 'neveras-especial'],
  ['B.Lemon', 'b-lemon', 'cerveza', 'botella', 24, 'Cervezas especiales', 'chupiteria'],
  ['Estrella Galicia 0,0', 'estrella-galicia-0-0', 'cerveza', 'botella', 24, 'Cervezas especiales', 'chupiteria'],
  ['Estrella Galicia sin gluten', 'estrella-galicia-sin-gluten', 'cerveza', 'botella', 24, 'Cervezas especiales', 'neveras-especial'],
  ['Pepsi', 'pepsi', 'refresco', 'caja', 24, 'Refrescos', 'alm-cerveza'],
  ['Pepsi Zero', 'pepsi-zero', 'refresco', 'caja', 24, 'Refrescos', 'alm-cerveza'],
  ['7Up', '7up', 'refresco', 'caja', 24, 'Refrescos', 'alm-cerveza'],
  ['Schweppes Limón', 'schweppes-limon', 'refresco', 'caja', 24, 'Refrescos', 'alm-cerveza'],
  ['Schweppes Naranja', 'schweppes-naranja', 'refresco', 'caja', 24, 'Refrescos', 'alm-cerveza'],
  ['Schweppes Tónica', 'schweppes-tonica', 'refresco', 'caja', 24, 'Refrescos', 'alm-cerveza'],
  ['Zumo de naranja', 'zumo-de-naranja', 'refresco', 'caja', 24, 'Zumos', 'alm-cerveza'],
  ['Zumo de melocotón', 'zumo-de-melocoton', 'refresco', 'caja', 24, 'Zumos', 'alm-cerveza'],
  ['Zumo de piña', 'zumo-de-pina', 'refresco', 'caja', 24, 'Zumos', 'alm-cerveza'],
  ['Hielo', 'hielo', 'otros', 'bolsa', null, 'Otros', null],
  ['Stella Artois', 'stella-artois', 'cerveza', 'botella', 24, 'Otros', 'chupiteria'],
  ['Tyris Original', 'tyris-original', 'cerveza', 'botella', 24, 'Otros', 'chupiteria'],
  // 0010: lo que no está en la nevera de Chupitería pasa al final de «Otros».
  ['Karlova Blue', 'karlova-blue', 'licor', 'botella', null, 'Otros', 'chupiteria'],
  ['Karlova Red', 'karlova-red', 'licor', 'botella', null, 'Otros', 'chupiteria'],
  ['Cassaya', 'cassaya', 'licor', 'botella', null, 'Otros', 'chupiteria'],
  ['Vino blanco', 'vino-blanco', 'vino', 'botella', null, 'Otros', 'nevera-vino'],
  // 0011: Schweppes Fresa, Schweppes Tónica Zero y Perrier pasan al final de «Otros».
  ['Schweppes Fresa', 'schweppes-fresa', 'refresco', 'caja', 24, 'Otros', 'alm-cerveza'],
  ['Schweppes Tónica Zero', 'schweppes-tonica-zero', 'refresco', 'caja', 24, 'Otros', 'alm-cerveza'],
  ['Perrier', 'perrier', 'refresco', 'caja', 24, 'Otros', 'alm-cerveza'],
];

async function setup(t, { before0009 = false } = {}) {
  const db = await openPglite(undefined, { migrate: !before0009 });
  t.after(() => db.end());
  if (before0009) for (const f of migrationFiles().filter((f) => !f.endsWith('0009_pedir_secciones.sql'))) {
    await db.exec(readFileSync(f, 'utf8'));
  }
  return db;
}
const groupSlugs = async (db, name) => (await db.all(`SELECT p.slug FROM products p
  JOIN product_groups g ON p.group_id = g.id WHERE g.name = ? ORDER BY p.group_order, p.id`, name)).map((p) => p.slug);
const groupBy = async (db, name) => (await svc.listGroups(db)).find((g) => g.name === name);
const productBy = (db, slug) => db.get('SELECT * FROM products WHERE slug = ?', slug);
const bad = (message) => ({ status: 400, message });

test('0009: ocho grupos por sección y los 39 productos del contrato, en su orden', async (t) => {
  const db = await setup(t);
  assert.deepEqual((await svc.listGroups(db)).map((g) => [g.name, g.section]), GROUPS);
  assert.equal((await svc.listProducts(db, { all: true })).length, 90);
  assert.equal((await svc.listProducts(db)).length, 88);
  for (const [name, slug, category, order_unit, per_case, group, map_key] of PRODUCTS) {
    const p = await db.get(`SELECT p.*, g.name AS group_name, s.map_key FROM products p
      LEFT JOIN product_groups g ON p.group_id = g.id LEFT JOIN stores s ON p.main_store_id = s.id WHERE p.slug = ?`, slug);
    assert.ok(p, slug);
    assert.deepEqual([p.name, p.slug, p.category, p.order_unit, p.per_case, p.group_name, p.map_key],
      [name, slug, category, order_unit, per_case, group, map_key]);
    assert.deepEqual([p.status, p.note, p.active, p.out_of_stock, p.photo, p.capacity_ml],
      ['confirmado', null, 1, 0, null, null]);
    if (slug === 'hielo') assert.equal(p.main_store_id, null);
  }
  for (const [name] of GROUPS) {
    const expected = PRODUCTS.filter((p) => p[5] === name).map((p) => p[1]);
    const got = await groupSlugs(db, name);
    assert.deepEqual(name === 'Habituales' || name === 'Premium' ? got.slice(-expected.length) : got, expected);
  }
  assert.equal(await svc.catalogRev(db), 6);
});

test('slugify: los 39 nombres nuevos producen los slugs del contrato', () => {
  assert.equal(PRODUCTS.length, 39);
  for (const [name, slug] of PRODUCTS) assert.equal(slugify(name), slug);
});

test('0009 se aplica una vez: conserva renombres, secciones, unidades y selección', async (t) => {
  const db = await setup(t);
  await svc.renameGroup(db, (await groupBy(db, 'Premium')).id, { name: 'Top' });
  await svc.updateGroup(db, (await groupBy(db, 'Zumos')).id, { section: 'otros' });
  await svc.updateProduct(db, (await productBy(db, 'aperol')).id, { group_id: null });
  await svc.updateProduct(db, (await productBy(db, 'estrella-galicia')).id, { order_unit: 'botella' });
  const snapshot = await svc.exportData(db);
  const rev = await svc.catalogRev(db);
  // Repetir 0009 por sí sola conserva incluso el punto nulo de Hielo.
  const sql = readFileSync(migrationFiles().find((f) => f.endsWith('0009_pedir_secciones.sql')), 'utf8');
  await db.exec(sql);
  await db.exec(sql);
  assert.deepEqual((await svc.exportData(db)).tables, snapshot.tables);
  await applyMigrations(db);
  await applyMigrations(db);
  // 0005 rellena puntos nulos al repetirse; comprobamos aquí los datos de 0009.
  const selection = (data) => ({ groups: data.tables.product_groups,
    products: data.tables.products.map(({ id, name, slug, group_id, group_order, order_unit, per_case }) =>
      ({ id, name, slug, group_id, group_order, order_unit, per_case })) });
  assert.deepEqual(selection(await svc.exportData(db)), selection(snapshot));
  assert.equal(await svc.catalogRev(db), rev);
  assert.equal((await db.get("SELECT value FROM settings WHERE key = 'pedir_secciones'")).value, '1');
});

test('0009 respeta un slug existente y su selección, unidad y estado', async (t) => {
  const db = await setup(t, { before0009: true });
  // Antes de 0009 aún no existen las columnas que usa el servidor nuevo.
  const { id: groupId } = await db.get("SELECT id FROM product_groups WHERE name = 'Resto'");
  const existing = await db.get(`INSERT INTO products
    (name, slug, category, status, per_case, group_id, group_order, created_at, updated_at, main_store_id)
    VALUES ('Aperol', 'aperol', 'otros', 'pendiente', 6, ?, 31, ?, ?, 1) RETURNING *`,
    groupId, NIGHT.toISOString(), NIGHT.toISOString());
  await db.exec(readFileSync(migrationFiles().find((f) => f.endsWith('0009_pedir_secciones.sql')), 'utf8'));
  const products = (await svc.listProducts(db, { all: true })).filter((p) => p.slug === 'aperol');
  assert.equal(products.length, 1);
  assert.deepEqual(products[0], { ...existing, order_unit: 'botella' });
  assert.equal((await groupBy(db, 'Premium')).id, existing.group_id);
});

test('grupos: sección por defecto, validación, cambio auditado y alias de renombrar', async (t) => {
  const db = await setup(t);
  const first = await svc.createGroup(db, { name: 'Nuevos' });
  assert.equal(first.section, 'alcohol');
  assert.equal((await svc.createGroup(db, { name: 'Fríos', section: 'nevera' })).section, 'nevera');
  await assert.rejects(svc.createGroup(db, { name: 'Incorrecto', section: 'x' }), bad('Sección no válida.'));
  const rev = await svc.catalogRev(db);
  for (const section of ['x', null, '']) await assert.rejects(svc.updateGroup(db, first.id, { section }), bad('Sección no válida.'));
  await assert.rejects(svc.updateGroup(db, first.id, {}), { status: 400 });
  assert.equal(await svc.catalogRev(db), rev);
  const moved = await svc.updateGroup(db, first.id, { section: 'otros' }, { by: 'Ana', now: NIGHT });
  assert.deepEqual(moved, { ...first, section: 'otros' });
  assert.equal(await svc.catalogRev(db), rev + 1);
  const log = (await svc.listAudit(db, { entity: 'seleccion' })).find((a) => a.action === 'cambiar sección');
  assert.deepEqual(log.before, { name: 'Nuevos', section: 'alcohol' });
  assert.deepEqual(log.after, { name: 'Nuevos', section: 'otros' });
  assert.equal(log.actor, 'Ana');
  await svc.updateGroup(db, first.id, { section: 'otros' });
  assert.equal(await svc.catalogRev(db), rev + 1, 'sin cambios no sube la revisión');
  assert.equal((await svc.renameGroup(db, first.id, { name: 'Novedades' })).section, 'otros');
  await svc.updateGroup(db, first.id, { name: 'Temporada', section: 'refrescos' });
  assert.ok((await svc.orderGroups(db, { ids: (await svc.listGroups(db)).map((g) => g.id) })).every((g) => g.section));
});

test('productos: unidades válidas y caja con tamaño obligatorio, también al editar', async (t) => {
  const db = await setup(t);
  const bottle = await svc.createProduct(db, { name: 'Botella nueva' });
  assert.equal(bottle.order_unit, 'botella');
  for (const order_unit of ['unidad', '', null]) {
    await assert.rejects(svc.createProduct(db, { name: 'Unidad incorrecta', order_unit }), bad('Unidad no válida.'));
    await assert.rejects(svc.updateProduct(db, bottle.id, { order_unit }), bad('Unidad no válida.'));
  }
  const sizeError = bad('Indica cuántas unidades trae la caja.');
  await assert.rejects(svc.createProduct(db, { name: 'Caja vacía', order_unit: 'caja' }), sizeError);
  await assert.rejects(svc.updateProduct(db, bottle.id, { order_unit: 'caja' }), sizeError);
  const box = await svc.createProduct(db, { name: 'Caja nueva', order_unit: 'caja', per_case: 24 });
  for (const per_case of [null, '']) await assert.rejects(svc.updateProduct(db, box.id, { per_case }), sizeError);
  assert.equal((await productBy(db, box.slug)).per_case, 24);
  const updated = await svc.updateProduct(db, bottle.id, { order_unit: 'caja', per_case: 35 });
  assert.equal(updated.per_case, 35);
  assert.equal((await svc.updateProduct(db, box.id, { order_unit: 'bolsa', per_case: null })).order_unit, 'bolsa');
});

test('pedidos y live: 48 unidades son 48 en la base, con metadatos de caja en líneas y recientes', async (t) => {
  const db = await setup(t);
  const p = await productBy(db, 'estrella-galicia');
  await svc.createRequest(db, { bar_id: 1, items: [{ product_id: p.id, qty: 48 }] }, { now: NIGHT });
  assert.equal((await db.get('SELECT qty_requested FROM request_lines')).qty_requested, 48);
  // Live conserva los metadatos incluso si la botella deja de estar visible.
  await svc.updateProduct(db, p.id, { active: false, group_id: null });
  const live = await svc.liveState(db, { now: NIGHT });
  assert.deepEqual([live.lines[0].qty_requested, live.lines[0].qty_pending, live.lines[0].order_unit, live.lines[0].per_case],
    [48, 48, 'caja', 24]);
  await svc.deliver(db, live.lines[0].id, { qty: 24 }, { now: NIGHT });
  const after = await svc.liveState(db, { now: NIGHT });
  assert.deepEqual([after.lines[0].qty_pending, after.recent[0].qty, after.recent[0].order_unit, after.recent[0].per_case],
    [24, 24, 'caja', 24]);
});

test('API: bootstrap publica el contrato y el cambio de sección exige PIN de encargado', async (t) => {
  const db = await setup(t);
  const handle = createHandler({ getDb: async () => db, env: { STAFF_CODE: 'barra', MANAGER_PIN: '4321' }, log: {} });
  const call = (path, method = 'GET', body, manager = true) => handle(new Request(`http://test${path}`, {
    method, headers: { 'X-Access-Code': 'barra', 'Content-Type': 'application/json', ...(manager ? { 'X-Manager-Pin': '4321' } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
  const boot = await (await call('/api/bootstrap')).json();
  assert.deepEqual(boot.sections, SECTIONS);
  assert.deepEqual(boot.sections.map((s) => s.id), ['alcohol', 'nevera', 'chupiteria', 'refrescos', 'otros']);
  assert.deepEqual(boot.order_units, ORDER_UNITS);
  assert.deepEqual(boot.order_units.map((u) => u.id), ['botella', 'caja', 'bolsa']);
  assert.ok(boot.categories.some((c) => c.id === 'licor' && c.name === 'Licores'));
  assert.ok(boot.groups.every((g) => g.section));
  assert.ok(boot.products.every((p) => p.order_unit));
  const id = boot.groups[0].id;
  assert.equal((await call(`/api/groups/${id}`, 'PUT', { section: 'nevera' }, false)).status, 401);
  const result = await call(`/api/groups/${id}`, 'PUT', { section: 'nevera', by: 'Ana' });
  assert.equal(result.status, 200);
  assert.equal((await result.json()).section, 'nevera');
  const invalid = await call(`/api/groups/${id}`, 'PUT', { section: 'x' });
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).error, 'Sección no válida.');
  const box = await call('/api/products', 'POST', { name: 'Caja API', order_unit: 'caja', per_case: 6 });
  assert.equal(box.status, 200);
  const created = await box.json();
  assert.equal(created.order_unit, 'caja');
  const empty = await call(`/api/products/${created.id}`, 'PUT', { per_case: null });
  assert.equal(empty.status, 400);
  assert.equal((await empty.json()).error, 'Indica cuántas unidades trae la caja.');
});

test('backup: conserva secciones y unidades, y las copias sin columnas usan sus valores por defecto', async (t) => {
  const db = await setup(t);
  await svc.updateGroup(db, (await groupBy(db, 'Zumos')).id, { section: 'otros' });
  const data = await svc.exportData(db);
  const dest = await setup(t);
  await importBackup(dest, data);
  assert.deepEqual(await svc.listGroups(dest), await svc.listGroups(db));
  assert.deepEqual(await svc.listProducts(dest, { all: true }), await svc.listProducts(db, { all: true }));
  const old = structuredClone(data);
  old.tables.product_groups = old.tables.product_groups.map(({ section, ...g }) => g);
  old.tables.products = old.tables.products.map(({ order_unit, ...p }) => p);
  await importBackup(dest, old);
  assert.ok((await svc.listGroups(dest)).every((g) => g.section === 'alcohol'));
  assert.ok((await svc.listProducts(dest, { all: true })).every((p) => p.order_unit === 'botella'));
  delete old.tables.product_groups;
  const legacy = await importBackup(dest, old);
  assert.equal(legacy.legacy, true);
  assert.deepEqual((await svc.listGroups(dest)).map((g) => [g.name, g.section]), GROUPS.slice(0, 2));
  await checkSchema(dest);
});

test('esquema: falta 0009 o cualquiera de sus dos columnas produce 503', async (t) => {
  const db = await setup(t, { before0009: true });
  const missing = { status: 503, message: 'Faltan las migraciones de Supabase.' };
  await assert.rejects(checkSchema(db), missing);
  await db.run("ALTER TABLE product_groups ADD COLUMN section text NOT NULL DEFAULT 'alcohol'");
  await assert.rejects(checkSchema(db), missing);
  await db.run("ALTER TABLE products ADD COLUMN order_unit text NOT NULL DEFAULT 'botella'");
  await checkSchema(db);
  await db.run('ALTER TABLE product_groups DROP COLUMN section');
  await assert.rejects(checkSchema(db), missing);
});
