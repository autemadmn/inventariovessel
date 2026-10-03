import { get, post, postStock, put } from '../api.js';
import { state, loadLive } from '../state.js';
import { html, raw, mount, thumb, toast, buzz, fmt, plural, formDialog } from '../ui.js';
import { icon } from '../icons.js';
import { askQty, onStockChange } from './almacen.js';
import { renderViaje } from './viaje.js';

export function viajesHeader(active) {
  const count = state.live.trip?.lines ?? 0;
  return html`<header class="viajes-head"><h1 class="alm-title">Viajes</h1>
    <nav class="seg viajes-tabs" aria-label="Viajes">
      <a href="#/viajes/necesidades" class="${active === 'necesidades' ? 'on' : ''}" ${active === 'necesidades' ? raw('aria-current="page"') : ''}>Necesidades</a>
      <a href="#/viajes/pedido" class="${active === 'pedido' ? 'on' : ''}" ${active === 'pedido' ? raw('aria-current="page"') : ''}>Pedido ${count > 0 ? html`<small>${fmt(count)}</small>` : ''}</a>
    </nav></header>`;
}

export function renderViajes(root, rest = []) {
  if (!rest[0]) {
    history.replaceState(null, '', '#/viajes/necesidades');
    rest = ['necesidades'];
  }
  if (rest[0] === 'pedido') return renderViaje(root);
  if (rest[0] === 'agotados') return renderNecesidades(root, true);
  if (rest[0] === 'necesidades') return renderNecesidades(root);
  mount(root, html`<section class="alm viajes">${viajesHeader('')}<p class="empty">Pantalla no encontrada</p></section>`);
}

export function needUnit(line) {
  return line.unit === 'cajas' ? (line.qty === 1 ? 'caja' : 'cajas') : (line.qty === 1 ? 'botella' : 'botellas');
}

const maxNeed = (line) => Math.floor(10000 / (line.per_case ?? 1));
const bottlesOf = (line) => line.manual ? line.qty * (line.per_case ?? 1)
  : Math.min(line.qty * (line.per_case ?? 1), line.recommended_bottles ?? 0);

/** Control compartido con la ficha. La cantidad siempre está en la unidad de NeedLine. */
export function needControl(line) {
  return html`<div class="need-control"><div class="need-stepper">
    <button type="button" data-need-step="-1" data-product="${line.product_id}" aria-label="Una ${line.unit === 'cajas' ? 'caja' : 'botella'} menos de ${line.name}" ${line.qty <= 0 ? raw('disabled') : ''}>${raw(icon('minus', { size: 18 }))}</button>
    <button type="button" class="need-value ${line.qty >= 1000 ? 'long' : ''}" data-need-edit data-product="${line.product_id}" aria-label="Próximo viaje: ${plural(line.qty, line.unit === 'cajas' ? 'caja' : 'botella', line.unit)}${line.adjusted ? ` (recomendado ${line.recommended ?? '—'})` : ''}. Cambiar">${fmt(line.qty)}</button>
    <button type="button" data-need-step="1" data-product="${line.product_id}" aria-label="Una ${line.unit === 'cajas' ? 'caja' : 'botella'} más de ${line.name}" ${line.qty >= maxNeed(line) ? raw('disabled') : ''}>${raw(icon('plus', { size: 18 }))}</button>
    </div><span class="need-unit">${needUnit(line)}</span></div>`;
}

export function needHint(line) {
  return html`${line.recommended === null ? html`<small class="need-hint">Sin datos para recomendar</small>` : ''}
    ${line.adjusted ? html`<small class="need-hint adjusted">recomendado ${line.recommended === null ? '—' : fmt(line.recommended)}</small>` : ''}
    ${line.per_case && bottlesOf(line) !== line.qty * line.per_case ? html`<small class="need-hint">Se pedirán ${plural(Math.floor(bottlesOf(line) / line.per_case), 'caja', 'cajas')} + ${fmt(bottlesOf(line) % line.per_case)} sueltas (${fmt(bottlesOf(line))} botellas), por el stock de Out.</small>` : ''}`;
}

