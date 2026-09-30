// Punto de entrada para Cloudflare Workers. Los archivos de public/ los sirve
// Cloudflare directamente; aquí solo llegan /api/* y /photos/*.
// La base de datos es Postgres (Supabase) a través del secreto DATABASE_URL.
// Los sockets de un Worker no se comparten entre peticiones: se abre una
// conexión por petición (solo si la ruta la necesita) y se cierra al acabar.
import { createHandler } from './handler.js';
import { pgDb } from './db-pg.js';
import { checkSchema } from './schema.js';
import { HttpError } from './errors.js';

let handler;
let schemaOk = false;

export default {
  async fetch(request, env, ctx) {
    handler ??= createHandler({ env, getDb: (r) => r.getDb() });
    let db;
    const res = await handler(request, {
      getDb: async () => {
        if (!env.DATABASE_URL) throw new HttpError(503, 'Falta el secreto DATABASE_URL.');
        db ??= pgDb(env.DATABASE_URL, { schema: env.DATABASE_SCHEMA });
        if (!schemaOk) {
          await checkSchema(db);
          schemaOk = true;
        }
        return db;
      },
    });
    if (db) ctx.waitUntil(db.end());
    return res ?? env.ASSETS.fetch(request);
  },
};
