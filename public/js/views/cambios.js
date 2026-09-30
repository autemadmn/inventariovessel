// Registro de cambios: todo lo que se pide, entrega, corrige o modifica.
import { mget } from '../api.js';
import { barName } from '../state.js';
import { html, mount, dateTimeLabel } from '../ui.js';

const ENTITIES = [
  ['', 'Todo'],
  ['reposicion', 'Reposiciones'],
  ['solicitud', 'Solicitudes'],
  ['producto', 'Productos'],
  ['seleccion', 'Selección'],
  ['personal', 'Personal'],
  ['noche', 'Noches'],
  ['compra', 'Compras'],
  ['ajustes', 'Ajustes'],
];

let entity = 'reposicion';

const LABELS = {
  botellas: 'botellas', barra: 'barra', producto: 'producto', noche: 'noche',
  same_level: 'mismo nivel', notes: 'notas', photo: 'foto', capacity_ml: 'capacidad (ml)', per_case: 'por caja',
  status: 'estado', active: 'visible', name: 'nombre', category: 'categoría', note: 'nota',
  group_id: 'grupo', group_order: 'posición', destino: 'destino', orden: 'orden',
};

function show(k, v) {
  if (v === null || v === undefined || v === '') return '—';
  if (k === 'barra') return barName(v);
  if (typeof v === 'boolean') return v ? 'sí' : 'no';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function diff(a) {
  const keys = [...new Set([...Object.keys(a.before || {}), ...Object.keys(a.after || {})])]
    .filter((k) => !['id', 'created_at', 'updated_at', 'sort'].includes(k));
  return keys.map((k) => {
    const b = a.before?.[k];
    const n = a.after?.[k];
    if (a.before && JSON.stringify(b) === JSON.stringify(n)) return '';
    return html`<span class="chg"><i>${LABELS[k] || k}:</i> ${a.before ? html`<s>${show(k, b)}</s> → ` : ''}${show(k, n)}</span>`;
  });
}

export async function renderCambios(root) {
  const draw = async () => {
    const list = await mget(`/api/audit?limit=300${entity ? `&entity=${entity}` : ''}`);
    mount(root, html`
      <div class="chips wrap">${ENTITIES.map(([v, l]) => html`
        <button type="button" class="chip ${entity === v ? 'on' : ''}" data-entity="${v}">${l}</button>`)}</div>
      ${list.length ? html`<ul class="audit">${list.map((a) => html`<li>
        <span class="time">${dateTimeLabel(a.at)}</span>
        <span><b>${a.action}</b> · ${a.entity}${a.entity_id ? ` #${a.entity_id}` : ''}${a.actor ? html` · <i>${a.actor}</i>` : ''}</span>
        <span class="chgs">${diff(a)}</span>
        ${a.reason ? html`<span class="reason">Motivo: ${a.reason}</span>` : ''}
      </li>`)}</ul>` : html`<p class="empty">Sin cambios registrados.</p>`}`);
  };
  root.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-entity]');
    if (!t) return;
    entity = t.dataset.entity;
    await draw();
  });
  await draw();
}
