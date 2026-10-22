-- Reverts 028_tenders_qa_fixes.sql.
-- The sequence resync and the WITHDRAWN approval rows are data corrections and are intentionally kept
-- (rolling them back would re-introduce reference collisions and stale "pending" approval rounds).
ALTER TABLE tenders DROP CONSTRAINT IF EXISTS chk_tenders_estimated_value_non_negative;
ALTER TABLE tender_financial_instruments DROP CONSTRAINT IF EXISTS chk_tender_financial_instruments_amount_positive;
ALTER TABLE tender_line_items DROP CONSTRAINT IF EXISTS chk_tender_line_items_prices_non_negative;
ALTER TABLE tender_line_items DROP CONSTRAINT IF EXISTS chk_tender_line_items_quantity_positive;

-- Restore the original (non collision-safe) generator from 019.
CREATE OR REPLACE FUNCTION generate_tender_internal_ref()
RETURNS text AS $$
DECLARE
  curr_year text := to_char(current_date, 'YYYY');
  next_val bigint;
BEGIN
  next_val := nextval('tender_internal_ref_seq');
  RETURN 'TND-' || curr_year || '-' || lpad(next_val::text, 5, '0');
END;
$$ LANGUAGE plpgsql;

DELETE FROM _schema_migrations WHERE name = '028_tenders_qa_fixes.sql';
