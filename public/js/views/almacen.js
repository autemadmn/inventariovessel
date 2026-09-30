// Almacén: lo que queda en el almacén del local y para cuánto hay, el detalle de
// cada botella (movimientos y roturas) y el modo «Contar», una botella por
// pantalla y a ciegas. Lo contado se guarda en el móvil y se envía en cuanto hay
// conexión, así que cortar o salir no pierde nada.
import { get, post, store } from '../api.js';
import {
  state, subscribe, selection, productById, groupById, localStore, loadLive, caseParts, stockText, countTime,
} from '../state.js';
import {
  raw, $, html, mount, norm, thumb, toast, buzz, fmt, plural, dateLabel, dateTimeLabel, dialog, confirmDialog,
} from '../ui.js';
import { icon } from '../icons.js';

const back = () => html`
  <a class="inf-back" href="#/almacen">${raw(icon('left', { size: 18 }))} Almacén</a>`;

export function renderAlmacen(root, rest = []) {
  if (rest[0] === 'botella') return renderDetalle(root, rest[1]);
  if (rest[0] === 'contar') return renderContar(root);
  return renderLista(root);
}

/** Vuelve a pedir datos cuando cambia el stock o el catálogo en otro móvil. */
function onStockChange(fn) {
  const key = () => `${state.catalogRev}|${JSON.stringify(state.live.stock ?? {})}`;
  let last = key();
  return subscribe(() => {
    const k = key();
    if (k === last) return;
    last = k;
    fn();
  });
}

// ------------------------------------------------------------------ cantidades

/** Cantidad grande: «3 cajas + 4», «0 cajas + 2» o «22 botellas». */
function qtyHtml(n, perCase) {
  const c = caseParts(n, perCase);
  if (!c) return html`<b>${fmt(n)}</b> <i>${n === 1 ? 'botella' : 'botellas'}</i>`;
  return html`<b>${fmt(c.full)}</b> <i>${c.full === 1 ? 'caja' : 'cajas'}</i>${c.loose ? html` <i>+</i> <b>${fmt(c.loose)}</b>` : ''}`;
}

const STATE_TEXT = { no_queda: 'No queda', queda_poco: 'Queda poco' };

function stateTags(p) {
  return html`
    ${p.state === 'queda_poco' ? html`<span class="tag warn">Queda poco</span>` : ''}
    ${p.review ? html`<span class="tag warn">Revisar</span>` : ''}`;
}

// ------------------------------------------------------------------ lista

let query = '';

function renderLista(root) {
  mount(root, html`
    <section class="alm" id="alm">
      <div class="alm-top">
        <h1 class="alm-title" id="alm-title">${localStore()?.name ?? ''}</h1>
        <a class="btn primary alm-count-btn" href="#/almacen/contar">
          ${raw(icon('clipboard-list', { size: 20 }))}${countSession() ? 'Seguir contando' : 'Contar'}</a>
      </div>
      <div class="filters alm-filters">
        <label class="search">${raw(icon('search', { size: 18 }))}
          <input type="search" id="alm-q" placeholder="Buscar botella" value="${query}" autocomplete="off" enterkeyhint="search" aria-label="Buscar botella"></label>
      </div>
      <div id="alm-list" class="alm-body" aria-live="polite"><p class="empty">Cargando…</p></div>
    </section>`);

  const el = $('#alm', root);
  let r = null;
  let requestId = 0;

  const draw = () => {
    const box = $('#alm-list', el);
    if (!box || !r) return;
    $('#alm-title', el).textContent = r.store.name;
    mount(box, listView(r));
  };

  const refresh = async () => {
    const id = ++requestId;
    el.classList.add('is-loading');
    try {
      const result = await get('/api/almacen');
      if (id !== requestId || !el.isConnected) return;
      r = result;
      draw();
    } catch (err) {
      if (id !== requestId || !el.isConnected) return;
      if (r) toast(err.message, 'error');
      else mount($('#alm-list', el), html`<p class="empty">${err.message}</p>`);
    } finally {
      if (id === requestId) el.classList.remove('is-loading');
    }
  };

  $('#alm-q', el).addEventListener('input', (e) => {
    query = e.target.value;
    draw();
  });

  const unsub = onStockChange(refresh);
  refresh();
  return () => unsub();
}

