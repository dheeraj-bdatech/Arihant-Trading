-- =====================================================================
-- Migration 036: Module 4 — tender stages follow PRD §22–23 (13 stages, frozen in SCOPE_FREEZE §2.1 / MODULE_4 §2)
--
-- Migrations 011/019 seeded five stages the PRD does not have. They are folded into the PRD stage they mean:
--   PQ_NOT_QUALIFIED, TECHNICALLY_DISQUALIFIED -> LOST       (the reason is recorded as a loss reason)
--   REVERSE_AUCTION                            -> COMMERCIAL_EVALUATION (the RA is part of the price round)
--   PARTIALLY_WON                              -> WON        (the awarded value carries the partial award)
--   NOT_SUBMITTED                              -> CANCELLED  (MODULE_4: "Arihant formally dropped bid")
-- Rejected Internally is not terminal: it can be re-submitted for approval (MODULE_4 §2).
-- tender_status_history is an audit trail and is left untouched.
--
-- Idempotent: safe to re-run.
-- =====================================================================

-- 1. Live tenders on a retired stage move to the PRD stage (none expected; a trace goes on the activity timeline).
WITH moved AS (
  UPDATE tenders SET
    status = CASE status
      WHEN 'pq_not_qualified' THEN 'lost'
      WHEN 'technically_disqualified' THEN 'lost'
      WHEN 'reverse_auction' THEN 'commercial_eval'
      WHEN 'partially_won' THEN 'won'
      WHEN 'not_submitted' THEN 'cancelled'
    END,
    updated_at = now()
  WHERE status IN ('pq_not_qualified', 'technically_disqualified', 'reverse_auction', 'partially_won', 'not_submitted')
  RETURNING id, status
)
INSERT INTO tender_activities (tender_id, event_type, description, metadata)
SELECT id, 'DATA_CORRECTION', 'Stage mapped to the PRD tender stages (migration 036)', jsonb_build_object('new_status', status)
FROM moved;

UPDATE tender_outcomes SET result = 'won' WHERE lower(result) = 'partially_won';
UPDATE tender_results SET result = 'WON' WHERE upper(result) = 'PARTIALLY_WON';

-- 2. The stage lookup holds exactly the 13 PRD stages, in PRD order.
DELETE FROM tender_statuses
WHERE code IN ('PQ_NOT_QUALIFIED', 'TECHNICALLY_DISQUALIFIED', 'REVERSE_AUCTION', 'PARTIALLY_WON', 'NOT_SUBMITTED');

UPDATE tender_statuses AS ts SET sort_order = v.sort_order, is_terminal = v.is_terminal, updated_at = now()
FROM (VALUES
  ('IDENTIFIED', 1, false),
  ('AWAITING_INTERNAL_APPROVAL', 2, false),
  ('REJECTED_INTERNALLY', 3, false),
  ('UNDER_PREPARATION', 4, false),
  ('PQ_SUBMITTED', 5, false),
  ('PQ_QUALIFIED', 6, false),
  ('TENDER_SUBMITTED', 7, false),
  ('TECHNICAL_EVALUATION', 8, false),
  ('COMMERCIAL_EVALUATION', 9, false),
  ('WON', 10, true),
  ('LOST', 11, true),
  ('CANCELLED', 12, true),
  ('ON_HOLD', 13, false)
) AS v(code, sort_order, is_terminal)
WHERE ts.code = v.code;
