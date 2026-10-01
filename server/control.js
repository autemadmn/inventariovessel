// Endpoints de control del encargado para descuadres e historial del almacén.
import { settings } from './almacen.js';
import { businessDate, addDays, monthStart, monthEnd, periodRange } from './dates.js';
import { HttpError } from './errors.js';

const invalid = (message) => new HttpError(400, message);
const isoNow = (now) => (now ?? new Date()).toISOString();
const clean = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

async function periodInfo(db, params, now) {
  const period = params.period || 'mes';
  if (!['mes', 'mes_pasado', 'todo'].includes(period)) throw invalid('Periodo no válido.');
  if (period === 'todo') return { period, range: null };
  const s = await settings(db);
  const today = businessDate(now ?? new Date(), s.timezone, Number(s.cutoff_hour));
  const from = period === 'mes' ? monthStart(today) : addDays(monthStart(today), -1);
  const range = periodRange('month', from);
  return { period, range: { ...range, to: period === 'mes' ? monthEnd(today) : range.to } };
}

function inRange(at, range, s) {
  if (!range) return true;
  const day = businessDate(at, s.timezone, Number(s.cutoff_hour));
  return day >= range.from && day <= range.to;
}

export async function descuadres(db, params = {}, { now } = {}) {
  const info = await periodInfo(db, params, now);
  const s = await settings(db);
  // Una consulta agregada obtiene todas las botellas discrepantes y los totales por almacén.
  const rows = await db.all(`SELECT c.id AS count_id, c.store_id, st.name AS store_name,
      c.product_id, p.name, p.slug, p.photo, p.category, p.per_case,
      c.qty, c.expected, (c.qty - c.expected)::int AS diff, c.counted_at, c.counted_by
    FROM stock_counts c
    JOIN stores st ON st.id = c.store_id
    JOIN products p ON p.id = c.product_id
    WHERE c.expected IS NOT NULL AND c.qty <> c.expected
    ORDER BY c.counted_at DESC, c.id DESC`);
  const filtered = rows.filter((r) => inRange(r.counted_at, info.range, s)).map((r) => ({
    ...r, qty: Number(r.qty), expected: Number(r.expected), diff: Number(r.diff),
    per_case: r.per_case === null ? null : Number(r.per_case),
  }));
  const stores = await db.all('SELECT id, name FROM stores ORDER BY sort, id');
  const missing = new Map();
  for (const r of filtered) if (r.diff < 0) missing.set(r.store_id, (missing.get(r.store_id) ?? 0) + Math.abs(r.diff));
  return {
    ...info,
    totals: stores.map((store) => ({ store_id: store.id, store_name: store.name, missing: missing.get(store.id) ?? 0 })),
    items: filtered,
  };
}

function eventKey(type, bits) { return `${type}-${bits.join('-')}`; }

