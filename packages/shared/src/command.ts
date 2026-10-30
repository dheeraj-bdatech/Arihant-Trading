/**
 * Module 10 — Management Command Dashboard (Scope Blueprint §45). Management should not need to open every module:
 * the command dashboard brings up what needs a decision. Response of GET /dashboard/command.
 *
 * Every figure is counted with the same rule as the module screen it links to, and the link opens exactly the records
 * behind the number. A manager chooses which sections and figures to show, their order and the results period
 * (PATCH /dashboard/command/layout); the catalogue below is the full menu and the default.
 */

export type CommandSectionKey = 'sales' | 'visits' | 'demos' | 'tenders' | 'proposals' | 'service' | 'team' | 'expenses';

/**
 * action — something is waiting on someone; any non-zero value is an exception and is listed under "Needs action".
 * watch  — what is coming up; context, not a problem by itself.
 * result — how things went over the chosen period.
 */
export type CommandItemKind = 'action' | 'watch' | 'result';

export interface CommandItemDef {
  key: string;
  label: string;
  /** One plain sentence: what is counted. Shown under the figure. */
  help: string;
  kind: CommandItemKind;
}

export interface CommandSectionDef {
  key: CommandSectionKey;
  label: string;
  /** The module page the section header opens. */
  href: string;
  /** Admin → Role Permissions module key: switched off for a role, the section is not shown to that role. */
  module: string;
  items: CommandItemDef[];
}

export const COMMAND_SECTIONS: CommandSectionDef[] = [
  {
    key: 'sales',
    label: 'Sales',
    href: '/leads',
    module: 'leads',
    items: [
      { key: 'followups_overdue', label: 'Leads needing follow-up', help: 'Open leads with a pending follow-up past its due date.', kind: 'action' },
      { key: 'new_opportunities', label: 'New opportunities', help: 'Leads created in the period: fresh prospects and re-approached customers.', kind: 'watch' },
      { key: 'conversion', label: 'Lead conversion', help: 'Share of the leads created in the period that are now converted.', kind: 'result' },
      { key: 'region_performance', label: 'Region performance', help: 'New leads, conversion and tender win rate per region in the period.', kind: 'result' },
    ],
  },
  {
    key: 'visits',
    label: 'Field visits',
    href: '/visits',
    module: 'visits',
    items: [
      { key: 'upcoming', label: 'Upcoming visits', help: 'Visits still to be made in the next 7 days, today included.', kind: 'watch' },
      { key: 'travelling', label: 'People in the field today', help: 'People with a customer visit still to be made today.', kind: 'watch' },
      { key: 'cancelled_rescheduled', label: 'Cancelled or rescheduled', help: 'Visits planned in the period that were cancelled, and visits moved to a new date not yet made.', kind: 'watch' },
      { key: 'combine', label: 'Trips to combine', help: 'Cities with 2 or more visits in the next 14 days, within 3 days of each other and not on one trip yet.', kind: 'watch' },
    ],
  },
  {
    key: 'demos',
    label: 'Demos',
    href: '/demos',
    module: 'demos',
    items: [
      { key: 'upcoming', label: 'Upcoming demos', help: 'Open demos scheduled in the next 7 days, today included.', kind: 'watch' },
      { key: 'equipment_conflicts', label: 'Equipment conflicts', help: 'The same demo unit booked for overlapping dates on two open demos.', kind: 'action' },
      { key: 'results', label: 'Demo success / failure', help: 'Recorded outcomes of demos scheduled in the period.', kind: 'result' },
      { key: 'failure_reasons', label: 'Repeated failure reasons', help: 'Reasons given for failed demos in the period; a reason seen twice or more is flagged.', kind: 'result' },
    ],
  },
  {
    key: 'tenders',
    label: 'Tenders',
    href: '/tenders',
    module: 'tenders',
    items: [
      { key: 'deadlines', label: 'Upcoming deadlines', help: 'Bids not yet submitted whose submission deadline is in the next 7 days.', kind: 'action' },
      { key: 'approvals', label: 'Pending approvals', help: 'Bids waiting for a go / no-go approval (not on hold).', kind: 'action' },
      { key: 'pq_pipeline', label: 'PQ pipeline', help: 'Pre-qualification tenders still in play: not won, lost, cancelled, rejected or on hold.', kind: 'watch' },
      { key: 'general_pipeline', label: 'General / MHA pipeline', help: 'General and MHA tenders still in play: not won, lost, cancelled, rejected or on hold.', kind: 'watch' },
      { key: 'won_lost', label: 'Won / lost', help: 'Tender results declared in the period.', kind: 'result' },
    ],
  },
  {
    key: 'proposals',
    label: 'Proposals',
    href: '/proposals',
    module: 'proposals',
    items: [
      { key: 'pending', label: 'Proposals pending', help: 'Requested, being prepared, waiting for approval, or approved but not yet sent.', kind: 'action' },
      { key: 'followups_overdue', label: 'Follow-ups overdue', help: 'Sent proposals whose next follow-up date has passed.', kind: 'action' },
      { key: 'outcomes', label: 'Proposal outcomes', help: 'Proposals converted, lost or closed in the period.', kind: 'result' },
    ],
  },
  {
    key: 'service',
    label: 'Service',
    href: '/service',
    module: 'service',
    items: [
      { key: 'open', label: 'Open tickets', help: 'Service tickets not yet resolved, closed or cancelled.', kind: 'watch' },
      { key: 'overdue', label: 'Overdue cases', help: 'Open tickets past their resolution deadline, or whose planned visit date has passed.', kind: 'action' },
      { key: 'repeat', label: 'Repeat complaints', help: 'Open tickets for equipment that had another complaint in the last 90 days.', kind: 'action' },
      { key: 'awaiting_parts', label: 'Awaiting parts', help: 'Tickets on hold until a spare part arrives.', kind: 'action' },
    ],
  },
  {
    key: 'team',
    label: 'Team',
    href: '/tasks',
    module: 'tasks',
    items: [
      { key: 'tasks_overdue', label: 'Tasks overdue', help: 'Open tasks past their deadline without an accepted blocker.', kind: 'action' },
      { key: 'blockers', label: 'Blockers to decide', help: 'Blockers raised on tasks, waiting for a manager’s decision.', kind: 'action' },
      { key: 'attention', label: 'People needing attention', help: 'People with overdue tasks, unapproved or repeated delays, or tasks without updates in the period.', kind: 'action' },
      { key: 'productivity', label: 'On-time completion', help: 'Tasks due in the period that were finished on time.', kind: 'result' },
    ],
  },
  {
    key: 'expenses',
    label: 'Expenses',
    href: '/expenses',
    module: 'expenses',
    items: [
      { key: 'pending_approvals', label: 'Pending approvals', help: 'Claims waiting for a manager (stage 1) or with accounts (stage 2).', kind: 'action' },
      { key: 'rejected', label: 'Rejected expenses', help: 'Claims rejected in the period, by a manager or by accounts.', kind: 'result' },
      { key: 'outstanding', label: 'Outstanding submissions', help: 'Claims sent back to the employee for clarification, and drafts untouched for 7 days or more.', kind: 'action' },
    ],
  },
];

