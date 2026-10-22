-- Reverts 027_proposal_commercial_terms.sql (drops the recorded commercial terms).
DROP INDEX IF EXISTS idx_proposals_lead_id;

ALTER TABLE proposals DROP CONSTRAINT IF EXISTS chk_proposals_margin_percent_range;
ALTER TABLE proposals DROP CONSTRAINT IF EXISTS chk_proposals_quantity_positive;
ALTER TABLE proposals DROP CONSTRAINT IF EXISTS chk_proposals_quoted_value_non_negative;

ALTER TABLE proposals
  DROP COLUMN IF EXISTS delivery_terms,
  DROP COLUMN IF EXISTS payment_terms,
  DROP COLUMN IF EXISTS validity_date,
  DROP COLUMN IF EXISTS margin_percent,
  DROP COLUMN IF EXISTS quantity,
  DROP COLUMN IF EXISTS quoted_value;

DELETE FROM _schema_migrations WHERE name = '027_proposal_commercial_terms.sql';
