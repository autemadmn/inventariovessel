// Pantalla principal: elegir barra, tocar botellas y enviar la solicitud.
import { post } from '../api.js';
import {
  state, subscribe, setBar, sectionGroups, cart, saveCarts, productById, groupById, barName, pendingFor, loadLive, isOut,
  orderStep, qtyText, unitSummary,
} from '../state.js';
import {
  raw, $, html, mount, norm, thumb, toast, buzz, dialog,
} from '../ui.js';
import { icon } from '../icons.js';
import { loadNevera, drawNevera, patchNevera, planoCargado, zonasDelPlano, zonaHtml } from './nevera.js';

const PLANOS = { chupiteria: 'img/nevera/nevera.v2.json', nevera: 'img/nevera/frontal/nevera.v4.json' };
const planoActual = () => planoCargado(PLANOS[lastSection]);

let query = '';
let lastSection = null;
// Verdadero si se entró a la sección tocando un botón de la portada: «Volver» usa el historial.
let fromCover = false;

const SECTIONS = [
  { id: 'alcohol', name: 'Alcohol', pics: ['tanqueray-london-dry'] },
  { id: 'nevera', name: 'Nevera', pics: ['estrella-galicia'] },
  { id: 'chupiteria', name: 'Chupitería', pics: ['jagermeister', 'diex-crema-de-fresas-con-tequila'] },
  { id: 'refrescos', name: 'Refrescos', pics: ['schweppes-tonica'] },
  { id: 'otros', name: 'Otros', pics: [] },
];
const sectionName = (id) => state.sections.find((s) => s.id === id)?.name ?? SECTIONS.find((s) => s.id === id)?.name ?? id;

