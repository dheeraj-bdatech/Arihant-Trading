import type { UserRole } from './enums.js';

/**
 * Modules the administrator can switch off for a role, and back on (Admin → Role Permissions).
 *
 * The code still sets the most a role can ever do: page rules (web route-access), @Roles guards and territorial
 * scoping. A switch only takes a module away from a role that has it; it never grants one, because a role the
 * module was not built for has no scoping rules there. The API refuses a switched-off module's routes, and the
 * web hides its pages, links and sidebar entries.
 */
export interface AccessModule {
  key: string;
  label: string;
  /** App pages of the module (a path and everything under it). */
  paths: string[];
  /** API routes (after /api) of the module, any method. */
  api: string[];
  /** API routes that belong to the module for writes only (POST / PUT / PATCH / DELETE); reads stay shared. */
  writes?: string[];
}

export const ACCESS_MODULES: AccessModule[] = [
  { key: 'leads', label: 'Leads & customers', paths: ['/leads'], api: ['/leads'] },
  { key: 'visits', label: 'Field visits & tours', paths: ['/visits'], api: ['/visits'] },
  { key: 'demos', label: 'Demos & demo fleet', paths: ['/demos'], api: ['/demos'] },
  { key: 'tenders', label: 'Tenders', paths: ['/tenders'], api: ['/tenders'] },
  { key: 'proposals', label: 'Proposals', paths: ['/proposals'], api: ['/proposals'] },
  { key: 'deliveries', label: 'Deliveries', paths: ['/deliveries'], api: ['/deliveries'] },
  { key: 'service', label: 'Service desk', paths: ['/service'], api: ['/service'] },
  { key: 'expenses', label: 'Expenses', paths: ['/expenses'], api: ['/expense-claims', '/expense-categories', '/expense-reports', '/projects'] },
  {
    key: 'tasks',
    label: 'Tasks & blockers',
    paths: ['/tasks'],
    api: ['/tasks', '/task-blockers', '/task-calendar', '/task-templates', '/task-escalations', '/task-attachments', '/task-categories', '/task-settings'],
  },
  // the task-performance pages read shared task data: switched off in the app, not per API route
  { key: 'performance', label: 'Performance', paths: ['/performance'], api: [] },
  // Territory Command and Module 9 (salesperson & regional performance) each have their own dashboard route
  { key: 'regional', label: 'Regional command & performance', paths: ['/regional'], api: ['/dashboard/regional-performance', '/dashboard/sales-performance'] },
  { key: 'reports', label: 'Reports', paths: ['/reports'], api: ['/reports'] },
  { key: 'audit', label: 'Audit trail', paths: ['/audit'], api: ['/audit'] },
  // reads of users / masters feed every page; changing them is administration
  { key: 'admin', label: 'Administration', paths: ['/admin'], api: ['/admin'], writes: ['/users', '/masters', '/products'] },
];

export const ACCESS_MODULE_KEYS = ACCESS_MODULES.map((m) => m.key);

/** Never switchable: the administrator keeps the administration panel, so nobody can be locked out of it. */
export const isLockedModule = (role: UserRole | string, module: string) => role === 'admin' && module === 'admin';

const under = (path: string, base: string) => path === base || path.startsWith(base + '/');

/** The module an app page belongs to (undefined for shared pages such as the dashboard). */
export function accessModuleForPage(pathname: string): AccessModule | undefined {
  const path = pathname.split(/[?#]/)[0];
  return ACCESS_MODULES.find((m) => m.paths.some((p) => under(path, p)));
}

/** The module an API call belongs to (`path` without the /api prefix). */
export function accessModuleForApi(method: string, path: string): AccessModule | undefined {
  const p = path.split('?')[0];
  const write = !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase());
  return ACCESS_MODULES.find((m) => m.api.some((a) => under(p, a)) || (write && (m.writes || []).some((a) => under(p, a))));
}
