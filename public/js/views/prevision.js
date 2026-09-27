// Previsión de botellas para la próxima semana o mes a partir del historial.
import { mpost, store } from '../api.js';
import { state } from '../state.js';
import {
  raw, $, html, mount, fmt, norm, dateLabel, addDays, toast, WEEKDAYS_SHORT, WEEKDAYS_LONG,
} from '../ui.js';
import { icon } from '../icons.js';

const DEFAULTS = {
  target: 'week', target_from: '', target_to: '',
  base: '8w', base_from: '', base_to: '',
  weekdays: null, closed_dates: [], extra_dates: [],
  method: 'auto', event_pct: 0, safety_pct: null,
  manual: {}, event_overrides: {},
};

let p = { ...DEFAULTS, ...store.get('forecast', {}) };
let onlyUsed = true;
let search = '';
let last = null;

function save() {
  store.set('forecast', p);
}

function monday(ymd) {
  const wd = new Date(`${ymd}T00:00:00Z`).getUTCDay();
  return addDays(ymd, wd === 0 ? -6 : 1 - wd);
}

function monthBounds(ymd, offset) {
  const d = new Date(`${ymd.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + offset);
  const from = d.toISOString().slice(0, 10);
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return [from, d.toISOString().slice(0, 10)];
}

/** Convierte las opciones rápidas en fechas concretas. */
export function resolveRanges(params, today) {
  let tf;
  let tt;
  if (params.target === 'week') {
    tf = addDays(monday(today), 7);
    tt = addDays(tf, 6);
  } else if (params.target === 'month') {
    [tf, tt] = monthBounds(today, 1);
  } else {
    tf = params.target_from || today;
    tt = params.target_to || addDays(tf, 6);
  }
  let bf;
  let bt = addDays(today, -1);
  if (params.base === 'prevmonth') {
    [bf, bt] = monthBounds(today, -1);
  } else if (params.base === 'custom') {
    bf = params.base_from || addDays(bt, -27);
    bt = params.base_to || bt;
  } else {
    const weeks = Number(params.base.replace('w', '')) || 8;
    bf = addDays(bt, -(weeks * 7) + 1);
  }
  return { target_from: tf, target_to: tt, base_from: bf, base_to: bt };
}

async function compute() {
  const ranges = resolveRanges(p, state.date);
  last = await mpost('/api/forecast', {
    ...ranges,
    weekdays: p.weekdays,
    closed_dates: p.closed_dates,
    extra_dates: p.extra_dates,
    method: p.method,
    event_pct: Number(p.event_pct) || 0,
    safety_pct: p.safety_pct ?? state.settings.safety_pct,
    manual: p.manual,
    event_overrides: p.event_overrides,
  });
  return last;
}

export async function renderPrevision(root) {
  const draw = async () => {
    const focus = document.activeElement?.dataset?.key;
    const f = await compute();
    mount(root, view(f));
    if (focus) root.querySelector(`[data-key="${focus}"]`)?.focus();
  };

  root.addEventListener('change', async (e) => {
    const t = e.target;
    const d = t.dataset;
    if (d.param) {
      p[d.param] = t.type === 'number' ? (t.value === '' ? null : Number(t.value)) : t.value;
    } else if (d.manual) {
      if (t.value === '') delete p.manual[d.manual];
      else p.manual[d.manual] = Math.max(0, Number(t.value) || 0);
    } else if (d.event) {
      if (t.value === '') delete p.event_overrides[d.event];
      else p.event_overrides[d.event] = Number(t.value) || 0;
    } else if (d.closed) {
      if (t.value && !p.closed_dates.includes(t.value)) p.closed_dates.push(t.value);
    } else if (d.extra) {
      if (t.value && !p.extra_dates.includes(t.value)) p.extra_dates.push(t.value);
    } else if (d.onlyUsed !== undefined) {
      onlyUsed = t.checked;
      mount(root, view(last));
      return;
    } else {
      return;
    }
    save();
    try {
      await draw();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  root.addEventListener('input', (e) => {
    if (e.target.id === 'fc-search') {
      search = e.target.value;
      mount($('#fc-rows'), rowsHtml(last));
    }
  });

  root.addEventListener('click', async (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    const d = t.dataset;
    if (d.wd !== undefined) {
      const current = new Set(p.weekdays ?? last.params.weekdays);
      const wd = Number(d.wd);
      if (current.has(wd)) current.delete(wd);
      else current.add(wd);
      p.weekdays = [...current].sort();
    } else if (d.rmClosed) {
      p.closed_dates = p.closed_dates.filter((x) => x !== d.rmClosed);
    } else if (d.rmExtra) {
      p.extra_dates = p.extra_dates.filter((x) => x !== d.rmExtra);
    } else if (d.reset !== undefined) {
      p = { ...DEFAULTS, manual: {}, event_overrides: {} };
    } else if (d.clearManual !== undefined) {
      p.manual = {};
      p.event_overrides = {};
    } else if (d.purchase !== undefined) {
      await createPurchase();
      return;
    } else {
      return;
    }
    save();
    try {
      await draw();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  await draw();
}

function view(f) {
  const s = f.summary;
  const wds = new Set(f.params.weekdays);
  const methodLabel = s.methodUsed === 'weekday' ? 'por día de la semana' : 'promedio por noche';
  const baseDetail = Object.entries(s.baseByWeekday).sort(([a], [b]) => a - b)
    .map(([wd, n]) => `${n} ${WEEKDAYS_SHORT[wd]}`).join(', ');
  const plannedDetail = Object.entries(s.plannedByWeekday).sort(([a], [b]) => a - b)
    .map(([wd, n]) => `${n} ${WEEKDAYS_SHORT[wd]}`).join(', ');

  return html`
    <div class="form-grid">
      <label class="field"><span>Prever para</span>
        <select data-param="target">
          <option value="week" ${p.target === 'week' ? 'selected' : ''}>La semana que viene</option>
          <option value="month" ${p.target === 'month' ? 'selected' : ''}>El mes que viene</option>
          <option value="custom" ${p.target === 'custom' ? 'selected' : ''}>Otras fechas…</option>
        </select></label>
      ${p.target === 'custom' ? html`
        <label class="field"><span>Desde</span><input type="date" data-param="target_from" value="${f.params.target_from}"></label>
        <label class="field"><span>Hasta</span><input type="date" data-param="target_to" value="${f.params.target_to}"></label>` : ''}
      <label class="field"><span>Basado en el historial de</span>
        <select data-param="base">
          <option value="4w" ${p.base === '4w' ? 'selected' : ''}>Últimas 4 semanas</option>
          <option value="8w" ${p.base === '8w' ? 'selected' : ''}>Últimas 8 semanas</option>
          <option value="12w" ${p.base === '12w' ? 'selected' : ''}>Últimas 12 semanas</option>
          <option value="prevmonth" ${p.base === 'prevmonth' ? 'selected' : ''}>El mes pasado</option>
          <option value="custom" ${p.base === 'custom' ? 'selected' : ''}>Otras fechas…</option>
        </select></label>
      ${p.base === 'custom' ? html`
        <label class="field"><span>Historial desde</span><input type="date" data-param="base_from" value="${f.params.base_from}"></label>
        <label class="field"><span>Historial hasta</span><input type="date" data-param="base_to" value="${f.params.base_to}"></label>` : ''}
    </div>

    <p class="muted small">Previsión del ${dateLabel(f.params.target_from)} al ${dateLabel(f.params.target_to)} ·
      historial del ${dateLabel(f.params.base_from)} al ${dateLabel(f.params.base_to)}.</p>

    <div class="field"><span>Días de apertura previstos</span>
      <div class="chips wrap">${[1, 2, 3, 4, 5, 6, 0].map((wd) => html`
        <button type="button" class="chip ${wds.has(wd) ? 'on' : ''}" data-wd="${wd}" aria-pressed="${wds.has(wd)}">${WEEKDAYS_SHORT[wd]}</button>`)}</div>
    </div>
    <div class="form-grid">
      <div class="field"><span>Noches cerradas (festivos, cierres)</span>
        <input type="date" data-closed min="${f.params.target_from}" max="${f.params.target_to}">
        <div class="chips wrap">${p.closed_dates.map((d) => html`<button type="button" class="chip" data-rm-closed="${d}">${dateLabel(d)} ${raw(icon('close', { size: 14 }))}</button>`)}</div></div>
      <div class="field"><span>Noches extra abiertas</span>
        <input type="date" data-extra min="${f.params.target_from}" max="${f.params.target_to}">
        <div class="chips wrap">${p.extra_dates.map((d) => html`<button type="button" class="chip" data-rm-extra="${d}">${dateLabel(d)} ${raw(icon('close', { size: 14 }))}</button>`)}</div></div>
    </div>

    <div class="form-grid">
      <label class="field"><span>Método</span>
        <select data-param="method">
          <option value="auto" ${p.method === 'auto' ? 'selected' : ''}>Automático</option>
          <option value="average" ${p.method === 'average' ? 'selected' : ''}>Promedio por noche</option>
          <option value="weekday" ${p.method === 'weekday' ? 'selected' : ''} ${s.weekdayAvailable ? '' : 'disabled'}>Por día de la semana${s.weekdayAvailable ? '' : ' (faltan datos)'}</option>
        </select></label>
      <label class="field"><span>Ajuste por evento especial (%)</span>
        <input type="number" data-param="event_pct" data-key="event_pct" value="${p.event_pct || 0}" step="5" inputmode="numeric"></label>
      <label class="field"><span>Margen de seguridad (%)</span>
        <input type="number" data-param="safety_pct" data-key="safety_pct" value="${p.safety_pct ?? state.settings.safety_pct}" min="0" step="5" inputmode="numeric"></label>
    </div>

    <div class="notice">
      <p><b>Cómo se calcula:</b> ${s.methodUsed === 'weekday'
    ? 'para cada noche prevista se suma el promedio de las noches del mismo día de la semana en el historial.'
    : 'botellas repuestas en el historial ÷ noches del historial × noches previstas. Si un mes se repusieron 50 botellas y el siguiente tiene las mismas noches, la previsión es de unas 50.'}
      Después se aplica el ajuste por evento y el margen de seguridad.</p>
      <p>Historial: <b>${s.baseNights} noches</b>${baseDetail ? ` (${baseDetail})` : ''} · Previstas: <b>${s.plannedNights} noches</b>${plannedDetail ? ` (${plannedDetail})` : ''} · Método: <b>${methodLabel}</b>.</p>
      ${!s.weekdayAvailable && s.plannedNights ? html`<p class="muted small">Para distinguir días de la semana hacen falta al menos ${state.settings.min_nights_per_weekday} noches de historial de cada día previsto.</p>` : ''}
      <p class="muted small">Solo cuentan las botellas entregadas. Las pendientes o no servidas no se suman como consumo.</p>
    </div>

    ${s.lowData ? html`<div class="notice warn"><b>Todavía hay pocos datos</b> (${s.baseNights} ${s.baseNights === 1 ? 'noche' : 'noches'}; se recomiendan al menos ${state.settings.low_data_nights}).
      La previsión es solo orientativa: introduce una estimación manual en la columna «Manual» para los productos que conozcas.</div>` : ''}
    ${!s.plannedNights ? html`<div class="notice warn">Elige los días de apertura para calcular las noches previstas.</div>` : ''}

    <div class="toolbar">
      <input type="search" id="fc-search" placeholder="Buscar producto…" value="${search}" autocomplete="off">
      <label class="check"><input type="checkbox" data-only-used ${onlyUsed ? 'checked' : ''}> Solo con previsión</label>
    </div>
    <div id="fc-rows">${rowsHtml(f)}</div>

    <div class="row-actions">
      <button type="button" class="btn primary" data-purchase>Preparar lista de compra</button>
      <button type="button" class="btn ghost" data-clear-manual>Quitar ajustes manuales</button>
      <button type="button" class="btn ghost" data-reset>Restablecer</button>
    </div>`;
}

function explain(r) {
  const e = r.explanation;
  if (r.manual !== null) return `Estimación manual: ${fmt(r.manual)}`;
  if (e.type === 'weekday') {
    return e.parts.map((x) => `${WEEKDAYS_SHORT[x.weekday]} ${fmt(x.avg)} × ${x.nights}`).join(' + ') || '—';
  }
  return `${fmt(e.baseTotal)} en ${e.baseNights} noches = ${fmt(e.avg)}/noche × ${e.plannedNights}`;
}

function rowsHtml(f) {
  const names = Object.fromEntries(state.products.map((x) => [x.id, x.name]));
  const q = norm(search);
  const rows = f.rows.filter((r) => names[r.product_id]
    && (!q || norm(names[r.product_id]).includes(q))
    && (!onlyUsed || r.total > 0 || r.manual !== null || r.baseTotal > 0 || r.warnings.some((w) => w.code !== 'low_data')));
  const total = rows.reduce((a, r) => a + r.total, 0);
  if (!rows.length) {
    return html`<p class="empty">${onlyUsed ? 'Ningún producto tiene reposiciones en el historial. Desmarca «Solo con previsión» para introducir estimaciones manuales.' : 'Sin resultados.'}</p>`;
  }
  return html`<div class="table-wrap"><table class="table forecast cards">
    <thead><tr><th>Producto</th><th class="num">Historial</th><th class="num">Calculado</th>
      <th class="num">Manual</th><th class="num">Evento %</th><th class="num">Necesidad</th><th class="num">+ Margen</th><th class="num">Total</th></tr></thead>
    <tbody>${rows.map((r) => html`<tr class="${r.warnings.length ? 'has-warn' : ''}">
      <td><b>${names[r.product_id]}</b><small class="muted block">${explain(r)}</small>
        ${r.warnings.map((w) => html`<small class="warn-text block">${w.text}</small>`)}</td>
      <td class="num" data-label="Historial">${fmt(r.baseTotal)}</td>
      <td class="num" data-label="Calculado">${fmt(r.calculated)}</td>
      <td class="num" data-label="Manual"><input type="number" class="mini" min="0" step="1" inputmode="decimal" data-manual="${r.product_id}" data-key="m${r.product_id}" value="${r.manual ?? ''}" placeholder="—" aria-label="Estimación manual"></td>
      <td class="num" data-label="Evento %"><input type="number" class="mini" step="5" inputmode="numeric" data-event="${r.product_id}" data-key="e${r.product_id}" value="${p.event_overrides[r.product_id] ?? ''}" placeholder="${f.params.event_pct}" aria-label="Ajuste por evento"></td>
      <td class="num" data-label="Necesidad">${fmt(r.need)}</td>
      <td class="num" data-label="+ Margen">${fmt(r.safety)}</td>
      <td class="num" data-label="Total"><b>${fmt(r.total)}</b></td></tr>`)}</tbody>
    <tfoot><tr><td colspan="7">Total</td><td class="num"><b>${fmt(total)}</b></td></tr></tfoot>
  </table></div>`;
}

async function createPurchase() {
  const f = last;
  const lines = f.rows.filter((r) => r.total > 0)
    .map((r) => ({ product_id: r.product_id, need: r.need, safety: r.safety, stock: '', other_out: '', incoming: '' }));
  if (!lines.length) {
    toast('No hay productos con previsión. Introduce estimaciones manuales si hace falta.', 'error');
    return;
  }
  const wdText = f.params.weekdays.map((wd) => WEEKDAYS_LONG[wd]).join(', ');
  try {
    const list = await mpost('/api/purchases', {
      title: `Compra ${dateLabel(f.params.target_from, { weekday: false })} – ${dateLabel(f.params.target_to, { weekday: false })}`,
      params: {
        ...f.params,
        summary: f.summary,
        description: `${f.summary.plannedNights} noches previstas (${wdText}); historial de ${f.summary.baseNights} noches; margen ${f.summary.safetyPct}%${f.params.event_pct ? `; evento ${f.params.event_pct}%` : ''}.`,
      },
      lines,
      by: state.who,
    });
    location.hash = `#/gestion/compras/${list.id}`;
  } catch (err) {
    toast(err.message, 'error');
  }
}