export const noCaseWarning = () => html`<span class="need-warning">${raw(icon('alert', { size: 16 }))} Sin botellas por caja: va en botellas.</span>`;

/** Serializa los envíos de cada producto; una respuesta antigua nunca pisa un toque nuevo. */
export function createNeedEditor({ lineOf, draw, saved, conflict }) {
  const edits = new Map();
  const timers = new Map();
  const flights = new Map();
  const flush = (id) => {
    clearTimeout(timers.get(id));
    timers.delete(id);
    if (flights.has(id)) return flights.get(id);
    const task = (async () => {
      while (edits.has(id)) {
        const edit = edits.get(id);
        try {
          const res = await put(`/api/viajes/necesidades/${id}`, { ...edit, by: state.who });
          if (edits.get(id) === edit) edits.delete(id);
          saved(res.line, edits.get(id)?.qty);
        } catch (err) {
          toast(err.message, err.status === 409 ? 'info' : 'error');
          if (err.status === 409) { edits.delete(id); conflict(); }
          return false;
        }
      }
      loadLive().catch(() => {});
      return true;
    })().finally(() => { flights.delete(id); if (!edits.size) conflict(); });
    flights.set(id, task);
    return task;
  };
  const set = (line, qty) => {
    line.qty = Math.max(0, Math.min(maxNeed(line), qty));
    line.manual = true;
    line.bottles = bottlesOf(line);
    line.adjusted = line.qty !== (line.recommended ?? 0);
    edits.set(line.product_id, { qty: line.qty, unit: line.unit, per_case: line.per_case });
    draw();
    clearTimeout(timers.get(line.product_id));
    timers.set(line.product_id, setTimeout(() => flush(line.product_id), 700));
  };
  return {
    get pending() { return edits.size > 0 || flights.size > 0; },
    async handle(button) {
      const line = lineOf(Number(button.dataset.product));
      if (!line) return;
      if (button.dataset.needStep !== undefined) {
        set(line, line.qty + Number(button.dataset.needStep)); buzz(8);
      } else if (button.dataset.needEdit !== undefined) {
        const qty = await askQty({ title: `Próximo viaje · ${line.name}`, initial: line.qty, min: 0, max: maxNeed(line),
          unit: line.unit === 'cajas' ? 'Cajas' : 'Botellas' });
        if (qty !== null) { set(line, qty); await flush(line.product_id); }
      }
    },
    async flushAll() {
      const ids = new Set([...edits.keys(), ...flights.keys()]);
      return (await Promise.all([...ids].map(flush))).every(Boolean);
    },
    cleanup() { for (const timer of timers.values()) clearTimeout(timer); return this.flushAll(); },
  };
}