export function renderPedir(root, rest = []) {
  const sectionId = rest[0] || null;
  if (sectionId && !SECTIONS.some((s) => s.id === sectionId)) {
    location.replace('#/pedir');
    return undefined;
  }
  if (sectionId !== lastSection) query = '';
  lastSection = sectionId;
  if (!sectionId) fromCover = false;

  const barPick = html`
      <div class="bar-pick" role="radiogroup" aria-label="Barra">
        ${state.bars.map((b) => html`<button type="button" role="radio" class="bar-btn bar-${b.id}" data-bar="${b.id}">${b.name}</button>`)}
      </div>`;
  mount(root, sectionId ? html`
    <section class="pedir">
      <div class="sec-head">
        <button type="button" class="sec-back" data-back aria-label="Volver a las secciones">${raw(icon('left', { size: 20 }))} Secciones</button>
        <h1 class="sec-title">${sectionName(sectionId)}</h1>
      </div>
      ${barPick}
      ${PLANOS[sectionId] ? html`<div id="nevera" class="nevera-wrap" hidden></div>` : html`
      <div class="filters">
        <label class="search">${raw(icon('search', { size: 18 }))}
          <input type="search" id="search" placeholder="Buscar botella" value="${query}" autocomplete="off" enterkeyhint="search" aria-label="Buscar botella"></label>
      </div>`}
      <div id="grid" class="grid"></div>
    </section>
    <div id="cartbar" class="cartbar"></div>` : html`
    <section class="pedir">
      ${barPick}
      <div id="cover" class="cover"></div>
    </section>
    <div id="cartbar" class="cartbar"></div>`);

  const draw = () => {
    drawBars();
    if (sectionId) drawGrid(sectionId);
    else drawCover();
    drawCartBar();
  };

  root.addEventListener('click', onClick);
  let active = true;
  if (PLANOS[sectionId]) loadNevera(PLANOS[sectionId], () => {
    if (active) drawGrid(sectionId);
  });
  $('#search')?.addEventListener('input', (e) => {
    query = e.target.value;
    drawGrid(sectionId);
  });
  draw();
  const unsub = subscribe(draw);
  return () => {
    active = false;
    unsub();
    root.removeEventListener('click', onClick);
  };

  function onClick(e) {
    const t = e.target.closest('[data-bar],[data-add],[data-minus],[data-open-cart],[data-back],[data-sec]');
    if (!t) return;
    if (t.dataset.sec) {
      fromCover = true;
      buzz();
    } else if (t.dataset.back !== undefined) {
      if (fromCover) history.back();
      else location.replace('#/pedir');
    } else if (t.dataset.bar) {
      setBar(Number(t.dataset.bar));
      buzz();
      draw();
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
    c[pid] = Math.max(0, (c[pid] || 0) + delta * orderStep(productById(pid)));
    if (!c[pid]) delete c[pid];
    saveCarts();
    buzz(delta > 0 ? 12 : 6);
    drawCard(pid);
    patchNevera($('#nevera'), pid, { products: state.products, plano: planoActual(), estado: estadoZona });
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

// Solo la selección (productos con grupo), en el orden de los grupos.
function matches(p, q) {
  return !q || norm(p.name).includes(q) || norm(p.name).replace(/\s/g, '').includes(q.replace(/\s/g, ''));
}

const orderWhat = (p) => p.order_unit === 'caja' && orderStep(p) > 1 ? 'una caja' : p.order_unit === 'bolsa' ? 'una bolsa' : 'una botella';

function estadoZona(p) {
  const n = state.bar ? cart()[p.id] || 0 : 0;
  const pend = state.bar ? pendingFor(p.id, state.bar) : 0;
  const step = orderStep(p);
  return { n, pend, out: isOut(p), shown: n % step === 0 ? n / step : qtyText(n, p),
    qty: qtyText(n, p), pending: qtyText(pend, p), what: orderWhat(p) };
}

function cardHtml(p) {
  const n = state.bar ? cart()[p.id] || 0 : 0;
  const pend = state.bar ? pendingFor(p.id, state.bar) : 0;
  const out = isOut(p);
  const step = orderStep(p);
  const unit = p.order_unit === 'caja' && step > 1 ? `Caja de ${step}` : p.order_unit === 'bolsa' ? 'Bolsa' : p.per_case > 1 ? 'Botella' : '';
  const what = orderWhat(p);
  const shown = n % step === 0 ? n / step : qtyText(n, p);
  return html`
    <div class="card ${n ? 'in-cart' : ''} ${out ? 'out' : ''}" data-card="${p.id}">
      <button type="button" class="card-main" data-add="${p.id}" aria-label="Añadir ${what} de ${p.name}">
        ${thumb(p)}
        <span class="card-name${p.name.length > 18 ? ' long' : ''}" title="${p.name}">${p.name}</span>
        ${unit ? html`<span class="tag unit">${unit}</span>` : ''}
        ${p.status === 'pendiente' ? html`<span class="tag warn" title="Por confirmar. ${p.note || ''}">Dudoso</span>` : ''}
        ${pend ? html`<span class="tag info" title="Ya pedidas y sin entregar para esta barra">${qtyText(pend, p)} pend.</span>` : ''}
        ${out ? html`<span class="out-band" title="Agotado en almacén">Agotado</span>` : ''}
      </button>
      ${n ? html`<span class="count" aria-label="${qtyText(n, p)} en la solicitud">${shown}</span>
        <button type="button" class="card-minus" data-minus="${p.id}" aria-label="Quitar ${what} de ${p.name}">${raw(icon('minus', { size: 18 }))}</button>` : ''}
    </div>`;
}

function drawGrid(sectionId) {
  const el = $('#grid');
  if (!el) return;
  const all = sectionGroups(sectionId);
  const q = PLANOS[sectionId] ? '' : norm(query.trim());
  const inFridge = drawNevera($('#nevera'), all.flatMap((g) => g.products), {
    visible: !q, plano: planoCargado(PLANOS[sectionId]), estado: estadoZona,
  });
  if (!all.length) {
    mount(el, html`<p class="empty">No hay productos en esta sección. El encargado puede añadirlos en Gestión → Selección.</p>`);
    return;
  }
  const shown = all
    .map(({ group, products }) => ({ group, products: products.filter((p) => matches(p, q) && !inFridge.has(p.id)) }))
    .filter((g) => g.products.length);
  if (!shown.length && inFridge.size) {
    mount(el, '');
    return;
  }
  if (!shown.length) {
    mount(el, html`<p class="empty">No hay productos que coincidan con «${query}».</p>`);
    return;
  }
  // Con búsqueda se sigue el mismo orden, pero sin cabeceras de grupo.
  mount(el, q
    ? html`${shown.flatMap((g) => g.products).map(cardHtml)}`
    : sectionId === 'nevera' && planoCargado(PLANOS.nevera)
      ? html`<h2 class="grid-title">Más de la nevera</h2>${shown.flatMap((g) => g.products).map(cardHtml)}`
      : html`${shown.map((g) => html`${all.length === 1 && norm(g.group.name) === norm(sectionName(sectionId)) ? '' : html`<h2 class="grid-title">${g.group.name}</h2>`}${g.products.map(cardHtml)}`)}`);
}

function drawCard(pid) {
  const old = document.querySelector(`[data-card="${pid}"]`);
  if (!old) return;
  const tpl = document.createElement('template');
  const p = productById(pid);
  const plano = planoActual();
  const zonas = old.classList.contains('nev-zone') ? zonasDelPlano(plano, [p]).map((x) => x.zona) : [];
  tpl.innerHTML = String(zonas.length ? zonaHtml(p, zonas, plano, estadoZona(p)) : cardHtml(p)).trim();
  const next = tpl.content.firstElementChild;
  const wasSelected = old.classList.contains('on');
  old.replaceWith(next);
  // La zona se repinta, pero la máscara conserva su opacidad inicial para
  // que el cambio siga fundiéndose. CSS elimina el fundido con reduced-motion.
  if (zonas.length && wasSelected !== next.classList.contains('on')) {
    const mask = next.querySelector('.nev-sel');
    if (mask) {
      mask.style.opacity = wasSelected ? '1' : '0';
      getComputedStyle(mask).opacity;
      mask.style.removeProperty('opacity');
    }
  }
}

const sectionOf = (p) => groupById(p.group_id)?.section ?? 'alcohol';

function drawCover() {
  const el = $('#cover');
  if (!el) return;
  const lines = state.bar ? cartLines() : [];
  const btn = (s) => {
    const mine = lines.filter((l) => sectionOf(l.p) === s.id);
    const count = mine.length ? html`<span class="sec-count">${unitSummary(mine)}</span>` : '';
    return html`
      <a class="sec-btn sec-${s.id}" href="#/pedir/${s.id}" data-sec="${s.id}">
        ${s.pics.length ? html`<span class="sec-pics">${s.pics.map((slug) => thumb({ slug, category: 'otros' }))}</span>` : ''}
        <span class="sec-name">${sectionName(s.id)}</span>
        ${count}
      </a>`;
  };
  mount(el, html`
    <div class="sec-grid">${SECTIONS.filter((s) => s.id !== 'otros').map(btn)}</div>
    ${btn(SECTIONS.find((s) => s.id === 'otros'))}`);
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
      <span class="cart-what"><b>${unitSummary(lines).replace(/(\d) /g, '$1 ')}</b><span class="cart-bar">${barName(state.bar)}</span></span>
      <span class="cart-go">Enviar ${raw(icon('right', { size: 18 }))}</span>
    </button>` : '');
}

function summaryText(lines) {
  return lines.map((l) => `${l.p.name}: ${qtyText(l.qty, l.p)}`).join('\n');
}

async function openCart() {
  const barId = state.bar;
  const body = () => {
    const lines = cartLines(barId);
    if (!lines.length) return html`<p class="empty">La solicitud está vacía.</p>`;
    return html`
      <ul class="cart-list">${lines.map(({ p, qty }) => {
        const pend = pendingFor(p.id, barId);
        const what = orderWhat(p);
        return html`<li>
          ${thumb(p, 'sm')}
          <div class="cart-name">${p.name}
            ${isOut(p) ? html`<small class="danger">Agotado en almacén: puede que no haya para reponer</small>` : ''}
            ${pend ? html`<small class="info">Ya hay ${qtyText(pend, p)} pedidas sin entregar para esta barra</small>` : ''}
          </div>
          <div class="stepper">
            <button type="button" class="step" data-step="-1" data-pid="${p.id}" aria-label="Quitar ${what} de ${p.name}">${raw(icon('minus', { size: 18 }))}</button>
            <output>${qtyText(qty, p)}</output>
            <button type="button" class="step" data-step="1" data-pid="${p.id}" aria-label="Añadir ${what} de ${p.name}">${raw(icon('plus', { size: 18 }))}</button>
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
        c[pid] = Math.max(0, (c[pid] || 0) + Number(b.dataset.step) * orderStep(productById(pid)));
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
      toast(`Enviado: ${unitSummary(lines)} para ${barName(barId)}`);
      buzz(30);
      await loadLive();
    } catch (err) {
      toast(err.message, 'error');
    }
  }
  if (lastSection) drawGrid(lastSection);
  else drawCover();
  drawCartBar();
}
