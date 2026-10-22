-- =====================================================================
-- Migration 033: Deliveries linked to the converted proposal they fulfil (QA DEF-070)
--
-- A dispatch raised "against converted proposal / PO" only kept the proposal number in remarks. deliveries.proposal_id
-- makes the link real so the proposal and the delivery register can open each other.
--
-- Idempotent: safe to re-run. Existing dispatches are back-linked from their "Proposal: PROP-…" remarks line.
-- =====================================================================

ALTER TABLE deliveries
  ADD COLUMN IF NOT EXISTS proposal_id uuid REFERENCES proposals(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_deliveries_proposal_id ON deliveries(proposal_id) WHERE proposal_id IS NOT NULL;

UPDATE deliveries d
SET proposal_id = p.id
FROM proposals p
WHERE d.proposal_id IS NULL
  AND d.remarks IS NOT NULL
  AND d.remarks ~ ('(^|\n)Proposal: ' || coalesce(p.proposal_no, p.proposal_number) || '($|\n)');
