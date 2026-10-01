// Historial y descuadres (encargado, con PIN): lo que faltaba o sobraba en cada
// recuento y todo lo que ha entrado, salido o se ha roto. Desde aquí se anula un
// movimiento erróneo con su motivo; nunca se borra nada.
import { auth, mget, mpost } from '../api.js';
import { state, loadLive, stockText } from '../state.js';
import { raw, $, html, mount, thumb, toast, buzz, fmt, dateTimeLabel, formDialog } from '../ui.js';
import { icon } from '../icons.js';
import { askPin } from './gestion.js';
import { back, qtyHtml, onStockChange } from './almacen.js';

const PERIODS = [['mes', 'Este mes'], ['mes_pasado', 'Mes pasado'], ['todo', 'Todo']];
let period = 'mes';

export function renderControl(root) {
  mount(root, html`<section class="alm ctl" id="ctl">${back()}<h1 class="alm-title">Historial y descuadres</h1></section>`);
  const el = $('#ctl', root);
  let d = null; // descuadres
  let h = null; // historial
  let requestId = 0;
  let asking = false;
  let unsub = null;
  let gone = false;

  /** Pide el PIN. Si se cancela, vuelve a Almacén. */
  const pin = async (message = '') => {
    if (asking) return false;
    asking = true;
    try {
      const ok = await askPin(message);
      if (!ok && !gone) location.hash = '#/almacen';
      return ok;
    } finally {
      asking = false;
    }
  };

  const draw = () => mount(el, view(d, h));

  const refresh = async () => {
    if (asking) return;
    const id = ++requestId;
    el.classList.add('is-loading');
    try {
      const [rd, rh] = await Promise.all([
        mget(`/api/almacen/descuadres?period=${period}`),
        mget(`/api/almacen/historial?period=${period}`),
      ]);
      if (id !== requestId || !el.isConnected) return;
      d = rd;
      h = rh;
      draw();
    } catch (err) {
      if (id !== requestId || !el.isConnected) return;
      if (err.status === 401 || err.status === 403) {
        if (await pin(err.message)) refresh();
      } else if (d) {
        toast(err.message, 'error');
      } else {
        mount(el, html`${back()}<h1 class="alm-title">Historial y descuadres</h1><p class="empty">${err.message}</p>`);
      }
    } finally {
      if (id === requestId) el.classList.remove('is-loading');
    }
  };

  el.addEventListener('click', async (e) => {
    const t = e.target.closest('button');
    if (!t || !el.contains(t)) return;
    if (t.dataset.period) {
      if (t.dataset.period === period) return;
      period = t.dataset.period;
      for (const b of el.querySelectorAll('[data-period]')) {
        const on = b.dataset.period === period;
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', String(on));
      }
      buzz(8);
      refresh();
    } else if (t.dataset.void) {
      const line = findLine(h, Number(t.dataset.void));
      if (!line) return;
      try {
        if (await voidMove(line, pin)) {
          buzz(20);
          toast('Movimiento anulado');
          await refresh();
          loadLive().catch(() => {});
        }
      } catch (err) {
        toast(err.message, 'error');
      }
    }
  });

  (async () => {
    if (state.managerRequired && !auth.pin && !await pin()) return;
    if (gone) return;
    mount(el, html`${back()}<h1 class="alm-title">Historial y descuadres</h1>${periodSeg()}<p class="empty">Cargando…</p>`);
    unsub = onStockChange(refresh);
    refresh();
  })();

  return () => { gone = true; unsub?.(); };
}

// ------------------------------------------------------------------ anular

function findLine(h, moveId) {
  for (const ev of h?.events ?? []) {
    const l = ev.lines.find((x) => x.move_id === moveId);
    if (l) return { ...l, type: ev.type };
  }
  return null;
}

/** Diálogo con motivo obligatorio. Devuelve true si se ha anulado. */
async function voidMove(line, pin) {
  const data = await formDialog('Anular movimiento', html`
    <div class="cnt-mini">${thumb(line, 'sm')}<span class="ctl-dlg-what"><b>${line.name}</b><small>${TITLE[line.type]} · ${stockText(line.qty, line.per_case)}</small></span></div>
    <label class="field"><span>Motivo</span>
      <input name="reason" maxlength="200" required autocomplete="off" enterkeyhint="done" autofocus></label>`,
  { ok: 'Anular', kind: 'danger' });
  if (!data) return false;
  const reason = String(data.reason || '').trim();
  if (!reason) {
    toast('Escribe el motivo.', 'error');
    return false;
  }
  const send = () => mpost(`/api/almacen/movimientos/${line.move_id}/anular`, { reason, ...(state.who ? { by: state.who } : {}) });
  try {
    await send();
  } catch (err) {
    if (err.status !== 401 && err.status !== 403) throw err;
    if (!await pin(err.message)) return false;
    await send();
  }
  return true;
}

// ------------------------------------------------------------------ vista

function periodSeg() {
  return html`
    <div class="seg inf-period" role="group" aria-label="Periodo">${PERIODS.map(([v, l]) => html`
      <button type="button" class="${period === v ? 'on' : ''}" data-period="${v}" aria-pressed="${String(period === v)}">${l}</button>`)}</div>`;
}

