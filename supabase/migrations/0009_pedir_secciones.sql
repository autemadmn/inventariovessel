-- «Pedir» por secciones y unidades de pedido. El renombre y las altas se
-- aplican una sola vez para conservar los cambios posteriores del encargado.
-- No borra datos ni historia; las cantidades siguen guardándose en unidades.
BEGIN;

ALTER TABLE product_groups ADD COLUMN IF NOT EXISTS section text NOT NULL DEFAULT 'alcohol'
  CHECK (section IN ('alcohol', 'nevera', 'chupiteria', 'refrescos', 'otros'));
ALTER TABLE products ADD COLUMN IF NOT EXISTS order_unit text NOT NULL DEFAULT 'botella'
  CHECK (order_unit IN ('botella', 'caja', 'bolsa'));

UPDATE product_groups SET name = 'Premium'
WHERE lower(name) = 'resto'
  AND NOT EXISTS (SELECT 1 FROM product_groups WHERE lower(name) = 'premium')
  AND NOT EXISTS (SELECT 1 FROM settings WHERE key = 'pedir_secciones');

UPDATE product_groups g SET section = v.section
FROM (VALUES ('habituales', 'alcohol'), ('premium', 'alcohol'), ('nevera', 'nevera'),
             ('chupitos', 'chupiteria'), ('cervezas especiales', 'chupiteria'),
             ('refrescos', 'refrescos'), ('zumos', 'refrescos'), ('otros', 'otros')) AS v(lname, section)
WHERE lower(g.name) = v.lname
  AND NOT EXISTS (SELECT 1 FROM settings WHERE key = 'pedir_secciones');

INSERT INTO product_groups (name, sort, section, created_at)
SELECT v.name, (SELECT COALESCE(MAX(sort), 0) FROM product_groups) + v.n * 10, v.section,
       to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
FROM (VALUES (1, 'Nevera', 'nevera'), (2, 'Chupitos', 'chupiteria'), (3, 'Cervezas especiales', 'chupiteria'),
             (4, 'Refrescos', 'refrescos'), (5, 'Zumos', 'refrescos'), (6, 'Otros', 'otros')) AS v(n, name, section)
WHERE NOT EXISTS (SELECT 1 FROM product_groups g WHERE lower(g.name) = lower(v.name))
  AND NOT EXISTS (SELECT 1 FROM settings WHERE key = 'pedir_secciones');

-- Los slugs existentes se respetan; los nuevos se añaden al final de su grupo.
INSERT INTO products (name, slug, category, status, note, capacity_ml, per_case, order_unit, photo,
                      active, out_of_stock, sort, group_id, group_order, main_store_id, created_at, updated_at)
SELECT v.name, v.slug, v.category, 'confirmado', NULL, NULL, v.per_case, v.order_unit, NULL, 1, 0,
       (SELECT COALESCE(MAX(sort), 0) FROM products) + v.n * 10,
       g.id,
       CASE WHEN g.id IS NULL THEN NULL ELSE
         (SELECT COALESCE(MAX(p.group_order), 0) FROM products p WHERE p.group_id = g.id)
         + ROW_NUMBER() OVER (PARTITION BY g.id ORDER BY v.n) END,
       s.id,
       to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
       to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
