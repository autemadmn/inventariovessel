// Existencias calculadas desde recuentos, movimientos y reposiciones originales.
// No depende de services.js para evitar un ciclo de importación.
import { businessDate } from './dates.js';
import { HttpError } from './errors.js';
import { DEFAULT_SETTINGS } from './schema.js';
import { SHELF_ORDER } from './catalog.js';
import { quantity as posInt, operationKey, stockOperation } from './stock-operation.js';

const bad = (message) => new HttpError(400, message);
// Mismos límites y limpieza que services.js.
const clean = (s, max = 80) => (typeof s === 'string' ? s.trim().slice(0, max) : '') || null;
const nowIso = (now) => (now ?? new Date()).toISOString();
const ACTIVE_SESSION = `(EXISTS (SELECT 1 FROM request_lines l WHERE l.session_id = s.id)
  OR EXISTS (SELECT 1 FROM deliveries d WHERE d.session_id = s.id AND d.qty > 0))`;

export async function settings(db) {
  const s = { trip_weeks: DEFAULT_SETTINGS.trip_weeks, ...DEFAULT_SETTINGS };
  for (const { key, value } of await db.all('SELECT key, value FROM settings')) s[key] = value;
  return { ...s, timezone: 'Europe/Madrid', cutoff_hour: '12' };
}

export const MAIN_STORE_SQL = `COALESCE(p.main_store_id, (SELECT id FROM stores WHERE map_key = CASE
  WHEN p.category IN ('cerveza','refresco') THEN 'alm-cerveza' WHEN p.category = 'vino' THEN 'nevera-vino'
  ELSE 'alm-alcohol' END))`;

export async function mainStoreId(t, productId) {
  const p = await t.get(`SELECT ${MAIN_STORE_SQL} AS id FROM products p WHERE p.id = ?`, productId);
  if (!p?.id) throw bad('Hay un producto que no existe.');
  return p.id;
}

export function pointObject(store) {
  return { id: store.id, key: store.map_key ?? (store.kind === 'central' ? 'out' : 'in'),
    name: store.name, type: store.point_type ?? null, bar_id: store.bar_id ?? null,
    variance: store.kind === 'central' || store.point_type === 'almacen' };
}

export async function storeOf(db, id, { forWrite = false } = {}) {
  if (id === undefined || id === null || id === '') id = forWrite ? 1 : 'in';
  if (id === 'in') {
    if (forWrite) throw bad('Elige un punto para contar.');
    return { id: null, name: 'In Vessel', kind: 'local', map_key: 'in', point_type: null, bar_id: null, in_vessel: 1 };
  }
  if (id === 'out') id = 2;
  const store = Number.isInteger(Number(id)) ? await db.get('SELECT * FROM stores WHERE id = ?', Number(id)) : null;
  if (!store) throw bad('Almacén no válido.');
  return store;
}

