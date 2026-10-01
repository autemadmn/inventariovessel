// Próximo viaje: lo que se trae en coche del almacén grande al del local.
// Se apunta desde Almacén o Reponer, se marca «Cargado» mientras se llena el
// coche y «Viaje hecho» lo suma al almacén del local. Todos los móviles ven lo
// mismo: cada cambio sube la revisión del almacén en /api/live.
import { get, post, put } from '../api.js';
import { state, productById, loadLive, stockText } from '../state.js';
import {
  raw, $, html, mount, thumb, toast, buzz, fmt, plural, bottles, dialog, confirmDialog,
} from '../ui.js';
import { icon } from '../icons.js';
import { back, qtyHtml, askQty, onStockChange } from './almacen.js';

/**
 * Apunta una botella en el viaje abierto (el servidor lo crea si no hay).
 * Sin `qty`, el servidor pone lo sugerido o una caja.
 */
export async function apuntar(productId, qty = null) {
  const res = await post('/api/almacen/viaje/lineas', {
    product_id: productId, ...(qty ? { qty_planned: qty } : {}), by: state.who,
  });
  buzz(20);
  toast(res.already ? 'Ya estaba en el viaje' : 'Apuntado para el viaje', res.already ? 'info' : 'ok');
  loadLive().catch(() => {});
  return res;
}

/** −/+ saltan a la caja entera anterior o siguiente (de una en una si no hay cajas). */
function stepQty(q, perCase, dir) {
  const step = perCase > 0 ? perCase : 1;
  const rest = q % step;
  if (dir > 0) return Math.min(10000, q + step - rest);
  return Math.max(1, rest ? q - rest : q - step);
}

export function renderViaje(root) {
  mount(root, html`<section class="alm trip" id="trip">${back()}<p class="empty">Cargando…</p></section>`);
  const el = $('#trip', root);
  let v = null;
  let requestId = 0;
  let busy = false;
  // Cantidades cambiadas con −/+ que aún no se han enviado: { lineId: botellas }.
  const edits = new Map();
  const timers = new Map();

  const draw = () => { if (v && el.isConnected) mount(el, tripView(v, edits)); };
  const apply = (res) => { v = res; draw(); };

  const refresh = async () => {
    const id = ++requestId;
    try {
      const res = await get('/api/almacen/viaje');
      if (id !== requestId || !el.isConnected || edits.size) return;
      apply(res);
    } catch (err) {
      if (id !== requestId || !el.isConnected) return;
      if (v) toast(err.message, 'error');
      else mount(el, html`${back()}<p class="empty">${err.message}</p>`);
    }
  };

  const fail = (err) => {
    // 409: otro móvil ha terminado el viaje o ha quitado la línea. No es un fallo de quien toca.
    toast(err.message, err.status === 409 ? 'info' : 'error');
    edits.clear();
    refresh();
  };

  const flush = async (id) => {
    clearTimeout(timers.get(id));
    timers.delete(id);
    if (!edits.has(id)) return true;
    const qty = edits.get(id);
    try {
      const res = await put(`/api/almacen/viaje/lineas/${id}`, { qty_planned: qty, by: state.who });
      if (edits.get(id) === qty) edits.delete(id);
      if (!edits.size) apply(res);
      return true;
    } catch (err) {
      fail(err);
      return false;
    }
  };
  const flushAll = async () => (await Promise.all([...edits.keys()].map(flush))).every(Boolean);

  const lineOf = (id) => v?.lines.find((l) => l.id === id);

  /** Pone la cantidad en pantalla ya y la envía al dejar de tocar. */
  const setQty = (l, qty) => {
    edits.set(l.id, qty);
    const box = el.querySelector(`[data-qty-of="${l.id}"]`);
    if (box) {
      mount(box, qtyHtml(qty, l.per_case));
      box.setAttribute('aria-label', `Cantidad: ${l.product_id ? stockText(qty, l.per_case) : bottles(qty)}. Cambiar`);
    }
    clearTimeout(timers.get(l.id));
    timers.set(l.id, setTimeout(() => flush(l.id), 700));
  };

  el.addEventListener('click', async (e) => {
    const t = e.target.closest('button');
    if (!t || !v || busy) return;
    const d = t.dataset;
    const l = d.line ? lineOf(Number(d.line)) : null;
    // «Añadir lo sugerido» y «Viaje hecho» no se lanzan dos veces seguidas.
    const locks = d.suggest !== undefined || d.done !== undefined;
    if (locks) busy = true;
    try {
      if (d.step && l) {
        setQty(l, stepQty(edits.get(l.id) ?? l.qty_planned ?? 0, l.per_case, Number(d.step)));
        buzz(8);
      } else if (d.edit !== undefined && l) {
        const qty = await askQty({
          title: 'Cantidad',
          product: l.product_id ? (productById(l.product_id) ?? { ...l, per_case: l.per_case }) : null,
          initial: edits.get(l.id) ?? l.qty_planned ?? 0,
          ok: 'Guardar',
          min: 1,
        });
        if (qty === null) return;
        setQty(l, qty);
        await flush(l.id);
      } else if (d.check !== undefined && l) {
        const checked = l.checked ? 0 : 1;
        const pending = edits.get(l.id);
        clearTimeout(timers.get(l.id));
        timers.delete(l.id);
        edits.delete(l.id);
        // Al momento en pantalla; la respuesta del servidor manda.
        l.checked = checked;
        if (pending !== undefined) l.qty_planned = pending;
        v.checked += checked ? 1 : -1;
        draw();
        buzz(checked ? 20 : 8);
        apply(await put(`/api/almacen/viaje/lineas/${l.id}`, {
          checked, ...(pending !== undefined ? { qty_planned: pending } : {}), by: state.who,
        }));
        loadLive().catch(() => {});
      } else if (d.rm !== undefined && l) {
        const name = l.name ?? l.text;
        if (!await confirmDialog('Quitar del viaje', `${name} deja de estar en el viaje.`, { ok: 'Quitar', kind: 'danger' })) return;
        edits.delete(l.id);
        apply(await post(`/api/almacen/viaje/lineas/${l.id}/quitar`, { by: state.who }));
        toast('Quitado del viaje');
        loadLive().catch(() => {});
      } else if (d.suggest !== undefined) {
        if (!await flushAll()) return;
        const res = await post('/api/almacen/viaje/sugerido', { by: state.who });
        apply(res);
        buzz(20);
        toast(res.added
          ? `${res.added === 1 ? 'Añadida' : 'Añadidas'} ${plural(res.added, 'línea', 'líneas')}`
          : 'No hay nada más que sugerir', res.added ? 'ok' : 'info');
        loadLive().catch(() => {});
      } else if (d.note !== undefined) {
        const text = await askNote();
        if (!text) return;
        apply(await post('/api/almacen/viaje/lineas', { text, by: state.who }));
        buzz(20);
        toast('Nota apuntada');
        loadLive().catch(() => {});
      } else if (d.done !== undefined) {
        if (!await flushAll()) return;
        await finishTrip(v, apply);
      }
    } catch (err) {
      fail(err);
    } finally {
      if (locks) busy = false;
    }
  });

  const unsub = onStockChange(refresh);
  refresh();
  return () => {
    unsub();
    flushAll();
  };
}

