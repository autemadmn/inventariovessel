// Existencias calculadas desde recuentos, movimientos y reposiciones originales.
// No depende de services.js para evitar un ciclo de importación.
import { businessDate } from './dates.js';
import { HttpError } from './errors.js';
import { DEFAULT_SETTINGS } from './schema.js';

const bad = (message) => new HttpError(400, message);
// Mismos límites y limpieza que services.js.
const clean = (s, max = 80) => (typeof s === 'string' ? s.trim().slice(0, max) : '') || null;
const nowIso = (now) => (now ?? new Date()).toISOString();
function posInt(v, what, { allowZero = false } = {}) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < (allowZero ? 0 : 1) || n > 10000) {
    throw bad(`${what}: debe ser un número entero${allowZero ? '' : ' mayor que 0'}.`);
  }
  return n;
}
const ACTIVE_SESSION = `(EXISTS (SELECT 1 FROM request_lines l WHERE l.session_id = s.id)
  OR EXISTS (SELECT 1 FROM deliveries d WHERE d.session_id = s.id AND d.qty > 0))`;

export async function settings(db) {
  const s = { trip_weeks: DEFAULT_SETTINGS.trip_weeks, ...DEFAULT_SETTINGS };
  for (const { key, value } of await db.all('SELECT key, value FROM settings')) s[key] = value;
  return s;
}

export async function storeOf(db, id) {
  const store = id === undefined || id === null || id === ''
    ? await db.get("SELECT id, name, kind, sort FROM stores WHERE kind = 'local' ORDER BY sort, id LIMIT 1")
    : Number.isInteger(Number(id)) ? await db.get('SELECT id, name, kind, sort FROM stores WHERE id = ?', Number(id)) : null;
  if (!store) throw bad('Almacén no válido.');
  return store;
}

// Una consulta para todas las botellas del almacén. El desempate del recuento
// usa id, y las fechas de movimientos/reposiciones se comparan estrictamente.
export async function stockRows(db, store, at = nowIso()) {
  return db.all(`WITH latest AS (
      SELECT DISTINCT ON (product_id) id, product_id, qty, counted_at, counted_by
      FROM stock_counts WHERE store_id = ? AND counted_at <= ?
      ORDER BY product_id, counted_at DESC, id DESC
    ), moves AS (
      SELECT c.product_id,
        SUM(CASE WHEN m.to_store_id = ? THEN m.qty ELSE -m.qty END)::int AS delta
      FROM latest c JOIN stock_moves m ON m.product_id = c.product_id
        AND m.voided = 0 AND m.created_at > c.counted_at AND m.created_at <= ?
        AND (m.to_store_id = ? OR m.from_store_id = ?)
      GROUP BY c.product_id
    ), deliveries_after AS (
      SELECT c.product_id, SUM(d.qty)::int AS qty
      FROM latest c JOIN deliveries d ON d.product_id = c.product_id
        AND d.qty > 0 AND d.delivered_at > c.counted_at AND d.delivered_at <= ?
      GROUP BY c.product_id
    )
    SELECT c.product_id, c.qty AS count_qty, c.counted_at, c.counted_by,
      (c.qty + COALESCE(m.delta, 0) - CASE WHEN ? = 'local'
        THEN COALESCE(d.qty, 0) ELSE 0 END)::int AS stock
    FROM latest c LEFT JOIN moves m USING (product_id)
    LEFT JOIN deliveries_after d USING (product_id)`,
  store.id, at, store.id, at, store.id, store.id, at, store.kind);
}

export async function liveStock(db, { now } = {}) {
  const store = await storeOf(db);
  const rows = await stockRows(db, store, nowIso(now));
  return Object.fromEntries(rows.map((r) => [r.product_id, Number(r.stock)]));
}

