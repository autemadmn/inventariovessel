// Adaptador para PGlite (Postgres en proceso) en desarrollo local y en los
// tests. Misma interfaz que db-pg.js. Solo se importa desde Node, nunca desde
// worker.js. PGlite tiene una única sesión: un mutex propio garantiza que
// ninguna consulta ajena se cuele dentro de una transacción abierta.
import { PGlite } from '@electric-sql/pglite';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { normArgs, runAll, toPg } from './sql.js';

export const MIGRATIONS_DIR = resolve(import.meta.dirname, '..', 'supabase', 'migrations');

export function migrationFiles() {
  return readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()
    .map((f) => join(MIGRATIONS_DIR, f));
}

function mutex() {
  let last = Promise.resolve();
  return (fn) => {
    const run = last.then(fn, fn);
    last = run.catch(() => {});
    return run;
  };
}

function wrap(q) {
  const query = (sql, args) => q.query(toPg(sql), normArgs(args));
  const t = {
    async all(sql, ...args) {
      return Array.from((await query(sql, args)).rows);
    },
    async get(sql, ...args) {
      return (await query(sql, args)).rows[0] ?? null;
    },
    async run(sql, ...args) {
      const r = await query(sql, args);
      return { changes: r.affectedRows ?? 0, lastId: r.rows[0]?.id ?? null };
    },
    batch(stmts) {
      return runAll(t, stmts);
    },
  };
  return t;
}

/**
 * Abre PGlite y aplica las migraciones de supabase/migrations (idempotentes).
 * Sin `dataDir` la base es en memoria.
 */
export async function openPglite(dataDir, { migrate = true } = {}) {
  if (dataDir) mkdirSync(dataDir, { recursive: true });
  const pg = new PGlite(dataDir);
  await pg.waitReady;
  const lock = mutex();
  const inner = wrap(pg);
  const tx = (fn) => lock(() => pg.transaction(async (raw) => {
    const t = wrap(raw);
    t.batch = (stmts) => runAll(t, stmts);
    t.tx = (f) => f(t);
    return fn(t);
  }));
  const db = {
    all: (...a) => lock(() => inner.all(...a)),
    get: (...a) => lock(() => inner.get(...a)),
    run: (...a) => lock(() => inner.run(...a)),
    batch: (stmts) => tx((t) => runAll(t, stmts)),
    tx,
    exec: (text) => lock(() => pg.exec(text)),
    end: () => lock(() => pg.close()),
    pg,
  };
  if (migrate) await applyMigrations(db);
  return db;
}

export async function applyMigrations(db) {
  for (const file of migrationFiles()) await db.exec(readFileSync(file, 'utf8'));
}