async function askNote() {
  const data = await dialog({
    title: 'Apuntar una nota',
    body: html`
      <label class="field"><span>Qué hay que traer</span>
        <input name="text" maxlength="80" required autofocus autocomplete="off" enterkeyhint="done" placeholder="Por ejemplo, tónica"></label>`,
    actions: [{ label: 'Cancelar', value: '' }, { label: 'Apuntar', submit: true, kind: 'primary' }],
  });
  return data && typeof data === 'object' ? String(data.text || '').trim().slice(0, 80) : '';
}

async function finishTrip(v, apply) {
  const lines = v.lines;
  const loaded = lines.filter((l) => l.checked);
  if (!loaded.length) return;
  const n = loaded.reduce((a, l) => a + (l.product_id ? (l.qty_loaded ?? l.qty_planned ?? 0) : 0), 0);
  const carry = lines.length - loaded.length;
  const text = [
    n ? `Llegan ${bottles(n)} a ${v.to?.name ?? 'el almacén'}.` : '',
    carry ? `${carry === 1 ? 'La línea sin cargar pasa' : `Las ${fmt(carry)} líneas sin cargar pasan`} al próximo viaje.` : '',
  ].filter(Boolean).join(' ');
  if (!await confirmDialog('¿Viaje hecho?', text || 'Se cierra el viaje.', { ok: 'Viaje hecho' })) return;
  const res = await post('/api/almacen/viaje/hecho', { trip_id: v.trip.id, by: state.who });
  buzz(30);
  toast(res.carried ? `Viaje hecho. ${plural(res.carried, 'línea pasa', 'líneas pasan')} al próximo.` : 'Viaje hecho');
  await loadLive().catch(() => {});
  if (!res.next_trip_id) {
    location.hash = '#/almacen';
    return;
  }
  apply(await get('/api/almacen/viaje'));
}