export async function consumption(db, now) {
  const s = await settings(db);
  const date = businessDate(now ?? new Date(), s.timezone, Number(s.cutoff_hour));
  const weeks = await db.all(`SELECT DISTINCT date_trunc('week', s.business_date::date)::date::text AS week
    FROM sessions s WHERE s.business_date <= ? AND ${ACTIVE_SESSION}
    ORDER BY week DESC LIMIT 8`, date);
  if (weeks.length < 2) return { weekly: new Map(), has_consumption: false };
  const first = weeks.at(-1).week;
  const included = new Set(weeks.map((w) => w.week));
  const rows = await db.all(`SELECT d.product_id,
      date_trunc('week', s.business_date::date)::date::text AS week, SUM(d.qty)::int AS qty
    FROM deliveries d JOIN sessions s ON s.id = d.session_id
    WHERE d.qty > 0 AND s.business_date BETWEEN ? AND ?
    GROUP BY d.product_id, week`, first, date);
  const totals = new Map();
  for (const r of rows) {
    if (included.has(r.week)) totals.set(r.product_id, (totals.get(r.product_id) ?? 0) + Number(r.qty));
  }
  return { weekly: new Map([...totals].map(([id, n]) => [id, n / weeks.length])), has_consumption: true };
}

export function durationLabel(stock, weekly) {
  if (weekly === null || weekly === undefined || stock <= 0) return null;
  if (weekly === 0) return 'sin consumo reciente';
  const w = stock / weekly;
  if (w < 1) return 'menos de 1 semana';
  if (w <= 8) {
    const n = Math.round(w);
    return `≈ ${n} ${n === 1 ? 'semana' : 'semanas'}`;
  }
  if (w <= 52) return `≈ ${Math.min(12, Math.max(2, Math.round(w * 7 / 30.44)))} meses`;
  return 'más de 1 año';
}

function presentation(p, row, weekly, tripWeeks, hasConsumption, stockTotal = null) {
  const controlled = Boolean(row);
  const stock = controlled ? Number(row.stock) : null;
  const rate = hasConsumption ? (weekly ?? 0) : null;
  const durationStock = p.store_kind === 'central' ? stockTotal : stock;
  const weeks = controlled && durationStock > 0 && rate > 0 ? durationStock / rate : null;
  const state = !controlled ? null : stock <= 0 ? 'no_queda'
    : p.store_kind === 'local' && weeks !== null && weeks < tripWeeks ? 'queda_poco'
      : p.store_kind === 'central' && weeks > 52 ? 'sobra' : null;
  return {
    controlled, stock, stock_total: p.store_kind === 'central' && controlled ? stockTotal : null,
    cases: controlled && stock > 0 && p.per_case ? { full: Math.floor(stock / p.per_case), loose: stock % p.per_case } : null,
    weekly: rate === null ? null : Math.round(rate * 100) / 100,
    duration: controlled && durationStock > 0 && rate !== null
      ? { weeks: weeks === null ? null : Math.round(weeks * 10) / 10, label: durationLabel(durationStock, rate) } : null,
    state, review: controlled && stock < 0,
    section: !controlled ? 'sin_contar' : state === 'no_queda' ? 'no_queda'
      : state === 'queda_poco' ? 'queda_poco' : 'resto',
    last_count_at: row?.counted_at ?? null,
  };
}

