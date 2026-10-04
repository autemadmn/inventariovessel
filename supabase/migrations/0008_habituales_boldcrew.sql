-- «Old / Old Sport» es en realidad BoldCrew Original, un whisky (blended scotch),
-- y Flor de Caña Añejo Reserva es habitual. Se aplica una sola vez (marca
-- 'habituales_boldcrew'), para no deshacer lo que el encargado cambie después
-- en Gestión → Selección. No borra datos ni historia.
BEGIN;

UPDATE products SET name = 'BoldCrew Original', slug = 'boldcrew-original', category = 'whisky',
  status = 'confirmado', note = NULL,
  updated_at = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
WHERE slug = 'old-old-sport'
  AND NOT EXISTS (SELECT 1 FROM products WHERE slug = 'boldcrew-original')
  AND NOT EXISTS (SELECT 1 FROM settings WHERE key = 'habituales_boldcrew');

-- Flor de Caña Añejo Reserva pasa al final de Habituales.
UPDATE products p SET group_id = g.id,
  group_order = COALESCE((SELECT max(group_order) FROM products WHERE group_id = g.id), 0) + 1,
  updated_at = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
FROM product_groups g
WHERE p.slug = 'flor-de-cana-anejo-reserva' AND g.name = 'Habituales'
  AND p.group_id IS DISTINCT FROM g.id
  AND NOT EXISTS (SELECT 1 FROM settings WHERE key = 'habituales_boldcrew');

-- Las pantallas abiertas recargan el catálogo.
UPDATE settings SET value = ((value)::int + 1)::text
WHERE key = 'catalog_rev'
  AND NOT EXISTS (SELECT 1 FROM settings WHERE key = 'habituales_boldcrew');

INSERT INTO settings (key, value) VALUES ('habituales_boldcrew', '1') ON CONFLICT (key) DO NOTHING;

COMMIT;