export async function historial(db, params = {}, { now } = {}) {
  const info = await periodInfo(db, params, now);
  const s = await settings(db);
  // Consultas por tipo, sin consultas adicionales por botella; el agrupado final se hace en memoria.
  const [moves, counts] = await Promise.all([
    db.all(`SELECT m.id AS move_id, m.product_id, p.name, p.slug, p.photo, p.category, p.per_case,
        m.from_store_id, fs.name AS from_store_name, m.to_store_id, ts.name AS to_store_name,
        m.qty, m.kind, m.trip_id, m.created_at, m.created_by, m.note,
        m.voided, m.voided_at, m.voided_by, m.void_reason,
        t.status AS trip_status, t.done_at, t.done_by
      FROM stock_moves m JOIN products p ON p.id = m.product_id
      LEFT JOIN stores fs ON fs.id = m.from_store_id
      LEFT JOIN stores ts ON ts.id = m.to_store_id
      LEFT JOIN trips t ON t.id = m.trip_id
      ORDER BY m.id`),
    db.all(`SELECT c.id AS count_id, c.store_id, st.name AS store_name, c.product_id,
        p.name, p.slug, p.photo, p.category, p.per_case, c.qty, c.expected,
        c.counted_at, c.counted_by
      FROM stock_counts c JOIN stores st ON st.id = c.store_id
      JOIN products p ON p.id = c.product_id ORDER BY c.id`),
  ]);
  const groups = new Map();
  const add = (key, event, line) => {
    if (!groups.has(key)) groups.set(key, { ...event, lines: [] });
    groups.get(key).lines.push(line);
  };
  for (const m of moves) {
    let type; let at; let by; let storeId; let storeName; let fromId; let fromName; let key;
    if (m.kind === 'traslado' && m.trip_id !== null) {
      if (m.trip_status !== 'hecho') continue;
      type = 'viaje'; at = m.done_at ?? m.created_at; by = m.done_by ?? m.created_by;
      storeId = m.to_store_id; storeName = m.to_store_name; fromId = m.from_store_id; fromName = m.from_store_name;
      key = eventKey(type, [m.trip_id]);
    } else if (m.kind === 'traslado') {
      type = 'viaje'; at = m.created_at; by = m.created_by;
      storeId = m.to_store_id; storeName = m.to_store_name; fromId = m.from_store_id; fromName = m.from_store_name;
      key = eventKey(type, ['move', m.move_id]);
    } else if (m.kind === 'entrada') {
      type = 'entrada'; at = m.created_at; by = m.created_by; storeId = m.to_store_id; storeName = m.to_store_name;
      fromId = null; fromName = null;
      key = eventKey(type, [m.to_store_id, m.created_at, m.created_by ?? '', m.note ?? '']);
    } else {
      type = 'rotura'; at = m.created_at; by = m.created_by; storeId = m.from_store_id;
      storeName = m.from_store_name; fromId = null; fromName = null; key = eventKey(type, [m.move_id]);
    }
    if (!inRange(at, info.range, s)) continue;
    add(key, { key, type, at, by, trip_id: m.trip_id, store_id: storeId, store_name: storeName,
      from_store_id: fromId, from_store_name: fromName, note: m.note ?? null }, {
      move_id: m.move_id, product_id: m.product_id, name: m.name, slug: m.slug, photo: m.photo,
      category: m.category, per_case: m.per_case === null ? null : Number(m.per_case), qty: Number(m.qty),
      voided: Number(m.voided), voided_at: m.voided_at, voided_by: m.voided_by, void_reason: m.void_reason,
    });
  }
  const countGroups = new Map();
  for (const c of counts) {
    if (!inRange(c.counted_at, info.range, s)) continue;
    const night = businessDate(c.counted_at, s.timezone, Number(s.cutoff_hour));
    const key = eventKey('recuento', [c.store_id, c.counted_by ?? '', night]);
    let group = countGroups.get(key);
    if (!group) {
      group = { key, type: 'recuento', at: c.counted_at, by: c.counted_by, trip_id: null,
        store_id: c.store_id, store_name: c.store_name, from_store_id: null, from_store_name: null,
        note: null, lines: [] };
      countGroups.set(key, group);
    }
    if (c.counted_at > group.at) group.at = c.counted_at;
    const qty = Number(c.qty);
    const expected = c.expected === null ? null : Number(c.expected);
    group.lines.push({ count_id: c.count_id, product_id: c.product_id, name: c.name, slug: c.slug,
      photo: c.photo, category: c.category, per_case: c.per_case === null ? null : Number(c.per_case),
      qty, expected, diff: expected === null ? null : qty - expected });
  }
  for (const [key, group] of countGroups) groups.set(key, group);
  let events = [...groups.values()].map((e) => ({ ...e, lines: e.lines.sort((a, b) =>
    (a.move_id ?? a.count_id) - (b.move_id ?? b.count_id)) }))
    .sort((a, b) => b.at.localeCompare(a.at) || b.key.localeCompare(a.key));
  const truncated = events.length > 200;
  events = events.slice(0, 200);
  return { ...info, truncated, events };
}

export async function voidMove(db, id, body = {}, { now } = {}) {
  const moveId = Number(id);
  if (!Number.isInteger(moveId) || moveId < 1) throw new HttpError(404, 'Movimiento no encontrado.');
  const reason = clean(body.reason, 200);
  if (!reason) throw invalid('Escribe el motivo.');
  const by = clean(body.by, 80) || null;
  const at = isoNow(now);
  return db.tx(async (t) => {
    const move = await t.get('SELECT * FROM stock_moves WHERE id = ? FOR UPDATE', moveId);
    if (!move) throw new HttpError(404, 'Movimiento no encontrado.');
    if (Number(move.voided)) throw new HttpError(409, 'Este movimiento ya está anulado.');
    await t.run(`UPDATE stock_moves SET voided = 1, voided_at = ?, voided_by = ?, void_reason = ? WHERE id = ?`,
      at, by, reason, moveId);
    const after = { kind: move.kind, product_id: move.product_id, from_store_id: move.from_store_id,
      to_store_id: move.to_store_id, qty: Number(move.qty), trip_id: move.trip_id, voided: 1 };
    await t.run(`INSERT INTO audit (at, actor, entity, entity_id, action, before, after, reason)
      VALUES (?, ?, 'almacen', ?, 'anular', ?, ?, ?)`, at, by, moveId,
    JSON.stringify({ voided: 0 }), JSON.stringify(after), reason);
    const updated = await t.get(`SELECT id, kind, product_id, from_store_id, to_store_id, qty, trip_id,
      voided, voided_at, voided_by, void_reason FROM stock_moves WHERE id = ?`, moveId);
    return { ok: true, move: { ...updated, qty: Number(updated.qty), voided: Number(updated.voided) } };
  });
}