function listView(r) {
  if (!r.products.length) {
    return html`<p class="empty">No hay botellas en la selección. El encargado puede añadirlas en Gestión → Selección.</p>`;
  }
  const q = norm(query.trim());
  const items = r.products.filter((p) => !q || norm(p.name).includes(q) || norm(p.name).replace(/\s/g, '').includes(q.replace(/\s/g, '')));
  if (!items.length) return html`<p class="empty">No hay botellas que coincidan con «${query}».</p>`;

  const counted = items.filter((p) => p.section !== 'sin_contar');
  const uncounted = items.filter((p) => p.section === 'sin_contar');

  let blocks;
  if (q) {
    blocks = counted.length ? html`<ul class="inf-list alm-list">${counted.map((p) => row(p))}</ul>` : '';
  } else {
    const urgent = ['no_queda', 'queda_poco'].map((s) => [s, counted.filter((p) => p.section === s)]).filter(([, l]) => l.length);
    blocks = html`
      ${urgent.map(([s, l]) => html`
        <h2 class="alm-sec ${s}">${STATE_TEXT[s]} <span>${fmt(l.length)}</span></h2>
        <ul class="inf-list alm-list">${l.map((p) => row(p))}</ul>`)}
      ${groupRuns(counted.filter((p) => p.section === 'resto')).map(({ title, list }) => html`
        <h2 class="alm-sec">${title}</h2>
        <ul class="inf-list alm-list">${list.map((p) => row(p))}</ul>`)}`;
  }

  return html`
    ${blocks}
    ${!counted.length && !q ? html`<p class="alm-hint">Pulsa «Contar» para saber lo que queda.</p>` : ''}
    ${uncounted.length ? html`
      <details class="inf-zero alm-zero" ${q ? 'open' : ''}>
        <summary>${raw(icon('right', { size: 18 }))} Sin contar · ${fmt(uncounted.length)}</summary>
        <ul class="inf-list quiet">${uncounted.map((p) => row(p))}</ul>
      </details>` : ''}`;
}

/** Tramos seguidos del mismo grupo, en el orden en que llegan (el de Selección). */
function groupRuns(list) {
  const runs = [];
  for (const p of list) {
    const g = p.group_id !== null ? groupById(p.group_id) : null;
    const title = g ? g.name : 'Fuera de la selección';
    if (runs.at(-1)?.title === title) runs.at(-1).list.push(p);
    else runs.push({ title, list: [p] });
  }
  return runs;
}

function row(p) {
  const out = p.controlled && p.stock <= 0;
  const label = [
    p.name,
    !p.controlled ? 'sin contar' : out ? 'no queda' : stockText(p.stock, p.per_case),
    p.duration?.label, p.state === 'queda_poco' ? 'queda poco' : '', p.review ? 'revisar' : '',
  ].filter(Boolean).join(', ');
  return html`
    <li>
      <a class="inf-row alm-row ${p.state ? p.state.replace('_', '-') : ''}" href="#/almacen/botella/${p.product_id}" aria-label="${label}">
        ${thumb(p, 'inf-img')}
        <span class="inf-name">
          <b>${p.name}</b>
          ${stateTags(p)}
        </span>
        ${p.controlled ? html`
          <span class="alm-num">
            ${out ? html`<span class="alm-none">No queda</span>` : html`<span class="alm-qty">${qtyHtml(p.stock, p.per_case)}</span>`}
            ${!out && p.duration ? html`<small>${p.duration.label}</small>` : ''}
          </span>` : ''}
      </a>
    </li>`;
}

// ------------------------------------------------------------------ detalle

