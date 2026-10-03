// Zona del encargado: pestañas y acceso con PIN.
import { auth, mpost } from '../api.js';
import { state } from '../state.js';
import { $, html, raw, mount, formDialog, toast } from '../ui.js';
import { icon } from '../icons.js';
import { renderInformes } from './informes.js';
import { renderSeleccion } from './seleccion.js';
import { renderPersonal } from './personal.js';
import { renderCatalogo } from './catalogo.js';
import { renderAjustes } from './ajustes.js';
import { renderControl } from './control.js';

const TABS = [
  ['informes', 'Informes', renderInformes],
  ['seleccion', 'Selección', renderSeleccion],
  ['personal', 'Personal', renderPersonal],
  ['catalogo', 'Catálogo', renderCatalogo],
  ['descuadres', 'Descuadres', (root) => renderControl(root, { gestion: true })],
];
// Ajustes (barras, códigos, copia de seguridad) no es pestaña: se abre desde el engranaje.
const ROUTES = [...TABS, ['ajustes', 'Ajustes', renderAjustes]];

export async function askPin(message = '') {
  const data = await formDialog('PIN de encargado', html`
    ${message ? html`<p class="error">${message}</p>` : ''}
    <label class="field"><span>PIN</span>
      <input name="pin" type="password" inputmode="text" autocomplete="off" required autofocus></label>`,
  { ok: 'Entrar' });
  if (!data) return false;
  auth.pin = data.pin;
  try {
    await mpost('/api/auth/manager');
    return true;
  } catch (err) {
    return askPin(err.message);
  }
}

export async function renderGestion(root, [tab, ...rest]) {
  if (state.managerRequired && !auth.pin) {
    mount(root, html`<section class="login"><h1>Gestión</h1><p class="muted">Zona del encargado.</p>
      <button type="button" class="btn primary big" id="pin-btn">Introducir PIN</button></section>`);
    const go = async () => {
      if (await askPin()) renderGestion(root, [tab, ...rest]);
    };
    $('#pin-btn').addEventListener('click', go);
    go();
    return undefined;
  }
  const current = ROUTES.find((t) => t[0] === tab) ?? TABS[0];
  mount(root, html`
    <section class="gestion">
      <div class="tabs-bar"><nav class="tabs" aria-label="Secciones de Gestión">${TABS.map(([id, label]) => html`
        <a href="#/gestion/${id}" class="${id === current[0] ? 'on' : ''}" ${id === current[0] ? raw('aria-current="page"') : ''}>${label}</a>`)}
      </nav>
        <a href="#/gestion/ajustes" class="tabs-gear ${current[0] === 'ajustes' ? 'on' : ''}" ${current[0] === 'ajustes' ? raw('aria-current="page"') : ''} aria-label="Ajustes" title="Ajustes">${raw(icon('settings'))}</a></div>
      <div id="tab"></div>
    </section>`);
  // Si las pestañas no caben, se deja la activa a la vista.
  const tabs = $('.tabs');
  $('.tabs a.on')?.scrollIntoView({ inline: 'center', block: 'nearest' });
  // Fundido en el borde que tiene más pestañas fuera de la vista.
  const edges = () => {
    tabs.classList.toggle('more-left', tabs.scrollLeft > 2);
    tabs.classList.toggle('more-right', tabs.scrollLeft + tabs.clientWidth < tabs.scrollWidth - 2);
  };
  tabs.addEventListener('scroll', edges, { passive: true });
  edges();
  try {
    return await current[2]($('#tab'), rest);
  } catch (err) {
    if (err.status === 401 || err.status === 403) {
      if (await askPin(err.message)) return renderGestion(root, [tab, ...rest]);
    } else {
      toast(err.message, 'error');
    }
    return undefined;
  }
}
