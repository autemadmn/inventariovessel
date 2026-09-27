// Zona del encargado: pestañas y acceso con PIN.
import { auth, mpost } from '../api.js';
import { state } from '../state.js';
import { $, html, mount, formDialog, toast } from '../ui.js';
import { renderInformes } from './informes.js';
import { renderNoches } from './noches.js';
import { renderPrevision } from './prevision.js';
import { renderCompras } from './compras.js';
import { renderCatalogo } from './catalogo.js';
import { renderCambios } from './cambios.js';
import { renderAjustes } from './ajustes.js';

const TABS = [
  ['informes', 'Informes', renderInformes],
  ['noches', 'Noches', renderNoches],
  ['prevision', 'Previsión', renderPrevision],
  ['compras', 'Compras', renderCompras],
  ['catalogo', 'Catálogo', renderCatalogo],
  ['cambios', 'Cambios', renderCambios],
  ['ajustes', 'Ajustes', renderAjustes],
];

export async function askPin(message = '') {
  const data = await formDialog('PIN de encargado', html`
    ${message ? html`<p class="error">${message}</p>` : ''}
    <label class="field"><span>PIN</span>
      <input name="pin" type="password" inputmode="numeric" autocomplete="off" required autofocus></label>`,
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
  const current = TABS.find((t) => t[0] === tab) ?? TABS[0];
  mount(root, html`
    <section class="gestion">
      <nav class="tabs">${TABS.map(([id, label]) => html`
        <a href="#/gestion/${id}" class="${id === current[0] ? 'on' : ''}">${label}</a>`)}</nav>
      <div id="tab"></div>
    </section>`);
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
