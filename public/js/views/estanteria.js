import { get, store } from '../api.js';
import { state, stockText, POINT_TYPE_LABEL, countTime, productById } from '../state.js';
import { html, raw, mount, thumb, toast, buzz, fmt, dateLabel, norm, dialog } from '../ui.js';
import { icon } from '../icons.js';
import { countFields, bindCountFields, countedQty, enqueue, queuedCounts, flushCounts, onStockChange } from './almacen.js';

export const SHELF_CATEGORIES = [
  ['ginebra','Ginebras'], ['ron','Rones'], ['vodka','Vodkas'], ['whisky','Whiskies'], ['tequila','Tequila'], ['licor','Licores'],
  ['cerveza','Cervezas'], ['refresco','Refrescos'], ['vino','Vinos'], ['otros','Otros'],
];
export const shelfCategory = (p) => SHELF_CATEGORIES.some(([id]) => id === p.category) ? p.category : 'otros';

function nightOf(iso) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(new Date(iso)).map((p) => [p.type,p.value]));
  const d = new Date(`${parts.year}-${parts.month}-${parts.day}T12:00:00Z`);
  if (Number(parts.hour) < 12) d.setUTCDate(d.getUTCDate()-1);
  return d.toISOString().slice(0,10);
}

function resultTag(p, pending) {
  if (pending) return html`<span class="tag warn">Por enviar</span>`;
  if (!p.counted_tonight) return '';
  const r = p.result;
  if (!r) return '';
  if (r.kind === 'consumo') return html`<span class="tag">${r.consumption >= 0 ? `Consumo ${fmt(r.consumption)}` : `+${fmt(-r.consumption)} más`}</span>`;
  return html`<span class="tag ${r.diff < 0 ? 'warn' : r.diff > 0 ? 'info' : 'ok'}">${r.diff === 0 ? 'Cuadra' : `${r.diff < 0 ? '−' : '+'}${stockText(Math.abs(r.diff),p.per_case)}`}</span>`;
}

