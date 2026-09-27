// Informes: totales por producto, por barra y en conjunto, por noche, semana o mes.
// Correcciones del historial con constancia del cambio.
import { mget, mpost, mput, store } from '../api.js';
import { state, barName, productById } from '../state.js';
import {
  raw, $, html, mount, fmt, bottles, dateLabel, dateTimeLabel, addDays, toast, formDialog, csv, downloadText,
} from '../ui.js';
import { icon } from '../icons.js';

let period = store.get('repPeriod', 'week');
let refDate = null;
let bar = '';
let lastDels = [];

export async function renderInformes(root) {
  refDate ??= state.date;
  const products = await mget('/api/products');
  const byId = Object.fromEntries(products.map((p) => [p.id, p]));
  const name = (id) => byId[id]?.name ?? productById(id)?.name ?? `#${id}`;

  const draw = async () => {
    const r = await mget(`/api/report?period=${period}&date=${refDate}${bar ? `&bar_id=${bar}` : ''}`);
    const dels = await mget(`/api/deliveries?from=${r.range.from}&to=${r.range.to}${bar ? `&bar_id=${bar}` : ''}`);
    lastDels = dels;
    mount(root, view(r, dels, name));
  };

  root.addEventListener('click', async (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    const d = t.dataset;
    try {
      if (d.period) {
        period = d.period;
        store.set('repPeriod', period);
      } else if (d.shift) {
        const n = Number(d.shift);
        refDate = period === 'night' ? addDays(refDate, n)
          : period === 'week' ? addDays(refDate, 7 * n)
            : shiftMonth(refDate, n);
      } else if (d.today !== undefined) {
        refDate = state.date;
      } else if (d.bar !== undefined) {
        bar = d.bar;
      } else if (d.night) {
        period = 'night';
        refDate = d.night;
      } else if (d.correct) {
        if (!await correct(Number(d.correct), products)) return;
      } else if (d.addManual !== undefined) {
        if (!await addManual(products)) return;
      } else if (d.csv !== undefined) {
        const r = await mget(`/api/report?period=${period}&date=${refDate}${bar ? `&bar_id=${bar}` : ''}`);
        exportCsv(r, name);
        return;
      } else {
        return;
      }
      await draw();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  await draw();
}

function shiftMonth(ymd, n) {
  const d = new Date(`${ymd.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}

function view(r, dels, name) {
  const heading = r.consumption ? 'Consumo aproximado' : 'Botellas repuestas';
  const maxNight = Math.max(1, ...r.nights.map((n) => n.total));
  const diff = r.total - r.previousTotal;
  return html`
    <div class="toolbar">
      <div class="seg small">${[['night', 'Noche'], ['week', 'Semana'], ['month', 'Mes']].map(([v, l]) => html`
        <button type="button" class="${period === v ? 'on' : ''}" data-period="${v}">${l}</button>`)}</div>
      <div class="seg small">${[['', 'Ambas'], ...state.bars.map((b) => [String(b.id), b.name])].map(([v, l]) => html`
        <button type="button" class="${bar === v ? 'on' : ''}" data-bar="${v}">${l}</button>`)}</div>
    </div>
    <div class="pager">
      <button type="button" class="icon-btn" data-shift="-1" aria-label="Anterior">${raw(icon('left', { size: 18 }))}</button>
      <h2>${r.range.label}</h2>
      <button type="button" class="icon-btn" data-shift="1" aria-label="Siguiente">${raw(icon('right', { size: 18 }))}</button>
      <button type="button" class="btn small ghost" data-today>Hoy</button>
    </div>

    <div class="notice ${r.consumption ? 'ok' : ''}">
      ${r.consumption
    ? html`<b>Consumo aproximado.</b> En todas las noches del periodo las barras empezaron y terminaron con el mismo nivel de existencias, así que lo repuesto se aproxima a lo consumido.`
    : html`<b>Son botellas repuestas, no consumo exacto.</b> Solo equivalen al consumo si las barras empiezan y terminan la noche con el mismo nivel.
          ${r.nights.length ? html`Noches con mismo nivel: ${r.sameLevel.yes} · distinto: ${r.sameLevel.no} · sin indicar: ${r.sameLevel.unknown} (se indica en «Noches»).` : ''}`}
    </div>

    <div class="kpis">
      <div class="kpi"><span>${heading}</span><b>${fmt(r.total)}</b>
        <small>${r.previousRange ? html`${diff >= 0 ? '+' : ''}${fmt(diff)} frente a ${r.previousRange.label.toLowerCase()} (${fmt(r.previousTotal)})` : ''}</small></div>
      ${!r.bar_id ? state.bars.map((b) => html`<div class="kpi bar-${b.id}"><span>${b.name}</span><b>${fmt(r.byBar[b.id] || 0)}</b></div>`) : ''}
      <div class="kpi"><span>Noches con actividad</span><b>${r.nights.length}</b></div>
    </div>

    ${period !== 'night' && r.nights.length ? html`
      <h3 class="section-title">Por noche</h3>
      <ul class="nightbars">${r.nights.map((n) => html`
        <li><button type="button" class="link" data-night="${n.business_date}">${dateLabel(n.business_date)}</button>
          <span class="barline">${state.bars.map((b) => html`<i class="bar-${b.id}" style="width:${((n.perBar[b.id] || 0) / maxNight) * 100}%"></i>`)}</span>
          <b>${fmt(n.total)}</b></li>`)}</ul>` : ''}

    <h3 class="section-title">Por producto</h3>
    ${r.products.length ? html`
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Producto</th>
          ${!r.bar_id ? state.bars.map((b) => html`<th class="num">${b.name}</th>`) : ''}
          <th class="num">Total</th><th class="num">Anterior</th><th></th></tr></thead>
        <tbody>${r.products.map((p) => html`<tr>
          <td>${name(p.product_id)}</td>
          ${!r.bar_id ? state.bars.map((b) => html`<td class="num">${fmt(p.perBar[b.id] || 0)}</td>`) : ''}
          <td class="num"><b>${fmt(p.total)}</b></td>
          <td class="num muted">${fmt(p.previous)}</td>
          <td class="flags">
            ${r.stockouts[p.product_id] ? html`<span class="tag danger" title="Agotado en almacén durante el periodo: lo repuesto puede quedarse corto respecto a la demanda">Agotado ${r.stockouts[p.product_id]} noche(s)</span>` : ''}
            ${r.unserved[p.product_id] ? html`<span class="tag info" title="Pedidas y no entregadas">${r.unserved[p.product_id]} sin entregar</span>` : ''}
          </td></tr>`)}</tbody>
      </table></div>` : html`<p class="empty">No hay reposiciones registradas en este periodo.</p>`}

    <div class="row-actions">
      <button type="button" class="btn ghost" data-csv>Descargar CSV</button>
      <button type="button" class="btn ghost" data-add-manual>Añadir reposición olvidada</button>
    </div>

    <details class="collapse-box" ${period === 'night' ? 'open' : ''}>
    <summary>Detalle de reposiciones y correcciones (${dels.length})</summary>
    <p class="muted small">Si hay un error, corrígelo aquí. No se borra nada: el cambio queda anotado en «Cambios» con su motivo.</p>
    ${dels.length ? html`<div class="table-wrap"><table class="table">
      <thead><tr><th>Noche</th><th>Hora</th><th>Producto</th><th>Barra</th><th class="num">Botellas</th><th>Quién</th><th></th></tr></thead>
      <tbody>${dels.map((d) => html`<tr class="${d.qty === 0 ? 'muted' : ''}">
        <td>${dateLabel(d.business_date)}</td><td>${dateTimeLabel(d.delivered_at).split(', ').pop()}</td>
        <td>${d.product_name}</td><td><span class="bar-tag bar-${d.bar_id}">${barName(d.bar_id)}</span></td>
        <td class="num">${d.qty}${d.corrected ? html` <span class="tag" title="Corregida o añadida a posteriori">editada</span>` : ''}</td>
        <td>${d.delivered_by || ''}</td>
        <td><button type="button" class="btn small ghost" data-correct="${d.id}">Corregir</button></td></tr>`)}</tbody>
    </table></div>` : html`<p class="empty">Sin reposiciones.</p>`}
    </details>`;
}

function productOptions(products, selected) {
  return products.filter((p) => p.active || p.id === selected).map((p) => html`
    <option value="${p.id}" ${p.id === selected ? 'selected' : ''}>${p.name}</option>`);
}

async function correct(id, products) {
  const d = lastDels.find((x) => x.id === id);
  if (!d) return false;
  const data = await formDialog('Corregir reposición', html`
    <p class="muted small">Noche del ${dateLabel(d.business_date)} · registrada ${dateTimeLabel(d.delivered_at)}${d.delivered_by ? ` por ${d.delivered_by}` : ''}.</p>
    <label class="field"><span>Producto</span><select name="product_id">${productOptions(products, d.product_id)}</select></label>
    <label class="field"><span>Barra</span><select name="bar_id">${state.bars.map((b) => html`<option value="${b.id}" ${b.id === d.bar_id ? 'selected' : ''}>${b.name}</option>`)}</select></label>
    <label class="field"><span>Botellas (0 para anularla)</span><input name="qty" type="number" min="0" max="999" inputmode="numeric" value="${d.qty}" required></label>
    <label class="field"><span>Motivo (obligatorio)</span><input name="reason" maxlength="300" required placeholder="Ej.: se marcó en la barra equivocada"></label>`);
  if (!data) return false;
  await mput(`/api/deliveries/${id}`, { ...data, qty: Number(data.qty), bar_id: Number(data.bar_id), product_id: Number(data.product_id), by: state.who });
  toast('Corrección guardada');
  return true;
}

async function addManual(products) {
  const data = await formDialog('Añadir reposición olvidada', html`
    <label class="field"><span>Noche</span><input name="date" type="date" value="${refDate}" required></label>
    <label class="field"><span>Producto</span><select name="product_id">${productOptions(products)}</select></label>
    <label class="field"><span>Barra</span><select name="bar_id">${state.bars.map((b) => html`<option value="${b.id}">${b.name}</option>`)}</select></label>
    <label class="field"><span>Botellas</span><input name="qty" type="number" min="1" max="999" inputmode="numeric" value="1" required></label>
    <label class="field"><span>Motivo (obligatorio)</span><input name="reason" maxlength="300" required placeholder="Ej.: no se anotó durante la noche"></label>`);
  if (!data) return false;
  await mpost('/api/deliveries', { ...data, qty: Number(data.qty), bar_id: Number(data.bar_id), product_id: Number(data.product_id), by: state.who });
  toast('Reposición añadida');
  return true;
}

function exportCsv(r, name) {
  const head = ['Producto', ...state.bars.map((b) => b.name), 'Total', 'Periodo anterior'];
  const rows = r.products.map((p) => [name(p.product_id), ...state.bars.map((b) => p.perBar[b.id] || 0), p.total, p.previous]);
  const title = r.consumption ? 'Consumo aproximado' : 'Botellas repuestas';
  downloadText(`${title.toLowerCase().replace(/ /g, '-')}_${r.range.from}_${r.range.to}.csv`,
    csv([[`${title} · ${r.range.label}`], head, ...rows]));
}