// ------------------------------------------------------------------ vista

function tripView(v, edits) {
  const lines = v.lines;
  const checked = lines.filter((l) => l.checked).length;
  const pct = lines.length ? Math.round((checked / lines.length) * 100) : 0;
  return html`
    ${back()}
    <header class="trip-head">
      <h1 class="alm-title">Próximo viaje</h1>
      ${v.from && v.to ? html`<p class="trip-route">${v.from.name} ${raw(icon('right', { size: 16 }))} ${v.to.name}</p>` : ''}
    </header>

    ${lines.length ? html`
      <div class="trip-progress">
        <p><b>${fmt(checked)} de ${fmt(lines.length)}</b> cargadas</p>
        <div class="cnt-bar" role="progressbar" aria-label="Cargado" aria-valuemin="0"
          aria-valuemax="${lines.length}" aria-valuenow="${checked}"><i style="width:${pct}%"></i></div>
      </div>` : ''}

    <div class="trip-tools">
      <button type="button" class="btn ghost" data-suggest>${raw(icon('list', { size: 20 }))} Añadir lo sugerido</button>
      <button type="button" class="btn ghost" data-note>${raw(icon('pencil', { size: 20 }))} Apuntar una nota</button>
    </div>

    ${lines.length
    ? html`<ul class="trip-list">${lines.map((l) => lineView(l, v.from, edits.get(l.id)))}</ul>`
    : html`
      <div class="trip-empty">
        ${raw(icon('truck', { size: 40 }))}
        <p><b>Nada apuntado</b></p>
        <p class="muted">Apunta botellas desde Almacén o Reponer, o añade lo sugerido.</p>
      </div>`}

    ${lines.length ? html`
      <div class="trip-foot">
        <button type="button" class="btn primary big" data-done ${checked ? '' : raw('disabled')}>
          ${raw(icon('check', { size: 20 }))} Viaje hecho</button>
        ${!checked ? html`<p class="trip-foot-hint">Marca lo que va en el coche.</p>` : ''}
      </div>` : ''}`;
}

function lineView(l, from, edited) {
  const p = l.product_id ? (productById(l.product_id) ?? l) : null;
  const name = l.name ?? l.text;
  const qty = edited ?? l.qty_planned;
  const hasQty = qty !== null && qty !== undefined;
  let where = '';
  if (p && l.out_stock !== null && l.out_stock !== undefined && from) {
    where = l.out_stock > 0
      ? html`<span>En ${from.name}: ${stockText(l.out_stock, l.per_case)}</span>`
      : html`<span class="trip-none">No queda en ${from.name}</span>`;
  }
  const meta = [l.source === 'sugerido' ? 'Sugerido' : l.created_by].filter(Boolean);
  return html`
    <li class="trip-line ${l.checked ? 'on' : ''} ${p ? '' : 'note'}">
      <div class="trip-main">
        ${p ? thumb(p, 'trip-img') : html`<span class="trip-note-ico">${raw(icon('pencil', { size: 22 }))}</span>`}
        <div class="trip-name">
          <b>${name}</b>
          ${meta.length || where ? html`<small>${meta.join(' · ')}${meta.length && where ? ' · ' : ''}${where}</small>` : ''}
        </div>
        <button type="button" class="icon-btn trip-rm" data-rm data-line="${l.id}" aria-label="Quitar ${name} del viaje">${raw(icon('trash', { size: 20 }))}</button>
      </div>
      <div class="trip-ctrl">
        ${hasQty ? html`
          <div class="trip-qty">
            <button type="button" class="step" data-step="-1" data-line="${l.id}" aria-label="Menos">${raw(icon('minus', { size: 22 }))}</button>
            <button type="button" class="trip-qty-val alm-qty" data-edit data-line="${l.id}" data-qty-of="${l.id}"
              aria-label="Cantidad: ${p ? stockText(qty, l.per_case) : bottles(qty)}. Cambiar">${qtyHtml(qty, l.per_case)}</button>
            <button type="button" class="step" data-step="1" data-line="${l.id}" aria-label="Más">${raw(icon('plus', { size: 22 }))}</button>
          </div>` : html`<span class="trip-noqty">Nota</span>`}
        <button type="button" class="trip-check ${l.checked ? 'on' : ''}" data-check data-line="${l.id}" aria-pressed="${String(!!l.checked)}">
          <span class="trip-box">${raw(icon('check', { size: 20 }))}</span> Cargado</button>
      </div>
    </li>`;
}
