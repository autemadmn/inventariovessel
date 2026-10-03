// El ticket y las fichas comparten el mismo ajuste, con historia de cada cambio.
import { HttpError } from './errors.js';
import { MAIN_STORE_SQL, recommendationData, writeAudit } from './almacen.js';
import { lockedOpenTrip } from './viaje.js';
import { quantity, operationKey, stockOperation } from './stock-operation.js';

const clean = (v) => (typeof v === 'string' ? v.trim().slice(0, 80) : '') || null;
const atOf = (now) => (now ?? new Date()).toISOString();
const eligible = (p) => p.active === 1 && ['confirmado', 'pendiente'].includes(p.status);
const conflict = () => new HttpError(409, 'Ya está en el pedido.');

async function snapshot(db, { now } = {}) {
  const [data, products, adjustments, trip, ordered] = await Promise.all([
    recommendationData(db, { now }),
    db.all(`SELECT p.id AS product_id, p.name, p.slug, p.photo, p.category, p.per_case,
        p.active, p.status, p.out_of_stock, p.group_id, p.group_order, g.sort AS group_sort,
        ${MAIN_STORE_SQL} AS main_store_id, st.name AS main_store_name
      FROM products p LEFT JOIN product_groups g ON g.id = p.group_id
      LEFT JOIN stores st ON st.id = ${MAIN_STORE_SQL}`),
    db.all("SELECT * FROM need_adjustments WHERE status = 'activo'"),
    db.get("SELECT id FROM trips WHERE status = 'abierto'"),
    db.all(`SELECT l.id, l.product_id FROM trip_lines l JOIN trips t ON t.id = l.trip_id
      WHERE t.status = 'abierto' AND l.removed = 0`),
  ]);
  const rates = [...data.products.values()].map((r) => r.weekly).filter((w) => w > 0).sort((a, b) => b - a);
  const adj = new Map(adjustments.map((r) => [r.product_id, r]));
  const present = new Set(ordered.map((r) => r.product_id));
  const lines = new Map();
  for (const p of products.filter(eligible)) {
    const r = data.products.get(p.product_id);
    const adjustment = adj.get(p.product_id);
    const perCase = Number(p.per_case) > 0 ? Number(p.per_case) : null;
    const unit = perCase ? 'cajas' : 'botellas';
    const recommended = r.bottles === null ? null : perCase ? Math.ceil(r.bottles / perCase) : r.bottles;
    let qty = recommended ?? 0;
    if (adjustment) {
      const bottles = adjustment.qty * (adjustment.unit === 'cajas' ? adjustment.per_case : 1);
      qty = perCase ? Math.ceil(bottles / perCase) : bottles;
    }
    const bottles = adjustment ? qty * (perCase ?? 1) : Math.min(qty * (perCase ?? 1), r.bottles ?? 0);
    const state = p.out_of_stock === 1 || (r.counted && r.stock <= 0) ? 'sin_stock'
      : r.stock > 0 && r.weekly > 0 && r.stock / r.weekly < data.trip_weeks ? 'queda_poco' : null;
    const rotation = r.weekly > 0 ? ['alta', 'media', 'baja'][Math.floor(3 * rates.indexOf(r.weekly) / rates.length)] : null;
    lines.set(p.product_id, {
      product_id: p.product_id, name: p.name, slug: p.slug, photo: p.photo, category: p.category,
      per_case: perCase, unit, qty, recommended, recommended_bottles: r.bottles, bottles,
      manual: Boolean(adjustment), adjusted: Boolean(adjustment) && qty !== (recommended ?? 0),
      adjusted_at: adjustment?.created_at ?? null, adjusted_by: adjustment?.created_by ?? null,
      state, rotation, weekly: r.weekly, stock: r.stock, out_stock: r.out,
      main_store_id: p.main_store_id, main_store_name: p.main_store_name, out_of_stock: p.out_of_stock,
    });
  }
  const rank = { sin_stock: 0, queda_poco: 1 };
  const ticket = [...lines.values()].filter((l) => !present.has(l.product_id)
    && (l.recommended > 0 || adj.has(l.product_id)))
    .sort((a, b) => (rank[a.state] ?? 2) - (rank[b.state] ?? 2) || b.weekly - a.weekly
      || a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }) || a.product_id - b.product_id);
  return { data, products, lines, ticket, adj, present, trip, ordered };
}

