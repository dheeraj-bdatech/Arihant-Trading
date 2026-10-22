/**
 * Indian state / city reference shared by the API and the web lead form (QA DEF-010, DEF-051, DEF-099).
 *
 * States / UTs come from the frozen PORTAL_STATES list. The city map covers the cities BOS customers are based in; a
 * city that is not listed is accepted with any valid state, a listed city must match its state. Cities whose name
 * exists in more than one state (Aurangabad, Bilaspur, Hamirpur, Pratapgarh …) are left out.
 *
 * Single source of truth: the API validates organisation locations and the lead form pre-checks them with the same
 * rules, so the two can no longer drift.
 */
import { PORTAL_STATES } from './service-workflow.js';

/** Indian mobile: 10 digits starting 6-9, optionally prefixed +91 / 91 / 0; spaces and hyphens are allowed between groups. */
export const INDIAN_MOBILE_PATTERN = /^(?:\+?91[\s-]?|0)?[6-9](?:[\s-]?\d){9}$/;

/** Lower-case, '&' → 'and', letters only — so "Jammu and Kashmir", "jammu & kashmir" and "J & K" style input align. */
const key = (value: string) =>
  value
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z]/g, '');

export const INDIAN_STATES: string[] = PORTAL_STATES.map((s) => s.name);

const STATE_ALIASES: Record<string, string> = {
  newdelhi: 'Delhi',
  nctofdelhi: 'Delhi',
  delhincr: 'Delhi',
  orissa: 'Odisha',
  uttaranchal: 'Uttarakhand',
  pondicherry: 'Puducherry',
  jandk: 'Jammu & Kashmir',
  andamanandnicobar: 'Andaman & Nicobar Islands',
  dadraandnagarhaveli: 'Dadra & Nagar Haveli and Daman & Diu',
  damananddiu: 'Dadra & Nagar Haveli and Daman & Diu',
  up: 'Uttar Pradesh',
  mp: 'Madhya Pradesh',
};

const STATE_BY_KEY = new Map<string, string>([
  ...INDIAN_STATES.map((name) => [key(name), name] as [string, string]),
  ...Object.entries(STATE_ALIASES),
]);