// Una consulta para todas las botellas del almacén. El punto de partida de cada
// botella es su último recuento; si nunca se ha contado pero ha entrado algo en
// este almacén (mercancía o viaje), se parte de 0 justo antes de esa primera
// entrada. El orden común de eventos desempata las horas efectivas iguales.
export async function stockRows(db, scope, at = nowIso()) {
  const id = scope === 'in' ? null : typeof scope === 'object' ? scope.id : Number(scope);
  return db.all(`WITH pts AS (
      SELECT id, bar_id FROM stores WHERE (?::int IS NULL AND in_vessel = 1) OR id = ?::int
    ), last_count AS (
      SELECT DISTINCT ON (c.store_id, c.product_id) c.id, c.store_id, c.product_id, c.qty, c.counted_at, c.counted_by, c.event_order
      FROM stock_counts c JOIN pts ON pts.id = c.store_id WHERE c.counted_at <= ?
      ORDER BY c.store_id, c.product_id, c.counted_at DESC, c.event_order DESC, c.id DESC
    ), first_in AS (
      SELECT store_id, product_id, MIN(first_at) AS first_at FROM (
        SELECT m.to_store_id AS store_id, m.product_id, m.created_at AS first_at
        FROM stock_moves m JOIN pts ON pts.id = m.to_store_id WHERE m.voided = 0 AND m.created_at <= ?
        UNION ALL
        SELECT p.id, d.product_id, d.delivered_at FROM deliveries d JOIN pts p ON p.bar_id = d.bar_id
        WHERE d.qty > 0 AND d.delivered_at <= ?
      ) incoming GROUP BY store_id, product_id
    ), latest AS (
      SELECT id, store_id, product_id, qty, counted_at, counted_by, event_order FROM last_count
      UNION ALL
      SELECT NULL::int, f.store_id, f.product_id, 0, f.first_at, NULL, 0::bigint FROM first_in f
      WHERE NOT EXISTS (SELECT 1 FROM last_count lc WHERE lc.store_id = f.store_id AND lc.product_id = f.product_id)
    ), moves AS (
      SELECT c.store_id, c.product_id,
        SUM(CASE WHEN m.to_store_id = c.store_id THEN m.qty ELSE -m.qty END)::int AS delta
      FROM latest c JOIN stock_moves m ON m.product_id = c.product_id AND m.voided = 0 AND m.created_at <= ?
        AND (m.created_at > c.counted_at OR (m.created_at = c.counted_at AND (c.id IS NULL OR m.event_order > c.event_order)))
        AND (m.to_store_id = c.store_id OR m.from_store_id = c.store_id)
      GROUP BY c.store_id, c.product_id
    ), deliv AS (
      SELECT c.store_id, c.product_id,
        SUM(CASE WHEN d.from_store_id = c.store_id THEN -d.qty ELSE 0 END
          + CASE WHEN p.bar_id IS NOT NULL AND d.bar_id = p.bar_id THEN d.qty ELSE 0 END)::int AS delta
      FROM latest c JOIN pts p ON p.id = c.store_id
      JOIN deliveries d ON d.product_id = c.product_id AND d.qty > 0
        AND (d.delivered_at > c.counted_at OR (d.delivered_at = c.counted_at AND (c.id IS NULL OR d.event_order > c.event_order))) AND d.delivered_at <= ?
        AND (d.from_store_id = c.store_id OR (p.bar_id IS NOT NULL AND d.bar_id = p.bar_id))
      GROUP BY c.store_id, c.product_id
    )
    SELECT c.store_id, c.product_id, c.id AS count_id, c.qty AS count_qty, c.counted_at, c.counted_by,
      (c.qty + COALESCE(m.delta, 0) + COALESCE(d.delta, 0))::int AS stock
    FROM latest c LEFT JOIN moves m USING (store_id, product_id) LEFT JOIN deliv d USING (store_id, product_id)`,
  id, id, at, at, at, at, at);
}

// Agrupa en memoria las filas de puntos de la consulta única de In Vessel.
function stockByProduct(rows) {
  const result = new Map();
  for (const r of rows) {
    const prior = result.get(r.product_id);
    const newer = !prior || (r.count_id && (!prior.count_id || r.counted_at > prior.counted_at));
    result.set(r.product_id, { ...(newer ? r : prior), stock: Number(r.stock) + Number(prior?.stock ?? 0) });
  }
  return result;
}

export async function liveStock(db, { now } = {}) {
  const rows = await stockRows(db, 'in', nowIso(now));
  return Object.fromEntries([...stockByProduct(rows)].map(([id, r]) => [id, r.stock]));
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
    last_count_at: row?.count_id ? row.counted_at : null,
  };
}

export async function almacen(db, params = {}, { now } = {}) {
  const store = await storeOf(db, params.store);
  const [stores, products, counts, localCounts, usage, s] = await Promise.all([
    db.all('SELECT * FROM stores ORDER BY sort, id'),
    db.all(`SELECT p.id AS product_id, p.name, p.slug, p.photo, p.category, p.status,
        p.group_id, p.group_order, p.per_case, p.out_of_stock, p.active,
        g.sort AS group_sort
      FROM products p LEFT JOIN product_groups g ON g.id = p.group_id`),
    stockRows(db, store, nowIso(now)),
    store.kind === 'central' ? storeOf(db).then((local) => stockRows(db, local, nowIso(now))) : [],
    consumption(db, now), settings(db),
  ]);
  const byId = stockByProduct(counts);
  const localById = stockByProduct(localCounts);
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
    store: { ...pointObject(store), kind: store.kind },
    stores,
    trip_weeks: Number(s.trip_weeks), has_consumption: usage.has_consumption,
    products: list.map(({ _group_sort, _selected, ...p }) => p),
  };
}

