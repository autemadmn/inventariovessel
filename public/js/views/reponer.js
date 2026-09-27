// Lista de reposición compartida: lo pedido, lo entregado y lo que falta.
import { post, store } from '../api.js';
import { state, subscribe, barName, loadLive, loadBootstrap } from '../state.js';
import {
  $, html, mount, thumb, toast, buzz, bottles, ago, timeLabel, confirmDialog, dialog, norm,
} from '../ui.js';

let filter = store.get('reponerFilter', 'all');
let showDone = false;

export function renderReponer(root) {
  mount(root, html`<section class="reponer" id="reponer"></section>`);
  const el = $('#reponer');
  const draw = () => mount(el, view());
  el.addEventListener('click', onClick);
  draw();
  const unsub = subscribe(draw);
  // Refrescar los "hace X min".
  const timer = setInterval(draw, 60000);
  return () => {
    unsub();
    clearInterval(timer);
  };
}

function view() {
  const lines = state.live.lines.filter((l) => filter === 'all' || l.bar_id === Number(filter));
  const open = lines.filter((l) => l.qty_pending > 0);
  const done = lines.filter((l) => l.qty_pending === 0);
  const pendingTotal = open.reduce((a, l) => a + l.qty_pending, 0);
  const recent = state.live.recent.filter((d) => filter === 'all' || d.bar_id === Number(filter));

  return html`
    <div class="seg" role="tablist">
      ${[['all', 'Todas'], ...state.bars.map((b) => [String(b.id), b.name])].map(([v, label]) => html`
        <button type="button" class="${filter === v ? 'on' : ''} ${v !== 'all' ? `bar-${v}` : ''}" data-filter="${v}">${label}
          ${v !== 'all' ? html`<small>${state.live.lines.filter((l) => l.bar_id === Number(v)).reduce((a, l) => a + l.qty_pending, 0) || ''}</small>` : ''}
        </button>`)}
    </div>

    <div class="status-line">
      ${pendingTotal
    ? html`<strong>Faltan ${bottles(pendingTotal)}</strong> <span class="muted">en ${open.length} ${open.length === 1 ? 'línea' : 'líneas'}</span>`
    : html`<strong class="ok">Nada pendiente</strong>`}
      <button type="button" class="btn small ghost" data-stock-panel>Agotados en almacén</button>
    </div>

    ${open.length ? html`<ul class="lines">${open.map(lineHtml)}</ul>` : html`
      <p class="empty">No hay botellas pendientes${filter !== 'all' ? ` en ${barName(filter)}` : ''}.<br>
      Las solicitudes nuevas aparecen aquí al momento.</p>`}

    ${done.length ? html`
      <button type="button" class="collapse" data-toggle-done>${showDone ? '▾' : '▸'} Completadas o anuladas (${done.length})</button>
      ${showDone ? html`<ul class="lines done">${done.map(lineHtml)}</ul>` : ''}` : ''}

    ${recent.length ? html`
      <h2 class="section-title">Últimas entregas</h2>
      <ul class="recent">${recent.slice(0, 12).map((d) => html`
        <li class="${d.qty === 0 ? 'undone' : ''}">
          <span class="time">${timeLabel(d.delivered_at)}</span>
          <span><b>${d.qty === 0 ? 'Deshecha' : d.qty}</b> · ${d.product_name} → <span class="bar-tag bar-${d.bar_id}">${barName(d.bar_id)}</span>
            ${d.delivered_by ? html`<small class="muted">· ${d.delivered_by}</small>` : ''}</span>
          ${d.can_undo ? html`<button type="button" class="btn small ghost" data-undo="${d.id}">Deshacer</button>` : ''}
        </li>`)}</ul>` : ''}`;
}

