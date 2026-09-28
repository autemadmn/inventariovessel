// Lógica de negocio. Funciona igual en Node (node:sqlite) y en Cloudflare D1 a
// través del adaptador `db` (all / get / run / batch, todos asíncronos).
//
// D1 no tiene transacciones interactivas, así que las operaciones que deben ser
// atómicas (entregar, anular, deshacer, "voy yo") son una sola sentencia con la
// condición dentro: si otra persona ya entregó esa botella, la sentencia no
// cambia nada y se avisa. Así nadie puede entregar dos veces lo mismo.

import { CATEGORIES } from './catalog.js';
import { DEFAULT_SETTINGS } from './schema.js';
import {
  addDays, businessDate, datesBetween, isYmd, periodRange, previousPeriodDate, weekday,
} from './dates.js';
import { computeForecast, computePurchase } from '../public/js/shared/forecast.js';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const bad = (msg) => new HttpError(400, msg);
const notFound = (what) => new HttpError(404, `${what} no encontrado`);

const nowIso = (now) => (now ?? new Date()).toISOString();
const clean = (s, max = 80) => (typeof s === 'string' ? s.trim().slice(0, max) : '') || null;

function posInt(v, what, { allowZero = false } = {}) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < (allowZero ? 0 : 1) || n > 10000) {
    throw bad(`${what}: debe ser un número entero${allowZero ? '' : ' mayor que 0'}.`);
  }
  return n;
}

const AUDIT_SQL = `INSERT INTO audit (at, actor, entity, entity_id, action, before, after, reason)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;

function auditStmt({ actor, entity, entityId, action, before, after, reason, now }) {
  return [AUDIT_SQL, nowIso(now), actor ?? null, entity, entityId ?? null, action,
    before === undefined ? null : JSON.stringify(before),
    after === undefined ? null : JSON.stringify(after),
    reason ?? null];
}

export function audit(db, entry) {
  const [sql, ...args] = auditStmt(entry);
  return db.run(sql, ...args);
}

// ---------------------------------------------------------------- ajustes

export async function getSettings(db) {
  const out = { ...DEFAULT_SETTINGS };
  for (const { key, value } of await db.all('SELECT key, value FROM settings')) out[key] = value;
  return out;
}

function toPublic(s) {
  return {
    timezone: s.timezone,
    cutoff_hour: Number(s.cutoff_hour),
    safety_pct: Number(s.safety_pct),
    low_data_nights: Number(s.low_data_nights),
    min_nights_per_weekday: Number(s.min_nights_per_weekday),
    undo_minutes: Number(s.undo_minutes),
  };
}

export async function publicSettings(db) {
  return toPublic(await getSettings(db));
}

const EDITABLE_SETTINGS = {
  timezone: (v) => {
    try {
      new Intl.DateTimeFormat('es', { timeZone: v });
    } catch {
      throw bad('Zona horaria no válida.');
    }
    return v;
  },
  cutoff_hour: (v) => String(posInt(v, 'Hora de corte', { allowZero: true }) % 24),
  safety_pct: (v) => String(posInt(v, 'Margen de seguridad', { allowZero: true })),
  low_data_nights: (v) => String(posInt(v, 'Mínimo de noches')),
  min_nights_per_weekday: (v) => String(posInt(v, 'Noches por día de la semana')),
  undo_minutes: (v) => String(posInt(v, 'Minutos para deshacer', { allowZero: true })),
  staff_code: (v) => String(v ?? '').trim(),
  manager_pin: (v) => String(v ?? '').trim(),
};

export async function updateSettings(db, patch, { by, now } = {}) {
  const before = await getSettings(db);
  const stmts = [];
  const changed = {};
  for (const [k, fn] of Object.entries(EDITABLE_SETTINGS)) {
    if (patch[k] === undefined) continue;
    const v = fn(patch[k]);
    if (v !== before[k]) {
      stmts.push(['INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', k, v]);
      changed[k] = v;
    }
  }
  if (patch.bars) {
    for (const bar of patch.bars) {
      const name = clean(bar.name, 40);
      if (!name) throw bad('El nombre de la barra no puede estar vacío.');
      stmts.push(['UPDATE bars SET name = ? WHERE id = ?', name, Number(bar.id)]);
    }
    changed.bars = patch.bars;
  }
  if (stmts.length) {
    const hide = (o) => ({ ...o, staff_code: o.staff_code ? '••••' : '', manager_pin: o.manager_pin ? '••••' : '' });
    stmts.push(auditStmt({ actor: by, entity: 'ajustes', action: 'modificar', before: hide(before), after: hide(changed), now }));
    await db.batch(stmts);
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
  if (input.habitual !== undefined) out.habitual = input.habitual ? 1 : 0;
  const status = out.status ?? existing.status;
  if (out.active === 1 && ['sin_identificar', 'descartado'].includes(status)) {
    throw bad('Identifica el producto antes de activarlo.');
  }
  return out;
}

export async function createProduct(db, input, { by, now } = {}) {
  const f = productFields({ status: 'pendiente', category: 'otros', active: true, ...input });
  if (!f.name) throw bad('El nombre es obligatorio.');
  const { m } = await db.get('SELECT COALESCE(MAX(sort), 0) AS m FROM products');
  const t = nowIso(now);
  const { lastId } = await db.run(`INSERT INTO products
    (name, category, status, note, capacity_ml, per_case, active, sort, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  f.name, f.category, f.status, f.note ?? null, f.capacity_ml ?? null, f.per_case ?? null,
  f.active ?? 1, f.sort ?? m + 10, t, t);
  const p = await getProduct(db, lastId);
  await audit(db, { actor: by, entity: 'producto', entityId: p.id, action: 'crear', after: p, now });
  return p;
}

