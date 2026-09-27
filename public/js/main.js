import { auth, get, post, setAuthErrorHandler, ApiError } from './api.js';
import { state, loadBootstrap, loadLive, setWho, subscribe } from './state.js';
import { $, html, mount, formDialog, dateLabel } from './ui.js';
import { renderPedir } from './views/pedir.js';
import { renderReponer } from './views/reponer.js';
import { renderGestion } from './views/gestion.js';

const main = $('#main');
let current = null; // { name, cleanup }

const ROUTES = {
  pedir: renderPedir,
  reponer: renderReponer,
  gestion: renderGestion,
};

function route() {
  const [name, ...rest] = location.hash.replace(/^#\/?/, '').split('/');
  return { name: ROUTES[name] ? name : 'pedir', rest };
}

async function navigate() {
  const { name, rest } = route();
  current?.cleanup?.();
  for (const a of document.querySelectorAll('.nav a')) a.classList.toggle('active', a.dataset.route === name);
  document.body.dataset.view = name;
  current = { name, cleanup: await ROUTES[name](main, rest) };
  window.scrollTo(0, 0);
}

function renderHeader() {
  const pending = state.live.lines.reduce((a, l) => a + l.qty_pending, 0);
  const badge = $('#pending-badge');
  badge.textContent = pending;
  badge.hidden = !pending;
  $('#who').textContent = state.who || 'Tu nombre';
  $('#night').textContent = state.date ? `Noche ${dateLabel(state.date)}` : '';
}

async function askWho() {
  const data = await formDialog('¿Quién usa este dispositivo?', html`
    <p class="muted">Tu nombre aparece en la lista para que el resto sepa quién pide y quién repone. Se guarda en este dispositivo.</p>
    <label class="field"><span>Nombre</span>
      <input name="who" value="${state.who}" maxlength="40" autocomplete="given-name" required autofocus></label>`,
  { ok: 'Guardar' });
  if (data) {
    setWho(data.who);
    renderHeader();
  }
}

// ------------------------------------------------------------ tiempo real

let pollTimer;

async function refreshAll() {
  try {
    await Promise.all([loadLive(), loadBootstrap()]);
    $('#offline').hidden = true;
  } catch (err) {
    if (err instanceof ApiError && err.status === 0) $('#offline').hidden = false;
  }
}

// La lista se comparte entre dispositivos consultando al servidor cada pocos
// segundos mientras la app está a la vista (y al volver a ella).
const LIVE_EVERY = 4000;
const CATALOG_EVERY = 60000;
let lastCatalog = 0;

async function poll() {
  if (document.visibilityState !== 'visible' || reauthing) return;
  try {
    await loadLive();
    if (Date.now() - lastCatalog > CATALOG_EVERY) {
      lastCatalog = Date.now();
      await loadBootstrap();
    }
    $('#offline').hidden = true;
  } catch (err) {
    if (err instanceof ApiError && err.status === 0) $('#offline').hidden = false;
  }
}

function connect() {
  clearInterval(pollTimer);
  lastCatalog = Date.now();
  pollTimer = setInterval(poll, LIVE_EVERY);
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refreshAll();
});
window.addEventListener('online', refreshAll);

// ------------------------------------------------------------ acceso

async function login(message = '') {
  document.body.dataset.view = 'login';
  mount(main, html`
    <section class="login">
      <h1>Vessel</h1>
      <p class="muted">Reposición de barras. Introduce el código de acceso del local.</p>
      <form id="login-form" class="stack">
        <input name="code" type="password" inputmode="text" autocomplete="current-password"
          placeholder="Código de acceso" required autofocus>
        ${message ? html`<p class="error">${message}</p>` : ''}
        <button class="btn primary big">Entrar</button>
      </form>
    </section>`);
  return new Promise((resolve) => {
    $('#login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      auth.code = new FormData(e.target).get('code');
      try {
        await post('/api/auth/check');
        resolve();
      } catch (err) {
        auth.code = '';
        resolve(login(err.message));
      }
    });
  });
}

let reauthing = false;
setAuthErrorHandler(async (err, manager) => {
  if (manager) {
    auth.pin = '';
    return;
  }
  if (reauthing) return;
  reauthing = true;
  auth.code = '';
  clearInterval(pollTimer);
  await login(err.message);
  reauthing = false;
  await start();
});

async function start() {
  await Promise.all([loadBootstrap(), loadLive()]);
  renderHeader();
  connect();
  await navigate();
  if (!state.who) askWho();
}

async function boot() {
  $('#who-btn').addEventListener('click', askWho);
  subscribe(renderHeader);
  window.addEventListener('hashchange', navigate);
  try {
    const { accessRequired } = await get('/api/auth');
    if (accessRequired && !auth.code) await login();
    await start();
  } catch (err) {
    if (err.status === 401) return; // el manejador de acceso ya muestra la pantalla
    mount(main, html`<section class="login"><h1>No se puede conectar</h1><p class="error">${err.message}</p>
      <button class="btn primary" id="retry">Reintentar</button></section>`);
    $('#retry').addEventListener('click', () => location.reload());
  }
}

boot();