export async function almacenBotella(db, id, params = {}, { now } = {}) {
  const store = await storeOf(db, params.store);
  const p = await db.get(`SELECT p.id, p.name, p.slug, p.photo, p.category, p.status, p.per_case,
    p.group_id, p.out_of_stock, ${MAIN_STORE_SQL} AS main_store_id FROM products p WHERE p.id = ?`, id);
  if (!p) throw new HttpError(404, 'Producto no encontrado');
  const [rows, localRows, usage, counts, deliveries, moves, s, inTrip, stores] = await Promise.all([
    stockRows(db, store, nowIso(now)),
    store.kind === 'central' ? stockRows(db, 'in', nowIso(now)) : [],
    consumption(db, now),
    db.all(`SELECT c.*, st.name AS store_name, st.point_type, st.kind FROM stock_counts c
      JOIN stores st ON st.id = c.store_id WHERE c.product_id = ?
        AND ((?::int IS NULL AND st.in_vessel = 1) OR c.store_id = ?::int)
      ORDER BY c.counted_at DESC, c.id DESC LIMIT 40`, id, store.id, store.id),
    store.kind === 'local' ? db.all(`SELECT s.business_date AS date, d.bar_id,
        MAX(d.id) AS id, MAX(d.delivered_at) AS at, MAX(d.delivered_by) AS by,
        CASE WHEN COUNT(DISTINCT d.from_store_id) = 1 THEN MIN(d.from_store_id) END AS from_store_id,
        CASE WHEN COUNT(DISTINCT d.from_store_id) = 1 THEN MIN(fs.name) END AS from_store_name,
        ts.id AS to_store_id, ts.name AS to_store_name,
        SUM(d.qty)::int AS qty FROM deliveries d JOIN sessions s ON s.id = d.session_id
        JOIN stores fs ON fs.id = d.from_store_id LEFT JOIN stores ts ON ts.bar_id = d.bar_id
        WHERE d.product_id = ? AND d.qty > 0
          AND ((?::int IS NULL AND (fs.in_vessel = 1 OR ts.in_vessel = 1))
            OR d.from_store_id = ?::int OR ts.id = ?::int)
        GROUP BY s.business_date, d.bar_id, ts.id, ts.name
        ORDER BY at DESC LIMIT 40`, id, store.id, store.id, store.id) : [],
    db.all(`SELECT m.id, m.kind AS type, m.created_at AS at, m.created_by AS by, m.qty, m.note,
        m.from_store_id, fs.name AS from_store_name, m.to_store_id, ts.name AS to_store_name,
        m.trip_id, fs.in_vessel AS from_in, ts.in_vessel AS to_in FROM stock_moves m
        LEFT JOIN stores fs ON fs.id = m.from_store_id LEFT JOIN stores ts ON ts.id = m.to_store_id
        WHERE m.product_id = ? AND m.voided = 0
          AND ((?::int IS NULL AND (fs.in_vessel = 1 OR ts.in_vessel = 1))
            OR m.from_store_id = ?::int OR m.to_store_id = ?::int)
        ORDER BY m.created_at DESC, m.id DESC LIMIT 40`, id, store.id, store.id, store.id),
    settings(db),
    db.get(`SELECT COALESCE(SUM(l.qty_planned), 0)::int AS qty FROM trip_lines l
      JOIN trips t ON t.id = l.trip_id WHERE t.status = 'abierto' AND l.removed = 0 AND l.product_id = ?`, id),
    store.id === null ? db.all('SELECT * FROM stores WHERE in_vessel = 1 ORDER BY sort, id') : [],
  ]);
  const row = stockByProduct(rows).get(id);
  const stockTotal = store.kind === 'central' && row
    ? Number(row.stock) + Number(stockByProduct(localRows).get(id)?.stock ?? 0) : null;
  const view = presentation({ ...p, store_kind: store.kind }, row,
    usage.weekly.get(id), Number(s.trip_weeks), usage.has_consumption, stockTotal);
  const suggested = (await suggestions(db, { now })).get(id) ?? null;
  const historyItem = (item) => ({ type: null, id: null, at: null, by: null, qty: null, sign: '', note: null,
    from_store_id: null, from_store_name: null, to_store_id: null, to_store_name: null,
    store_name: null, bar_id: null, date: null, trip_id: null, result: null, ...item });
  const history = [
    ...counts.map((c) => historyItem({ type: 'recuento', id: c.id, at: c.counted_at, by: c.counted_by,
      qty: c.qty, store_name: c.store_name, result: countResult(c, c.qty, c.expected) })),
    ...deliveries.map((d) => historyItem({ ...d, type: 'reposicion', qty: Number(d.qty),
      sign: store.id === null ? '' : d.from_store_id === store.id ? '-' : '+' })),
    ...moves.map(({ from_in, to_in, ...m }) => historyItem({ ...m,
      type: m.type === 'traslado' && m.trip_id !== null ? 'viaje' : m.type,
      sign: store.id === null ? (from_in && to_in ? '' : to_in ? '+' : '-')
        : m.to_store_id === store.id ? '+' : '-' })),
  ].sort((a, b) => b.at.localeCompare(a.at) || (b.id ?? 0) - (a.id ?? 0)).slice(0, 40);
  return {
    store: { ...pointObject(store), kind: store.kind }, product: p, main_store_id: p.main_store_id,
    result: store.id === null || !counts[0] ? null : countResult(store, counts[0].qty, counts[0].expected),
    ...(store.id === null ? { by_point: stores.filter((st) => rows.some((r) => r.store_id === st.id && r.product_id === id))
      .map((st) => { const r = rows.find((r) => r.store_id === st.id && r.product_id === id);
        return { store_id: st.id, key: st.map_key, name: st.name, type: st.point_type,
          controlled: true, stock: Number(r.stock), last_count_at: r.count_id ? r.counted_at : null }; }) } : {}),
    ...view, suggested, in_trip: Number(inTrip.qty), last_count: counts[0] ? { qty: counts[0].qty,
      counted_at: counts[0].counted_at, counted_by: counts[0].counted_by } : null,
    history,
  };
}

