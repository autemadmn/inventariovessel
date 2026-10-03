// Lógica de negocio sobre Postgres (Supabase en producción, PGlite en local y
// en los tests) a través del adaptador `db` (all / get / run / batch / tx).
//
// Las operaciones que deben ser atómicas (entregar, «Hecho», anular, deshacer,
// «Voy yo», pedir) van en una transacción que primero bloquea las líneas con
// SELECT … FOR UPDATE (en orden de id) y después hace la escritura condicional
// en otra sentencia. En READ COMMITTED esa segunda sentencia ve lo que confirmó
// quien tenía antes el bloqueo: si otra persona ya entregó esa botella, no
// cambia nada y se avisa. Así nadie puede entregar dos veces lo mismo.
//
// Orden global de bloqueos (nunca al revés, para evitar interbloqueos):
// sessions → request_lines (id asc.) → deliveries → product_groups (id asc.)
// → products (id asc.) → bars (id asc.) → stores (id asc.) → staff
// → settings (catalog_rev, siempre al final).
//
// Dentro de db.tx(async (t) => …) se usa SOLO `t`: usar `db` bloquearía.

import { CATEGORIES, defaultMainKey, slugify } from './catalog.js';
import { DEFAULT_SETTINGS } from './schema.js';
import { HttpError } from './errors.js';
import {
  addDays, businessDate, datesBetween, daysBetween, isYmd, periodRange, previousPeriodDate, shortDate, weekday, weekStart,
} from './dates.js';
import { computeForecast, computePurchase } from '../public/js/shared/forecast.js';
import { liveStock, MAIN_STORE_SQL, mainStoreId } from './almacen.js';
import { openTripSummary } from './viaje.js';
import { quantity as posInt } from './stock-operation.js';

export { HttpError };

const bad = (msg) => new HttpError(400, msg);
const notFound = (what) => new HttpError(404, `${what} no encontrado`);

const nowIso = (now) => (now ?? new Date()).toISOString();
const clean = (s, max = 80) => (typeof s === 'string' ? s.trim().slice(0, max) : '') || null;
const sum = (list, f) => list.reduce((a, x) => a + f(x), 0);
const marks = (list) => list.map(() => '?').join(', ');

export function audit(t, { actor, entity, entityId, action, before, after, reason, now }) {
  return t.run(`INSERT INTO audit (at, actor, entity, entity_id, action, before, after, reason)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  nowIso(now), actor ?? null, entity, entityId ?? null, action,
  before === undefined ? null : JSON.stringify(before),
  after === undefined ? null : JSON.stringify(after),
  reason ?? null);
}

/** Sube la revisión del catálogo. Siempre la última sentencia de su transacción. */
async function bumpCatalog(t) {
  const r = await t.get(`INSERT INTO settings (key, value) VALUES ('catalog_rev', '1')
    ON CONFLICT (key) DO UPDATE SET value = ((settings.value)::int + 1)::text RETURNING value`);
  return Number(r.value);
}

export async function catalogRev(db) {
  const r = await db.get("SELECT value FROM settings WHERE key = 'catalog_rev'");
  return Number(r?.value) || 0;
}

// ---------------------------------------------------------------- ajustes

export async function getSettings(db) {
  const out = { trip_weeks: DEFAULT_SETTINGS.trip_weeks, ...DEFAULT_SETTINGS };
  for (const { key, value } of await db.all('SELECT key, value FROM settings')) out[key] = value;
  return { ...out, timezone: 'Europe/Madrid', cutoff_hour: '12' };
}

function toPublic(s) {
  return {
    timezone: s.timezone,
    cutoff_hour: Number(s.cutoff_hour),
    safety_pct: Number(s.safety_pct),
    low_data_nights: Number(s.low_data_nights),
    min_nights_per_weekday: Number(s.min_nights_per_weekday),
    undo_minutes: Number(s.undo_minutes),
    trip_weeks: Number(s.trip_weeks),
  };
}

export async function publicSettings(db) {
  return toPublic(await getSettings(db));
}

const EDITABLE_SETTINGS = {
  safety_pct: (v) => String(posInt(v, 'Margen de seguridad', { allowZero: true })),
  low_data_nights: (v) => String(posInt(v, 'Mínimo de noches')),
  min_nights_per_weekday: (v) => String(posInt(v, 'Noches por día de la semana')),
  undo_minutes: (v) => String(posInt(v, 'Minutos para deshacer', { allowZero: true })),
  trip_weeks: (v) => {
    const n = posInt(v, 'Semanas entre viajes');
    if (n > 12) throw bad('Las semanas entre viajes deben ser de 1 a 12.');
    return String(n);
  },
  staff_code: (v) => String(v ?? '').trim(),
  manager_pin: (v) => String(v ?? '').trim(),
};

export async function updateSettings(db, patch, { by, now } = {}) {
  for (const [key, value] of [['timezone', 'Europe/Madrid'], ['cutoff_hour', '12']]) {
    if (patch[key] !== undefined && String(patch[key]) !== value) throw bad('La noche de trabajo usa Europe/Madrid y el corte de las 12:00.');
  }
  const before = await getSettings(db);
  const stmts = [];
  const changed = {};
  for (const [k, fn] of Object.entries(EDITABLE_SETTINGS)) {
    if (patch[k] === undefined) continue;
    const v = fn(patch[k]);
    if (v !== before[k]) {
      stmts.push(['INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value', k, v]);
      changed[k] = v;
    }
  }
  if (patch.bars) {
    for (const bar of patch.bars) {
      const name = clean(bar.name, 40);
      if (!name) throw bad('El nombre de la barra no puede estar vacío.');
      stmts.push(['UPDATE bars SET name = ? WHERE id = ?', name, Number(bar.id)]);
      stmts.push(['UPDATE stores SET name = ? WHERE bar_id = ?', name.slice(0, 40), Number(bar.id)]);
    }
    changed.bars = patch.bars;
  }
  if (patch.stores !== undefined) {
    if (!Array.isArray(patch.stores) || patch.stores.length > 20) throw bad('Almacenes no válidos.');
    const ids = new Set();
    for (const store of patch.stores) {
      const id = posInt(store?.id, 'Almacén');
      const name = typeof store?.name === 'string' ? store.name.trim() : '';
      if (!name || name.length > 40) throw bad('El nombre del almacén debe tener entre 1 y 40 caracteres.');
      if (ids.has(id) || !await db.get('SELECT id FROM stores WHERE id = ?', id)) throw bad('Almacén no válido.');
      ids.add(id);
      stmts.push(['UPDATE stores SET name = ? WHERE id = ?', name, id]);
      stmts.push(['UPDATE bars SET name = ? WHERE id = (SELECT bar_id FROM stores WHERE id = ?)', name, id]);
    }
    changed.stores = patch.stores;
  }
  if (stmts.length) {
    const hide = (o) => ({ ...o, staff_code: o.staff_code ? '••••' : '', manager_pin: o.manager_pin ? '••••' : '' });
    await db.tx(async (t) => {
      if (patch.bars || patch.stores) {
        await t.all('SELECT id FROM bars ORDER BY id FOR UPDATE');
        await t.all('SELECT id FROM stores ORDER BY id FOR UPDATE');
      }
      const beforeNames = patch.bars || patch.stores ? {
        bars: await t.all('SELECT id, name FROM bars ORDER BY id'),
        stores: await t.all('SELECT id, name FROM stores ORDER BY id'),
      } : {};
      for (const [sql, ...args] of stmts) await t.run(sql, ...args);
      const afterNames = patch.bars || patch.stores ? {
        bars: await t.all('SELECT id, name FROM bars ORDER BY id'),
        stores: await t.all('SELECT id, name FROM stores ORDER BY id'),
      } : {};
      await audit(t, { actor: by, entity: 'ajustes', action: 'modificar',
        before: { ...hide(before), ...beforeNames }, after: { ...hide(changed), ...afterNames }, now });
      if (patch.bars || patch.stores) await bumpCatalog(t);
    });
  }
  return publicSettings(db);
}

export async function currentDate(db, now = new Date()) {
  const s = await getSettings(db);
  return businessDate(now, s.timezone, Number(s.cutoff_hour));
}

// ---------------------------------------------------------------- catálogo

export function listBars(db) {
  return db.all('SELECT id, name FROM bars ORDER BY id');
}

async function barExists(db, id) {
  if (!await db.get('SELECT 1 AS ok FROM bars WHERE id = ?', id)) throw bad('Barra no válida.');
}

export function listProducts(db, { all = false } = {}) {
  const where = all ? '' : "WHERE active = 1 AND status IN ('confirmado', 'pendiente')";
  return db.all(`SELECT * FROM products ${where} ORDER BY sort, name`);
}

async function getProduct(db, id) {
  const p = await db.get('SELECT * FROM products WHERE id = ?', id);
  if (!p) throw notFound('Producto');
  return p;
}

const STATUSES = ['confirmado', 'pendiente', 'sin_identificar', 'descartado'];
const UNSELECTABLE = ['sin_identificar', 'descartado'];

function productFields(input, existing = {}) {
  const out = {};
  if (input.name !== undefined) {
    out.name = clean(input.name, 80);
    if (!out.name) throw bad('El nombre es obligatorio.');
  }
  if (input.category !== undefined) {
    if (!CATEGORIES.some((c) => c.id === input.category)) throw bad('Categoría no válida.');
    out.category = input.category;
  }
  if (input.status !== undefined) {
    if (!STATUSES.includes(input.status)) throw bad('Estado no válido.');
    out.status = input.status;
  }
  if (input.note !== undefined) out.note = clean(input.note, 400);
  for (const k of ['capacity_ml', 'per_case']) {
    if (input[k] === undefined) continue;
    out[k] = input[k] === null || input[k] === '' ? null : posInt(input[k], k === 'capacity_ml' ? 'Capacidad' : 'Botellas por caja');
  }
  if (input.active !== undefined) out.active = input.active ? 1 : 0;
  if (input.sort !== undefined) out.sort = Number(input.sort) || 0;
  if (input.main_store_id !== undefined) {
    const id = Number(input.main_store_id);
    if (!Number.isInteger(id) || id < 1) throw bad('Punto principal no válido.');
    out.main_store_id = id;
  }
  const status = out.status ?? existing.status;
  if (out.active === 1 && UNSELECTABLE.includes(status)) {
    throw bad('Identifica el producto antes de activarlo.');
  }
  return out;
}

/** `group_id` recibido: undefined (no cambia), null (fuera de la selección) o un id. */
function groupInput(v) {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw bad('Grupo no válido.');
  return n;
}

async function groupExists(t, id) {
  if (!await t.get('SELECT id FROM product_groups WHERE id = ?', id)) throw bad('Grupo no válido.');
}

async function defaultMainId(t, category) {
  const s = await t.get('SELECT id FROM stores WHERE map_key = ?', defaultMainKey(category));
  if (!s) throw bad('Punto principal no válido.');
  return s.id;
}

async function validateMainStore(t, id) {
  if (!await t.get(`SELECT id FROM stores WHERE id = ? AND in_vessel = 1
    AND point_type IN ('almacen', 'nevera')`, id)) throw bad('Punto principal no válido.');
}

async function nextGroupOrder(t, groupId) {
  const { m } = await t.get('SELECT COALESCE(MAX(group_order), 0)::int AS m FROM products WHERE group_id = ?', groupId);
  return m + 1;
}

/** Slug único a partir del nombre: `slug`, `slug-2`, `slug-3`… */
async function uniqueSlug(t, name, exceptId = null) {
  const base = slugify(name);
  const taken = new Set((await t.all('SELECT slug FROM products WHERE (slug = ? OR slug LIKE ?) AND id IS DISTINCT FROM ?',
    base, `${base}-%`, exceptId)).map((r) => r.slug));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
}

export async function createProduct(db, input, { by, now } = {}) {
  const f = productFields({ status: 'pendiente', category: 'otros', active: true, ...input });
  if (!f.name) throw bad('El nombre es obligatorio.');
  const groupId = groupInput(input.group_id) ?? null;
  const t0 = nowIso(now);
  return db.tx(async (t) => {
    f.main_store_id ??= await defaultMainId(t, f.category);
    await validateMainStore(t, f.main_store_id);
    if (groupId !== null) {
      await groupExists(t, groupId);
      if (UNSELECTABLE.includes(f.status)) throw bad(`Identifica «${f.name}» antes de añadirlo a la selección.`);
    }
    const { m } = await t.get('SELECT COALESCE(MAX(sort), 0)::int AS m FROM products');
    const slug = await uniqueSlug(t, f.name);
    const order = groupId === null ? null : await nextGroupOrder(t, groupId);
    const { lastId } = await t.run(`INSERT INTO products
      (name, slug, category, status, note, capacity_ml, per_case, active, sort, group_id, group_order, created_at, updated_at, main_store_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    f.name, slug, f.category, f.status, f.note ?? null, f.capacity_ml ?? null, f.per_case ?? null,
    f.active ?? 1, f.sort ?? m + 10, groupId, order, t0, t0, f.main_store_id);
    const p = await getProduct(t, lastId);
    await audit(t, { actor: by, entity: 'producto', entityId: p.id, action: 'crear', after: p, now });
    await bumpCatalog(t);
    return p;
  });
}

