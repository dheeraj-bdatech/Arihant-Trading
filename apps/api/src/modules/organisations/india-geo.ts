/**
 * Indian state / city reference (QA DEF-051, DEF-099) — lives in `@arihant/shared` (src/india-geo.ts) so the API and
 * the web lead form apply exactly the same rules. Re-exported here for the organisations / leads modules.
 */
export { INDIAN_STATES, CITY_STATE, canonicalState, stateOfCity, resolveLocation } from '@arihant/shared';
