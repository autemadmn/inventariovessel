-- Generado por scripts/db/build-seed.mjs. No editar a mano.
BEGIN;

-- 1) Ajustes por defecto (nunca pisa los existentes). Incluye catalog_rev = '1'.
INSERT INTO settings (key, value) VALUES
  ('timezone','Europe/Madrid'),('cutoff_hour','12'),('safety_pct','10'),('low_data_nights','4'),
  ('min_nights_per_weekday','3'),('undo_minutes','10'),('staff_code',''),('manager_pin',''),
  ('catalog_rev','1')
ON CONFLICT (key) DO NOTHING;

-- 2) Barras.
INSERT INTO bars (id, name) VALUES (1, 'Barra 1'), (2, 'Barra 2') ON CONFLICT (id) DO NOTHING;

-- 3) Grupos, catálogo y personal: solo la primera vez (marca 'seeded').
INSERT INTO product_groups (name, sort, created_at)
SELECT v.name, v.sort, v.created_at
FROM (VALUES ('Habituales', 10, '2026-09-29T00:00:00.000Z'),
             ('Resto', 20, '2026-09-29T00:00:00.000Z')) AS v(name, sort, created_at)
WHERE NOT EXISTS (SELECT 1 FROM settings WHERE key = 'seeded');

INSERT INTO products (name, slug, category, status, note, active, sort, photo,
                      group_id, group_order, created_at, updated_at)
SELECT v.name, v.slug, v.category, v.status, v.note, v.active, v.sort, v.photo,
       g.id, v.group_order, v.ts, v.ts