/** Aplica cambios a un producto dentro de la transacción `t`. */
async function applyProductUpdate(t, id, input, { by, now, reason, reslug = false }) {
  await t.get('SELECT id FROM products WHERE id = ? FOR UPDATE', id);
  const before = await getProduct(t, id);
  const f = productFields(input, before);
  if (f.main_store_id !== undefined) await validateMainStore(t, f.main_store_id);
  else if (f.category !== undefined && f.category !== before.category) {
    const previousDefault = await defaultMainId(t, before.category);
    if ((before.main_store_id ?? previousDefault) === previousDefault) {
      f.main_store_id = await defaultMainId(t, f.category);
    }
  }
  const groupId = groupInput(input.group_id);
  if (groupId !== undefined && groupId !== before.group_id) {
    if (groupId === null) {
      Object.assign(f, { group_id: null, group_order: null });
    } else {
      await groupExists(t, groupId);
      Object.assign(f, { group_id: groupId, group_order: await nextGroupOrder(t, groupId) });
    }
  }
  if (f.group_id && UNSELECTABLE.includes(f.status ?? before.status)) {
    throw bad(`Identifica «${f.name ?? before.name}» antes de añadirlo a la selección.`);
  }
  if (reslug) f.slug = await uniqueSlug(t, f.name ?? before.name, id);
  const keys = Object.keys(f).filter((k) => f[k] !== before[k]);
  if (!keys.length) return before;
  await t.run(`UPDATE products SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`,
    ...keys.map((k) => f[k]), nowIso(now), id);
  await audit(t, {
    actor: by, entity: 'producto', entityId: id, action: 'modificar',
    before: Object.fromEntries(keys.map((k) => [k, before[k]])),
    after: Object.fromEntries(keys.map((k) => [k, f[k]])),
    reason, now,
  });
  await bumpCatalog(t);
  return getProduct(t, id);
}

export function updateProduct(db, id, input, { by, now, reason } = {}) {
  return db.tx((t) => applyProductUpdate(t, id, input, { by, now, reason }));
}

/** Guarda una foto propia del producto (en la base de datos) y retira la anterior si era propia. */
export async function setProductPhoto(db, id, { mime, data }, { by, now } = {}) {
  const t0 = nowIso(now);
  return db.tx(async (t) => {
    await t.get('SELECT id FROM products WHERE id = ? FOR UPDATE', id);
    const before = await getProduct(t, id);
    const { lastId } = await t.run('INSERT INTO photos (product_id, mime, data, created_at) VALUES (?, ?, ?, ?) RETURNING id', id, mime, data, t0);
    const path = `/photos/${lastId}`;
    await t.run('UPDATE products SET photo = ?, updated_at = ? WHERE id = ?', path, t0, id);
    await audit(t, { actor: by, entity: 'producto', entityId: id, action: 'foto', before: { photo: before.photo }, after: { photo: path }, now });
    const old = /^\/photos\/(\d+)$/.exec(before.photo || '');
    if (old) await t.run('DELETE FROM photos WHERE id = ?', Number(old[1]));
    await bumpCatalog(t);
    return getProduct(t, id);
  });
}

export async function removeProductPhoto(db, id, { by, now } = {}) {
  return db.tx(async (t) => {
    await t.get('SELECT id FROM products WHERE id = ? FOR UPDATE', id);
    const before = await getProduct(t, id);
    await t.run('UPDATE products SET photo = NULL, updated_at = ? WHERE id = ?', nowIso(now), id);
    await audit(t, { actor: by, entity: 'producto', entityId: id, action: 'quitar foto', before: { photo: before.photo }, after: { photo: null }, now });
    const old = /^\/photos\/(\d+)$/.exec(before.photo || '');
    if (old) await t.run('DELETE FROM photos WHERE id = ?', Number(old[1]));
    await bumpCatalog(t);
    return getProduct(t, id);
  });
}

export function getPhoto(db, photoId) {
  return db.get('SELECT mime, data FROM photos WHERE id = ?', photoId);
}

/**
 * Resolver una botella sin identificar: o bien es un producto nuevo (se
 * activa con el nombre confirmado) o bien es un producto que ya existe (se
 * descarta indicando cuál, sin crear duplicados).
 */
export async function resolveUnidentified(db, id, { action, target_id, name, category, group_id }, { by, now } = {}) {
  return db.tx(async (t) => {
    const p = await getProduct(t, id);
    if (p.status !== 'sin_identificar') throw bad('Este producto ya está identificado.');
    if (action === 'duplicate') {
      const target = await getProduct(t, Number(target_id));
      if (target.id === p.id) throw bad('Elige otro producto.');
      return applyProductUpdate(t, id, {
        status: 'descartado', active: false, group_id: null,
        note: `${p.note ? `${p.note} ` : ''}Resuelto: es el mismo producto que «${target.name}».`,
      }, { by, now, reason: `Identificado como ${target.name}` });
    }
    if (action === 'new') {
      return applyProductUpdate(t, id, {
        name: name ?? p.name, category: category ?? p.category, status: 'pendiente', active: true, group_id,
      }, { by, now, reason: 'Identificado como producto nuevo', reslug: true });
    }
    throw bad('Acción no válida.');
  });
}

export async function setOutOfStock(db, id, out, { by, now } = {}) {
  const flag = out ? 1 : 0;
  const t0 = nowIso(now);
  return db.tx(async (t) => {
    await getProduct(t, id);
    const { changes } = await t.run('UPDATE products SET out_of_stock = ?, updated_at = ? WHERE id = ? AND out_of_stock <> ?', flag, t0, id, flag);
    if (changes) {
      if (flag) await t.run('INSERT INTO stockouts (product_id, started_at, started_by) VALUES (?, ?, ?)', id, t0, by ?? null);
      else await t.run('UPDATE stockouts SET ended_at = ?, ended_by = ? WHERE product_id = ? AND ended_at IS NULL', t0, by ?? null, id);
      await audit(t, { actor: by, entity: 'producto', entityId: id, action: flag ? 'agotado en almacén' : 'disponible en almacén', now });
    }
    return getProduct(t, id);
  });
}

// ---------------------------------------------------------------- selección (grupos y orden)

/** Nombre de grupo o de persona: texto de 1 a 40 caracteres. */
function validName(v) {
  const name = typeof v === 'string' ? v.trim() : '';
  if (name.length < 1 || name.length > 40) throw bad('El nombre debe tener entre 1 y 40 caracteres.');
  return name;
}

const sameName = (a, b) => a.toLocaleLowerCase('es') === b.toLocaleLowerCase('es');

export function listGroups(db) {
  return db.all('SELECT id, name, sort FROM product_groups ORDER BY sort, id');
}

async function getGroup(t, id, { lock = false } = {}) {
  const g = await t.get(`SELECT id, name, sort FROM product_groups WHERE id = ?${lock ? ' FOR UPDATE' : ''}`, id);
  if (!g) throw notFound('Grupo');
  return g;
}

export async function createGroup(db, { name }, { by, now } = {}) {
  const n = validName(name);
  return db.tx(async (t) => {
    const all = await t.all('SELECT name, sort FROM product_groups');
    if (all.some((g) => sameName(g.name, n))) throw new HttpError(409, 'Ya existe un grupo con ese nombre.');
    const sort = Math.max(0, ...all.map((g) => g.sort)) + 10;
    const { lastId } = await t.run('INSERT INTO product_groups (name, sort, created_at) VALUES (?, ?, ?) RETURNING id', n, sort, nowIso(now));
    await audit(t, { actor: by, entity: 'seleccion', entityId: lastId, action: 'crear grupo', after: { name: n }, now });
    await bumpCatalog(t);
    return getGroup(t, lastId);
  });
}

