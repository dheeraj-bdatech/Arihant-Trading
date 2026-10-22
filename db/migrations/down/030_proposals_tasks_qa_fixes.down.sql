-- Reverting migration 030 is a no-op: it only rewrote notification / task text to the register proposal number and
-- cancelled follow-up tasks of proposals that had already concluded. Neither is a schema change, and the previous
-- (incorrect) state is not worth restoring.
SELECT 1;

DELETE FROM _schema_migrations WHERE name = '030_proposals_tasks_qa_fixes.sql';
