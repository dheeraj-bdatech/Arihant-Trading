/**
 * Organisation deduplication rule (Module 1 §3.1, QA DEF-051, DEF-012).
 *
 * One account per normalised NAME + CITY: names / cities are compared trimmed, inner whitespace collapsed and
 * case-insensitively. Units of the same body in different cities ("Northern Railway", Delhi vs Lucknow) are separate
 * accounts; an organisation recorded without a city only matches other organisations without a city.
 *
 * The SQL expressions below are exactly the ones indexed by `uq_organisations_name_city_normalised`
 * (db/migrations/029 + 034), so the lookups use the index and the database enforces the same rule.
 */
import { ConflictException } from '@nestjs/common';
import { sql, type RawBuilder } from 'kysely';

/** Unique index enforcing the rule, and the name-only index it replaced (present until migration 034 runs). */
export const ORG_NAME_CITY_INDEX = 'uq_organisations_name_city_normalised';
const LEGACY_ORG_NAME_INDEX = 'uq_organisations_name_normalised';

/** Display form: trimmed, inner whitespace collapsed. */
export const cleanOrgText = (value: string | null | undefined) => (value || '').trim().replace(/\s+/g, ' ');

/** Organisation name as compared for deduplication: trimmed, inner whitespace collapsed, case-insensitive. */
export const normalisedOrgName = (name: string) => cleanOrgText(name).toLowerCase();

/** City as compared for deduplication; null / blank compare as '' (no city). */
export const normalisedOrgCity = (city: string | null | undefined) => cleanOrgText(city).toLowerCase();

/**
 * `<alias>.name` / `<alias>.city` match the given account name and city under the dedupe rule.
 * `alias` is a fixed table name / alias from our own code, never user input.
 */
export function sameOrgNameAndCity(name: string, city: string | null | undefined, alias = 'organisations'): RawBuilder<boolean> {
  const t = sql.ref(alias);
  return sql<boolean>`(
    lower(regexp_replace(btrim(${t}.name), '[[:space:]]+', ' ', 'g')) = ${normalisedOrgName(name)}
    and lower(regexp_replace(btrim(coalesce(${t}.city, '')), '[[:space:]]+', ' ', 'g')) = ${normalisedOrgCity(city)}
  )`;
}

/** Advisory-lock key serialising work on one (name, city) account. */
export const orgDedupeLockKey = (name: string, city: string | null | undefined) =>
  `org:${normalisedOrgName(name)}|${normalisedOrgCity(city)}`;

/** True when a Postgres error is a unique violation of the organisation name (+ city) index. */
export function isOrgDuplicateError(err: unknown): boolean {
  const e = err as { code?: string; constraint?: string } | null;
  return Boolean(e && e.code === '23505' && (e.constraint === ORG_NAME_CITY_INDEX || e.constraint === LEGACY_ORG_NAME_INDEX));
}

/** Friendly 409 for a name + city that already exists (the global filter would otherwise echo Postgres `detail`). */
export function orgDuplicateConflict(name: string, city: string | null | undefined): ConflictException {
  const where = cleanOrgText(city);
  return new ConflictException(
    `An organisation named ${cleanOrgText(name)}${where ? ` in ${where}` : ' with no city'} already exists — pick it from the list.`,
  );
}
