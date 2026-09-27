// Pantalla principal: elegir barra, tocar botellas y enviar la solicitud.
import { post } from '../api.js';
import {
  state, subscribe, setBar, cart, saveCarts, productById, barName, pendingFor, loadLive,
} from '../state.js';
import {
  $, html, mount, norm, thumb, toast, buzz, bottles, dialog,
} from '../ui.js';

let category = 'all';
let query = '';

export function renderPedir(root) {
  mount(root, html`
    <section class="pedir">
      <div class="bar-pick" role="radiogroup" aria-label="Barra">
        ${state.bars.map((b) => html`<button type="button" role="radio" class="bar-btn bar-${b.id}" data-bar="${b.id}">${b.name}</button>`)}
      </div>
      <div class="filters">
        <input type="search" id="search" placeholder="Buscar botella…" value="${query}" autocomplete="off" enterkeyhint="search">
        <div class="chips" id="chips"></div>
      </div>
      <div id="grid" class="grid"></div>
    </section>
    <div id="cartbar" class="cartbar"></div>`);

  const draw = () => {
    drawBars();
    drawChips();
    drawGrid();
    drawCartBar();
  };

  root.addEventListener('click', onClick);
  $('#search').addEventListener('input', (e) => {
    query = e.target.value;
    drawGrid();
  });
  draw();
  const unsub = subscribe(draw);
  return () => {
    unsub();
    root.removeEventListener('click', onClick);
  };

  function onClick(e) {
    const t = e.target.closest('[data-bar],[data-cat],[data-add],[data-minus],[data-open-cart]');
    if (!t) return;
    if (t.dataset.bar) {
      setBar(Number(t.dataset.bar));
      buzz();
      draw();
    } else if (t.dataset.cat) {
      category = t.dataset.cat;
      drawChips();
      drawGrid();
    } else if (t.dataset.add) {
      if (!state.bar) {
        toast('Primero elige la barra', 'error');
        $('.bar-pick').classList.add('nudge');
        setTimeout(() => $('.bar-pick')?.classList.remove('nudge'), 600);
        return;
      }
      change(Number(t.dataset.add), 1);
    } else if (t.dataset.minus) {
      change(Number(t.dataset.minus), -1);
    } else if (t.dataset.openCart !== undefined) {
      openCart();
    }
  }

  function change(pid, delta) {
    const c = cart();
    c[pid] = Math.max(0, (c[pid] || 0) + delta);
    if (!c[pid]) delete c[pid];
    saveCarts();
    buzz(delta > 0 ? 12 : 6);
    drawCard(pid);
    drawCartBar();
  }
}

function drawBars() {
  for (const b of document.querySelectorAll('.bar-btn')) {
    const on = Number(b.dataset.bar) === state.bar;
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', on);
  }
  document.querySelector('.pedir')?.classList.toggle('no-bar', !state.bar);
}

function drawChips() {
  const el = $('#chips');
  if (!el) return;
  const used = new Set(state.products.map((p) => p.category));
  mount(el, html`
    <button type="button" class="chip ${category === 'all' ? 'on' : ''}" data-cat="all">Todas</button>
    ${state.categories.filter((c) => used.has(c.id)).map((c) => html`
      <button type="button" class="chip ${category === c.id ? 'on' : ''}" data-cat="${c.id}">${c.name}</button>`)}`);
}

function visibleProducts() {
  const q = norm(query.trim());
  return state.products.filter((p) => (category === 'all' || p.category === category)
    && (!q || norm(p.name).includes(q) || norm(p.name).replace(/\s/g, '').includes(q.replace(/\s/g, ''))));
}

function cardHtml(p) {
  const n = state.bar ? cart()[p.id] || 0 : 0;
  const pend = state.bar ? pendingFor(p.id, state.bar) : 0;
  return html`
    <div class="card ${n ? 'in-cart' : ''} ${p.out_of_stock ? 'out' : ''}" data-card="${p.id}">
      <button type="button" class="card-main" data-add="${p.id}" aria-label="Añadir una botella de ${p.name}">
        ${thumb(p)}
        <span class="card-name">${p.name}</span>
        ${p.status === 'pendiente' ? html`<span class="tag warn" title="${p.note || ''}">Por confirmar</span>` : ''}
        ${pend ? html`<span class="tag info" title="Ya pedidas y sin entregar para esta barra">${pend} pendiente${pend === 1 ? '' : 's'}</span>` : ''}
        ${p.out_of_stock ? html`<span class="out-band">Agotado almacén</span>` : ''}
      </button>
      ${n ? html`<span class="count" aria-label="${n} en la solicitud">${n}</span>
        <button type="button" class="card-minus" data-minus="${p.id}" aria-label="Quitar una">−</button>` : ''}
    </div>`;
}

