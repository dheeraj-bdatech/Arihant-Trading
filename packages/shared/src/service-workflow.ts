/**
 * Module 6 — Service & After-Sales: single source of truth for the ticket state machine,
 * SLA pause rules and the public portal vocabulary. Used by the API (enforcement) and the
 * web app (which buttons to offer), so the two can never drift apart.
 */

/** Canonical lifecycle statuses (§32). Legacy aliases are folded in by `normalizeServiceStatus`. */
export type ServiceStatus =
  | 'received'
  | 'created'
  | 'assigned'
  | 'visit_scheduled'
  | 'in_progress'
  | 'awaiting_part'
  | 'awaiting_customer'
  | 'escalated'
  | 'on_hold'
  | 'revisit_required'
  | 'resolved'
  | 'report_submitted'
  | 'closed'
  | 'reopened'
  | 'cancelled';

export const SERVICE_STATUS_ALIASES: Record<string, ServiceStatus> = {
  new: 'received',
  revisit: 'revisit_required',
};

export function normalizeServiceStatus(status: string | null | undefined): ServiceStatus {
  const s = String(status || 'received').toLowerCase();
  return (SERVICE_STATUS_ALIASES[s] || s) as ServiceStatus;
}

export const SERVICE_STATUS_LABELS: Record<ServiceStatus, string> = {
  received: 'Complaint Received',
  created: 'Ticket Created',
  assigned: 'Engineer Assigned',
  visit_scheduled: 'Visit Scheduled',
  in_progress: 'Work In Progress',
  awaiting_part: 'Awaiting Spare Part',
  awaiting_customer: 'Awaiting Customer',
  escalated: 'Escalated',
  on_hold: 'On Hold',
  revisit_required: 'Revisit Required',
  resolved: 'Resolved',
  report_submitted: 'Service Report Submitted',
  closed: 'Closed',
  reopened: 'Reopened',
  cancelled: 'Cancelled',
};

/**
 * Allowed transitions (spec §3 state machine). `closed` only re-opens; `cancelled` is terminal.
 */
export const SERVICE_TRANSITIONS: Record<ServiceStatus, ServiceStatus[]> = {
  received: ['created', 'assigned', 'visit_scheduled', 'escalated', 'on_hold', 'cancelled'],
  created: ['assigned', 'visit_scheduled', 'escalated', 'on_hold', 'cancelled'],
  assigned: ['visit_scheduled', 'awaiting_customer', 'escalated', 'received', 'cancelled'],
  visit_scheduled: ['in_progress', 'awaiting_customer', 'assigned', 'escalated', 'cancelled'],
  in_progress: ['resolved', 'awaiting_part', 'awaiting_customer', 'escalated', 'revisit_required', 'on_hold'],
  awaiting_part: ['visit_scheduled', 'in_progress', 'escalated', 'cancelled'],
  awaiting_customer: ['visit_scheduled', 'in_progress', 'assigned', 'cancelled'],
  escalated: ['assigned', 'visit_scheduled', 'in_progress', 'cancelled'],
  on_hold: ['assigned', 'visit_scheduled', 'in_progress', 'cancelled'],
  revisit_required: ['visit_scheduled', 'in_progress'],
  resolved: ['report_submitted', 'in_progress'],
  report_submitted: ['closed', 'in_progress', 'revisit_required'],
  closed: ['reopened'],
  reopened: ['assigned', 'visit_scheduled', 'in_progress', 'cancelled'],
  cancelled: [],
};

/** A written reason is mandatory when entering these (§3 `status_reason`). */
export const SERVICE_REASON_REQUIRED: ServiceStatus[] = [
  'awaiting_part',
  'awaiting_customer',
  'escalated',
  'on_hold',
  'revisit_required',
  'cancelled',
  'reopened',
];

/** The SLA clock stops while a ticket sits in one of these. */
export const SERVICE_SLA_PAUSE_STATUSES: ServiceStatus[] = ['awaiting_part', 'awaiting_customer', 'on_hold'];

/** Statuses counted as "finished" for dashboards and workload. */
export const SERVICE_DONE_STATUSES: ServiceStatus[] = ['resolved', 'report_submitted', 'closed', 'cancelled'];
export const SERVICE_OPEN_STATUSES: ServiceStatus[] = (Object.keys(SERVICE_TRANSITIONS) as ServiceStatus[]).filter(
  (s) => !SERVICE_DONE_STATUSES.includes(s),
);
/** Moves only managers may make. */
export const SERVICE_MANAGER_ONLY_FROM: ServiceStatus[] = ['escalated'];
export const SERVICE_REOPEN_ROLES = ['management', 'admin'] as const;

