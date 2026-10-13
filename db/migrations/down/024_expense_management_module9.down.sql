-- Reverts migration 024 (Module 9 — Expense Management).
-- Run manually:  docker exec -i arihant_bos_db psql -U postgres -d postgres < db/migrations/down/024_expense_management_module9.down.sql
-- The legacy `expenses` table was never modified, so legacy data is intact after this runs.
-- Receipt files under EXPENSE_STORAGE_DIR are not removed.
BEGIN;
DROP TRIGGER IF EXISTS trg_expense_history_immutable ON expense_approval_history;
DROP TABLE IF EXISTS expense_approval_history;
DROP TABLE IF EXISTS expense_attachments;
DROP TABLE IF EXISTS expense_items;
DROP TABLE IF EXISTS expense_claims;
DROP SEQUENCE IF EXISTS expense_claim_number_seq;
DROP TABLE IF EXISTS expense_categories;
DROP TABLE IF EXISTS projects;
DROP FUNCTION IF EXISTS expense_history_immutable();
DROP INDEX IF EXISTS users_employee_code_key;
ALTER TABLE users DROP COLUMN IF EXISTS employee_code;
DELETE FROM _schema_migrations WHERE name = '024_expense_management_module9.sql';
COMMIT;
