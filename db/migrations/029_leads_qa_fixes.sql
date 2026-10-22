-- =====================================================================
-- Migration 029: Module 1 — Leads / Customer Register QA corrections (QA DEF-011, DEF-012, DEF-051, DEF-099)
--
-- 1. Duplicate organisations (DEF-051): accounts whose name AND city differ only by case / spacing are merged into the
--    oldest record. Units of the same body in different cities ("Northern Railway" Delhi vs Lucknow) are separate
--    accounts and are not merged; an account without a city only merges with others without a city. Every foreign
--    key that points at organisations(id) is re-pointed to the surviving account (found through pg_constraint, so
--    tables added by later modules are covered too); the survivor keeps its own values and only fills empty
--    location / sector fields from the duplicates. A unique index on (normalised name, normalised city) then stops
--    new duplicates (double-submitted lead forms, DEF-012, included).
-- 2. City / state mismatches (DEF-051, DEF-099): organisations in a well-known city whose state was recorded wrongly
--    (e.g. 'Lucknow, Delhi') get the city's real state. Only unambiguous city names are corrected; others are left.
-- 3. Negative deal values (DEF-011): a negative estimated value is not a value — it is cleared (NULL) and a CHECK
--    constraint keeps leads.value_lakh non-negative. The API additionally requires a positive value.
--
-- Idempotent: safe to re-run (merging finds nothing, updates match nothing, index / constraint use IF NOT EXISTS).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Merge duplicate organisations, then enforce one account per name + city
-- ---------------------------------------------------------------------
DO $$
DECLARE
  grp record;
  dup_id uuid;
  fk record;
  merged integer := 0;
BEGIN
  FOR grp IN
    SELECT (array_agg(id ORDER BY created_at, id))[1] AS keep_id,
           (array_agg(id ORDER BY created_at, id))[2:] AS dup_ids,
           min(name) AS name
      FROM organisations
     GROUP BY lower(regexp_replace(btrim(name), '[[:space:]]+', ' ', 'g')),
              lower(regexp_replace(btrim(coalesce(city, '')), '[[:space:]]+', ' ', 'g'))
    HAVING count(*) > 1
  LOOP
    -- The survivor keeps its own values; empty fields are filled from the duplicates (oldest first).
    UPDATE organisations o
       SET city       = coalesce(o.city,       d.city),
           state      = coalesce(o.state,      d.state),
           zone_id    = coalesce(o.zone_id,    d.zone_id),
           region_id  = coalesce(o.region_id,  d.region_id),
           sector     = coalesce(o.sector,     d.sector),
           department = coalesce(o.department, d.department),
           address    = coalesce(o.address,    d.address),
           updated_at = now()
      FROM (
        SELECT (array_agg(city       ORDER BY created_at) FILTER (WHERE city       IS NOT NULL))[1] AS city,
               (array_agg(state      ORDER BY created_at) FILTER (WHERE state      IS NOT NULL))[1] AS state,
               (array_agg(zone_id    ORDER BY created_at) FILTER (WHERE zone_id    IS NOT NULL))[1] AS zone_id,
               (array_agg(region_id  ORDER BY created_at) FILTER (WHERE region_id  IS NOT NULL))[1] AS region_id,
               (array_agg(sector     ORDER BY created_at) FILTER (WHERE sector     IS NOT NULL))[1] AS sector,
               (array_agg(department ORDER BY created_at) FILTER (WHERE department IS NOT NULL))[1] AS department,
               (array_agg(address    ORDER BY created_at) FILTER (WHERE address    IS NOT NULL))[1] AS address
          FROM organisations
         WHERE id = ANY (grp.dup_ids)
      ) d
     WHERE o.id = grp.keep_id;

    FOREACH dup_id IN ARRAY grp.dup_ids LOOP
      FOR fk IN
        SELECT c.conrelid::regclass AS tbl, a.attname AS col
          FROM pg_constraint c
          JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
         WHERE c.contype = 'f'
           AND c.confrelid = 'organisations'::regclass
           AND array_length(c.conkey, 1) = 1
      LOOP
        EXECUTE format('UPDATE %s SET %I = $1 WHERE %I = $2', fk.tbl, fk.col, fk.col) USING grp.keep_id, dup_id;
      END LOOP;
      DELETE FROM organisations WHERE id = dup_id;
      merged := merged + 1;
    END LOOP;

    RAISE NOTICE '029: merged % duplicate(s) of organisation "%" into %', array_length(grp.dup_ids, 1), grp.name, grp.keep_id;
  END LOOP;

  IF merged > 0 THEN
    RAISE NOTICE '029: % duplicate organisation record(s) merged', merged;
  END IF;