export function renderEstanteria(root, point) {
  mount(root, html`<section class="alm shelf" id="shelf">
    <a class="inf-back" href="#/almacen/in">${raw(icon('left',{size:18}))} In Vessel</a>
    <h1 class="alm-title">${point.name}</h1><p class="muted small">${POINT_TYPE_LABEL[point.point_type]}</p>
    ${point.point_type !== 'almacen' ? html`<p class="muted small">Aquí no se apuntan las ventas: al contar verás el consumo desde el último recuento.</p>` : ''}
    <div class="shelf-tools"><div class="seg" role="group" aria-label="Modo de inventario">
      <button type="button" data-mode="contar" class="on" aria-pressed="true">Contar</button><button type="button" data-mode="consultar" aria-pressed="false">Consultar</button></div>
      <a class="btn small ghost" href="#/almacen/contar/${point.map_key}">Contar una a una</a></div>
    <div class="shelf-tabs" role="tablist" aria-label="Categorías"></div>
    <div id="shelf-grid" class="shelf-grid" role="tabpanel" aria-label="Botellas"><p class="empty">Cargando…</p></div>
    <button type="button" class="btn ghost shelf-add" data-add>Añadir botella a este punto</button>
    <div id="shelf-panel" class="shelf-panel" hidden></div></section>`);
  const el = root.querySelector('#shelf');
  const panel = el.querySelector('#shelf-panel');
  let mode = 'contar'; let category = null; let selected = null; let rows = []; let request = 0; let ready = false;
  const extras = () => store.get('almPuntoExtra', {})[point.map_key] ?? [];
  const saveExtras = (ids) => store.set('almPuntoExtra', {...store.get('almPuntoExtra',{}), [point.map_key]:ids});
  const pending = () => queuedCounts().filter((q) => (q.store_id ?? 1) === point.id && nightOf(q.counted_at) === nightOf(countTime()));
  const ordered = () => SHELF_CATEGORIES.flatMap(([id]) => rows.filter((p) => shelfCategory(p) === id));
  const done = (p) => p.counted_tonight || pending().some((q) => q.product_id === p.product_id);

  function drawGrid() {
    const cats = SHELF_CATEGORIES.filter(([id]) => rows.some((p) => shelfCategory(p) === id));
    if (!cats.some(([id]) => id === category)) category = cats[0]?.[0] ?? null;
    mount(el.querySelector('.shelf-tabs'), html`${cats.map(([id,name]) => html`<button type="button" role="tab" id="shelf-tab-${id}" aria-controls="shelf-grid" aria-selected="${String(category===id)}" tabindex="${category===id ? 0 : -1}" data-cat="${id}">${name}</button>`)}`);
    const grid = el.querySelector('#shelf-grid');
    grid.dataset.mode = mode;
    if (category) grid.setAttribute('aria-labelledby', `shelf-tab-${category}`);
    else grid.removeAttribute('aria-labelledby');
    const empty = point.map_key === 'chupiteria' ? 'Añade con el botón de abajo las botellas que guardas aquí, o da de alta cervezas en Gestión › Catálogo.'
      : point.map_key === 'nevera-vino' ? 'Da de alta los vinos en Gestión › Catálogo.'
      : ['alm-cerveza','neveras-cerveza','neveras-especial','chupiteria'].includes(point.map_key) ? 'Da de alta cervezas y refrescos en Gestión › Catálogo.'
      : 'Añade una con «Añadir botella a este punto».';
    mount(grid, html`${rows.length ? rows.filter((p) => shelfCategory(p) === category).map((p) => html`
      <button type="button" class="shelf-card ${selected?.product_id===p.product_id ? 'selected' : ''}" data-pid="${p.product_id}" aria-pressed="${String(selected?.product_id===p.product_id)}">
        ${thumb(p,'shelf-img')}<b>${p.name}</b>
        ${mode === 'contar' ? html`${done(p) ? html`<span class="shelf-check" aria-label="Contada">${raw(icon('check',{size:16}))}</span>` : ''}${resultTag(p,pending().some((q) => q.product_id===p.product_id))}`
          : html`<span class="shelf-stock ${p.controlled && p.stock<=0 ? 'danger' : ''}">${!p.controlled ? 'Sin contar' : p.stock<=0 ? 'No queda' : stockText(p.stock,p.per_case)}</span>${p.last_count_at ? html`<small>Contado ${dateLabel(p.last_count_at.slice(0,10))}</small>` : ''}`}
      </button>`) : html`<div class="shelf-empty muted"><p>${ready ? `Aún no hay productos aquí. ${empty}` : 'Cargando…'}</p>${ready ? html`<a class="btn ghost" href="#/gestion/catalogo">Ir al Catálogo</a>` : ''}</div>`}`);
    el.querySelector('[data-add]').hidden = mode !== 'contar';
  }

  function open(p) {
    selected = p;
    panel.hidden = !p || mode !== 'contar';
    el.classList.toggle('has-panel', !panel.hidden);
    if (!panel.hidden) mount(panel, html`<form autocomplete="off">
      <div class="shelf-panel-head">${thumb(p,'sm')}<b>${p.name}</b><button type="button" class="icon-btn" data-close-panel aria-label="Cerrar">${raw(icon('close'))}</button></div>
      ${countFields(p)}<button type="submit" class="btn primary shelf-done">Hecho</button></form>`);
    drawGrid();
    if (p && !panel.hidden) requestAnimationFrame(() => {
      if (!el.isConnected || selected?.product_id !== p.product_id) return;
      el.style.setProperty('--shelf-panel-height', panel.getBoundingClientRect().height+'px');
      const card = el.querySelector(`[data-pid="${p.product_id}"]`);
      card?.focus({preventScroll:true});
      card?.scrollIntoView({block:'nearest',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'});
    });
  }

  async function refresh() {
    const seq = ++request; const requestedMode = mode;
    try {
      const r = await get(`/api/almacen/punto/${point.id}?modo=${mode}`);
      if (seq !== request || !el.isConnected || mode!==requestedMode) return;
      rows = r.products;
      if (r.point.name !== point.name) {
        point.name = r.point.name;
        el.querySelector('h1').textContent = point.name;
      }
      const persisted = new Set(rows.map((p) => p.product_id));
      const extraIds = extras().filter((id) => !persisted.has(id) && productById(id));
      saveExtras(extraIds);
      for (const id of extraIds) rows.push({...productById(id),product_id:id,stock:null,controlled:null,counted_tonight:false,result:null});
      ready = true;
      drawGrid();
    } catch (err) {
      if (seq !== request || !el.isConnected) return;
      if (ready) toast(err.message,'error');
      else mount(el.querySelector('#shelf-grid'), html`<p class="shelf-empty">${err.message}</p>`);
    }
  }

  bindCountFields(panel, () => selected);
  panel.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!selected) return;
    const data = Object.fromEntries(new FormData(e.target));
    if (Object.values(data).every((v) => v === '')) return toast('Escribe cuántas hay (0 si no queda ninguna)','info');
    const qty = countedQty(selected,data);
    if (qty===null) return toast('Como mucho 10.000 botellas','error');
    enqueue({product_id:selected.product_id,qty,store_id:point.id});
    buzz(20);
    const list = ordered(); const pos = list.findIndex((p) => p.product_id===selected.product_id);
    const next = list.slice(pos+1).find((p) => !done(p)) ?? list.slice(0,pos).find((p) => !done(p));
    if (next) category = shelfCategory(next);
    open(next ?? null);
    if (!next) toast('Has contado todo lo de este punto');
    flushCounts().then(() => { if (el.isConnected) { drawGrid(); refresh(); } });
  });

  el.addEventListener('click', async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.mode) {
      mode=b.dataset.mode; open(null);
      for (const btn of el.querySelectorAll('[data-mode]')) { const on = btn.dataset.mode===mode; btn.classList.toggle('on',on); btn.setAttribute('aria-pressed',String(on)); }
      // No se conserva stock de consultar mientras llega la respuesta de contar.
      if (mode==='contar') rows=rows.map((p) => ({...p,stock:null,controlled:null,result:p.counted_tonight ? p.result : null}));
      drawGrid(); refresh();
    } else if (b.dataset.cat) { category=b.dataset.cat; drawGrid(); el.querySelector(`[data-cat="${category}"]`)?.focus(); }
    else if (b.dataset.pid) {
      const p = rows.find((x) => x.product_id===Number(b.dataset.pid));
      if (mode==='consultar') location.hash=`#/almacen/in/${point.map_key}/botella/${p.product_id}`;
      else open(p);
    } else if (b.hasAttribute('data-close-panel')) open(null);
    else if (b.hasAttribute('data-add')) {
      const id = await pickProduct();
      if (!id || !el.isConnected) return;
      let p = rows.find((x) => x.product_id===id);
      if (!p) { p={...productById(id),product_id:id,counted_tonight:false,result:null}; rows.push(p); saveExtras([...new Set([...extras(),id])]); }
      category=shelfCategory(p); open(p);
    }
  });
  el.querySelector('.shelf-tabs').addEventListener('keydown',(e) => {
    const tabs=[...el.querySelectorAll('[data-cat]')]; const i=tabs.indexOf(e.target);
    if(i<0 || !['ArrowRight','ArrowLeft','Home','End'].includes(e.key)) return;
    e.preventDefault(); const next=e.key==='Home' ? 0 : e.key==='End' ? tabs.length-1 : (i+(e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;
    tabs[next].click(); el.querySelector(`[data-cat="${category}"]`)?.scrollIntoView({block:'nearest',inline:'nearest'});
  });
  const resize = new ResizeObserver(() => {
    if (!panel.hidden) el.style.setProperty('--shelf-panel-height', panel.getBoundingClientRect().height+'px');
  });
  resize.observe(panel);
  const unsub=onStockChange(refresh); refresh();
  return () => { request++; unsub(); resize.disconnect(); };
}

async function pickProduct() {
  return dialog({title:'Añadir botella a este punto',body:html`<label class="field"><span>Buscar en el catálogo</span><input type="search" id="extra-q" autocomplete="off" autofocus></label><ul class="point-list" id="extra-list"></ul>`,
    onMount(dlg,close) {
      const draw=() => {const q=norm(dlg.querySelector('#extra-q').value); mount(dlg.querySelector('#extra-list'),html`${state.products.filter((p) => norm(p.name).includes(q)).map((p) => html`<li><button type="button" data-extra="${p.id}">${thumb(p,'xs')}<b>${p.name}</b>${raw(icon('plus'))}</button></li>`)}`);};
      dlg.querySelector('#extra-q').addEventListener('input',draw);
      dlg.addEventListener('click',(e) => {const b=e.target.closest('[data-extra]'); if(b) close(Number(b.dataset.extra));}); draw();
    }});
}
