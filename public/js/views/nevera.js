// Chupitería: la nevera de la barra vista desde arriba (imágenes renderizadas una vez en
// scripts/nevera/). Cada hueco (una columna de botellas o un compartimento de chapas) es un
// botón con data-add: tocarlo suma una unidad igual que la tarjeta, y «−» quita una.
// La nevera se construye una sola vez por pantalla; después solo se actualiza su estado,
// para que el sondeo de cada pocos segundos no vuelva a cargar las imágenes.
import { state, cart, pendingFor, isOut, qtyText } from '../state.js';
import { html, raw, mount } from '../ui.js';
import { icon } from '../icons.js';

const BASE = '/img/nevera/';
const LAYOUT = `${BASE}nevera.v2.json`;
let layout = null;
let loading = null;

/** Carga el plano una vez; `onReady` se llama cuando llega (si falla, la sección sigue con la cuadrícula). */
export function loadNevera(onReady) {
  if (layout) return;
  loading ??= fetch(LAYOUT).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  loading.then((data) => {
    if (data && !layout) {
      layout = data;
      onReady?.();
    }
  });
}

const rel = (piece, g) => ({
  left: ((piece.x - g.x) / g.w) * 100,
  top: ((piece.y - g.y) / g.h) * 100,
  width: (piece.w / g.w) * 100,
  height: (piece.h / g.h) * 100,
});
const box = ({ left, top, width, height }) => `left:${left}%;top:${top}%;width:${width}%;height:${height}%`;
const unitWord = (g) => (g.tipo === 'chapas' ? 'un botellín' : 'una botella');

function groupHtml(g, p) {
  return html`
    <div class="nev-g nev-${g.tipo}" data-nev="${p.id}" style="${box({ left: g.x, top: g.y, width: g.w, height: g.h })}">
      ${g.piezas.map((pz) => html`<span class="nev-p wait${g.tipo === 'chapas' ? ' round' : ''}" style="${box(rel(pz, g))}">
        <img class="nev-img" src="${BASE + pz.img}" alt="" decoding="async" draggable="false">
        <img class="nev-sel" src="${BASE + pz.sel}" alt="" decoding="async" draggable="false">
      </span>`)}
      <button type="button" class="nev-hit" data-add="${p.id}"></button>
      <span class="nev-ctl"></span>
      <span class="nev-flag" aria-hidden="true"></span>
    </div>`;
}

/**
 * Dibuja (la primera vez) o actualiza la nevera con los productos de la sección.
 * Devuelve los id que salen en la nevera, para quitarlos de la cuadrícula de debajo.
 */
export function drawNevera(el, products, { visible }) {
  const ids = new Set();
  if (!el) return ids;
  if (!layout || !visible) {
    el.hidden = true;
    return ids;
  }
  const bySlug = new Map(products.map((p) => [p.slug, p]));
  const groups = layout.grupos.map((g) => ({ g, p: bySlug.get(g.slug) })).filter((x) => x.p);
  if (!groups.length) {
    el.hidden = true;
    return ids;
  }
  for (const { p } of groups) ids.add(p.id);

  const key = groups.map(({ p }) => p.id).join(',');
  if (el.dataset.key !== key) {
    mount(el, html`
      <div class="nevera" role="group" aria-label="Nevera de chupitería">
        <div class="nev-tray" style="aspect-ratio:${layout.fondo.w} / ${layout.fondo.h}">
          <img class="nev-bg" src="${BASE + layout.fondo.img}" alt="" decoding="async" draggable="false">
          ${groups.map(({ g, p }) => groupHtml(g, p))}
        </div>
      </div>`);
    // Mientras carga cada imagen, su hueco se ve como un bloque de color y ya se puede tocar.
    for (const img of el.querySelectorAll('.nev-img')) {
      const done = () => img.parentElement.classList.remove('wait');
      if (img.complete && img.naturalWidth) done();
      else img.addEventListener('load', done, { once: true });
    }
    el.dataset.key = key;
  }
  el.hidden = false;
  for (const { g, p } of groups) updateGroup(el, g, p);
  return ids;
}

/** Actualiza un producto de la nevera (tras sumar o quitar) sin tocar las imágenes. */
export function patchNevera(el, pid) {
  if (!el || el.hidden || !layout) return false;
  const node = el.querySelector(`[data-nev="${pid}"]`);
  if (!node) return false;
  const p = state.products.find((x) => x.id === pid);
  const g = layout.grupos.find((x) => x.slug === p?.slug);
  if (!p || !g) return false;
  updateGroup(el, g, p);
  return true;
}

function updateGroup(el, g, p) {
  const node = el.querySelector(`[data-nev="${p.id}"]`);
  if (!node) return;
  const n = state.bar ? cart()[p.id] || 0 : 0;
  const pend = state.bar ? pendingFor(p.id, state.bar) : 0;
  const out = isOut(p);
  node.classList.toggle('on', n > 0);
  node.classList.toggle('out', out);
  node.querySelectorAll('.nev-p').forEach((piece, i) => piece.classList.toggle('sel', i < n));

  const hit = node.querySelector('.nev-hit');
  const parts = [p.name, n ? `${qtyText(n, p)} en el pedido` : `toca para pedir ${unitWord(g)}`];
  if (pend) parts.push(`${qtyText(pend, p)} pendientes`);
  if (out) parts.push('agotado en almacén');
  hit.setAttribute('aria-label', parts.join(', '));

  const ctl = node.querySelector('.nev-ctl');
  const shown = ctl.dataset.n;
  if (shown !== String(n)) {
    mount(ctl, n ? html`
      <span class="count" aria-hidden="true">${n}</span>
      <button type="button" class="card-minus nev-minus" data-minus="${p.id}" aria-label="Quitar ${unitWord(g)} de ${p.name}">${raw(icon('minus', { size: 18 }))}</button>` : '');
    ctl.dataset.n = String(n);
  }

  const flag = node.querySelector('.nev-flag');
  const text = out ? 'Agotado' : pend ? `${pend} pend.` : '';
  if (flag.textContent !== text) flag.textContent = text;
  flag.className = `nev-flag${out ? ' danger' : pend ? ' info' : ''}`;
}
