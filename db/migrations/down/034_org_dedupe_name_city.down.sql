-- Reverts 034_org_dedupe_name_city.sql: back to the original 029's one-organisation-per-name index.
-- The name-only index is restored only when no two organisations share a normalised name (same-name branches in
-- different cities registered since 034 would make it fail); otherwise the name + city index is kept and a notice
-- is raised, so the database is never left without a duplicate guard.
-- Idempotent: safe to re-run.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM organisations
     GROUP BY lower(regexp_replace(btrim(name), '[[:space:]]+', ' ', 'g'))
    HAVING count(*) > 1
  ) THEN
    RAISE NOTICE '034 down: organisations sharing a name exist in different cities — keeping uq_organisations_name_city_normalised';
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS uq_organisations_name_normalised
      ON organisations (lower(regexp_replace(btrim(name), '[[:space:]]+', ' ', 'g')));
    DROP INDEX IF EXISTS uq_organisations_name_city_normalised;
  END IF;
END $$;

DELETE FROM _schema_migrations WHERE name = '034_org_dedupe_name_city.sql';
