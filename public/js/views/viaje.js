// Pedido Out → In Vessel: se apunta, se carga lo real y se termina el viaje.
import { get, post, put } from '../api.js';
import { state, productById, loadLive, stockText } from '../state.js';
import { raw, $, html, mount, thumb, toast, buzz, fmt, plural, bottles, dialog, confirmDialog } from '../ui.js';
import { icon } from '../icons.js';
import { qtyHtml, askQty, onStockChange } from './almacen.js';
import { SHELF_CATEGORIES, shelfCategory } from './estanteria.js';
import { viajesHeader } from './viajes.js';

/** Conserva la firma usada en Reponer y en la ficha de Almacén. */
export async function apuntar(productId, qty = null) {
  const res = await post('/api/viajes/pedido/lineas', {
    product_id: productId, ...(qty ? { qty_planned: qty } : {}), by: state.who,
  });
  buzz(20);
  toast(res.already ? 'Ya estaba en el pedido' : 'Apuntado en el pedido', res.already ? 'info' : 'ok');
  loadLive().catch(() => {});
  return res;
}

function stepQty(q, perCase, dir) {
  const step = perCase > 0 ? perCase : 1;
  const rest = q % step;
  return dir > 0 ? Math.min(10000, q + step - rest) : Math.max(1, rest ? q - rest : q - step);
}

export function renderViaje(root) {
  mount(root, html`<section class="alm viajes trip" id="trip">${viajesHeader('pedido')}<p class="empty">Cargando…</p></section>`);
  const el = $('#trip', root);
  let v = null; let requestId = 0; let busy = false;
  const edits = new Map(); const timers = new Map(); const flights = new Map();
  const draw = () => {
    if (!v || !el.isConnected) return;
    const focused = document.activeElement;
    const id = el.contains(focused) ? focused.dataset.line : null;
    const step = focused?.dataset.step;
    const edit = focused?.dataset.edit;
    mount(el, tripView(v, edits, busy));
    if (id && (step !== undefined || edit !== undefined)) {
      el.querySelector(`[data-line="${id}"][${step !== undefined ? `data-step="${step}"` : 'data-edit'}]`)?.focus({ preventScroll: true });
    }
  };
  const apply = (res) => { v = res; draw(); };
  const refresh = async () => {
    const id = ++requestId;
    try {
      const res = await get('/api/viajes/pedido');
      if (id !== requestId || !el.isConnected || edits.size || flights.size || busy) return;
      apply(res);
    } catch (err) {
      if (id !== requestId || !el.isConnected) return;
      if (v) toast(err.message, 'error');
      else mount(el, html`${viajesHeader('pedido')}<p class="empty">${err.message}</p><button type="button" class="btn ghost" data-retry>Reintentar</button>`);
    }
  };
  const fail = (err) => {
    toast(err.message, err.status === 409 ? 'info' : 'error');
    if (err.status === 409) {
      for (const timer of timers.values()) clearTimeout(timer);
      edits.clear(); timers.clear();
    }
  };
  const flush = (id) => {
    clearTimeout(timers.get(id)); timers.delete(id);
    if (flights.has(id)) return flights.get(id);
    const task = (async () => {
      while (edits.has(id)) {
        const edit = edits.get(id);
        try {
          const res = await put(`/api/viajes/pedido/lineas/${id}`, { [edit.field]: edit.qty, by: state.who });
          if (edits.get(id) === edit) edits.delete(id);
          apply(res);
        } catch (err) { fail(err); return false; }
      }
      loadLive().catch(() => {});
      return true;
    })().finally(() => { flights.delete(id); if (!edits.size && !busy) refresh(); });
    flights.set(id, task);
    return task;
  };
  const flushAll = async () => (await Promise.all([...new Set([...edits.keys(), ...flights.keys()])].map(flush))).every(Boolean);
  const lineOf = (id) => v?.lines.find((l) => l.id === id);
  const setQty = (line, qty) => {
    edits.set(line.id, { field: line.checked ? 'qty_loaded' : 'qty_planned', qty });
    draw();
    clearTimeout(timers.get(line.id));
    timers.set(line.id, setTimeout(() => flush(line.id), 700));
  };
  el.addEventListener('click', async (event) => {
    const button = event.target.closest('button');
    if (!button || busy) return;
    const d = button.dataset;
    if (d.retry !== undefined) { refresh(); return; }
    if (!v) return;
    const line = d.line ? lineOf(Number(d.line)) : null;
    const locks = d.check !== undefined || d.rm !== undefined || d.note !== undefined || d.done !== undefined;
    if (locks) { busy = true; draw(); }
    try {
      if (d.step && line) {
        const qty = edits.get(line.id)?.qty ?? (line.checked ? line.qty_loaded ?? line.qty_planned : line.qty_planned);
        setQty(line, stepQty(qty ?? 1, line.checked ? null : line.per_case, Number(d.step))); buzz(8);
      } else if (d.edit !== undefined && line) {
        const qty = await askQty({ title: line.checked ? 'Cantidad cargada' : 'Cantidad pedida',
          product: { ...(productById(line.product_id) ?? line), per_case: line.per_case },
          initial: edits.get(line.id)?.qty ?? (line.checked ? line.qty_loaded ?? line.qty_planned : line.qty_planned), min: 1 });
        if (qty !== null) { setQty(line, qty); await flush(line.id); }
      } else if (d.check !== undefined && line) {
        if (!await flushAll()) return;
        apply(await put(`/api/viajes/pedido/lineas/${line.id}`, { checked: line.checked ? 0 : 1, by: state.who }));
        buzz(20); loadLive().catch(() => {});
      } else if (d.rm !== undefined && line) {
        if (!await confirmDialog('Quitar del pedido', `${line.name ?? line.text} deja de estar en el pedido.`, { ok: 'Quitar', kind: 'danger' })) return;
        if (!await flushAll()) return;
        apply(await post(`/api/viajes/pedido/lineas/${line.id}/quitar`, { by: state.who }));
        toast('Quitado del pedido'); loadLive().catch(() => {});
      } else if (d.note !== undefined) {
        const text = await askNote();
        if (!text || !await flushAll()) return;
        apply(await post('/api/viajes/pedido/lineas', { text, by: state.who }));
        buzz(20); toast('Nota apuntada'); loadLive().catch(() => {});
      } else if (d.done !== undefined) {
        if (!await flushAll()) return;
        await finishTrip(v, apply);
      }
    } catch (err) { fail(err); }
    finally { if (locks) { busy = false; draw(); refresh(); } }
  });
  const unsub = onStockChange(refresh);
  const online = async () => { if (await flushAll()) refresh(); };
  window.addEventListener('online', online);
  refresh();
  return () => { unsub(); requestId++; window.removeEventListener('online', online); return flushAll(); };
}

