// Punto de entrada para Cloudflare Workers. Los archivos de public/ los sirve
// Cloudflare directamente; aquí solo llegan /api/* y /photos/*.
import { createHandler } from './handler.js';
import { d1Db } from './db-d1.js';
import { ensureSchema } from './schema.js';

let handler;
let ready;

export default {
  async fetch(request, env) {
    if (!env.DB) {
      return new Response('Falta la base de datos D1 (binding "DB").', { status: 500 });
    }
    if (!handler) {
      const db = d1Db(env.DB);
      handler = createHandler({
        env,
        getDb: () => {
          // El esquema se comprueba una vez por instancia (y se reintenta si falla).
          ready ??= ensureSchema(db).then(() => db).catch((err) => {
            ready = undefined;
            throw err;
          });
          return ready;
        },
      });
    }
    const res = await handler(request);
    return res ?? env.ASSETS.fetch(request);
  },
};