export const COMMAND_PERIODS = [7, 30, 90] as const;
export type CommandPeriod = (typeof COMMAND_PERIODS)[number];

export interface CommandLayoutSection {
  key: CommandSectionKey;
  hidden: boolean;
  /** Figures of the section the manager chose not to see. */
  hidden_items: string[];
}

export interface CommandLayout {
  /** In display order. */
  sections: CommandLayoutSection[];
  /** Days covered by the "result" figures (and cancelled visits, rejected claims). */
  period: CommandPeriod;
  /** Hide figures that are zero and need no action, so only exceptions are left. */
  only_exceptions: boolean;
}

export const DEFAULT_COMMAND_LAYOUT: CommandLayout = {
  sections: COMMAND_SECTIONS.map((s) => ({ key: s.key, hidden: false, hidden_items: [] })),
  period: 30,
  only_exceptions: false,
};

/**
 * A saved layout made safe to use: unknown sections and figures are dropped, sections added to the catalogue since it
 * was saved are appended (shown), and anything malformed falls back to the default.
 */
export function normaliseCommandLayout(raw: unknown): CommandLayout {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, any>) : {};
  const seen = new Set<string>();
  const sections: CommandLayoutSection[] = [];
  for (const s of Array.isArray(src.sections) ? src.sections : []) {
    const def = COMMAND_SECTIONS.find((d) => d.key === s?.key);
    if (!def || seen.has(def.key)) continue;
    seen.add(def.key);
    const items = new Set(def.items.map((i) => i.key));
    const hidden = Array.isArray(s.hidden_items) ? s.hidden_items.filter((k: unknown) => typeof k === 'string' && items.has(k)) : [];
    sections.push({ key: def.key, hidden: s.hidden === true, hidden_items: [...new Set<string>(hidden)] });
  }
  for (const def of COMMAND_SECTIONS) if (!seen.has(def.key)) sections.push({ key: def.key, hidden: false, hidden_items: [] });
  const period = COMMAND_PERIODS.includes(src.period) ? (src.period as CommandPeriod) : DEFAULT_COMMAND_LAYOUT.period;
  return { sections, period, only_exceptions: src.only_exceptions === true };
}

/**
 * critical — act now (e.g. a bid closes within 48 hours, a part has been awaited for days)
 * warning  — needs attention
 * ok       — nothing waiting
 * neutral  — a fact, not a judgement
 */
export type CommandTone = 'critical' | 'warning' | 'ok' | 'neutral';

export interface CommandListItem {
  id: string;
  title: string;
  /** Customer, owner, depot… */
  subtitle?: string | null;
  /** ISO date or instant. */
  date?: string | null;
  /** Short right-hand figure: "2 days late", "₹ 4.6 L", "×3". */
  meta?: string | null;
  tone?: CommandTone;
  href?: string | null;
}

export interface CommandBreakdown {
  label: string;
  value: number;
  /** Rendered instead of the value when set (a percentage, ₹ amount…). */
  display?: string | null;
  tone?: CommandTone;
  href?: string | null;
}

export interface CommandMetric {
  key: string;
  /** The headline count, or null for a rate with nothing to divide by. */
  value: number | null;
  /** Rendered instead of `value` when set ("62%", "₹ 4.2 L"). */
  display?: string | null;
  /** Second line under the label: "3 close within 48 hours". */
  detail?: string | null;
  tone: CommandTone;
  /** The module list showing exactly the records counted. */
  href: string | null;
  /** A few of the records, most urgent first. */
  items?: CommandListItem[];
  /** Split of the figure (won vs lost, per region, per reason). */
  breakdown?: CommandBreakdown[];
}

export interface CommandSection {
  key: CommandSectionKey;
  metrics: CommandMetric[];
}

export interface CommandDashboardDto {
  generatedAt: string;
  /** IST calendar days the "result" figures cover. */
  period: { days: CommandPeriod; from: string; to: string };
  layout: CommandLayout;
  /** Visible sections in layout order, with only their visible figures. */
  sections: CommandSection[];
  /** Sections whose module the administrator switched off for the caller's role (never shown, whatever the layout). */
  unavailable: CommandSectionKey[];
}
