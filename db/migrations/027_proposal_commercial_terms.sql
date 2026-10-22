-- =====================================================================
-- Migration 027: Module 5 — Proposal commercial terms (QA DEF-029, DEF-081)
--
-- Commercial price quotes were approved with no commercial value: the proposals table had no price, quantity,
-- margin or validity columns. BOS does not generate quotations (Blueprint: automated pricing is out of scope), but the
-- quote that was prepared offline must be recorded so management approves a priced, termed proposal.
--
--   quoted_value    total quoted amount in ₹ (required > 0 before review / approval — enforced in the API)
--   quantity        units quoted
--   margin_percent  internal margin on the quote (%)
--   validity_date   date until which the quote is valid
--   payment_terms   e.g. "90% on delivery, 10% after installation"
--   delivery_terms  e.g. "F.O.R destination within 60 days"
--
-- Idempotent: safe to re-run. Existing rows keep NULL commercial values (legacy / pre-pricing proposals).
-- =====================================================================

ALTER TABLE proposals
  ADD COLUMN IF NOT EXISTS quoted_value numeric(14, 2),
  ADD COLUMN IF NOT EXISTS quantity integer,
  ADD COLUMN IF NOT EXISTS margin_percent numeric(5, 2),
  ADD COLUMN IF NOT EXISTS validity_date date,
  ADD COLUMN IF NOT EXISTS payment_terms text,
  ADD COLUMN IF NOT EXISTS delivery_terms text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_proposals_quoted_value_non_negative') THEN
    ALTER TABLE proposals ADD CONSTRAINT chk_proposals_quoted_value_non_negative
      CHECK (quoted_value IS NULL OR quoted_value >= 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_proposals_quantity_positive') THEN
    ALTER TABLE proposals ADD CONSTRAINT chk_proposals_quantity_positive
      CHECK (quantity IS NULL OR quantity > 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_proposals_margin_percent_range') THEN
    ALTER TABLE proposals ADD CONSTRAINT chk_proposals_margin_percent_range
      CHECK (margin_percent IS NULL OR (margin_percent >= -100 AND margin_percent <= 100));
  END IF;
END $$;

-- Proposals raised from a lead (lead detail → linked proposals, DEF-081)
CREATE INDEX IF NOT EXISTS idx_proposals_lead_id ON proposals(lead_id) WHERE is_deleted = false;
