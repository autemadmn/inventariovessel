# Publicar las fases 1 y 2

Sin `DATABASE_URL`: las migraciones se pegan en la web de Supabase y Codex solo fusiona en GitHub.
Con el local cerrado y en este orden.

## 1 · Supabase: comprobar dueños

Supabase › SQL Editor › New query. Pega y pulsa **Run**:

```sql
SELECT tablename AS objeto, tableowner AS dueno FROM pg_tables WHERE schemaname = 'vessel_reposicion'
UNION ALL
SELECT sequencename, sequenceowner FROM pg_sequences WHERE schemaname = 'vessel_reposicion';
```

Si en «dueno» sale siempre el mismo nombre, sigue. Si no, para.

## 2 · Supabase: migraciones 0005 y 0006 juntas

New query, pega todo esto y pulsa **Run**. Va entero o no va: si algo falla, no cambia nada.
Al principio se hace pasar por el dueño de las tablas (el usuario de la app), porque el editor de
Supabase entra con otro usuario y sin eso da «must be owner of table stores».

```sql
BEGIN;
-- Actúa como el dueño de las tablas de la app (el usuario de Cloudflare).
DO $$
DECLARE dueno text;
BEGIN
  SELECT tableowner INTO dueno FROM pg_tables WHERE schemaname = 'vessel_reposicion' AND tablename = 'stores';
  IF dueno IS NULL THEN RAISE EXCEPTION 'No encuentro la tabla vessel_reposicion.stores'; END IF;
  IF dueno <> current_user THEN
    IF NOT pg_has_role(current_user, dueno, 'USAGE') THEN
      EXECUTE format('GRANT %I TO %I', dueno, current_user);
    END IF;
    EXECUTE format('SET LOCAL ROLE %I', dueno);
  END IF;
END $$;
SET LOCAL search_path TO vessel_reposicion;

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

-- Fase 2: necesidades del próximo viaje. Idempotente; no borra datos ni historia.
-- Cada cambio de cantidad es una fila nueva; la anterior queda 'sustituido'.
CREATE TABLE IF NOT EXISTS need_adjustments (
  id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  product_id integer NOT NULL REFERENCES products(id),
  qty integer NOT NULL CHECK (qty BETWEEN 0 AND 10000),
  unit text NOT NULL CHECK (unit IN ('cajas', 'botellas')),
  per_case integer CHECK (per_case IS NULL OR per_case > 0),
  recommended integer CHECK (recommended IS NULL OR recommended >= 0),
  status text NOT NULL DEFAULT 'activo' CHECK (status IN ('activo', 'sustituido', 'pedido')),
  created_at text NOT NULL,
  created_by text,
  closed_at text,
  closed_by text,
  trip_id integer REFERENCES trips(id),
  trip_line_id integer REFERENCES trip_lines(id),
  CHECK (unit = 'botellas' OR per_case IS NOT NULL),
  CHECK (status <> 'pedido' OR trip_line_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS need_adjustments_one_active
  ON need_adjustments (product_id) WHERE status = 'activo';
CREATE INDEX IF NOT EXISTS idx_need_adjustments_product ON need_adjustments (product_id, id);
CREATE INDEX IF NOT EXISTS idx_trip_lines_product ON trip_lines (product_id) WHERE removed = 0;

ALTER TABLE need_adjustments ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA %I FROM anon, authenticated', current_schema());
    EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA %I FROM anon, authenticated', current_schema());
  END IF;
END $$;

COMMIT;
```

Comprobación (New query, **Run**): debe salir 10.

```sql
SELECT count(*) FROM vessel_reposicion.stores;
```

## 3 · Codex: fusionar y publicar

En PowerShell, en `C:\Users\mrani\inventariovessel`, abre Codex con `codex --sandbox danger-full-access` y pega:

```
Tarea: publicar en main la rama almacen de «Vessel · Reposición». La carpeta actual es el repositorio. Las migraciones de Supabase YA las ha ejecutado el usuario a mano: tú no toques ninguna base de datos ni uses DATABASE_URL. PARA en cuanto algo no cuadre.

1. git fetch origin. Comprueba que origin/almacen tiene los commits «Fase 1: In Vessel por puntos…» y «Fase 2: pestaña Viajes con Necesidades y Pedido».
2. Comprueba que fusionar origin/almacen en origin/main no da conflictos. Si los da, PARA.
3. En una copia de origin/almacen (git worktree en tmp-capturas\publicar\wt), ejecuta npm.cmd install y npm.cmd test, sin DATABASE_URL en el entorno. Deben pasar todos salvo el de concurrencia real. Si falla alguno, PARA.
4. git switch main, git pull origin main y git merge --no-ff origin/almacen -m "Publica las fases 1 y 2: In Vessel por puntos y pestaña Viajes". Después, git push origin main. Nunca --force.
5. Espera unos 3 minutos y comprueba https://reposicion-barras.autemadmn.workers.dev: la página responde 200, y /api/auth responde 200 con JSON (no 503 «Faltan las migraciones de Supabase»). Si sigue en 503 a los 5 minutos, dímelo.
6. No hagas pedidos ni pruebas en la app publicada.
7. Informe corto y en lenguaje llano (no programo): qué has hecho, el resultado de los tests, si la web responde y qué tengo que mirar en el móvil.
```