function renderNecesidades(root, all = false) {
  mount(root, html`<section class="alm viajes" id="viajes">${viajesHeader('necesidades')}<p class="empty">Cargando…</p></section>`);
  const el = root.querySelector('#viajes');
  let data = null; let request = 0; let busy = false;
  const draw = () => {
    if (!el.isConnected || !data) return;
    const focused = document.activeElement;
    const product = el.contains(focused) ? focused.dataset.product : null;
    const step = focused?.dataset.needStep;
    const edit = focused?.dataset.needEdit;
    mount(el, html`${viajesHeader('necesidades')}${all ? agotadosView(data) : needsView(data, busy)}`);
    if (product && (step !== undefined || edit !== undefined)) {
      el.querySelector(`[data-product="${product}"][${step !== undefined ? `data-need-step="${step}"` : 'data-need-edit'}]`)?.focus({ preventScroll: true });
    }
  };
  const refresh = async () => {
    const seq = ++request;
    try {
      const res = await get('/api/viajes/necesidades');
      if (seq !== request || !el.isConnected || editor.pending || busy) return;
      data = res; draw();
    } catch (err) {
      if (seq !== request || !el.isConnected) return;
      if (data) toast(err.message, 'error');
      else mount(el, html`${viajesHeader('necesidades')}<p class="empty">${err.message}</p><button type="button" class="btn ghost" data-retry>Reintentar</button>`);
    }
  };
  const editor = createNeedEditor({
    lineOf: (id) => data?.lines.find((l) => l.product_id === id), draw,
    saved: (line, pending) => {
      const i = data.lines.findIndex((l) => l.product_id === line.product_id);
      if (i >= 0) data.lines[i] = pending === undefined ? line : { ...line, qty: pending, adjusted: pending !== (line.recommended ?? 0) };
      draw();
    }, conflict: refresh,
  });
  const highlight = (id) => {
    const row = el.querySelector(`[data-need-line="${id}"]`);
    row?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'center' });
    row?.classList.add('highlight');
    setTimeout(() => row?.classList.remove('highlight'), 1800);
  };
  el.addEventListener('click', async (event) => {
    const button = event.target.closest('button');
    if (!button || busy) return;
    const d = button.dataset;
    let locked = false;
    try {
      if (d.retry !== undefined) { await refresh(); return; }
      if (!data) return;
      if (d.needStep !== undefined || d.needEdit !== undefined) {
        await editor.handle(button);
      } else if (d.include !== undefined) {
        const id = Number(d.include);
        const item = data.agotados.find((p) => p.product_id === id);
        if (item.in_pedido) { toast('Ya está en el pedido', 'info'); return; }
        if (item.in_ticket) {
          if (all) location.hash = '#/viajes/necesidades'; else highlight(id);
          return;
        }
        button.disabled = true;
        if (!await editor.flushAll()) return;
        await post(`/api/viajes/necesidades/${id}/incluir`, { by: state.who });
        toast('Añadido a Necesidades'); buzz(20);
        await refresh(); loadLive().catch(() => {});
        if (!all) highlight(id);
      } else if (d.needCase !== undefined) {
        if (!await editor.flushAll()) return;
        const line = data.lines.find((l) => l.product_id === Number(d.needCase));
        const values = await formDialog('Botellas por caja', html`<p>${line.name}</p><label class="field"><span>Cuántas botellas lleva una caja</span><input name="per_case" type="number" min="1" max="10000" step="1" inputmode="numeric" required autofocus></label>`, { ok: 'Guardar' });
        if (!values) return;
        await put(`/api/almacen/botella/${line.product_id}/caja`, { per_case: Number(values.per_case), by: state.who, store_id: line.main_store_id });
        await refresh(); loadLive().catch(() => {});
      } else if (d.order !== undefined) {
        locked = true; busy = true; draw();
        if (!await editor.flushAll()) return;
        const res = await postStock('/api/viajes/necesidades/pedido', { by: state.who });
        data = res.necesidades;
        toast(res.added ? `Añadido al pedido: ${plural(res.added, 'producto', 'productos')}` : 'Ya estaba todo en el pedido', res.added ? 'ok' : 'info');
        buzz(20); await loadLive().catch(() => {});
      }
    } catch (err) {
      toast(err.message, err.status === 409 ? 'info' : 'error');
      if (err.status === 409) await refresh();
    } finally {
      if (locked) busy = false;
      draw();
      if (locked) refresh();
    }
  });
  const unsub = onStockChange(refresh);
  const online = async () => { if (await editor.flushAll()) refresh(); };
  window.addEventListener('online', online);
  refresh();
  return () => { unsub(); request++; window.removeEventListener('online', online); return editor.cleanup(); };
}

