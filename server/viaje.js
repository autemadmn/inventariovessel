import { HttpError } from './errors.js';
import { stockRows, suggestions, writeAudit } from './almacen.js';

const bad = (message) => new HttpError(400, message);
const conflict = (message) => new HttpError(409, message);
const clean = (v, max = 80) => (typeof v === 'string' ? v.trim().slice(0, max) : '') || null;
const atOf = (now) => (now ?? new Date()).toISOString();
function int(v, label, min = 0) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > 10000) throw bad(`${label}: cantidad no válida.`);
  return n;
}

async function endpoints(db) {
  const [from, to] = await Promise.all([
    db.get("SELECT id, name, kind FROM stores WHERE kind = 'central' ORDER BY sort, id LIMIT 1"),
    db.get("SELECT id, name, kind FROM stores WHERE kind = 'local' ORDER BY sort, id LIMIT 1"),
  ]);
  if (!from || !to) throw bad('Faltan almacenes.');
  return { from, to };
}

export async function openTripSummary(db) {
  const trip = await db.get("SELECT id FROM trips WHERE status = 'abierto'");
  if (!trip) return null;
  const r = await db.get(`SELECT COUNT(*)::int AS lines,
    COALESCE(SUM(CASE WHEN checked = 1 THEN 1 ELSE 0 END), 0)::int AS checked
    FROM trip_lines WHERE trip_id = ? AND removed = 0`, trip.id);
  return { id: trip.id, lines: r.lines, checked: r.checked };
}

export async function tripView(db, { now } = {}) {
  const { from, to } = await endpoints(db);
  const trip = await db.get("SELECT id, status, created_at, created_by FROM trips WHERE status = 'abierto'");
  if (!trip) return { trip: null, from, to, lines: [], count: 0, checked: 0 };
  const [lines, stocks] = await Promise.all([
    db.all(`SELECT l.id, l.product_id, l.text, p.name, p.slug, p.photo, p.per_case,
      l.qty_planned, l.qty_loaded, l.checked, l.source, l.created_at, l.created_by
      FROM trip_lines l LEFT JOIN products p ON p.id = l.product_id
      WHERE l.trip_id = ? AND l.removed = 0 ORDER BY l.created_at, l.id`, trip.id),
    stockRows(db, from, atOf(now)),
  ]);
  const byProduct = new Map(stocks.map((r) => [r.product_id, Number(r.stock)]));
  const view = lines.map((l) => ({ ...l, out_stock: byProduct.get(l.product_id) ?? null }));
  return { trip, from, to, lines: view, count: view.length, checked: view.filter((l) => l.checked === 1).length };
}

async function lockedOpenTrip(t, at, by) {
  let created = await t.get(`INSERT INTO trips (status, created_at, created_by) VALUES ('abierto', ?, ?)
    ON CONFLICT (status) WHERE status = 'abierto' DO NOTHING RETURNING id`, at, by);
  if (created) await writeAudit(t, { at, by, action: 'viaje_creado', id: created.id, after: { status: 'abierto' } });
  let trip = await t.get("SELECT id, status FROM trips WHERE status = 'abierto' FOR UPDATE");
  if (!trip) {
    created = await t.get(`INSERT INTO trips (status, created_at, created_by) VALUES ('abierto', ?, ?)
      ON CONFLICT (status) WHERE status = 'abierto' DO NOTHING RETURNING id`, at, by);
    if (created) await writeAudit(t, { at, by, action: 'viaje_creado', id: created.id, after: { status: 'abierto' } });
    trip = await t.get("SELECT id, status FROM trips WHERE status = 'abierto' FOR UPDATE");
  }
  if (!trip) throw conflict('El viaje ha cambiado. Recarga e inténtalo de nuevo.');
  return trip;
}

