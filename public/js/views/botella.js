// Informes → detalle de una botella: noches, reposiciones (con corrección),
// cortes de agotado, estado agotado/disponible y botellas por caja.
import { mget, mpost, mput } from '../api.js';
import { state, barName } from '../state.js';
import {
  raw, $, html, mount, fmt, plural, dateLabel, dateTimeLabel, timeLabel, toast, formDialog, confirmDialog, thumb,
} from '../ui.js';
import { icon } from '../icons.js';
import {
  filters, query, periodControls, applyFilterClick, applyRange, diffMarkup, casesLabel, basisTitle,
  nightChart, bindChart, selectColumn, onWidthChange,
} from './informes.js';

const back = () => html`
  <a class="inf-back" href="#/gestion/informes">${raw(icon('left', { size: 18 }))} Informes</a>`;

export async function renderBotella(root, rawId) {
  const id = Number(rawId);
  if (!Number.isInteger(id) || id < 1) {
    mount(root, html`${back()}<p class="empty">Producto no encontrado</p>`);
    return undefined;
  }

  let r = null;
  let products = null; // para los desplegables de corrección, se piden al usarlos

  const load = () => mget(`/api/informe/botella/${id}?${query()}`);

  const drawChart = () => {
    const box = $('#bt-chart', root);
    if (!box || !r) return;
    mount(box, nightChart(r.nights, { width: box.clientWidth - 24, bar: filters.bar, stock: true }));
    selectColumn(box, r.nights.length - 1);
  };

  const draw = () => {
    mount(root, view(r));
    const box = $('#bt-chart', root);
    if (box) {
      bindChart(box);
      drawChart();
    }
  };

  let requestId = 0;
  const refresh = async () => {
    const request = ++requestId;
    let result;
    try { result = await load(); } catch (err) {
      if (request !== requestId) return;
      throw err;
    }
    if (request !== requestId || !root.isConnected) return;
    r = result;
    draw();
  };

  const allProducts = async () => {
    products ??= await mget('/api/products');
    return products;
  };

  root.addEventListener('click', async (e) => {
    const t = e.target.closest('button');
    if (!t || !root.contains(t)) return;
    const d = t.dataset;
    try {
      if (d.stock !== undefined) {
        if (!await toggleStock(r.product)) return;
      } else if (d.perCase !== undefined) {
        if (!await editPerCase(r.product)) return;
      } else if (d.correct) {
        if (!await correct(r, Number(d.correct), await allProducts())) return;
      } else if (d.addManual !== undefined) {
        if (!await addManual(r, await allProducts())) return;
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

  try {
    r = await load();
  } catch (err) {
    if (err.status !== 404) throw err;
    mount(root, html`${back()}<p class="empty">${err.message}</p>`);
    return undefined;
  }
  draw();
  return onWidthChange(root, drawChart);
}

function view(r) {
  const p = r.product;
  const multiBar = !r.bar_id && state.bars.length > 1;
  const meta = [
    p.group ? p.group.name : 'Fuera de la selección',
    p.capacity_ml ? `${fmt(p.capacity_ml / 10)} cl` : '',
    state.categories.find((c) => c.id === p.category)?.name ?? '',
  ].filter(Boolean).join(' · ');

  return html`
    <div class="inf bt">
      ${back()}

      <header class="bt-head">
        ${thumb(p, 'lg')}
        <div class="bt-title">
          <h2>${p.name}</h2>
          <p class="muted small">${meta}</p>
          <p class="bt-tags">
            ${p.out_of_stock ? html`<span class="tag danger">Agotado${p.out_of_stock_since ? ` desde ${dateTimeLabel(p.out_of_stock_since)}` : ''}</span>`
    : html`<span class="tag ok">Disponible</span>`}
            ${!p.active ? html`<span class="tag">Oculto</span>` : ''}
            ${p.status === 'pendiente' ? html`<span class="tag warn">Por confirmar</span>` : ''}
          </p>
        </div>
      </header>

      <div class="bt-actions">
        <button type="button" class="btn ${p.out_of_stock ? 'primary' : 'ghost danger'}" data-stock>
          ${p.out_of_stock ? 'Marcar disponible' : 'Marcar agotado'}</button>
        <button type="button" class="btn ghost" data-per-case>
          ${raw(icon('pencil', { size: 16 }))} ${p.per_case ? `${fmt(p.per_case)} por caja` : 'Botellas por caja: sin definir'}</button>
      </div>

      ${periodControls(r)}

      <div class="kpis">
        <div class="kpi main"><span>${basisTitle(r.basis)}</span><b>${fmt(r.bottles)}</b>
          <small>${r.previousRange ? html`${diffMarkup(r.diff)} frente a ${r.previousRange.label.toLowerCase()} (${fmt(r.previous)})` : ''}</small></div>
        ${r.cases ? html`<div class="kpi"><span>En cajas de ${fmt(p.per_case)}</span><b class="kpi-text">${casesLabel(r.cases) || '0'}</b></div>` : ''}
        ${multiBar ? state.bars.map((b) => html`
          <div class="kpi bar-${b.id}"><span>${b.name}</span><b>${fmt(r.byBar?.[b.id] || 0)}</b></div>`) : ''}
        ${r.stockout_nights ? html`<div class="kpi alert"><span>Noches agotado</span><b>${fmt(r.stockout_nights)}</b></div>` : ''}
        ${r.unserved ? html`<div class="kpi"><span>Pedidas sin llegar</span><b>${fmt(r.unserved)}</b></div>` : ''}
      </div>

      ${r.nights.length > 1 ? html`
        <h3 class="section-title">Por noche</h3>
        <div class="chart-box" id="bt-chart"></div>` : ''}

      <div class="inf-list-head">
        <h3 class="section-title">Reposiciones</h3>
        <button type="button" class="btn small ghost" data-add-manual>${raw(icon('plus', { size: 16 }))} Añadir olvidada</button>
      </div>
      ${r.deliveries.length ? html`<ul class="bt-dels">${r.deliveries.map((d) => html`
        <li class="${d.qty === 0 ? 'void' : ''}">
          <span class="bt-del-text">
            <b>${dateLabel(d.business_date)} · ${timeLabel(d.delivered_at)}</b>
            <small><span class="bar-tag bar-${d.bar_id}">${barName(d.bar_id)}</span>${d.delivered_by ? ` · ${d.delivered_by}` : ''}
              ${d.corrected ? html` <span class="tag">editada</span>` : ''}</small>
          </span>
          <span class="bt-del-qty">${fmt(d.qty)}</span>
          <button type="button" class="icon-btn" data-correct="${d.id}" aria-label="Corregir reposición del ${dateLabel(d.business_date)} a las ${timeLabel(d.delivered_at)}">${raw(icon('pencil', { size: 18 }))}</button>
        </li>`)}</ul>` : html`<p class="empty">Sin reposiciones en este periodo.</p>`}

      ${r.stockouts.length ? html`
        <h3 class="section-title">Agotado</h3>
        <ul class="bt-cuts">${r.stockouts.map((s) => html`
          <li>
            <span><b>${dateTimeLabel(s.started_at)}</b>${s.started_by ? html` <small class="muted">${s.started_by}</small>` : ''}</span>
            <span class="muted">→</span>
            <span>${s.ended_at ? html`<b>${dateTimeLabel(s.ended_at)}</b>${s.ended_by ? html` <small class="muted">${s.ended_by}</small>` : ''}`
    : html`<span class="tag danger">Sigue agotado</span>`}</span>
            <small class="muted">${plural(s.nights, 'noche', 'noches')}</small>
          </li>`)}</ul>` : ''}
    </div>`;
}

// ------------------------------------------------------------------ acciones

async function toggleStock(p) {
  const out = !p.out_of_stock;
  const ok = await confirmDialog(out ? 'Marcar agotado' : 'Marcar disponible', p.name,
    { ok: out ? 'Marcar agotado' : 'Marcar disponible', kind: out ? 'danger' : 'primary' });
  if (!ok) return false;
  await mpost(`/api/products/${p.id}/stock`, { out_of_stock: out, by: state.who });
  const local = state.products.find((x) => x.id === p.id);
  if (local) local.out_of_stock = out ? 1 : 0;
  toast(out ? 'Marcada como agotada' : 'Marcada como disponible');
  return true;
}

async function editPerCase(p) {
  const data = await formDialog('Botellas por caja', html`
    <p class="muted small">${p.name}</p>
    <label class="field"><span>Botellas por caja</span>
      <input name="per_case" type="number" min="1" max="10000" step="1" inputmode="numeric"
        value="${p.per_case ?? ''}" placeholder="Sin confirmar" autofocus></label>`);
  if (!data) return false;
  const v = data.per_case.trim();
  const perCase = v === '' ? null : Number(v);
  if (perCase === p.per_case) return false;
  await mput(`/api/products/${p.id}`, { per_case: perCase, by: state.who });
  toast('Guardado');
  return true;
}

function productOptions(products, selected) {
  return products.filter((x) => x.active || x.id === selected).map((x) => html`
    <option value="${x.id}" ${x.id === selected ? 'selected' : ''}>${x.name}</option>`);
}

function barOptions(selected) {
  return state.bars.map((b) => html`<option value="${b.id}" ${b.id === selected ? 'selected' : ''}>${b.name}</option>`);
}

async function correct(r, delId, products) {
  const d = r.deliveries.find((x) => x.id === delId);
  if (!d) return false;
  const data = await formDialog('Corregir reposición', html`
    <p class="muted small">${dateLabel(d.business_date)} · ${dateTimeLabel(d.delivered_at)}${d.delivered_by ? ` · ${d.delivered_by}` : ''}</p>
    <label class="field"><span>Botella</span><select name="product_id">${productOptions(products, r.product.id)}</select></label>
    <label class="field"><span>Barra</span><select name="bar_id">${barOptions(d.bar_id)}</select></label>
    <label class="field"><span>Botellas (0 para anularla)</span><input name="qty" type="number" min="0" max="999" inputmode="numeric" value="${d.qty}" required></label>
    <label class="field"><span>Motivo</span><input name="reason" maxlength="300" required placeholder="Ej.: se marcó en la barra equivocada"></label>`);
  if (!data) return false;
  await mput(`/api/deliveries/${delId}`, {
    ...data, qty: Number(data.qty), bar_id: Number(data.bar_id), product_id: Number(data.product_id), by: state.who,
  });
  toast('Corrección guardada');
  return true;
}

async function addManual(r, products) {
  const night = filters.period === 'custom' ? r.range.to : (r.date ?? filters.date ?? state.date);
  const data = await formDialog('Añadir reposición olvidada', html`
    <label class="field"><span>Noche</span><input name="date" type="date" value="${night > state.date ? state.date : night}" max="${state.date}" required></label>
    <label class="field"><span>Botella</span><select name="product_id">${productOptions(products, r.product.id)}</select></label>
    <label class="field"><span>Barra</span><select name="bar_id">${barOptions(filters.bar ? Number(filters.bar) : state.bars[0]?.id)}</select></label>
    <label class="field"><span>Botellas</span><input name="qty" type="number" min="1" max="999" inputmode="numeric" value="1" required></label>
    <label class="field"><span>Motivo</span><input name="reason" maxlength="300" required placeholder="Ej.: no se anotó durante la noche"></label>`);
  if (!data) return false;
  await mpost('/api/deliveries', {
    ...data, qty: Number(data.qty), bar_id: Number(data.bar_id), product_id: Number(data.product_id), by: state.who,
  });
  toast('Reposición añadida');
  return true;
}