export async function updateProduct(db, id, input, { by, now, reason } = {}) {
  const before = await getProduct(db, id);
  const f = productFields(input, before);
  // Un producto que pasa a habitual va al final de los habituales.
  if (f.habitual === 1 && !before.habitual) {
    const { m } = await db.get('SELECT COALESCE(MAX(habitual_order), 0) AS m FROM products WHERE habitual = 1');
    f.habitual_order = m + 1;
  }
  const keys = Object.keys(f).filter((k) => f[k] !== before[k]);
  if (!keys.length) return before;
  await db.batch([
    [`UPDATE products SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`,
      ...keys.map((k) => f[k]), nowIso(now), id],
    auditStmt({
      actor: by, entity: 'producto', entityId: id, action: 'modificar',
      before: Object.fromEntries(keys.map((k) => [k, before[k]])),
      after: Object.fromEntries(keys.map((k) => [k, f[k]])),
      reason, now,
    }),
  ]);
  return getProduct(db, id);
}

/** Guarda una foto propia del producto (en la base de datos) y retira la anterior si era propia. */
export async function setProductPhoto(db, id, { mime, data }, { by, now } = {}) {
  const before = await getProduct(db, id);
  const t = nowIso(now);
  const { lastId } = await db.run('INSERT INTO photos (product_id, mime, data, created_at) VALUES (?, ?, ?, ?)', id, mime, data, t);
  const path = `/photos/${lastId}`;
  const stmts = [
    ['UPDATE products SET photo = ?, updated_at = ? WHERE id = ?', path, t, id],
    auditStmt({ actor: by, entity: 'producto', entityId: id, action: 'foto', before: { photo: before.photo }, after: { photo: path }, now }),
  ];
  const old = /^\/photos\/(\d+)$/.exec(before.photo || '');
  if (old) stmts.push(['DELETE FROM photos WHERE id = ?', Number(old[1])]);
  await db.batch(stmts);
  return getProduct(db, id);
}

