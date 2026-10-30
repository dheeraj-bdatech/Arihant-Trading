/**
 * Period and territory resolution shared by every GET /reports/* endpoint, so the same query string always means
 * the same window and the same records on each report.
 */
import { BadRequestException } from '@nestjs/common';
import { sql, type Kysely, type RawBuilder } from 'kysely';
import type { AuthUser, Database, ReportPeriod, ReportTerritoryFilters } from '@arihant/shared';
import { addIsoDays, todayInKolkata } from '../../common/utils/ist-date.util.js';
import { orgTerritory, teamIds, type Territory } from '../dashboard/dashboard-metrics.js';

type Cond = RawBuilder<unknown>;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const validDay = (d: string) => ISO_DATE.test(d) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;

export const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
/** part ÷ whole × 100 to one decimal; null when there is nothing to divide by. */
export const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);
export const rate = (part: number, whole: number) => ({ part, whole, rate: pct(part, whole) });

/** Start of the Indian financial year (1 April) that `day` falls in. */
export function fyStart(day: string): string {
  const y = Number(day.slice(0, 4));
  return day.slice(5, 7) >= '04' ? `${y}-04-01` : `${y - 1}-04-01`;
}

/**
 * IST reporting window. Default: financial year to date. A one-sided range is closed with today (or `from` when it is
 * in the future). Rejects malformed dates, inverted ranges and windows longer than five years.
 */
export function parseReportPeriod(fromQ?: unknown, toQ?: unknown): ReportPeriod {
  const today = todayInKolkata();
  const fromS = typeof fromQ === 'string' && fromQ ? fromQ : undefined;
  const toS = typeof toQ === 'string' && toQ ? toQ : undefined;
  if ((fromS && !validDay(fromS)) || (toS && !validDay(toS))) throw new BadRequestException('from / to must be YYYY-MM-DD dates');
  const from = fromS || fyStart(toS || today);
  const to = toS || (from > today ? from : today);
  if (from > to) throw new BadRequestException('from must be on or before to');
  if (addIsoDays(from, 5 * 366) < to) throw new BadRequestException('A report can cover at most five years');
  return { from, to };
}

/** True when the caller sees all India (optionally narrowed to a zone / region they pick). */
export const isNational = (user: AuthUser) => ['management', 'admin', 'tender_team', 'accounts'].includes(user.role);

export interface ResolvedTerritory {
  territory: Territory;
  filters: ReportTerritoryFilters;
}

/**
 * Zone / region the caller may look at. National roles may pick any zone and region; a regional manager is locked to
 * their zone (their team counts too, as on Zonal Command) and may narrow to a region inside it.
 */
export async function resolveTerritory(db: Kysely<Database>, user: AuthUser, zoneQ?: unknown, regionQ?: unknown): Promise<ResolvedTerritory> {
  const national = isNational(user);
  const zones = await db.selectFrom('zones').select(['id', 'name', 'code']).orderBy('name', 'asc').execute();
  const zoneId = national ? (typeof zoneQ === 'string' && zones.some((z) => z.id === zoneQ) ? zoneQ : null) : (user.zone_id ?? null);

  let regionsQ = db.selectFrom('regions').select(['id', 'name', 'zone_id']).orderBy('name', 'asc');
  if (zoneId) regionsQ = regionsQ.where('zone_id', '=', zoneId);
  else if (!national) regionsQ = regionsQ.where('id', '=', user.region_id ?? '00000000-0000-0000-0000-000000000000');
  const regions = await regionsQ.execute();
  const regionId = typeof regionQ === 'string' && regions.some((r) => r.id === regionQ) ? regionQ : null;

  return {
    territory: { zoneId, regionId, managerId: national ? null : user.id },
    filters: {
      zone_id: zoneId,
      region_id: regionId,
      can_pick_zone: national,
      can_pick_region: true,
      zones: national ? zones : zones.filter((z) => z.id === zoneId),
      regions,
    },
  };
}

/**
 * Records at a customer organisation (alias o) in the territory, plus — when no region is picked — those owned by the
 * territory's team at customers with no zone tag. Same rule as territoryVisits, for tables with another owner column
 * (demos, proposals).
 */
export function territoryOwned(t: Territory, owner: Cond): Cond {
  const geo = !t.zoneId && t.managerId ? sql`false` : orgTerritory(t.zoneId, t.regionId);
  if (t.regionId) return geo;
  return sql`(${geo} or (o.zone_id is null and ${owner} in ${teamIds(t.managerId ?? null, t.zoneId)}))`;
}