function drawGrid() {
  const el = $('#grid');
  if (!el) return;
  const list = visibleProducts();
  if (!list.length) {
    mount(el, html`<p class="empty">No hay botellas que coincidan con «${query}».</p>`);
    return;
  }
  if (category === 'all' && !query.trim()) {
    mount(el, html`${state.categories.map((c) => {
      const items = list.filter((p) => p.category === c.id);
      return items.length ? html`<h2 class="grid-title">${c.name}</h2>${items.map(cardHtml)}` : '';
    })}`);
  } else {
    mount(el, html`${list.map(cardHtml)}`);
  }
}

function drawCard(pid) {
  const old = document.querySelector(`[data-card="${pid}"]`);
  if (!old) return;
  const tpl = document.createElement('template');
  tpl.innerHTML = String(cardHtml(productById(pid))).trim();
  old.replaceWith(tpl.content.firstElementChild);
}

function cartLines(barId = state.bar) {
  return Object.entries(cart(barId))
    .map(([pid, qty]) => ({ p: productById(pid), qty }))
    .filter((l) => l.p && l.qty > 0);
}

function drawCartBar() {
  const el = $('#cartbar');
  if (!el) return;
  const lines = state.bar ? cartLines() : [];
  const total = lines.reduce((a, l) => a + l.qty, 0);
  el.classList.toggle('show', total > 0);
  mount(el, total ? html`
    <button type="button" class="btn primary big cart-btn" data-open-cart>
      <span><b>${bottles(total)}</b> · ${barName(state.bar)}</span>
      <span>Enviar ›</span>
    </button>` : '');
}

function summaryText(lines) {
  return lines.map((l) => `${l.p.name}: ${bottles(l.qty)}`).join('\n');
}

async function openCart() {
  const barId = state.bar;
  const body = () => {
    const lines = cartLines(barId);
    if (!lines.length) return html`<p class="empty">La solicitud está vacía.</p>`;
    return html`
      <ul class="cart-list">${lines.map(({ p, qty }) => {
        const pend = pendingFor(p.id, barId);
        return html`<li>
          ${thumb(p, 'sm')}
          <div class="cart-name">${p.name}
            ${p.out_of_stock ? html`<small class="danger">Agotado en almacén: puede que no haya para reponer</small>` : ''}
            ${pend ? html`<small class="info">Ya hay ${pend} pedida(s) sin entregar para esta barra</small>` : ''}
          </div>
          <div class="stepper">
            <button type="button" class="step" data-step="-1" data-pid="${p.id}" aria-label="Quitar una">−</button>
            <output>${qty}</output>
            <button type="button" class="step" data-step="1" data-pid="${p.id}" aria-label="Añadir una">+</button>
          </div></li>`;
      })}</ul>
      <p class="muted small">Se enviará:</p>
      <pre class="summary">${summaryText(lines)}</pre>`;
  };

  const res = await dialog({
    title: `Solicitud para ${barName(barId)}`,
    body: html`<div id="cart-body">${body()}</div>`,
    actions: [
      { label: 'Vaciar', value: 'clear', kind: 'ghost' },
      { label: 'Seguir añadiendo', value: '' },
      { label: 'Enviar a reposición', value: 'send', kind: 'primary' },
    ],
    onMount(dlg) {
      dlg.addEventListener('click', (e) => {
        const b = e.target.closest('[data-step]');
        if (!b) return;
        const c = cart(barId);
        const pid = b.dataset.pid;
        c[pid] = Math.max(0, (c[pid] || 0) + Number(b.dataset.step));
        if (!c[pid]) delete c[pid];
        saveCarts();
        buzz(8);
        mount(dlg.querySelector('#cart-body'), body());
      });
    },
  });

  if (res === 'clear') {
    state.carts[barId] = {};
    saveCarts();
  } else if (res === 'send') {
    const lines = cartLines(barId);
    if (!lines.length) return;
    try {
      await post('/api/requests', {
        bar_id: barId,
        by: state.who,
        items: lines.map((l) => ({ product_id: l.p.id, qty: l.qty })),
      });
      state.carts[barId] = {};
      saveCarts();
      toast(`Enviado: ${bottles(lines.reduce((a, l) => a + l.qty, 0))} para ${barName(barId)}`);
      buzz(30);
      await loadLive();
    } catch (err) {
      toast(err.message, 'error');
    }
  }
  drawGrid();
  drawCartBar();
}
