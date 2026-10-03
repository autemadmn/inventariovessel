-- Fase 1: puntos de In Vessel. Idempotente; no borra datos ni historia.
ALTER TABLE stores ADD COLUMN IF NOT EXISTS point_type text
  CHECK (point_type IS NULL OR point_type IN ('almacen', 'nevera', 'barra'));
ALTER TABLE stores ADD COLUMN IF NOT EXISTS map_key text
  CHECK (map_key IS NULL OR map_key ~ '^[a-z0-9-]{1,40}$');
ALTER TABLE stores ADD COLUMN IF NOT EXISTS bar_id integer REFERENCES bars(id);
ALTER TABLE stores ADD COLUMN IF NOT EXISTS in_vessel integer NOT NULL DEFAULT 0 CHECK (in_vessel IN (0, 1));
CREATE UNIQUE INDEX IF NOT EXISTS stores_map_key_key ON stores (map_key) WHERE map_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS stores_bar_id_key ON stores (bar_id) WHERE bar_id IS NOT NULL;

UPDATE stores SET name = 'Almacén alcohol', point_type = 'almacen', map_key = 'alm-alcohol', in_vessel = 1, sort = 10
  WHERE id = 1 AND map_key IS NULL;
INSERT INTO stores (id, name, kind, sort, point_type, map_key, bar_id, in_vessel) VALUES
  (3, 'Nevera de vino', 'local', 11, 'nevera', 'nevera-vino', NULL, 1),
  (4, 'Almacén cerveza y refrescos', 'local', 12, 'almacen', 'alm-cerveza', NULL, 1),
  (5, 'Neveras de cerveza', 'local', 13, 'nevera', 'neveras-cerveza', NULL, 1),
  (6, 'Neveras cerveza especial', 'local', 14, 'nevera', 'neveras-especial', NULL, 1),
  (7, 'Nevera chupitería', 'local', 15, 'nevera', 'chupiteria', NULL, 1),
  (10, 'Barra VIP', 'local', 18, 'barra', 'barra-vip', NULL, 1)
ON CONFLICT DO NOTHING;
INSERT INTO stores (id, name, kind, sort, point_type, map_key, bar_id, in_vessel)
  SELECT 8, left(b.name, 40), 'local', 16, 'barra', 'barra-1', b.id, 1 FROM bars b WHERE b.id = 1
ON CONFLICT DO NOTHING;
INSERT INTO stores (id, name, kind, sort, point_type, map_key, bar_id, in_vessel)
  SELECT 9, left(b.name, 40), 'local', 17, 'barra', 'barra-2', b.id, 1 FROM bars b WHERE b.id = 2
ON CONFLICT DO NOTHING;

ALTER TABLE products ADD COLUMN IF NOT EXISTS main_store_id integer REFERENCES stores(id);
UPDATE products p SET main_store_id = s.id FROM stores s
  WHERE p.main_store_id IS NULL AND s.map_key = CASE
    WHEN p.category IN ('cerveza', 'refresco') THEN 'alm-cerveza'
    WHEN p.category = 'vino' THEN 'nevera-vino'
    ELSE 'alm-alcohol' END;
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS from_store_id integer NOT NULL DEFAULT 1 REFERENCES stores(id);
CREATE INDEX IF NOT EXISTS idx_deliveries_from_store ON deliveries (from_store_id, product_id, delivered_at);
CREATE INDEX IF NOT EXISTS idx_deliveries_bar_product ON deliveries (bar_id, product_id, delivered_at);
CREATE INDEX IF NOT EXISTS idx_stock_moves_to ON stock_moves (to_store_id, product_id, created_at);
CREATE INDEX IF NOT EXISTS idx_stock_moves_from ON stock_moves (from_store_id, product_id, created_at);

-- Un orden común desempata operaciones con la misma hora efectiva.
-- La historia anterior conserva el criterio de fechas (orden 0).
CREATE SEQUENCE IF NOT EXISTS stock_event_order;
ALTER TABLE stock_counts ADD COLUMN IF NOT EXISTS event_order bigint NOT NULL DEFAULT 0;
ALTER TABLE stock_moves ADD COLUMN IF NOT EXISTS event_order bigint NOT NULL DEFAULT 0;
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS event_order bigint NOT NULL DEFAULT 0;
ALTER TABLE stock_counts ALTER COLUMN event_order SET DEFAULT nextval('stock_event_order');
ALTER TABLE stock_moves ALTER COLUMN event_order SET DEFAULT nextval('stock_event_order');
ALTER TABLE deliveries ALTER COLUMN event_order SET DEFAULT nextval('stock_event_order');
ALTER TABLE stock_moves ADD COLUMN IF NOT EXISTS client_key text UNIQUE;
CREATE TABLE IF NOT EXISTS stock_operations (
  key text PRIMARY KEY,
  payload text NOT NULL,
  response text
);
ALTER TABLE stock_operations ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA %I FROM anon, authenticated', current_schema());
    EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA %I FROM anon, authenticated', current_schema());
  END IF;
END $$;