FROM (VALUES
  ('Bulldog London Dry'::text, 'bulldog-london-dry'::text, 'ginebra'::text, 'confirmado'::text,
   NULL::text, 1, 10, NULL::text, 'Resto'::text, 2::int, '2026-09-29T00:00:00.000Z'::text),
  ('Brockmans', 'brockmans', 'ginebra', 'confirmado',
   NULL, 1, 20, '/img/botellas/brockmans.jpg', 'Resto', 1, '2026-09-29T00:00:00.000Z'),
  ('Hendrick’s', 'hendricks', 'ginebra', 'confirmado',
   NULL, 1, 30, '/img/botellas/hendricks.jpg', 'Resto', 4, '2026-09-29T00:00:00.000Z'),
  ('Roku', 'roku', 'ginebra', 'confirmado',
   NULL, 1, 40, '/img/botellas/roku.jpg', 'Resto', 8, '2026-09-29T00:00:00.000Z'),
  ('G’Vine Floraison', 'gvine-floraison', 'ginebra', 'confirmado',
   NULL, 1, 50, '/img/botellas/gvine-floraison.jpg', 'Resto', 3, '2026-09-29T00:00:00.000Z'),
  ('Macaronesian White Gin', 'macaronesian-white-gin', 'ginebra', 'confirmado',
   NULL, 1, 60, NULL, 'Resto', 5, '2026-09-29T00:00:00.000Z'),
  ('Nordés', 'nordes', 'ginebra', 'confirmado',
   NULL, 1, 70, '/img/botellas/nordes.jpg', 'Resto', 7, '2026-09-29T00:00:00.000Z'),
  ('Martin Miller’s', 'martin-millers', 'ginebra', 'confirmado',
   NULL, 1, 80, '/img/botellas/martin-millers.jpg', 'Resto', 6, '2026-09-29T00:00:00.000Z'),
  ('Tanqueray London Dry', 'tanqueray-london-dry', 'ginebra', 'confirmado',
   NULL, 1, 90, '/img/botellas/tanqueray-london-dry.jpg', 'Habituales', 9, '2026-09-29T00:00:00.000Z'),
  ('Larios Rosé', 'larios-rose', 'ginebra', 'confirmado',
   NULL, 1, 100, '/img/botellas/larios-rose.jpg', 'Habituales', 6, '2026-09-29T00:00:00.000Z'),
  ('Larios Pomelo', 'larios-pomelo', 'ginebra', 'confirmado',
   NULL, 1, 110, NULL, 'Habituales', 7, '2026-09-29T00:00:00.000Z'),
  ('Larios 12', 'larios-12', 'ginebra', 'confirmado',
   NULL, 1, 120, '/img/botellas/larios-12.jpg', 'Habituales', 8, '2026-09-29T00:00:00.000Z'),
  ('Master’s London Dry', 'masters-london-dry', 'ginebra', 'confirmado',
   NULL, 1, 130, NULL, 'Habituales', 10, '2026-09-29T00:00:00.000Z'),
  ('Master’s Pink', 'masters-pink', 'ginebra', 'confirmado',
   NULL, 1, 140, NULL, 'Habituales', 5, '2026-09-29T00:00:00.000Z'),
  ('Puerto de Indias', 'puerto-de-indias', 'ginebra', 'pendiente',
   'Aparentemente Strawberry; confirmar la variedad.', 1, 150, NULL, 'Habituales', 4, '2026-09-29T00:00:00.000Z'),
  ('Zeeland Nº8', 'zeeland-n8', 'ginebra', 'confirmado',
   NULL, 1, 160, NULL, 'Habituales', 3, '2026-09-29T00:00:00.000Z'),
  ('Zeeland Pink Nº12', 'zeeland-pink-n12', 'ginebra', 'confirmado',
   NULL, 1, 170, NULL, 'Resto', 9, '2026-09-29T00:00:00.000Z'),
  ('Belvedere Organic', 'belvedere-organic', 'vodka', 'confirmado',
   NULL, 1, 180, NULL, 'Resto', 11, '2026-09-29T00:00:00.000Z'),
  ('Beluga Noble', 'beluga-noble', 'vodka', 'confirmado',
   NULL, 1, 190, '/img/botellas/beluga-noble.jpg', 'Resto', 10, '2026-09-29T00:00:00.000Z'),
  ('Tito’s Handmade Vodka', 'titos-handmade-vodka', 'vodka', 'confirmado',
   NULL, 1, 200, '/img/botellas/titos-handmade-vodka.jpg', 'Resto', 17, '2026-09-29T00:00:00.000Z'),
  ('Cîroc Original', 'ciroc-original', 'vodka', 'confirmado',
   NULL, 1, 210, NULL, 'Resto', 14, '2026-09-29T00:00:00.000Z'),
  ('Cîroc Apple', 'ciroc-apple', 'vodka', 'confirmado',
   NULL, 1, 220, NULL, 'Resto', 12, '2026-09-29T00:00:00.000Z'),
  ('Cîroc Red Berry', 'ciroc-red-berry', 'vodka', 'confirmado',
   NULL, 1, 230, '/img/botellas/ciroc-red-berry.jpg', 'Resto', 16, '2026-09-29T00:00:00.000Z'),
  ('Cîroc French Vanilla', 'ciroc-french-vanilla', 'vodka', 'confirmado',
   NULL, 1, 240, NULL, 'Resto', 13, '2026-09-29T00:00:00.000Z'),
  ('Cîroc Pineapple', 'ciroc-pineapple', 'vodka', 'confirmado',
   NULL, 1, 250, '/img/botellas/ciroc-pineapple.jpg', 'Resto', 15, '2026-09-29T00:00:00.000Z'),
  ('SKYY', 'skyy', 'vodka', 'confirmado',
   NULL, 1, 260, '/img/botellas/skyy.jpg', 'Habituales', 2, '2026-09-29T00:00:00.000Z'),
  ('Moskovskaya', 'moskovskaya', 'vodka', 'confirmado',
   NULL, 1, 270, '/img/botellas/moskovskaya.jpg', 'Habituales', 1, '2026-09-29T00:00:00.000Z'),
  ('Jack Daniel’s Old No. 7', 'jack-daniels-old-no-7', 'whisky', 'confirmado',
   NULL, 1, 280, '/img/botellas/jack-daniels-old-no-7.jpg', 'Habituales', 11, '2026-09-29T00:00:00.000Z'),
  ('Dewar’s White Label', 'dewars-white-label', 'whisky', 'confirmado',
   NULL, 1, 290, '/img/botellas/dewars-white-label.jpg', 'Habituales', 12, '2026-09-29T00:00:00.000Z'),
  ('Johnnie Walker Red Label', 'johnnie-walker-red-label', 'whisky', 'confirmado',
   NULL, 1, 300, '/img/botellas/johnnie-walker-red-label.jpg', 'Habituales', 13, '2026-09-29T00:00:00.000Z'),
  ('J&B Rare', 'j-b-rare', 'whisky', 'confirmado',
   NULL, 1, 310, '/img/botellas/j-b-rare.jpg', 'Habituales', 14, '2026-09-29T00:00:00.000Z'),
  ('DYC 8', 'dyc-8', 'whisky', 'confirmado',
   NULL, 1, 320, '/img/botellas/dyc-8.jpg', 'Habituales', 16, '2026-09-29T00:00:00.000Z'),
  ('Glenmorangie The Original', 'glenmorangie-the-original', 'whisky', 'pendiente',
   'Confirmar la edad.', 1, 330, NULL, 'Resto', 19, '2026-09-29T00:00:00.000Z'),
  ('Monkey Shoulder', 'monkey-shoulder', 'whisky', 'confirmado',
   NULL, 1, 340, '/img/botellas/monkey-shoulder.jpg', 'Resto', 20, '2026-09-29T00:00:00.000Z'),
  ('Chivas Regal 12', 'chivas-regal-12', 'whisky', 'confirmado',
   NULL, 1, 350, '/img/botellas/chivas-regal-12.jpg', 'Resto', 18, '2026-09-29T00:00:00.000Z'),
  ('The Macallan 12', 'the-macallan-12', 'whisky', 'pendiente',
   'Confirmar la expresión concreta.', 1, 360, NULL, 'Resto', 21, '2026-09-29T00:00:00.000Z'),
  ('Cacique Añejo', 'cacique-anejo', 'ron', 'confirmado',
   NULL, 1, 370, '/img/botellas/cacique-anejo.jpg', 'Habituales', 17, '2026-09-29T00:00:00.000Z'),
  ('Barceló Añejo', 'barcelo-anejo', 'ron', 'confirmado',
   NULL, 1, 380, '/img/botellas/barcelo-anejo.jpg', 'Habituales', 18, '2026-09-29T00:00:00.000Z'),
  ('Barceló Imperial', 'barcelo-imperial', 'ron', 'confirmado',
   NULL, 1, 390, '/img/botellas/barcelo-imperial.jpg', 'Resto', 24, '2026-09-29T00:00:00.000Z'),
  ('Flor de Caña Añejo Reserva', 'flor-de-cana-anejo-reserva', 'ron', 'pendiente',
   'Confirmar la edad.', 1, 400, NULL, 'Resto', 28, '2026-09-29T00:00:00.000Z'),
  ('Flor de Caña 12', 'flor-de-cana-12', 'ron', 'confirmado',
   NULL, 1, 410, NULL, 'Resto', 27, '2026-09-29T00:00:00.000Z'),
  ('Abuelo Añejo', 'abuelo-anejo', 'ron', 'confirmado',
   NULL, 1, 420, NULL, 'Resto', 23, '2026-09-29T00:00:00.000Z'),
  ('Abuelo 12', 'abuelo-12', 'ron', 'confirmado',
   NULL, 1, 430, NULL, 'Resto', 22, '2026-09-29T00:00:00.000Z'),
  ('Brugal Doble Reserva', 'brugal-doble-reserva', 'ron', 'confirmado',
   NULL, 1, 440, '/img/botellas/brugal-doble-reserva.jpg', 'Resto', 26, '2026-09-29T00:00:00.000Z'),
  ('Brugal 1888', 'brugal-1888', 'ron', 'confirmado',
   NULL, 1, 450, '/img/botellas/brugal-1888.jpg', 'Resto', 25, '2026-09-29T00:00:00.000Z'),
  ('Brugal Añejo', 'brugal-anejo', 'ron', 'confirmado',
   NULL, 1, 460, '/img/botellas/brugal-anejo.jpg', 'Habituales', 19, '2026-09-29T00:00:00.000Z'),
  ('Zacapa', 'zacapa', 'ron', 'pendiente',
   'Aparentemente Solera 23; confirmar la variedad.', 1, 470, NULL, 'Resto', 29, '2026-09-29T00:00:00.000Z'),
  ('Old / Old Sport', 'old-old-sport', 'ron', 'pendiente',
   'Etiqueta «OLD» con letras manuscritas naranjas. Identificación provisional: confirmar marca y categoría.', 1, 480, NULL, 'Habituales', 15, '2026-09-29T00:00:00.000Z'),
  ('Don Julio Reposado', 'don-julio-reposado', 'tequila', 'confirmado',
   NULL, 1, 490, '/img/botellas/don-julio-reposado.jpg', 'Resto', 30, '2026-09-29T00:00:00.000Z'),
  ('Botella pequeña y oscura', 'botella-pequena-y-oscura', 'otros', 'sin_identificar',
   'Situada entre The Macallan y Zacapa. Pendiente de identificar.', 0, 500, NULL, NULL, NULL, '2026-09-29T00:00:00.000Z'),
  ('Botella de ron con malla', 'botella-de-ron-con-malla', 'ron', 'sin_identificar',
   'Situada entre Barceló y Flor de Caña. Podría ser otra variedad de Brugal o un producto ya incluido. No crear duplicado hasta confirmarlo.', 0, 510, NULL, NULL, NULL, '2026-09-29T00:00:00.000Z')
) AS v(name, slug, category, status, note, active, sort, photo, group_name, group_order, ts)
LEFT JOIN product_groups g ON g.name = v.group_name
WHERE NOT EXISTS (SELECT 1 FROM settings WHERE key = 'seeded')
ORDER BY v.sort;

INSERT INTO staff (name, active, sort, created_at)
SELECT v.name, 1, v.sort, '2026-09-29T00:00:00.000Z'
FROM (VALUES ('Carlos', 10), ('Sergio', 20), ('Alejandro', 30)) AS v(name, sort)
WHERE NOT EXISTS (SELECT 1 FROM settings WHERE key = 'seeded');

INSERT INTO settings (key, value) VALUES ('seeded', '1') ON CONFLICT (key) DO NOTHING;

COMMIT;
