// Estado compartido entre pantallas.
import { get, store } from './api.js';
import { imageFor, setManifest, fmt, plural } from './ui.js';

export const state = {
  bars: [],
  stores: [],
  categories: [],
  products: [],
  groups: [],
  sections: [],
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

/** Los grupos (con productos) de una sección, en su orden. Sin sección guardada, alcohol. */
export const sectionGroups = (sectionId) => selection().filter((g) => (g.group.section ?? 'alcohol') === sectionId);

/** Unidades que suma un toque: una caja entera en los productos por caja; si no, 1. */
export const orderStep = (p) => (p?.order_unit === 'caja' && p.per_case > 0 ? p.per_case : 1);

/**
 * Cantidad (en unidades) como se pide: «2 cajas», «1 caja + 3», «5 unidades»,
 * «3 bolsas», «4 botellas». `p` es un producto o una línea de la lista.
 */
export function qtyText(n, p) {
  if (p?.order_unit === 'bolsa') return plural(n, 'bolsa', 'bolsas');
  if (p?.order_unit === 'caja' && p.per_case > 0) {
    const full = Math.floor(n / p.per_case);
    const loose = n % p.per_case;
    if (!full) return plural(n, 'unidad', 'unidades');
    return loose ? `${plural(full, 'caja', 'cajas')} + ${fmt(loose)}` : plural(full, 'caja', 'cajas');
  }
  return plural(n, 'botella', 'botellas');
}

/** «2 cajas · 5 botellas · 1 bolsa» para [{ p, qty }], sin mezclar unidades. */
export function unitSummary(lines) {
  const t = { caja: 0, botella: 0, bolsa: 0, unidad: 0 };
  for (const { p, qty } of lines) {
    if (p?.order_unit === 'bolsa') t.bolsa += qty;
    else if (p?.order_unit === 'caja' && p.per_case > 0) {
      t.caja += Math.floor(qty / p.per_case);
      t.unidad += qty % p.per_case;
    } else t.botella += qty;
  }
  return [
    t.caja && plural(t.caja, 'caja', 'cajas'),
    t.botella && plural(t.botella, 'botella', 'botellas'),
    t.unidad && plural(t.unidad, 'unidad', 'unidades'),
    t.bolsa && plural(t.bolsa, 'bolsa', 'bolsas'),
  ].filter(Boolean).join(' · ') || '0';
}

/** Verbo en singular o plural según la cantidad: «Falta 1 botella», «Quedan 2 cajas · 1 bolsa». */
export const withVerb = (one, many, text) => `${/^1 [^+·]*$/.test(text) ? one : many} ${text}`;
export const faltan = (text) => withVerb('Falta', 'Faltan', text);

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
    groups: b.groups || [], sections: b.sections || [], staff: b.staff || [], stores: b.stores || [], catalogRev: b.catalog_rev ?? 0,
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
let serverOffsetMs = 0;

/** Hora del servidor estimada al guardar un recuento, también sin conexión. */
export const countTime = () => new Date(Date.now() + serverOffsetMs).toISOString();

export async function loadLive() {
  const started = Date.now();
  const live = await get('/api/live');
  const received = Date.now();
  if (live.server_time) {
    const serverTime = Date.parse(live.server_time);
    if (Number.isFinite(serverTime)) serverOffsetMs = serverTime - (started + received) / 2;
    delete live.server_time;
  }
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

/** Almacén del local (el que abastece las barras), según los datos. */
export const localStore = () => state.stores.find((s) => s.kind === 'local') ?? null;

/** Almacén grande, fuera del local (de donde salen los viajes en coche). */
export const centralStore = () => state.stores.find((s) => s.kind === 'central') ?? null;

export const outStore = centralStore;
export const inVesselPoints = () => state.stores.filter((s) => s.in_vessel === 1).sort((a, b) => a.sort - b.sort);
export const pointByKey = (key) => inVesselPoints().find((s) => s.map_key === key) ?? null;
export const POINT_TYPE_LABEL = { almacen: 'Almacén', nevera: 'Nevera', barra: 'Barra' };

export const storeById = (id) => state.stores.find((s) => s.id === Number(id)) ?? null;

/** Botellas en el almacén del local, o null si esa botella no se ha contado nunca. */
export function stockFor(productId) {
  const v = state.live.stock?.[productId];
  return typeof v === 'number' ? v : null;
}

/**
 * Agotado: marcado a mano, o contado en almacén y sin botellas.
 * Acepta un producto o una línea de la lista (con product_id).
 */
export function isOut(x) {
  if (x.out_of_stock) return true;
  const n = stockFor(x.product_id ?? x.id);
  return n !== null && n <= 0;
}

/** { full, loose } si la botella tiene botellas por caja; si no, null. */
export function caseParts(n, perCase) {
  return perCase > 0 ? { full: Math.floor(n / perCase), loose: n % perCase } : null;
}

/** «3 cajas + 4», «3 cajas» o «22 botellas» (menos de una caja: «2 botellas», nunca «0 cajas + 2»). */
export function stockText(n, perCase) {
  const c = caseParts(n, perCase);
  if (!c || !c.full) return plural(n, 'botella', 'botellas');
  const full = plural(c.full, 'caja', 'cajas');
  return c.loose ? `${full} + ${fmt(c.loose)}` : full;
}

/** Botellas pendientes de un producto en una barra en la noche actual. */
export function pendingFor(productId, barId) {
  return state.live.lines
    .filter((l) => l.product_id === productId && (!barId || l.bar_id === barId))
    .reduce((a, l) => a + l.qty_pending, 0);
}
