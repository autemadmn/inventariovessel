// Lógica de negocio sobre la base de datos. Todas las funciones son síncronas:
// node:sqlite es síncrono y Node ejecuta cada petición de principio a fin sin
// intercalar otras, así que comprobar "lo que falta" y registrar la entrega es
// atómico. Eso impide que dos personas entreguen la misma botella pendiente.

import { CATEGORIES } from './catalog.js';
import { DEFAULT_SETTINGS } from './db.js';
import {
  addDays, businessDate, datesBetween, isYmd, periodRange, previousPeriodDate, weekday,
} from './dates.js';
import { computeForecast, computePurchase } from './forecast.js';

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

function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function audit(db, { actor, entity, entityId, action, before, after, reason, now }) {
  db.prepare(`INSERT INTO audit (at, actor, entity, entity_id, action, before, after, reason)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    nowIso(now), actor ?? null, entity, entityId ?? null, action,
    before === undefined ? null : JSON.stringify(before),
    after === undefined ? null : JSON.stringify(after),
    reason ?? null,
  );
}

// ---------------------------------------------------------------- ajustes

export function getSettings(db) {
  const out = { ...DEFAULT_SETTINGS };
  for (const { key, value } of db.prepare('SELECT key, value FROM settings').all()) out[key] = value;
  return out;
}

export function publicSettings(db) {
  const s = getSettings(db);
  return {
    timezone: s.timezone,
    cutoff_hour: Number(s.cutoff_hour),
    safety_pct: Number(s.safety_pct),
    low_data_nights: Number(s.low_data_nights),
    min_nights_per_weekday: Number(s.min_nights_per_weekday),
    undo_minutes: Number(s.undo_minutes),
  };
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

export function updateSettings(db, patch, { by, now } = {}) {
  return tx(db, () => {
    const before = getSettings(db);
    const up = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    const changed = {};
    for (const [k, fn] of Object.entries(EDITABLE_SETTINGS)) {
      if (patch[k] === undefined) continue;
      const v = fn(patch[k]);
      if (v !== before[k]) {
        up.run(k, v);
        changed[k] = v;
      }
    }
    if (patch.bars) {
      for (const bar of patch.bars) {
        const name = clean(bar.name, 40);
        if (!name) throw bad('El nombre de la barra no puede estar vacío.');
        db.prepare('UPDATE bars SET name = ? WHERE id = ?').run(name, bar.id);
      }
      changed.bars = patch.bars;
    }
    if (Object.keys(changed).length) {
      const hide = (o) => ({ ...o, staff_code: o.staff_code ? '••••' : '', manager_pin: o.manager_pin ? '••••' : '' });
      audit(db, { actor: by, entity: 'ajustes', action: 'modificar', before: hide(before), after: hide(changed), now });
    }
    return publicSettings(db);
  });
}

export function currentDate(db, now = new Date()) {
  const s = getSettings(db);
  return businessDate(now, s.timezone, Number(s.cutoff_hour));
}

function dateOf(db, iso) {
  const s = getSettings(db);
  return businessDate(new Date(iso), s.timezone, Number(s.cutoff_hour));
}

// ---------------------------------------------------------------- catálogo

export function listBars(db) {
  return db.prepare('SELECT id, name FROM bars ORDER BY id').all();
}

function barExists(db, id) {
  if (!db.prepare('SELECT 1 FROM bars WHERE id = ?').get(id)) throw bad('Barra no válida.');
}

export function listProducts(db, { all = false } = {}) {
  const where = all ? '' : "WHERE active = 1 AND status IN ('confirmado', 'pendiente')";
  return db.prepare(`SELECT * FROM products ${where} ORDER BY sort, name`).all();
}

function getProduct(db, id) {
  const p = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
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
  const status = out.status ?? existing.status;
  if (out.active === 1 && ['sin_identificar', 'descartado'].includes(status)) {
    throw bad('Identifica el producto antes de activarlo.');
  }
  return out;
}

export function createProduct(db, input, { by, now } = {}) {
  const f = productFields({ status: 'pendiente', category: 'otros', active: true, ...input });
  if (!f.name) throw bad('El nombre es obligatorio.');
  const { m } = db.prepare('SELECT COALESCE(MAX(sort), 0) AS m FROM products').get();
  const t = nowIso(now);
  const { lastInsertRowid } = db.prepare(`INSERT INTO products
    (name, category, status, note, capacity_ml, per_case, active, sort, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    f.name, f.category, f.status, f.note ?? null, f.capacity_ml ?? null, f.per_case ?? null,
    f.active ?? 1, f.sort ?? m + 10, t, t,
  );
  const p = getProduct(db, Number(lastInsertRowid));
  audit(db, { actor: by, entity: 'producto', entityId: p.id, action: 'crear', after: p, now });
  return p;
}

export function updateProduct(db, id, input, { by, now, reason } = {}) {
  return tx(db, () => {
    const before = getProduct(db, id);
    const f = productFields(input, before);
    const keys = Object.keys(f).filter((k) => f[k] !== before[k]);
    if (!keys.length) return before;
    db.prepare(`UPDATE products SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
      .run(...keys.map((k) => f[k]), nowIso(now), id);
    const after = getProduct(db, id);
    audit(db, {
      actor: by, entity: 'producto', entityId: id, action: 'modificar',
      before: Object.fromEntries(keys.map((k) => [k, before[k]])),
      after: Object.fromEntries(keys.map((k) => [k, after[k]])),
      reason, now,
    });
    return after;
  });
}

export function setProductPhoto(db, id, photo, { by, now } = {}) {
  const before = getProduct(db, id);
  db.prepare('UPDATE products SET photo = ?, updated_at = ? WHERE id = ?').run(photo, nowIso(now), id);
  audit(db, {
    actor: by, entity: 'producto', entityId: id, action: photo ? 'foto' : 'quitar foto',
    before: { photo: before.photo }, after: { photo }, now,
  });
  return { previous: before.photo, product: getProduct(db, id) };
}

/**
 * Resolver una botella sin identificar: o bien es un producto nuevo (se
 * activa con el nombre confirmado) o bien es un producto que ya existe (se
 * descarta indicando cuál, sin crear duplicados).
 */
export function resolveUnidentified(db, id, { action, target_id, name, category }, { by, now } = {}) {
  const p = getProduct(db, id);
  if (p.status !== 'sin_identificar') throw bad('Este producto ya está identificado.');
  if (action === 'duplicate') {
    const target = getProduct(db, Number(target_id));
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

export function setOutOfStock(db, id, out, { by, now } = {}) {
  return tx(db, () => {
    const p = getProduct(db, id);
    const flag = out ? 1 : 0;
    if (p.out_of_stock === flag) return p;
    const t = nowIso(now);
    db.prepare('UPDATE products SET out_of_stock = ?, updated_at = ? WHERE id = ?').run(flag, t, id);
    if (flag) {
      db.prepare('INSERT INTO stockouts (product_id, started_at, started_by) VALUES (?, ?, ?)').run(id, t, by ?? null);
    } else {
      db.prepare('UPDATE stockouts SET ended_at = ?, ended_by = ? WHERE product_id = ? AND ended_at IS NULL').run(t, by ?? null, id);
    }
    audit(db, {
      actor: by, entity: 'producto', entityId: id,
      action: flag ? 'agotado en almacén' : 'disponible en almacén', now,
    });
    return getProduct(db, id);
  });
}

// ---------------------------------------------------------------- noches

export function findSession(db, date) {
  return db.prepare('SELECT * FROM sessions WHERE business_date = ?').get(date) ?? null;
}

export function ensureSession(db, date, now) {
  let s = findSession(db, date);
  if (!s) {
    db.prepare('INSERT INTO sessions (business_date, created_at) VALUES (?, ?)').run(date, nowIso(now));
    s = findSession(db, date);
  }
  return s;
}

export function updateSession(db, id, { same_level, notes }, { by, now } = {}) {
  const before = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
  if (!before) throw notFound('Noche');
  const sl = same_level === undefined ? before.same_level : same_level === null ? null : same_level ? 1 : 0;
  const nt = notes === undefined ? before.notes : clean(notes, 500);
  db.prepare('UPDATE sessions SET same_level = ?, notes = ? WHERE id = ?').run(sl, nt, id);
  audit(db, {
    actor: by, entity: 'noche', entityId: id, action: 'modificar',
    before: { same_level: before.same_level, notes: before.notes }, after: { same_level: sl, notes: nt }, now,
  });
  return db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
}

export function listSessions(db, { from, to }) {
  return db.prepare(`
    SELECT s.*,
      COALESCE((SELECT SUM(qty) FROM deliveries d WHERE d.session_id = s.id), 0) AS delivered,
      COALESCE((SELECT SUM(MAX(0, l.qty_requested - l.qty_cancelled -
        COALESCE((SELECT SUM(qty) FROM deliveries d WHERE d.line_id = l.id), 0)))
        FROM request_lines l WHERE l.session_id = s.id), 0) AS unserved
    FROM sessions s
    WHERE s.business_date BETWEEN ? AND ?
    ORDER BY s.business_date DESC`).all(from, to);
}

// ---------------------------------------------------------------- solicitudes

const LINE_SELECT = `
  SELECT l.*, p.name AS product_name, p.photo, p.category, p.out_of_stock, p.status AS product_status,
    COALESCE((SELECT SUM(qty) FROM deliveries d WHERE d.line_id = l.id), 0) AS qty_delivered
  FROM request_lines l JOIN products p ON p.id = l.product_id`;

function withPending(l) {
  return { ...l, qty_pending: Math.max(0, l.qty_requested - l.qty_cancelled - l.qty_delivered) };
}

function getLine(db, id) {
  const l = db.prepare(`${LINE_SELECT} WHERE l.id = ?`).get(id);
  if (!l) throw notFound('Línea');
  return withPending(l);
}

/**
 * Añade botellas a la lista de la noche actual. Si ya hay una línea abierta
 * del mismo producto para la misma barra, se suma a ella en lugar de crear
 * otra: así la lista no se duplica y se ve de un vistazo lo que falta.
 */
export function createRequest(db, { bar_id, items, by }, { now } = {}) {
  const barId = Number(bar_id);
  barExists(db, barId);
  if (!Array.isArray(items) || !items.length) throw bad('La solicitud está vacía.');
  return tx(db, () => {
    const session = ensureSession(db, currentDate(db, now), now);
    const t = nowIso(now);
    const out = [];
    for (const item of items) {
      const qty = posInt(item.qty, 'Cantidad');
      const p = getProduct(db, Number(item.product_id));
      if (!p.active) throw bad(`${p.name} no está disponible en el catálogo.`);
      const open = db.prepare(`${LINE_SELECT} WHERE l.session_id = ? AND l.bar_id = ? AND l.product_id = ?
        ORDER BY l.id DESC`).all(session.id, barId, p.id).map(withPending).find((l) => l.qty_pending > 0);
      let lineId;
      if (open) {
        db.prepare('UPDATE request_lines SET qty_requested = qty_requested + ?, updated_at = ? WHERE id = ?')
          .run(qty, t, open.id);
        lineId = open.id;
      } else {
        lineId = Number(db.prepare(`INSERT INTO request_lines
          (session_id, bar_id, product_id, qty_requested, created_at, updated_at, created_by)
          VALUES (?, ?, ?, ?, ?, ?, ?)`).run(session.id, barId, p.id, qty, t, t, clean(by)).lastInsertRowid);
      }
      audit(db, {
        actor: clean(by), entity: 'solicitud', entityId: lineId, action: 'pedir',
        after: { producto: p.name, barra: barId, botellas: qty }, now,
      });
      out.push(getLine(db, lineId));
    }
    return out;
  });
}

export function deliver(db, lineId, { qty, by }, { now } = {}) {
  const n = posInt(qty, 'Cantidad');
  return tx(db, () => {
    const line = getLine(db, lineId);
    if (line.qty_pending === 0) throw new HttpError(409, 'Esta línea ya está completa: otra persona la ha entregado.');
    if (n > line.qty_pending) {
      throw new HttpError(409, `Solo quedan ${line.qty_pending} pendiente(s): otra persona ha entregado parte.`);
    }
    const { lastInsertRowid } = db.prepare(`INSERT INTO deliveries
      (session_id, bar_id, product_id, line_id, qty, delivered_at, delivered_by, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'lista')`).run(line.session_id, line.bar_id, line.product_id, line.id, n, nowIso(now), clean(by));
    audit(db, {
      actor: clean(by), entity: 'reposicion', entityId: Number(lastInsertRowid), action: 'entregar',
      after: { producto: line.product_name, barra: line.bar_id, botellas: n }, now,
    });
    const updated = getLine(db, lineId);
    if (updated.qty_pending === 0 && updated.claimed_by) {
      db.prepare('UPDATE request_lines SET claimed_by = NULL, claimed_at = NULL WHERE id = ?').run(lineId);
    }
    return getLine(db, lineId);
  });
}

/** "Voy yo": avisa al resto de que alguien ya está llevando esa línea. */
export function claimLine(db, lineId, { by, release = false }, { now } = {}) {
  const line = getLine(db, lineId);
  if (release) {
    db.prepare('UPDATE request_lines SET claimed_by = NULL, claimed_at = NULL WHERE id = ?').run(lineId);
  } else {
    const who = clean(by) || 'Alguien';
    if (line.claimed_by && line.claimed_by !== who) {
      throw new HttpError(409, `${line.claimed_by} ya la está llevando.`);
    }
    db.prepare('UPDATE request_lines SET claimed_by = ?, claimed_at = ? WHERE id = ?').run(who, nowIso(now), lineId);
  }
  return getLine(db, lineId);
}

/** Retira botellas pendientes que ya no hacen falta (pedidas por error, etc.). */
export function cancelPending(db, lineId, { qty, by, reason }, { now } = {}) {
  return tx(db, () => {
    const line = getLine(db, lineId);
    const n = qty === undefined ? line.qty_pending : posInt(qty, 'Cantidad');
    if (n === 0 || n > line.qty_pending) throw new HttpError(409, 'No hay tantas botellas pendientes.');
    db.prepare('UPDATE request_lines SET qty_cancelled = qty_cancelled + ?, updated_at = ? WHERE id = ?')
      .run(n, nowIso(now), lineId);
    audit(db, {
      actor: clean(by), entity: 'solicitud', entityId: lineId, action: 'anular pendiente',
      after: { producto: line.product_name, barra: line.bar_id, botellas: n }, reason: clean(reason, 200), now,
    });
    return getLine(db, lineId);
  });
}

function getDelivery(db, id) {
  const d = db.prepare(`SELECT d.*, p.name AS product_name, s.business_date FROM deliveries d
    JOIN products p ON p.id = d.product_id JOIN sessions s ON s.id = d.session_id WHERE d.id = ?`).get(id);
  if (!d) throw notFound('Reposición');
  return d;
}

/** Deshacer una entrega recién hecha desde la lista (p. ej. pulsación por error). */
export function undoDelivery(db, id, { by }, { now } = {}) {
  return tx(db, () => {
    const d = getDelivery(db, id);
    const minutes = Number(getSettings(db).undo_minutes);
    const age = ((now ?? new Date()) - new Date(d.delivered_at)) / 60000;
    if (d.source !== 'lista' || d.corrected || d.qty === 0) throw new HttpError(409, 'Esta entrega ya no se puede deshacer desde la lista.');
    if (age > minutes) throw new HttpError(409, `Solo se puede deshacer durante ${minutes} minutos. Pide al encargado que la corrija.`);
    db.prepare('UPDATE deliveries SET qty = 0, corrected = 1 WHERE id = ?').run(id);
    audit(db, {
      actor: clean(by), entity: 'reposicion', entityId: id, action: 'deshacer',
      before: { botellas: d.qty }, after: { botellas: 0 }, reason: 'Deshecho desde la lista', now,
    });
    return getDelivery(db, id);
  });
}

// ---------------------------------------------------------------- lista en vivo

export function liveState(db, { now } = {}) {
  const date = currentDate(db, now);
  const session = findSession(db, date);
  const settings = publicSettings(db);
  if (!session) return { date, session: null, lines: [], recent: [], settings };
  const lines = db.prepare(`${LINE_SELECT} WHERE l.session_id = ? ORDER BY l.created_at, l.id`)
    .all(session.id).map(withPending);
  const t = (now ?? new Date()).getTime();
  const recent = db.prepare(`SELECT d.*, p.name AS product_name FROM deliveries d
    JOIN products p ON p.id = d.product_id
    WHERE d.session_id = ? ORDER BY d.delivered_at DESC, d.id DESC LIMIT 30`).all(session.id)
    .map((d) => ({
      ...d,
      can_undo: d.source === 'lista' && !d.corrected && d.qty > 0
        && (t - new Date(d.delivered_at).getTime()) / 60000 <= settings.undo_minutes,
    }));
  return { date, session, lines, recent, settings };
}

// ---------------------------------------------------------------- historial y correcciones

export function listDeliveries(db, { from, to, bar_id, product_id }) {
  const cond = ['s.business_date BETWEEN ? AND ?'];
  const args = [from, to];
  if (bar_id) { cond.push('d.bar_id = ?'); args.push(Number(bar_id)); }
  if (product_id) { cond.push('d.product_id = ?'); args.push(Number(product_id)); }
  return db.prepare(`SELECT d.*, p.name AS product_name, s.business_date FROM deliveries d
    JOIN products p ON p.id = d.product_id JOIN sessions s ON s.id = d.session_id
    WHERE ${cond.join(' AND ')} ORDER BY d.delivered_at DESC, d.id DESC LIMIT 1000`).all(...args);
}

/**
 * Corregir una reposición ya registrada. Nunca se borra: se modifica y queda
 * constancia en el registro de cambios (antes, después, motivo y quién).
 */
export function correctDelivery(db, id, { qty, bar_id, product_id, reason, by }, { now } = {}) {
  const why = clean(reason, 300);
  if (!why) throw bad('Indica el motivo de la corrección.');
  return tx(db, () => {
    const d = getDelivery(db, id);
    const next = {
      qty: qty === undefined ? d.qty : posInt(qty, 'Cantidad', { allowZero: true }),
      bar_id: bar_id === undefined ? d.bar_id : Number(bar_id),
      product_id: product_id === undefined ? d.product_id : Number(product_id),
    };
    barExists(db, next.bar_id);
    getProduct(db, next.product_id);
    // Si cambia la barra o el producto deja de corresponder a su línea de solicitud.
    const lineId = next.bar_id !== d.bar_id || next.product_id !== d.product_id ? null : d.line_id;
    db.prepare('UPDATE deliveries SET qty = ?, bar_id = ?, product_id = ?, line_id = ?, corrected = 1 WHERE id = ?')
      .run(next.qty, next.bar_id, next.product_id, lineId, id);
    const after = getDelivery(db, id);
    audit(db, {
      actor: clean(by), entity: 'reposicion', entityId: id, action: 'corregir',
      before: { botellas: d.qty, barra: d.bar_id, producto: d.product_name },
      after: { botellas: after.qty, barra: after.bar_id, producto: after.product_name },
      reason: why, now,
    });
    return after;
  });
}

/** Registrar a posteriori una reposición que no se anotó en su momento. */
export function addManualDelivery(db, { date, bar_id, product_id, qty, reason, by }, { now } = {}) {
  if (!isYmd(date)) throw bad('Fecha no válida.');
  const why = clean(reason, 300);
  if (!why) throw bad('Indica el motivo.');
  const n = posInt(qty, 'Cantidad');
  const barId = Number(bar_id);
  barExists(db, barId);
  const p = getProduct(db, Number(product_id));
  return tx(db, () => {
    const s = ensureSession(db, date, now);
    const { lastInsertRowid } = db.prepare(`INSERT INTO deliveries
      (session_id, bar_id, product_id, qty, delivered_at, delivered_by, source, corrected)
      VALUES (?, ?, ?, ?, ?, ?, 'manual', 1)`).run(s.id, barId, p.id, n, nowIso(now), clean(by));
    audit(db, {
      actor: clean(by), entity: 'reposicion', entityId: Number(lastInsertRowid), action: 'añadir a posteriori',
      after: { noche: date, producto: p.name, barra: barId, botellas: n }, reason: why, now,
    });
    return getDelivery(db, Number(lastInsertRowid));
  });
}

export function listAudit(db, { limit = 200, entity, entity_id } = {}) {
  const cond = [];
  const args = [];
  if (entity) { cond.push('entity = ?'); args.push(entity); }
  if (entity_id) { cond.push('entity_id = ?'); args.push(Number(entity_id)); }
  const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
  return db.prepare(`SELECT * FROM audit ${where} ORDER BY id DESC LIMIT ?`)
    .all(...args, Math.min(Number(limit) || 200, 1000))
    .map((a) => ({ ...a, before: a.before && JSON.parse(a.before), after: a.after && JSON.parse(a.after) }));
}

// ---------------------------------------------------------------- informes

function stockoutNightsFor(db, dates) {
  const out = {};
  if (!dates.length) return out;
  const set = new Set(dates);
  const first = dates.reduce((a, b) => (a < b ? a : b));
  for (const so of db.prepare('SELECT * FROM stockouts').all()) {
    const start = dateOf(db, so.started_at);
    const end = so.ended_at ? dateOf(db, so.ended_at) : '9999-12-31';
    if (end < first) continue;
    for (const d of set) {
      if (d >= start && d <= end) out[so.product_id] = (out[so.product_id] || 0) + 1;
    }
  }
  return out;
}

function aggregate(db, from, to, barId) {
  const cond = barId ? 'AND d.bar_id = ?' : '';
  const args = barId ? [from, to, barId] : [from, to];
  return db.prepare(`SELECT d.product_id, d.bar_id, s.business_date AS date, SUM(d.qty) AS qty
    FROM deliveries d JOIN sessions s ON s.id = d.session_id
    WHERE s.business_date BETWEEN ? AND ? AND d.qty > 0 ${cond}
    GROUP BY d.product_id, d.bar_id, s.business_date`).all(...args);
}

export function report(db, { period = 'week', date, bar_id } = {}, { now } = {}) {
  if (!['night', 'week', 'month'].includes(period)) throw bad('Periodo no válido.');
  const ref = isYmd(date) ? date : currentDate(db, now);
  const range = periodRange(period, ref);
  const barId = bar_id ? Number(bar_id) : null;

  const rows = aggregate(db, range.from, range.to, barId);
  const sessions = db.prepare('SELECT * FROM sessions WHERE business_date BETWEEN ? AND ? ORDER BY business_date')
    .all(range.from, range.to);

  let prevRange;
  if (period === 'night') {
    const prev = db.prepare('SELECT business_date FROM sessions WHERE business_date < ? ORDER BY business_date DESC LIMIT 1').get(ref);
    prevRange = prev ? periodRange('night', prev.business_date) : null;
  } else {
    prevRange = periodRange(period, previousPeriodDate(period, ref));
  }
  const prevTotals = {};
  if (prevRange) {
    for (const r of aggregate(db, prevRange.from, prevRange.to, barId)) {
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

  const stockouts = stockoutNightsFor(db, sessions.map((s) => s.business_date));
  const unserved = sessions.length ? unservedFor(db, sessions.map((s) => s.id), barId) : {};

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

function unservedFor(db, sessionIds, barId) {
  const out = {};
  const marks = sessionIds.map(() => '?').join(',');
  const cond = barId ? 'AND l.bar_id = ?' : '';
  const lines = db.prepare(`${LINE_SELECT} WHERE l.session_id IN (${marks}) ${cond}`)
    .all(...sessionIds, ...(barId ? [barId] : [])).map(withPending);
  for (const l of lines) if (l.qty_pending) out[l.product_id] = (out[l.product_id] || 0) + l.qty_pending;
  return out;
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
export function forecast(db, params = {}, { now } = {}) {
  const today = currentDate(db, now);
  const s = publicSettings(db);
  const baseTo = isYmd(params.base_to) ? params.base_to : addDays(today, -1);
  const baseFrom = isYmd(params.base_from) ? params.base_from : addDays(baseTo, -55);
  const targetFrom = isYmd(params.target_from) ? params.target_from : today;
  const targetTo = isYmd(params.target_to) ? params.target_to : addDays(targetFrom, 6);
  if (baseFrom > baseTo || targetFrom > targetTo) throw bad('Revisa las fechas: el inicio es posterior al final.');

  const sessions = db.prepare(`SELECT s.* FROM sessions s WHERE s.business_date BETWEEN ? AND ?
    AND (EXISTS (SELECT 1 FROM deliveries d WHERE d.session_id = s.id AND d.qty > 0)
      OR EXISTS (SELECT 1 FROM request_lines l WHERE l.session_id = s.id))
    ORDER BY s.business_date`).all(baseFrom, baseTo);
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

  const deliveries = aggregate(db, baseFrom, baseTo, null)
    .map((r) => ({ product_id: r.product_id, date: r.date, qty: r.qty }));
  const products = listProducts(db);
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
    stockoutNights: stockoutNightsFor(db, baseNights.map((n) => n.date)),
    currentlyOut,
    unserved: sessions.length ? unservedFor(db, sessions.map((x) => x.id)) : {},
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

function normalizeLines(db, lines) {
  if (!Array.isArray(lines)) throw bad('Faltan las líneas de la lista.');
  const products = Object.fromEntries(listProducts(db, { all: true }).map((p) => [p.id, p]));
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
  return db.prepare('SELECT id, title, status, created_at, updated_at FROM purchase_lists ORDER BY id DESC LIMIT 100').all();
}

export function getPurchase(db, id) {
  const p = db.prepare('SELECT * FROM purchase_lists WHERE id = ?').get(id);
  if (!p) throw notFound('Lista de compra');
  return { ...p, params: JSON.parse(p.params), lines: JSON.parse(p.lines) };
}

export function savePurchase(db, id, { title, status, params, lines, notes }, { by, now } = {}) {
  const t = nowIso(now);
  const norm = normalizeLines(db, lines);
  const st = status === 'cerrada' ? 'cerrada' : 'borrador';
  const ttl = clean(title, 120) || 'Lista de compra';
  if (id) {
    const before = getPurchase(db, id);
    db.prepare('UPDATE purchase_lists SET title = ?, status = ?, params = ?, lines = ?, notes = ?, updated_at = ? WHERE id = ?')
      .run(ttl, st, JSON.stringify(params ?? before.params), JSON.stringify(norm), clean(notes, 1000), t, id);
    audit(db, { actor: by, entity: 'compra', entityId: id, action: 'modificar', after: { title: ttl, status: st }, now });
    return getPurchase(db, id);
  }
  const { lastInsertRowid } = db.prepare(`INSERT INTO purchase_lists (title, status, params, lines, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(ttl, st, JSON.stringify(params ?? {}), JSON.stringify(norm), clean(notes, 1000), t, t);
  audit(db, { actor: by, entity: 'compra', entityId: Number(lastInsertRowid), action: 'crear', after: { title: ttl }, now });
  return getPurchase(db, Number(lastInsertRowid));
}

export function deletePurchase(db, id, { by, now } = {}) {
  const p = getPurchase(db, id);
  db.prepare('DELETE FROM purchase_lists WHERE id = ?').run(id);
  audit(db, { actor: by, entity: 'compra', entityId: id, action: 'borrar', before: { title: p.title }, now });
}
