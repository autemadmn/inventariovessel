// Importa una copia de seguridad de la app (Gestión → Ajustes → Copia de seguridad).
//
//   DATABASE_URL=… node scripts/db/import-backup.mjs copia.json [--force]
//   node scripts/db/import-backup.mjs copia.json --pglite data/pglite [--force]
//
// Con DATABASE_URL escribe en ese Postgres (Supabase), que debe tener ya las
// migraciones 0001 y 0002. Con --pglite escribe en una base local de PGlite
// (la crea si no existe). Sustituye todos los datos de la base de destino.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { importBackup } from '../../server/import-backup.js';
import { checkSchema } from '../../server/schema.js';

const args = process.argv.slice(2);
const force = args.includes('--force');
const pgliteAt = args.indexOf('--pglite');
const pgliteDir = pgliteAt >= 0 ? args[pgliteAt + 1] : null;
const file = args.find((a, i) => !a.startsWith('--') && (pgliteAt < 0 || i !== pgliteAt + 1));

if (!file || (pgliteAt >= 0 && !pgliteDir)) {
  console.error('Uso: DATABASE_URL=… node scripts/db/import-backup.mjs copia.json [--force]');
  console.error('   o: node scripts/db/import-backup.mjs copia.json --pglite <carpeta> [--force]');
  process.exit(2);
}

let db;
try {
  const data = JSON.parse(readFileSync(resolve(file), 'utf8'));
  if (pgliteDir) {
    const { openPglite } = await import('../../server/db-pglite.js');
    db = await openPglite(resolve(pgliteDir));
  } else if (process.env.DATABASE_URL) {
    const { pgDb } = await import('../../server/db-pg.js');
    db = pgDb(process.env.DATABASE_URL, { schema: process.env.DATABASE_SCHEMA });
    await checkSchema(db);
  } else {
    throw new Error('Falta DATABASE_URL (o usa --pglite <carpeta>).');
  }
  const r = await importBackup(db, data, { force });
  console.log(`Copia importada${r.legacy ? ' (formato antiguo: se han creado los grupos y el personal iniciales)' : ''}.`);
  for (const [table, n] of Object.entries(r.counts)) console.log(`  ${table}: ${n}`);
  if (r.photosCleared) {
    console.log(`Aviso: ${r.photosCleared} foto(s) propia(s) no viajan en la copia; vuelve a subirlas desde Gestión → Catálogo.`);
  }
} catch (err) {
  console.error(`Error: ${err.message}`);
  process.exitCode = 1;
} finally {
  await db?.end();
}