function needsView(data, busy) {
  const lines = data.lines;
  const positive = lines.filter((l) => l.qty > 0);
  const cajas = positive.reduce((n, l) => n + (l.per_case ? Math.floor(bottlesOf(l) / l.per_case) : 0), 0);
  const botellas = positive.reduce((n, l) => n + (l.per_case ? bottlesOf(l) % l.per_case : bottlesOf(l)), 0);
  return html`<section class="agotados"><div class="agotados-head"><h2>Agotados</h2>${data.agotados.length ? html`<a href="#/viajes/agotados">Ver todos ${raw(icon('right', { size: 16 }))}</a>` : ''}</div>
    ${data.agotados.length ? html`<div class="agotados-strip">${data.agotados.slice(0, 12).map((p) => html`<button type="button" class="agotado-card" data-include="${p.product_id}" aria-label="${p.name}, sin stock. ${p.in_pedido ? 'En el pedido' : p.in_ticket ? 'Ver en el ticket' : 'Añadir a Necesidades'}">${thumb(p, 'agotado-img')}<span class="agotado-label">Sin stock</span><b>${p.name}</b>${p.in_pedido || p.in_ticket ? html`<small>${p.in_pedido ? 'En el pedido' : 'En el ticket'}</small>` : ''}</button>`)}</div>` : html`<p class="muted">No hay nada agotado</p>`}</section>
    <div class="ticket-wrap"><section class="ticket" aria-labelledby="ticket-title"><header class="ticket-head"><h2 id="ticket-title">Necesidades</h2><p>Estimación según consumo y stock actual</p></header>
      <div class="ticket-rule" aria-hidden="true"></div>
      ${lines.length ? html`<ul class="need-lines">${lines.map(needLine)}</ul>` : html`<div class="ticket-empty"><p>Nada que pedir según el consumo y el stock actuales.</p>${!data.has_consumption ? html`<p>Aún no hay dos semanas con reposiciones: no se puede estimar el consumo.</p>` : ''}</div>`}
      ${lines.length ? html`<div class="ticket-rule" aria-hidden="true"></div><footer class="ticket-foot"><p aria-live="polite">${plural(positive.length, 'producto', 'productos')} · ${plural(cajas, 'caja', 'cajas')}${botellas ? ` · ${plural(botellas, 'botella', 'botellas')}` : ''}</p>
        <button type="button" class="btn primary big" data-order ${!positive.length || busy ? raw('disabled') : ''}>${raw(icon('truck', { size: 20 }))} ${busy ? 'Añadiendo…' : 'Añadir al pedido'}</button></footer>` : ''}</section></div>`;
}

function needLine(line) {
  const status = { sin_stock: 'Sin stock', queda_poco: 'Queda poco' }[line.state];
  const rotation = { alta: 'Alta rotación', media: 'Rotación media', baja: 'Baja rotación' }[line.rotation];
  return html`<li class="need-line" data-need-line="${line.product_id}">${thumb(line, 'need-img')}<div class="need-name"><b>${line.name}</b>
    ${status ? html`<small class="need-state">${status}</small>` : ''}${rotation ? html`<small>${rotation}</small>` : ''}${needHint(line)}</div>${needControl(line)}
    ${line.unit === 'botellas' ? html`<div class="need-case">${noCaseWarning()}<button type="button" class="link" data-need-case="${line.product_id}">Indicar botellas por caja</button></div>` : ''}</li>`;
}

function agotadosView(data) {
  return html`<a class="inf-back" href="#/viajes/necesidades">${raw(icon('left', { size: 18 }))} Viajes</a><h2 class="alm-title">Agotados (${fmt(data.agotados.length)})</h2>
    ${data.agotados.length ? html`<ul class="agotados-list">${data.agotados.map((p) => html`<li>${thumb(p, 'mini')}<div class="agotado-name"><b>${p.name}</b><small>${p.reason === 'agotado_almacen' ? 'Agotado en almacén (marcado en Reponer)' : `Sin stock en ${p.main_store_name}`}</small></div>
      ${p.in_pedido || p.in_ticket ? html`<span class="agotado-status">${p.in_pedido ? 'En el pedido' : 'En el ticket'}</span>` : html`<button type="button" class="btn ghost" data-include="${p.product_id}" aria-label="Añadir ${p.name} a Necesidades">Añadir a Necesidades</button>`}</li>`)}</ul>` : html`<p class="empty">No hay nada agotado</p>`}`;
}
