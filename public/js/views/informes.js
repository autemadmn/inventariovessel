// Informes: qué alcohol se ha repuesto, por periodo y por grupo de la selección.
// El periodo se comparte con el detalle de cada botella (botella.js).
import { mget, store } from '../api.js';
import { state } from '../state.js';
import { raw, html, mount, fmt, plural, thumb, toast } from '../ui.js';
import { icon } from '../icons.js';

// ------------------------------------------------------------------ filtros compartidos

const PERIODS = [['weekend', 'Último finde'], ['month', 'Este mes'], ['lastmonth', 'Mes pasado']];

export const filters = {
  period: store.get('infPeriod', 'month'),
  group: store.get('infGroup', ''),
};
if (!PERIODS.some(([v]) => v === filters.period)) filters.period = 'month';

/** Día 1 del mes anterior a la noche actual. */
function previousMonth() {
  const today = state.date || new Date().toISOString().slice(0, 10);
  const d = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 10);
}

/** Parámetros de consulta del periodo (y del grupo si se pide). */
export function query({ group = false } = {}) {
  const q = new URLSearchParams();
  if (filters.period === 'weekend') {
    q.set('period', 'weekend');
  } else {
    q.set('period', 'month');
    if (filters.period === 'lastmonth') q.set('date', previousMonth());
  }
  if (group) q.set('group', filters.group);
  return q.toString();
}

/** Selector de periodo: tres opciones fijas. */
export function periodControls() {
  return html`
    <div class="seg inf-period" role="group" aria-label="Periodo">${PERIODS.map(([v, l]) => html`
      <button type="button" class="${filters.period === v ? 'on' : ''}" data-period="${v}" aria-pressed="${String(filters.period === v)}">${l}</button>`)}</div>`;
}

/** Aplica un clic en el selector de periodo. Devuelve true si hay que volver a pedir datos. */
export function applyPeriodClick(d) {
  if (!d.period || d.period === filters.period) return false;
  filters.period = d.period;
  store.set('infPeriod', filters.period);
  return true;
}

/** «5 cajas + 2», «3 cajas» o, si no llega a una caja, vacío (la cifra grande ya dice las botellas). */
export function casesLabel(c) {
  if (!c || !c.full) return '';
  const full = plural(c.full, 'caja', 'cajas');
  return c.loose ? `${full} + ${fmt(c.loose)}` : full;
}

/** Fechas del periodo («Finde del 25 al 27 sep», «septiembre 2026»; la mayúscula la pone CSS). */
export const rangeLabel = (r) => r?.range?.label ?? '';

/** Espera sutil mientras llega el periodo nuevo, sin vaciar la pantalla. */
export function busy(root, on) {
  const box = root.firstElementChild;
  if (!box) return;
  box.classList.toggle('is-loading', on);
  box.setAttribute('aria-busy', String(on));
}

/** Redibuja al cambiar el ancho de la pantalla. Devuelve la función que lo quita. */
export function onWidthChange(el, fn) {
  let last = el.clientWidth;
  let t;
  const handler = () => {
    clearTimeout(t);
    t = setTimeout(() => {
      if (!el.isConnected || el.clientWidth === last) return;
      last = el.clientWidth;
      fn();
    }, 150);
  };
  window.addEventListener('resize', handler);
  return () => {
    clearTimeout(t);
    window.removeEventListener('resize', handler);
  };
}

// ------------------------------------------------------------------ grupos

/** Nombre del grupo extra con las botellas sin grupo. */
function otherLabel(groups) {
  return groups.some((g) => g.name.trim().toLocaleLowerCase('es') === 'otras') ? 'Sin grupo' : 'Otras';
}

/** El grupo guardado, si sigue existiendo; si no, el primero de la selección. */
function validGroup(groups) {
  if (filters.group === 'none' || groups.some((g) => String(g.id) === filters.group)) return filters.group;
  return groups[0] ? String(groups[0].id) : 'none';
}

function setGroup(v) {
  filters.group = v;
  store.set('infGroup', v);
}

// ------------------------------------------------------------------ vista