FROM (VALUES
  (1, 'Cutty Sark'::text, 'cutty-sark'::text, 'whisky'::text, 'botella'::text, NULL::int, 'habituales'::text, 'alm-alcohol'::text),
  (2, 'Aperol', 'aperol', 'otros', 'botella', NULL, 'habituales', 'alm-alcohol'),
  (3, 'Larios 150 Aniversario', 'larios-150-aniversario', 'ginebra', 'botella', NULL, 'premium', 'alm-alcohol'),
  (4, 'Talisker 10', 'talisker-10', 'whisky', 'botella', NULL, 'premium', 'alm-alcohol'),
  (5, 'Johnnie Walker Black Label 12', 'johnnie-walker-black-label-12', 'whisky', 'botella', NULL, 'premium', 'alm-alcohol'),
  (6, 'Cîroc Summer Colada', 'ciroc-summer-colada', 'vodka', 'botella', NULL, 'premium', 'alm-alcohol'),
  (7, 'Estrella Galicia', 'estrella-galicia', 'cerveza', 'caja', 24, 'nevera', 'neveras-cerveza'),
  (8, 'Heineken', 'heineken', 'cerveza', 'botella', 24, 'nevera', 'neveras-especial'),
  (9, 'Red Bull', 'red-bull', 'refresco', 'caja', 24, 'nevera', 'alm-cerveza'),
  (10, 'Red Bull Sugarfree', 'red-bull-sugarfree', 'refresco', 'caja', 24, 'nevera', 'alm-cerveza'),
  (11, 'Agua Cabreiroá 33 cl', 'agua-cabreiroa-33-cl', 'refresco', 'caja', 35, 'nevera', 'alm-cerveza'),
  (12, 'Jägermeister', 'jagermeister', 'licor', 'botella', NULL, 'chupitos', 'chupiteria'),
  (13, 'Fireball', 'fireball', 'licor', 'botella', NULL, 'chupitos', 'chupiteria'),
  (14, 'Buen Amigo Oro', 'buen-amigo-oro', 'licor', 'botella', NULL, 'chupitos', 'chupiteria'),
  (15, 'DIEX Crema de Fresas con Tequila', 'diex-crema-de-fresas-con-tequila', 'licor', 'botella', NULL, 'chupitos', 'chupiteria'),
  (16, 'Karlova Blue', 'karlova-blue', 'licor', 'botella', NULL, 'chupitos', 'chupiteria'),
  (17, 'Karlova Red', 'karlova-red', 'licor', 'botella', NULL, 'chupitos', 'chupiteria'),
  (18, 'Cassaya', 'cassaya', 'licor', 'botella', NULL, 'chupitos', 'chupiteria'),
  (19, 'Desperados', 'desperados', 'cerveza', 'botella', 24, 'cervezas especiales', 'neveras-especial'),
  (20, '1906 Reserva Especial', '1906-reserva-especial', 'cerveza', 'botella', 24, 'cervezas especiales', 'neveras-especial'),
  (21, 'B.Lemon', 'b-lemon', 'cerveza', 'botella', 24, 'cervezas especiales', 'chupiteria'),
  (22, 'Estrella Galicia 0,0', 'estrella-galicia-0-0', 'cerveza', 'botella', 24, 'cervezas especiales', 'chupiteria'),
  (23, 'Estrella Galicia sin gluten', 'estrella-galicia-sin-gluten', 'cerveza', 'botella', 24, 'cervezas especiales', 'neveras-especial'),
  (24, 'Vino blanco', 'vino-blanco', 'vino', 'botella', NULL, 'cervezas especiales', 'nevera-vino'),
  (25, 'Pepsi', 'pepsi', 'refresco', 'caja', 24, 'refrescos', 'alm-cerveza'),
  (26, 'Pepsi Zero', 'pepsi-zero', 'refresco', 'caja', 24, 'refrescos', 'alm-cerveza'),
  (27, '7Up', '7up', 'refresco', 'caja', 24, 'refrescos', 'alm-cerveza'),
  (28, 'Schweppes Limón', 'schweppes-limon', 'refresco', 'caja', 24, 'refrescos', 'alm-cerveza'),
  (29, 'Schweppes Naranja', 'schweppes-naranja', 'refresco', 'caja', 24, 'refrescos', 'alm-cerveza'),
  (30, 'Schweppes Tónica', 'schweppes-tonica', 'refresco', 'caja', 24, 'refrescos', 'alm-cerveza'),
  (31, 'Schweppes Tónica Zero', 'schweppes-tonica-zero', 'refresco', 'caja', 24, 'refrescos', 'alm-cerveza'),
  (32, 'Schweppes Fresa', 'schweppes-fresa', 'refresco', 'caja', 24, 'refrescos', 'alm-cerveza'),
  (33, 'Perrier', 'perrier', 'refresco', 'caja', 24, 'refrescos', 'alm-cerveza'),
  (34, 'Zumo de naranja', 'zumo-de-naranja', 'refresco', 'caja', 24, 'zumos', 'alm-cerveza'),
  (35, 'Zumo de melocotón', 'zumo-de-melocoton', 'refresco', 'caja', 24, 'zumos', 'alm-cerveza'),
  (36, 'Zumo de piña', 'zumo-de-pina', 'refresco', 'caja', 24, 'zumos', 'alm-cerveza'),
  (37, 'Hielo', 'hielo', 'otros', 'bolsa', NULL, 'otros', NULL),
  (38, 'Stella Artois', 'stella-artois', 'cerveza', 'botella', 24, 'otros', 'chupiteria'),
  (39, 'Tyris Original', 'tyris-original', 'cerveza', 'botella', 24, 'otros', 'chupiteria')
) AS v(n, name, slug, category, order_unit, per_case, group_lname, main_key)
LEFT JOIN product_groups g ON lower(g.name) = v.group_lname
LEFT JOIN stores s ON s.map_key = v.main_key
WHERE NOT EXISTS (SELECT 1 FROM products p WHERE p.slug = v.slug)
  AND NOT EXISTS (SELECT 1 FROM settings WHERE key = 'pedir_secciones');

UPDATE settings SET value = ((value)::int + 1)::text
WHERE key = 'catalog_rev'
  AND NOT EXISTS (SELECT 1 FROM settings WHERE key = 'pedir_secciones');

INSERT INTO settings (key, value) VALUES ('pedir_secciones', '1') ON CONFLICT (key) DO NOTHING;
COMMIT;