function lineHtml(l) {
  const mine = l.claimed_by && l.claimed_by === (state.who || 'Alguien');
  return html`
    <li class="line ${l.out_of_stock ? 'out' : ''} ${l.qty_pending === 0 ? 'complete' : ''}">
      <div class="line-head">
        ${thumb(l, 'sm')}
        <div class="line-title">
          <b>${l.product_name}</b>
          <span class="bar-tag bar-${l.bar_id}">${barName(l.bar_id)}</span>
          <small class="muted">${l.created_by ? `${l.created_by} · ` : ''}${ago(l.updated_at)}</small>
        </div>
      </div>
      <div class="qty-row">
        <span>Pedidas <b>${l.qty_requested}</b></span>
        <span>Entregadas <b>${l.qty_delivered}</b></span>
        ${l.qty_cancelled ? html`<span>Anuladas <b>${l.qty_cancelled}</b></span>` : ''}
        <span class="pending">Faltan <b>${l.qty_pending}</b></span>
      </div>
      ${l.out_of_stock ? html`<p class="out-note">Agotado en almacén: no quedan botellas para reponer.</p>` : ''}
      ${l.claimed_by && l.qty_pending ? html`<p class="claim ${mine ? 'mine' : ''}">🚶 ${mine ? 'La llevas tú' : `La lleva ${l.claimed_by}`} · ${ago(l.claimed_at)}</p>` : ''}
      ${l.qty_pending ? html`
        <div class="line-actions">
          ${mine
    ? html`<button type="button" class="btn ghost" data-release="${l.id}">Soltar</button>`
    : l.claimed_by ? '' : html`<button type="button" class="btn ghost" data-claim="${l.id}">Voy yo</button>`}
          <button type="button" class="btn primary" data-deliver="${l.id}" data-qty="1">Entregada 1</button>
          ${l.qty_pending > 1 ? html`<button type="button" class="btn primary" data-deliver="${l.id}" data-qty="${l.qty_pending}">Entregadas las ${l.qty_pending}</button>` : ''}
          <button type="button" class="icon-btn more" data-more="${l.id}" aria-label="Más opciones">⋯</button>
        </div>` : ''}
    </li>`;
}

async function onClick(e) {
  const t = e.target.closest('button');
  if (!t) return;
  const d = t.dataset;
  const line = (id) => state.live.lines.find((l) => l.id === Number(id));
  try {
    if (d.filter) {
      filter = d.filter;
      store.set('reponerFilter', filter);
      mount($('#reponer'), view());
    } else if (d.toggleDone !== undefined) {
      showDone = !showDone;
      mount($('#reponer'), view());
    } else if (d.deliver) {
      const l = line(d.deliver);
      if (l?.out_of_stock && !await confirmDialog('Agotado en almacén', `${l.product_name} está marcado como agotado. ¿Lo has entregado igualmente?`, { ok: 'Sí, entregado' })) return;
      t.disabled = true;
      await post(`/api/lines/${d.deliver}/deliver`, { qty: Number(d.qty), by: state.who });
      buzz(25);
      toast(`Registrado: ${bottles(d.qty)} de ${l?.product_name ?? ''}`);
      await loadLive();
    } else if (d.claim) {
      await post(`/api/lines/${d.claim}/claim`, { by: state.who || 'Alguien' });
      buzz();
      await loadLive();
    } else if (d.release) {
      await post(`/api/lines/${d.release}/claim`, { release: true, by: state.who });
      await loadLive();
    } else if (d.undo) {
      if (!await confirmDialog('Deshacer entrega', 'La entrega dejará de contar y las botellas volverán a figurar como pendientes.', { ok: 'Deshacer', kind: 'danger' })) return;
      await post(`/api/deliveries/${d.undo}/undo`, { by: state.who });
      toast('Entrega deshecha');
      await loadLive();
    } else if (d.more) {
      await moreMenu(line(d.more));
    } else if (d.stockPanel !== undefined) {
      await stockPanel();
    }
  } catch (err) {
    toast(err.message, 'error');
    await loadLive().catch(() => {});
  }
}

async function moreMenu(l) {
  if (!l) return;
  const choice = await dialog({
    title: l.product_name,
    body: html`<p class="muted">${barName(l.bar_id)} · faltan ${bottles(l.qty_pending)}</p>`,
    actions: [
      { label: 'Anular lo pendiente', value: 'cancel', kind: 'ghost' },
      l.out_of_stock
        ? { label: 'Ya hay en almacén', value: 'available' }
        : { label: 'Agotado en almacén', value: 'out', kind: 'danger' },
    ],
  });
  if (choice === 'cancel') {
    const ok = await confirmDialog('Anular pendientes',
      `Se anularán ${bottles(l.qty_pending)} de ${l.product_name} para ${barName(l.bar_id)} (por ejemplo, si se pidieron por error o ya no hacen falta). Lo entregado se mantiene.`,
      { ok: 'Anular', kind: 'danger' });
    if (!ok) return;
    await post(`/api/lines/${l.id}/cancel`, { by: state.who });
    toast('Pendientes anuladas');
  } else if (choice === 'out' || choice === 'available') {
    await setStock(l.product_id, choice === 'out');
  }
  await loadLive();
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
      <p class="muted small">«Agotado en almacén» significa que no quedan botellas para reponer. Es distinto de que falte en la barra: las solicitudes siguen visibles en la lista.</p>
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
