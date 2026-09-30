// Utilidades comunes a los adaptadores de Postgres (db-pg.js y db-pglite.js).
// Los servicios escriben el SQL con `?`; aquí se convierte a `$1, $2…`.
import { Buffer } from 'node:buffer';

/** Cambia cada `?` fuera de comillas simples por `$n`. */
export function toPg(sql) {
  let out = '';
  let n = 0;
  let quoted = false;
  for (const ch of sql) {
    if (ch === "'") quoted = !quoted;
    out += ch === '?' && !quoted ? `$${++n}` : ch;
  }
  return out;
}

/** undefined → null, booleanos → 0/1 y, si se pide, Uint8Array → Buffer. */
export function normArgs(args, { buffer = false } = {}) {
  return args.map((a) => {
    if (a === undefined) return null;
    if (typeof a === 'boolean') return a ? 1 : 0;
    if (buffer && a instanceof Uint8Array && !Buffer.isBuffer(a)) {
      return Buffer.from(a.buffer, a.byteOffset, a.byteLength);
    }
    return a;
  });
}

/** Ejecuta una lista de sentencias en orden dentro de la conexión `t`. */
export async function runAll(t, stmts) {
  const out = [];
  for (const [sql, ...args] of stmts) out.push(await t.run(sql, ...args));
  return out;
}