async function askNote() {
  const data = await dialog({ title: 'Apuntar una nota', body: html`
    <label class="field"><span>Qué hay que traer</span><input name="text" maxlength="80" required autofocus autocomplete="off" enterkeyhint="done" placeholder="Por ejemplo, tónica"></label>`,
    actions: [{ label: 'Cancelar', value: '' }, { label: 'Apuntar', submit: true, kind: 'primary' }],
  });
  return data && typeof data === 'object' ? String(data.text || '').trim().slice(0, 80) : '';
}

async function finishTrip(v, apply) {
  const loaded = v.lines.filter((l) => l.checked);
  if (!loaded.length) return;
  const n = loaded.reduce((sum, l) => sum + (l.product_id ? (l.qty_loaded ?? l.qty_planned ?? 0) : 0), 0);
  const carry = v.lines.length - loaded.length;
  const text = [n ? `Llegan ${bottles(n)} a ${v.to?.name ?? 'In Vessel'}.` : '',
    carry ? `${carry === 1 ? 'La línea sin cargar pasa' : `Las ${fmt(carry)} líneas sin cargar pasan`} al próximo viaje.` : ''].filter(Boolean).join(' ');
  if (!await confirmDialog('¿Viaje hecho?', text || 'Se cierra el viaje.', { ok: 'Hecho' })) return;
  const res = await post('/api/viajes/pedido/hecho', { trip_id: v.trip.id, by: state.who });
  buzz(30);
  toast(res.carried ? `Viaje hecho. ${plural(res.carried, 'línea pasa', 'líneas pasan')} al próximo.` : 'Viaje hecho');
  await loadLive().catch(() => {});
  apply(await get('/api/viajes/pedido'));
}

