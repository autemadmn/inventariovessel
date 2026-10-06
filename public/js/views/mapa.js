import { get } from '../api.js';
import { state, subscribe, POINT_TYPE_LABEL } from '../state.js';
import { html, raw, mount, dateLabel } from '../ui.js';
import { icon } from '../icons.js';
import { MAPA } from '../mapa-vessel.js';
import { storeSeg, bindSideNavigation, tripButton, onStockChange } from './almacen.js';

const rect = ([x, y, w, h], cls, r = 0) => html`<rect class="${cls}" x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}"/>`;
const status = (p) => p.status === 'sin_contar' ? 'Sin contar nunca' : p.status === 'descuadre' ? 'Descuadre en el último recuento' : p.last_count_at ? `Contado el ${dateLabel(p.last_count_at.slice(0, 10))}` : 'Sin contar nunca';
const shortStatus = (p) => p.status === 'descuadre' ? 'Descuadre' : p.last_count_at && p.status !== 'sin_contar' ? `Contado ${dateLabel(p.last_count_at.slice(0, 10))}` : 'Sin contar';

function label(m) {
  if (!m.label) return '';
  const [x, y] = m.at;
  const lines = Array.isArray(m.label) ? m.label : [m.label];
  return html`<text class="map-label${m.small ? ' small' : ''}" x="${x}" y="${y}" text-anchor="${m.anchor ?? 'middle'}"
    transform="${m.vertical ? `rotate(-90 ${x} ${y})` : ''}">${lines.map((line, i) => html`<tspan x="${x}" dy="${i ? 28 : 0}">${line}</tspan>`)}</text>`;
}

/** Un punto del mapa: forma según su tipo, etiqueta, estado y zona táctil. */
function point(m, p) {
  const body = m.kind === 'nevera'
    ? m.units.map((u) => rect(u, m.solid ? 'map-unit solid' : 'map-unit', 4))
    : rect(m.rect, 'map-body', m.kind === 'almacen' ? 14 : 10);
  const [hx, hy, hw] = m.hit;
  const alert = p.status === 'descuadre'
    ? html`<g class="map-alert" aria-hidden="true"><circle cx="${hx + hw - 14}" cy="${hy + 14}" r="12"/><text x="${hx + hw - 14}" y="${hy + 15}">!</text></g>`
    : '';
  const name = [p.name, POINT_TYPE_LABEL[p.type], status(p), m.approximate ? 'posición aproximada' : ''].filter(Boolean).join(', ');
  return html`<a href="#/almacen/in/${p.key}" class="map-point kind-${m.kind} map-${p.key} ${p.status}" aria-label="${name}">
    ${rect(m.hit, 'map-hit', 12)}${body}${label(m)}
    ${m.sub ? html`<text class="map-sub" x="${m.sub[0]}" y="${m.sub[1]}" text-anchor="middle">${shortStatus(p)}</text>` : ''}${alert}</a>`;
}

function mapSvg(points) {
  const byKey = new Map(points.map((p) => [p.key, p]));
  // Primero los almacenes: lo que va dentro (la nevera de vino) queda encima y se puede tocar.
  const order = [...MAPA.points].sort((a, b) => (a.kind === 'almacen' ? 0 : 1) - (b.kind === 'almacen' ? 0 : 1));
  return html`<svg class="vessel-map" viewBox="${MAPA.viewBox}" role="group" aria-label="Plano de los puntos de In Vessel">
    <defs><pattern id="map-hatch" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <line class="map-hatch-line" x1="0" y1="0" x2="0" y2="14"/></pattern></defs>
    <g aria-hidden="true">
      <path class="map-building" d="${MAPA.building}"/>
      <path class="map-staff" d="${MAPA.staff}"/>
      <path class="map-hatch-area" d="${MAPA.staff}"/>
      ${MAPA.partitions.map((d) => html`<path class="map-partition" d="${d}"/>`)}
      <g class="map-stairs">${rect(MAPA.stairs.rect, 'map-stairs-box')}${MAPA.stairs.rungs.map((y) =>
        html`<line x1="${MAPA.stairs.rect[0]}" x2="${MAPA.stairs.rect[0] + MAPA.stairs.rect[2]}" y1="${y}" y2="${y}"/>`)}</g>
      ${MAPA.walls.map((d) => html`<path class="map-wall" d="${d}"/>`)}
      <path class="map-edge" d="${MAPA.building}"/>
      ${MAPA.zones.map((z) => html`<text class="map-zone${z.size === 'big' ? ' big' : ''}" x="${z.at[0]}" y="${z.at[1]}" text-anchor="middle"
        transform="${z.rotate ? `rotate(${z.rotate} ${z.at[0]} ${z.at[1]})` : ''}">${z.label}</text>`)}
    </g>
    ${order.map((m) => byKey.has(m.key) ? point(m, byKey.get(m.key)) : '')}
  </svg>`;
}

const LEGEND = html`<ul class="map-legend" aria-label="Leyenda del plano">
  <li><span class="sw sw-almacen"></span>Almacén</li>
  <li><span class="sw sw-nevera"></span>Nevera</li>
  <li><span class="sw sw-barra"></span>Barra</li>
  <li><span class="sw sw-staff"></span>Zona de personal</li>
  <li><span class="sw-alert" aria-hidden="true">!</span>Descuadre</li>
</ul>`;

export function renderMapa(root) {
  mount(root, html`<section class="alm alm-map" id="alm-map">${storeSeg('in')}
    <div id="map-body"><p class="empty">Cargando…</p></div>
    <div class="alm-actions"><a class="btn ghost" href="#/almacen/in/lista">Ver todo In Vessel en lista</a>
    <a class="btn ghost" href="#/almacen/entrada">${raw(icon('package-plus'))} Ha llegado mercancía</a></div>
    <a class="alm-trip" id="map-trip" href="#/viajes/pedido">${tripButton()}</a>
    <a class="alm-control" href="#/almacen/control">${raw(icon('lock', {size:16}))} Historial y descuadres</a></section>`);
  const el = root.querySelector('#alm-map');
  bindSideNavigation(el);
  let request = 0;
  const refresh = async () => {
    const seq = ++request;
    try {
      const r = await get('/api/almacen/puntos');
      if (seq !== request || !el.isConnected) return;
      mount(el.querySelector('#map-body'), html`
        <div class="map-card">${mapSvg(r.points)}${LEGEND}</div>
        <p class="map-note">La posición de la barra VIP es aproximada.</p>`);
    } catch (err) {
      if (seq === request && el.isConnected) mount(el.querySelector('#map-body'), html`<p class="empty">No se ha podido cargar el mapa. ${err.message}</p>`);
    }
  };
  const unsub = onStockChange(refresh);
  let trip = JSON.stringify(state.live.trip);
  const unsubTrip = subscribe(() => {
    const next = JSON.stringify(state.live.trip);
    if (trip === next) return;
    trip = next;
    mount(el.querySelector('#map-trip'), tripButton());
  });
  refresh();
  return () => { request++; unsub(); unsubTrip(); };
}
