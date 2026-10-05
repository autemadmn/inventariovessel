// Planos de Pedir: Chupitería desde arriba y Nevera frontal. Cada hueco usa
// data-add: tocarlo suma el paso del catálogo, y «−» lo resta.
// La nevera se construye una sola vez por pantalla; después solo se actualiza su estado,
// para que el sondeo de cada pocos segundos no vuelva a cargar las imágenes.
import { icon } from '../icons.js';

// ui.js registra eventos al importarse. Estas plantillas pequeñas mantienen el
// módulo del plano importable en Node sin DOM y escapan los datos del catálogo.
const raw = (value) => ({ value, toString() { return this.value; } });
const escape = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const part = (value) => Array.isArray(value) ? value.map(part).join('')
  : value && typeof value === 'object' && 'value' in value ? value.value
    : value == null || value === false ? '' : escape(value);
const html = (strings, ...values) => raw(strings.reduce((out, s, i) => out + s + (i < values.length ? part(values[i]) : ''), ''));
const mount = (el, content) => { el.innerHTML = String(content); };

const layouts = new Map();
const loading = new Map();
const baseFor = (plano) => `/${(plano.base || 'img/nevera/').replace(/^\//, '')}`;

/** Carga el plano una vez; `onReady` se llama cuando llega (si falla, la sección sigue con la cuadrícula). */
export function loadNevera(path, onReady) {
  if (layouts.has(path)) return;
  if (!loading.has(path)) loading.set(path, fetch(`/${path.replace(/^\//, '')}`)
    .then((r) => (r.ok ? r.json() : null)).catch(() => null));
  loading.get(path).then((data) => {
    if (data) {
      layouts.set(path, data);
      onReady?.();
    } else loading.delete(path); // Permite volver a intentarlo al entrar otra vez.
  });
}
export const planoCargado = (path) => layouts.get(path);

/** Enlace por slug; nunca cambia el plano ni la selección del catálogo. */
export function zonasDelPlano(plano, productos) {
  const bySlug = new Map(productos.map((p) => [p.slug, p]));
  return (plano?.zonas || plano?.grupos || [])
    .filter((zona) => bySlug.has(zona.slug))
    .map((zona) => ({ p: bySlug.get(zona.slug), zona }));
}

const rel = (piece, g) => ({
  left: ((piece.x - g.x) / g.w) * 100,
  top: ((piece.y - g.y) / g.h) * 100,
  width: (piece.w / g.w) * 100,
  height: (piece.h / g.h) * 100,
});
const box = ({ left, top, width, height }) => `left:${left}%;top:${top}%;width:${width}%;height:${height}%`;

/** Las cinco zonas de chapas reparten toda la fila, con límites contiguos.
 * El dibujo conserva las coordenadas del plano; solo cambia el botón invisible. */
export function toqueChapas(g, plano) {
  const fila = plano.grupos.filter((x) => x.tipo === 'chapas').sort((a, b) => a.x - b.x);
  const index = fila.findIndex((x) => x.id === g.id);
  if (index < 0) return '';
  return box({ left: index * 100 / fila.length, top: g.y,
    width: 100 / fila.length, height: g.h });
}

function groupHtml(g, p, plano) {
  const BASE = baseFor(plano);
  return html`
    <div class="nev-g nev-${g.tipo}" data-nev="${p.id}" style="${box({ left: g.x, top: g.y, width: g.w, height: g.h })}">
      ${g.piezas.map((pz) => html`<span class="nev-p wait${g.tipo === 'chapas' ? ' round' : ''}" style="${box(rel(pz, g))}">
        <img class="nev-img" src="${BASE + pz.img}" alt="" decoding="async" draggable="false">
        <img class="nev-sel" src="${BASE + pz.sel}" alt="" decoding="async" draggable="false">
      </span>`)}
      ${g.tipo !== 'chapas' ? html`<button type="button" class="nev-hit" data-add="${p.id}"></button>` : ''}
      <span class="nev-ctl"></span>
      <span class="nev-flag" aria-hidden="true"></span>
    </div>
    ${g.tipo === 'chapas' ? html`<button type="button" class="nev-hit nev-chapas-hit" data-add="${p.id}" style="${toqueChapas(g, plano)}"></button>` : ''}`;
}