export async function removeProductPhoto(db, id, { by, now } = {}) {
  const before = await getProduct(db, id);
  const stmts = [
    ['UPDATE products SET photo = NULL, updated_at = ? WHERE id = ?', nowIso(now), id],
    auditStmt({ actor: by, entity: 'producto', entityId: id, action: 'quitar foto', before: { photo: before.photo }, after: { photo: null }, now }),
  ];
  const old = /^\/photos\/(\d+)$/.exec(before.photo || '');
  if (old) stmts.push(['DELETE FROM photos WHERE id = ?', Number(old[1])]);
  await db.batch(stmts);
  return getProduct(db, id);
}

export function getPhoto(db, photoId) {
  return db.get('SELECT mime, data FROM photos WHERE id = ?', photoId);
}

/**
 * Resolver una botella sin identificar: o bien es un producto nuevo (se
 * activa con el nombre confirmado) o bien es un producto que ya existe (se
 * descarta indicando cuál, sin crear duplicados).
 */
export async function resolveUnidentified(db, id, { action, target_id, name, category }, { by, now } = {}) {
  const p = await getProduct(db, id);
  if (p.status !== 'sin_identificar') throw bad('Este producto ya está identificado.');
  if (action === 'duplicate') {
    const target = await getProduct(db, Number(target_id));
    if (target.id === p.id) throw bad('Elige otro producto.');
    return updateProduct(db, id, {
      status: 'descartado', active: false,
      note: `${p.note ? `${p.note} ` : ''}Resuelto: es el mismo producto que «${target.name}».`,
    }, { by, now, reason: `Identificado como ${target.name}` });
  }
  if (action === 'new') {
    return updateProduct(db, id, {
      name: name ?? p.name, category: category ?? p.category, status: 'pendiente', active: true,
    }, { by, now, reason: 'Identificado como producto nuevo' });
  }
  throw bad('Acción no válida.');
}

export async function setOutOfStock(db, id, out, { by, now } = {}) {
  await getProduct(db, id);
  const flag = out ? 1 : 0;
  const t = nowIso(now);
  const { changes } = await db.run('UPDATE products SET out_of_stock = ?, updated_at = ? WHERE id = ? AND out_of_stock <> ?', flag, t, id, flag);
  if (changes) {
    await db.batch([
      flag
        ? ['INSERT INTO stockouts (product_id, started_at, started_by) VALUES (?, ?, ?)', id, t, by ?? null]
        : ['UPDATE stockouts SET ended_at = ?, ended_by = ? WHERE product_id = ? AND ended_at IS NULL', t, by ?? null, id],
      auditStmt({ actor: by, entity: 'producto', entityId: id, action: flag ? 'agotado en almacén' : 'disponible en almacén', now }),
    ]);
  }
  return getProduct(db, id);
}

// ---------------------------------------------------------------- noches

export function findSession(db, date) {
  return db.get('SELECT * FROM sessions WHERE business_date = ?', date);
}

export async function ensureSession(db, date, now) {
  await db.run('INSERT OR IGNORE INTO sessions (business_date, created_at) VALUES (?, ?)', date, nowIso(now));
  return findSession(db, date);
}

export async function updateSession(db, id, { same_level, notes }, { by, now } = {}) {
  const before = await db.get('SELECT * FROM sessions WHERE id = ?', id);
  if (!before) throw notFound('Noche');
  const sl = same_level === undefined ? before.same_level : same_level === null ? null : same_level ? 1 : 0;
  const nt = notes === undefined ? before.notes : clean(notes, 500);
  await db.batch([
    ['UPDATE sessions SET same_level = ?, notes = ? WHERE id = ?', sl, nt, id],
    auditStmt({
      actor: by, entity: 'noche', entityId: id, action: 'modificar',
      before: { same_level: before.same_level, notes: before.notes }, after: { same_level: sl, notes: nt }, now,
    }),
  ]);
  return db.get('SELECT * FROM sessions WHERE id = ?', id);
}

