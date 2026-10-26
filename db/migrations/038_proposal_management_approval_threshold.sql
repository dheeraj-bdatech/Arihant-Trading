-- =====================================================================
-- Migration 038: Module 5 — only major proposals go to Management for approval
--
-- A proposal whose quoted value is at or above management_approval_threshold (default ₹10,00,000) is approved by
-- Management / Admin; below it, by the Regional Manager of the customer's region (Management when that region has no
-- active Regional Manager). Editable in proposal settings.
-- Idempotent: safe to re-run.
-- =====================================================================

ALTER TABLE proposal_settings
  ADD COLUMN IF NOT EXISTS management_approval_threshold numeric(14, 2) NOT NULL DEFAULT 1000000
  CHECK (management_approval_threshold >= 0);