END $$;

-- Same expressions as the API lookups (apps/api/src/modules/organisations/organisation-dedupe.ts)
CREATE UNIQUE INDEX IF NOT EXISTS uq_organisations_name_city_normalised
  ON organisations (
    lower(regexp_replace(btrim(name), '[[:space:]]+', ' ', 'g')),
    lower(regexp_replace(btrim(coalesce(city, '')), '[[:space:]]+', ' ', 'g'))
  );

-- ---------------------------------------------------------------------
-- 2. Correct the state of organisations located in a well-known city
-- ---------------------------------------------------------------------
-- 'Kota Rajasthan' was typed into the city field: split it into its city and state.
UPDATE organisations
   SET city = 'Kota', state = 'Rajasthan', updated_at = now()
 WHERE lower(btrim(city)) IN ('kota rajasthan', 'kota, rajasthan');

UPDATE organisations o
   SET state = m.state, updated_at = now()
  FROM (VALUES
    ('lucknow', 'Uttar Pradesh'), ('agra', 'Uttar Pradesh'), ('saharanpur', 'Uttar Pradesh'), ('kanpur', 'Uttar Pradesh'),
    ('varanasi', 'Uttar Pradesh'), ('meerut', 'Uttar Pradesh'), ('noida', 'Uttar Pradesh'), ('ghaziabad', 'Uttar Pradesh'),
    ('gorakhpur', 'Uttar Pradesh'), ('prayagraj', 'Uttar Pradesh'), ('jhansi', 'Uttar Pradesh'),
    ('jodhpur', 'Rajasthan'), ('udaipur', 'Rajasthan'), ('kota', 'Rajasthan'), ('jaipur', 'Rajasthan'),
    ('bikaner', 'Rajasthan'), ('jaisalmer', 'Rajasthan'), ('ajmer', 'Rajasthan'),
    ('panchkula', 'Haryana'), ('gurugram', 'Haryana'), ('gurgaon', 'Haryana'), ('faridabad', 'Haryana'), ('ambala', 'Haryana'),
    ('dehradun', 'Uttarakhand'), ('haridwar', 'Uttarakhand'), ('roorkee', 'Uttarakhand'),
    ('chandigarh', 'Chandigarh'), ('shimla', 'Himachal Pradesh'), ('amritsar', 'Punjab'), ('ludhiana', 'Punjab'),
    ('srinagar', 'Jammu & Kashmir'), ('jammu', 'Jammu & Kashmir'), ('leh', 'Ladakh'),
    ('patna', 'Bihar'), ('ranchi', 'Jharkhand'), ('bhubaneswar', 'Odisha'), ('kolkata', 'West Bengal'),
    ('guwahati', 'Assam'), ('sonitpur', 'Assam'), ('tezpur', 'Assam'),
    ('aizawl', 'Mizoram'), ('khatla', 'Mizoram'), ('shillong', 'Meghalaya'), ('imphal', 'Manipur'),
    ('kohima', 'Nagaland'), ('agartala', 'Tripura'), ('itanagar', 'Arunachal Pradesh'), ('gangtok', 'Sikkim'),
    ('mumbai', 'Maharashtra'), ('pune', 'Maharashtra'), ('nagpur', 'Maharashtra'), ('ahmedabad', 'Gujarat'),
    ('gandhinagar', 'Gujarat'), ('bhopal', 'Madhya Pradesh'), ('indore', 'Madhya Pradesh'), ('gwalior', 'Madhya Pradesh'),
    ('raipur', 'Chhattisgarh'), ('bengaluru', 'Karnataka'), ('bangalore', 'Karnataka'), ('chennai', 'Tamil Nadu'),
    ('hyderabad', 'Telangana'), ('secunderabad', 'Telangana'), ('visakhapatnam', 'Andhra Pradesh'),
    ('thiruvananthapuram', 'Kerala'), ('kochi', 'Kerala'),
    ('new delhi', 'Delhi'), ('delhi', 'Delhi')
  ) AS m(city, state)
 WHERE lower(btrim(o.city)) = m.city
   AND o.state IS DISTINCT FROM m.state;

-- ---------------------------------------------------------------------
-- 3. Lead values are never negative
-- ---------------------------------------------------------------------
UPDATE leads SET value_lakh = NULL, updated_at = now() WHERE value_lakh < 0;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_leads_value_lakh_non_negative') THEN
    ALTER TABLE leads ADD CONSTRAINT chk_leads_value_lakh_non_negative CHECK (value_lakh IS NULL OR value_lakh >= 0);
  END IF;
END $$;
