// Adaptador de base de datos para Cloudflare D1. Misma interfaz que db-node.js.

const norm = (args) => args.map((a) => (a === undefined ? null : typeof a === 'boolean' ? Number(a) : a));

export function d1Db(d1) {
  const prep = (sql, args) => (args.length ? d1.prepare(sql).bind(...norm(args)) : d1.prepare(sql));
  const meta = (r) => ({ changes: r.meta?.changes ?? 0, lastId: r.meta?.last_row_id ?? null });
  return {
    async all(sql, ...args) {
      return (await prep(sql, args).all()).results;
    },
    async get(sql, ...args) {
      return (await prep(sql, args).first()) ?? null;
    },
    async run(sql, ...args) {
      return meta(await prep(sql, args).run());
    },
    async batch(statements) {
      return (await d1.batch(statements.map(([sql, ...args]) => prep(sql, args)))).map(meta);
    },
  };
}
