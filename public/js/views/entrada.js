// «Ha llegado mercancía»: se tocan las botellas que han llegado, se pone
// cuánto en cajas y sueltas y se guarda como entrada en el almacén elegido.
// Lo elegido se guarda en el móvil hasta que se envía.
import { post, store } from '../api.js';
import {
  state, selection, productById, storeById, loadLive, stockText,
} from '../state.js';
import {
  raw, $, html, mount, norm, thumb, toast, buzz, fmt,
} from '../ui.js';
import { icon } from '../icons.js';
import {
  back, qtyHtml, askQty, currentStore, setCurrentStore, storeSeg,
} from './almacen.js';

const DRAFT = 'almEntrada'; // { store_id, items: [[product_id, botellas]] }

export function renderEntrada(root) {
  const draft = store.get(DRAFT, null);
  let storeId = storeById(draft?.store_id)?.id ?? currentStore()?.id ?? null;
  const items = new Map((draft?.items ?? []).filter(([id, n]) => productById(id) && n > 0));
  let q = '';
  let saving = false;

  const save = () => store.set(DRAFT, items.size ? { store_id: storeId, items: [...items] } : null);

  mount(root, html`
    <section class="alm ent" id="ent">
      ${back()}
      <h1 class="alm-title ent-h">Ha llegado mercancía</h1>
      ${state.stores.length > 1 ? html`<p class="muted cnt-q">¿Dónde ha llegado?</p>${storeSeg(storeId, 'Almacén donde llega')}` : ''}
      <div id="ent-chosen"></div>
      <div class="filters alm-filters ent-filters">
        <label class="search">${raw(icon('search', { size: 18 }))}
          <input type="search" id="ent-q" placeholder="Buscar botella" autocomplete="off" enterkeyhint="search" aria-label="Buscar botella"></label>
      </div>
      <div id="ent-grid"></div>
      <div class="trip-foot ent-foot" id="ent-foot"></div>
    </section>`);
  const el = $('#ent', root);

  const drawChosen = () => {
    const list = [...items].map(([id, n]) => ({ p: productById(id), n })).filter((x) => x.p);
    mount($('#ent-chosen', el), list.length ? html`
      <h2 class="alm-sec">Llega <span>${fmt(list.length)}</span></h2>
      <ul class="inf-list ent-list">${list.map(({ p, n }) => html`
        <li class="ent-item">
          <button type="button" class="inf-row ent-row" data-pick="${p.id}" aria-label="${p.name}: ${stockText(n, p.per_case)}. Cambiar">
            ${thumb(p, 'inf-img')}
            <span class="inf-name"><b>${p.name}</b></span>
            <span class="alm-qty">${qtyHtml(n, p.per_case)}</span>
          </button>
          <button type="button" class="icon-btn trip-rm" data-rm="${p.id}" aria-label="Quitar ${p.name}">${raw(icon('trash', { size: 20 }))}</button>
        </li>`)}</ul>` : html`<p class="ent-hint">Toca las botellas que han llegado.</p>`);
  };

  const drawGrid = () => {
    const nq = norm(q.trim());
    const card = (p) => {
      const n = items.get(p.id);
      return html`
        <div class="card ${n ? 'in-cart' : ''}">
          <button type="button" class="card-main" data-pick="${p.id}" aria-label="${p.name}${n ? `: ${stockText(n, p.per_case)}` : ''}">
            ${thumb(p)}
            <span class="card-name">${p.name}</span>
          </button>
          ${n ? html`<span class="count ent-check" aria-hidden="true">${raw(icon('check', { size: 16 }))}</span>` : ''}
        </div>`;
    };
    let body;
    if (nq) {
      const found = state.products.filter((p) => norm(p.name).includes(nq)
        || norm(p.name).replace(/\s/g, '').includes(nq.replace(/\s/g, '')));
      body = found.length ? html`<div class="grid">${found.map(card)}</div>`
        : html`<p class="empty">No hay botellas que coincidan con «${q}».</p>`;
    } else {
      const groups = selection();
      body = groups.length ? html`<div class="grid">${groups.map((g) => html`
        <h2 class="grid-title">${g.group.name}</h2>${g.products.map(card)}`)}</div>`
        : html`<p class="empty">No hay botellas en la selección. Búscalas por su nombre.</p>`;
    }
    mount($('#ent-grid', el), body);
  };

  const drawFoot = () => {
    const where = storeById(storeId)?.name ?? '';
    mount($('#ent-foot', el), items.size ? html`
      <button type="button" class="btn primary big" data-save ${saving ? raw('disabled') : ''}>
        ${raw(icon('package-plus', { size: 20 }))} Guardar lo que ha llegado</button>
      ${where ? html`<p class="trip-foot-hint">Entran en ${where}</p>` : ''}` : '');
  };

  const draw = () => { drawChosen(); drawGrid(); drawFoot(); };

  el.addEventListener('input', (e) => {
    if (e.target.id !== 'ent-q') return;
    q = e.target.value;
    drawGrid();
  });

  el.addEventListener('click', async (e) => {
    const t = e.target.closest('button');
    if (!t || saving) return;
    const d = t.dataset;
    if (d.store) {
      storeId = Number(d.store);
      for (const x of el.querySelectorAll('[data-store]')) {
        const on = Number(x.dataset.store) === storeId;
        x.classList.toggle('on', on);
        x.setAttribute('aria-pressed', String(on));
      }
      buzz(8);
      save();
      drawFoot();
    } else if (d.pick) {
      const p = productById(d.pick);
      if (!p) return;
      const had = items.get(p.id);
      const qty = await askQty({
        title: had ? 'Cambiar cantidad' : 'Ha llegado',
        product: p,
        initial: had ?? (p.per_case > 0 ? p.per_case : 1),
        ok: had ? 'Guardar' : 'Añadir',
      });
      if (qty === null) return;
      items.set(p.id, qty);
      buzz(12);
      save();
      draw();
    } else if (d.rm) {
      items.delete(Number(d.rm));
      buzz(8);
      save();
      draw();
    } else if (d.save !== undefined) {
      await send();
    }
  });

  async function send() {
    if (!items.size || !storeId) return;
    saving = true;
    drawFoot();
    // Una botella: «1 caja»; varias: cuántas botellas distintas (sumar cajas de tamaños distintos confunde).
    const [[firstId, firstQty]] = [...items];
    const what = items.size === 1
      ? stockText(firstQty, productById(firstId)?.per_case)
      : `${fmt(items.size)} botellas distintas`;
    try {
      await post('/api/almacen/entradas', {
        store_id: storeId,
        items: [...items].map(([product_id, qty]) => ({ product_id, qty })),
        by: state.who,
      });
      items.clear();
      store.set(DRAFT, null);
      setCurrentStore(storeId);
      buzz(30);
      toast(`Guardado: ${what} en ${storeById(storeId)?.name ?? 'el almacén'}`);
      loadLive().catch(() => {});
      location.hash = '#/almacen';
    } catch (err) {
      // Sin conexión lo elegido sigue guardado en el móvil para volver a intentarlo.
      toast(err.message, 'error');
      saving = false;
      drawFoot();
    }
  }

  draw();
  return undefined;
}
