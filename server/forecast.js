// Cálculo de previsión y de compra. Funciones puras, sin acceso a base de datos,
// para que el método sea fácil de revisar y de probar.

const round1 = (n) => Math.round(n * 10) / 10;

/**
 * Previsión de botellas necesarias por producto.
 *
 * Método por defecto: promedio por noche del periodo base × noches previstas.
 * Ejemplo: 50 botellas en 12 noches → 4,17/noche; si el periodo previsto tiene
 * 12 noches, la previsión es 50. Si tiene 15 noches, 62,5.
 *
 * Método por día de la semana: solo cuando cada día de la semana previsto tiene
 * al menos `minNightsPerWeekday` noches de historial. Se suma, noche a noche,
 * el promedio del mismo día de la semana.
 *
 * Solo se usan reposiciones entregadas. Las solicitudes pendientes o no
 * servidas se muestran como aviso y nunca se suman.
 */
export function computeForecast({
  products,
  baseNights, // [{ date, weekday }]
  deliveries, // [{ product_id, date, qty }]
  plannedNights, // [{ date, weekday }]
  method = 'auto', // auto | average | weekday
  minNightsPerWeekday = 3,
  lowDataNights = 4,
  eventPct = 0,
  eventOverrides = {}, // { product_id: pct }
  safetyPct = 0,
  manual = {}, // { product_id: botellas previstas introducidas a mano }
  stockoutNights = {}, // { product_id: nº de noches base con el producto agotado }
  currentlyOut = {}, // { product_id: true }
  unserved = {}, // { product_id: botellas pedidas y no entregadas en el periodo base }
}) {
  const nBase = baseNights.length;
  const nPlanned = plannedNights.length;
  const baseByWeekday = countBy(baseNights, (n) => n.weekday);
  const plannedByWeekday = countBy(plannedNights, (n) => n.weekday);
  const plannedWeekdays = Object.keys(plannedByWeekday).map(Number);

  const weekdayAvailable = nPlanned > 0 && plannedWeekdays.every(
    (wd) => (baseByWeekday[wd] || 0) >= minNightsPerWeekday,
  );
  let methodUsed = method === 'auto' ? (weekdayAvailable ? 'weekday' : 'average') : method;
  if (methodUsed === 'weekday' && !weekdayAvailable) methodUsed = 'average';

  const lowData = nBase < lowDataNights;
  const baseDates = new Set(baseNights.map((n) => n.date));
  const weekdayOfDate = Object.fromEntries(baseNights.map((n) => [n.date, n.weekday]));

  const totals = {};
  const totalsByWeekday = {};
  for (const d of deliveries) {
    if (!baseDates.has(d.date)) continue;
    totals[d.product_id] = (totals[d.product_id] || 0) + d.qty;
    const wd = weekdayOfDate[d.date];
    totalsByWeekday[d.product_id] ??= {};
    totalsByWeekday[d.product_id][wd] = (totalsByWeekday[d.product_id][wd] || 0) + d.qty;
  }

  const rows = products.map((p) => {
    const baseTotal = totals[p.id] || 0;
    const avgPerNight = nBase ? baseTotal / nBase : 0;
    let calculated;
    let explanation;

    if (methodUsed === 'weekday') {
      calculated = 0;
      const parts = [];
      for (const wd of plannedWeekdays.sort()) {
        const avg = (totalsByWeekday[p.id]?.[wd] || 0) / baseByWeekday[wd];
        calculated += avg * plannedByWeekday[wd];
        parts.push({ weekday: wd, avg: round1(avg), nights: plannedByWeekday[wd] });
      }
      explanation = { type: 'weekday', parts };
    } else {
      calculated = avgPerNight * nPlanned;
      explanation = { type: 'average', baseTotal, baseNights: nBase, avg: round1(avgPerNight), plannedNights: nPlanned };
    }

    const hasManual = manual[p.id] !== undefined && manual[p.id] !== null && manual[p.id] !== '';
    const base = hasManual ? Math.max(0, Number(manual[p.id]) || 0) : calculated;
    const pct = eventOverrides[p.id] !== undefined && eventOverrides[p.id] !== ''
      ? Number(eventOverrides[p.id]) || 0
      : Number(eventPct) || 0;
    const need = Math.max(0, base * (1 + pct / 100));
    const safety = need * ((Number(safetyPct) || 0) / 100);

    const warnings = [];
    if (stockoutNights[p.id]) {
      warnings.push({
        code: 'stockout',
        text: `Estuvo agotado en almacén ${stockoutNights[p.id]} noche(s) del periodo base: las reposiciones registradas pueden infravalorar su demanda.`,
      });
    }
    if (currentlyOut[p.id]) {
      warnings.push({ code: 'out_now', text: 'Ahora mismo está marcado como agotado en almacén.' });
    }
    if (unserved[p.id]) {
      warnings.push({
        code: 'unserved',
        text: `${unserved[p.id]} botella(s) pedidas no llegaron a entregarse. No se suman a la previsión; valóralo al ajustar.`,
      });
    }
    if (!hasManual && lowData) {
      warnings.push({ code: 'low_data', text: 'Pocos datos: conviene revisar o introducir una estimación manual.' });
    }

    return {
      product_id: p.id,
      baseTotal,
      avgPerNight: round1(avgPerNight),
      calculated: round1(calculated),
      manual: hasManual ? Number(manual[p.id]) : null,
      eventPct: pct,
      need: round1(need),
      safety: round1(safety),
      total: round1(need + safety),
      explanation,
      warnings,
    };
  });

  return {
    summary: {
      baseNights: nBase,
      plannedNights: nPlanned,
      baseByWeekday,
      plannedByWeekday,
      lowData,
      weekdayAvailable,
      methodUsed,
      safetyPct: Number(safetyPct) || 0,
      eventPct: Number(eventPct) || 0,
    },
    rows,
  };
}

/**
 * Botellas que comprar = necesidad prevista + margen de seguridad
 *                        − existencias disponibles − entregas previstas.
 *
 * Existencias disponibles = existencias utilizables del almacén − salidas
 * previstas hacia otros destinos (p. ej. VIP), nunca menos de 0.
 * El resultado nunca es negativo y se redondea hacia arriba a botellas enteras.
 */
export function computePurchase({ need = 0, safety = 0, stock = 0, otherOut = 0, incoming = 0, perCase = null }) {
  const n = (v) => Math.max(0, Number(v) || 0);
  const available = Math.max(0, n(stock) - n(otherOut));
  const raw = n(need) + n(safety) - available - n(incoming);
  // Pequeña tolerancia para que 5,0000001 no se convierta en 6.
  const bottles = raw <= 0 ? 0 : Math.ceil(raw - 1e-9);
  return { available, raw: round1(raw), bottles, ...casesFor(bottles, perCase) };
}

/** Expresa una cantidad de botellas en cajas. */
export function casesFor(bottles, perCase) {
  const pc = Number(perCase) || 0;
  if (pc <= 0) return { perCase: null, fullCases: null, loose: null, casesRoundedUp: null, extraIfCases: null };
  const fullCases = Math.floor(bottles / pc);
  const loose = bottles - fullCases * pc;
  const casesRoundedUp = Math.ceil(bottles / pc);
  return {
    perCase: pc,
    fullCases,
    loose,
    casesRoundedUp,
    extraIfCases: casesRoundedUp * pc - bottles,
  };
}

function countBy(list, key) {
  const out = {};
  for (const item of list) {
    const k = key(item);
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}