function renderDetalle(root, rawId) {
  const id = Number(rawId);
  mount(root, html`<section class="alm alm-detail" id="alm-detail">${back()}<p class="empty">Cargando…</p></section>`);
  const el = $('#alm-detail', root);
  if (!Number.isInteger(id) || id < 1) {
    mount(el, html`${back()}<p class="empty">Producto no encontrado</p>`);
    return undefined;
  }

  let r = null;
  let requestId = 0;
  const draw = () => mount(el, detailView(r));

  const refresh = async () => {
    const request = ++requestId;
    try {
      const result = await get(`/api/almacen/botella/${id}`);
      if (request !== requestId || !el.isConnected) return;
      r = result;
      draw();
    } catch (err) {
      if (request !== requestId || !el.isConnected) return;
      if (r) toast(err.message, 'error');
      else mount(el, html`${back()}<p class="empty">${err.message}</p>`);
    }
  };

  el.addEventListener('click', async (e) => {
    const t = e.target.closest('button');
    if (!t || !r) return;
    try {
      if (t.dataset.broken !== undefined) {
        const res = await breakage(r);
        if (!res) return;
        r = res;
        draw();
        buzz(20);
        toast('Rotura guardada');
        await loadLive().catch(() => {});
      } else if (t.dataset.countOne !== undefined) {
        if (await countOne(r.product)) await refresh();
      }
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  const unsub = onStockChange(refresh);
  refresh();
  return () => unsub();
}

function detailView(r) {
  const p = r.product;
  const out = r.controlled && r.stock <= 0;
  const groupName = p.group_id ? groupById(p.group_id)?.name : null;
  return html`
    ${back()}
    <header class="bt-head">
      ${thumb(p, 'lg')}
      <div class="bt-title">
        <h2>${p.name}</h2>
        <p class="muted">${[r.store.name, groupName].filter(Boolean).join(' · ')}</p>
        ${r.state === 'queda_poco' || r.review ? html`<div class="alm-tags">${stateTags(r)}</div>` : ''}
      </div>
    </header>

    <div class="alm-stock ${r.state ? r.state.replace('_', '-') : ''}">
      ${!r.controlled ? html`
        <p class="alm-stock-big muted-big">Sin contar</p>
        <p class="alm-stock-sub">Cuéntala para saber lo que queda.</p>`
    : out ? html`
        <p class="alm-stock-big alm-none">No queda</p>`
      : html`
        <p class="alm-stock-big alm-qty">${qtyHtml(r.stock, p.per_case)}</p>
        ${r.duration ? html`<p class="alm-stock-sub">${r.duration.label}</p>` : ''}`}
      ${r.last_count ? html`<p class="alm-stock-meta">Contado ${dateTimeLabel(r.last_count.counted_at)}${r.last_count.counted_by ? ` · ${r.last_count.counted_by}` : ''}</p>` : ''}
    </div>

    <div class="alm-actions">
      <button type="button" class="btn primary" data-count-one>${raw(icon('clipboard-list', { size: 20 }))} Contar esta botella</button>
      <button type="button" class="btn ghost" data-broken>${raw(icon('wine-off', { size: 20 }))} Se ha roto una</button>
    </div>

    <h2 class="section-title">Movimientos</h2>
    ${r.history.length
    ? html`<ul class="bt-dels alm-hist">${r.history.map((h) => histRow(h, r.store.id, p.per_case))}</ul>`
    : html`<p class="bt-empty muted">Todavía no hay movimientos.</p>`}`;
}

function histRow(h, storeId, perCase) {
  const by = h.by ? ` · ${h.by}` : '';
  let ico; let title; let sub; let qty; let kind = '';
  if (h.type === 'recuento') {
    // Un recuento no suma ni resta: dice cuántas había, así que va en el texto y no en la columna de ±.
    [ico, title, sub, qty] = ['clipboard-list', `Contadas: ${stockText(h.qty, perCase)}`, `${dateTimeLabel(h.at)}${by}`, ''];
    kind = 'count';
  } else if (h.type === 'reposicion') {
    [ico, title, sub, qty] = ['list', 'Repuestas a barra', `Noche del ${dateLabel(h.date)}`, `−${fmt(h.qty)}`];
  } else if (h.type === 'rotura') {
    [ico, title, sub, qty] = ['wine-off', 'Rota', [h.note, `${dateTimeLabel(h.at)}${by}`].filter(Boolean).join(' · '), `−${fmt(h.qty)}`];
    kind = 'broken';
  } else {
    const inside = h.to_store_id === storeId;
    [ico, title, sub, qty] = ['warehouse', h.type === 'entrada' ? 'Entrada' : 'Traslado', `${dateTimeLabel(h.at)}${by}`, `${inside ? '+' : '−'}${fmt(h.qty)}`];
  }
  return html`
    <li class="alm-h ${kind}">
      <span class="alm-h-ico">${raw(icon(ico, { size: 18 }))}</span>
      <span class="bt-del-text"><b>${title}</b><small>${sub}</small></span>
      <span class="bt-del-qty">${qty}</span>
    </li>`;
}

/** «Se ha roto una»: cantidad (desde 1) y motivo opcional. Devuelve el detalle actualizado. */
async function breakage(r) {
  let n = 1;
  const data = await dialog({
    title: 'Se ha roto una',
    body: html`
      <p class="muted">${r.product.name}</p>
      <div class="field"><span>Botellas rotas</span>
        <div class="stepper big-step">
          <button type="button" class="step" data-step="-1" aria-label="Una menos">${raw(icon('minus', { size: 22 }))}</button>
          <output id="brk-n">1</output>
          <button type="button" class="step" data-step="1" aria-label="Una más">${raw(icon('plus', { size: 22 }))}</button>
        </div>
      </div>
      <label class="field"><span>Motivo (opcional)</span>
        <input name="note" maxlength="200" autocomplete="off" enterkeyhint="done"></label>`,
    actions: [{ label: 'Cancelar', value: '' }, { label: 'Guardar', submit: true, kind: 'danger' }],
    onMount(dlg) {
      dlg.addEventListener('click', (e) => {
        const b = e.target.closest('[data-step]');
        if (!b) return;
        n = Math.max(1, Math.min(10000, n + Number(b.dataset.step)));
        dlg.querySelector('#brk-n').textContent = n;
        buzz(8);
      });
    },
  });
  if (!data || typeof data !== 'object') return null;
  const note = String(data.note || '').trim();
  return post('/api/almacen/roturas', { product_id: r.product.id, qty: n, ...(note ? { note } : {}), by: state.who });
}

/** «Contar esta botella»: el mismo recuento a ciegas, en una hoja. */
async function countOne(p) {
  const data = await dialog({
    title: 'Contar esta botella',
    body: html`
      <div class="cnt-mini">${thumb(p, 'sm')}<b>${p.name}</b></div>
      ${countFields(p)}`,
    actions: [{ label: 'Cancelar', value: '' }, { label: 'Guardar', submit: true, kind: 'primary' }],
    onMount: (dlg) => bindCountFields(dlg, () => p),
  });
  if (!data || typeof data !== 'object') return false;
  const qty = countedQty(p, data);
  if (qty === null) {
    toast('Como mucho 10.000 botellas', 'error');
    return false;
  }
  enqueue({ product_id: p.id, qty });
  buzz(20);
  const left = await flushCounts();
  toast(left ? 'Guardado. Se enviará al volver la conexión.' : 'Recuento guardado', left ? 'info' : 'ok');
  return true;
}

// ------------------------------------------------------------------ campos de recuento

function countField(name, label, hint = '') {
  return html`
    <div class="cnt-field">
      <label for="cnt-${name}">${label}${hint ? html` <small>${hint}</small>` : ''}</label>
      <div class="cnt-step">
        <button type="button" class="step" data-cstep="-1" data-f="${name}" aria-label="Una menos">${raw(icon('minus', { size: 22 }))}</button>
        <input id="cnt-${name}" name="${name}" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="5"
          placeholder="0" autocomplete="off" enterkeyhint="done">
        <button type="button" class="step" data-cstep="1" data-f="${name}" aria-label="Una más">${raw(icon('plus', { size: 22 }))}</button>
      </div>
    </div>`;
}

function countFields(p) {
  return html`
    <div class="cnt-fields">
      ${p.per_case > 0
    ? html`${countField('cases', 'Cajas', `de ${p.per_case}`)}${countField('loose', 'Sueltas')}`
    : countField('bottles', 'Botellas')}
      <p class="cnt-total" id="cnt-total" aria-live="polite"></p>
    </div>`;
}

const intOf = (v) => {
  const n = Number(String(v ?? '').replace(/\D/g, ''));
  return Number.isFinite(n) ? n : 0;
};

/** Botellas contadas; null si pasa del máximo. */
function countedQty(p, data) {
  const qty = p.per_case > 0 ? intOf(data.cases) * p.per_case + intOf(data.loose) : intOf(data.bottles);
  return qty > 10000 ? null : qty;
}

/**
 * Botones − y +, solo dígitos y el total en botellas (lo contado, nunca lo esperado).
 * Se engancha una sola vez al contenedor; `product()` da la botella que se ve.
 */
function bindCountFields(box, product) {
  const total = () => {
    const out = box.querySelector('#cnt-total');
    const form = box.querySelector('.cnt-fields')?.closest('form');
    const p = product();
    if (!out || !form || !p || !(p.per_case > 0)) return;
    const n = countedQty(p, Object.fromEntries(new FormData(form)));
    out.textContent = n === null ? 'Como mucho 10.000 botellas' : `Total: ${plural(n, 'botella', 'botellas')}`;
  };
  box.addEventListener('click', (e) => {
    const b = e.target.closest('[data-cstep]');
    if (!b) return;
    const input = box.querySelector(`#cnt-${b.dataset.f}`);
    input.value = String(Math.max(0, Math.min(99999, intOf(input.value) + Number(b.dataset.cstep))));
    buzz(8);
    total();
  });
  box.addEventListener('input', (e) => {
    if (!e.target.matches('.cnt-step input')) return;
    const clean = e.target.value.replace(/\D/g, '');
    if (clean !== e.target.value) e.target.value = clean;
    total();
  });
  // Intro en «Cajas» pasa a «Sueltas» en vez de guardar.
  box.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !e.target.matches('.cnt-step input')) return;
    const inputs = [...box.querySelectorAll('.cnt-step input')];
    const next = inputs[inputs.indexOf(e.target) + 1];
    if (!next) return;
    e.preventDefault();
    next.focus();
  });
}

