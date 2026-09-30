// Reponer: lista compacta de lo que falta y un único botón «Hecho».
// Tocar una fila (opcional) permite indicar que se llevó menos, quitarla o
// marcar el producto como agotado en almacén.
import { post, store } from '../api.js';
import { state, subscribe, barName, loadLive, loadBootstrap } from '../state.js';
import {
  raw, $, html, mount, thumb, toast, buzz, bottles, confirmDialog, dialog, norm,
} from '../ui.js';
import { icon } from '../icons.js';

let filter = store.get('reponerFilter', 'all');
// Ajustes locales de «esta vez se lleva menos»: { lineId: botellas }.
const adjust = {};

export function renderReponer(root) {
  mount(root, html`<section class="reponer" id="reponer"></section>`);
  const el = $('#reponer');
  const draw = () => mount(el, view());
  el.addEventListener('click', onClick);
  draw();
  const unsub = subscribe(draw);
  return () => unsub();
}

function openLines() {
  return state.live.lines
    .filter((l) => l.qty_pending > 0 && (filter === 'all' || l.bar_id === Number(filter)));
}

const toDeliver = (l) => Math.min(adjust[l.id] ?? l.qty_pending, l.qty_pending);

function rowHtml(l) {
  const n = toDeliver(l);
  return html`
    <li>
      <button type="button" class="row ${l.out_of_stock ? 'out' : ''} ${n < l.qty_pending ? 'adjusted' : ''}" data-line="${l.id}">
        ${thumb(l, 'mini')}
        <span class="row-text">
          <b>${l.product_name}</b>
          <small>${l.out_of_stock ? html`<span class="danger">Agotado en almacén · </span>` : ''}Faltan ${l.qty_pending}${n < l.qty_pending ? html` · <span class="warn-text">se llevan ${n}</span>` : ''}</small>
        </span>
        <span class="row-qty">x${n}</span>
      </button>
    </li>`;
}

function view() {
  const lines = openLines();
  const total = lines.reduce((a, l) => a + toDeliver(l), 0);
  const pendingTotal = lines.reduce((a, l) => a + l.qty_pending, 0);
  const tabs = [['all', 'Todas'], ...state.bars.map((b) => [String(b.id), b.name])];
  const count = (v) => state.live.lines.filter((l) => l.qty_pending > 0 && (v === 'all' || l.bar_id === Number(v)))
    .reduce((a, l) => a + l.qty_pending, 0);

  const groups = filter === 'all'
    ? state.bars.map((b) => ({ bar: b, lines: lines.filter((l) => l.bar_id === b.id) })).filter((g) => g.lines.length)
    : [{ bar: null, lines }];

  return html`
    <div class="seg" role="tablist">
      ${tabs.map(([v, label]) => html`
        <button type="button" class="${filter === v ? 'on' : ''} ${v !== 'all' ? `bar-${v}` : ''}" data-filter="${v}">${label}
          ${count(v) ? html`<small>${count(v)}</small>` : ''}</button>`)}
    </div>

    ${lines.length ? html`
      <p class="status-line"><strong>Faltan ${bottles(pendingTotal)}</strong></p>
      ${groups.map((g) => html`
        ${g.bar ? html`<h2 class="group-title bar-${g.bar.id}">${g.bar.name}</h2>` : ''}
        <ul class="rows">${g.lines.map(rowHtml)}</ul>`)}
      <button type="button" class="btn primary big done-btn" data-done>
        Hecho${filter !== 'all' ? ` · ${barName(filter)}` : ''} (${bottles(total)})
      </button>
      <button type="button" class="link small stock-link" data-stock-panel>Agotados en almacén</button>`
    : html`
      <p class="empty">Nada pendiente${filter !== 'all' ? ` en ${barName(filter)}` : ''}.<br>Las peticiones nuevas aparecen aquí solas.</p>
      <button type="button" class="link small stock-link" data-stock-panel>Agotados en almacén</button>`}`;
}

async function onClick(e) {
  const t = e.target.closest('button');
  if (!t) return;
  const d = t.dataset;
  try {
    if (d.filter) {
      filter = d.filter;
      store.set('reponerFilter', filter);
      mount($('#reponer'), view());
    } else if (d.line) {
      await rowMenu(state.live.lines.find((l) => l.id === Number(d.line)));
    } else if (d.done !== undefined) {
      await complete();
    } else if (d.stockPanel !== undefined) {
      await stockPanel();
    }
  } catch (err) {
    toast(err.message, 'error');
    await loadLive().catch(() => {});
  }
}

