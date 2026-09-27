import { createReadStream, existsSync, mkdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { backup } from 'node:sqlite';
import { createHash, timingSafeEqual } from 'node:crypto';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATEGORIES } from './catalog.js';
import * as svc from './services.js';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PUBLIC = join(ROOT, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self'; style-src-attr 'unsafe-inline'; script-src 'self'; connect-src 'self'",
};

function sameSecret(given, expected) {
  const a = createHash('sha256').update(String(given ?? '')).digest();
  const b = createHash('sha256').update(String(expected)).digest();
  return timingSafeEqual(a, b);
}

export function createApp(db, { dataDir, env = process.env, log = console } = {}) {
  const uploads = join(dataDir, 'uploads');
  mkdirSync(uploads, { recursive: true });

  const clients = new Set();
  let rev = 0;
  const broadcast = () => {
    rev += 1;
    for (const res of clients) res.write(`data: ${JSON.stringify({ rev })}\n\n`);
  };
  const heartbeat = setInterval(() => {
    for (const res of clients) res.write(': ping\n\n');
  }, 25000);
  heartbeat.unref();

  const secrets = () => {
    const s = svc.getSettings(db);
    return { staff: env.STAFF_CODE || s.staff_code || '', manager: env.MANAGER_PIN || s.manager_pin || '' };
  };
  if (!secrets().staff) log.warn?.('Aviso: no hay código de acceso (STAFF_CODE). Cualquiera con la dirección podrá entrar.');
  if (!secrets().manager) log.warn?.('Aviso: no hay PIN de encargado (MANAGER_PIN). La gestión queda abierta.');

  // Límite sencillo de intentos fallidos por IP.
  const failures = new Map();
  const blocked = (ip) => {
    const f = failures.get(ip);
    return f && f.count >= 10 && Date.now() - f.first < 10 * 60000;
  };
  const fail = (ip) => {
    const f = failures.get(ip);
    if (!f || Date.now() - f.first > 10 * 60000) failures.set(ip, { count: 1, first: Date.now() });
    else f.count += 1;
  };

  function auth(req, url, level) {
    const ip = req.socket.remoteAddress;
    const { staff, manager } = secrets();
    const code = req.headers['x-access-code'] ?? url.searchParams.get('code');
    const pin = req.headers['x-manager-pin'];
    if (blocked(ip)) throw new svc.HttpError(429, 'Demasiados intentos. Espera unos minutos.');
    const isManager = !manager || (pin && sameSecret(pin, manager));
    const isStaff = !staff || (code && sameSecret(code, staff)) || (manager && isManager);
    if (level === 'manager' && !isManager) {
      if (pin) fail(ip);
      throw new svc.HttpError(pin ? 403 : 401, pin ? 'PIN de encargado incorrecto.' : 'Hace falta el PIN de encargado.');
    }
    if (!isStaff) {
      if (code) fail(ip);
      throw new svc.HttpError(401, code ? 'Código de acceso incorrecto.' : 'Hace falta el código de acceso.');
    }
  }

  // [método, patrón, nivel ('open' | 'staff' | 'manager'), manejador]
  const routes = [
    ['GET', '/api/auth', 'open', () => {
      const { staff, manager } = secrets();
      return { accessRequired: Boolean(staff), managerRequired: Boolean(manager) };
    }],
    ['POST', '/api/auth/check', 'staff', () => ({ ok: true })],
    ['POST', '/api/auth/manager', 'manager', () => ({ ok: true })],

    ['GET', '/api/bootstrap', 'staff', () => ({
      bars: svc.listBars(db),
      categories: CATEGORIES,
      products: svc.listProducts(db),
      settings: svc.publicSettings(db),
      date: svc.currentDate(db),
      managerRequired: Boolean(secrets().manager),
    })],
    ['GET', '/api/live', 'staff', () => svc.liveState(db)],
    ['POST', '/api/requests', 'staff', ({ body }) => svc.createRequest(db, body)],
    ['POST', '/api/lines/:id/deliver', 'staff', ({ id, body }) => svc.deliver(db, id, body)],
    ['POST', '/api/lines/:id/claim', 'staff', ({ id, body }) => svc.claimLine(db, id, body)],
    ['POST', '/api/lines/:id/cancel', 'staff', ({ id, body }) => svc.cancelPending(db, id, body)],
    ['POST', '/api/deliveries/:id/undo', 'staff', ({ id, body }) => svc.undoDelivery(db, id, body)],
    ['POST', '/api/products/:id/stock', 'staff', ({ id, body }) => svc.setOutOfStock(db, id, body.out_of_stock, { by: body.by })],

    ['GET', '/api/products', 'manager', () => svc.listProducts(db, { all: true })],
    ['POST', '/api/products', 'manager', ({ body }) => svc.createProduct(db, body, { by: body.by })],
    ['PUT', '/api/products/:id', 'manager', ({ id, body }) => svc.updateProduct(db, id, body, { by: body.by, reason: body.reason })],
    ['POST', '/api/products/:id/resolve', 'manager', ({ id, body }) => svc.resolveUnidentified(db, id, body, { by: body.by })],
    ['POST', '/api/products/:id/photo', 'manager', ({ id, body }) => savePhoto(id, body)],
    ['DELETE', '/api/products/:id/photo', 'manager', ({ id, url }) => {
      const r = svc.setProductPhoto(db, id, null, { by: url.searchParams.get('by') });
      removeUpload(r.previous);
      return r.product;
    }],

    ['GET', '/api/report', 'manager', ({ url }) => svc.report(db, Object.fromEntries(url.searchParams))],
    ['GET', '/api/deliveries', 'manager', ({ url }) => svc.listDeliveries(db, Object.fromEntries(url.searchParams))],
    ['POST', '/api/deliveries', 'manager', ({ body }) => svc.addManualDelivery(db, body)],
    ['PUT', '/api/deliveries/:id', 'manager', ({ id, body }) => svc.correctDelivery(db, id, body)],
    ['GET', '/api/sessions', 'manager', ({ url }) => svc.listSessions(db, {
      from: url.searchParams.get('from') || '0000-01-01', to: url.searchParams.get('to') || '9999-12-31',
    })],
    ['PUT', '/api/sessions/:id', 'manager', ({ id, body }) => svc.updateSession(db, id, body, { by: body.by })],
    ['POST', '/api/forecast', 'manager', ({ body }) => svc.forecast(db, body)],
    ['GET', '/api/purchases', 'manager', () => svc.listPurchases(db)],
    ['GET', '/api/purchases/:id', 'manager', ({ id }) => svc.getPurchase(db, id)],
    ['POST', '/api/purchases', 'manager', ({ body }) => svc.savePurchase(db, null, body, { by: body.by })],
    ['PUT', '/api/purchases/:id', 'manager', ({ id, body }) => svc.savePurchase(db, id, body, { by: body.by })],
    ['DELETE', '/api/purchases/:id', 'manager', ({ id }) => svc.deletePurchase(db, id)],
    ['GET', '/api/audit', 'manager', ({ url }) => svc.listAudit(db, Object.fromEntries(url.searchParams))],
    ['GET', '/api/settings', 'manager', () => ({
      ...svc.publicSettings(db),
      bars: svc.listBars(db),
      staffCodeFromEnv: Boolean(env.STAFF_CODE),
      managerPinFromEnv: Boolean(env.MANAGER_PIN),
      staffCodeSet: Boolean(secrets().staff),
      managerPinSet: Boolean(secrets().manager),
    })],
    ['PUT', '/api/settings', 'manager', ({ body }) => svc.updateSettings(db, body, { by: body.by })],
  ].map(([method, pattern, level, handler]) => ({
    method, level, handler,
    regex: new RegExp(`^${pattern.replace(/:id/g, '(\\d+)')}$`),
  }));

  function savePhoto(id, { data, by }) {
    const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(data || '');
    if (!m) throw new svc.HttpError(400, 'Imagen no válida (JPEG, PNG o WebP).');
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > 1.5 * 1024 * 1024) throw new svc.HttpError(413, 'La imagen es demasiado grande.');
    const file = `p${id}-${Date.now()}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`;
    writeFileSync(join(uploads, file), buf);
    const r = svc.setProductPhoto(db, id, `/uploads/${file}`, { by });
    removeUpload(r.previous);
    return r.product;
  }

  function removeUpload(path) {
    if (!path?.startsWith('/uploads/')) return;
    const file = join(uploads, path.slice('/uploads/'.length));
    if (file.startsWith(uploads + sep) && existsSync(file)) unlinkSync(file);
  }

  function send(res, status, body, headers = {}) {
    res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store', ...headers });
    res.end(JSON.stringify(body));
  }

  function serveFile(res, file, cache) {
    let st;
    try {
      st = statSync(file);
    } catch {
      return false;
    }
    if (!st.isFile()) return false;
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': cache,
    });
    createReadStream(file).pipe(res);
    return true;
  }

  function serveStatic(res, pathname) {
    if (pathname === '/js/shared/forecast.js') {
      return serveFile(res, join(ROOT, 'server', 'forecast.js'), 'no-cache');
    }
    if (pathname.startsWith('/uploads/')) {
      const file = normalize(join(uploads, decodeURIComponent(pathname.slice(9))));
      return file.startsWith(uploads + sep) && serveFile(res, file, 'public, max-age=31536000, immutable');
    }
    const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1));
    const file = normalize(join(PUBLIC, rel));
    if (!file.startsWith(PUBLIC + sep)) return false;
    return serveFile(res, file, 'no-cache');
  }

  async function readBody(req) {
    const chunks = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > 3 * 1024 * 1024) throw new svc.HttpError(413, 'Petición demasiado grande.');
      chunks.push(c);
    }
    if (!size) return {};
    try {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      return body && typeof body === 'object' ? body : {};
    } catch {
      throw new svc.HttpError(400, 'JSON no válido.');
    }
  }

  const handler = async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const { pathname } = url;
    try {
      if (pathname === '/api/stream') {
        auth(req, url, 'staff');
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-store',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        });
        res.write(`data: ${JSON.stringify({ rev })}\n\n`);
        clients.add(res);
        req.on('close', () => clients.delete(res));
        return;
      }
      if (pathname === '/api/backup' && req.method === 'GET') {
        auth(req, url, 'manager');
        const file = join(dataDir, `backup-${Date.now()}.db`);
        await backup(db, file);
        const stamp = new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-');
        res.writeHead(200, {
          ...SECURITY_HEADERS,
          'Content-Type': 'application/vnd.sqlite3',
          'Content-Disposition': `attachment; filename="reposicion-${stamp}.db"`,
          'Cache-Control': 'no-store',
        });
        const stream = createReadStream(file);
        stream.pipe(res);
        stream.on('close', () => unlinkSync(file));
        return;
      }
      if (pathname.startsWith('/api/')) {
        const route = routes.find((r) => r.method === req.method && r.regex.test(pathname));
        if (!route) throw new svc.HttpError(404, 'Ruta no encontrada.');
        if (route.level !== 'open') auth(req, url, route.level);
        const match = route.regex.exec(pathname);
        const body = ['POST', 'PUT'].includes(req.method) ? await readBody(req) : {};
        const result = route.handler({ id: match[1] ? Number(match[1]) : null, body, url, req });
        if (req.method !== 'GET') broadcast();
        return send(res, 200, result ?? { ok: true });
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new svc.HttpError(405, 'Método no permitido.');
      if (serveStatic(res, pathname)) return;
      // Rutas de la aplicación (#/…) y cualquier otra: la página principal.
      if (!extname(pathname) && serveFile(res, join(PUBLIC, 'index.html'), 'no-cache')) return;
      throw new svc.HttpError(404, 'No encontrado.');
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) log.error?.(err);
      if (!res.headersSent) send(res, status, { error: status >= 500 ? 'Error interno del servidor.' : err.message });
      else res.end();
    }
  };

  handler.close = () => {
    clearInterval(heartbeat);
    for (const res of clients) res.end();
    clients.clear();
  };
  return handler;
}
