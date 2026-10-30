import { REPORT_ROLES, accessModuleForPage, type UserRole } from '@arihant/shared';

/**
 * Which roles may open each app page — the page guard in app/(app)/layout.tsx.
 * First match wins, so more specific paths come before their parents.
 * Cross-module links use canOpen() so nobody is sent to a page that will only show "access denied".
 */
export const ROUTE_PERMISSIONS: { path: string; name: string; roles: UserRole[] }[] = [
  { path: '/command', name: 'Management Command', roles: ['management', 'admin'] },
  { path: '/regional/performance', name: 'Salesperson & Regional Performance', roles: ['sales', 'regional_manager', 'management', 'admin'] },
  { path: '/regional', name: 'Regional Territory Command', roles: ['regional_manager', 'management', 'admin'] },
  // Accounts opens /tenders for EMD & PBG accounting only (the page shows it the Finance view alone).
  { path: '/tenders', name: 'GeM Defence Tenders', roles: ['management', 'regional_manager', 'tender_team', 'sales', 'accounts', 'admin'] },
  { path: '/leads', name: 'Leads & CRM Accounts', roles: ['management', 'regional_manager', 'sales', 'admin'] },
  { path: '/visits', name: 'Field Tour Planner', roles: ['management', 'regional_manager', 'sales', 'demo_team', 'service_team', 'admin'] },
  { path: '/demos', name: 'Demo Fleet Matrix', roles: ['management', 'regional_manager', 'sales', 'demo_team', 'admin'] },
  { path: '/proposals', name: 'Commercial Proposals', roles: ['management', 'regional_manager', 'sales', 'tender_team', 'admin'] },
  { path: '/deliveries', name: 'Equipment Logistics & Delivery Register', roles: ['management', 'regional_manager', 'sales', 'service_team', 'admin'] },
  { path: '/service', name: 'Service Desk & Spares', roles: ['management', 'regional_manager', 'sales', 'service_team', 'demo_team', 'tender_team', 'admin'] },
  { path: '/expenses/categories', name: 'Expense Categories & Masters', roles: ['management', 'admin'] },
  { path: '/expenses/accounts', name: 'Expense Accounts Queue', roles: ['accounts', 'management', 'admin'] },
  { path: '/expenses', name: 'Travel & Expense Reimbursements', roles: ['management', 'regional_manager', 'sales', 'tender_team', 'demo_team', 'service_team', 'accounts', 'admin'] },
  { path: '/performance', name: 'Performance', roles: ['management', 'regional_manager', 'sales', 'tender_team', 'demo_team', 'service_team', 'accounts', 'admin'] },
  { path: '/tasks', name: 'Task & Productivity Management', roles: ['management', 'regional_manager', 'sales', 'tender_team', 'demo_team', 'service_team', 'accounts', 'admin'] },
  // Management reports: each report's roles come from REPORT_ROLES, the same list the API guards with.
  { path: '/reports/pipeline', name: 'Sales Pipeline & Conversion Report', roles: [...REPORT_ROLES.pipeline] },
  { path: '/reports/service', name: 'Service Closure & Repeat Complaints Report', roles: [...REPORT_ROLES.service] },
  { path: '/reports/expenses', name: 'Expense Breakdown Report', roles: [...REPORT_ROLES.expenses] },
  { path: '/reports/productivity', name: 'Employee Productivity Report', roles: [...REPORT_ROLES.productivity] },
  { path: '/reports', name: 'Consolidated Reporting & Exports', roles: ['management', 'regional_manager', 'tender_team', 'accounts', 'admin'] },
  { path: '/admin', name: 'Administration & System Audit', roles: ['management', 'admin'] },
  { path: '/audit', name: 'Audit Logs', roles: ['management', 'admin'] },
];

/** The rule guarding a pathname, or undefined when every signed-in role may open it. */
export function routeRule(pathname: string) {
  return ROUTE_PERMISSIONS.find((r) => pathname === r.path || pathname.startsWith(r.path + '/'));
}

/** Whether a role reaches a page by the code's rules alone (before any administrator switch). */
export function roleCanReach(role: UserRole | string | undefined, href: string): boolean {
  if (!role) return false;
  const rule = routeRule(href.split(/[?#]/)[0]);
  return !rule || (rule.roles as string[]).includes(role);
}

/**
 * Modules the administrator has switched off for the signed-in user's role (GET /auth/me → blocked_modules),
 * set by the auth context. canOpen() honours them, so every page guard, link and menu built on it follows.
 */
let blockedModules = new Set<string>();
export function setBlockedModules(modules: string[] | undefined) {
  blockedModules = new Set(modules || []);
}
/** The switched-off module a page belongs to, if any. */
export function blockedModuleFor(href: string) {
  const m = accessModuleForPage(href);
  return m && blockedModules.has(m.key) ? m : undefined;
}

/** Whether a role may open an in-app link (query string and hash ignored). */
export function canOpen(role: UserRole | string | undefined, href: string): boolean {
  return roleCanReach(role, href) && !blockedModuleFor(href);
}