export async function renameGroup(db, id, { name }, { by, now } = {}) {
  const n = validName(name);
  return db.tx(async (t) => {
    const before = await getGroup(t, id, { lock: true });
    const others = await t.all('SELECT name FROM product_groups WHERE id <> ?', id);
    if (others.some((g) => sameName(g.name, n))) throw new HttpError(409, 'Ya existe un grupo con ese nombre.');
    if (before.name === n) return before;
    await t.run('UPDATE product_groups SET name = ? WHERE id = ?', n, id);
    await audit(t, { actor: by, entity: 'seleccion', entityId: id, action: 'renombrar grupo', before: { name: before.name }, after: { name: n }, now });
    await bumpCatalog(t);
    return getGroup(t, id);
  });
}

/** Comprueba que `ids` son exactamente los de `current`, sin repetir. */
function sameIds(ids, current) {
  if (!Array.isArray(ids) || ids.length !== current.length) return false;
  const want = new Set(current.map(Number));
  const got = new Set(ids.map(Number));
  return got.size === ids.length && [...got].every((x) => want.has(x));
}

export async function orderGroups(db, { ids }, { by, now } = {}) {
  return db.tx(async (t) => {
    const groups = await t.all('SELECT id, name FROM product_groups ORDER BY id FOR UPDATE');
    if (!sameIds(ids, groups.map((g) => g.id))) throw bad('La lista no coincide: recarga e inténtalo de nuevo.');
    for (const [i, gid] of ids.entries()) await t.run('UPDATE product_groups SET sort = ? WHERE id = ?', (i + 1) * 10, Number(gid));
    const names = Object.fromEntries(groups.map((g) => [g.id, g.name]));
    await audit(t, { actor: by, entity: 'seleccion', action: 'ordenar grupos', after: { orden: ids.map((x) => names[x]) }, now });
    await bumpCatalog(t);
    return t.all('SELECT id, name, sort FROM product_groups ORDER BY sort, id');
  });
}

/** Renumera las posiciones de un grupo a 1..n (group_order y luego id). */
function renumberGroup(t, groupId) {
  return t.run(`UPDATE products p SET group_order = r.rn
    FROM (SELECT id, ROW_NUMBER() OVER (ORDER BY group_order, id)::int AS rn FROM products WHERE group_id = ?) r
    WHERE p.id = r.id`, groupId);
}

/**
 * Borra un grupo. Sus botellas van al final de otro grupo (`move_to` = id) o
 * quedan fuera de la selección (`move_to` = 'none').
 */
export async function deleteGroup(db, id, { move_to: moveTo, by }, { now } = {}) {
  const dest = moveTo === undefined || moveTo === null || moveTo === '' ? undefined
    : moveTo === 'none' ? null : Number(moveTo);
  if (dest !== undefined && dest !== null && (!Number.isInteger(dest) || dest < 1)) throw bad('Grupo de destino no válido.');
  return db.tx(async (t) => {
    const ids = [id, ...(dest ? [dest] : [])].sort((a, b) => a - b);
    const locked = await t.all(`SELECT id, name FROM product_groups WHERE id IN (${marks(ids)}) ORDER BY id FOR UPDATE`, ...ids);
    const g = locked.find((x) => x.id === id);
    if (!g) throw notFound('Grupo');
    const products = await t.all('SELECT id FROM products WHERE group_id = ? ORDER BY group_order, id FOR UPDATE', id);
    if (products.length && dest === undefined) throw bad('Indica a dónde van las botellas del grupo.');
    let target = null;
    if (dest !== undefined && dest !== null) {
      target = locked.find((x) => x.id === dest);
      if (!Number.isInteger(dest) || !target || dest === id) throw bad('Grupo de destino no válido.');
    }
    if (products.length) {
      if (target) {
        const start = (await nextGroupOrder(t, target.id)) - 1;
        for (const [i, p] of products.entries()) {
          await t.run('UPDATE products SET group_id = ?, group_order = ? WHERE id = ?', target.id, start + i + 1, p.id);
        }
      } else {
        await t.run('UPDATE products SET group_id = NULL, group_order = NULL WHERE group_id = ?', id);
      }
    }
    await t.run('DELETE FROM product_groups WHERE id = ?', id);
    await audit(t, {
      actor: by, entity: 'seleccion', entityId: id, action: 'borrar grupo',
      before: { name: g.name, botellas: products.length },
      after: { destino: target ? target.name : 'fuera de la selección' }, now,
    });
    await bumpCatalog(t);
    return { ok: true, moved: products.length };
  });
}

/**
 * Coloca botellas en grupos y posiciones. El cliente envía la lista completa y
 * ordenada de cada grupo afectado (más las que salen de la selección, con
 * group_id null). Se valida todo antes de escribir y después se renumeran los
 * grupos afectados a 1..n.
 */
export async function orderProducts(db, { items, by }, { now } = {}) {
  if (!Array.isArray(items) || !items.length || items.length > 200) throw bad('No hay cambios que guardar.');
  const wanted = items.map((i) => ({
    id: Number(i?.id),
    group_id: groupInput(i?.group_id ?? null),
    group_order: i?.group_order,
  }));
  const ids = wanted.map((w) => w.id);
  if (ids.some((x) => !Number.isInteger(x)) || new Set(ids).size !== ids.length) throw bad('Hay un producto que no existe.');
  for (const w of wanted) {
    if (w.group_id === null) { w.group_order = null; continue; }
    const n = Number(w.group_order);
    if (!Number.isInteger(n) || n < 0 || n > 10000) throw bad('Posición no válida.');
    w.group_order = n;
  }
  const sorted = [...ids].sort((a, b) => a - b);
  return db.tx(async (t) => {
    const groupIds = [...new Set(wanted.map((w) => w.group_id).filter((g) => g !== null))].sort((a, b) => a - b);
    if (groupIds.length) {
      const found = await t.all(`SELECT id FROM product_groups WHERE id IN (${marks(groupIds)}) ORDER BY id FOR SHARE`, ...groupIds);
      if (found.length !== groupIds.length) throw bad('Grupo no válido.');
    }
    const rows = await t.all(`SELECT id, name, status, group_id FROM products WHERE id IN (${marks(sorted)}) ORDER BY id FOR UPDATE`, ...sorted);
    if (rows.length !== ids.length) throw bad('Hay un producto que no existe.');
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    for (const w of wanted) {
      if (w.group_id !== null && UNSELECTABLE.includes(byId[w.id].status)) {
        throw bad(`Identifica «${byId[w.id].name}» antes de añadirlo a la selección.`);
      }
    }
    const affected = new Set([...groupIds, ...rows.map((r) => r.group_id).filter((g) => g !== null)]);
    const t0 = nowIso(now);
    for (const w of [...wanted].sort((a, b) => a.id - b.id)) {
      await t.run('UPDATE products SET group_id = ?, group_order = ?, updated_at = ? WHERE id = ?', w.group_id, w.group_order, t0, w.id);
    }
    for (const g of [...affected].sort((a, b) => a - b)) await renumberGroup(t, g);
    const names = Object.fromEntries((await t.all('SELECT id, name FROM product_groups')).map((g) => [g.id, g.name]));
    await audit(t, {
      actor: by, entity: 'seleccion', action: 'ordenar botellas',
      after: { botellas: wanted.map((w) => ({ producto: byId[w.id].name, grupo: w.group_id === null ? null : names[w.group_id] })) },
      now,
    });
    const rev = await bumpCatalog(t);
    const aff = [...affected];
    const out = await t.all(`SELECT id, group_id, group_order FROM products
      WHERE ${aff.length ? `group_id IN (${marks(aff)}) OR ` : ''}id IN (${marks(sorted)})
      ORDER BY group_id NULLS LAST, group_order, id`, ...aff, ...sorted);
    return { ok: true, catalog_rev: rev, items: out };
  });
}

// ---------------------------------------------------------------- personal

export function listStaff(db, { all = false } = {}) {
  return all
    ? db.all('SELECT id, name, active, sort, created_at FROM staff ORDER BY active DESC, sort, id')
    : db.all('SELECT id, name, sort FROM staff WHERE active = 1 ORDER BY sort, id');
}

const STAFF_ROW = 'SELECT id, name, active, sort, created_at FROM staff WHERE id = ?';

async function staffEnd(t) {
  const { m } = await t.get('SELECT COALESCE(MAX(sort), 0)::int AS m FROM staff WHERE active = 1');
  return m + 10;
}

export async function createStaff(db, { name }, { by, now } = {}) {
  const n = validName(name);
  return db.tx(async (t) => {
    const all = await t.all('SELECT id, name, active FROM staff ORDER BY id FOR UPDATE');
    const same = all.find((s) => sameName(s.name, n));
    if (same?.active) throw new HttpError(409, 'Ya existe una persona con ese nombre.');
    const sort = await staffEnd(t);
    let id;
    if (same) {
      id = same.id;
      await t.run('UPDATE staff SET active = 1, sort = ?, name = ? WHERE id = ?', sort, n, id);
      await audit(t, { actor: by, entity: 'personal', entityId: id, action: 'reactivar', after: { name: n }, now });
    } else {
      ({ lastId: id } = await t.run('INSERT INTO staff (name, active, sort, created_at) VALUES (?, 1, ?, ?) RETURNING id', n, sort, nowIso(now)));
      await audit(t, { actor: by, entity: 'personal', entityId: id, action: 'crear', after: { name: n }, now });
    }
    await bumpCatalog(t);
    return t.get(STAFF_ROW, id);
  });
}