export async function addTripLine(db, body = {}, { now } = {}) {
  const productId = body.product_id == null ? null : int(body.product_id, 'Botella', 1);
  if (body.text !== undefined && (typeof body.text !== 'string' || body.text.trim().length > 80)) {
    throw bad('La nota debe tener entre 1 y 80 caracteres.');
  }
  const note = clean(body.text);
  if (Boolean(productId) === Boolean(note)) throw bad('Elige una botella o escribe una nota.');
  const product = productId ? await db.get('SELECT id, per_case FROM products WHERE id = ?', productId) : null;
  if (productId && !product) throw bad('Hay un producto que no existe.');
  const qty = body.qty_planned == null ? null : int(body.qty_planned, 'Cantidad', 1);
  const at = atOf(now);
  const by = clean(body.by);
  const result = await db.tx(async (t) => {
    const trip = await lockedOpenTrip(t, at, by);
    if (productId) {
      const prior = await t.get(`SELECT id FROM trip_lines WHERE trip_id = ? AND product_id = ? AND removed = 0
        ORDER BY id LIMIT 1`, trip.id, productId);
      if (prior) return { addedId: null, already: true };
    }
    const suggested = productId && qty === null ? (await suggestions(t, { now })).get(productId) : null;
    const amount = productId ? qty ?? suggested ?? (Number(product.per_case) > 0 ? Number(product.per_case) : 1) : qty;
    const r = await t.get(`INSERT INTO trip_lines
      (trip_id, product_id, text, qty_planned, source, created_at, created_by)
      VALUES (?, ?, ?, ?, 'apunte', ?, ?) RETURNING id`, trip.id, productId, note, amount, at, by);
    await writeAudit(t, { at, by, action: 'viaje_linea', id: r.id,
      after: { trip_id: trip.id, product_id: productId, text: note, qty_planned: amount } });
    return { addedId: r.id, already: false };
  });
  const view = await tripView(db, { now });
  return { ...view, added: view.lines.find((l) => l.id === result.addedId) ?? null, already: result.already };
}

export async function addSuggested(db, body = {}, { now } = {}) {
  const at = atOf(now);
  const by = clean(body.by);
  const added = await db.tx(async (t) => {
    const trip = await lockedOpenTrip(t, at, by);
    const [suggested, products, existing] = await Promise.all([
      suggestions(t, { now }),
      t.all(`SELECT p.id, p.name, p.group_id, p.group_order, g.sort AS group_sort
        FROM products p LEFT JOIN product_groups g ON g.id = p.group_id
        ORDER BY CASE WHEN p.group_id IS NOT NULL AND p.active = 1
          AND p.status IN ('confirmado', 'pendiente') THEN 0 ELSE 1 END,
          g.sort NULLS LAST, p.group_order NULLS LAST, p.name, p.id`),
      t.all('SELECT product_id FROM trip_lines WHERE trip_id = ? AND removed = 0 AND product_id IS NOT NULL', trip.id),
    ]);
    const present = new Set(existing.map((r) => r.product_id));
    let n = 0;
    for (const p of products) {
      const qty = suggested.get(p.id);
      if (!qty || present.has(p.id)) continue;
      const r = await t.get(`INSERT INTO trip_lines
        (trip_id, product_id, qty_planned, source, created_at, created_by)
        VALUES (?, ?, ?, 'sugerido', ?, ?) RETURNING id`, trip.id, p.id, qty, at, by);
      await writeAudit(t, { at, by, action: 'viaje_sugerido', id: r.id,
        after: { trip_id: trip.id, product_id: p.id, qty_planned: qty } });
      n++;
    }
    return n;
  });
  return { ...await tripView(db, { now }), added };
}

async function lockedLine(t, id) {
  const line = await t.get(`SELECT l.*, tr.status FROM trip_lines l JOIN trips tr ON tr.id = l.trip_id
    WHERE l.id = ? FOR UPDATE OF tr, l`, id);
  if (!line || line.status !== 'abierto' || line.removed) throw conflict('Esta línea ya no está en el viaje.');
  return line;
}

