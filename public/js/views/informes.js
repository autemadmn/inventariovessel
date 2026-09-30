// Informes: botellas por periodo, grupo y barra, con el detalle de cada botella.
// Los filtros (periodo, barra, grupo) se comparten con el detalle (botella.js).
import { mget, store } from '../api.js';
import { state, barName } from '../state.js';
import {
  raw, $, $$, html, mount, fmt, plural, dateLabel, addDays, toast, csv, downloadText, thumb, norm, WEEKDAYS_SHORT,
} from '../ui.js';
import { icon } from '../icons.js';

// ------------------------------------------------------------------ filtros compartidos

export const filters = {
  period: store.get('repPeriod', 'week'),
  date: null, // null = noche actual
  from: null,
  to: null,
  bar: '',
  group: store.get('repGroup', 'all'),
};
// «Fechas» no se recuerda entre sesiones: sin desde/hasta guardados se vuelve a Semana.
if (!['night', 'week', 'month'].includes(filters.period)) filters.period = 'week';

const PERIODS = [['night', 'Noche'], ['week', 'Semana'], ['month', 'Mes'], ['custom', 'Fechas']];

/** Parámetros de consulta del periodo y la barra (y el grupo si se pide). */
export function query({ group = false } = {}) {
  const q = new URLSearchParams({ period: filters.period });
  if (filters.period === 'custom') {
    q.set('from', filters.from);
    q.set('to', filters.to);
  } else if (filters.date) {
    q.set('date', filters.date);
  }
  if (filters.bar) q.set('bar_id', filters.bar);
  if (group) q.set('group', filters.group);
  return q.toString();
}