export async function writeAudit(t, { at, by, action, id, after }) {
  await t.run(`INSERT INTO audit (at, actor, entity, entity_id, action, after)
    VALUES (?, ?, 'almacen', ?, ?, ?)`, at, by, id, action, JSON.stringify(after));
}

export function countResult(store, qty, expected) {
  if (expected === null || expected === undefined) return null;
  const variance = store.kind === 'central' || store.point_type === 'almacen';
  return { qty: Number(qty), expected: Number(expected), diff: Number(qty) - Number(expected),
    kind: variance ? 'descuadre' : 'consumo',
    ...(variance ? {} : { consumption: Number(expected) - Number(qty) }) };
}

export async function points(db) {
  const [stores, latest, out] = await Promise.all([
    db.all('SELECT * FROM stores WHERE in_vessel = 1 ORDER BY sort, id'),
    db.all(`SELECT DISTINCT ON (store_id, product_id) store_id, qty, expected, counted_at
      FROM stock_counts ORDER BY store_id, product_id, counted_at DESC, id DESC`),
    db.get("SELECT id, name FROM stores WHERE kind = 'central' ORDER BY sort, id LIMIT 1"),
  ]);
  return { points: stores.map((st) => {
    const counts = latest.filter((r) => r.store_id === st.id);
    const lastAt = counts.reduce((at, r) => !at || r.counted_at > at ? r.counted_at : at, null);
    return { ...pointObject(st), status: !counts.length ? 'sin_contar'
      : st.point_type === 'almacen' && counts.some((r) => r.expected !== null && r.qty !== r.expected)
        ? 'descuadre' : 'normal', last_count_at: lastAt };
  }), out };
}

