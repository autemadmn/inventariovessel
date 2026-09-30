// Adaptador para Postgres (Supabase) con postgres.js. Se usa en el Worker y en
// Node cuando hay DATABASE_URL. Interfaz común con db-pglite.js:
//   all(sql, ...args)  → filas
//   get(sql, ...args)  → fila o null
//   run(sql, ...args)  → { changes, lastId }  (lastId solo con `RETURNING id`)
//   batch([[sql, ...args], ...]) → resultados de run(), todo en una transacción
//   tx(async (t) => …) → transacción; dentro se usa SOLO `t`
//   end()              → cierra la conexión
import postgres from 'postgres';
import { normArgs, runAll, toPg } from './sql.js';

function wrap(q) {
  const query = (sql, args) => q.unsafe(toPg(sql), normArgs(args, { buffer: true }));
  const t = {
    async all(sql, ...args) {
      return Array.from(await query(sql, args));
    },
    async get(sql, ...args) {
      return (await query(sql, args))[0] ?? null;
    },
    async run(sql, ...args) {
      const r = await query(sql, args);
      return { changes: r.count ?? 0, lastId: r[0]?.id ?? null };
    },
    batch(stmts) {
      return t.tx((x) => runAll(x, stmts));
    },
    tx: null,
  };
  return t;
}

/** `schema` (solo para el test de concurrencia) fija el search_path de la conexión. */
export function pgDb(url, { max = 1, schema } = {}) {
  const sql = postgres(url, {
    prepare: false, max, fetch_types: false, idle_timeout: 5, connect_timeout: 10,
    ...(schema ? { connection: { search_path: schema } } : {}),
  });
  const db = wrap(sql);
  db.tx = (fn) => sql.begin(async (tx) => {
    const t = wrap(tx);
    t.tx = (f) => f(t);
    return fn(t);
  });
  // Varias sentencias sin parámetros (migraciones): protocolo simple.
  db.exec = (text) => sql.unsafe(text).simple();
  db.end = () => sql.end({ timeout: 5 });
  return db;
}
