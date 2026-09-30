// Genera supabase/migrations/0002_seed.sql a partir de server/catalog.js.
//   node scripts/db/build-seed.mjs
// Un test comprueba que el archivo del repositorio coincide con lo generado.
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  CATEGORIES, HABITUAL_SLUGS, INITIAL_CATALOG, INITIAL_GROUPS, INITIAL_STAFF, PHOTOS, UNIDENTIFIED, slugify,
} from '../../server/catalog.js';
import { DEFAULT_SETTINGS } from '../../server/schema.js';

export const SEED_FILE = resolve(import.meta.dirname, '..', '..', 'supabase', 'migrations', '0002_seed.sql');
const TS = '2026-09-29T00:00:00.000Z';

const lit = (v) => (v === null || v === undefined ? 'NULL'
  : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);

/** Filas iniciales de productos con su grupo, en el orden de la semilla. */
export function seedProducts() {
  const rows = [];
  let sort = 0;
  for (const cat of CATEGORIES) {
    for (const p of INITIAL_CATALOG[cat.id] || []) {
      sort += 10;
      rows.push({
        name: p.name, slug: slugify(p.name), category: cat.id, catIndex: CATEGORIES.indexOf(cat),
        status: p.status, note: p.note ?? null, active: 1, sort,
        photo: p.status === 'confirmado' ? PHOTOS[p.name] ?? null : null,
      });
    }
  }
  for (const u of UNIDENTIFIED) {
    sort += 10;
    rows.push({
      name: u.name, slug: slugify(u.name), category: u.category, status: 'sin_identificar',
      note: u.note, active: 0, sort, photo: null,
    });
  }
  const usual = new Map(HABITUAL_SLUGS.map((s, i) => [s, i + 1]));
  const rest = rows.filter((r) => r.active && !usual.has(r.slug))
    .sort((a, b) => a.catIndex - b.catIndex || a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
  const restOrder = new Map(rest.map((r, i) => [r.slug, i + 1]));
  for (const r of rows) {
    if (usual.has(r.slug)) Object.assign(r, { group_name: INITIAL_GROUPS[0], group_order: usual.get(r.slug) });
    else if (restOrder.has(r.slug)) Object.assign(r, { group_name: INITIAL_GROUPS[1], group_order: restOrder.get(r.slug) });
    else Object.assign(r, { group_name: null, group_order: null });
  }
  return rows;
}

export function buildSeedSql() {
  const settings = Object.entries(DEFAULT_SETTINGS).map(([k, v]) => `(${lit(k)},${lit(v)})`);
  const settingsLines = [];
  for (let i = 0; i < settings.length; i += 4) settingsLines.push(`  ${settings.slice(i, i + 4).join(',')}`);

  const products = seedProducts().map((r, i) => {
    const cast = (v, type) => (i === 0 ? `${lit(v)}::${type}` : lit(v));
    return `  (${cast(r.name, 'text')}, ${cast(r.slug, 'text')}, ${cast(r.category, 'text')}, ${cast(r.status, 'text')},
   ${cast(r.note, 'text')}, ${r.active}, ${r.sort}, ${cast(r.photo, 'text')}, ${cast(r.group_name, 'text')}, ${i === 0 ? `${lit(r.group_order)}::int` : lit(r.group_order)}, ${cast(TS, 'text')})`;
  });

  const groups = INITIAL_GROUPS.map((g, i) => `(${lit(g)}, ${(i + 1) * 10}, ${lit(TS)})`);
  const staff = INITIAL_STAFF.map((s, i) => `(${lit(s)}, ${(i + 1) * 10})`);
  const notSeeded = "WHERE NOT EXISTS (SELECT 1 FROM settings WHERE key = 'seeded')";

  return `-- Generado por scripts/db/build-seed.mjs. No editar a mano.
BEGIN;

-- 1) Ajustes por defecto (nunca pisa los existentes). Incluye catalog_rev = '1'.
INSERT INTO settings (key, value) VALUES
${settingsLines.join(',\n')}
ON CONFLICT (key) DO NOTHING;

-- 2) Barras.
INSERT INTO bars (id, name) VALUES (1, 'Barra 1'), (2, 'Barra 2') ON CONFLICT (id) DO NOTHING;

-- 3) Grupos, catálogo y personal: solo la primera vez (marca 'seeded').
INSERT INTO product_groups (name, sort, created_at)
SELECT v.name, v.sort, v.created_at
FROM (VALUES ${groups.join(',\n             ')}) AS v(name, sort, created_at)
${notSeeded};

INSERT INTO products (name, slug, category, status, note, active, sort, photo,
                      group_id, group_order, created_at, updated_at)
SELECT v.name, v.slug, v.category, v.status, v.note, v.active, v.sort, v.photo,
       g.id, v.group_order, v.ts, v.ts
FROM (VALUES
${products.join(',\n')}
) AS v(name, slug, category, status, note, active, sort, photo, group_name, group_order, ts)
LEFT JOIN product_groups g ON g.name = v.group_name
${notSeeded}
ORDER BY v.sort;

INSERT INTO staff (name, active, sort, created_at)
SELECT v.name, 1, v.sort, ${lit(TS)}
FROM (VALUES ${staff.join(', ')}) AS v(name, sort)
${notSeeded};

INSERT INTO settings (key, value) VALUES ('seeded', '1') ON CONFLICT (key) DO NOTHING;

COMMIT;
`;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  writeFileSync(SEED_FILE, buildSeedSql());
  console.log(`Escrito ${SEED_FILE}`);
}