export async function needLines(db, { now, productIds } = {}) {
  const s = await snapshot(db, { now });
  // Una ficha o un ajuste puede necesitar la línea aunque aún no esté en el ticket.
  return productIds ? productIds.filter((id) => !s.present.has(id) && s.lines.has(id)).map((id) => s.lines.get(id)) : s.ticket;
}

export async function necesidades(db, { now } = {}) {
  const s = await snapshot(db, { now });
  const ticketIds = new Set(s.ticket.map((l) => l.product_id));
  const agotados = s.products.filter((p) => eligible(p) && s.lines.get(p.product_id).state === 'sin_stock')
    .sort((a, b) => Number(b.group_id !== null) - Number(a.group_id !== null)
      || (a.group_id !== null && b.group_id !== null
        ? (a.group_sort ?? 1e9) - (b.group_sort ?? 1e9) || (a.group_order ?? 1e9) - (b.group_order ?? 1e9) : 0)
      || a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }) || a.product_id - b.product_id)
    .map((p) => ({ product_id: p.product_id, name: p.name, slug: p.slug, photo: p.photo, category: p.category,
      reason: p.out_of_stock === 1 ? 'agotado_almacen' : 'sin_stock', stock: s.lines.get(p.product_id).stock,
      main_store_id: p.main_store_id, main_store_name: p.main_store_name,
      in_ticket: ticketIds.has(p.product_id), in_pedido: s.present.has(p.product_id) }));
  const totals = { products: 0, cajas: 0, botellas: 0 };
  for (const l of s.ticket) if (l.qty > 0) {
    totals.products++;
    totals.cajas += l.per_case ? Math.floor(l.bottles / l.per_case) : 0;
    totals.botellas += l.per_case ? l.bottles % l.per_case : l.bottles;
  }
  return { has_consumption: s.data.has_consumption, trip_weeks: s.data.trip_weeks,
    agotados, lines: s.ticket, totals, pedido: { trip_id: s.trip?.id ?? null, lines: s.ordered.length } };
}

export async function needFor(db, productId, store, { now } = {}) {
  if (!['alm-alcohol', 'alm-cerveza'].includes(store.map_key)) return null;
  const [line] = await needLines(db, { now, productIds: [productId] });
  return line?.main_store_id === store.id ? line : null;
}

async function lockedProduct(t, id) {
  const p = await t.get('SELECT id, active, status FROM products WHERE id = ? FOR NO KEY UPDATE', id);
  if (!p) throw new HttpError(400, 'Hay un producto que no existe.');
  if (!eligible(p)) throw new HttpError(400, 'Esta botella no se puede pedir.');
  if (await t.get(`SELECT l.id FROM trip_lines l JOIN trips tr ON tr.id = l.trip_id
    WHERE tr.status = 'abierto' AND l.removed = 0 AND l.product_id = ? LIMIT 1`, id)) throw conflict();
}

async function insertActive(t, line, qty, { at, by, action }) {
  const r = await t.get(`INSERT INTO need_adjustments
    (product_id, qty, unit, per_case, recommended, created_at, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`, line.product_id, qty, line.unit,
  line.per_case, line.recommended, at, by);
  await writeAudit(t, { at, by, action, id: r.id, after: { product_id: line.product_id,
    qty, unit: line.unit, per_case: line.per_case, recommended: line.recommended } });
  return { ...line, qty, bottles: qty * (line.per_case ?? 1), manual: true,
    adjusted: qty !== (line.recommended ?? 0), adjusted_at: at, adjusted_by: by };
}

export async function setNeed(db, id, body = {}, { now } = {}) {
  const productId = quantity(id, 'Botella');
  const qty = quantity(body.qty, 'Cantidad', { allowZero: true });
  const at = atOf(now), by = clean(body.by);
  return db.tx(async (t) => {
    await lockedProduct(t, productId);
    const [line] = await needLines(t, { now, productIds: [productId] });
    if (!['cajas', 'botellas'].includes(body.unit) || !Object.hasOwn(body, 'per_case')) {
      throw new HttpError(400, 'Indica la unidad y las botellas por caja de la cantidad.');
    }
    if (body.unit !== line.unit || body.per_case !== line.per_case) {
      throw new HttpError(409, 'Han cambiado las botellas por caja. Recarga y ajusta la cantidad.');
    }
    validateBottles({ ...line, qty }, qty * (line.per_case ?? 1));
    await t.run(`UPDATE need_adjustments SET status = 'sustituido', closed_at = ?, closed_by = ?
      WHERE product_id = ? AND status = 'activo'`, at, by, productId);
    return { ok: true, line: await insertActive(t, line, qty, { at, by, action: 'necesidad_ajuste' }) };
  });
}

