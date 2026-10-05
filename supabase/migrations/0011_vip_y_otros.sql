-- Barra VIP como tercera barra para pedir y reponer: se enlaza con su punto de In Vessel.
-- Schweppes Fresa, Schweppes Tónica Zero y Perrier pasan al final del grupo «Otros». El
-- movimiento se aplica una sola vez (marca 'vip_y_otros') para respetar lo que el encargado
-- cambie después. No borra datos.
BEGIN;

INSERT INTO bars (id, name)
SELECT 3, 'Barra VIP'
WHERE NOT EXISTS (SELECT 1 FROM bars WHERE id = 3)
  AND NOT EXISTS (SELECT 1 FROM settings WHERE key = 'vip_y_otros');

-- Solo si ya existen los puntos de In Vessel (0005); si se aplica después, vuelve a intentarlo.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = current_schema() AND table_name = 'stores' AND column_name = 'map_key') THEN
    UPDATE stores SET bar_id = 3
    WHERE map_key = 'barra-vip' AND bar_id IS NULL
      AND EXISTS (SELECT 1 FROM bars WHERE id = 3)
      AND NOT EXISTS (SELECT 1 FROM stores WHERE bar_id = 3);
  END IF;
END $$;

UPDATE products p SET group_id = g.id,
  group_order = (SELECT COALESCE(MAX(o.group_order), 0) FROM products o WHERE o.group_id = g.id) + v.n,
  updated_at = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
FROM product_groups g,
     (VALUES (1, 'schweppes-fresa'), (2, 'schweppes-tonica-zero'), (3, 'perrier')) AS v(n, slug)
WHERE lower(g.name) = 'otros' AND p.slug = v.slug
  AND p.group_id IS DISTINCT FROM g.id
  AND NOT EXISTS (SELECT 1 FROM settings WHERE key = 'vip_y_otros');

UPDATE settings SET value = ((value)::int + 1)::text
WHERE key = 'catalog_rev'
  AND NOT EXISTS (SELECT 1 FROM settings WHERE key = 'vip_y_otros');

INSERT INTO settings (key, value) VALUES ('vip_y_otros', '1') ON CONFLICT (key) DO NOTHING;

COMMIT;
