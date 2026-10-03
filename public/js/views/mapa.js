import { get } from '../api.js';
import { state, subscribe, POINT_TYPE_LABEL } from '../state.js';
import { html, raw, mount, dateLabel } from '../ui.js';
import { icon } from '../icons.js';
import { MAPA } from '../mapa-vessel.js';
import { storeSeg, bindSideNavigation, tripButton, onStockChange } from './almacen.js';

const rect = ([x,y,w,h], cls = 'map-shape') => html`<rect class="${cls}" x="${x}" y="${y}" width="${w}" height="${h}"/>`;
const shape = (p) => html`${p.poly ? html`<polygon class="map-shape" points="${p.poly}"/>` : ''}${p.rect ? rect(p.rect) : ''}${(p.rects ?? []).map((r) => rect(r))}`;
const label = (p) => html`<text x="${p.at[0]}" y="${p.at[1]}" transform="${p.vertical ? `rotate(-90 ${p.at.join(' ')})` : ''}">${Array.isArray(p.label) ? p.label.map((line,i) => html`<tspan x="${p.at[0]}" dy="${i ? 30 : -15}">${line}</tspan>`) : p.label}</text>`;
const status = (p) => p.status === 'sin_contar' ? 'Sin contar nunca' : p.status === 'descuadre' ? 'Descuadre en el último recuento' : p.last_count_at ? `Contado el ${dateLabel(p.last_count_at.slice(0,10))}` : 'Sin contar nunca';

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
        <svg class="vessel-map" viewBox="${MAPA.viewBox}" aria-label="Plano de los puntos de In Vessel">
          <path class="map-outline" d="${MAPA.outline}"/>
          <g class="map-context" aria-hidden="true">${MAPA.context.map((p) => html`<g>${shape(p)}${label(p)}</g>`)}</g>
          ${MAPA.points.map((m) => {
            const p = r.points.find((x) => x.key === m.key);
            if (!p) return '';
            return html`<a href="#/almacen/in/${p.key}" class="map-point map-${p.type} map-${p.key} ${p.status}" aria-label="${[p.name, POINT_TYPE_LABEL[p.type], status(p), m.approximate ? 'posición aproximada' : ''].filter(Boolean).join(', ')}">
              ${shape(m)}${label(m)}${rect(m.hit, 'map-hit')}
              ${p.status === 'descuadre' ? html`<g class="map-alert" aria-hidden="true"><circle cx="${m.hit[0]+m.hit[2]-16}" cy="${m.hit[1]+16}" r="13"/><text x="${m.hit[0]+m.hit[2]-16}" y="${m.hit[1]+16}">!</text></g>` : ''}</a>`;
          })}</svg>
        <div class="map-note muted small"><p>Línea discontinua: sin contar nunca. «!»: descuadre en el último recuento.</p><p>La posición de la nevera de vino y la barra VIP es aproximada.</p></div>
        <h2 class="section-title">Puntos</h2><ul class="point-list">${r.points.map((p) => html`<li><a href="#/almacen/in/${p.key}">
          <span><b>${p.name}</b><small>${POINT_TYPE_LABEL[p.type]} · <span class="${p.status === 'descuadre' ? 'tag warn' : ''}">${status(p)}</span></small></span>${raw(icon('right'))}</a></li>`)}</ul>`);
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
