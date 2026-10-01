// Rutas de la API con Request/Response estándar: el mismo código sirve en
// Cloudflare Workers (worker.js) y en Node (index.js).
import * as svc from './services.js';
import * as alm from './almacen.js';
import * as viaje from './viaje.js';

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
};

const json = (status, body, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
});

const encoder = new TextEncoder();
async function sameSecret(given, expected) {
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(String(given ?? ''))),
    crypto.subtle.digest('SHA-256', encoder.encode(String(expected))),
  ]);
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

function decodeDataUrl(data) {
  const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(data || '');
  if (!m) throw new svc.HttpError(400, 'Imagen no válida (JPEG, PNG o WebP).');
  const bin = atob(m[2]);
  if (bin.length > 1.5 * 1024 * 1024) throw new svc.HttpError(413, 'La imagen es demasiado grande.');
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { mime: `image/${m[1]}`, data: bytes };
}

/**
 * @param {object} opts
 * @param {(reqCtx: object) => Promise<object>} opts.getDb  adaptador de base de datos listo para usar
 * @param {object} opts.env  variables de entorno (STAFF_CODE, MANAGER_PIN)
 * @returns {(request: Request, reqCtx?: object) => Promise<Response|null>}  null si la ruta no es de la API
 */
export function createHandler({ getDb, env = {}, log = console }) {
  // Límite sencillo de intentos fallidos por IP (por instancia).
  const failures = new Map();
  const blocked = (ip) => {
    const f = failures.get(ip);
    return f && f.count >= 10 && Date.now() - f.first < 10 * 60000;
  };
  const fail = (ip) => {
    const f = failures.get(ip);
    if (!f || Date.now() - f.first > 10 * 60000) failures.set(ip, { count: 1, first: Date.now() });
    else f.count += 1;
    if (failures.size > 5000) failures.clear();
  };

  async function secrets(db) {
    const s = await svc.getSettings(db);
    return { staff: env.STAFF_CODE || s.staff_code || '', manager: env.MANAGER_PIN || s.manager_pin || '' };
  }

  async function auth(db, request, level) {
    const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'local';
    if (blocked(ip)) throw new svc.HttpError(429, 'Demasiados intentos. Espera unos minutos.');
    const { staff, manager } = await secrets(db);
    const code = request.headers.get('x-access-code');
    const pin = request.headers.get('x-manager-pin');
    const isManager = !manager || (pin && await sameSecret(pin, manager));
    const isStaff = !staff || (code && await sameSecret(code, staff)) || (manager && pin && isManager);
    if (level === 'manager' && !isManager) {
      if (pin) fail(ip);
      throw new svc.HttpError(pin ? 403 : 401, pin ? 'PIN de encargado incorrecto.' : 'Hace falta el PIN de encargado.');
    }
    if (!isStaff) {
      if (code) fail(ip);
      throw new svc.HttpError(401, code ? 'Código de acceso incorrecto.' : 'Hace falta el código de acceso.');
    }
  }

  const q = (url) => Object.fromEntries(url.searchParams);

  // [método, patrón, nivel ('open' | 'staff' | 'manager'), manejador]
  const routes = [
    ['GET', '/api/auth', 'open', async ({ db }) => {
      const { staff, manager } = await secrets(db);
      return { accessRequired: Boolean(staff), managerRequired: Boolean(manager) };
    }],
    ['POST', '/api/auth/check', 'staff', () => ({ ok: true })],
    ['POST', '/api/auth/manager', 'manager', () => ({ ok: true })],

    ['GET', '/api/bootstrap', 'staff', async ({ db }) => {
      const { manager } = await secrets(db);
      return svc.bootstrap(db, { managerRequired: Boolean(manager) });
    }],
    ['GET', '/api/live', 'staff', ({ db }) => svc.liveState(db)],
    ['GET', '/api/almacen', 'staff', ({ db, url }) => alm.almacen(db, q(url))],
    ['GET', '/api/almacen/botella/:id', 'staff', ({ db, id, url }) => alm.almacenBotella(db, id, q(url))],
    ['POST', '/api/almacen/recuentos', 'staff', ({ db, body }) => alm.saveCounts(db, body)],
    ['POST', '/api/almacen/roturas', 'staff', ({ db, body }) => alm.addBreakage(db, body)],
    ['POST', '/api/almacen/entradas', 'staff', ({ db, body }) => alm.addEntries(db, body)],
    ['GET', '/api/almacen/viaje', 'staff', ({ db }) => viaje.tripView(db)],
    ['POST', '/api/almacen/viaje/lineas', 'staff', ({ db, body }) => viaje.addTripLine(db, body)],
    ['POST', '/api/almacen/viaje/sugerido', 'staff', ({ db, body }) => viaje.addSuggested(db, body)],
    ['POST', '/api/almacen/viaje/hecho', 'staff', ({ db, body }) => viaje.finishTrip(db, body)],
    ['PUT', '/api/almacen/viaje/lineas/:id', 'staff', ({ db, id, body }) => viaje.updateTripLine(db, id, body)],
    ['POST', '/api/almacen/viaje/lineas/:id/quitar', 'staff', ({ db, id, body }) => viaje.removeTripLine(db, id, body)],
    ['POST', '/api/requests', 'staff', ({ db, body }) => svc.createRequest(db, body)],
    ['POST', '/api/complete', 'staff', ({ db, body }) => svc.completeLines(db, body)],
    ['POST', '/api/lines/:id/deliver', 'staff', ({ db, id, body }) => svc.deliver(db, id, body)],
    ['POST', '/api/lines/:id/claim', 'staff', ({ db, id, body }) => svc.claimLine(db, id, body)],
    ['POST', '/api/lines/:id/cancel', 'staff', ({ db, id, body }) => svc.cancelPending(db, id, body)],
    ['POST', '/api/deliveries/:id/undo', 'staff', ({ db, id, body }) => svc.undoDelivery(db, id, body)],
    ['POST', '/api/products/:id/stock', 'staff', ({ db, id, body }) => svc.setOutOfStock(db, id, body.out_of_stock, { by: body.by })],

    // Rutas literales antes que las de :id.
    ['GET', '/api/products', 'manager', ({ db }) => svc.listProducts(db, { all: true })],
    ['PUT', '/api/products/order', 'manager', ({ db, body }) => svc.orderProducts(db, body)],
    ['POST', '/api/products', 'manager', ({ db, body }) => svc.createProduct(db, body, { by: body.by })],
    ['PUT', '/api/products/:id', 'manager', ({ db, id, body }) => svc.updateProduct(db, id, body, { by: body.by, reason: body.reason })],
    ['POST', '/api/products/:id/resolve', 'manager', ({ db, id, body }) => svc.resolveUnidentified(db, id, body, { by: body.by })],
    ['POST', '/api/products/:id/photo', 'manager', ({ db, id, body }) => svc.setProductPhoto(db, id, decodeDataUrl(body.data), { by: body.by })],
    ['DELETE', '/api/products/:id/photo', 'manager', ({ db, id, url }) => svc.removeProductPhoto(db, id, { by: url.searchParams.get('by') })],

    ['GET', '/api/staff', 'manager', ({ db }) => svc.listStaff(db, { all: true })],
    ['POST', '/api/staff', 'manager', ({ db, body }) => svc.createStaff(db, body, { by: body.by })],
    ['PUT', '/api/staff/order', 'manager', ({ db, body }) => svc.orderStaff(db, body, { by: body.by })],
    ['PUT', '/api/staff/:id', 'manager', ({ db, id, body }) => svc.updateStaff(db, id, body, { by: body.by })],
    ['POST', '/api/groups', 'manager', ({ db, body }) => svc.createGroup(db, body, { by: body.by })],
    ['PUT', '/api/groups/order', 'manager', ({ db, body }) => svc.orderGroups(db, body, { by: body.by })],
    ['PUT', '/api/groups/:id', 'manager', ({ db, id, body }) => svc.renameGroup(db, id, body, { by: body.by })],
    ['DELETE', '/api/groups/:id', 'manager', ({ db, id, url }) => svc.deleteGroup(db, id, {
      move_to: url.searchParams.get('move_to') ?? undefined, by: url.searchParams.get('by'),
    })],

    ['GET', '/api/report', 'manager', ({ db, url }) => svc.report(db, q(url))],
    ['GET', '/api/informe', 'manager', ({ db, url }) => svc.informe(db, q(url))],
    ['GET', '/api/informe/botella/:id', 'manager', ({ db, id, url }) => svc.informeBotella(db, id, q(url))],
    ['GET', '/api/deliveries', 'manager', ({ db, url }) => svc.listDeliveries(db, q(url))],
    ['POST', '/api/deliveries', 'manager', ({ db, body }) => svc.addManualDelivery(db, body)],
    ['PUT', '/api/deliveries/:id', 'manager', ({ db, id, body }) => svc.correctDelivery(db, id, body)],
    ['GET', '/api/sessions', 'manager', ({ db, url }) => svc.listSessions(db, {
      from: url.searchParams.get('from') || '0000-01-01', to: url.searchParams.get('to') || '9999-12-31',
    })],
    ['PUT', '/api/sessions/:id', 'manager', ({ db, id, body }) => svc.updateSession(db, id, body, { by: body.by })],
    ['POST', '/api/forecast', 'manager', ({ db, body }) => svc.forecast(db, body)],
    ['GET', '/api/purchases', 'manager', ({ db }) => svc.listPurchases(db)],
    ['GET', '/api/purchases/:id', 'manager', ({ db, id }) => svc.getPurchase(db, id)],
    ['POST', '/api/purchases', 'manager', ({ db, body }) => svc.savePurchase(db, null, body, { by: body.by })],
    ['PUT', '/api/purchases/:id', 'manager', ({ db, id, body }) => svc.savePurchase(db, id, body, { by: body.by })],
    ['DELETE', '/api/purchases/:id', 'manager', ({ db, id, url }) => svc.deletePurchase(db, id, { by: url.searchParams.get('by') })],
    ['GET', '/api/audit', 'manager', ({ db, url }) => svc.listAudit(db, q(url))],
    ['GET', '/api/settings', 'manager', async ({ db }) => {
      const { staff, manager } = await secrets(db);
      return {
        ...await svc.publicSettings(db),
        bars: await svc.listBars(db),
        stores: await db.all('SELECT id, name, kind FROM stores ORDER BY sort, id'),
        staffCodeFromEnv: Boolean(env.STAFF_CODE),
        managerPinFromEnv: Boolean(env.MANAGER_PIN),
        staffCodeSet: Boolean(staff),
        managerPinSet: Boolean(manager),
      };
    }],
    ['PUT', '/api/settings', 'manager', ({ db, body }) => svc.updateSettings(db, body, { by: body.by })],
    ['GET', '/api/backup', 'manager', async ({ db }) => {
      const data = await svc.exportData(db);
      const stamp = data.exported_at.slice(0, 16).replace(/[T:]/g, '-');
      return new Response(JSON.stringify(data), {
        headers: {
          ...SECURITY_HEADERS,
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': `attachment; filename="reposicion-${stamp}.json"`,
          'Cache-Control': 'no-store',
        },
      });
    }],
  ].map(([method, pattern, level, handler]) => ({
    method, level, handler,
    regex: new RegExp(`^${pattern.replace(/:id/g, '(\\d+)')}$`),
  }));

  async function readBody(request) {
    if (!['POST', 'PUT'].includes(request.method)) return {};
    if (Number(request.headers.get('content-length') || 0) > 3 * 1024 * 1024) {
      throw new svc.HttpError(413, 'Petición demasiado grande.');
    }
    const text = await request.text();
    if (text.length > 3 * 1024 * 1024) throw new svc.HttpError(413, 'Petición demasiado grande.');
    if (!text) return {};
    try {
      const body = JSON.parse(text);
      return body && typeof body === 'object' ? body : {};
    } catch {
      throw new svc.HttpError(400, 'JSON no válido.');
    }
  }

  // Errores de Postgres que no son fallos del servidor sino cambios simultáneos.
  const PG_ERRORS = {
    '40P01': 'Otra persona ha cambiado esto a la vez. Inténtalo de nuevo.',
    40001: 'Otra persona ha cambiado esto a la vez. Inténtalo de nuevo.',
    23503: 'Algo ha cambiado mientras tanto: recarga e inténtalo de nuevo.',
    23505: 'Ya existe un elemento con ese nombre.',
  };

  return async function handle(request, reqCtx = {}) {
    const url = new URL(request.url);
    const { pathname } = url;
    const photo = /^\/photos\/(\d+)$/.exec(pathname);
    if (!pathname.startsWith('/api/') && !photo) return null;
    try {
      const db = await getDb(reqCtx);
      if (photo) {
        const p = await svc.getPhoto(db, Number(photo[1]));
        if (!p) return json(404, { error: 'Foto no encontrada.' });
        return new Response(p.data, {
          headers: { ...SECURITY_HEADERS, 'Content-Type': p.mime, 'Cache-Control': 'public, max-age=31536000, immutable' },
        });
      }
      const route = routes.find((r) => r.method === request.method && r.regex.test(pathname));
      if (!route) throw new svc.HttpError(404, 'Ruta no encontrada.');
      if (route.level !== 'open') await auth(db, request, route.level);
      const match = route.regex.exec(pathname);
      const body = await readBody(request);
      const result = await route.handler({ db, id: match[1] ? Number(match[1]) : null, body, url });
      if (result instanceof Response) return result;
      return json(200, result ?? { ok: true });
    } catch (err) {
      if (err instanceof svc.HttpError) return json(err.status, { error: err.message });
      if (PG_ERRORS[err?.code]) return json(409, { error: PG_ERRORS[err.code] });
      log.error?.(err);
      return json(500, { error: 'Error interno del servidor.' });
    }
  };
}