function shiftMonth(ymd, n) {
  const d = new Date(`${ymd.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}

/** Periodo, barras y paginado. `r` es la última respuesta (range, date). */
export function periodControls(r) {
  const today = state.date;
  const atToday = !filters.date || filters.date === today;
  return html`
    <div class="toolbar inf-filters">
      <div class="seg small" role="group" aria-label="Periodo">${PERIODS.map(([v, l]) => html`
        <button type="button" class="${filters.period === v ? 'on' : ''}" data-period="${v}" aria-pressed="${String(filters.period === v)}">${l}</button>`)}</div>
      ${state.bars.length > 1 ? html`
      <div class="seg small" role="group" aria-label="Barra">${[['', 'Ambas'], ...state.bars.map((b) => [String(b.id), b.name])].map(([v, l]) => html`
        <button type="button" class="${v ? `bar-${v}` : ''} ${filters.bar === v ? 'on' : ''}" data-bar="${v}" aria-pressed="${String(filters.bar === v)}">${l}</button>`)}</div>` : ''}
    </div>
    ${filters.period === 'custom' ? html`
      <form class="inf-range" id="inf-range">
        <label class="field"><span>Desde</span><input type="date" name="from" value="${filters.from}" max="${today}" required></label>
        <label class="field"><span>Hasta</span><input type="date" name="to" value="${filters.to}" max="${today}" required></label>
        <button class="btn primary">Ver</button>
      </form>
      <h2 class="inf-range-label">${r?.range?.label ?? ''}</h2>` : html`
      <div class="pager inf-pager">
        <button type="button" class="icon-btn" data-shift="-1" aria-label="Periodo anterior">${raw(icon('left', { size: 20 }))}</button>
        <h2>${r?.range?.label ?? ''}</h2>
        <button type="button" class="icon-btn" data-shift="1" aria-label="Periodo siguiente">${raw(icon('right', { size: 20 }))}</button>
        <button type="button" class="btn small ghost" data-today ${atToday ? 'disabled' : ''}>Hoy</button>
      </div>`}`;
}

/**
 * Aplica un clic de los controles de periodo. `range` es el rango que se ve
 * (para empezar «Fechas» desde él). Devuelve true si hay que volver a pedir datos.
 */
export function applyFilterClick(d, range) {
  if (d.period) {
    if (d.period === filters.period) return false;
    if (d.period === 'custom') {
      filters.from = range?.from ?? addDays(state.date, -6);
      filters.to = range?.to ?? state.date;
    }
    filters.period = d.period;
    store.set('repPeriod', filters.period);
    return true;
  }
  if (d.shift) {
    const n = Number(d.shift);
    const base = filters.date ?? state.date;
    filters.date = filters.period === 'night' ? addDays(base, n)
      : filters.period === 'week' ? addDays(base, 7 * n)
        : shiftMonth(base, n);
    return true;
  }
  if (d.today !== undefined) {
    filters.date = null;
    return true;
  }
  if (d.bar !== undefined) {
    if (d.bar === filters.bar) return false;
    filters.bar = d.bar;
    return true;
  }
  if (d.night) {
    filters.period = 'night';
    filters.date = d.night;
    store.set('repPeriod', filters.period);
    return true;
  }
  return false;
}

/** Envío del formulario de fechas. Devuelve true si son válidas. */
export function applyRange(form) {
  const { from, to } = Object.fromEntries(new FormData(form));
  if (!from || !to) return false;
  if (from > to) {
    toast('Revisa las fechas: el inicio es posterior al final.', 'error');
    return false;
  }
  filters.from = from;
  filters.to = to;
  return true;
}

// ------------------------------------------------------------------ formatos

export function diffLabel(n) {
  if (!n) return '=';
  return n > 0 ? `+${fmt(n)}` : `−${fmt(-n)}`;
}

export const diffMarkup = (n) => html`<span role="img" aria-label="${!n ? 'sin cambio' : `${fmt(Math.abs(n))} ${n > 0 ? 'más' : 'menos'}`}">${diffLabel(n)}</span>`;

export function casesLabel(c) {
  if (!c) return '';
  const parts = [];
  if (c.full) parts.push(plural(c.full, 'caja', 'cajas'));
  if (c.loose) parts.push(plural(c.loose, 'suelta', 'sueltas'));
  return parts.join(' + ');
}

export const basisTitle = (basis) => (basis === 'consumo' ? 'Consumo' : 'Botellas repuestas');

// ------------------------------------------------------------------ gráfica SVG

/** Máximo redondo del eje: dos líneas (mitad y máximo) con valores enteros. */
function niceMax(v) {
  const half = v / 2;
  if (half <= 1) return 2;
  const mag = 10 ** Math.floor(Math.log10(half));
  const m = [1, 2, 5, 10].find((k) => k * mag >= half);
  return m * mag * 2;
}

/** Rectángulo con las esquinas de arriba redondeadas (extremo de la columna). */
function topRounded(x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

const r1 = (n) => Math.round(n * 10) / 10;

/**
 * Columnas por noche, apiladas por barra. `nights`: [{ business_date, bottles,
 * byBar, out_of_stock? }]. Devuelve HTML (leyenda + SVG + lectura).
 */
export function nightChart(nights, { width = 600, bar = '', stock = false } = {}) {
  const bars = bar ? state.bars.filter((b) => String(b.id) === String(bar)) : state.bars;
  const n = nights.length;
  const H = 168;
  const top = 10;
  const bottom = stock ? 30 : 24;
  const left = 32;
  const right = 4;
  const W = Math.max(260, Math.floor(width));
  const plotW = W - left - right;
  const plotH = H - top - bottom;
  const max = niceMax(Math.max(1, ...nights.map((x) => x.bottles)));
  const step = plotW / n;
  const colW = Math.max(2, Math.min(40, step - Math.max(2, step * 0.3)));
  const base = top + plotH;
  const k = plotH / max;

  const grid = [0, max / 2, max].map((v) => {
    const y = r1(base - v * k);
    return `<line class="gridline${v ? '' : ' base'}" x1="${left}" x2="${W - right}" y1="${y}" y2="${y}"/>`
      + `<text class="ytick" x="${left - 6}" y="${y + 4}">${fmt(v)}</text>`;
  }).join('');

  const every = n <= 8 ? 1 : Math.ceil(n / 6);
  const cols = nights.map((night, i) => {
    const x = left + i * step + (step - colW) / 2;
    const segs = bars.map((b) => ({ b, v: night.byBar?.[b.id] || 0 })).filter((s) => s.v > 0);
    let cur = base;
    const marks = segs.map((s, j) => {
      const h = s.v * k;
      const y = cur - h;
      cur = y;
      const isTop = j === segs.length - 1;
      // 2 px de separación entre tramos apilados.
      const gap = !isTop && h > 3 ? 2 : 0;
      return isTop
        ? `<path class="mark bar-${s.b.id}" d="${topRounded(r1(x), r1(y), r1(colW), r1(h), 4)}"/>`
        : `<rect class="mark bar-${s.b.id}" x="${r1(x)}" y="${r1(y + gap)}" width="${r1(colW)}" height="${r1(h - gap)}"/>`;
    }).join('');
    const d = new Date(`${night.business_date}T00:00:00Z`);
    const tick = i % every === 0 || i === n - 1
      ? `<text class="xtick" x="${r1(left + i * step + step / 2)}" y="${base + 16}">${n <= 8
        ? `${WEEKDAYS_SHORT[d.getUTCDay()]} ${d.getUTCDate()}`
        : dateLabel(night.business_date, { weekday: false })}</text>`
      : '';
    const out = stock && night.out_of_stock
      ? `<rect class="stock-mark" x="${r1(x)}" y="${base + 21}" width="${r1(colW)}" height="4" rx="2"/>` : '';
    const parts = [bottlesLabel(night.bottles)];
    if (bars.length > 1) parts.push(...bars.map((b) => `${b.name} ${fmt(night.byBar?.[b.id] || 0)}`));
    if (stock && night.out_of_stock) parts.push('agotado');
    const read = `${dateLabel(night.business_date)} · ${parts.join(' · ')}`;
    return `<g class="chart-col" data-i="${i}" data-night="${night.business_date}" data-read="${escAttr(read)}" aria-hidden="true">`
      + `<rect class="hit" x="${r1(left + i * step)}" y="${top}" width="${r1(step)}" height="${plotH + bottom}"/>`
      + `${marks}${out}</g>${tick}`;
  }).join('');

  return html`
    ${bars.length > 1 || stock ? html`<div class="chart-legend">
      ${bars.length > 1 ? bars.map((b) => html`<span class="key bar-${b.id}">${b.name}</span>`) : ''}
      ${stock ? html`<span class="key stock">Agotado</span>` : ''}</div>` : ''}
    <svg class="chart" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" tabindex="0" aria-label="Botellas por noche. Usa las flechas para recorrerlas">
      ${raw(grid)}${raw(cols)}
    </svg>
    <div class="chart-read"><button type="button" class="icon-btn" data-chart-shift="-1" aria-label="Noche anterior">${raw(icon('left', { size: 20 }))}</button>
      <span aria-live="polite"></span>
      <button type="button" class="icon-btn" data-chart-shift="1" aria-label="Noche siguiente">${raw(icon('right', { size: 20 }))}</button>
      <button type="button" class="btn small ghost" data-night="" hidden>Ver noche</button></div>`;
}

const bottlesLabel = (v) => plural(v, 'botella', 'botellas');
const escAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** Marca una columna: resalta y escribe su lectura debajo. */
export function selectColumn(box, i) {
  const svg = $('.chart', box);
  if (!svg) return;
  const cols = $$('.chart-col', svg);
  const col = cols[Math.max(0, Math.min(cols.length - 1, i))];
  if (!col) return;
  for (const c of cols) c.classList.toggle('on', c === col);
  svg.classList.add('has-sel');
  svg.setAttribute('aria-label', `Botellas por noche. ${col.dataset.read}. Usa las flechas para recorrerlas`);
  const read = $('.chart-read', box);
  read.querySelector('span').textContent = col.dataset.read;
  const go = read.querySelector('button[data-night]');
  go.dataset.night = col.dataset.night;
  go.hidden = filters.period === 'night';
  read.querySelector('[data-chart-shift="-1"]').disabled = col === cols[0];
  read.querySelector('[data-chart-shift="1"]').disabled = col === cols.at(-1);
}

/** Puntero, toque y teclado sobre las columnas de la gráfica dentro de `box`. */
export function bindChart(box) {
  const pick = (e) => {
    const col = e.target.closest?.('.chart-col');
    if (col && box.contains(col)) selectColumn(box, Number(col.dataset.i));
  };
  box.addEventListener('pointerover', pick);
  box.addEventListener('focusin', pick);
  box.addEventListener('click', pick);
  box.addEventListener('click', (e) => {
    const shift = e.target.closest?.('[data-chart-shift]');
    if (!shift) return;
    e.stopPropagation();
    const current = Number($('.chart-col.on', box)?.dataset.i ?? 0);
    selectColumn(box, current + Number(shift.dataset.chartShift));
  });
  box.addEventListener('keydown', (e) => {
    if (!e.target.matches?.('.chart')) return;
    const i = Number($('.chart-col.on', box)?.dataset.i ?? 0);
    const next = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1
      : e.key === 'Home' ? 0 : e.key === 'End' ? $$('.chart-col', box).length - 1 : null;
    if (next === null) return;
    e.preventDefault();
    selectColumn(box, next);
  });
}

/** Redibuja la gráfica al cambiar el ancho. Devuelve la función que lo quita. */
export function onWidthChange(el, fn) {
  let last = el.clientWidth;
  let t;
  const handler = () => {
    clearTimeout(t);
    t = setTimeout(() => {
      if (!el.isConnected || el.clientWidth === last) return;
      last = el.clientWidth;
      fn();
    }, 150);
  };
  window.addEventListener('resize', handler);
  return () => {
    clearTimeout(t);
    window.removeEventListener('resize', handler);
  };
}

// ------------------------------------------------------------------ vista

let q = '';

export async function renderInformes(root, rest = []) {
  if (rest[0] === 'botella') {
    const { renderBotella } = await import('./botella.js');
    return renderBotella(root, rest[1]);
  }

  let r = null;

  let requestId = 0;
  const load = async (id) => {
    try {
      return await mget(`/api/informe?${query({ group: true })}`);
    } catch (err) {
      if (id !== requestId) return null;
      // Un grupo borrado desde otro móvil: se vuelve a «Todos».
      if (err.status === 400 && filters.group !== 'all' && /grupo/i.test(err.message)) {
        filters.group = 'all';
        store.set('repGroup', 'all');
        return mget(`/api/informe?${query({ group: true })}`);
      } else {
        throw err;
      }
    }
  };

  const drawChart = () => {
    const box = $('#inf-chart', root);
    if (!box || !r) return;
    const nights = r.nights ?? [];
    mount(box, nightChart(nights, { width: box.clientWidth - 24, bar: filters.bar }));
    selectColumn(box, nights.length - 1);
  };

  const draw = () => {
    mount(root, view(r));
    const box = $('#inf-chart', root);
    if (box) {
      bindChart(box);
      drawChart();
    }
  };

  const refresh = async () => {
    const id = ++requestId;
    let result;
    try { result = await load(id); } catch (err) {
      if (id !== requestId) return;
      throw err;
    }
    if (id !== requestId || !root.isConnected) return;
    r = result;
    draw();
  };

  root.addEventListener('click', async (e) => {
    const t = e.target.closest('button');
    if (!t || !root.contains(t)) return;
    const d = t.dataset;
    try {
      if (d.group !== undefined) {
        if (d.group === filters.group) return;
        filters.group = d.group;
        store.set('repGroup', filters.group);
      } else if (d.csv !== undefined) {
        exportCsv(r);
        return;
      } else if (!applyFilterClick(d, r?.range)) {
        return;
      }
      await refresh();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  root.addEventListener('submit', async (e) => {
    if (e.target.id !== 'inf-range') return;
    e.preventDefault();
    if (!applyRange(e.target)) return;
    try {
      await refresh();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  root.addEventListener('input', (e) => {
    if (e.target.id !== 'inf-q') return;
    q = e.target.value;
    filterRows(root);
  });

  await refresh();
  return onWidthChange(root, drawChart);
}

/** Filtra la lista por nombre sin volver a pedir datos. */
function filterRows(root) {
  const nq = norm(q.trim());
  for (const li of $$('.inf-list li[data-name]', root)) li.hidden = Boolean(nq) && !li.dataset.name.includes(nq);
}

const groupLabel = (r, id) => (id === null || id === undefined
  ? 'Fuera de la selección'
  : r.groups.find((g) => g.id === id)?.name ?? 'Grupo');

function view(r) {
  const t = r.totals;
  const multiBar = !r.bar_id && state.bars.length > 1;
  const withData = r.products.filter((p) => p.bottles || p.previous);
  const zero = r.products.filter((p) => !p.bottles && !p.previous);
  const outNow = r.products.filter((p) => p.out_of_stock).length;
  const unserved = r.products.reduce((a, p) => a + (p.unserved || 0), 0);
  const maxGroup = Math.max(1, ...r.byGroup.map((g) => g.bottles));
  const groupChips = [['all', 'Todos'], ...r.groups.map((g) => [String(g.id), g.name]), ['none', 'Fuera de la selección']];

  return html`
    <div class="inf">
      ${periodControls(r)}

      <div class="chips wrap inf-groups" role="group" aria-label="Grupo">${groupChips.map(([v, l]) => html`
        <button type="button" class="chip ${filters.group === v ? 'on' : ''}" data-group="${v}" aria-pressed="${String(filters.group === v)}">${l}</button>`)}</div>

      <div class="kpis">
        <div class="kpi main"><span>${basisTitle(r.basis)}</span><b>${fmt(t.bottles)}</b>
          <small>${r.previousRange ? html`${diffMarkup(t.diff)} frente a ${r.previousRange.label.toLowerCase()} (${fmt(t.previous)})` : ''}</small></div>
        ${multiBar ? state.bars.map((b) => html`
          <div class="kpi bar-${b.id}"><span>${b.name}</span><b>${fmt(t.byBar?.[b.id] || 0)}</b></div>`) : ''}
        <div class="kpi ${outNow ? 'alert' : ''}"><span>Agotadas ahora</span><b>${fmt(outNow)}</b></div>
        ${unserved ? html`<div class="kpi"><span>Pedidas sin llegar</span><b>${fmt(unserved)}</b></div>` : ''}
      </div>

      ${r.nights.length > 1 ? html`
        <h3 class="section-title">Por noche</h3>
        <div class="chart-box" id="inf-chart"></div>` : ''}

      ${filters.group === 'all' && t.bottles > 0 ? html`
        <h3 class="section-title">Por grupo</h3>
        <ul class="inf-groups-list">${r.byGroup.map((g) => html`
          <li><button type="button" data-group="${g.group_id === null ? 'none' : String(g.group_id)}">
            <span class="name">${g.name}</span>
            <span class="barline"><i style="width:${(g.bottles / maxGroup) * 100}%"></i></span>
            <b>${fmt(g.bottles)}</b>
            <small>${r.previousRange ? diffMarkup(g.bottles - g.previous) : ''}</small>
          </button></li>`)}</ul>` : ''}

      <div class="inf-list-head">
        <h3 class="section-title">${r.group ? r.group.name : 'Botellas'}</h3>
        ${t.bottles ? html`<button type="button" class="btn small ghost" data-csv>${raw(icon('download', { size: 16 }))} CSV</button>` : ''}
      </div>
      ${r.products.length > 8 ? html`
        <label class="search inf-search">${raw(icon('search', { size: 18 }))}
          <input type="search" id="inf-q" placeholder="Buscar botella…" value="${q}" autocomplete="off" aria-label="Buscar botella"></label>` : ''}
      ${withData.length ? html`<ul class="inf-list">${withData.map((p) => row(r, p, multiBar))}</ul>`
    : html`<p class="empty">Sin reposiciones en este periodo.</p>`}
      ${zero.length ? html`
        <details class="collapse-box inf-zero">
          <summary>Sin reposiciones (${zero.length})</summary>
          <ul class="inf-list">${zero.map((p) => row(r, p, multiBar))}</ul>
        </details>` : ''}
    </div>`;
}

function row(r, p, multiBar) {
  const sub = [
    casesLabel(p.cases),
    multiBar && p.bottles ? state.bars.map((b) => `${b.name} ${fmt(p.byBar?.[b.id] || 0)}`).join(' · ') : '',
    filters.group === 'all' ? groupLabel(r, p.group_id) : '',
  ].filter(Boolean).join(' · ');
  return html`
    <li data-name="${norm(p.name)}" ${q && !norm(p.name).includes(norm(q.trim())) ? 'hidden' : ''}>
      <a class="inf-row ${p.bottles ? '' : 'zero'}" href="#/gestion/informes/botella/${p.product_id}">
        ${thumb(p, 'sm')}
        <span class="inf-text">
          <b>${p.name}</b>
          <span class="inf-tags">
            ${p.out_of_stock ? html`<span class="tag danger">Agotado</span>` : ''}
            ${!p.out_of_stock && p.stockout_nights ? html`<span class="tag">Estuvo agotado ${plural(p.stockout_nights, 'noche', 'noches')}</span>` : ''}
            ${p.unserved ? html`<span class="tag info">${fmt(p.unserved)} pedidas sin llegar</span>` : ''}
          </span>
          ${sub ? html`<small>${sub}</small>` : ''}
        </span>
        <span class="inf-num"><b>${fmt(p.bottles)}</b>${r.previousRange ? html`<small>${diffMarkup(p.diff)}</small>` : ''}</span>
        ${raw(icon('right', { size: 18 }))}
      </a>
    </li>`;
}

function exportCsv(r) {
  if (!r) return;
  const bars = r.bar_id ? state.bars.filter((b) => b.id === Number(r.bar_id)) : state.bars;
  const head = ['Botella', 'Grupo', ...bars.map((b) => b.name), 'Botellas', 'Por caja', 'Cajas', 'Sueltas',
    'Periodo anterior', 'Diferencia', 'Agotado ahora', 'Noches agotado', 'Pedidas sin llegar'];
  const rows = r.products.map((p) => [
    p.name, groupLabel(r, p.group_id), ...bars.map((b) => p.byBar?.[b.id] || 0), p.bottles,
    p.per_case ?? '', p.cases?.full ?? '', p.cases?.loose ?? '',
    r.previousRange ? p.previous : '', r.previousRange ? p.diff : '',
    p.out_of_stock ? 'Sí' : 'No', p.stockout_nights || 0, p.unserved || 0,
  ]);
  const title = [basisTitle(r.basis), r.range.label, r.group?.name, r.bar_id ? barName(r.bar_id) : ''].filter(Boolean).join(' · ');
  downloadText(`informe_${r.range.from}_${r.range.to}.csv`, csv([[title], head, ...rows]));
}