// ------------------------------------------------------------------ recuentos pendientes de enviar

const QUEUE = 'almCountQueue';
const SESSION = 'almCount';

function enqueue({ product_id, qty }) {
  const queue = store.get(QUEUE, []);
  queue.push({
    key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    product_id, qty, counted_at: countTime(), by: state.who,
  });
  store.set(QUEUE, queue);
}

const pendingCount = () => store.get(QUEUE, []).length;

let flushing = null;

/** Envía los recuentos guardados en el móvil, uno a uno. Devuelve cuántos quedan sin enviar. */
export function flushCounts() {
  flushing ??= sendQueue().finally(() => { flushing = null; });
  return flushing;
}

async function sendQueue() {
  let sent = 0;
  const seen = new Set();
  for (;;) {
    const [item] = store.get(QUEUE, []);
    if (!item || seen.has(item.key)) break; // sin almacenamiento no se repite en bucle
    seen.add(item.key);
    try {
      await post('/api/almacen/recuentos', {
        items: [{ product_id: item.product_id, qty: item.qty }], by: item.by,
        counted_at: item.counted_at, key: item.key,
      });
      sent++;
    } catch (err) {
      // Sin conexión, sin acceso o el servidor falla: se reintenta más tarde.
      if (err.status === 0 || err.status === 401 || err.status === 403 || err.status >= 500) break;
      // El servidor no lo acepta (p. ej. la botella ya no existe): se descarta para no atascar la cola.
      toast(err.message, 'error');
    }
    store.set(QUEUE, store.get(QUEUE, []).filter((q) => q.key !== item.key));
  }
  if (sent) await loadLive().catch(() => {});
  return pendingCount();
}

