// Estado compartido entre pantallas.
import { get, store } from './api.js';
import { imageFor, setManifest } from './ui.js';

export const state = {
  bars: [],
  categories: [],
  products: [],
  groups: [],
  staff: [],
  catalogRev: 0,
  settings: {},
  date: null,
  managerRequired: false,
  live: { lines: [], recent: [] },
  who: store.get('who', ''),
  whoId: store.get('whoId', null),
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

/** Guarda quién usa este dispositivo. `id` es null si se escribió a mano. */
export function setWho(name, id = null) {
  state.who = name.trim().slice(0, 40);
  state.whoId = id;
  store.set('who', state.who);
  store.set('whoId', id);
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
export const groupById = (id) => state.groups.find((g) => g.id === Number(id));

/** Productos de un grupo en su orden (group_order y luego id). */
export const groupProducts = (groupId) => state.products
  .filter((p) => p.group_id === groupId)
  .sort((a, b) => (a.group_order ?? 1e9) - (b.group_order ?? 1e9) || a.id - b.id);

/** La selección: [{ group, products }] en el orden de los grupos, sin grupos vacíos. */
export function selection() {
  return state.groups
    .map((group) => ({ group, products: groupProducts(group.id) }))
    .filter((g) => g.products.length);
}

/** Imágenes de catálogo: una sola vez; si falla, la app sigue sin ellas. */
export async function loadManifest() {
  try {
    const res = await fetch('/img/botellas/manifest.json');
    setManifest(res.ok ? await res.json() : {});
  } catch {
    setManifest({});
  }
}

export async function loadBootstrap() {
  const b = await get('/api/bootstrap');
  Object.assign(state, {
    bars: b.bars, categories: b.categories, products: b.products,
    groups: b.groups || [], staff: b.staff || [], catalogRev: b.catalog_rev ?? 0,
    settings: b.settings, date: b.date, managerRequired: b.managerRequired,
  });
  for (const p of state.products) p.image = imageFor(p.slug);
  // Quitar del carrito productos que ya no están en el catálogo.
  for (const c of Object.values(state.carts)) {
    for (const pid of Object.keys(c)) if (!productById(pid)) delete c[pid];
  }
  notify('bootstrap');
}

let lastLive = '';
let reloading = null;

export async function loadLive() {
  const live = await get('/api/live');
  // El encargado cambió el catálogo: se recarga ya, sin esperar al minuto.
  if (typeof live.catalog_rev === 'number' && live.catalog_rev !== state.catalogRev) {
    reloading ??= loadBootstrap().finally(() => { reloading = null; });
    await reloading;
  }
  // Si nada ha cambiado no se redibuja (evita parpadeos y toques perdidos).
  const text = JSON.stringify(live);
  if (text === lastLive) return;
  lastLive = text;
  state.live = live;
  state.date = state.live.date;
  // «Agotado en almacén» cambia desde otros dispositivos: se refleja al momento.
  const out = new Set(state.live.outOfStock || []);
  for (const p of state.products) p.out_of_stock = out.has(p.id) ? 1 : 0;
  notify('live');
}

/** Botellas pendientes de un producto en una barra en la noche actual. */
export function pendingFor(productId, barId) {
  return state.live.lines
    .filter((l) => l.product_id === productId && (!barId || l.bar_id === barId))
    .reduce((a, l) => a + l.qty_pending, 0);
}