export async function punto(db, id, params = {}, { now } = {}) {
  const st = Number.isInteger(Number(id)) ? await db.get('SELECT * FROM stores WHERE id = ? AND in_vessel = 1', Number(id)) : null;
  if (!st) throw bad('Punto no válido.');
  const mode = params.modo ?? 'contar';
  if (!['contar', 'consultar'].includes(mode)) throw bad('Modo no válido.');
  const [products, rows, counts, s] = await Promise.all([
    db.all(`SELECT p.id AS product_id, p.name, p.slug, p.photo, p.category, p.per_case, p.status,
        ${MAIN_STORE_SQL} AS main_store_id, p.group_id, p.group_order, p.active, g.sort AS group_sort
      FROM products p LEFT JOIN product_groups g ON g.id = p.group_id WHERE
        (p.active = 1 AND p.status IN ('confirmado', 'pendiente') AND
          (${MAIN_STORE_SQL} = ? OR (? = 'barra' AND p.group_id IS NOT NULL)))
        OR EXISTS (SELECT 1 FROM stock_counts c WHERE c.product_id = p.id AND c.store_id = ?)
        OR EXISTS (SELECT 1 FROM stock_moves m WHERE m.product_id = p.id AND m.voided = 0
          AND (m.from_store_id = ? OR m.to_store_id = ?))
        OR EXISTS (SELECT 1 FROM deliveries d WHERE d.product_id = p.id AND d.qty > 0
          AND (d.from_store_id = ? OR (?::int IS NOT NULL AND d.bar_id = ?::int)))`,
    st.id, st.point_type, st.id, st.id, st.id, st.id, st.bar_id, st.bar_id),
    stockRows(db, st, nowIso(now)),
    db.all(`SELECT DISTINCT ON (product_id) product_id, qty, expected, counted_at FROM stock_counts
      WHERE store_id = ? AND counted_at <= ? ORDER BY product_id, counted_at DESC, id DESC`, st.id, nowIso(now)),
    settings(db),
  ]);
  const night = businessDate(now ?? new Date(), s.timezone, Number(s.cutoff_hour));
  const byId = new Map(rows.map((r) => [r.product_id, r]));
  const countById = new Map(counts.map((c) => [c.product_id, c]));
  const rank = (c) => SHELF_ORDER.indexOf(c) < 0 ? SHELF_ORDER.length - 1 : SHELF_ORDER.indexOf(c);
  const selected = (p) => p.group_id !== null && p.active === 1 && ['confirmado', 'pendiente'].includes(p.status);
  products.sort((a, b) => rank(a.category) - rank(b.category)
    || Number(selected(b)) - Number(selected(a))
    || (selected(a) && selected(b)
      ? (a.group_sort - b.group_sort || a.group_id - b.group_id || (a.group_order ?? 1e9) - (b.group_order ?? 1e9)) : 0)
    || a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
  return { point: pointObject(st), mode, night, products: products.map(({ group_sort, active, ...p }) => {
    const r = byId.get(p.product_id);
    const c = countById.get(p.product_id);
    const countedTonight = Boolean(c && businessDate(c.counted_at, s.timezone, Number(s.cutoff_hour)) === night);
    const stock = r ? Number(r.stock) : null;
    return { ...p, category: SHELF_ORDER.includes(p.category) ? p.category : 'otros', is_main: p.main_store_id === st.id,
      controlled: mode === 'contar' ? null : Boolean(r), stock: mode === 'contar' ? null : stock,
      cases: mode === 'consultar' && stock > 0 && p.per_case
        ? { full: Math.floor(stock / p.per_case), loose: stock % p.per_case } : null,
      last_count_at: mode === 'consultar' && c ? c.counted_at : null,
      state: mode === 'consultar' && r && stock <= 0 ? 'no_queda' : null,
      counted_tonight: countedTonight,
      result: c && (mode === 'consultar' || countedTonight) ? countResult(st, c.qty, c.expected) : null };
  }) };
}

export async function saveCounts(db, body = {}, { now } = {}) {
  const store = await storeOf(db, body.store_id, { forWrite: true });
  if (!store.in_vessel && store.kind !== 'central') throw bad('Punto no válido.');
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
  const deferred = body.counted_at && /^\d{4}-\d{2}-\d{2}T/.test(body.counted_at)
    && !Number.isNaN(proposed.getTime())
    && proposed.getTime() <= new Date(serverAt).getTime() + 60000
    && proposed.getTime() >= new Date(serverAt).getTime() - 12 * 3600000
    ? proposed.toISOString() : null;
  const by = clean(body.by);
  const key = operationKey(body.key);
  const results = await db.tx(async (t) => {
    await t.all(`SELECT id FROM products WHERE id IN (${ids.map(() => '?').join(', ')}) ORDER BY id FOR KEY SHARE`, ...ids);
    // El bloqueo serializa dos recuentos simultáneos del mismo almacén.
    await t.get('SELECT id FROM stores WHERE id = ? FOR UPDATE', store.id);
    const at = deferred ?? nowIso(now);
    return stockOperation(t, key, { type: 'recuento', store_id: store.id, by, counted_at: deferred,
      items: [...parsed].sort((a,b) => a.product_id-b.product_id) }, async () => {
      const expected = new Map((await stockRows(t, store, at)).map((r) => [r.product_id, Number(r.stock)]));
      const results = [];
      for (const x of parsed) {
        const r = await t.get(`INSERT INTO stock_counts
          (store_id, product_id, qty, expected, counted_at, counted_by, client_key)
          VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (client_key) DO NOTHING RETURNING id, qty, expected`, store.id, x.product_id, x.qty,
        expected.get(x.product_id) ?? null, at, by, key && (parsed.length === 1 ? key : `${key}:${x.product_id}`));
        if (!r) {
          const prior = await t.get('SELECT store_id, product_id, qty, expected FROM stock_counts WHERE client_key = ?', key);
          if (parsed.length !== 1 || prior?.store_id !== store.id || prior.product_id !== x.product_id || prior.qty !== x.qty) {
            throw new HttpError(409, 'El identificador del recuento ya se ha usado.');
          }
          results.push({ product_id: x.product_id, store_id: store.id, qty: prior.qty, expected: prior.expected,
            diff: null, kind: null, ...countResult(store, prior.qty, prior.expected) });
          continue;
        }
        await writeAudit(t, { at: serverAt, by, action: 'recuento', id: r.id,
          after: { store_id: store.id, product_id: x.product_id, qty: x.qty } });
        results.push({ product_id: x.product_id, store_id: store.id, qty: r.qty, expected: r.expected,
          diff: null, kind: null, ...countResult(store, r.qty, r.expected) });
      }
      return results;
    });
  });
  return { ok: true, saved: parsed.length, results };
}

export async function addBreakage(db, body = {}, { now } = {}) {
  const productId = posInt(body.product_id, 'Botella');
  const qty = posInt(body.qty, 'Cantidad');
  const p = await db.get('SELECT id FROM products WHERE id = ?', productId);
  if (!p) throw bad('Hay un producto que no existe.');
  const store = body.store_id === 'in' ? null : await storeOf(db, body.store_id, { forWrite: true });
  if (!store?.in_vessel) throw bad('Las roturas se apuntan en un punto de In Vessel.');
  const key = operationKey(body.key);
  const by = clean(body.by);
  const note = clean(body.note, 200);
  await db.tx(async (t) => {
    await t.get('SELECT id FROM products WHERE id = ? FOR KEY SHARE', productId);
    await t.get('SELECT id FROM stores WHERE id = ? FOR UPDATE', store.id);
    return stockOperation(t, key, { type: 'rotura', product_id: productId, store_id: store.id, qty, by, note }, async () => {
      const at = nowIso(now);
      const r = await t.get(`INSERT INTO stock_moves
        (product_id, from_store_id, to_store_id, qty, kind, created_at, created_by, note, client_key)
        VALUES (?, ?, NULL, ?, 'rotura', ?, ?, ?, ?) ON CONFLICT (client_key) DO NOTHING RETURNING id`, productId, store.id, qty, at, by, note, key);
      if (!r) throw new HttpError(409, 'El identificador del movimiento ya se ha usado.');
      await writeAudit(t, { at, by, action: 'rotura', id: r.id,
        after: { product_id: productId, store_id: store.id, qty, note } });
      return { ok: true };
    });
  });
  return almacenBotella(db, productId, { store: store.id }, { now });
}

export async function addTransfer(db, body = {}, { now } = {}) {
  const productId = posInt(body.product_id, 'Botella');
  const qty = posInt(body.qty, 'Cantidad');
  const fromId = Number(body.from_store_id); const toId = Number(body.to_store_id);
  const stores = Number.isInteger(fromId) && Number.isInteger(toId)
    ? await db.all('SELECT id FROM stores WHERE in_vessel = 1 AND id IN (?, ?)', fromId, toId) : [];
  if (fromId === toId && stores.length === 1) throw bad('Elige otro punto.');
  if (stores.length !== 2) throw bad('Solo se puede mover entre puntos de In Vessel.');
  if (!await db.get('SELECT id FROM products WHERE id = ?', productId)) throw bad('Hay un producto que no existe.');
  const key = operationKey(body.key); const by = clean(body.by); const note = clean(body.note, 200);
  await db.tx(async (t) => {
    await t.get('SELECT id FROM products WHERE id = ? FOR KEY SHARE', productId);
    await t.all('SELECT id FROM stores WHERE id IN (?, ?) ORDER BY id FOR UPDATE', fromId, toId);
    return stockOperation(t, key, { type: 'traslado', product_id: productId, from_store_id: fromId, to_store_id: toId, qty, by, note }, async () => {
      const at = nowIso(now);
      const r = await t.get(`INSERT INTO stock_moves
        (product_id, from_store_id, to_store_id, qty, kind, created_at, created_by, note, client_key)
        VALUES (?, ?, ?, ?, 'traslado', ?, ?, ?, ?) ON CONFLICT (client_key) DO NOTHING RETURNING id`, productId, fromId, toId, qty, at, by, note, key);
      if (!r) throw new HttpError(409, 'El identificador del movimiento ya se ha usado.');
      await writeAudit(t, { at, by, action: 'traslado_punto', id: r.id,
        after: { product_id: productId, from_store_id: fromId, to_store_id: toId, qty, note } });
      return { ok: true };
    });
  });
  return almacenBotella(db, productId, { store: fromId }, { now });
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
  const inside = new Map([...stockByProduct(localRows)].map(([id, r]) => [id, r.stock]));
  const outside = new Map(centralRows.map((r) => [r.product_id, Number(r.stock)]));
  const inTrip = new Map(pointed.map((r) => [r.product_id, Number(r.qty)]));
  const result = new Map();
  for (const p of products) {
    const weekly = usage.weekly.get(p.id) ?? 0;
    // Sin recuento en el almacén del local no se sabe lo que hay: no se inventa una sugerencia.
    if (weekly <= 0 || !inside.has(p.id)) continue;
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
  const store = await storeOf(db, body.store_id === 'in' ? 'in' : body.store_id ?? 1);
  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 60) {
    throw bad('Elige entre 1 y 60 botellas.');
  }
  const items = body.items.map((x) => ({ product_id: posInt(x?.product_id, 'Botella'), qty: posInt(x?.qty, 'Cantidad') }));
  if (new Set(items.map((x) => x.product_id)).size !== items.length) throw bad('Hay una botella repetida.');
  const found = await db.all(`SELECT id FROM products WHERE id IN (${items.map(() => '?').join(', ')})`,
    ...items.map((x) => x.product_id));
  if (found.length !== items.length) throw bad('Hay un producto que no existe.');
  const key = operationKey(body.key);
  const by = clean(body.by);
  const note = clean(body.note, 200);
  await db.tx(async (t) => {
    await t.all(`SELECT id FROM products WHERE id IN (${items.map(() => '?').join(', ')})
      ORDER BY id FOR SHARE`, ...items.map((x) => x.product_id));
    const destinations = new Map();
    for (const item of items) destinations.set(item.product_id,
      store.id === null ? await mainStoreId(t, item.product_id) : store.id);
    const storeIds = [...new Set(destinations.values())].sort((a, b) => a - b);
    await t.all(`SELECT id FROM stores WHERE id IN (${storeIds.map(() => '?').join(', ')}) ORDER BY id FOR UPDATE`, ...storeIds);
    return stockOperation(t, key, { type: 'entrada', store: store.id ?? 'in', by, note,
      items: [...items].sort((a,b) => a.product_id-b.product_id) }, async () => {
      const at = nowIso(now);
      for (const item of items) {
        const storeId = destinations.get(item.product_id);
        const r = await t.get(`INSERT INTO stock_moves
          (product_id, from_store_id, to_store_id, qty, kind, created_at, created_by, note, client_key)
          VALUES (?, NULL, ?, ?, 'entrada', ?, ?, ?, ?) ON CONFLICT (client_key) DO NOTHING RETURNING id`, item.product_id, storeId, item.qty, at, by, note, key && `${key}:${item.product_id}`);
        if (!r) throw new HttpError(409, 'El identificador del movimiento ya se ha usado.');
        await writeAudit(t, { at, by, action: 'entrada', id: r.id,
          after: { product_id: item.product_id, store_id: storeId, qty: item.qty, note } });
      }
      return { ok: true, saved: items.length };
    });
  });
  return { ok: true, saved: items.length };
}
