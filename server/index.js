// Servidor para Node (uso local o en un servidor propio). En Cloudflare se usa worker.js.
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { openNodeDb } from './db-node.js';
import { ensureSchema } from './schema.js';
import { createHandler } from './handler.js';

const ROOT = resolve(import.meta.dirname, '..');
const PUBLIC = join(ROOT, 'public');
const dataDir = resolve(process.env.DATA_DIR || join(ROOT, 'data'));
const port = Number(process.env.PORT) || 3000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

const db = openNodeDb(join(dataDir, 'inventario.db'));
await ensureSchema(db);
const handle = createHandler({ getDb: async () => db, env: process.env });

function serveFile(res, file) {
  let st;
  try {
    st = statSync(file);
  } catch {
    return false;
  }
  if (!st.isFile()) return false;
  res.writeHead(200, {
    'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
    'Content-Length': st.size,
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self'; style-src-attr 'unsafe-inline'; script-src 'self'; connect-src 'self'",
  });
  createReadStream(file).pipe(res);
  return true;
}

async function toRequest(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
  const body = chunks.length && !['GET', 'HEAD'].includes(req.method) ? Buffer.concat(chunks) : undefined;
  return new Request(`http://localhost${req.url}`, { method: req.method, headers, body });
}

const server = createServer(async (req, res) => {
  try {
    const response = await handle(await toRequest(req));
    if (response) {
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }
    const { pathname } = new URL(req.url, 'http://localhost');
    const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1));
    const file = normalize(join(PUBLIC, rel));
    if (file.startsWith(PUBLIC + sep) && serveFile(res, file)) return;
    // Cualquier otra ruta sin extensión: la aplicación (igual que en Cloudflare).
    if (!extname(pathname) && serveFile(res, join(PUBLIC, 'index.html'))) return;
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('No encontrado');
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  }
});

server.listen(port, () => {
  console.log(`Reposición de barras en http://localhost:${port} (datos en ${dataDir})`);
  if (!process.env.STAFF_CODE) console.warn('Aviso: sin STAFF_CODE, cualquiera con la dirección podrá entrar (se puede fijar en Ajustes).');
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => server.close(() => {
    db.close();
    process.exit(0);
  }));
}