export async function renderInformes(root, rest = []) {
  if (rest[0] === 'botella') {
    const { renderBotella } = await import('./botella.js');
    return renderBotella(root, rest[1]);
  }

  let r = null;
  let requestId = 0;
  setGroup(validGroup(state.groups ?? []));

  const load = async () => {
    try {
      return await mget(`/api/informe?${query({ group: true })}`);
    } catch (err) {
      // Un grupo borrado desde otro móvil: se vuelve al primero.
      if (err.status !== 400 || !/grupo/i.test(err.message)) throw err;
      setGroup('');
      setGroup(validGroup(state.groups ?? []));
      if (filters.group === '') throw err;
      return mget(`/api/informe?${query({ group: true })}`);
    }
  };

  const refresh = async () => {
    const id = ++requestId;
    busy(root, true);
    try {
      let result = await load();
      if (id !== requestId || !root.isConnected) return;
      // «Otras» solo existe si alguna botella sin grupo se movió en el periodo.
      const others = result.byGroup.find((g) => g.group_id === null)?.bottles ?? 0;
      const fallback = validGroup(result.groups);
      if ((filters.group === 'none' && !others && result.groups.length) || fallback !== filters.group) {
        setGroup(filters.group === 'none' && !others ? String(result.groups[0].id) : fallback);
        result = await load();
        if (id !== requestId || !root.isConnected) return;
      }
      r = result;
      mount(root, view(r));
    } finally {
      if (id === requestId) busy(root, false);
    }
  };

  root.addEventListener('click', async (e) => {
    const t = e.target.closest('button');
    if (!t || !root.contains(t)) return;
    const d = t.dataset;
    if (d.group !== undefined) {
      if (d.group === filters.group) return;
      setGroup(d.group);
    } else if (!applyPeriodClick(d)) {
      return;
    }
    try {
      await refresh();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  await refresh();
  return undefined;
}

function view(r) {
  const others = r.byGroup.find((g) => g.group_id === null)?.bottles ?? 0;
  const chips = [
    ...r.groups.map((g) => [String(g.id), g.name]),
    ...(others || filters.group === 'none' ? [['none', otherLabel(r.groups)]] : []),
  ];
  const moved = r.products.filter((p) => p.bottles);
  const still = r.products.filter((p) => !p.bottles);

  return html`
    <div class="inf">
      ${periodControls()}

      ${chips.length > 1 ? html`
        <div class="chips inf-groups" role="group" aria-label="Grupo">${chips.map(([v, l]) => html`
          <button type="button" class="chip ${filters.group === v ? 'on' : ''}" data-group="${v}" aria-pressed="${String(filters.group === v)}">${l}</button>`)}</div>` : ''}

      <div class="inf-head">
        <h2>${rangeLabel(r)}</h2>
        <p>${plural(r.totals.bottles, 'botella', 'botellas')}</p>
      </div>

      ${moved.length ? html`<ul class="inf-list">${moved.map(row)}</ul>`
    : html`<p class="empty">${r.products.length ? 'Nada repuesto en este periodo.' : 'Este grupo no tiene botellas.'}</p>`}

      ${still.length ? html`
        <details class="inf-zero" ${moved.length ? '' : 'open'}>
          <summary>${raw(icon('right', { size: 18 }))} Sin reposiciones · ${fmt(still.length)}</summary>
          <ul class="inf-list quiet">${still.map(row)}</ul>
        </details>` : ''}
    </div>`;
}

function row(p) {
  const cases = p.bottles ? casesLabel(p.cases) : '';
  const label = [p.name, plural(p.bottles, 'botella', 'botellas'), cases, p.out_of_stock ? 'agotado' : '']
    .filter(Boolean).join(', ');
  return html`
    <li>
      <a class="inf-row ${p.out_of_stock ? 'out' : ''}" href="#/gestion/informes/botella/${p.product_id}" aria-label="${label}">
        ${thumb(p, 'inf-img')}
        <span class="inf-name">
          <b>${p.name}</b>
          ${p.out_of_stock ? html`<span class="tag danger">Agotado</span>` : ''}
        </span>
        <span class="inf-num"><b>${fmt(p.bottles)}</b>${cases ? html`<small>${cases}</small>` : ''}</span>
      </a>
    </li>`;
}
