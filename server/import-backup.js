// Importa la copia JSON que exporta la app (/api/backup) en una base Postgres
// ya migrada (0001 a 0005). Sirve para copias antiguas (SQLite/D1, con
// `habitual`, sin slugs, grupos ni personal) y para copias nuevas.
// Sustituye todos los datos; los códigos de acceso de la base no se tocan.
import { CATEGORIES, INITIAL_GROUPS, INITIAL_STAFF, INITIAL_STORES, defaultMainKey, slugify } from './catalog.js';

const DROP_SETTINGS = new Set(['schema_version', 'habitual_init', 'seeded', 'staff_code', 'manager_pin']);

// Orden de inserción (padres antes que hijos). Se borra en orden inverso.
const ORDER = ['bars', 'stores', 'product_groups', 'products', 'staff', 'sessions', 'request_lines', 'deliveries',
  'stockouts', 'audit', 'purchase_lists', 'trips', 'trip_lines', 'stock_counts', 'stock_moves', 'stock_operations'];

const OPERATION_TABLES = ['sessions', 'request_lines', 'deliveries', 'purchase_lists', 'stock_counts', 'stock_moves', 'trips'];

async function columnsOf(t, table) {
  return (await t.all(`SELECT column_name FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = ? ORDER BY ordinal_position`, table)).map((r) => r.column_name);
}

async function insertRows(t, table, rows) {
  if (!rows.length) return;
  const cols = await columnsOf(t, table);
  const use = cols.filter((c) => rows.some((r) => r[c] !== undefined));
  const chunk = Math.max(1, Math.floor(2000 / use.length));
  for (let i = 0; i < rows.length; i += chunk) {
    const part = rows.slice(i, i + chunk);
    await t.run(`INSERT INTO ${table} (${use.join(', ')}) VALUES
      ${part.map(() => `(${use.map(() => '?').join(', ')})`).join(', ')}`,
    ...part.flatMap((r) => use.map((c) => r[c] ?? null)));
  }
}

