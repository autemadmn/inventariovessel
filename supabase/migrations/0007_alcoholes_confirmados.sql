-- Quita la marca «Dudoso» (estado 'pendiente') de todos los alcoholes: ya se
-- han identificado con fotos del local (docs/catalogo/productos-identificados.md).
-- Se aplica una sola vez (marca 'alcoholes_confirmados'), para no confirmar
-- productos que se creen más adelante como «Por confirmar». No borra datos.
BEGIN;

UPDATE products SET status = 'confirmado', note = NULL, updated_at = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
WHERE status = 'pendiente'
  AND category NOT IN ('cerveza', 'refresco')
  AND NOT EXISTS (SELECT 1 FROM settings WHERE key = 'alcoholes_confirmados');

-- Las pantallas abiertas recargan el catálogo.
UPDATE settings SET value = ((value)::int + 1)::text
WHERE key = 'catalog_rev'
  AND NOT EXISTS (SELECT 1 FROM settings WHERE key = 'alcoholes_confirmados');

INSERT INTO settings (key, value) VALUES ('alcoholes_confirmados', '1') ON CONFLICT (key) DO NOTHING;

COMMIT;