export async function updateStaff(db, id, { name, active }, { by, now } = {}) {
  const n = name === undefined ? undefined : validName(name);
  return db.tx(async (t) => {
    const before = await t.get(`${STAFF_ROW} FOR UPDATE`, id);
    if (!before) throw new HttpError(404, 'Persona no encontrada');
    const changes = {};
    if (n !== undefined && n !== before.name) {
      const others = await t.all('SELECT name FROM staff WHERE id <> ?', id);
      if (others.some((s) => sameName(s.name, n))) throw new HttpError(409, 'Ya existe una persona con ese nombre.');
      changes.name = n;
    }
    if (active !== undefined && (active ? 1 : 0) !== before.active) {
      changes.active = active ? 1 : 0;
      if (changes.active) changes.sort = await staffEnd(t);
    }
    const keys = Object.keys(changes);
    if (!keys.length) return before;
    await t.run(`UPDATE staff SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...keys.map((k) => changes[k]), id);
    const action = changes.active === undefined ? 'renombrar' : changes.active ? 'reactivar' : 'retirar';
    await audit(t, {
      actor: by, entity: 'personal', entityId: id, action,
      before: { name: before.name, active: before.active },
      after: { name: changes.name ?? before.name, active: changes.active ?? before.active }, now,
    });
    await bumpCatalog(t);
    return t.get(STAFF_ROW, id);
  });
}

export async function orderStaff(db, { ids }, { by, now } = {}) {
  await db.tx(async (t) => {
    const active = await t.all('SELECT id, name FROM staff WHERE active = 1 ORDER BY id FOR UPDATE');
    if (!sameIds(ids, active.map((s) => s.id))) throw bad('La lista no coincide: recarga e inténtalo de nuevo.');
    for (const [i, sid] of ids.entries()) await t.run('UPDATE staff SET sort = ? WHERE id = ?', (i + 1) * 10, Number(sid));
    const names = Object.fromEntries(active.map((s) => [s.id, s.name]));
    await audit(t, { actor: by, entity: 'personal', action: 'ordenar', after: { orden: ids.map((x) => names[x]) }, now });
    await bumpCatalog(t);
  });
  return listStaff(db, { all: true });
}

// ---------------------------------------------------------------- arranque del cliente

export async function bootstrap(db, { managerRequired }) {
  // La revisión se lee antes que el resto: cualquier cambio posterior provoca otra recarga.
  const rev = await catalogRev(db);
  const [bars, products, groups, staff, settings, date, stores] = await Promise.all([
    listBars(db), listProducts(db), listGroups(db), listStaff(db), publicSettings(db), currentDate(db),
    db.all('SELECT * FROM stores ORDER BY sort, id'),
  ]);
  return { bars, categories: CATEGORIES, products, settings, date, managerRequired, groups, staff, stores, catalog_rev: rev };
}

// ---------------------------------------------------------------- noches

export function findSession(db, date) {
  return db.get('SELECT * FROM sessions WHERE business_date = ?', date);
}

export async function ensureSession(db, date, now) {
  await db.run('INSERT INTO sessions (business_date, created_at) VALUES (?, ?) ON CONFLICT (business_date) DO NOTHING', date, nowIso(now));
  return findSession(db, date);
}

export async function updateSession(db, id, { same_level, notes }, { by, now } = {}) {
  return db.tx(async (t) => {
    const before = await t.get('SELECT * FROM sessions WHERE id = ? FOR UPDATE', id);
    if (!before) throw notFound('Noche');
    const sl = same_level === undefined ? before.same_level : same_level === null ? null : same_level ? 1 : 0;
    const nt = notes === undefined ? before.notes : clean(notes, 500);
    await t.run('UPDATE sessions SET same_level = ?, notes = ? WHERE id = ?', sl, nt, id);
    await audit(t, {
      actor: by, entity: 'noche', entityId: id, action: 'modificar',
      before: { same_level: before.same_level, notes: before.notes }, after: { same_level: sl, notes: nt }, now,
    });
    return t.get('SELECT * FROM sessions WHERE id = ?', id);
  });
}

export function listSessions(db, { from, to }) {
  return db.all(`
    SELECT s.*,
      COALESCE((SELECT SUM(qty) FROM deliveries d WHERE d.session_id = s.id), 0)::int AS delivered,
      COALESCE((SELECT SUM(GREATEST(0, l.qty_requested - l.qty_cancelled -
        COALESCE((SELECT SUM(qty) FROM deliveries d WHERE d.line_id = l.id), 0)))
        FROM request_lines l WHERE l.session_id = s.id), 0)::int AS unserved
    FROM sessions s
    WHERE s.business_date BETWEEN ? AND ?
    ORDER BY s.business_date DESC`, from, to);
}

// ---------------------------------------------------------------- solicitudes

const DELIVERED = 'COALESCE((SELECT SUM(qty) FROM deliveries d WHERE d.line_id = l.id), 0)::int';
const PENDING = `(l.qty_requested - l.qty_cancelled - ${DELIVERED})`;

const LINE_SELECT = `
  SELECT l.*, p.name AS product_name, p.slug, p.photo, p.category, p.out_of_stock, p.status AS product_status,
    ${DELIVERED} AS qty_delivered
  FROM request_lines l JOIN products p ON p.id = l.product_id`;

function withPending(l) {
  return { ...l, qty_pending: Math.max(0, l.qty_requested - l.qty_cancelled - l.qty_delivered) };
}

async function getLine(db, id) {
  const l = await db.get(`${LINE_SELECT} WHERE l.id = ?`, id);
  if (!l) throw notFound('Línea');
  return withPending(l);
}

const lockLine = (t, id) => t.get('SELECT id FROM request_lines WHERE id = ? FOR UPDATE', id);

// Comparte el bloqueo del punto con los recuentos; bloquea siempre por id.
async function lockDeliveryPoints(t, pairs) {
  const productIds = [...new Set(pairs.map((p) => p.product_id))].sort((a, b) => a - b);
  if (productIds.length) await t.all(`SELECT id FROM products WHERE id IN (${marks(productIds)}) ORDER BY id FOR SHARE`, ...productIds);
  const barIds = [...new Set(pairs.map((p) => p.bar_id))].sort((a, b) => a - b);
  if (barIds.length) await t.all(`SELECT id FROM bars WHERE id IN (${marks(barIds)}) ORDER BY id FOR KEY SHARE`, ...barIds);
  const storeIds = new Set();
  for (const p of pairs) {
    storeIds.add(p.from_store_id ?? await mainStoreId(t, p.product_id));
    const bar = await t.get('SELECT id FROM stores WHERE bar_id = ?', p.bar_id);
    if (bar) storeIds.add(bar.id);
  }
  const sorted = [...storeIds].sort((a, b) => a - b);
  if (sorted.length) await t.all(`SELECT id FROM stores WHERE id IN (${marks(sorted)}) ORDER BY id FOR UPDATE`, ...sorted);
}

/**
 * Añade botellas a la lista de la noche actual. Si ya hay una línea abierta
 * del mismo producto para la misma barra, se suma a ella en lugar de crear
 * otra: así la lista no se duplica y se ve de un vistazo lo que falta.
 * Bloquear la noche ordena en serie los pedidos simultáneos.
 */
export async function createRequest(db, { bar_id, items, by }, { now } = {}) {
  const barId = Number(bar_id);
  await barExists(db, barId);
  if (!Array.isArray(items) || !items.length) throw bad('La solicitud está vacía.');
  if (items.length > 60) throw bad('Demasiados productos en una sola solicitud.');
  const wanted = items.map((i) => ({ product_id: Number(i.product_id), qty: posInt(i.qty, 'Cantidad') }));
  const products = Object.fromEntries((await listProducts(db)).map((p) => [p.id, p]));
  for (const w of wanted) if (!products[w.product_id]) throw bad('Hay un producto que no está disponible en el catálogo.');

  const session = await ensureSession(db, await currentDate(db, now), now);
  const t0 = nowIso(now);
  const who = clean(by);
  await db.tx(async (t) => {
    await t.get('SELECT id FROM sessions WHERE id = ? FOR UPDATE', session.id);
    const openLines = (await t.all(`${LINE_SELECT} WHERE l.session_id = ? AND l.bar_id = ? ORDER BY l.id DESC`, session.id, barId))
      .map(withPending).filter((l) => l.qty_pending > 0);
    for (const w of wanted) {
      let open = openLines.find((l) => l.product_id === w.product_id);
      if (open) {
        await t.run('UPDATE request_lines SET qty_requested = qty_requested + ?, updated_at = ? WHERE id = ?', w.qty, t0, open.id);
      } else {
        const { lastId } = await t.run(`INSERT INTO request_lines (session_id, bar_id, product_id, qty_requested, created_at, updated_at, created_by)
          VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`, session.id, barId, w.product_id, w.qty, t0, t0, who);
        // Si el mismo producto viene dos veces en la solicitud, se suma a esta línea.
        open = { id: lastId, product_id: w.product_id, isNew: true };
        openLines.unshift(open);
      }
      await audit(t, {
        actor: who, entity: 'solicitud', entityId: open.isNew ? null : open.id, action: 'pedir',
        after: { producto: products[w.product_id].name, barra: barId, botellas: w.qty }, now,
      });
    }
  });
  return { ok: true, bottles: sum(wanted, (w) => w.qty) };
}

/**
 * «Hecho»: da por repuesta toda la lista de una vez. Para cada línea se registra
 * lo indicado (por defecto, todo lo que faltaba). Cada entrega es una sentencia
 * condicional que solo se aplica si la línea sigue como la vio quien repone
 * (mismas botellas ya entregadas) y aún faltan al menos esas botellas. Así, si
 * dos personas pulsan «Hecho» a la vez, solo cuenta una (la otra recibe 409);
 * y lo que se pida después de abrir la lista sigue pendiente.
 */
export async function completeLines(db, { items, by }, { now } = {}) {
  if (!Array.isArray(items) || !items.length) throw bad('No hay nada que completar.');
  if (items.length > 40) throw bad('Demasiadas líneas de una vez: completa por barras.');
  const who = clean(by);
  const wanted = items.map((i) => ({
    line_id: Number(i.line_id),
    qty: posInt(i.qty, 'Cantidad', { allowZero: true }),
    delivered: posInt(i.delivered ?? 0, 'Entregadas', { allowZero: true }),
  })).filter((i) => i.qty > 0);
  if (!wanted.length) throw bad('No hay nada que completar.');
  if (wanted.some((w) => !Number.isInteger(w.line_id))) throw bad('Línea no válida.');
  const ids = [...new Set(wanted.map((w) => w.line_id))].sort((a, b) => a - b);
  return db.tx(async (t) => {
    await t.all(`SELECT id FROM request_lines WHERE id IN (${marks(ids)}) ORDER BY id FOR UPDATE`, ...ids);
    await lockDeliveryPoints(t, await t.all(`SELECT product_id, bar_id FROM request_lines WHERE id IN (${marks(ids)})`, ...ids));
    const t0 = nowIso(now);
    const done = [];
    for (const w of [...wanted].sort((a, b) => a.line_id - b.line_id)) {
      // La entrega conserva l.session_id: «Hecho» cuenta en la jornada de la solicitud,
      // aunque delivered_at caiga después del corte de las 12:00 en Madrid.
      const r = await t.run(`INSERT INTO deliveries
          (session_id, bar_id, product_id, line_id, qty, delivered_at, delivered_by, source, from_store_id)
        SELECT l.session_id, l.bar_id, l.product_id, l.id, ?::int, ?::text, ?::text, 'lista', ${MAIN_STORE_SQL}
        FROM request_lines l JOIN products p ON p.id = l.product_id
        WHERE l.id = ? AND ${DELIVERED} = ? AND ${PENDING} >= ? RETURNING id`,
      w.qty, t0, who, w.line_id, w.delivered, w.qty);
      if (r.changes) done.push(w);
    }
    if (!done.length) throw new HttpError(409, 'Ya estaba hecho: otra persona lo ha repuesto.');
    const doneIds = done.map((d) => d.line_id);
    const names = Object.fromEntries((await t.all(`SELECT l.id, l.bar_id, p.name, ${MAIN_STORE_SQL} AS from_store_id FROM request_lines l
      JOIN products p ON p.id = l.product_id WHERE l.id IN (${marks(doneIds)})`, ...doneIds)).map((r) => [r.id, r]));
    await t.run(`UPDATE request_lines SET claimed_by = NULL, claimed_at = NULL WHERE id IN (${marks(doneIds)})`, ...doneIds);
    await audit(t, {
      actor: who, entity: 'reposicion', action: 'hecho',
      after: done.map((d) => ({ producto: names[d.line_id]?.name, barra: names[d.line_id]?.bar_id,
        botellas: d.qty, from_store_id: names[d.line_id]?.from_store_id })), now,
    });
    return { lines: done.length, bottles: sum(done, (d) => d.qty), skipped: wanted.length - done.length };
  });
}

export async function deliver(db, lineId, { qty, by }, { now } = {}) {
  const n = posInt(qty, 'Cantidad');
  const who = clean(by);
  return db.tx(async (t) => {
    if (!await lockLine(t, lineId)) throw notFound('Línea');
    await lockDeliveryPoints(t, [await t.get('SELECT product_id, bar_id FROM request_lines WHERE id = ?', lineId)]);
    const { changes, lastId } = await t.run(`INSERT INTO deliveries
        (session_id, bar_id, product_id, line_id, qty, delivered_at, delivered_by, source, from_store_id)
      SELECT l.session_id, l.bar_id, l.product_id, l.id, ?::int, ?::text, ?::text, 'lista', ${MAIN_STORE_SQL}
      FROM request_lines l JOIN products p ON p.id = l.product_id
      WHERE l.id = ? AND ${PENDING} >= ? RETURNING id`, n, nowIso(now), who, lineId, n);
    const line = await getLine(t, lineId);
    if (!changes) {
      if (line.qty_pending === 0) throw new HttpError(409, 'Esta línea ya está completa: otra persona la ha entregado.');
      throw new HttpError(409, `Solo quedan ${line.qty_pending} pendiente(s): otra persona ha entregado parte.`);
    }
    await audit(t, {
      actor: who, entity: 'reposicion', entityId: lastId, action: 'entregar',
      after: { producto: line.product_name, barra: line.bar_id, botellas: n,
        from_store_id: await mainStoreId(t, line.product_id) }, now,
    });
    if (line.qty_pending === 0 && line.claimed_by) {
      await t.run('UPDATE request_lines SET claimed_by = NULL, claimed_at = NULL WHERE id = ?', lineId);
    }
    return { ...line, claimed_by: line.qty_pending === 0 ? null : line.claimed_by };
  });
}

/** "Voy yo": avisa al resto de que alguien ya está llevando esa línea. */
export async function claimLine(db, lineId, { by, release = false }, { now } = {}) {
  if (release) {
    await db.run('UPDATE request_lines SET claimed_by = NULL, claimed_at = NULL WHERE id = ?', lineId);
    return getLine(db, lineId);
  }
  const who = clean(by) || 'Alguien';
  return db.tx(async (t) => {
    if (!await lockLine(t, lineId)) throw notFound('Línea');
    const { changes } = await t.run(`UPDATE request_lines SET claimed_by = ?, claimed_at = ?
      WHERE id = ? AND (claimed_by IS NULL OR claimed_by = ?)`, who, nowIso(now), lineId, who);
    const line = await getLine(t, lineId);
    if (!changes) throw new HttpError(409, `${line.claimed_by} ya la está llevando.`);
    return line;
  });
}

/** Retira botellas pendientes que ya no hacen falta (pedidas por error, etc.). */
export async function cancelPending(db, lineId, { qty, by, reason }, { now } = {}) {
  return db.tx(async (t) => {
    if (!await lockLine(t, lineId)) throw notFound('Línea');
    const before = await getLine(t, lineId);
    const n = qty === undefined ? before.qty_pending : posInt(qty, 'Cantidad');
    const { changes } = n > 0
      ? await t.run(`UPDATE request_lines AS l SET qty_cancelled = qty_cancelled + ?, updated_at = ?
          WHERE l.id = ? AND ${PENDING} >= ?`, n, nowIso(now), lineId, n)
      : { changes: 0 };
    if (!changes) throw new HttpError(409, 'No hay tantas botellas pendientes.');
    await audit(t, {
      actor: clean(by), entity: 'solicitud', entityId: lineId, action: 'anular pendiente',
      after: { producto: before.product_name, barra: before.bar_id, botellas: n }, reason: clean(reason, 200), now,
    });
    return getLine(t, lineId);
  });
}

async function getDelivery(db, id) {
  const d = await db.get(`SELECT d.*, p.name AS product_name, s.business_date FROM deliveries d
    JOIN products p ON p.id = d.product_id JOIN sessions s ON s.id = d.session_id WHERE d.id = ?`, id);
  if (!d) throw notFound('Reposición');
  return d;
}

/** Deshacer una entrega recién hecha desde la lista (p. ej. pulsación por error). */
export async function undoDelivery(db, id, { by }, { now } = {}) {
  const minutes = Number((await getSettings(db)).undo_minutes);
  const limit = new Date((now ?? new Date()).getTime() - minutes * 60000).toISOString();
  return db.tx(async (t) => {
    const d0 = await t.get('SELECT id, line_id FROM deliveries WHERE id = ?', id);
    if (!d0) throw notFound('Reposición');
    if (d0.line_id) await lockLine(t, d0.line_id);
    await t.get('SELECT id FROM deliveries WHERE id = ? FOR UPDATE', id);
    const d = await getDelivery(t, id);
    await lockDeliveryPoints(t, [d]);
    const { changes } = await t.run(`UPDATE deliveries SET qty = 0, corrected = 1
      WHERE id = ? AND source = 'lista' AND corrected = 0 AND qty > 0 AND delivered_at >= ?`, id, limit);
    if (!changes) {
      if (d.source !== 'lista' || d.corrected || d.qty === 0) throw new HttpError(409, 'Esta entrega ya no se puede deshacer desde la lista.');
      throw new HttpError(409, `Solo se puede deshacer durante ${minutes} minutos. Pide al encargado que la corrija.`);
    }
    await audit(t, {
      actor: clean(by), entity: 'reposicion', entityId: id, action: 'deshacer',
      before: { botellas: d.qty }, after: { botellas: 0 }, reason: 'Deshecho desde la lista', now,
    });
    return getDelivery(t, id);
  });
}

// ---------------------------------------------------------------- lista en vivo

export async function liveState(db, { now } = {}) {
  const current = now ?? new Date();
  const s = await getSettings(db);
  const settings = toPublic(s);
  const catalog_rev = Number(s.catalog_rev) || 0;
  const date = businessDate(current, s.timezone, Number(s.cutoff_hour));
  const session = await findSession(db, date);
  const out = (await db.all('SELECT id FROM products WHERE out_of_stock = 1 ORDER BY id')).map((r) => r.id);
  const stock = await liveStock(db, { now: current });
  const [trip, rev] = await Promise.all([
    openTripSummary(db), db.get("SELECT COALESCE(MAX(id), 0)::int AS n FROM audit WHERE entity = 'almacen'"),
  ]);
  const almacen_rev = rev.n;
  if (!session) return { date, session: null, lines: [], recent: [], settings, outOfStock: out, stock, trip, almacen_rev, catalog_rev, server_time: current.toISOString() };
  const lines = (await db.all(`${LINE_SELECT} WHERE l.session_id = ? ORDER BY l.created_at, l.id`, session.id)).map(withPending);
  const t = current.getTime();
  const recent = (await db.all(`SELECT d.*, p.name AS product_name, p.slug FROM deliveries d
    JOIN products p ON p.id = d.product_id
    WHERE d.session_id = ? ORDER BY d.delivered_at DESC, d.id DESC LIMIT 30`, session.id))
    .map((d) => ({
      ...d,
      can_undo: d.source === 'lista' && !d.corrected && d.qty > 0
        && (t - new Date(d.delivered_at).getTime()) / 60000 <= settings.undo_minutes,
    }));
  return { date, session, lines, recent, settings, outOfStock: out, stock, trip, almacen_rev, catalog_rev, server_time: current.toISOString() };
}

// ---------------------------------------------------------------- historial y correcciones

export function listDeliveries(db, { from, to, bar_id, product_id }) {
  const cond = ['s.business_date BETWEEN ? AND ?'];
  const args = [from || '0000-01-01', to || '9999-12-31'];
  if (bar_id) { cond.push('d.bar_id = ?'); args.push(Number(bar_id)); }
  if (product_id) { cond.push('d.product_id = ?'); args.push(Number(product_id)); }
  return db.all(`SELECT d.*, p.name AS product_name, s.business_date FROM deliveries d
    JOIN products p ON p.id = d.product_id JOIN sessions s ON s.id = d.session_id
    WHERE ${cond.join(' AND ')} ORDER BY d.delivered_at DESC, d.id DESC LIMIT 1000`, ...args);
}

/**
 * Corregir una reposición ya registrada. Nunca se borra: se modifica y queda
 * constancia en el registro de cambios (antes, después, motivo y quién).
 */
export async function correctDelivery(db, id, { qty, bar_id, product_id, reason, by }, { now } = {}) {
  const why = clean(reason, 300);
  if (!why) throw bad('Indica el motivo de la corrección.');
  return db.tx(async (t) => {
    await t.get('SELECT id FROM deliveries WHERE id = ? FOR UPDATE', id);
    const d = await getDelivery(t, id);
    const next = {
      qty: qty === undefined ? d.qty : posInt(qty, 'Cantidad', { allowZero: true }),
      bar_id: bar_id === undefined ? d.bar_id : Number(bar_id),
      product_id: product_id === undefined ? d.product_id : Number(product_id),
    };
    await barExists(t, next.bar_id);
    const p = await getProduct(t, next.product_id);
    if (next.product_id === d.product_id) next.from_store_id = d.from_store_id;
    await lockDeliveryPoints(t, [d, next]);
    next.from_store_id ??= await mainStoreId(t, next.product_id);
    // Si cambia la barra o el producto deja de corresponder a su línea de solicitud.
    const lineId = next.bar_id !== d.bar_id || next.product_id !== d.product_id ? null : d.line_id;
    await t.run(`UPDATE deliveries SET qty = ?, bar_id = ?, product_id = ?, line_id = ?, from_store_id = ?, corrected = 1
      WHERE id = ? AND qty = ? AND product_id = ? AND bar_id = ?`,
    next.qty, next.bar_id, next.product_id, lineId, next.from_store_id, id, d.qty, d.product_id, d.bar_id);
    await audit(t, {
      actor: clean(by), entity: 'reposicion', entityId: id, action: 'corregir',
      before: { botellas: d.qty, barra: d.bar_id, producto: d.product_name, from_store_id: d.from_store_id },
      after: { botellas: next.qty, barra: next.bar_id, producto: p.name, from_store_id: next.from_store_id },
      reason: why, now,
    });
    return getDelivery(t, id);
  });
}

/** Registrar a posteriori una reposición que no se anotó en su momento. */
export async function addManualDelivery(db, { date, bar_id, product_id, qty, reason, by, delivered_at }, { now } = {}) {
  if (!isYmd(date)) throw bad('Fecha no válida.');
  const why = clean(reason, 300);
  if (!why) throw bad('Indica el motivo.');
  const n = posInt(qty, 'Cantidad');
  const barId = Number(bar_id);
  await barExists(db, barId);
  const p = await getProduct(db, Number(product_id));
  const registeredAt = nowIso(now);
  const today = businessDate(new Date(registeredAt));
  if (!delivered_at && date !== today) throw bad('Indica la fecha y hora efectiva de la reposición olvidada.');
  const effective = delivered_at === undefined ? null : new Date(delivered_at);
  if (effective && (typeof delivered_at !== 'string' || !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(delivered_at)
      || !Number.isFinite(effective.getTime()) || effective.getTime() > new Date(registeredAt).getTime()
      || businessDate(effective) !== date)) throw bad('La hora efectiva debe pertenecer a la noche elegida (Madrid, corte a las 12:00).');
  const s = await ensureSession(db, date, now);
  return db.tx(async (t) => {
    await lockDeliveryPoints(t, [{ product_id: p.id, bar_id: barId }]);
    const { lastId } = await t.run(`INSERT INTO deliveries
      (session_id, bar_id, product_id, qty, delivered_at, delivered_by, source, corrected, from_store_id)
      SELECT ?::int, ?::int, p.id, ?::int, ?::text, ?::text, 'manual', 1, ${MAIN_STORE_SQL}
      FROM products p WHERE p.id = ? RETURNING id`, s.id, barId, n, effective?.toISOString() ?? nowIso(now), clean(by), p.id);
    await audit(t, {
      actor: clean(by), entity: 'reposicion', entityId: lastId, action: 'añadir a posteriori',
      after: { noche: date, delivered_at: effective?.toISOString() ?? registeredAt, producto: p.name, barra: barId, botellas: n,
        from_store_id: await mainStoreId(t, p.id) }, reason: why, now,
    });
    return getDelivery(t, lastId);
  });
}

export async function listAudit(db, { limit = 200, entity, entity_id } = {}) {
  const cond = [];
  const args = [];
  if (entity) { cond.push('entity = ?'); args.push(entity); }
  if (entity_id) { cond.push('entity_id = ?'); args.push(Number(entity_id)); }
  const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
  return (await db.all(`SELECT * FROM audit ${where} ORDER BY id DESC LIMIT ?`, ...args, Math.min(Number(limit) || 200, 1000)))
    .map((a) => ({ ...a, before: a.before && JSON.parse(a.before), after: a.after && JSON.parse(a.after) }));
}

// ---------------------------------------------------------------- informes

async function stockoutNightsFor(db, dates, { distinct = false } = {}) {
  const out = {};
  if (!dates.length) return out;
  const s = await getSettings(db);
  const dateOf = (iso) => businessDate(new Date(iso), s.timezone, Number(s.cutoff_hour));
  const first = dates.reduce((a, b) => (a < b ? a : b));
  const counted = distinct ? new Set() : null;
  for (const so of await db.all('SELECT * FROM stockouts ORDER BY id')) {
    const start = dateOf(so.started_at);
    const end = so.ended_at ? dateOf(so.ended_at) : '9999-12-31';
    if (end < first) continue;
    for (const d of dates) {
      const key = `${so.product_id}:${d}`;
      if (d >= start && d <= end && (!counted || !counted.has(key))) {
        out[so.product_id] = (out[so.product_id] || 0) + 1;
        counted?.add(key);
      }
    }
  }
  return out;
}

function aggregate(db, from, to, barId) {
  const cond = barId ? 'AND d.bar_id = ?' : '';
  const args = barId ? [from, to, barId] : [from, to];
  return db.all(`SELECT d.product_id, d.bar_id, s.business_date AS date, SUM(d.qty)::int AS qty
    FROM deliveries d JOIN sessions s ON s.id = d.session_id
    WHERE s.business_date BETWEEN ? AND ? AND d.qty > 0 ${cond}
    GROUP BY d.product_id, d.bar_id, s.business_date
    ORDER BY s.business_date, d.product_id, d.bar_id`, ...args);
}

/** Botellas pedidas y no entregadas (ni anuladas) en un rango de noches. */
async function unservedFor(db, from, to, barId) {
  const out = {};
  const cond = barId ? 'AND l.bar_id = ?' : '';
  const lines = (await db.all(`${LINE_SELECT}
    WHERE l.session_id IN (SELECT id FROM sessions WHERE business_date BETWEEN ? AND ?) ${cond}`,
  from, to, ...(barId ? [barId] : []))).map(withPending);
  for (const l of lines) if (l.qty_pending) out[l.product_id] = (out[l.product_id] || 0) + l.qty_pending;
  return out;
}

export async function report(db, { period = 'week', date, bar_id } = {}, { now } = {}) {
  if (!['night', 'week', 'month'].includes(period)) throw bad('Periodo no válido.');
  const ref = isYmd(date) ? date : await currentDate(db, now);
  const range = periodRange(period, ref);
  const barId = bar_id ? Number(bar_id) : null;

  const rows = await aggregate(db, range.from, range.to, barId);
  const sessions = await db.all('SELECT * FROM sessions WHERE business_date BETWEEN ? AND ? ORDER BY business_date', range.from, range.to);

  let prevRange;
  if (period === 'night') {
    const prev = await db.get('SELECT business_date FROM sessions WHERE business_date < ? ORDER BY business_date DESC LIMIT 1', ref);
    prevRange = prev ? periodRange('night', prev.business_date) : null;
  } else {
    prevRange = periodRange(period, previousPeriodDate(period, ref));
  }
  const prevTotals = {};
  if (prevRange) {
    for (const r of await aggregate(db, prevRange.from, prevRange.to, barId)) {
      prevTotals[r.product_id] = (prevTotals[r.product_id] || 0) + r.qty;
    }
  }

  const byProduct = {};
  const byNight = {};
  const byBar = {};
  let total = 0;
  for (const r of rows) {
    byProduct[r.product_id] ??= { product_id: r.product_id, perBar: {}, total: 0 };
    byProduct[r.product_id].perBar[r.bar_id] = (byProduct[r.product_id].perBar[r.bar_id] || 0) + r.qty;
    byProduct[r.product_id].total += r.qty;
    byNight[r.date] ??= { date: r.date, perBar: {}, total: 0 };
    byNight[r.date].perBar[r.bar_id] = (byNight[r.date].perBar[r.bar_id] || 0) + r.qty;
    byNight[r.date].total += r.qty;
    byBar[r.bar_id] = (byBar[r.bar_id] || 0) + r.qty;
    total += r.qty;
  }
  for (const pid of Object.keys(prevTotals)) {
    byProduct[pid] ??= { product_id: Number(pid), perBar: {}, total: 0 };
  }
  for (const p of Object.values(byProduct)) p.previous = prevTotals[p.product_id] || 0;

  const stockouts = await stockoutNightsFor(db, sessions.map((s) => s.business_date));
  const unserved = sessions.length ? await unservedFor(db, range.from, range.to, barId) : {};

  // Solo se habla de consumo si todas las noches del periodo se marcaron como
  // "las barras empiezan y terminan con el mismo nivel".
  const consumption = sessions.length > 0 && sessions.every((s) => s.same_level === 1);

  return {
    period, date: ref, range, previousRange: prevRange, bar_id: barId,
    nights: sessions.map((s) => ({ ...s, ...(byNight[s.business_date] || { perBar: {}, total: 0 }) })),
    products: Object.values(byProduct).sort((a, b) => b.total - a.total),
    byBar, total,
    previousTotal: Object.values(prevTotals).reduce((a, b) => a + b, 0),
    consumption,
    sameLevel: {
      yes: sessions.filter((s) => s.same_level === 1).length,
      no: sessions.filter((s) => s.same_level === 0).length,
      unknown: sessions.filter((s) => s.same_level === null).length,
    },
    stockouts, unserved,
  };
}

// El informe nuevo conserva report() para los consumidores anteriores.
function customRangeLabel(from, to) {
  const year = (ymd) => ymd.slice(0, 4);
  const crossYear = year(from) !== year(to);
  return `Del ${shortDate(from)}${crossYear ? ` ${year(from)}` : ''} al ${shortDate(to)}${crossYear ? ` ${year(to)}` : ''}`;
}

// Noches con actividad real: alguna petición o alguna reposición hecha.
const ACTIVE_SESSION = `(EXISTS (SELECT 1 FROM request_lines l WHERE l.session_id = s.id)
  OR EXISTS (SELECT 1 FROM deliveries d WHERE d.session_id = s.id AND d.qty > 0))`;

/** Viernes del bloque viernes-domingo que contiene la fecha (o el anterior si cae entre semana). */
const fridayOf = (ymd) => addDays(ymd, -((weekday(ymd) + 2) % 7));

/**
 * «Último finde»: el último bloque de viernes a domingo, hasta `ref`, en el que
 * hubo actividad. Si nunca la hubo, el último bloque de viernes a domingo.
 */
async function lastWeekendRange(db, ref) {
  const dates = await db.all(`SELECT s.business_date FROM sessions s
    WHERE s.business_date <= ? AND ${ACTIVE_SESSION}
    ORDER BY s.business_date DESC LIMIT 400`, ref);
  const hit = dates.find((d) => [5, 6, 0].includes(weekday(d.business_date)));
  const from = fridayOf(hit?.business_date ?? ref);
  const to = addDays(from, 2);
  const start = from.slice(0, 7) === to.slice(0, 7) ? String(Number(from.slice(8))) : shortDate(from);
  return { from, to, label: `Finde del ${start} al ${shortDate(to)}` };
}

async function informePeriod(db, { period = 'week', date, from, to, bar_id } = {}, now) {
  if (!['night', 'weekend', 'week', 'month', 'custom'].includes(period)) throw bad('Periodo no válido.');
  let range;
  let ref;
  if (period === 'weekend') {
    if (date !== undefined && !isYmd(date)) throw bad('Fecha no válida.');
    range = await lastWeekendRange(db, date ?? await currentDate(db, now));
    ref = range.to;
  } else if (period === 'custom') {
    if (!isYmd(from) || !isYmd(to)) throw bad('Fecha no válida.');
    if (from > to) throw bad('Revisa las fechas: el inicio es posterior al final.');
    const days = daysBetween(from, to) + 1;
    if (days > 366) throw bad('El rango no puede superar 366 días.');
    range = { from, to, label: customRangeLabel(from, to) };
    ref = to;
  } else {
    if (date !== undefined && !isYmd(date)) throw bad('Fecha no válida.');
    ref = date ?? await currentDate(db, now);
    range = periodRange(period, ref);
  }

  let barId = null;
  if (bar_id !== undefined && bar_id !== null && bar_id !== '') {
    barId = Number(bar_id);
    if (!Number.isInteger(barId) || barId < 1) throw bad('Barra no válida.');
    await barExists(db, barId);
  }

  let previousRange;
  if (period === 'night') {
    const prev = await db.get('SELECT business_date FROM sessions WHERE business_date < ? ORDER BY business_date DESC LIMIT 1', ref);
    previousRange = prev ? periodRange('night', prev.business_date) : null;
  } else if (period === 'weekend') {
    const start = addDays(range.from, -7);
    previousRange = { from: start, to: addDays(start, 2), label: `Finde del ${shortDate(start)}` };
  } else if (period === 'custom') {
    const end = addDays(from, -1);
    const start = addDays(end, -(daysBetween(from, to)));
    previousRange = { from: start, to: end, label: customRangeLabel(start, end) };
  } else {
    previousRange = periodRange(period, previousPeriodDate(period, ref));
  }
  return { period, date: ref, range, previousRange, bar_id: barId };
}

function summedRows(rows) {
  const products = new Map();
  for (const r of rows) {
    const p = products.get(r.product_id) ?? { bottles: 0, byBar: {}, byNight: new Map() };
    p.bottles += r.qty;
    p.byBar[r.bar_id] = (p.byBar[r.bar_id] || 0) + r.qty;
    const night = p.byNight.get(r.date) ?? { bottles: 0, byBar: {} };
    night.bottles += r.qty;
    night.byBar[r.bar_id] = (night.byBar[r.bar_id] || 0) + r.qty;
    p.byNight.set(r.date, night);
    products.set(r.product_id, p);
  }
  return products;
}

const casesFor = (bottles, perCase) => perCase == null ? null
  : { full: Math.floor(bottles / perCase), loose: bottles % perCase };

async function informeData(db, params, now) {
  const period = await informePeriod(db, params, now);
  const { range, previousRange, bar_id: barId } = period;
  const [sessions, currentRows, previousRows, products, groups] = await Promise.all([
    db.all('SELECT business_date, same_level FROM sessions WHERE business_date BETWEEN ? AND ? ORDER BY business_date', range.from, range.to),
    aggregate(db, range.from, range.to, barId),
    previousRange ? aggregate(db, previousRange.from, previousRange.to, barId) : [],
    db.all(`SELECT p.*, g.name AS group_name, g.sort AS group_sort
      FROM products p LEFT JOIN product_groups g ON g.id = p.group_id`),
    listGroups(db),
  ]);
  const current = summedRows(currentRows);
  const previous = summedRows(previousRows);
  const unserved = await unservedFor(db, range.from, range.to, barId);
  const stockoutNights = await stockoutNightsFor(db, sessions.map((s) => s.business_date), { distinct: true });
  const sameLevel = {
    yes: sessions.filter((s) => s.same_level === 1).length,
    no: sessions.filter((s) => s.same_level === 0).length,
    unknown: sessions.filter((s) => s.same_level === null).length,
  };
  return { ...period, sessions, current, previous, products, groups, unserved, stockoutNights,
    sameLevel, basis: sessions.length && sameLevel.yes === sessions.length ? 'consumo' : 'repuestas' };
}

export async function informe(db, params = {}, { now } = {}) {
  const data = await informeData(db, params, now);
  const groupParam = params.group ?? 'all';
  let selectedGroup = null;
  if (groupParam !== 'all' && groupParam !== 'none') {
    const id = Number(groupParam);
    if (!/^[1-9]\d*$/.test(String(groupParam)) || !Number.isSafeInteger(id)) throw bad('Grupo no válido.');
    selectedGroup = data.groups.find((g) => g.id === id);
    if (!selectedGroup) throw bad('Grupo no válido.');
  }
  const group = groupParam === 'none' ? { id: null, name: 'Fuera de la selección' }
    : selectedGroup ? { id: selectedGroup.id, name: selectedGroup.name } : null;
  const selected = (p) => groupParam === 'all' || (groupParam === 'none' ? p.group_id === null : p.group_id === selectedGroup.id);
  const included = data.products.filter((p) => selected(p)
    && (p.active === 1 || data.current.has(p.id) || data.previous.has(p.id)));
  const zero = { bottles: 0, byBar: {}, byNight: new Map() };
  const products = included.map((p) => {
    const cur = data.current.get(p.id) ?? zero;
    const previous = data.previous.get(p.id)?.bottles ?? 0;
    return {
      product_id: p.id, name: p.name, slug: p.slug, photo: p.photo, category: p.category,
      status: p.status, group_id: p.group_id, group_order: p.group_order,
      per_case: p.per_case, out_of_stock: p.out_of_stock === 1,
      bottles: cur.bottles, previous,
      diff: data.previousRange ? cur.bottles - previous : 0,
      byBar: cur.byBar, cases: casesFor(cur.bottles, p.per_case),
      stockout_nights: data.stockoutNights[p.id] || 0, unserved: data.unserved[p.id] || 0,
      group_sort: p.group_sort,
    };
  }).sort((a, b) => b.bottles - a.bottles || (a.group_sort ?? Infinity) - (b.group_sort ?? Infinity)
    || (a.group_order ?? Infinity) - (b.group_order ?? Infinity) || a.name.localeCompare(b.name, 'es'))
    .map(({ group_sort, ...p }) => p);
  const selectedIds = new Set(included.map((p) => p.id));
  const byBar = {};
  const byNight = new Map();
  let bottles = 0;
  let previous = 0;
  for (const [id, cur] of data.current) {
    if (!selectedIds.has(id)) continue;
    bottles += cur.bottles;
    for (const [bar, qty] of Object.entries(cur.byBar)) byBar[bar] = (byBar[bar] || 0) + qty;
    for (const [date, n] of cur.byNight) {
      const target = byNight.get(date) ?? { bottles: 0, byBar: {} };
      target.bottles += n.bottles;
      for (const [bar, qty] of Object.entries(n.byBar)) target.byBar[bar] = (target.byBar[bar] || 0) + qty;
      byNight.set(date, target);
    }
  }
  for (const [id, prev] of data.previous) if (selectedIds.has(id)) previous += prev.bottles;
  const byGroup = [...data.groups.map((g) => ({ group_id: g.id, name: g.name, bottles: 0, previous: 0 })),
    { group_id: null, name: 'Fuera de la selección', bottles: 0, previous: 0 }];
  const groupRow = (id) => byGroup.find((g) => g.group_id === id);
  for (const p of data.products) {
    const row = groupRow(p.group_id);
    row.bottles += data.current.get(p.id)?.bottles ?? 0;
    row.previous += data.previous.get(p.id)?.bottles ?? 0;
  }
  return {
    period: data.period, date: data.date, range: data.range, previousRange: data.previousRange,
    bar_id: data.bar_id, group, groups: data.groups, basis: data.basis, sameLevel: data.sameLevel,
    totals: { bottles, previous, diff: data.previousRange ? bottles - previous : 0, byBar },
    byGroup,
    nights: data.sessions.map((s) => ({ business_date: s.business_date, same_level: s.same_level,
      bottles: byNight.get(s.business_date)?.bottles ?? 0, byBar: byNight.get(s.business_date)?.byBar ?? {} })),
    products,
  };
}

export async function informeBotella(db, id, params = {}, { now } = {}) {
  const data = await informeData(db, params, now);
  const p = data.products.find((x) => x.id === Number(id));
  if (!p) throw notFound('Producto');
  const cur = data.current.get(p.id) ?? { bottles: 0, byBar: {}, byNight: new Map() };
  const previous = data.previous.get(p.id)?.bottles ?? 0;
  const settings = await getSettings(db);
  const dateOf = (iso) => businessDate(new Date(iso), settings.timezone, Number(settings.cutoff_hour));
  const stockoutRows = await db.all('SELECT * FROM stockouts WHERE product_id = ? ORDER BY started_at, id', p.id);
  const covered = (so, date) => date >= dateOf(so.started_at) && date <= (so.ended_at ? dateOf(so.ended_at) : '9999-12-31');
  const stockouts = stockoutRows.filter((so) => dateOf(so.started_at) <= data.range.to
    && (!so.ended_at || dateOf(so.ended_at) >= data.range.from))
    .map((so) => ({ started_at: so.started_at, ended_at: so.ended_at,
      nights: data.sessions.filter((s) => covered(so, s.business_date)).length }));
  const deliveries = await db.all(`SELECT d.id, s.business_date, d.delivered_at, d.bar_id, d.qty,
      d.source, d.corrected
    FROM deliveries d JOIN sessions s ON s.id = d.session_id
    WHERE d.product_id = ? AND s.business_date BETWEEN ? AND ? ${data.bar_id ? 'AND d.bar_id = ?' : ''}
    ORDER BY d.delivered_at DESC, d.id DESC LIMIT 500`,
  p.id, data.range.from, data.range.to, ...(data.bar_id ? [data.bar_id] : []));
  // La gráfica enseña todo el histórico de la botella, sin depender del periodo
  // elegido: semanas completas (lunes-domingo) desde su primera reposición.
  // Solo aparecen semanas con actividad real del local; una semana activa sin
  // esta botella conserva su punto a cero.
  const weeklyDeliveries = await db.all(`SELECT s.business_date, d.bar_id, SUM(d.qty)::int AS qty
      FROM deliveries d JOIN sessions s ON s.id = d.session_id
      WHERE d.product_id = ? AND d.qty > 0 ${data.bar_id ? 'AND d.bar_id = ?' : ''}
      GROUP BY s.business_date, d.bar_id ORDER BY s.business_date`,
  p.id, ...(data.bar_id ? [data.bar_id] : []));
  const activeDates = weeklyDeliveries.length ? await db.all(`SELECT s.business_date FROM sessions s
      WHERE s.business_date >= ? AND ${ACTIVE_SESSION}
      ORDER BY s.business_date`, weekStart(weeklyDeliveries[0].business_date)) : [];
  const byWeek = new Map();
  for (const d of weeklyDeliveries) {
    const start = weekStart(d.business_date);
    const week = byWeek.get(start) ?? { bottles: 0, byBar: {} };
    week.bottles += d.qty;
    week.byBar[d.bar_id] = (week.byBar[d.bar_id] || 0) + d.qty;
    byWeek.set(start, week);
  }
  const weeks = [...new Set(activeDates.map((d) => weekStart(d.business_date)))].map((start) => ({
    week_start: start, week_end: addDays(start, 6),
    bottles: byWeek.get(start)?.bottles ?? 0, byBar: byWeek.get(start)?.byBar ?? {},
  }));
  const open = stockoutRows.filter((so) => so.ended_at === null).at(-1);
  return {
    product: { id: p.id, name: p.name, slug: p.slug, photo: p.photo, category: p.category,
      status: p.status, capacity_ml: p.capacity_ml, per_case: p.per_case, active: p.active === 1,
      group: p.group_id === null ? null : { id: p.group_id, name: p.group_name },
      out_of_stock: p.out_of_stock === 1, out_of_stock_since: open?.started_at ?? null },
    period: data.period, date: data.date, range: data.range, previousRange: data.previousRange,
    bar_id: data.bar_id, basis: data.basis, bottles: cur.bottles, previous,
    diff: data.previousRange ? cur.bottles - previous : 0, byBar: cur.byBar,
    cases: casesFor(cur.bottles, p.per_case), unserved: data.unserved[p.id] || 0,
    stockout_nights: data.stockoutNights[p.id] || 0,
    nights: data.sessions.map((s) => ({ business_date: s.business_date, same_level: s.same_level,
      bottles: cur.byNight.get(s.business_date)?.bottles ?? 0,
      byBar: cur.byNight.get(s.business_date)?.byBar ?? {},
      out_of_stock: stockoutRows.some((so) => covered(so, s.business_date)) })),
    weeks,
    deliveries: deliveries.map((d) => ({ ...d, corrected: d.corrected === 1 })),
    stockouts,
  };
}

// ---------------------------------------------------------------- previsión

/**
 * Parámetros:
 *  base_from, base_to: periodo del historial a usar.
 *  target_from, target_to: periodo a prever.
 *  weekdays: días de apertura previstos (0 = domingo … 6 = sábado).
 *  closed_dates / extra_dates: excepciones (festivos, cierres, eventos).
 *  method: auto | average | weekday. event_pct, event_overrides, safety_pct, manual.
 */
export async function forecast(db, params = {}, { now } = {}) {
  const today = await currentDate(db, now);
  const s = await publicSettings(db);
  const baseTo = isYmd(params.base_to) ? params.base_to : addDays(today, -1);
  const baseFrom = isYmd(params.base_from) ? params.base_from : addDays(baseTo, -55);
  const targetFrom = isYmd(params.target_from) ? params.target_from : today;
  const targetTo = isYmd(params.target_to) ? params.target_to : addDays(targetFrom, 6);
  if (baseFrom > baseTo || targetFrom > targetTo) throw bad('Revisa las fechas: el inicio es posterior al final.');

  const sessions = await db.all(`SELECT s.* FROM sessions s WHERE s.business_date BETWEEN ? AND ?
    AND (EXISTS (SELECT 1 FROM deliveries d WHERE d.session_id = s.id AND d.qty > 0)
      OR EXISTS (SELECT 1 FROM request_lines l WHERE l.session_id = s.id))
    ORDER BY s.business_date`, baseFrom, baseTo);
  const baseNights = sessions.map((x) => ({ date: x.business_date, weekday: weekday(x.business_date) }));

  // Días de apertura por defecto: los que han tenido actividad en el periodo base.
  const openWeekdays = Array.isArray(params.weekdays) && params.weekdays.length
    ? params.weekdays.map(Number)
    : [...new Set(baseNights.map((n) => n.weekday))];
  const closed = new Set(params.closed_dates || []);
  const plannedSet = new Set(datesBetween(targetFrom, targetTo)
    .filter((d) => openWeekdays.includes(weekday(d)) && !closed.has(d)));
  for (const d of params.extra_dates || []) if (isYmd(d) && d >= targetFrom && d <= targetTo) plannedSet.add(d);
  const plannedNights = [...plannedSet].sort().map((d) => ({ date: d, weekday: weekday(d) }));

  const deliveries = (await aggregate(db, baseFrom, baseTo, null))
    .map((r) => ({ product_id: r.product_id, date: r.date, qty: r.qty }));
  const products = await listProducts(db);
  const currentlyOut = Object.fromEntries(products.filter((p) => p.out_of_stock).map((p) => [p.id, true]));

  const result = computeForecast({
    products,
    baseNights,
    deliveries,
    plannedNights,
    method: params.method || 'auto',
    minNightsPerWeekday: s.min_nights_per_weekday,
    lowDataNights: s.low_data_nights,
    eventPct: params.event_pct ?? 0,
    eventOverrides: params.event_overrides || {},
    safetyPct: params.safety_pct ?? s.safety_pct,
    manual: params.manual || {},
    stockoutNights: await stockoutNightsFor(db, baseNights.map((n) => n.date)),
    currentlyOut,
    unserved: sessions.length ? await unservedFor(db, baseFrom, baseTo) : {},
  });

  return {
    params: {
      base_from: baseFrom, base_to: baseTo, target_from: targetFrom, target_to: targetTo,
      weekdays: openWeekdays.sort(), method: params.method || 'auto',
      event_pct: Number(params.event_pct) || 0, safety_pct: result.summary.safetyPct,
      closed_dates: [...closed], extra_dates: params.extra_dates || [],
    },
    plannedDates: plannedNights.map((n) => n.date),
    ...result,
  };
}

// ---------------------------------------------------------------- listas de compra

async function normalizeLines(db, lines) {
  if (!Array.isArray(lines)) throw bad('Faltan las líneas de la lista.');
  const products = Object.fromEntries((await listProducts(db, { all: true })).map((p) => [p.id, p]));
  return lines.filter((l) => products[l.product_id]).map((l) => {
    const p = products[l.product_id];
    const num = (v) => (v === '' || v === null || v === undefined ? 0 : Math.max(0, Number(v) || 0));
    const calc = computePurchase({
      need: num(l.need), safety: num(l.safety), stock: num(l.stock),
      otherOut: num(l.other_out), incoming: num(l.incoming), perCase: p.per_case,
    });
    const final = l.final === '' || l.final === null || l.final === undefined ? null : posInt(l.final, 'Cantidad final', { allowZero: true });
    const unit = l.unit === 'cajas' && p.per_case ? 'cajas' : 'botellas';
    return {
      product_id: p.id,
      name: p.name,
      need: num(l.need), safety: num(l.safety), stock: num(l.stock),
      other_out: num(l.other_out), incoming: num(l.incoming),
      per_case: p.per_case,
      proposed: calc.bottles,
      final, unit,
      note: clean(l.note, 200),
    };
  });
}

export function listPurchases(db) {
  return db.all('SELECT id, title, status, created_at, updated_at FROM purchase_lists ORDER BY id DESC LIMIT 100');
}

export async function getPurchase(db, id) {
  const p = await db.get('SELECT * FROM purchase_lists WHERE id = ?', id);
  if (!p) throw notFound('Lista de compra');
  return { ...p, params: JSON.parse(p.params), lines: JSON.parse(p.lines) };
}

export async function savePurchase(db, id, { title, status, params, lines, notes }, { by, now } = {}) {
  const t0 = nowIso(now);
  const norm = await normalizeLines(db, lines);
  const st = status === 'cerrada' ? 'cerrada' : 'borrador';
  const ttl = clean(title, 120) || 'Lista de compra';
  if (id) {
    const before = await getPurchase(db, id);
    await db.tx(async (t) => {
      await t.run('UPDATE purchase_lists SET title = ?, status = ?, params = ?, lines = ?, notes = ?, updated_at = ? WHERE id = ?',
        ttl, st, JSON.stringify(params ?? before.params), JSON.stringify(norm), clean(notes, 1000), t0, id);
      await audit(t, { actor: by, entity: 'compra', entityId: id, action: 'modificar', after: { title: ttl, status: st }, now });
    });
    return getPurchase(db, id);
  }
  const newId = await db.tx(async (t) => {
    const { lastId } = await t.run(`INSERT INTO purchase_lists (title, status, params, lines, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`, ttl, st, JSON.stringify(params ?? {}), JSON.stringify(norm), clean(notes, 1000), t0, t0);
    await audit(t, { actor: by, entity: 'compra', entityId: lastId, action: 'crear', after: { title: ttl }, now });
    return lastId;
  });
  return getPurchase(db, newId);
}

export async function deletePurchase(db, id, { by, now } = {}) {
  const p = await getPurchase(db, id);
  await db.tx(async (t) => {
    await t.run('DELETE FROM purchase_lists WHERE id = ?', id);
    await audit(t, { actor: by, entity: 'compra', entityId: id, action: 'borrar', before: { title: p.title }, now });
  });
}

// ---------------------------------------------------------------- copia de seguridad

export const BACKUP_TABLES = ['settings', 'bars', 'stores', 'product_groups', 'products', 'staff', 'sessions', 'request_lines',
  'deliveries', 'stockouts', 'audit', 'purchase_lists', 'trips', 'trip_lines', 'stock_counts', 'stock_moves', 'stock_operations', 'need_adjustments'];

/** Copia completa de los datos en JSON (sin los códigos de acceso ni las fotos propias). */
export async function exportData(db, { now } = {}) {
  return db.tx(async (t) => {
    // Debe ser la primera sentencia: una sola instantánea para todas las tablas.
    await t.run('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const out = { exported_at: nowIso(now), tables: {} };
    for (const table of BACKUP_TABLES) {
      out.tables[table] = await t.all(`SELECT * FROM ${table} ORDER BY ${['settings','stock_operations'].includes(table) ? 'key' : 'id'}`);
    }
    out.tables.settings = out.tables.settings.filter((r) => !['staff_code', 'manager_pin'].includes(r.key));
    return out;
  });
}