export function canTransitionService(from: string, to: string): boolean {
  return SERVICE_TRANSITIONS[normalizeServiceStatus(from)]?.includes(normalizeServiceStatus(to)) ?? false;
}

export function allowedNextServiceStatuses(from: string): ServiceStatus[] {
  return SERVICE_TRANSITIONS[normalizeServiceStatus(from)] ?? [];
}

/* ---------------------------- Public customer portal ---------------------------- */

/** How the customer describes severity → internal priority (§31). */
export const PORTAL_URGENCY_OPTIONS = [
  { value: 'equipment_down', label: 'Equipment is completely down / security-critical', priority: 'critical' },
  { value: 'major_impairment', label: 'Major function impaired, usable with difficulty', priority: 'high' },
  { value: 'minor_issue', label: 'Minor or intermittent issue', priority: 'medium' },
  { value: 'general_query', label: 'General query / preventive maintenance', priority: 'low' },
] as const;
export type PortalUrgency = (typeof PORTAL_URGENCY_OPTIONS)[number]['value'];
export const PORTAL_URGENCY_VALUES = PORTAL_URGENCY_OPTIONS.map((o) => o.value) as PortalUrgency[];

export const PORTAL_PROBLEM_CATEGORIES = [
  'Breakdown',
  'Installation',
  'Preventive Maintenance',
  'Calibration',
  'Noise/Leak',
  'Electrical',
  'Software',
  'Other',
] as const;

export const PORTAL_LIMITS = {
  organisation: { min: 3, max: 160 },
  person: { min: 2, max: 100 },
  complaint: { min: 20, max: 4000 },
  location: { max: 300 },
  serial: { max: 80 },
  comment: { min: 3, max: 1500 },
} as const;

/** Statuses a customer is shown (internal detail like escalation reasons is never exposed). */
export const PUBLIC_STATUS_LABELS: Record<ServiceStatus, string> = {
  received: 'Request received',
  created: 'Ticket registered',
  assigned: 'Engineer assigned',
  visit_scheduled: 'Visit scheduled',
  in_progress: 'Engineer working on it',
  awaiting_part: 'Waiting for a spare part',
  awaiting_customer: 'Waiting for your input / site access',
  escalated: 'With our senior engineers',
  on_hold: 'On hold',
  revisit_required: 'Follow-up visit needed',
  resolved: 'Fixed — report being prepared',
  report_submitted: 'Fixed — awaiting sign-off',
  closed: 'Closed',
  reopened: 'Reopened',
  cancelled: 'Cancelled',
};

/** States / UTs offered on the public form, with the frozen zone mapping (Scope Freeze §2.2). */
export const PORTAL_STATES: { name: string; zone: 'N' | 'NE' | 'E' | 'W' | 'S' }[] = [
  { name: 'Andaman & Nicobar Islands', zone: 'E' },
  { name: 'Andhra Pradesh', zone: 'S' },
  { name: 'Arunachal Pradesh', zone: 'NE' },
  { name: 'Assam', zone: 'NE' },
  { name: 'Bihar', zone: 'E' },
  { name: 'Chandigarh', zone: 'N' },
  { name: 'Chhattisgarh', zone: 'W' },
  { name: 'Dadra & Nagar Haveli and Daman & Diu', zone: 'W' },
  { name: 'Delhi', zone: 'N' },
  { name: 'Goa', zone: 'W' },
  { name: 'Gujarat', zone: 'W' },
  { name: 'Haryana', zone: 'N' },
  { name: 'Himachal Pradesh', zone: 'N' },
  { name: 'Jammu & Kashmir', zone: 'N' },
  { name: 'Jharkhand', zone: 'E' },
  { name: 'Karnataka', zone: 'S' },
  { name: 'Kerala', zone: 'S' },
  { name: 'Ladakh', zone: 'N' },
  { name: 'Lakshadweep', zone: 'S' },
  { name: 'Madhya Pradesh', zone: 'W' },
  { name: 'Maharashtra', zone: 'W' },
  { name: 'Manipur', zone: 'NE' },
  { name: 'Meghalaya', zone: 'NE' },
  { name: 'Mizoram', zone: 'NE' },
  { name: 'Nagaland', zone: 'NE' },
  { name: 'Odisha', zone: 'E' },
  { name: 'Puducherry', zone: 'S' },
  { name: 'Punjab', zone: 'N' },
  { name: 'Rajasthan', zone: 'N' },
  { name: 'Sikkim', zone: 'NE' },
  { name: 'Tamil Nadu', zone: 'S' },
  { name: 'Telangana', zone: 'S' },
  { name: 'Tripura', zone: 'NE' },
  { name: 'Uttar Pradesh', zone: 'N' },
  { name: 'Uttarakhand', zone: 'N' },
  { name: 'West Bengal', zone: 'E' },
];
