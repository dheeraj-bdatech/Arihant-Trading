/**
 * Indian state / city reference for the lead form (QA DEF-099): the State field offers only real states / UTs, the
 * state is filled in from a well-known city, and a city typed with the wrong state is flagged before saving.
 *
 * The rules live in `@arihant/shared` (src/india-geo.ts) — the API validates with the same code.
 */
export { INDIAN_STATES, CITY_STATE, canonicalState, stateOfCity, resolveLocation } from '@arihant/shared';
