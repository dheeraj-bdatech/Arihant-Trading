-- Reverts 032_field_ops_qa_fixes.sql.
-- Both parts of 032 are data corrections (zero-padded ticket numbers, backfilled SLA deadlines) with no schema
-- change; the original short numbers / missing deadlines are not recorded, so there is nothing safe to undo.
-- Rolling back only forgets that the migration ran.
DELETE FROM _schema_migrations WHERE name = '032_field_ops_qa_fixes.sql';