export function listSessions(db, { from, to }) {
  return db.all(`
    SELECT s.*,
      COALESCE((SELECT SUM(qty) FROM deliveries d WHERE d.session_id = s.id), 0) AS delivered,
      COALESCE((SELECT SUM(MAX(0, l.qty_requested - l.qty_cancelled -
        COALESCE((SELECT SUM(qty) FROM deliveries d WHERE d.line_id = l.id), 0)))
        FROM request_lines l WHERE l.session_id = s.id), 0) AS unserved
    FROM sessions s
    WHERE s.business_date BETWEEN ? AND ?
    ORDER BY s.business_date DESC`, from, to);
}

// ---------------------------------------------------------------- solicitudes

const DELIVERED = 'COALESCE((SELECT SUM(qty) FROM deliveries d WHERE d.line_id = l.id), 0)';
const PENDING = `(l.qty_requested - l.qty_cancelled - ${DELIVERED})`;

const LINE_SELECT = `
  SELECT l.*, p.name AS product_name, p.photo, p.category, p.out_of_stock, p.status AS product_status,
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

/**
 * Añade botellas a la lista de la noche actual. Si ya hay una línea abierta
 * del mismo producto para la misma barra, se suma a ella en lugar de crear
 * otra: así la lista no se duplica y se ve de un vistazo lo que falta.
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
  const openLines = (await db.all(`${LINE_SELECT} WHERE l.session_id = ? AND l.bar_id = ? ORDER BY l.id DESC`, session.id, barId))
    .map(withPending).filter((l) => l.qty_pending > 0);
  const t = nowIso(now);
  const who = clean(by);
  const stmts = [];
  for (const w of wanted) {
    const open = openLines.find((l) => l.product_id === w.product_id);
    if (open) {
      stmts.push(['UPDATE request_lines SET qty_requested = qty_requested + ?, updated_at = ? WHERE id = ?', w.qty, t, open.id]);
    } else {
      stmts.push([`INSERT INTO request_lines (session_id, bar_id, product_id, qty_requested, created_at, updated_at, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?)`, session.id, barId, w.product_id, w.qty, t, t, who]);
    }
    stmts.push(auditStmt({
      actor: who, entity: 'solicitud', entityId: open?.id ?? null, action: 'pedir',
      after: { producto: products[w.product_id].name, barra: barId, botellas: w.qty }, now,
    }));
  }
  await db.batch(stmts);
  return { ok: true, bottles: wanted.reduce((a, w) => a + w.qty, 0) };
}

/**
 * «Hecho»: da por repuesta toda la lista de una vez. Para cada línea se registra
 * lo indicado (por defecto, todo lo que faltaba). Cada entrega es una sentencia
 * condicional que solo se aplica si la línea sigue como la vio quien repone
 * (mismas botellas ya entregadas) y aún faltan al menos esas botellas. Así, si
 * dos personas pulsan «Hecho» a la vez, solo cuenta una; y lo que se pida
 * después de abrir la lista sigue pendiente.
 */
export async function completeLines(db, { items, by }, { now } = {}) {
  if (!Array.isArray(items) || !items.length) throw bad('No hay nada que completar.');
  if (items.length > 40) throw bad('Demasiadas líneas de una vez: completa por barras.');
  const t = nowIso(now);
  const who = clean(by);
  const wanted = items.map((i) => ({
    line_id: Number(i.line_id),
    qty: posInt(i.qty, 'Cantidad', { allowZero: true }),
    delivered: posInt(i.delivered ?? 0, 'Entregadas', { allowZero: true }),
  })).filter((i) => i.qty > 0);
  if (!wanted.length) throw bad('No hay nada que completar.');
  const results = await db.batch(wanted.map((w) => [`INSERT INTO deliveries
      (session_id, bar_id, product_id, line_id, qty, delivered_at, delivered_by, source)
    SELECT l.session_id, l.bar_id, l.product_id, l.id, ?, ?, ?, 'lista' FROM request_lines l
    WHERE l.id = ? AND ${DELIVERED} = ? AND ${PENDING} >= ?`, w.qty, t, who, w.line_id, w.delivered, w.qty]));
  const done = wanted.filter((_, i) => results[i].changes > 0);
  if (!done.length) return { lines: 0, bottles: 0 };
  const marks = done.map(() => '?').join(', ');
  const names = Object.fromEntries((await db.all(`SELECT l.id, l.bar_id, p.name FROM request_lines l
    JOIN products p ON p.id = l.product_id WHERE l.id IN (${marks})`, ...done.map((d) => d.line_id))).map((r) => [r.id, r]));
  await db.batch([
    [`UPDATE request_lines SET claimed_by = NULL, claimed_at = NULL WHERE id IN (${marks})`, ...done.map((d) => d.line_id)],
    auditStmt({
      actor: who, entity: 'reposicion', action: 'hecho',
      after: done.map((d) => ({ producto: names[d.line_id]?.name, barra: names[d.line_id]?.bar_id, botellas: d.qty })), now,
    }),
  ]);
  return { lines: done.length, bottles: done.reduce((a, d) => a + d.qty, 0) };
}

export async function deliver(db, lineId, { qty, by }, { now } = {}) {
  const n = posInt(qty, 'Cantidad');
  // Una sola sentencia: solo inserta si quedan al menos n pendientes.
  const { changes, lastId } = await db.run(`INSERT INTO deliveries
      (session_id, bar_id, product_id, line_id, qty, delivered_at, delivered_by, source)
    SELECT l.session_id, l.bar_id, l.product_id, l.id, ?, ?, ?, 'lista' FROM request_lines l
    WHERE l.id = ? AND ${PENDING} >= ?`, n, nowIso(now), clean(by), lineId, n);
  const line = await getLine(db, lineId);
  if (!changes) {
    if (line.qty_pending === 0) throw new HttpError(409, 'Esta línea ya está completa: otra persona la ha entregado.');
    throw new HttpError(409, `Solo quedan ${line.qty_pending} pendiente(s): otra persona ha entregado parte.`);
  }
  const stmts = [auditStmt({
    actor: clean(by), entity: 'reposicion', entityId: lastId, action: 'entregar',
    after: { producto: line.product_name, barra: line.bar_id, botellas: n }, now,
  })];
  if (line.qty_pending === 0 && line.claimed_by) {
    stmts.push(['UPDATE request_lines SET claimed_by = NULL, claimed_at = NULL WHERE id = ?', lineId]);
  }
  await db.batch(stmts);
  return { ...line, claimed_by: line.qty_pending === 0 ? null : line.claimed_by };
}

/** "Voy yo": avisa al resto de que alguien ya está llevando esa línea. */
export async function claimLine(db, lineId, { by, release = false }, { now } = {}) {
  if (release) {
    await db.run('UPDATE request_lines SET claimed_by = NULL, claimed_at = NULL WHERE id = ?', lineId);
    return getLine(db, lineId);
  }
  const who = clean(by) || 'Alguien';
  const { changes } = await db.run(`UPDATE request_lines SET claimed_by = ?, claimed_at = ?
    WHERE id = ? AND (claimed_by IS NULL OR claimed_by = ?)`, who, nowIso(now), lineId, who);
  const line = await getLine(db, lineId);
  if (!changes) throw new HttpError(409, `${line.claimed_by} ya la está llevando.`);
  return line;
}

/** Retira botellas pendientes que ya no hacen falta (pedidas por error, etc.). */
export async function cancelPending(db, lineId, { qty, by, reason }, { now } = {}) {
  const before = await getLine(db, lineId);
  const n = qty === undefined ? before.qty_pending : posInt(qty, 'Cantidad');
  const { changes } = n > 0
    ? await db.run(`UPDATE request_lines AS l SET qty_cancelled = qty_cancelled + ?, updated_at = ?
        WHERE l.id = ? AND ${PENDING} >= ?`, n, nowIso(now), lineId, n)
    : { changes: 0 };
  if (!changes) throw new HttpError(409, 'No hay tantas botellas pendientes.');
  await audit(db, {
    actor: clean(by), entity: 'solicitud', entityId: lineId, action: 'anular pendiente',
    after: { producto: before.product_name, barra: before.bar_id, botellas: n }, reason: clean(reason, 200), now,
  });
  return getLine(db, lineId);
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
  const d = await getDelivery(db, id);
  const { changes } = await db.run(`UPDATE deliveries SET qty = 0, corrected = 1
    WHERE id = ? AND source = 'lista' AND corrected = 0 AND qty > 0 AND delivered_at >= ?`, id, limit);
  if (!changes) {
    if (d.source !== 'lista' || d.corrected || d.qty === 0) throw new HttpError(409, 'Esta entrega ya no se puede deshacer desde la lista.');
    throw new HttpError(409, `Solo se puede deshacer durante ${minutes} minutos. Pide al encargado que la corrija.`);
  }
  await audit(db, {
    actor: clean(by), entity: 'reposicion', entityId: id, action: 'deshacer',
    before: { botellas: d.qty }, after: { botellas: 0 }, reason: 'Deshecho desde la lista', now,
  });
  return getDelivery(db, id);
}

// ---------------------------------------------------------------- lista en vivo

export async function liveState(db, { now } = {}) {
  const s = await getSettings(db);
  const settings = toPublic(s);
  const date = businessDate(now ?? new Date(), s.timezone, Number(s.cutoff_hour));
  const session = await findSession(db, date);
  const out = (await db.all('SELECT id FROM products WHERE out_of_stock = 1')).map((r) => r.id);
  if (!session) return { date, session: null, lines: [], recent: [], settings, outOfStock: out };
  const lines = (await db.all(`${LINE_SELECT} WHERE l.session_id = ? ORDER BY l.created_at, l.id`, session.id)).map(withPending);
  const t = (now ?? new Date()).getTime();
  const recent = (await db.all(`SELECT d.*, p.name AS product_name FROM deliveries d
    JOIN products p ON p.id = d.product_id
    WHERE d.session_id = ? ORDER BY d.delivered_at DESC, d.id DESC LIMIT 30`, session.id))
    .map((d) => ({
      ...d,
      can_undo: d.source === 'lista' && !d.corrected && d.qty > 0
        && (t - new Date(d.delivered_at).getTime()) / 60000 <= settings.undo_minutes,
    }));
  return { date, session, lines, recent, settings, outOfStock: out };
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
  const d = await getDelivery(db, id);
  const next = {
    qty: qty === undefined ? d.qty : posInt(qty, 'Cantidad', { allowZero: true }),
    bar_id: bar_id === undefined ? d.bar_id : Number(bar_id),
    product_id: product_id === undefined ? d.product_id : Number(product_id),
  };
  await barExists(db, next.bar_id);
  const p = await getProduct(db, next.product_id);
  // Si cambia la barra o el producto deja de corresponder a su línea de solicitud.
  const lineId = next.bar_id !== d.bar_id || next.product_id !== d.product_id ? null : d.line_id;
  await db.batch([
    ['UPDATE deliveries SET qty = ?, bar_id = ?, product_id = ?, line_id = ?, corrected = 1 WHERE id = ?',
      next.qty, next.bar_id, next.product_id, lineId, id],
    auditStmt({
      actor: clean(by), entity: 'reposicion', entityId: id, action: 'corregir',
      before: { botellas: d.qty, barra: d.bar_id, producto: d.product_name },
      after: { botellas: next.qty, barra: next.bar_id, producto: p.name },
      reason: why, now,
    }),
  ]);
  return getDelivery(db, id);
}

/** Registrar a posteriori una reposición que no se anotó en su momento. */
export async function addManualDelivery(db, { date, bar_id, product_id, qty, reason, by }, { now } = {}) {
  if (!isYmd(date)) throw bad('Fecha no válida.');
  const why = clean(reason, 300);
  if (!why) throw bad('Indica el motivo.');
  const n = posInt(qty, 'Cantidad');
  const barId = Number(bar_id);
  await barExists(db, barId);
  const p = await getProduct(db, Number(product_id));
  const s = await ensureSession(db, date, now);
  const { lastId } = await db.run(`INSERT INTO deliveries
    (session_id, bar_id, product_id, qty, delivered_at, delivered_by, source, corrected)
    VALUES (?, ?, ?, ?, ?, ?, 'manual', 1)`, s.id, barId, p.id, n, nowIso(now), clean(by));
  await audit(db, {
    actor: clean(by), entity: 'reposicion', entityId: lastId, action: 'añadir a posteriori',
    after: { noche: date, producto: p.name, barra: barId, botellas: n }, reason: why, now,
  });
  return getDelivery(db, lastId);
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

async function stockoutNightsFor(db, dates) {
  const out = {};
  if (!dates.length) return out;
  const s = await getSettings(db);
  const dateOf = (iso) => businessDate(new Date(iso), s.timezone, Number(s.cutoff_hour));
  const first = dates.reduce((a, b) => (a < b ? a : b));
  for (const so of await db.all('SELECT * FROM stockouts')) {
    const start = dateOf(so.started_at);
    const end = so.ended_at ? dateOf(so.ended_at) : '9999-12-31';
    if (end < first) continue;
    for (const d of dates) {
      if (d >= start && d <= end) out[so.product_id] = (out[so.product_id] || 0) + 1;
    }
  }
  return out;
}

function aggregate(db, from, to, barId) {
  const cond = barId ? 'AND d.bar_id = ?' : '';
  const args = barId ? [from, to, barId] : [from, to];
  return db.all(`SELECT d.product_id, d.bar_id, s.business_date AS date, SUM(d.qty) AS qty
    FROM deliveries d JOIN sessions s ON s.id = d.session_id
    WHERE s.business_date BETWEEN ? AND ? AND d.qty > 0 ${cond}
    GROUP BY d.product_id, d.bar_id, s.business_date`, ...args);
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
  const t = nowIso(now);
  const norm = await normalizeLines(db, lines);
  const st = status === 'cerrada' ? 'cerrada' : 'borrador';
  const ttl = clean(title, 120) || 'Lista de compra';
  if (id) {
    const before = await getPurchase(db, id);
    await db.batch([
      ['UPDATE purchase_lists SET title = ?, status = ?, params = ?, lines = ?, notes = ?, updated_at = ? WHERE id = ?',
        ttl, st, JSON.stringify(params ?? before.params), JSON.stringify(norm), clean(notes, 1000), t, id],
      auditStmt({ actor: by, entity: 'compra', entityId: id, action: 'modificar', after: { title: ttl, status: st }, now }),
    ]);
    return getPurchase(db, id);
  }
  const { lastId } = await db.run(`INSERT INTO purchase_lists (title, status, params, lines, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`, ttl, st, JSON.stringify(params ?? {}), JSON.stringify(norm), clean(notes, 1000), t, t);
  await audit(db, { actor: by, entity: 'compra', entityId: lastId, action: 'crear', after: { title: ttl }, now });
  return getPurchase(db, lastId);
}

export async function deletePurchase(db, id, { by, now } = {}) {
  const p = await getPurchase(db, id);
  await db.batch([
    ['DELETE FROM purchase_lists WHERE id = ?', id],
    auditStmt({ actor: by, entity: 'compra', entityId: id, action: 'borrar', before: { title: p.title }, now }),
  ]);
}

// ---------------------------------------------------------------- copia de seguridad

const BACKUP_TABLES = ['settings', 'bars', 'products', 'sessions', 'request_lines', 'deliveries',
  'stockouts', 'audit', 'purchase_lists'];

/** Copia completa de los datos en JSON (sin los códigos de acceso ni las fotos propias). */
export async function exportData(db, { now } = {}) {
  const out = { exported_at: nowIso(now), tables: {} };
  for (const t of BACKUP_TABLES) out.tables[t] = await db.all(`SELECT * FROM ${t}`);
  out.tables.settings = out.tables.settings.filter((r) => !['staff_code', 'manager_pin'].includes(r.key));
  return out;
}
