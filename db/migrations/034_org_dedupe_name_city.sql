-- =====================================================================
-- Migration 034: Organisation deduplication on name + city (code review R1, follow-up to 029 / QA DEF-051)
--
-- The first version of 029 enforced one organisation per normalised NAME (unique index
-- uq_organisations_name_normalised). Real accounts are units / branches of one body in different cities —
-- "Northern Railway" Delhi and "Northern Railway" Lucknow are separate customers — so the rule is one account per
-- normalised NAME + CITY (an account without a city only clashes with other accounts without a city). 029 now ships
-- that rule; this migration brings databases that already ran the original 029 to the same state.
--
-- Accounts that the original 029 merged across cities stay merged: the merge cannot be told apart from good data.
-- Re-split them by hand (rename / re-create the branch account) if any were wrongly merged.
--
-- Idempotent: safe to re-run. The name-only index is dropped if present; the name + city index is created if missing
-- (it cannot fail on existing data — every name was already unique, so every name + city pair is too).
-- =====================================================================

DROP INDEX IF EXISTS uq_organisations_name_normalised;

-- Same expressions as the API lookups (apps/api/src/modules/organisations/organisation-dedupe.ts)
CREATE UNIQUE INDEX IF NOT EXISTS uq_organisations_name_city_normalised
  ON organisations (
    lower(regexp_replace(btrim(name), '[[:space:]]+', ' ', 'g')),
    lower(regexp_replace(btrim(coalesce(city, '')), '[[:space:]]+', ' ', 'g'))
  );
