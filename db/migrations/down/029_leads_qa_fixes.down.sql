-- Reverts 029_leads_qa_fixes.sql (drops the guards it added).
-- The data corrections (merged duplicate organisations, corrected states, cleared negative values) are not undone:
-- the duplicates and the wrong values cannot be told apart from good data once merged / corrected.
ALTER TABLE leads DROP CONSTRAINT IF EXISTS chk_leads_value_lakh_non_negative;

DROP INDEX IF EXISTS uq_organisations_name_city_normalised;
DROP INDEX IF EXISTS uq_organisations_name_normalised; -- name-only index created by the original 029 (see 034)

DELETE FROM _schema_migrations WHERE name = '029_leads_qa_fixes.sql';
