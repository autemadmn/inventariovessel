import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { openDb } from './db.js';
import { createApp } from './app.js';

const dataDir = resolve(process.env.DATA_DIR || join(import.meta.dirname, '..', 'data'));
const port = Number(process.env.PORT) || 3000;

const db = openDb(join(dataDir, 'inventario.db'));
const app = createApp(db, { dataDir });
const server = createServer(app);

server.listen(port, () => {
  console.log(`Reposición de barras en http://localhost:${port} (datos en ${dataDir})`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    app.close();
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
}
