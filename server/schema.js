// Ajustes por defecto y comprobación del esquema. Las tablas y los datos
// iniciales se crean con las migraciones de supabase/migrations (en Supabase
// las ejecuta el encargado; en local y en los tests, db-pglite.js al abrir).
import { HttpError } from './errors.js';

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
  // Sube con cada cambio del catálogo, la selección o el personal: los móviles
  // lo ven en /api/live y recargan el catálogo al momento.
  catalog_rev: '1',
};

// 0002_seed.sql se genera con Object.entries(DEFAULT_SETTINGS) y no se puede
// modificar. El ajuste nuevo se siembra en 0004, pero sigue disponible aquí.
Object.defineProperty(DEFAULT_SETTINGS, 'trip_weeks', { value: '2', enumerable: false });

export const REQUIRED_TABLES = ['settings', 'bars', 'product_groups', 'products', 'photos', 'sessions',
  'request_lines', 'deliveries', 'stockouts', 'audit', 'purchase_lists', 'staff',
  'stores', 'stock_counts', 'stock_moves', 'trips', 'trip_lines', 'stock_operations', 'need_adjustments'];

/** Comprueba que las migraciones se han aplicado. Si no, 503 con un mensaje claro. */
export async function checkSchema(db) {
  const missing = new HttpError(503, 'Faltan las migraciones de Supabase.');
  const { n } = await db.get(`SELECT count(*)::int AS n FROM information_schema.tables
    WHERE table_schema = current_schema() AND table_name IN (${REQUIRED_TABLES.map(() => '?').join(', ')})`,
  ...REQUIRED_TABLES);
  if (n !== REQUIRED_TABLES.length) throw missing;
  if (!await db.get("SELECT 1 AS ok FROM settings WHERE key = 'seeded'")) throw missing;
  if (!await db.get(`SELECT 1 AS ok FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'stores' AND column_name = 'map_key'`)) throw missing;
  if (!await db.get(`SELECT 1 AS ok FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'deliveries' AND column_name = 'event_order'`)) throw missing;
  if (!await db.get("SELECT 1 AS ok FROM stores WHERE map_key = 'alm-alcohol'")) throw missing;
}
