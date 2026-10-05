-- Chupitería se pide tocando la nevera. Lo que no está en ella (Karlova Blue, Karlova Red,
-- Cassaya y Vino blanco) pasa al final del grupo «Otros». Se aplica una sola vez (marca
-- 'chupiteria_nevera') para respetar lo que el encargado mueva después. No borra datos.
BEGIN;

UPDATE products p SET group_id = g.id,
  group_order = (SELECT COALESCE(MAX(o.group_order), 0) FROM products o WHERE o.group_id = g.id) + v.n,
  updated_at = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
FROM product_groups g,
     (VALUES (1, 'karlova-blue'), (2, 'karlova-red'), (3, 'cassaya'), (4, 'vino-blanco')) AS v(n, slug)
WHERE lower(g.name) = 'otros' AND p.slug = v.slug
  AND p.group_id IS DISTINCT FROM g.id
  AND NOT EXISTS (SELECT 1 FROM settings WHERE key = 'chupiteria_nevera');

UPDATE settings SET value = ((value)::int + 1)::text
WHERE key = 'catalog_rev'
  AND NOT EXISTS (SELECT 1 FROM settings WHERE key = 'chupiteria_nevera');

INSERT INTO settings (key, value) VALUES ('chupiteria_nevera', '1') ON CONFLICT (key) DO NOTHING;

COMMIT;
