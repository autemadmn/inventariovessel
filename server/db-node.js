// Adaptador de base de datos para Node (node:sqlite). Misma interfaz que db-d1.js:
//   all(sql, ...args)  → filas
//   get(sql, ...args)  → fila o null
//   run(sql, ...args)  → { changes, lastId }
//   batch([[sql, ...args], ...]) → resultados de run(), todo en una transacción
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const norm = (args) => args.map((a) => (a === undefined ? null : typeof a === 'boolean' ? Number(a) : a));

export function openNodeDb(file = ':memory:') {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const raw = new DatabaseSync(file);
  raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  const run = (sql, ...args) => {
    const r = raw.prepare(sql).run(...norm(args));
    return { changes: Number(r.changes), lastId: Number(r.lastInsertRowid) };
  };
  return {
    raw,
    async all(sql, ...args) {
      return raw.prepare(sql).all(...norm(args));
    },
    async get(sql, ...args) {
      return raw.prepare(sql).get(...norm(args)) ?? null;
    },
    async run(sql, ...args) {
      return run(sql, ...args);
    },
    async batch(statements) {
      raw.exec('BEGIN IMMEDIATE');
      try {
        const out = statements.map(([sql, ...args]) => run(sql, ...args));
        raw.exec('COMMIT');
        return out;
      } catch (err) {
        raw.exec('ROLLBACK');
        throw err;
      }
    },
    close() {
      raw.close();
    },
  };
}