async function complete() {
  const lines = openLines();
  const items = lines.map((l) => ({ line_id: l.id, qty: toDeliver(l), delivered: l.qty_delivered })).filter((i) => i.qty > 0);
  const total = items.reduce((a, i) => a + i.qty, 0);
  if (!items.length) return;
  const where = filter === 'all' ? '' : ` de ${barName(filter)}`;
  if (!await confirmDialog('¿Reposición hecha?', `Se registrarán ${bottles(total)} como repuestas${where}.`, { ok: 'Sí, hecho' })) return;
  let res;
  try {
    res = await post('/api/complete', { items, by: state.who });
  } catch (err) {
    if (err.status !== 409) throw err;
    // Otra persona ya lo ha repuesto: no es un fallo, solo se actualiza la lista.
    toast(err.message, 'info');
    await loadLive();
    return;
  }
  // Lo que quede pendiente vuelve a mostrarse completo la próxima vez.
  for (const l of lines) delete adjust[l.id];
  buzz(30);
  toast(res.bottles ? `Hecho: ${bottles(res.bottles)} repuestas` : 'Ya estaba hecho por otra persona');
  await loadLive();
}

/** Ajustes de una fila: llevar menos, quitarla de la lista o marcar agotado. */
async function rowMenu(l) {
  if (!l) return;
  let n = toDeliver(l);
  const choice = await dialog({
    title: l.product_name,
    body: html`
      <p class="muted">${barName(l.bar_id)} · faltan ${bottles(l.qty_pending)}</p>
      <div class="field"><span>Botellas que se llevan</span>
        <div class="stepper big-step">
          <button type="button" class="step" data-step="-1" aria-label="Una menos">${raw(icon('minus', { size: 22 }))}</button>
          <output id="adj-n">${n}</output>
          <button type="button" class="step" data-step="1" aria-label="Una más">${raw(icon('plus', { size: 22 }))}</button>
        </div>
        <small class="muted">Lo que no se lleve seguirá pendiente después de pulsar «Hecho».</small>
      </div>`,
    actions: [
      { label: 'Quitar de la lista', value: 'cancel', kind: 'ghost danger' },
      l.out_of_stock
        ? { label: 'Ya hay en almacén', value: 'available', kind: 'ghost' }
        : { label: 'Agotado en almacén', value: 'out', kind: 'ghost' },
      { label: 'Listo', value: 'ok', kind: 'primary' },
    ],
    onMount(dlg) {
      dlg.addEventListener('click', (e) => {
        const b = e.target.closest('[data-step]');
        if (!b) return;
        n = Math.max(0, Math.min(l.qty_pending, n + Number(b.dataset.step)));
        dlg.querySelector('#adj-n').textContent = n;
        buzz(8);
      });
    },
  });
  if (choice === 'ok') {
    if (n === l.qty_pending) delete adjust[l.id];
    else adjust[l.id] = n;
    mount($('#reponer'), view());
  } else if (choice === 'cancel') {
    if (!await confirmDialog('Quitar de la lista', `${l.product_name} (${bottles(l.qty_pending)}) dejará de estar pendiente para ${barName(l.bar_id)}.`, { ok: 'Quitar', kind: 'danger' })) return;
    await post(`/api/lines/${l.id}/cancel`, { by: state.who });
    delete adjust[l.id];
    toast('Quitado de la lista');
    await loadLive();
  } else if (choice === 'out' || choice === 'available') {
    await setStock(l.product_id, choice === 'out');
    await loadLive();
  }
}

async function setStock(productId, out) {
  await post(`/api/products/${productId}/stock`, { out_of_stock: out, by: state.who });
  toast(out ? 'Marcado como agotado en almacén' : 'Marcado como disponible');
  await loadBootstrap();
}

/** Panel para marcar cualquier producto como agotado o disponible en almacén. */
async function stockPanel() {
  let q = '';
  const body = () => {
    const nq = norm(q);
    const list = state.products.filter((p) => !nq || norm(p.name).includes(nq))
      .sort((a, b) => b.out_of_stock - a.out_of_stock);
    return html`<ul class="stock-list">${list.map((p) => html`
      <li class="${p.out_of_stock ? 'out' : ''}">
        ${thumb(p, 'xs')}<span>${p.name}</span>
        <button type="button" class="btn small ${p.out_of_stock ? '' : 'ghost'}" data-stock="${p.id}" data-out="${p.out_of_stock ? '0' : '1'}">
          ${p.out_of_stock ? 'Agotado · marcar disponible' : 'Marcar agotado'}</button>
      </li>`)}</ul>`;
  };
  await dialog({
    title: 'Agotados en almacén',
    wide: true,
    body: html`
      <p class="muted small">«Agotado en almacén» significa que no quedan botellas para reponer. Es distinto de que falte en la barra: lo pedido sigue en la lista.</p>
      <input type="search" id="stock-q" placeholder="Buscar…" autocomplete="off">
      <div id="stock-body">${body()}</div>`,
    onMount(dlg) {
      const redraw = () => mount(dlg.querySelector('#stock-body'), body());
      dlg.querySelector('#stock-q').addEventListener('input', (e) => {
        q = e.target.value;
        redraw();
      });
      dlg.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-stock]');
        if (!b) return;
        b.disabled = true;
        try {
          await setStock(Number(b.dataset.stock), b.dataset.out === '1');
        } catch (err) {
          toast(err.message, 'error');
        }
        redraw();
      });
    },
  });
}
