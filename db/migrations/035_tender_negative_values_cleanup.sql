-- =====================================================================
-- Migration 035: Module 4 — clean legacy negative tender values and VALIDATE the 028 CHECK constraints (QA R7)
--
-- 028 added the money / quantity CHECK constraints NOT VALID. Postgres still checks a NOT VALID constraint on every
-- UPDATE of an existing row, so legacy violating rows (QA: EMD of -25000, a BOQ line of quantity -5) could never be
-- edited again — not even to correct them. This migration corrects every violating row, records what it changed, and
-- then VALIDATEs the four constraints so the rule holds for old and new rows alike.
--
-- Corrections (values are never guessed into a "real" figure without a trace):
--   * tender_line_items  : quantity < 1            -> 1, quoted_total recomputed from quoted_unit_price
--                          negative quoted_unit_price / quoted_total / awarded_quantity / awarded_unit_price -> NULL
--                          (quoted_total is recomputed from a valid unit price where one exists)
--   * tenders            : negative estimated_value -> NULL (value unknown; to be re-entered)
--   * tender_financial_instruments.amount is NOT NULL:
--                          negative amount -> its absolute value (sign-entry error), remarks flag the original figure
--                          zero amount     -> NULL (the column default of 0 itself violated the > 0 rule; the default is
--                          dropped and the column made nullable, which the 028 check already allows), remarks flagged
--   Every corrected row gets a DATA_CORRECTION entry on its tender's activity timeline (metadata keeps the old values),
--   so Finance / the tender team can see what changed and verify it.
--
-- Idempotent: safe to re-run (corrections only touch violating rows; VALIDATE on a validated constraint is a no-op).
-- =====================================================================

-- 0. Instrument amount: the default 0 can never satisfy "amount > 0"; nullable so an unknown amount is NULL, not 0.
ALTER TABLE tender_financial_instruments ALTER COLUMN amount DROP DEFAULT;
ALTER TABLE tender_financial_instruments ALTER COLUMN amount DROP NOT NULL;

-- 1. BOQ line items ------------------------------------------------------------------------------------------------
WITH bad AS (
  SELECT id, tender_id, quantity, quoted_unit_price, quoted_total, awarded_quantity, awarded_unit_price
    FROM tender_line_items
   WHERE (quantity IS NOT NULL AND quantity < 1)
      OR (quoted_unit_price IS NOT NULL AND quoted_unit_price < 0)
      OR (quoted_total IS NOT NULL AND quoted_total < 0)
      OR (awarded_quantity IS NOT NULL AND awarded_quantity < 0)
      OR (awarded_unit_price IS NOT NULL AND awarded_unit_price < 0)
),
logged AS (
  INSERT INTO tender_activities (tender_id, event_type, description, performed_by, metadata)
  SELECT b.tender_id,
         'DATA_CORRECTION',
         'Migration 035: invalid BOQ line values corrected (quantity < 1 set to 1, negative prices cleared). Please re-check this line item.',
         NULL,
         jsonb_build_object(
           'table', 'tender_line_items',
           'line_item_id', b.id,
           'old', jsonb_build_object(
             'quantity', b.quantity,
             'quoted_unit_price', b.quoted_unit_price,
             'quoted_total', b.quoted_total,
             'awarded_quantity', b.awarded_quantity,
             'awarded_unit_price', b.awarded_unit_price
           )
         )
    FROM bad b
  RETURNING 1
)
UPDATE tender_line_items li
   SET quantity = CASE WHEN li.quantity IS NOT NULL AND li.quantity < 1 THEN 1 ELSE li.quantity END,
       quoted_unit_price = CASE WHEN li.quoted_unit_price < 0 THEN NULL ELSE li.quoted_unit_price END,
       quoted_total = CASE
         WHEN li.quoted_unit_price IS NOT NULL AND li.quoted_unit_price >= 0
           THEN li.quoted_unit_price * (CASE WHEN li.quantity IS NOT NULL AND li.quantity < 1 THEN 1 ELSE coalesce(li.quantity, 1) END)
         WHEN li.quoted_total < 0 THEN NULL
         ELSE li.quoted_total
       END,
       awarded_quantity = CASE WHEN li.awarded_quantity < 0 THEN NULL ELSE li.awarded_quantity END,
       awarded_unit_price = CASE WHEN li.awarded_unit_price < 0 THEN NULL ELSE li.awarded_unit_price END,
       updated_at = now()
  FROM bad b
 WHERE li.id = b.id;