// ------------------------------------------------------------------ modo Contar

/** Recuento en curso: { ids, pos, saved, label }, o null. */
function countSession() {
  const s = store.get(SESSION, null);
  return s && Array.isArray(s.ids) && s.pos < s.ids.length ? s : null;
}

function renderContar(root) {
  mount(root, html`<section class="alm cnt" id="cnt"></section>`);
  const el = $('#cnt', root);

  const draw = () => {
    const s = countSession();
    if (!s) {
      mount(el, pickView());
      return;
    }
    // Botellas retiradas del catálogo desde que empezó el recuento: se saltan.
    while (s.pos < s.ids.length && !productById(s.ids[s.pos])) s.pos++;
    store.set(SESSION, s);
    if (s.pos >= s.ids.length) {
      finish(s);
      return;
    }
    mount(el, stepView(s, productById(s.ids[s.pos])));
  };

  bindCountFields(el, () => {
    const s = countSession();
    return s && productById(s.ids[s.pos]);
  });

  const refreshPending = async () => {
    const left = await flushCounts();
    const tag = $('#cnt-pending', el);
    if (tag) {
      tag.hidden = !left;
      tag.textContent = `${fmt(left)} por enviar`;
    }
  };

  el.addEventListener('click', async (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    const d = t.dataset;
    if (d.pick !== undefined) {
      const ids = d.pick === 'all'
        ? selection().flatMap((g) => g.products.map((p) => p.id))
        : selection().find((g) => String(g.group.id) === d.pick)?.products.map((p) => p.id) ?? [];
      if (!ids.length) return;
      store.set(SESSION, { ids, pos: 0, saved: 0 });
      buzz();
      draw();
      window.scrollTo(0, 0);
    } else if (d.skip !== undefined) {
      advance(false);
    } else if (d.end !== undefined) {
      const s = countSession();
      if (!s) return;
      const left = s.ids.length - s.pos;
      if (!await confirmDialog('Terminar el recuento', `Quedan ${plural(left, 'botella', 'botellas')} sin contar. Lo contado ya está guardado.`, { ok: 'Terminar' })) return;
      finish(s);
    }
  });

  el.addEventListener('submit', (e) => {
    e.preventDefault();
    const s = countSession();
    const p = s && productById(s.ids[s.pos]);
    if (!p) return;
    const qty = countedQty(p, Object.fromEntries(new FormData(e.target)));
    if (qty === null) {
      toast('Como mucho 10.000 botellas', 'error');
      return;
    }
    enqueue({ product_id: p.id, qty });
    buzz(20);
    advance(true);
  });

  function advance(saved) {
    const s = countSession();
    if (!s) return;
    s.pos++;
    if (saved) s.saved++;
    store.set(SESSION, s);
    if (s.pos >= s.ids.length) {
      finish(s);
      return;
    }
    draw();
    window.scrollTo(0, 0);
    refreshPending();
  }

  draw();
  refreshPending();
  return undefined;
}

