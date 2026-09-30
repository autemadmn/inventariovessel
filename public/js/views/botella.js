// Informes → detalle de una botella: total del periodo, cajas, reparto por barra
// y la evolución semanal de todo su histórico. Aquí mismo se cambian las botellas
// por caja y el estado agotado. Las reposiciones del periodo quedan plegadas al
// final, por si hay que corregir alguna.
import { mget, mpost, mput } from '../api.js';
import { state, barName } from '../state.js';
import {
  raw, $, html, mount, fmt, plural, dateLabel, dateTimeLabel, timeLabel, toast, formDialog, confirmDialog, thumb,
} from '../ui.js';
import { icon } from '../icons.js';
import {
  query, periodControls, applyPeriodClick, casesLabel, rangeLabel, busy, onWidthChange,
} from './informes.js';
import { weekChart, bindWeekChart, selectWeekPoint } from './weekly-chart.js';

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
  let open = false; // «Reposiciones» sigue abierto al volver a dibujar

  const load = () => mget(`/api/informe/botella/${id}?${query()}`);

  const drawChart = () => {
    const box = $('#bt-chart', root);
    if (!box || !r) return;
    const selected = Number($('.chart-week.on', box)?.dataset.i ?? r.weeks.length - 1);
    mount(box, weekChart(r.weeks, { width: box.clientWidth - 24 }));
    selectWeekPoint(box, selected);
  };

  const draw = () => {
    mount(root, view(r, open));
    $('#bt-dels', root)?.addEventListener('toggle', (e) => { open = e.target.open; });
    const box = $('#bt-chart', root);
    if (box) {
      bindWeekChart(box);
      drawChart();
    }
  };

  let requestId = 0;
  const refresh = async () => {
    const request = ++requestId;
    busy(root, true);
    try {
      const result = await load();
      if (request !== requestId || !root.isConnected) return;
      r = result;
      draw();
    } finally {
      if (request === requestId) busy(root, false);
    }
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
      } else if (!applyPeriodClick(d)) {
        return;
      }
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

function view(r, open) {
  const p = r.product;
  const bars = state.bars.length ? state.bars : [{ id: 1, name: 'Barra 1' }, { id: 2, name: 'Barra 2' }];
  const top = Math.max(1, ...bars.map((b) => r.byBar?.[b.id] || 0));
  const cases = r.bottles ? casesLabel(r.cases) : '';

  return html`
    <div class="inf bt">
      ${back()}

      <header class="bt-head">
        ${thumb(p, 'lg')}
        <div class="bt-title">
          <h2>${p.name}</h2>
          <p class="muted">${p.group ? p.group.name : 'Sin grupo'}</p>
          ${p.out_of_stock ? html`<span class="tag danger">Agotado</span>` : ''}
          <button type="button" class="btn small ghost" data-stock>
            ${p.out_of_stock ? 'Marcar disponible' : 'Marcar agotado'}</button>
        </div>
      </header>

      ${periodControls()}

      <section class="bt-total" aria-label="Botellas repuestas">
        <p class="bt-range">${rangeLabel(r)}</p>
        <p class="bt-big"><b>${fmt(r.bottles)}</b> ${r.bottles === 1 ? 'botella' : 'botellas'}</p>
        <div class="bt-cases">
          ${cases ? html`<span>${cases}</span>` : ''}
          <button type="button" class="link" data-per-case>${p.per_case
    ? html`${plural(p.per_case, 'botella', 'botellas')} por caja ${raw(icon('pencil', { size: 14 }))}`
    : 'Indicar botellas por caja'}</button>
        </div>
        <ul class="bt-bars">${bars.map((b) => html`
          <li class="bar-${b.id}">
            <span class="bar-tag bar-${b.id}">${b.name}</span>
            <span class="bt-barline"><i style="width:${((r.byBar?.[b.id] || 0) / top) * 100}%"></i></span>
            <b>${fmt(r.byBar?.[b.id] || 0)}</b>
          </li>`)}</ul>
      </section>

      <h3 class="section-title">Por semana</h3>
      ${r.weeks.length > 1 ? html`<div class="chart-box" id="bt-chart"></div>`
    : html`<p class="empty bt-empty">${r.weeks.length ? 'Solo hay una semana con reposiciones. La evolución aparecerá con las siguientes.' : 'Aún no se ha repuesto nunca.'}</p>`}

      <details class="bt-more" id="bt-dels" ${open ? 'open' : ''}>
        <summary>${raw(icon('right', { size: 18 }))} Reposiciones de este periodo · ${fmt(r.deliveries.length)}</summary>
        ${r.deliveries.length ? html`<ul class="bt-dels">${r.deliveries.map((d) => html`
          <li class="${d.qty === 0 ? 'void' : ''}">
            <span class="bt-del-text">
              <b>${dateLabel(d.business_date)} · ${timeLabel(d.delivered_at)}</b>
              <small><span class="bar-tag bar-${d.bar_id}">${barName(d.bar_id)}</span>
                ${d.corrected ? html` <span class="tag">editada</span>` : ''}</small>
            </span>
            <span class="bt-del-qty">${fmt(d.qty)}</span>
            <button type="button" class="icon-btn" data-correct="${d.id}" aria-label="Corregir reposición del ${dateLabel(d.business_date)} a las ${timeLabel(d.delivered_at)}">${raw(icon('pencil', { size: 18 }))}</button>
          </li>`)}</ul>` : ''}
        <button type="button" class="btn ghost" data-add-manual>${raw(icon('plus', { size: 16 }))} Añadir una olvidada</button>
      </details>
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
        value="${p.per_case ?? ''}" placeholder="Por ejemplo, 6" autofocus></label>`);
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
    <p class="muted small">${dateLabel(d.business_date)} · ${dateTimeLabel(d.delivered_at)}</p>
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
  const night = r.range.to > state.date ? state.date : r.range.to;
  const data = await formDialog('Añadir reposición olvidada', html`
    <label class="field"><span>Noche</span><input name="date" type="date" value="${night}" max="${state.date}" required></label>
    <label class="field"><span>Botella</span><select name="product_id">${productOptions(products, r.product.id)}</select></label>
    <label class="field"><span>Barra</span><select name="bar_id">${barOptions(state.bars[0]?.id)}</select></label>
    <label class="field"><span>Botellas</span><input name="qty" type="number" min="1" max="999" inputmode="numeric" value="1" required></label>
    <label class="field"><span>Motivo</span><input name="reason" maxlength="300" required placeholder="Ej.: no se anotó durante la noche"></label>`);
  if (!data) return false;
  await mpost('/api/deliveries', {
    ...data, qty: Number(data.qty), bar_id: Number(data.bar_id), product_id: Number(data.product_id), by: state.who,
  });
  toast('Reposición añadida');
  return true;
}