export async function includeNeed(db, id, body = {}, { now } = {}) {
  const productId = quantity(id, 'Botella');
  const at = atOf(now), by = clean(body.by);
  return db.tx(async (t) => {
    await lockedProduct(t, productId);
    const s = await snapshot(t, { now });
    const line = s.lines.get(productId);
    if (s.adj.has(productId) || line.recommended > 0) return { ok: true, already: true, line };
    return { ok: true, already: false,
      line: await insertActive(t, line, line.recommended ?? 0, { at, by, action: 'necesidad_incluir' }) };
  });
}

export async function needsToTrip(db, body = {}, { now } = {}) {
  const key = operationKey(body.key), by = clean(body.by), at = atOf(now);
  const result = await db.tx(async (t) => {
    return stockOperation(t, key, { type: 'necesidades_pedido', by }, async () => {
      const trip = await lockedOpenTrip(t, at, by);
      // Mismo bloqueo que setNeed/includeNeed, en orden estable y antes de recalcular.
      // Evita perder un ajuste que se guarde mientras se está pasando al pedido.
      await t.all(`SELECT id FROM products WHERE active = 1 AND status IN ('confirmado', 'pendiente')
        ORDER BY id FOR NO KEY UPDATE`);
      const lines = await needLines(t, { now });
      // Validar el lote antes de escribir: ni ajustes SQL inválidos ni pedidos ineditables.
      for (const line of lines) if (line.qty > 0) validateBottles(line, line.bottles);
      const added = [];
      for (const line of lines) {
        if (line.qty <= 0) continue;
        if (await t.get('SELECT id FROM trip_lines WHERE trip_id = ? AND product_id = ? AND removed = 0 LIMIT 1',
          trip.id, line.product_id)) continue;
        const qty = line.bottles;
        const r = await t.get(`INSERT INTO trip_lines
          (trip_id, product_id, qty_planned, source, created_at, created_by)
          VALUES (?, ?, ?, ?, ?, ?) RETURNING id`, trip.id, line.product_id, qty,
        line.manual ? 'apunte' : 'sugerido', at, by);
        const closed = await t.run(`UPDATE need_adjustments SET status = 'pedido', trip_id = ?, trip_line_id = ?,
          closed_at = ?, closed_by = ? WHERE product_id = ? AND status = 'activo'`,
        trip.id, r.id, at, by, line.product_id);
        if (!closed.changes) await t.run(`INSERT INTO need_adjustments
          (product_id, qty, unit, per_case, recommended, status, created_at, created_by,
            closed_at, closed_by, trip_id, trip_line_id)
          VALUES (?, ?, ?, ?, ?, 'pedido', ?, ?, ?, ?, ?, ?)`, line.product_id, line.qty,
        line.unit, line.per_case, line.recommended, at, by, at, by, trip.id, r.id);
        const entry = { product_id: line.product_id, trip_line_id: r.id, qty_planned: qty };
        await writeAudit(t, { at, by, action: 'necesidades_al_pedido', id: r.id,
          after: { trip_id: trip.id, ...entry, qty: line.qty, unit: line.unit,
            recommended: line.recommended, recommended_bottles: line.recommended_bottles,
            manual: line.manual, per_case: line.per_case } });
        added.push(entry);
      }
      return { ok: true, added: added.length, trip_id: trip.id, lines: added };
    });
  });
  return { ...result, necesidades: await necesidades(db, { now }) };
}

function validateBottles(line, bottles) {
  if (!Number.isInteger(bottles) || bottles < 0 || bottles > 10000 || line.qty > 10000) {
    throw new HttpError(400, `${line.name}: como mucho 10.000 botellas. Reduce la cantidad antes de añadir al pedido.`);
  }
}