/** Grupos y posiciones para una copia antigua que aún no los tiene. */
function legacyGroups(products) {
  const catIndex = (c) => {
    const i = CATEGORIES.findIndex((x) => x.id === c);
    return i < 0 ? CATEGORIES.length : i;
  };
  const selectable = (p) => Number(p.active) === 1 && ['confirmado', 'pendiente'].includes(p.status);
  const usual = products.filter((p) => Number(p.habitual) === 1 && selectable(p))
    .sort((a, b) => (a.habitual_order ?? 1e9) - (b.habitual_order ?? 1e9) || a.id - b.id);
  const rest = products.filter((p) => Number(p.habitual) !== 1 && selectable(p))
    .sort((a, b) => catIndex(a.category) - catIndex(b.category) || a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
  const out = new Map();
  usual.forEach((p, i) => out.set(p.id, { group_id: 1, group_order: i + 1 }));
  rest.forEach((p, i) => out.set(p.id, { group_id: 2, group_order: i + 1 }));
  return out;
}

/**
 * @param db  adaptador (db-pg o db-pglite) con las migraciones aplicadas
 * @param data  objeto { exported_at, tables: { … } }
 * @param opts.force  sustituir aunque la base ya tenga noches, pedidos o listas
 * @returns resumen { counts, photosCleared, legacy }
 */
export async function importBackup(db, data, { force = false, now = new Date() } = {}) {
  const src = data?.tables;
  if (!src || !Array.isArray(src.products)) throw new Error('El archivo no es una copia de seguridad de la app.');

  return db.tx(async (t) => {
    if (!force) {
      for (const table of OPERATION_TABLES) {
        const { n } = await t.get(`SELECT count(*)::int AS n FROM ${table}`);
        if (n) {
          throw new Error('La base de datos de destino ya tiene datos de operación (noches, pedidos, listas de compra o almacén). '
            + 'Si quieres sustituirlos por la copia, repite con --force.');
        }
      }
    }
    const ts = now.toISOString();
    const legacy = !Array.isArray(src.product_groups);
    const legacyPoints = !Array.isArray(src.stores) || src.stores.some((s) => s.map_key === undefined);
    const stores = legacyPoints ? INITIAL_STORES.map((s) => ({ ...s,
      name: s.id === 2 ? src.stores?.find((old) => old.id === 2)?.name ?? s.name
        : s.bar_id ? (src.bars?.find((b) => b.id === s.bar_id)?.name ?? s.name).slice(0, 40) : s.name,
    })) : src.stores;

    // Productos: slug (de la copia, de la ruta de su imagen o del nombre) y fotos propias.
    let photosCleared = 0;
    const taken = new Set();
    const groupOf = legacy ? legacyGroups(src.products) : null;
    const products = src.products.map((p) => {
      let slug = p.slug || /^\/img\/botellas\/([a-z0-9-]+)\.[a-z]+$/.exec(p.photo || '')?.[1] || slugify(p.name);
      if (taken.has(slug)) {
        let i = 2;
        while (taken.has(`${slug}-${i}`)) i++;
        slug = `${slug}-${i}`;
      }
      taken.add(slug);
      let { photo } = p;
      if (/^\/photos\/\d+$/.test(photo || '')) {
        photo = null;
        photosCleared++;
      }
      const g = legacy ? groupOf.get(p.id) ?? { group_id: null, group_order: null } : {};
      const { habitual, habitual_order, ...rest } = p;
      return { ...rest, slug, photo, ...g,
        ...(legacyPoints && p.main_store_id == null
          ? { main_store_id: stores.find((s) => s.map_key === defaultMainKey(p.category)).id } : {}) };
    });

    const groups = legacy
      ? INITIAL_GROUPS.map((name, i) => ({ id: i + 1, name, sort: (i + 1) * 10, created_at: ts }))
      : src.product_groups;
    const staff = Array.isArray(src.staff) ? src.staff
      : INITIAL_STAFF.map((name, i) => ({ id: i + 1, name, active: 1, sort: (i + 1) * 10, created_at: ts }));

    const rows = {
      bars: src.bars ?? [], stores,
      product_groups: groups, products, staff,
      sessions: src.sessions ?? [], request_lines: src.request_lines ?? [],
      deliveries: (src.deliveries ?? []).map(({ from_store_id, ...d }) => ({ ...d,
        ...(!legacyPoints ? { from_store_id } : {}), event_order: d.event_order ?? 0 })),
      stockouts: src.stockouts ?? [], audit: src.audit ?? [], purchase_lists: src.purchase_lists ?? [],
      trips: src.trips ?? [], trip_lines: src.trip_lines ?? [],
      stock_counts: (src.stock_counts ?? []).map(c=>({...c,event_order:c.event_order ?? 0})),
      stock_moves: (src.stock_moves ?? []).map(m=>({...m,event_order:m.event_order ?? 0})),
      stock_operations: src.stock_operations ?? [],
    };

    await t.run('DELETE FROM photos');
    for (const table of [...ORDER].reverse()) await t.run(`DELETE FROM ${table}`);
    for (const table of ORDER) await insertRows(t, table, rows[table]);

    // Secuencias de identidad por encima del mayor id importado.
    for (const table of ORDER.filter((x) => !['bars', 'stores', 'stock_operations'].includes(x)).concat('photos')) {
      await t.get(`SELECT setval(pg_get_serial_sequence(?, 'id'),
        COALESCE((SELECT MAX(id) FROM ${table}), 0) + 1, false)`, table);
    }
    await t.get(`SELECT setval('stock_event_order', GREATEST(
      (SELECT last_value FROM stock_event_order),
      COALESCE((SELECT MAX(event_order) FROM stock_counts), 0),
      COALESCE((SELECT MAX(event_order) FROM stock_moves), 0),
      COALESCE((SELECT MAX(event_order) FROM deliveries), 0)) + 1, false)`);

    const normalized = [];
    for (const { key, value } of src.settings ?? []) {
      if (DROP_SETTINGS.has(key) || key === 'catalog_rev') continue;
      if (['timezone', 'cutoff_hour'].includes(key)) {
        const fixed = key === 'timezone' ? 'Europe/Madrid' : '12';
        if (String(value) !== fixed) normalized.push({ key, before: value, after: fixed });
        continue;
      }
      await t.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value', key, value);
    }
    for (const [key, value] of [['timezone', 'Europe/Madrid'], ['cutoff_hour', '12']]) {
      await t.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value', key, value);
    }
    if (normalized.length) await t.run(`INSERT INTO audit (at, entity, action, before, after, reason)
      VALUES (?, 'ajustes', 'normalizar jornada importada', ?, ?, ?)`, ts,
    JSON.stringify(normalized.map(({key,before}) => ({key,value:before}))),
    JSON.stringify(normalized.map(({key,after}) => ({key,value:after}))), 'Madrid y corte a las 12:00 obligatorios.');
    await t.run("INSERT INTO settings (key, value) VALUES ('seeded', '1') ON CONFLICT (key) DO NOTHING");
    // Los móviles abiertos recargan el catálogo.
    await t.run(`INSERT INTO settings (key, value) VALUES ('catalog_rev', '1')
      ON CONFLICT (key) DO UPDATE SET value = ((settings.value)::int + 1)::text`);

    const counts = Object.fromEntries(ORDER.map((x) => [x, rows[x].length]));
    return { counts, photosCleared, legacy };
  });
}