export async function updateTripLine(db, id, body = {}, { now } = {}) {
  const lineId = int(id, 'Línea', 1);
  if (body.qty_planned === undefined && body.checked === undefined) throw bad('No hay cambios.');
  const at = atOf(now);
  const by = clean(body.by);
  await db.tx(async (t) => {
    const line = await lockedLine(t, lineId);
    if (body.qty_planned === null && line.product_id !== null) throw bad('La botella necesita una cantidad.');
    const qty = body.qty_planned === undefined ? line.qty_planned
      : body.qty_planned === null ? null : int(body.qty_planned, 'Cantidad', 1);
    if (body.checked !== undefined && body.checked !== 0 && body.checked !== 1) throw bad('Cargado no válido.');
    const checked = body.checked ?? line.checked;
    await t.run('UPDATE trip_lines SET qty_planned = ?, checked = ?, qty_loaded = ? WHERE id = ?',
      qty, checked, checked ? qty : null, lineId);
    await writeAudit(t, { at, by, action: 'viaje_editar', id: lineId,
      after: { qty_planned: qty, checked, qty_loaded: checked ? qty : null } });
  });
  return tripView(db, { now });
}

export async function removeTripLine(db, id, body = {}, { now } = {}) {
  const lineId = int(id, 'Línea', 1);
  const at = atOf(now);
  const by = clean(body.by);
  await db.tx(async (t) => {
    await lockedLine(t, lineId);
    await t.run('UPDATE trip_lines SET removed = 1, removed_at = ?, removed_by = ? WHERE id = ?', at, by, lineId);
    await writeAudit(t, { at, by, action: 'viaje_quitar', id: lineId, after: { removed: 1 } });
  });
  return tripView(db, { now });
}

export async function finishTrip(db, body = {}, { now } = {}) {
  const tripId = int(body.trip_id, 'Viaje', 1);
  const at = atOf(now);
  const by = clean(body.by);
  return db.tx(async (t) => {
    const trip = await t.get('SELECT id, status FROM trips WHERE id = ? FOR UPDATE', tripId);
    if (!trip || trip.status !== 'abierto') throw conflict('Este viaje ya está hecho.');
    const lines = await t.all('SELECT * FROM trip_lines WHERE trip_id = ? AND removed = 0 ORDER BY id FOR UPDATE', tripId);
    if (!lines.some((l) => l.checked === 1)) throw bad('Marca al menos una línea como cargada.');
    const { from, to } = await endpoints(t);
    let moves = 0;
    for (const line of lines) {
      if (!line.checked || !line.product_id) continue;
      if (!(line.qty_loaded > 0)) throw bad('Una botella cargada necesita una cantidad mayor que cero.');
      const r = await t.get(`INSERT INTO stock_moves
        (product_id, from_store_id, to_store_id, qty, kind, trip_id, created_at, created_by)
        VALUES (?, ?, ?, ?, 'traslado', ?, ?, ?) RETURNING id`,
      line.product_id, from.id, to.id, line.qty_loaded, tripId, at, by);
      await writeAudit(t, { at, by, action: 'traslado', id: r.id,
        after: { trip_id: tripId, product_id: line.product_id, qty: line.qty_loaded } });
      moves++;
    }
    await t.run("UPDATE trips SET status = 'hecho', done_at = ?, done_by = ? WHERE id = ?", at, by, tripId);
    const carry = lines.filter((l) => !l.checked);
    let nextTripId = null;
    if (carry.length) {
      const next = await t.get(`INSERT INTO trips (status, created_at, created_by)
        VALUES ('abierto', ?, ?) RETURNING id`, at, by);
      nextTripId = next.id;
      for (const line of carry) {
        await t.run(`INSERT INTO trip_lines
          (trip_id, product_id, text, qty_planned, source, created_at, created_by)
          VALUES (?, ?, ?, ?, ?, ?, ?)`, next.id, line.product_id, line.text,
        line.qty_planned, line.source, at, line.created_by);
      }
    }
    await writeAudit(t, { at, by, action: 'viaje_hecho', id: tripId,
      after: { moves, carried: carry.length, next_trip_id: nextTripId } });
    return { ok: true, trip_id: tripId, moves, carried: carry.length, next_trip_id: nextTripId };
  });
}