export async function almacen(db, params = {}, { now } = {}) {
  const store = await storeOf(db, params.store);
  const [stores, products, counts, localCounts, usage, s] = await Promise.all([
    db.all('SELECT id, name, kind, sort FROM stores ORDER BY sort, id'),
    db.all(`SELECT p.id AS product_id, p.name, p.slug, p.photo, p.category, p.status,
        p.group_id, p.group_order, p.per_case, p.out_of_stock, p.active,
        g.sort AS group_sort
      FROM products p LEFT JOIN product_groups g ON g.id = p.group_id`),
    stockRows(db, store, nowIso(now)),
    store.kind === 'central' ? storeOf(db).then((local) => stockRows(db, local, nowIso(now))) : [],
    consumption(db, now), settings(db),
  ]);
  const byId = new Map(counts.map((r) => [r.product_id, r]));
  const localById = new Map(localCounts.map((r) => [r.product_id, r]));
  const rank = { no_queda: 0, queda_poco: 1, resto: 2, sin_contar: 3 };
  const selected = (p) => p.group_id !== null && p.active === 1 && ['confirmado', 'pendiente'].includes(p.status);
  const list = products.filter((p) => selected(p) || byId.has(p.product_id)).map((p) => {
    const { active, group_sort, ...data } = p;
    return { ...data, ...presentation({ ...p, store_kind: store.kind }, byId.get(p.product_id),
      usage.weekly.get(p.product_id), Number(s.trip_weeks), usage.has_consumption,
      store.kind === 'central' && byId.has(p.product_id)
        ? Number(byId.get(p.product_id).stock) + Number(localById.get(p.product_id)?.stock ?? 0) : null), _group_sort: group_sort,
    _selected: selected(p) };
  });
  list.sort((a, b) => rank[a.section] - rank[b.section]
    || Number(b._selected) - Number(a._selected)
    || (a._selected ? (a._group_sort - b._group_sort || a.group_id - b.group_id
      || (a.group_order ?? 1e9) - (b.group_order ?? 1e9) || a.product_id - b.product_id)
      : a.name.localeCompare(b.name, 'es', { sensitivity: 'base' })));
  return {
    store: { id: store.id, name: store.name, kind: store.kind },
    stores: stores.map(({ id, name, kind }) => ({ id, name, kind })),
    trip_weeks: Number(s.trip_weeks), has_consumption: usage.has_consumption,
    products: list.map(({ _group_sort, _selected, ...p }) => p),
  };
}

export async function almacenBotella(db, id, params = {}, { now } = {}) {
  const store = await storeOf(db, params.store);
  const p = await db.get(`SELECT id, name, slug, photo, category, status, per_case, group_id, out_of_stock
    FROM products WHERE id = ?`, id);
  if (!p) throw new HttpError(404, 'Producto no encontrado');
  const [rows, localRows, usage, counts, deliveries, moves, s, inTrip] = await Promise.all([
    stockRows(db, store, nowIso(now)),
    store.kind === 'central' ? storeOf(db).then((local) => stockRows(db, local, nowIso(now))) : [],
    consumption(db, now),
    db.all(`SELECT id, qty, counted_at, counted_by FROM stock_counts
      WHERE store_id = ? AND product_id = ? ORDER BY counted_at DESC, id DESC LIMIT 40`, store.id, id),
    store.kind === 'local' ? db.all(`SELECT s.business_date AS date,
        MAX(d.delivered_at) AS at, SUM(d.qty)::int AS qty FROM deliveries d
        JOIN sessions s ON s.id = d.session_id WHERE d.product_id = ? AND d.qty > 0
        GROUP BY s.business_date ORDER BY at DESC LIMIT 40`, id) : [],
    db.all(`SELECT id, kind AS type, created_at AS at, created_by AS by, qty, note,
        from_store_id, to_store_id FROM stock_moves WHERE product_id = ? AND voided = 0
        AND (from_store_id = ? OR to_store_id = ?) ORDER BY created_at DESC, id DESC LIMIT 40`, id, store.id, store.id),
    settings(db),
    db.get(`SELECT COALESCE(SUM(l.qty_planned), 0)::int AS qty FROM trip_lines l
      JOIN trips t ON t.id = l.trip_id WHERE t.status = 'abierto' AND l.removed = 0 AND l.product_id = ?`, id),
  ]);
  const row = rows.find((r) => r.product_id === id);
  const stockTotal = store.kind === 'central' && row
    ? Number(row.stock) + Number(localRows.find((r) => r.product_id === id)?.stock ?? 0) : null;
  const view = presentation({ ...p, store_kind: store.kind }, row,
    usage.weekly.get(id), Number(s.trip_weeks), usage.has_consumption, stockTotal);
  const suggested = (await suggestions(db, { now })).get(id) ?? null;
  const history = [
    ...counts.map((c) => ({ type: 'recuento', id: c.id, at: c.counted_at, by: c.counted_by, qty: c.qty })),
    ...deliveries.map((d) => ({ type: 'reposicion', date: d.date, at: d.at, qty: Number(d.qty) })),
    ...moves,
  ].sort((a, b) => b.at.localeCompare(a.at) || (b.id ?? 0) - (a.id ?? 0)).slice(0, 40);
  return {
    store: { id: store.id, name: store.name, kind: store.kind }, product: p,
    ...view, suggested, in_trip: Number(inTrip.qty), last_count: counts[0] ? { qty: counts[0].qty,
      counted_at: counts[0].counted_at, counted_by: counts[0].counted_by } : null,
    history,
  };
}

