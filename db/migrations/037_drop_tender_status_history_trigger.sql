-- =====================================================================
-- Migration 037: drop the tender status-history trigger (audit accuracy, Blueprint §47)
--
-- trg_tender_status_history_logger (migration 019) wrote a second tender_status_history row on every status change,
-- credited to the tender's CREATOR (new.created_by) instead of the user who made the change. Every status change in
-- the API (transition, hold / resume, reopen, record result) already writes its own history row with the real actor,
-- so the trigger only produced duplicate, misattributed rows.
--
-- Existing rows are left untouched: the history is an audit trail. The trigger rows are recognisable by their remark
-- "Status transitioned from <OLD> to <NEW>" and upper-case codes.
-- Idempotent: safe to re-run.
-- =====================================================================

DROP TRIGGER IF EXISTS trg_tender_status_history_logger ON tenders;
DROP FUNCTION IF EXISTS trg_tender_status_history_logger();