/** City → state for the cities BOS customers are based in (unambiguous names only). */
export const CITY_STATE: Record<string, string> = {
  // Delhi / NCR
  delhi: 'Delhi', newdelhi: 'Delhi',
  gurugram: 'Haryana', gurgaon: 'Haryana', faridabad: 'Haryana', panchkula: 'Haryana', ambala: 'Haryana',
  hisar: 'Haryana', karnal: 'Haryana', rohtak: 'Haryana', panipat: 'Haryana', sonipat: 'Haryana',
  noida: 'Uttar Pradesh', greaternoida: 'Uttar Pradesh', ghaziabad: 'Uttar Pradesh',
  // Uttar Pradesh
  lucknow: 'Uttar Pradesh', agra: 'Uttar Pradesh', kanpur: 'Uttar Pradesh', varanasi: 'Uttar Pradesh',
  prayagraj: 'Uttar Pradesh', allahabad: 'Uttar Pradesh', meerut: 'Uttar Pradesh', saharanpur: 'Uttar Pradesh',
  gorakhpur: 'Uttar Pradesh', bareilly: 'Uttar Pradesh', aligarh: 'Uttar Pradesh', jhansi: 'Uttar Pradesh',
  moradabad: 'Uttar Pradesh', mathura: 'Uttar Pradesh', ayodhya: 'Uttar Pradesh',
  // Uttarakhand / Himachal / Punjab / Chandigarh / J&K / Ladakh
  dehradun: 'Uttarakhand', haridwar: 'Uttarakhand', roorkee: 'Uttarakhand', haldwani: 'Uttarakhand',
  nainital: 'Uttarakhand', shimla: 'Himachal Pradesh', dharamshala: 'Himachal Pradesh', mandi: 'Himachal Pradesh',
  chandigarh: 'Chandigarh', ludhiana: 'Punjab', amritsar: 'Punjab', jalandhar: 'Punjab', patiala: 'Punjab',
  bathinda: 'Punjab', pathankot: 'Punjab', mohali: 'Punjab',
  srinagar: 'Jammu & Kashmir', jammu: 'Jammu & Kashmir', udhampur: 'Jammu & Kashmir', leh: 'Ladakh', kargil: 'Ladakh',
  // Rajasthan
  jaipur: 'Rajasthan', jodhpur: 'Rajasthan', udaipur: 'Rajasthan', kota: 'Rajasthan', ajmer: 'Rajasthan',
  bikaner: 'Rajasthan', jaisalmer: 'Rajasthan', alwar: 'Rajasthan', barmer: 'Rajasthan', sriganganagar: 'Rajasthan',
  // Bihar / Jharkhand / Odisha / West Bengal
  patna: 'Bihar', gaya: 'Bihar', muzaffarpur: 'Bihar', bhagalpur: 'Bihar', darbhanga: 'Bihar', purnia: 'Bihar',
  ranchi: 'Jharkhand', jamshedpur: 'Jharkhand', dhanbad: 'Jharkhand', bokaro: 'Jharkhand',
  bhubaneswar: 'Odisha', cuttack: 'Odisha', rourkela: 'Odisha', puri: 'Odisha', sambalpur: 'Odisha',
  kolkata: 'West Bengal', howrah: 'West Bengal', siliguri: 'West Bengal', durgapur: 'West Bengal',
  asansol: 'West Bengal', kharagpur: 'West Bengal',
  // North-East
  guwahati: 'Assam', dispur: 'Assam', dibrugarh: 'Assam', jorhat: 'Assam', silchar: 'Assam', tezpur: 'Assam',
  sonitpur: 'Assam', tinsukia: 'Assam', duliajan: 'Assam',
  aizawl: 'Mizoram', khatla: 'Mizoram', lunglei: 'Mizoram', shillong: 'Meghalaya', imphal: 'Manipur',
  kohima: 'Nagaland', dimapur: 'Nagaland', agartala: 'Tripura', itanagar: 'Arunachal Pradesh', gangtok: 'Sikkim',
  // West / Central
  mumbai: 'Maharashtra', pune: 'Maharashtra', nagpur: 'Maharashtra', nashik: 'Maharashtra', thane: 'Maharashtra',
  navimumbai: 'Maharashtra', solapur: 'Maharashtra', kolhapur: 'Maharashtra',
  ahmedabad: 'Gujarat', gandhinagar: 'Gujarat', surat: 'Gujarat', vadodara: 'Gujarat', rajkot: 'Gujarat',
  jamnagar: 'Gujarat', bhuj: 'Gujarat', panaji: 'Goa', vascodagama: 'Goa', margao: 'Goa',
  bhopal: 'Madhya Pradesh', indore: 'Madhya Pradesh', gwalior: 'Madhya Pradesh', jabalpur: 'Madhya Pradesh',
  ujjain: 'Madhya Pradesh', sagar: 'Madhya Pradesh', raipur: 'Chhattisgarh', bhilai: 'Chhattisgarh',
  durg: 'Chhattisgarh', jagdalpur: 'Chhattisgarh', silvassa: 'Dadra & Nagar Haveli and Daman & Diu',
  // South
  bengaluru: 'Karnataka', bangalore: 'Karnataka', mysuru: 'Karnataka', mysore: 'Karnataka', mangaluru: 'Karnataka',
  hubballi: 'Karnataka', belagavi: 'Karnataka', chennai: 'Tamil Nadu', coimbatore: 'Tamil Nadu',
  madurai: 'Tamil Nadu', tiruchirappalli: 'Tamil Nadu', salem: 'Tamil Nadu', hyderabad: 'Telangana',
  secunderabad: 'Telangana', warangal: 'Telangana', visakhapatnam: 'Andhra Pradesh', vijayawada: 'Andhra Pradesh',
  tirupati: 'Andhra Pradesh', guntur: 'Andhra Pradesh', amaravati: 'Andhra Pradesh',
  thiruvananthapuram: 'Kerala', kochi: 'Kerala', kozhikode: 'Kerala', thrissur: 'Kerala',
  puducherry: 'Puducherry', portblair: 'Andaman & Nicobar Islands', kavaratti: 'Lakshadweep',
};

/** Canonical state / UT name for free-text input, or null when it is not a recognised Indian state / UT. */
export function canonicalState(value: string | null | undefined): string | null {
  if (!value || !value.trim()) return null;
  return STATE_BY_KEY.get(key(value)) || null;
}

/** The state a known city belongs to, or null when the city is not in the reference map. */
export function stateOfCity(city: string | null | undefined): string | null {
  if (!city || !city.trim()) return null;
  return CITY_STATE[key(city)] || null;
}

/**
 * Validates a city / state pair and returns the values to store.
 * - state given → must be a recognised state / UT (stored in its canonical spelling);
 * - city known  → state must be the city's state; with no state given, the state is derived from the city.
 * Returns `{ error }` with a user-facing message instead of throwing so callers pick the exception type.
 */
export function resolveLocation(
  city: string | null | undefined,
  state: string | null | undefined,
): { city: string | null; state: string | null; error?: string } {
  const cleanCity = city?.trim() || null;
  const rawState = state?.trim() || null;
  const canonical = canonicalState(rawState);
  if (rawState && !canonical) {
    return { city: cleanCity, state: rawState, error: `'${rawState}' is not a recognised Indian state or union territory.` };
  }
  const cityState = stateOfCity(cleanCity);
  if (cityState && canonical && cityState !== canonical) {
    return {
      city: cleanCity,
      state: canonical,
      error: `${cleanCity} is in ${cityState}, not ${canonical}. Please correct the city or the state.`,
    };
  }
  return { city: cleanCity, state: canonical || cityState || null };
}