export async function writeAudit(t, { at, by, action, id, after }) {
  await t.run(`INSERT INTO audit (at, actor, entity, entity_id, action, after)
    VALUES (?, ?, 'almacen', ?, ?, ?)`, at, by, id, action, JSON.stringify(after));
}

export async function saveCounts(db, body = {}, { now } = {}) {
  const store = await storeOf(db, body.store_id);
  const items = body.items;
  if (!Array.isArray(items) || items.length < 1 || items.length > 60) throw bad('Elige entre 1 y 60 botellas.');
  const parsed = items.map((x) => ({ product_id: posInt(x?.product_id, 'Botella'),
    qty: posInt(x?.qty, 'Cantidad', { allowZero: true }) }));
  if (new Set(parsed.map((x) => x.product_id)).size !== parsed.length) throw bad('Hay una botella repetida.');
  const ids = parsed.map((x) => x.product_id);
  const found = await db.all(`SELECT id FROM products WHERE id IN (${ids.map(() => '?').join(', ')})`, ...ids);
  if (found.length !== ids.length) throw bad('Hay un producto que no existe.');
  const serverAt = nowIso(now);
  const proposed = new Date(body.counted_at);
  const at = body.counted_at && /^\d{4}-\d{2}-\d{2}T/.test(body.counted_at)
    && !Number.isNaN(proposed.getTime())
    && proposed.getTime() <= new Date(serverAt).getTime() + 60000
    && proposed.getTime() >= new Date(serverAt).getTime() - 12 * 3600000
    ? proposed.toISOString() : serverAt;
  const by = clean(body.by);
  const key = clean(body.key, 100);
  await db.tx(async (t) => {
    // El bloqueo serializa dos recuentos simultáneos del mismo almacén.
    await t.get('SELECT id FROM stores WHERE id = ? FOR UPDATE', store.id);
    const expected = new Map((await stockRows(t, store, at)).map((r) => [r.product_id, Number(r.stock)]));
    for (const x of parsed) {
      const r = await t.get(`INSERT INTO stock_counts
        (store_id, product_id, qty, expected, counted_at, counted_by, client_key)
        VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (client_key) DO NOTHING RETURNING id`, store.id, x.product_id, x.qty,
      expected.get(x.product_id) ?? null, at, by, key);
      if (!r) {
        const prior = await t.get('SELECT store_id, product_id, qty FROM stock_counts WHERE client_key = ?', key);
        if (parsed.length !== 1 || prior?.store_id !== store.id || prior.product_id !== x.product_id || prior.qty !== x.qty) {
          throw bad('El identificador del recuento ya se ha usado.');
        }
        continue;
      }
      await writeAudit(t, { at: serverAt, by, action: 'recuento', id: r.id,
        after: { store_id: store.id, product_id: x.product_id, qty: x.qty } });
    }
  });
  return { ok: true, saved: parsed.length };
}

