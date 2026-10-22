-- Reverts 035_tender_negative_values_cleanup.sql.
-- The value corrections are data fixes and are intentionally kept (the original figures are preserved in the
-- DATA_CORRECTION tender_activities metadata). Only the schema side is rolled back: the four 028 constraints return
-- to NOT VALID, and the instrument amount column gets back its NOT NULL / default 0 where no NULL amounts exist.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_tender_line_items_quantity_positive') THEN
    ALTER TABLE tender_line_items DROP CONSTRAINT chk_tender_line_items_quantity_positive;
  END IF;
  ALTER TABLE tender_line_items ADD CONSTRAINT chk_tender_line_items_quantity_positive
    CHECK (quantity IS NULL OR quantity >= 1) NOT VALID;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_tender_line_items_prices_non_negative') THEN
    ALTER TABLE tender_line_items DROP CONSTRAINT chk_tender_line_items_prices_non_negative;
  END IF;
  ALTER TABLE tender_line_items ADD CONSTRAINT chk_tender_line_items_prices_non_negative
    CHECK (
      (quoted_unit_price IS NULL OR quoted_unit_price >= 0)
      AND (quoted_total IS NULL OR quoted_total >= 0)
      AND (awarded_quantity IS NULL OR awarded_quantity >= 0)
      AND (awarded_unit_price IS NULL OR awarded_unit_price >= 0)
    ) NOT VALID;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_tender_financial_instruments_amount_positive') THEN
    ALTER TABLE tender_financial_instruments DROP CONSTRAINT chk_tender_financial_instruments_amount_positive;
  END IF;
  ALTER TABLE tender_financial_instruments ADD CONSTRAINT chk_tender_financial_instruments_amount_positive
    CHECK (amount IS NULL OR amount > 0) NOT VALID;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_tenders_estimated_value_non_negative') THEN
    ALTER TABLE tenders DROP CONSTRAINT chk_tenders_estimated_value_non_negative;
  END IF;
  ALTER TABLE tenders ADD CONSTRAINT chk_tenders_estimated_value_non_negative
    CHECK (estimated_value IS NULL OR estimated_value >= 0) NOT VALID;

  ALTER TABLE tender_financial_instruments ALTER COLUMN amount SET DEFAULT 0;
  IF NOT EXISTS (SELECT 1 FROM tender_financial_instruments WHERE amount IS NULL) THEN
    ALTER TABLE tender_financial_instruments ALTER COLUMN amount SET NOT NULL;
  END IF;
END $$;

DELETE FROM _schema_migrations WHERE name = '035_tender_negative_values_cleanup.sql';
