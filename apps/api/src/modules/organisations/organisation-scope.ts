/**
 * Territorial scope of the Customer Register (organisations) — RBAC spec Layer 4, Module 1 §8 (QA DEF-034).
 *
 * - sales            : accounts in their own region, accounts they created, and accounts where they own a lead.
 * - regional_manager : their ZONE — the same territory Zonal Command and the RM dashboards use (dashboard-metrics
 *                      territory / teamScope) — plus accounts they created or where they own a lead, and, for accounts
 *                      with no zone tag, what their team touches: accounts a team member created, and accounts with a
 *                      lead they manage or a team member owns. The team is the users reporting to them or based in
 *                      their zone (as in teamScope).
 * - every other role : national visibility.
 *
 * Used by the Customer Register list and by the Leads dashboard "total customers" count so both always agree.
 * Expects the query to have `organisations` in scope under that name.
 */
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { sql, type Kysely, type RawBuilder } from 'kysely';
import type { AuthUser, Database } from '@arihant/shared';

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
    // QA BUG-001: what the team created or owns counts only for accounts with no zone tag — an account tagged to
    // another zone belongs to that zone, even when a team member created it or owns a lead there.
    return sql<boolean>`(
      organisations.created_by = ${user.id}
      or organisations.zone_id = ${zoneId}::uuid
      or exists (
        select 1 from leads scope_lead
        where scope_lead.organisation_id = organisations.id and scope_lead.assigned_to = ${user.id}
      )
      or (organisations.zone_id is null and (
        organisations.created_by in ${team}
        or exists (
          select 1 from leads scope_lead
          where scope_lead.organisation_id = organisations.id
            and (scope_lead.regional_manager_id = ${user.id} or scope_lead.assigned_to in ${team})
        )
      ))
    )`;
  }

  return null;
}

/**
 * Single-record guard for the same territory: 404 when the organisation does not exist, 403 when it lies outside
 * the caller's Customer Register scope.
 */
export async function assertOrganisationInScope(db: Kysely<Database>, orgId: string, user: AuthUser): Promise<void> {
  const scope = organisationScope(user);
  const row = await db
    .selectFrom('organisations')
    .select(['organisations.id', (scope ?? sql<boolean>`true`).as('in_scope')])
    .where('organisations.id', '=', orgId)
    .executeTakeFirst();
  if (!row) {
    throw new NotFoundException(`Organisation with id '${orgId}' not found`);
  }
  if (!row.in_scope) {
    throw new ForbiddenException('This customer account is outside your territory.');
  }
}
