import type { UserRole } from '@arihant/shared';

/** Business names for the 8 RBAC roles, for pickers and labels (never show raw codes like "tender_team"). */
export const ROLE_LABELS: Record<UserRole, string> = {
  management: 'Management',
  regional_manager: 'Regional Manager',
  sales: 'Sales',
  tender_team: 'Tender Team',
  demo_team: 'Demo Team',
  service_team: 'Service Team',
  accounts: 'Accounts',
  admin: 'Admin',
};

export const roleLabel = (role: string | null | undefined): string =>
  (role && ROLE_LABELS[role as UserRole]) || String(role || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/** "Amit Verma (Sales)" — person plus role, for user dropdowns. */
export const userWithRole = (u: { full_name?: string | null; role?: string | null }): string =>
  [u.full_name || 'Unnamed user', u.role && `(${roleLabel(u.role)})`].filter(Boolean).join(' ');