const planoBox = (r, plano) => box({ left: r.x / plano.fondo.w * 100,
  top: r.y / plano.fondo.h * 100, width: r.w / plano.fondo.w * 100, height: r.h / plano.fondo.h * 100 });

// Siluetas neutras para recursos descartados: sin marcas ni texto en el dibujo.
function siluetaZona(tipo) {
  const shapes = tipo === 'chapas'
    ? [90, 270, 450, 630, 810].map((x) => `<circle cx="${x}" cy="75" r="56"/>`).join('')
    : [25, 165].map((x) => `<rect x="${x}" y="12" width="100" height="315" rx="18"/>`).join('');
  return raw(`<svg class="nev-placeholder" viewBox="0 0 ${tipo === 'chapas' ? '900 150' : '290 346'}" aria-hidden="true" fill="currentColor">${shapes}</svg>`);
}

/** HTML puro: el estado del pedido llega como argumento, no se lee el DOM ni state. */
export function zonaHtml(p, zonas, plano, { n = 0, pend = 0, out = false, shown = n, qty = String(n), pending = String(pend), what = 'una botella' } = {}) {
  const zona = zonas[0];
  const BASE = baseFor(plano);
  const rect = zona.rect;
  const hit = zona.hit;
  const relative = (r) => box({ left: (r.x - hit.x) / hit.w * 100,
    top: (r.y - hit.y) / hit.h * 100, width: r.w / hit.w * 100, height: r.h / hit.h * 100 });
  const label = [p.name, n ? `${qty} en el pedido` : `toca para pedir ${what}`,
    pend ? `${pending} pend.` : '', out ? 'agotado en almacén' : ''].filter(Boolean).join(', ');
  return html`<div class="nev-zone${n ? ' on' : ''}${out ? ' out' : ''}" data-card="${p.id}" data-nev="${p.id}" style="${planoBox(hit, plano)}">
    <span class="nev-p${n ? ' sel' : ''}" style="${relative(rect)}">
      ${zona.imagen ? html`<img class="nev-img" src="${BASE + zona.imagen}" alt="" decoding="async" draggable="false">
        <img class="nev-sel" src="${BASE + zona.seleccion}" alt="" decoding="async" draggable="false">` : siluetaZona(zona.silueta)}
    </span>
    <button type="button" class="nev-hit" data-add="${p.id}" aria-label="${label}" aria-pressed="${String(n > 0)}">
      <span class="nev-flag${out ? ' danger' : pend ? ' info' : ''}" aria-hidden="true">${out ? 'Agotado' : pend ? `${pending} pend.` : ''}</span>
    </button>
    <span class="nev-ctl">${n ? html`<span class="count" aria-label="${qty} en la solicitud">${shown}</span>
      <button type="button" class="card-minus" data-minus="${p.id}" aria-label="Quitar ${what} de ${p.name}">${raw(icon('minus', { size: 18 }))}</button>` : ''}</span>
  </div>`;
}

/** Monta la bandeja; funciona con los planos frontal y de Chupitería. */
export function renderNevera(el, plano, products = [], estado = () => ({})) {
  const frontal = plano.marcar === 'producto';
  const BASE = baseFor(plano);
  mount(el, html`<div class="nevera${frontal ? ' nevera-frontal' : ''}" role="group" aria-label="${frontal ? 'Nevera' : 'Nevera de chupitería'}" style="--nv-ar:${plano.fondo.w}/${plano.fondo.h}">
    <div class="nev-tray" style="aspect-ratio:${plano.fondo.w}/${plano.fondo.h}">
      <img class="nev-bg" src="${BASE + (plano.fondo.imagen || plano.fondo.img)}" alt="" decoding="async" draggable="false">
      ${zonasDelPlano(plano, products).map(({ p, zona }) => frontal ? zonaHtml(p, [zona], plano, estado(p)) : groupHtml(zona, p, plano))}
    </div></div>`);
}

