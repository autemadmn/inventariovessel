// Estado compartido entre pantallas.
import { get, store } from './api.js';

export const state = {
  bars: [],
  categories: [],
  products: [],
  settings: {},
  date: null,
  managerRequired: false,
  live: { lines: [], recent: [] },
  who: store.get('who', ''),
  bar: store.get('bar', null),
  carts: store.get('carts', {}), // { barId: { productId: qty } }
};

const listeners = new Set();
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function notify(what) {
  for (const fn of listeners) fn(what);
}

export function setWho(name) {
  state.who = name.trim().slice(0, 40);
  store.set('who', state.who);
}

export function setBar(id) {
  state.bar = id;
  store.set('bar', id);
}

export function cart(barId = state.bar) {
  state.carts[barId] ??= {};
  return state.carts[barId];
}

export function saveCarts() {
  store.set('carts', state.carts);
}

export const productById = (id) => state.products.find((p) => p.id === Number(id));
export const barName = (id) => state.bars.find((b) => b.id === Number(id))?.name ?? `Barra ${id}`;

export async function loadBootstrap() {
  const b = await get('/api/bootstrap');
  Object.assign(state, {
    bars: b.bars, categories: b.categories, products: b.products,
    settings: b.settings, date: b.date, managerRequired: b.managerRequired,
  });
  // Quitar del carrito productos que ya no están en el catálogo.
  for (const c of Object.values(state.carts)) {
    for (const pid of Object.keys(c)) if (!productById(pid)) delete c[pid];
  }
  notify('bootstrap');
}

export async function loadLive() {
  state.live = await get('/api/live');
  state.date = state.live.date;
  notify('live');
}

/** Botellas pendientes de un producto en una barra en la noche actual. */
export function pendingFor(productId, barId) {
  return state.live.lines
    .filter((l) => l.product_id === productId && (!barId || l.bar_id === barId))
    .reduce((a, l) => a + l.qty_pending, 0);
}
