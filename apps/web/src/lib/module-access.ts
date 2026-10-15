import { USER_ROLES, type UserRole } from '@arihant/shared';

/**
 * Read access to the cross-module list endpoints, mirroring the API controllers' @Roles guards.
 * Pages that pull data from other modules check this first so a role never fires requests it is
 * guaranteed to get a 403 for (the API remains the authority; this only avoids dead calls).
 */
const READ_ROLES = {
  tenders: ['management', 'regional_manager', 'sales', 'tender_team', 'admin'],
  tenderReports: ['management', 'regional_manager', 'admin'],
  leads: ['management', 'regional_manager', 'sales', 'tender_team', 'demo_team', 'service_team', 'admin'],
  visits: ['management', 'regional_manager', 'sales', 'demo_team', 'service_team', 'admin'],
  demos: ['management', 'regional_manager', 'sales', 'tender_team', 'demo_team', 'admin'],
  demoAnalytics: ['management', 'regional_manager', 'demo_team', 'admin'],
  service: ['management', 'regional_manager', 'sales', 'service_team', 'admin', 'demo_team', 'tender_team'],
  organisations: ['management', 'regional_manager', 'sales', 'tender_team', 'demo_team', 'service_team', 'admin'],
  proposals: ['management', 'regional_manager', 'sales', 'tender_team', 'admin', 'accounts'],
  /** GET /visits/organisations/:id/history — a customer's visit log (wider than the visits list itself). */
  customerVisits: ['management', 'regional_manager', 'sales', 'tender_team', 'demo_team', 'service_team', 'admin'],
  // Open to every role; the API scopes the rows to what the caller may see.
  deliveries: USER_ROLES,
  tasks: USER_ROLES,
  expenses: USER_ROLES,
} satisfies Record<string, readonly UserRole[]>;

export type ReadableModule = keyof typeof READ_ROLES;

export function canRead(role: UserRole | string | undefined, module: ReadableModule): boolean {
  return !!role && (READ_ROLES[module] as string[]).includes(role);
}