-- 2. Tender estimated value ----------------------------------------------------------------------------------------
WITH bad AS (
  SELECT id, estimated_value FROM tenders WHERE estimated_value IS NOT NULL AND estimated_value < 0
),
logged AS (
  INSERT INTO tender_activities (tender_id, event_type, description, performed_by, metadata)
  SELECT b.id,
         'DATA_CORRECTION',
         'Migration 035: negative estimated value cleared. Please re-enter the estimated bid value.',
         NULL,
         jsonb_build_object('table', 'tenders', 'old', jsonb_build_object('estimated_value', b.estimated_value))
    FROM bad b
  RETURNING 1
)
UPDATE tenders t
   SET estimated_value = NULL
  FROM bad b
 WHERE t.id = b.id;

-- 3. Financial instruments (EMD / PBG / fees) ----------------------------------------------------------------------
WITH bad AS (
  SELECT id, tender_id, instrument_type, amount, status
    FROM tender_financial_instruments
   WHERE amount IS NOT NULL AND amount <= 0
),
logged AS (
  INSERT INTO tender_activities (tender_id, event_type, description, performed_by, metadata)
  SELECT b.tender_id,
         'DATA_CORRECTION',
         CASE WHEN b.amount < 0
           THEN 'Migration 035: ' || b.instrument_type || ' amount was recorded as ' || b.amount::text
                || ' (negative); stored as ' || abs(b.amount)::text || '. Finance to verify against the instrument.'
           ELSE 'Migration 035: ' || b.instrument_type || ' amount was recorded as 0; cleared. Finance to enter the actual amount.'
         END,
         NULL,
         jsonb_build_object('table', 'tender_financial_instruments', 'instrument_id', b.id,
                            'old', jsonb_build_object('amount', b.amount, 'status', b.status))
    FROM bad b
  RETURNING 1
)
UPDATE tender_financial_instruments fi
   SET amount = CASE WHEN b.amount < 0 THEN abs(b.amount) ELSE NULL END,
       remarks = concat_ws(E'\n', nullif(fi.remarks, ''),
         CASE WHEN b.amount < 0
           THEN '[Data correction 035] Amount was recorded as ' || b.amount::text || ' (negative); corrected to '
                || abs(b.amount)::text || '. Finance to verify.'
           ELSE '[Data correction 035] Amount was recorded as 0; cleared. Finance to enter the actual amount.'
         END),
       updated_at = now()
  FROM bad b
 WHERE fi.id = b.id;

-- 4. Validate the 028 constraints (every existing row now satisfies them) ------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_tender_line_items_quantity_positive' AND NOT convalidated) THEN
    ALTER TABLE tender_line_items VALIDATE CONSTRAINT chk_tender_line_items_quantity_positive;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_tender_line_items_prices_non_negative' AND NOT convalidated) THEN
    ALTER TABLE tender_line_items VALIDATE CONSTRAINT chk_tender_line_items_prices_non_negative;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_tender_financial_instruments_amount_positive' AND NOT convalidated) THEN
    ALTER TABLE tender_financial_instruments VALIDATE CONSTRAINT chk_tender_financial_instruments_amount_positive;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_tenders_estimated_value_non_negative' AND NOT convalidated) THEN
    ALTER TABLE tenders VALIDATE CONSTRAINT chk_tenders_estimated_value_non_negative;
  END IF;
END $$;