/**
 * Dibuja (la primera vez) o actualiza la nevera con los productos de la sección.
 * Devuelve los id que salen en la nevera, para quitarlos de la cuadrícula de debajo.
 */
export function drawNevera(el, products, { visible, plano: layout, estado }) {
  const ids = new Set();
  if (!el) return ids;
  if (!layout || !visible) {
    el.hidden = true;
    return ids;
  }
  const groups = zonasDelPlano(layout, products).map(({ p, zona }) => ({ p, g: zona }));
  for (const { p } of groups) ids.add(p.id);

  const key = JSON.stringify([layout, groups.map(({ p }) => [p.id, p.name])]);
  if (el.dataset.key !== key) {
    renderNevera(el, layout, products, estado);
    // Mientras carga cada imagen, su hueco se ve como un bloque de color y ya se puede tocar.
    for (const img of el.querySelectorAll('.nev-img')) {
      const done = () => img.parentElement.classList.remove('wait');
      if (img.complete && img.naturalWidth) done();
      else img.addEventListener('load', done, { once: true });
    }
    el.dataset.key = key;
  }
  el.hidden = false;
  for (const { g, p } of groups) updateGroup(el, g, p, layout, estado(p));
  return ids;
}

/** Actualiza un producto de la nevera (tras sumar o quitar) sin tocar las imágenes. */
export function patchNevera(el, pid, { products, plano: layout, estado }) {
  if (!el || el.hidden || !layout) return false;
  const node = el.querySelector(`[data-nev="${pid}"]`);
  if (!node) return false;
  const p = products.find((x) => x.id === pid);
  const g = (layout.zonas || layout.grupos).find((x) => x.slug === p?.slug);
  if (!p || !g) return false;
  updateGroup(el, g, p, layout, estado(p));
  return true;
}

function updateGroup(el, g, p, plano, value) {
  const node = el.querySelector(`[data-nev="${p.id}"]`);
  if (!node) return;
  const { n, pend, out, shown, qty, pending, what } = value;
  node.classList.toggle('on', n > 0);
  node.classList.toggle('out', out);
  node.querySelectorAll('.nev-p').forEach((piece, i) => piece.classList.toggle('sel', plano.marcar === 'producto' ? n > 0 : i < n));

  const hit = node.querySelector('.nev-hit') || el.querySelector(`.nev-chapas-hit[data-add="${p.id}"]`);
  hit.setAttribute('aria-pressed', n > 0);
  const parts = [p.name, n ? `${qty} en el pedido` : `toca para pedir ${what}`];
  if (pend) parts.push(`${pending} pend.`);
  if (out) parts.push('agotado en almacén');
  hit.setAttribute('aria-label', parts.join(', '));

  const ctl = node.querySelector('.nev-ctl');
  const key = JSON.stringify([n, shown, qty, what, p.name]);
  if (ctl.dataset.key !== key) {
    mount(ctl, n ? html`
      <span class="count" aria-label="${qty} en la solicitud">${shown}</span>
      <button type="button" class="card-minus nev-minus" data-minus="${p.id}" aria-label="Quitar ${what} de ${p.name}">${raw(icon('minus', { size: 18 }))}</button>` : '');
    ctl.dataset.key = key;
  }

  const flag = node.querySelector('.nev-flag');
  const text = out ? 'Agotado' : pend ? `${pending} pend.` : '';
  if (flag.textContent !== text) flag.textContent = text;
  flag.className = `nev-flag${out ? ' danger' : pend ? ' info' : ''}`;
}