function view(d, h) {
  return html`
    ${back()}
    <h1 class="alm-title">Historial y descuadres</h1>
    ${periodSeg()}
    ${d.range ? html`<p class="ctl-range">${d.range.label}</p>` : ''}

    <div class="ctl-body">
      <h2 class="section-title">Descuadres</h2>
      <div class="ctl-totals">${d.totals.map((t) => html`
        <div class="ctl-total ${t.missing > 0 ? 'bad' : ''}">
          <span>${t.store_name}</span>
          ${t.missing > 0
    ? html`<p><small>Faltan</small> <b>${fmt(t.missing)}</b> <small>${t.missing === 1 ? 'botella' : 'botellas'}</small></p>`
    : html`<p class="ctl-ok">${raw(icon('check', { size: 20 }))} Sin faltas</p>`}
        </div>`)}</div>
      ${d.items.length
    ? html`<ul class="inf-list ctl-list">${d.items.map(diffRow)}</ul>`
    : html`<p class="ctl-empty">Sin descuadres en este periodo</p>`}

      <h2 class="section-title">Historial</h2>
      ${h.events.length
    ? html`<ol class="ctl-events">${h.events.map(eventView)}</ol>`
    : html`<p class="ctl-empty">Nada registrado en este periodo</p>`}
      ${h.truncated ? html`<p class="ctl-more">Se muestran los 200 más recientes</p>` : ''}
    </div>`;
}

function diffRow(x) {
  const missing = x.diff < 0;
  const n = Math.abs(x.diff);
  const word = missing ? 'faltan' : 'sobran';
  const meta = [x.store_name, dateTimeLabel(x.counted_at), x.counted_by].filter(Boolean).join(' · ');
  return html`
    <li>
      <div class="inf-row ctl-row ${missing ? 'bad' : 'extra'}">
        ${thumb(x, 'inf-img')}
        <span class="inf-name">
          <b>${x.name}</b>
          <small class="ctl-meta">${meta}</small>
        </span>
        <span class="alm-num ctl-diff">
          <small>${word}</small>
          <span class="alm-qty">${qtyHtml(n, x.per_case)}</span>
          ${x.per_case > 1 && n >= x.per_case ? html`<small class="ctl-bottles">${fmt(n)} botellas</small>` : ''}
        </span>
      </div>
    </li>`;
}

const TITLE = { viaje: 'Viaje hecho', entrada: 'Ha llegado mercancía', rotura: 'Rotura', recuento: 'Recuento' };
const ICON = { viaje: 'truck', entrada: 'package-plus', rotura: 'wine-off', recuento: 'clipboard-list' };

function eventView(ev) {
  let title = TITLE[ev.type];
  let where = ev.store_name;
  if (ev.type === 'viaje') where = [ev.from_store_name, ev.store_name].filter(Boolean).join(' → ');
  if (ev.type === 'recuento') {
    title = `Recuento · ${ev.store_name}`;
    where = '';
  }
  const sub = [where, ev.by, dateTimeLabel(ev.at)].filter(Boolean).join(' · ');
  return html`
    <li class="ctl-ev ${ev.type}">
      <header class="ctl-ev-head">
        <span class="alm-h-ico">${raw(icon(ICON[ev.type], { size: 18 }))}</span>
        <span class="bt-del-text"><b>${title}</b><small>${sub}</small>${ev.note ? html`<small class="ctl-note">«${ev.note}»</small>` : ''}</span>
      </header>
      <ul class="ctl-lines">${ev.lines.map((l) => (ev.type === 'recuento' ? countLine(l) : moveLine(l, ev.type)))}</ul>
    </li>`;
}

function moveLine(l, type) {
  const sign = type === 'rotura' ? '−' : '+';
  const voided = l.voided === 1 || l.voided === true;
  const why = voided ? ['Anulado', l.void_reason, l.voided_by, l.voided_at ? dateTimeLabel(l.voided_at) : ''].filter(Boolean).join(' · ') : '';
  return html`
    <li class="ctl-line ${voided ? 'void' : ''}">
      ${thumb(l, 'ctl-img')}
      <span class="ctl-line-text">
        <b>${l.name}</b>
        <span class="ctl-line-qty">${sign}${stockText(l.qty, l.per_case)}</span>
        ${voided ? html`<small class="ctl-void">${why}</small>` : ''}
      </span>
      ${voided ? '' : html`<button type="button" class="btn small ghost ctl-void-btn" data-void="${l.move_id}" aria-label="Anular ${l.name}, ${stockText(l.qty, l.per_case)}">Anular</button>`}
    </li>`;
}

function countLine(l) {
  const diff = l.diff ?? null;
  return html`
    <li class="ctl-line">
      ${thumb(l, 'ctl-img')}
      <span class="ctl-line-text">
        <b>${l.name}</b>
        <span class="ctl-line-qty">${l.qty > 0 ? stockText(l.qty, l.per_case) : 'Ninguna'}</span>
      </span>
      ${diff ? html`<span class="ctl-tag ${diff < 0 ? 'bad' : 'extra'}">${diff < 0 ? 'faltan' : 'sobran'} ${stockText(Math.abs(diff), l.per_case)}</span>` : ''}
    </li>`;
}
