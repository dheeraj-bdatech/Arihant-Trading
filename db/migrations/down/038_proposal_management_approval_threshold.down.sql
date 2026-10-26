-- Reverts 038_proposal_management_approval_threshold.sql.
ALTER TABLE proposal_settings DROP COLUMN IF EXISTS management_approval_threshold;
