-- La columna per_case existe desde 0001. Validamos su dominio sin alterar los
-- valores existentes ni crear una columna duplicada. NULL significa sin confirmar.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'products'::regclass AND conname = 'products_per_case_range'
  ) THEN
    ALTER TABLE products ADD CONSTRAINT products_per_case_range
      CHECK (per_case IS NULL OR per_case BETWEEN 1 AND 10000) NOT VALID;
  END IF;
END $$;