export async function addBreakage(db, body = {}, { now } = {}) {
  const productId = posInt(body.product_id, 'Botella');
  const qty = posInt(body.qty, 'Cantidad');
  const p = await db.get('SELECT id FROM products WHERE id = ?', productId);
  if (!p) throw bad('Hay un producto que no existe.');
  const store = await storeOf(db);
  const at = nowIso(now);
  const by = clean(body.by);
  const note = clean(body.note, 200);
  await db.tx(async (t) => {
    const r = await t.get(`INSERT INTO stock_moves
      (product_id, from_store_id, to_store_id, qty, kind, created_at, created_by, note)
      VALUES (?, ?, NULL, ?, 'rotura', ?, ?, ?) RETURNING id`, productId, store.id, qty, at, by, note);
    await writeAudit(t, { at, by, action: 'rotura', id: r.id,
      after: { product_id: productId, store_id: store.id, qty, note } });
  });
  return almacenBotella(db, productId, {}, { now });
}

export async function suggestions(db, { now } = {}) {
  const [local, central] = await Promise.all([
    storeOf(db), db.get("SELECT id, name, kind, sort FROM stores WHERE kind = 'central' ORDER BY sort, id LIMIT 1"),
  ]);
  const [localRows, centralRows, usage, s, pointed, products] = await Promise.all([
    stockRows(db, local, nowIso(now)), central ? stockRows(db, central, nowIso(now)) : [],
    consumption(db, now), settings(db),
    db.all(`SELECT l.product_id, COALESCE(SUM(l.qty_planned), 0)::int AS qty FROM trip_lines l
      JOIN trips t ON t.id = l.trip_id WHERE t.status = 'abierto' AND l.removed = 0
      AND l.product_id IS NOT NULL GROUP BY l.product_id`),
    db.all('SELECT id, per_case FROM products'),
  ]);
  if (!usage.has_consumption) return new Map();
  const inside = new Map(localRows.map((r) => [r.product_id, Number(r.stock)]));
  const outside = new Map(centralRows.map((r) => [r.product_id, Number(r.stock)]));
  const inTrip = new Map(pointed.map((r) => [r.product_id, Number(r.qty)]));
  const result = new Map();
  for (const p of products) {
    const weekly = usage.weekly.get(p.id) ?? 0;
    if (weekly <= 0) continue;
    const pointed = inTrip.get(p.id) ?? 0;
    const missing = weekly * (Number(s.trip_weeks) + 1) - Math.max(0, inside.get(p.id) ?? 0) - pointed;
    if (missing <= 0) continue;
    const size = Number(p.per_case) > 0 ? Number(p.per_case) : 1;
    const rounded = Math.ceil(missing / size) * size;
    const qty = outside.has(p.id) ? Math.min(rounded, Math.max(0, outside.get(p.id) - pointed)) : rounded;
    if (qty > 0) result.set(p.id, qty);
  }
  return result;
}

export async function addEntries(db, body = {}, { now } = {}) {
  const store = await storeOf(db, body.store_id);
  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 60) {
    throw bad('Elige entre 1 y 60 botellas.');
  }
  const items = body.items.map((x) => ({ product_id: posInt(x?.product_id, 'Botella'), qty: posInt(x?.qty, 'Cantidad') }));
  if (new Set(items.map((x) => x.product_id)).size !== items.length) throw bad('Hay una botella repetida.');
  const found = await db.all(`SELECT id FROM products WHERE id IN (${items.map(() => '?').join(', ')})`,
    ...items.map((x) => x.product_id));
  if (found.length !== items.length) throw bad('Hay un producto que no existe.');
  const at = nowIso(now);
  const by = clean(body.by);
  const note = clean(body.note, 200);
  await db.tx(async (t) => {
    for (const item of items) {
      const r = await t.get(`INSERT INTO stock_moves
        (product_id, from_store_id, to_store_id, qty, kind, created_at, created_by, note)
        VALUES (?, NULL, ?, ?, 'entrada', ?, ?, ?) RETURNING id`, item.product_id, store.id, item.qty, at, by, note);
      await writeAudit(t, { at, by, action: 'entrada', id: r.id,
        after: { product_id: item.product_id, store_id: store.id, qty: item.qty, note } });
    }
  });
  return { ok: true, saved: items.length };
}
