/**
 * Territorial scope of the Customer Register (organisations) — RBAC spec Layer 4, Module 1 §8 (QA DEF-034).
 *
 * - sales            : accounts in their own region, accounts they created, and accounts where they own a lead.
 * - regional_manager : their ZONE — the same territory Zonal Command and the RM dashboards use (dashboard-metrics
 *                      territory / teamScope) — plus everything their team touches: accounts they or a team member
 *                      created, and accounts with a lead they manage, own, or that a team member owns. The team is the
 *                      users reporting to them or based in their zone (as in teamScope), so every team member's own accounts
 *                      and leads stay inside the manager's register.
 * - every other role : national visibility.
 *
 * Used by the Customer Register list and by the Leads dashboard "total customers" count so both always agree.
 * Expects the query to have `organisations` in scope under that name.
 */
import { sql, type RawBuilder } from 'kysely';
import type { AuthUser } from '@arihant/shared';

export function organisationScope(user: AuthUser): RawBuilder<boolean> | null {
  if (user.role === 'sales') {
    return sql<boolean>`(
      organisations.created_by = ${user.id}
      or organisations.region_id = ${user.region_id ?? null}::uuid
      or exists (
        select 1 from leads scope_lead
        where scope_lead.organisation_id = organisations.id and scope_lead.assigned_to = ${user.id}
      )
    )`;
  }

  if (user.role === 'regional_manager') {
    const zoneId = user.zone_id ?? null;
    const team = sql`(
      select team.id from users team
      where team.reporting_manager_id = ${user.id}
         or (${zoneId}::uuid is not null and team.zone_id = ${zoneId}::uuid)
    )`;
    return sql<boolean>`(
      organisations.created_by = ${user.id}
      or organisations.zone_id = ${zoneId}::uuid
      or organisations.created_by in ${team}
      or exists (
        select 1 from leads scope_lead
        where scope_lead.organisation_id = organisations.id
          and (
            scope_lead.regional_manager_id = ${user.id}
            or scope_lead.assigned_to = ${user.id}
            or scope_lead.assigned_to in ${team}
          )
      )
    )`;
  }

  return null;
}
