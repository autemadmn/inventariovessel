import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { CATEGORIES, INITIAL_CATALOG, PHOTOS, UNIDENTIFIED } from './catalog.js';

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

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
CREATE TABLE IF NOT EXISTS bars (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS products (
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
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY,
  business_date TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  same_level INTEGER,
  notes TEXT
);
CREATE TABLE IF NOT EXISTS request_lines (
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
);
CREATE INDEX IF NOT EXISTS idx_lines_session ON request_lines(session_id);
CREATE TABLE IF NOT EXISTS deliveries (
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
);
CREATE INDEX IF NOT EXISTS idx_deliveries_session ON deliveries(session_id);
CREATE INDEX IF NOT EXISTS idx_deliveries_line ON deliveries(line_id);
CREATE TABLE IF NOT EXISTS stockouts (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id),
  started_at TEXT NOT NULL,
  ended_at TEXT,
  started_by TEXT,
  ended_by TEXT
);
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL,
  actor TEXT,
  entity TEXT NOT NULL,
  entity_id INTEGER,
  action TEXT NOT NULL,
  before TEXT,
  after TEXT,
  reason TEXT
);
CREATE TABLE IF NOT EXISTS purchase_lists (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'borrador',
  params TEXT NOT NULL,
  lines TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

export function openDb(file = ':memory:') {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  seed(db);
  return db;
}

function seed(db) {
  const now = new Date().toISOString();
  const insSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) insSetting.run(k, v);

  const insBar = db.prepare('INSERT OR IGNORE INTO bars (id, name) VALUES (?, ?)');
  insBar.run(1, 'Barra 1');
  insBar.run(2, 'Barra 2');

  const { n } = db.prepare('SELECT COUNT(*) AS n FROM products').get();
  if (n > 0) {
    addBundledPhotos(db);
    return;
  }

  const ins = db.prepare(`INSERT INTO products (name, category, status, note, active, sort, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  let sort = 0;
  db.exec('BEGIN');
  for (const cat of CATEGORIES) {
    for (const p of INITIAL_CATALOG[cat.id] || []) {
      sort += 10;
      ins.run(p.name, cat.id, p.status, p.note ?? null, 1, sort, now, now);
    }
  }
  for (const u of UNIDENTIFIED) {
    sort += 10;
    ins.run(u.name, u.category, 'sin_identificar', u.note, 0, sort, now, now);
  }
  db.exec('COMMIT');
  addBundledPhotos(db);
}

/** Pone la foto incluida a los productos que aún no tienen ninguna (nunca sustituye una propia). */
function addBundledPhotos(db) {
  const up = db.prepare("UPDATE products SET photo = ? WHERE name = ? AND photo IS NULL AND status = 'confirmado'");
  for (const [name, photo] of Object.entries(PHOTOS)) up.run(photo, name);
}
