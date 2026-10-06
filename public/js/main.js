import { auth, get, post, setAuthErrorHandler, ApiError, store } from './api.js';
import { state, loadBootstrap, loadLive, loadManifest, setWho, subscribe } from './state.js';
import { $, html, raw, mount, dialog, formDialog, dateLabel, silhouette } from './ui.js';
import { renderPedir } from './views/pedir.js';
import { renderReponer } from './views/reponer.js';
import { renderGestion } from './views/gestion.js';
import { renderAlmacen, flushCounts } from './views/almacen.js';
import { renderViajes } from './views/viajes.js';

const main = $('#main');

// Safari ignora user-scalable=no: se bloquea aquí el pellizco. Sin escuchar touchmove, para que
// el desplazamiento siga siendo fluido y la barra inferior no se quede a media pantalla.
for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
}

let current = null; // { name, cleanup }
let navigationId = 0;

const ROUTES = {
  pedir: renderPedir,
  reponer: renderReponer,
  almacen: renderAlmacen,
  viajes: renderViajes,
  gestion: renderGestion,
};

function route() {
  const [name, ...rest] = location.hash.replace(/^#\/?/, '').split('/');
  return { name: ROUTES[name] ? name : 'pedir', rest };
}

async function navigate() {
  const navigation = ++navigationId;
  let { name, rest } = route();
  if (name === 'almacen' && rest[0] === 'viaje') {
    history.replaceState(null, '', '#/viajes/pedido');
    name = 'viajes';
    rest = ['pedido'];
  }
  await current?.cleanup?.();
  if (navigation !== navigationId) return;
  for (const a of document.querySelectorAll('.nav a')) a.classList.toggle('active', a.dataset.route === name);
  document.body.dataset.view = name;
  current = { name, cleanup: await ROUTES[name](main, rest) };
  window.scrollTo(0, 0);
}

function renderHeader() {
  const pending = state.live.lines.filter((l) => l.qty_pending > 0).length;
  const badge = $('#pending-badge');
  badge.textContent = pending;
  badge.hidden = !pending;
  $('#who').textContent = state.who || 'Tu nombre';
  $('#night').textContent = state.date ? `Noche ${dateLabel(state.date)}` : '';
}

// Mantiene el nombre del dispositivo alineado con la lista de personal: sigue
// los renombrados y olvida a quien ya no está activo. Devuelve true si lo olvidó.
function syncWho() {
  if (!state.who) return false;
  const same = (a, b) => a.toLocaleLowerCase('es') === b.toLocaleLowerCase('es');
  if (state.whoId) {
    const p = state.staff.find((s) => s.id === state.whoId);
    if (p) {
      if (p.name !== state.who) setWho(p.name, p.id);
      return false;
    }
  } else if (!state.staff.length) {
    return false; // escrito a mano y sin lista: se respeta
  } else {
    const p = state.staff.find((s) => same(s.name, state.who));
    if (p) {
      setWho(p.name, p.id);
      return false;
    }
  }
  setWho('', null);
  store.set('whoAsked', null);
  return true;
}

let asking = false;
async function askWho() {
  if (asking) return;
  asking = true;
  try {
    await chooseWho();
  } finally {
    asking = false;
  }
}

/** Pregunta automática: espera a que se cierre cualquier otro diálogo para no apilarse. */
function askWhoWhenFree() {
  if (document.querySelector('dialog[open]')) setTimeout(askWhoWhenFree, 1500);
  else askWho();
}

async function chooseWho() {
  if (!state.staff.length) {
    const data = await formDialog('¿Quién usa este dispositivo?', html`
      <p class="muted">Opcional. Tu nombre aparece en la lista para que el resto sepa quién pide y quién repone. Se guarda en este dispositivo y puedes ponerlo cuando quieras desde el botón de arriba a la derecha.</p>
      <label class="field"><span>Nombre</span>
        <input name="who" value="${state.who}" maxlength="40" autocomplete="given-name" required></label>`,
    { ok: 'Guardar', cancel: 'Ahora no' });
    if (data) {
      setWho(data.who);
      renderHeader();
    }
    return;
  }
  const chosen = await dialog({
    title: '¿Quién eres?',
    body: html`
      <p class="muted">Tu nombre aparece en la lista para que el resto sepa quién pide y quién repone. Se guarda en este dispositivo.</p>
      <div class="who-list">${state.staff.map((s, i) => html`
        <button type="button" class="who-choice ${s.id === state.whoId ? 'on' : ''}" data-id="${s.id}"
          ${i === 0 ? raw('autofocus') : ''} aria-pressed="${String(s.id === state.whoId)}">${s.name}</button>`)}
      </div>`,
    actions: [{ label: 'Ahora no', value: '' }],
    onMount(dlg, close) {
      dlg.addEventListener('click', (e) => {
        const b = e.target.closest('.who-choice');
        if (b) close(Number(b.dataset.id));
      });
    },
  });
  const person = state.staff.find((s) => s.id === chosen);
  if (person) {
    setWho(person.name, person.id);
    renderHeader();
  }
}

// Si la imagen de catálogo no carga, se ve la silueta y no un hueco roto.
document.addEventListener('error', (e) => {
  const img = e.target;
  const box = img instanceof HTMLImageElement && img.closest('.thumb.float');
  if (!box) return;
  const size = [...box.classList].filter((c) => !['thumb', 'float'].includes(c)).join(' ');
  box.replaceWith(...silhouetteNodes({ category: box.dataset.cat }, size));
}, true);

function silhouetteNodes(p, size) {
  const tpl = document.createElement('template');
  tpl.innerHTML = String(silhouette(p, size));
  return [...tpl.content.childNodes];
}

// ------------------------------------------------------------ tiempo real

let pollTimer;

async function refreshAll() {
  try {
    await Promise.all([loadLive(), loadBootstrap()]);
    $('#offline').hidden = true;
    flushCounts();
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
    // Recuentos guardados sin conexión: salen en cuanto vuelve.
    flushCounts();
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

let started = false;
async function start() {
  await loadManifest();
  await loadBootstrap();
  await loadLive();
  renderHeader();
  connect();
  flushCounts();
  await navigate();
  started = true;
  // Se pregunta una sola vez; «Ahora no» o cerrar no vuelve a molestar.
  if (!state.who && !store.get('whoAsked', false)) {
    store.set('whoAsked', true);
    askWho();
  }
}

async function boot() {
  $('#who-btn').addEventListener('click', askWho);
  subscribe((what) => {
    // Si el encargado retiró a esta persona, se le vuelve a preguntar (una vez).
    // Al arrancar lo hace start(), cuando la pantalla ya está pintada.
    if (what === 'bootstrap' && syncWho() && started) {
      store.set('whoAsked', true);
      askWhoWhenFree();
    }
    renderHeader();
  });
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
