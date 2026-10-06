-- El grupo «Zumos» pasa de Refrescos a Otros, después del grupo «Otros». Se aplica una sola
-- vez (marca 'zumos_en_otros') para respetar lo que el encargado cambie después. Si aún no
-- existen las secciones (0009), no hace nada y se aplica al repetirla. No borra datos.
BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = current_schema() AND table_name = 'product_groups' AND column_name = 'section')
     AND NOT EXISTS (SELECT 1 FROM settings WHERE key = 'zumos_en_otros') THEN
    UPDATE product_groups SET section = 'otros',
      sort = (SELECT COALESCE(MAX(o.sort), 0) FROM product_groups o) + 10
    WHERE lower(name) = 'zumos' AND section = 'refrescos';
    UPDATE settings SET value = ((value)::int + 1)::text WHERE key = 'catalog_rev';
    INSERT INTO settings (key, value) VALUES ('zumos_en_otros', '1') ON CONFLICT (key) DO NOTHING;
  END IF;
END $$;

COMMIT;
