// Esquema y datos iniciales, comunes a Node (node:sqlite) y Cloudflare D1.
// Todo se ejecuta a través del adaptador de base de datos (db-node.js / db-d1.js).

import { CATEGORIES, HABITUAL, INITIAL_CATALOG, PHOTOS, UNIDENTIFIED } from './catalog.js';

export const SCHEMA_VERSION = '3';

export const DEFAULT_SETTINGS = {
  timezone: 'Europe/Madrid',
  // Lo que ocurre antes de esta hora pertenece a la noche del día anterior.
  cutoff_hour: '12',
  safety_pct: '10',
  low_data_nights: '4',
  min_nights_per_weekday: '3',
  undo_minutes: '10',
  // Código que introduce el personal para entrar y PIN del encargado.
  // Las variables de entorno STAFF_CODE y MANAGER_PIN tienen prioridad.
  staff_code: '',
  manager_pin: '',
};

const TABLES = [
  `CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS bars (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'confirmado',
    note TEXT,
    capacity_ml INTEGER,
    per_case INTEGER,
    photo TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    out_of_stock INTEGER NOT NULL DEFAULT 0,
    sort INTEGER NOT NULL DEFAULT 0,
    habitual INTEGER NOT NULL DEFAULT 0,
    habitual_order INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS photos (
    id INTEGER PRIMARY KEY,
    product_id INTEGER NOT NULL,
    mime TEXT NOT NULL,
    data BLOB NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY,
    business_date TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    same_level INTEGER,
    notes TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS request_lines (
    id INTEGER PRIMARY KEY,
    session_id INTEGER NOT NULL REFERENCES sessions(id),
    bar_id INTEGER NOT NULL REFERENCES bars(id),
    product_id INTEGER NOT NULL REFERENCES products(id),
    qty_requested INTEGER NOT NULL,
    qty_cancelled INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    created_by TEXT,
    claimed_by TEXT,
    claimed_at TEXT
  )`,
  'CREATE INDEX IF NOT EXISTS idx_lines_session ON request_lines(session_id)',
  `CREATE TABLE IF NOT EXISTS deliveries (
    id INTEGER PRIMARY KEY,
    session_id INTEGER NOT NULL REFERENCES sessions(id),
    bar_id INTEGER NOT NULL REFERENCES bars(id),
    product_id INTEGER NOT NULL REFERENCES products(id),
    line_id INTEGER REFERENCES request_lines(id),
    qty INTEGER NOT NULL,
    delivered_at TEXT NOT NULL,
    delivered_by TEXT,
    source TEXT NOT NULL DEFAULT 'lista',
    corrected INTEGER NOT NULL DEFAULT 0
  )`,
  'CREATE INDEX IF NOT EXISTS idx_deliveries_session ON deliveries(session_id)',
  'CREATE INDEX IF NOT EXISTS idx_deliveries_line ON deliveries(line_id)',
  `CREATE TABLE IF NOT EXISTS stockouts (
    id INTEGER PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(id),
    started_at TEXT NOT NULL,
    ended_at TEXT,
    started_by TEXT,
    ended_by TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS audit (
    id INTEGER PRIMARY KEY,
    at TEXT NOT NULL,
    actor TEXT,
    entity TEXT NOT NULL,
    entity_id INTEGER,
    action TEXT NOT NULL,
    before TEXT,
    after TEXT,
    reason TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS purchase_lists (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'borrador',
    params TEXT NOT NULL,
    lines TEXT NOT NULL,
    notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
];

// Los datos iniciales van como literales en pocas sentencias: D1 limita el
// número de consultas por petición y de parámetros por consulta.
const lit = (v) => (v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);

function seedStatements(now) {
  const rows = [];
  let sort = 0;
  for (const cat of CATEGORIES) {
    for (const p of INITIAL_CATALOG[cat.id] || []) {
      sort += 10;
      rows.push([p.name, cat.id, p.status, p.note ?? null, 1, sort, p.status === 'confirmado' ? PHOTOS[p.name] ?? null : null]);
    }
  }
  for (const u of UNIDENTIFIED) {
    sort += 10;
    rows.push([u.name, u.category, 'sin_identificar', u.note, 0, sort, null]);
  }
  // Nunca sobre un catálogo ya existente (también bases de datos anteriores a la marca 'seeded').
  const notSeeded = "NOT EXISTS (SELECT 1 FROM settings WHERE key = 'seeded') AND NOT EXISTS (SELECT 1 FROM products)";
  const values = rows.map((r) => `(${[...r, now, now].map(lit).join(', ')})`).join(',\n');
  const photoCases = Object.entries(PHOTOS).map(([n, ph]) => `WHEN ${lit(n)} THEN ${lit(ph)}`).join(' ');
  return [
    `INSERT OR IGNORE INTO settings (key, value) VALUES ${Object.entries(DEFAULT_SETTINGS).map(([k, v]) => `(${lit(k)}, ${lit(v)})`).join(', ')}`,
    "INSERT OR IGNORE INTO bars (id, name) VALUES (1, 'Barra 1'), (2, 'Barra 2')",
    // Solo la primera vez (dentro de la misma transacción que marca 'seeded').
    `INSERT INTO products (name, category, status, note, active, sort, photo, created_at, updated_at)
      SELECT * FROM (VALUES ${values}) WHERE ${notSeeded}`,
    "INSERT OR IGNORE INTO settings (key, value) VALUES ('seeded', '1')",
    // Fotos incluidas para productos confirmados que aún no tengan ninguna
    // (bases de datos creadas antes de que existieran). Nunca sustituye una propia.
    `UPDATE products SET photo = CASE name ${photoCases} END
      WHERE photo IS NULL AND status = 'confirmado' AND name IN (${Object.keys(PHOTOS).map(lit).join(', ')})`,
    // Botellas habituales: se marcan una sola vez por base de datos; después
    // las gestiona el encargado desde el catálogo.
    `UPDATE products SET habitual = 1, habitual_order = CASE name ${HABITUAL.map((n, i) => `WHEN ${lit(n)} THEN ${i + 1}`).join(' ')} END
      WHERE name IN (${HABITUAL.map(lit).join(', ')}) AND NOT EXISTS (SELECT 1 FROM settings WHERE key = 'habitual_init')`,
    "INSERT OR IGNORE INTO settings (key, value) VALUES ('habitual_init', '1')",
    `INSERT INTO settings (key, value) VALUES ('schema_version', ${lit(SCHEMA_VERSION)})
      ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ];
}

/** Crea las tablas y los datos iniciales si hace falta. Idempotente. */
export async function ensureSchema(db, now = new Date()) {
  try {
    const row = await db.get("SELECT value FROM settings WHERE key = 'schema_version'");
    if (row?.value === SCHEMA_VERSION) return;
  } catch {
    // La tabla aún no existe.
  }
  await db.batch(TABLES.map((sql) => [sql]));
  // Migraciones de columnas en bases de datos creadas con versiones anteriores.
  const cols = new Set((await db.all('PRAGMA table_info(products)')).map((c) => c.name));
  const alters = [];
  if (!cols.has('habitual')) alters.push(['ALTER TABLE products ADD COLUMN habitual INTEGER NOT NULL DEFAULT 0']);
  if (!cols.has('habitual_order')) alters.push(['ALTER TABLE products ADD COLUMN habitual_order INTEGER']);
  if (alters.length) await db.batch(alters);
  await db.batch(seedStatements(now.toISOString()).map((sql) => [sql]));
}
