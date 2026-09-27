// Utilidades de fechas. Las fechas de negocio se manejan como texto 'YYYY-MM-DD'.
// Una "noche de trabajo" (sesión) empieza por la tarde y continúa después de
// medianoche: todo lo que ocurre antes de la hora de corte pertenece a la noche
// del día anterior.

const partsCache = new Map();

function formatter(tz) {
  if (!partsCache.has(tz)) {
    partsCache.set(tz, new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    }));
  }
  return partsCache.get(tz);
}

export function localParts(date, tz) {
  const out = {};
  for (const p of formatter(tz).formatToParts(date)) out[p.type] = p.value;
  return { ymd: `${out.year}-${out.month}-${out.day}`, hour: Number(out.hour) };
}

/** Fecha de la noche de trabajo a la que pertenece un instante. */
export function businessDate(date = new Date(), tz = 'Europe/Madrid', cutoffHour = 12) {
  const d = date instanceof Date ? date : new Date(date);
  const { ymd, hour } = localParts(d, tz);
  return hour < cutoffHour ? addDays(ymd, -1) : ymd;
}

function toUTC(ymd) {
  return new Date(`${ymd}T00:00:00Z`);
}

function fromUTC(d) {
  return d.toISOString().slice(0, 10);
}

export function isYmd(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(toUTC(s).getTime());
}

export function addDays(ymd, n) {
  const d = toUTC(ymd);
  d.setUTCDate(d.getUTCDate() + n);
  return fromUTC(d);
}

/** 0 = domingo … 6 = sábado */
export function weekday(ymd) {
  return toUTC(ymd).getUTCDay();
}

/** Lunes de la semana que contiene la fecha. */
export function weekStart(ymd) {
  const wd = weekday(ymd);
  return addDays(ymd, wd === 0 ? -6 : 1 - wd);
}

export function monthStart(ymd) {
  return `${ymd.slice(0, 7)}-01`;
}

export function monthEnd(ymd) {
  const d = toUTC(monthStart(ymd));
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return fromUTC(d);
}

export function daysBetween(from, to) {
  return Math.round((toUTC(to) - toUTC(from)) / 86400000);
}

export function datesBetween(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
  'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

export function shortDate(ymd) {
  const [, m, d] = ymd.split('-').map(Number);
  return `${d} ${MONTHS[m - 1].slice(0, 3)}`;
}

/** Rango de fechas de negocio para un periodo de informe. */
export function periodRange(period, ymd) {
  if (period === 'night') {
    return { from: ymd, to: ymd, label: `Noche del ${WEEKDAYS[weekday(ymd)]} ${shortDate(ymd)}` };
  }
  if (period === 'week') {
    const from = weekStart(ymd);
    const to = addDays(from, 6);
    return { from, to, label: `Semana del ${shortDate(from)} al ${shortDate(to)}` };
  }
  if (period === 'month') {
    const [y, m] = ymd.split('-').map(Number);
    return { from: monthStart(ymd), to: monthEnd(ymd), label: `${MONTHS[m - 1]} ${y}` };
  }
  throw new Error(`Periodo desconocido: ${period}`);
}

/** Fecha equivalente del periodo anterior (para comparar). */
export function previousPeriodDate(period, ymd) {
  if (period === 'night') return addDays(ymd, -1);
  if (period === 'week') return addDays(weekStart(ymd), -7);
  return addDays(monthStart(ymd), -1);
}