function tripView(v, edits, busy) {
  const lines = v.lines;
  const checked = lines.filter((l) => l.checked).length;
  const categories = SHELF_CATEGORIES.map(([id, name]) => ({ name: state.categories.find((c) => c.id === id)?.name ?? name,
    lines: lines.filter((l) => l.product_id && shelfCategory(l) === id) })).filter((g) => g.lines.length);
  const notes = lines.filter((l) => !l.product_id);
  if (notes.length) categories.push({ name: 'Apuntes', lines: notes });
  return html`${viajesHeader('pedido')}<header class="trip-head"><p class="trip-route">${v.from?.name ?? 'Out Vessel'} ${raw(icon('right', { size: 16 }))} ${v.to?.name ?? 'In Vessel'}</p></header>
    ${lines.length ? html`<div class="trip-progress"><p><b>${fmt(checked)} de ${fmt(lines.length)}</b> cargadas</p><div class="cnt-bar" role="progressbar" aria-label="Cargado" aria-valuemin="0" aria-valuemax="${lines.length}" aria-valuenow="${checked}"><progress value="${checked}" max="${lines.length}"></progress></div></div>` : ''}
    <div class="trip-tools"><button type="button" class="btn ghost" data-note ${busy ? raw('disabled') : ''}>${raw(icon('pencil', { size: 20 }))} Apuntar una nota</button></div>
    ${lines.length ? html`${categories.map((g) => html`<section class="trip-group"><h2>${g.name}</h2><ul class="trip-list">${g.lines.map((line) => lineView(line, edits.get(line.id), busy))}</ul></section>`)}
      <div class="trip-foot"><button type="button" class="btn primary big" data-done ${checked && !busy ? '' : raw('disabled')}>${raw(icon('check', { size: 20 }))} Hecho</button><p class="trip-foot-hint">Marca lo que va en el coche.</p></div>`
      : html`<div class="trip-empty">${raw(icon('truck', { size: 40 }))}<p><b>El pedido está vacío</b></p><p class="muted">Mira Necesidades y añade lo que haga falta.</p><a class="btn primary" href="#/viajes/necesidades">Ir a Necesidades</a></div>`}`;
}

function lineView(line, edit, busy) {
  const product = line.product_id ? (productById(line.product_id) ?? line) : null;
  const name = line.name ?? line.text;
  const planned = edit?.field === 'qty_planned' ? edit.qty : line.qty_planned;
  const loaded = edit?.field === 'qty_loaded' ? edit.qty : line.qty_loaded ?? planned;
  const qty = line.checked ? loaded : planned;
  return html`<li class="trip-line ${line.checked ? 'on' : ''} ${product ? '' : 'note'}"><div class="trip-main">
    ${product ? thumb(product, 'trip-img') : html`<span class="trip-note-ico">${raw(icon('pencil', { size: 22 }))}</span>`}<div class="trip-name"><b>${name}</b>
      ${product ? html`<span class="trip-requested alm-qty" title="${planned} botellas en total">${qtyHtml(planned, line.per_case)}</span>
        ${line.out_stock !== null && line.out_stock !== undefined ? html`<small>${line.out_stock > 0 ? `En Out Vessel: ${stockText(line.out_stock, line.per_case)}` : 'No queda en Out Vessel'}</small>` : html`<small>Out Vessel: sin contar</small>`}` : ''}
      ${line.to_store_name ? html`<small>→ ${line.to_store_name}</small>` : ''}</div><button type="button" class="icon-btn trip-rm" data-rm data-line="${line.id}" aria-label="Quitar ${name} del pedido" ${busy ? raw('disabled') : ''}>${raw(icon('trash', { size: 20 }))}</button></div>
    <div class="trip-ctrl"><button type="button" class="trip-check ${line.checked ? 'on' : ''}" data-check data-line="${line.id}" aria-pressed="${String(!!line.checked)}" aria-label="Cargado: ${name}" ${busy ? raw('disabled') : ''}><span class="trip-box">${raw(icon('check', { size: 22 }))}</span> Cargado</button>
      ${product ? html`<div class="trip-amount"><small>${line.checked ? 'Cargado:' : 'Cantidad pedida:'}</small><div class="trip-qty"><button type="button" class="step" data-step="-1" data-line="${line.id}" aria-label="Menos ${name}" ${qty <= 1 || busy ? raw('disabled') : ''}>${raw(icon('minus', { size: 22 }))}</button>
        <button type="button" class="trip-qty-val alm-qty" data-edit data-line="${line.id}" aria-label="${line.checked ? 'Cargado' : 'Pedido'}: ${stockText(qty, line.per_case)} (${qty} botellas en total). Cambiar" ${busy ? raw('disabled') : ''}><span class="trip-qty-text">${qtyHtml(qty, line.per_case)}</span></button>
        <button type="button" class="step" data-step="1" data-line="${line.id}" aria-label="Más ${name}" ${qty >= 10000 || busy ? raw('disabled') : ''}>${raw(icon('plus', { size: 22 }))}</button></div></div>` : ''}</div></li>`;
}