async function finish(s) {
  store.set(SESSION, null);
  const left = await flushCounts();
  const n = s.saved;
  const text = n === 1 ? 'Contada 1 botella' : `Contadas ${fmt(n)} botellas`;
  toast(left ? `${text}. Se enviarán al volver la conexión.` : text, left ? 'info' : 'ok');
  location.hash = '#/almacen';
}

function pickView() {
  const groups = selection();
  const total = groups.reduce((a, g) => a + g.products.length, 0);
  return html`
    ${back()}
    <h1 class="alm-title cnt-h">Contar</h1>
    <p class="muted">¿Qué vas a contar?</p>
    ${total ? html`
      <div class="cnt-pick">
        <button type="button" class="cnt-pick-btn all" data-pick="all">
          <span><b>Todo</b><small>${plural(total, 'botella', 'botellas')}</small></span>${raw(icon('right', { size: 20 }))}</button>
        ${groups.map((g) => html`
          <button type="button" class="cnt-pick-btn" data-pick="${g.group.id}">
            <span><b>${g.group.name}</b><small>${plural(g.products.length, 'botella', 'botellas')}</small></span>${raw(icon('right', { size: 20 }))}</button>`)}
      </div>`
    : html`<p class="empty">No hay botellas en la selección.</p>`}`;
}

function stepView(s, p) {
  const group = p.group_id ? groupById(p.group_id)?.name : '';
  const pct = Math.round((s.pos / s.ids.length) * 100);
  return html`
    <div class="cnt-top">
      <a class="inf-back" href="#/almacen">${raw(icon('left', { size: 18 }))} Almacén</a>
      <button type="button" class="btn small ghost cnt-end" data-end>Terminar</button>
    </div>
    <div class="cnt-bar" role="progressbar" aria-label="Progreso del recuento"
      aria-valuemin="0" aria-valuemax="${s.ids.length}" aria-valuenow="${s.pos}"><i style="width:${pct}%"></i></div>
    <p class="cnt-pos">
      <b>${fmt(s.pos + 1)} de ${fmt(s.ids.length)}</b>${group ? html` · ${group}` : ''}
      <span class="tag warn" id="cnt-pending" hidden></span>
    </p>

    <form class="cnt-form" autocomplete="off" data-pid="${p.id}">
      <div class="cnt-card">
        ${thumb(p, 'cnt-img')}
        <h2>${p.name}</h2>
      </div>
      ${countFields(p)}
      <div class="cnt-btns">
        <button type="button" class="btn ghost big" data-skip>Saltar</button>
        <button type="submit" class="btn primary big">Guardar y siguiente</button>
      </div>
    </form>`;
}
