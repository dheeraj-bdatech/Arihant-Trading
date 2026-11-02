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
  /** Short name on the figure's tab in its section card ("Follow-ups", "Won / lost"). */
  tab: string;
  /** One plain sentence: what is counted. Shown under the figure. */
  help: string;
  kind: CommandItemKind;
  /** Counted over the chosen results period (the rest are live: what is open, overdue or coming up right now). */
  period?: boolean;
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
      { key: 'followups_overdue', label: 'Leads needing follow-up', tab: 'Follow-ups', help: 'Open leads with a pending follow-up past its due date.', kind: 'action' },
      { key: 'new_opportunities', label: 'New opportunities', tab: 'New', help: 'Leads created in the period: fresh prospects and re-approached customers.', kind: 'watch', period: true },
      { key: 'conversion', label: 'Lead conversion', tab: 'Conversion', help: 'Share of the leads created in the period that are now converted.', kind: 'result', period: true },
      { key: 'region_performance', label: 'Region performance', tab: 'Regions', help: 'New leads, conversion and tender win rate per region in the period.', kind: 'result', period: true },
    ],
  },
  {
    key: 'visits',
    label: 'Field visits',
    href: '/visits',
    module: 'visits',
    items: [
      { key: 'upcoming', label: 'Upcoming visits', tab: 'Upcoming', help: 'Visits still to be made in the next 7 days, today included.', kind: 'watch' },
      { key: 'travelling', label: 'People in the field today', tab: 'In the field', help: 'People with a customer visit still to be made today.', kind: 'watch' },
      { key: 'cancelled_rescheduled', label: 'Cancelled or rescheduled', tab: 'Cancelled', help: 'Visits planned in the period that were cancelled, and visits moved to a new date not yet made.', kind: 'watch', period: true },
      { key: 'combine', label: 'Trips to combine', tab: 'Combine trips', help: 'Cities with 2 or more visits in the next 14 days, within 3 days of each other and not on one trip yet.', kind: 'watch' },
    ],
  },
  {
    key: 'demos',
    label: 'Demos',
    href: '/demos',
    module: 'demos',
    items: [
      { key: 'upcoming', label: 'Upcoming demos', tab: 'Upcoming', help: 'Open demos scheduled in the next 7 days, today included.', kind: 'watch' },
      { key: 'equipment_conflicts', label: 'Equipment conflicts', tab: 'Conflicts', help: 'The same demo unit booked for overlapping dates on two open demos.', kind: 'action' },
      { key: 'results', label: 'Demo success / failure', tab: 'Results', help: 'Recorded outcomes of demos scheduled in the period.', kind: 'result', period: true },
      { key: 'failure_reasons', label: 'Repeated failure reasons', tab: 'Failure reasons', help: 'Reasons given for failed demos in the period; a reason seen twice or more is flagged.', kind: 'result', period: true },
    ],
  },
  {
    key: 'tenders',
    label: 'Tenders',
    href: '/tenders',
    module: 'tenders',
    items: [
      { key: 'deadlines', label: 'Upcoming deadlines', tab: 'Deadlines', help: 'Bids not yet submitted whose submission deadline is in the next 7 days.', kind: 'action' },
      { key: 'approvals', label: 'Pending approvals', tab: 'Approvals', help: 'Bids waiting for a go / no-go approval (not on hold).', kind: 'action' },
      { key: 'pq_pipeline', label: 'PQ pipeline', tab: 'PQ', help: 'Pre-qualification tenders still in play: not won, lost, cancelled, rejected or on hold.', kind: 'watch' },
      { key: 'general_pipeline', label: 'General / MHA pipeline', tab: 'General / MHA', help: 'General and MHA tenders still in play: not won, lost, cancelled, rejected or on hold.', kind: 'watch' },
      { key: 'won_lost', label: 'Won / lost', tab: 'Won / lost', help: 'Tender results declared in the period.', kind: 'result', period: true },
    ],
  },
  {
    key: 'proposals',
    label: 'Proposals',
    href: '/proposals',
    module: 'proposals',
    items: [
      { key: 'pending', label: 'Proposals pending', tab: 'Pending', help: 'Requested, being prepared, waiting for approval, or approved but not yet sent.', kind: 'action' },
      { key: 'followups_overdue', label: 'Follow-ups overdue', tab: 'Follow-ups', help: 'Sent proposals whose next follow-up date has passed.', kind: 'action' },
      { key: 'outcomes', label: 'Proposal outcomes', tab: 'Outcomes', help: 'Proposals converted, lost or closed in the period.', kind: 'result', period: true },
    ],
  },
  {
    key: 'service',
    label: 'Service',
    href: '/service',
    module: 'service',
    items: [
      { key: 'open', label: 'Open tickets', tab: 'Open', help: 'Service tickets not yet resolved, closed or cancelled.', kind: 'watch' },
      { key: 'overdue', label: 'Overdue cases', tab: 'Overdue', help: 'Open tickets past their resolution deadline, or whose planned visit date has passed.', kind: 'action' },
      { key: 'repeat', label: 'Repeat complaints', tab: 'Repeat', help: 'Open tickets for equipment that had another complaint in the last 90 days.', kind: 'action' },
      { key: 'awaiting_parts', label: 'Awaiting parts', tab: 'Awaiting parts', help: 'Tickets on hold until a spare part arrives.', kind: 'action' },
    ],
  },
  {
    key: 'team',
    label: 'Team',
    href: '/tasks',
    module: 'tasks',
    items: [
      { key: 'tasks_overdue', label: 'Tasks overdue', tab: 'Overdue', help: 'Open tasks past their deadline without an accepted blocker.', kind: 'action' },
      { key: 'blockers', label: 'Blockers to decide', tab: 'Blockers', help: 'Blockers raised on tasks, waiting for a manager’s decision.', kind: 'action' },
      { key: 'attention', label: 'People needing attention', tab: 'People', help: 'People with overdue tasks, unapproved or repeated delays, or tasks without updates in the period.', kind: 'action', period: true },
      { key: 'productivity', label: 'On-time completion', tab: 'On time', help: 'Tasks due in the period that were finished on time.', kind: 'result', period: true },
    ],
  },
  {
    key: 'expenses',
    label: 'Expenses',
    href: '/expenses',
    module: 'expenses',
    items: [
      { key: 'pending_approvals', label: 'Pending approvals', tab: 'Approvals', help: 'Claims waiting for a manager (stage 1) or with accounts (stage 2).', kind: 'action' },
      { key: 'rejected', label: 'Rejected expenses', tab: 'Rejected', help: 'Claims rejected in the period, by a manager or by accounts.', kind: 'result', period: true },
      { key: 'outstanding', label: 'Outstanding submissions', tab: 'Outstanding', help: 'Claims sent back to the employee for clarification, and drafts untouched for 7 days or more.', kind: 'action' },
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
  /** Days covered by the figures marked `period` in the catalogue, in every section at once. */
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
  /** The record's own status, as its module names it ("Under preparation", "Awaiting part", "Won"). */
  status?: string | null;
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

/**
 * The records behind one figure, a page at a time (GET /dashboard/command/records?section=&metric=&offset=&limit=):
 * the leads, visits, bids, tickets, tasks or claims it counts — for a rate, the records it is worked out from; for a
 * figure about people, regions or cities, one row each. Same rule and results period as the figure.
 */
export interface CommandRecordsDto {
  section: CommandSectionKey;
  metric: string;
  /** Every record behind the figure, not just this page. */
  total: number;
  items: CommandListItem[];
  /** Offset of the next page; null once every record has been sent. */
  next: number | null;
  /**
   * How to show `date`: due — a calendar day that can fall overdue; deadline — an instant to count down to;
   * past — when it happened ("3d ago"); none — no date column.
   */
  dates: 'due' | 'deadline' | 'past' | 'none';
}

export interface CommandDashboardDto {
  generatedAt: string;
  /** IST calendar days the "result" figures cover. */
  period: { days: CommandPeriod; from: string; to: string };
  layout: CommandLayout;
  /** Every section the board shows, in layout order — what a caller loading the board a page at a time works through. */
  order: CommandSectionKey[];
  /**
   * The sections asked for (all of `order` unless the request named `sections`), in layout order, with only their
   * visible figures — or, for `only=action`, only the figures that need action.
   */
  sections: CommandSection[];
  /** Sections whose module the administrator switched off for the caller's role (never shown, whatever the layout). */
  unavailable: CommandSectionKey[];
}
