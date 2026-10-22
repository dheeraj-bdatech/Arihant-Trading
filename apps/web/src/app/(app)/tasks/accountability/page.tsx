'use client';

/**
 * Accountability Dashboard (Blueprint §42): per employee and in total — tasks due, overdue, without updates,
 * repeated delays, incomplete work, approved blockers and unapproved delays — for a scope (my team /
 * department / all) and period. Every count drills down to a filtered task list. Scope, period, sort and the
 * open flag tab live in the URL; the server role-scopes everything (403 for a scope you may not see).
 * Layout follows the shared list pattern: five KPI cards in one row, then one filter row (View + search + FilterMenus).
 */
import React, { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowDown, ArrowUp, ArrowUpDown, BarChart3, Building2, CalendarDays, ChevronDown, ChevronRight, ChevronUp, FileSearch, Flag, Search, Users } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  FilterMenu,
  InfoCallout,
  Modal,
  PageContainer,
  PageHeader,
  PageLoader,
  SectionHeader,
  StatCard,
  StatGrid,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
} from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { formatTaskDate, type TaskBlockerStatus, type TaskDisplayStatus } from '@arihant/shared';
import { addDays, errorMessage, istToday, teamTasksHref, useTaskSummary } from '../_lib/task-lib';
import { BlockerBadge, DateTime, FlagChip, Meta, StatusBadge, TaskViewMenu, TaskViewRow, blockerTypeLabel, useToaster, useUrlFilters } from '../_lib/task-ui';
import { DELAY_SERIES, DelayMixBar, Swatch, defaultPeriod, periodError, presetRange, type PeriodPreset } from '../_lib/EvidenceReport';

const KEYS = ['scope', 'from', 'to', 'department_id', 'sort', 'dir', 'flag', 'show'] as const;
const OPEN_STATUSES = 'not_started,in_progress,blocked';

type Scope = 'team' | 'department' | 'all';

interface Department {
  id: string;
  code: string;
  name: string;
  head_user_id: string | null;
  head_name?: string | null;
}

interface Signals {
  due_today: number;
  due_this_week: number;
  overdue: number;
  no_update: number;
  late_unexcused_window: number;
  excessive_extension_tasks: number;
  repeated_delay_flag: boolean;
  incomplete_work: number;
  approved_blockers: number;
  approved_blockers_by_type: Record<string, number>;
  rejected_blockers: number;
  unapproved_delays: number;
  assigned: number;
  completed: number;
  on_time: number;
  late_excused: number;
  late_unexcused: number;
  open_overdue: number;
  on_time_pct: number | null;
  unexcused_delay_days: number;
}

interface EmployeeRow extends Signals {
  employee_id: string;
  name: string;
  role: string;
  is_active: boolean;
  department: string | null;
  manager: string | null;
}

interface TrendPoint {
  week: string;
  on_time: number;
  late_excused: number;
  late_unexcused: number;
}

interface Dashboard {
  scope: Scope;
  period: { from: string; to: string };
  settings: {
    repeated_delay_threshold: number;
    repeated_delay_window_days: number;
    max_extensions_before_flag: number;
    no_update_days: { critical: number; high: number; medium: number; low: number };
  };
  totals: Signals;
  employees: EmployeeRow[];
  trend?: TrendPoint[];
}

interface FlagTask {
  id: string;
  task_number: string;
  title: string;
  status: TaskDisplayStatus;
  priority: string;
  deadline: string | null;
  last_update_at: string | null;
  extension_count: number;
  rework_count: number;
  reopen_count: number;
  assigned_to: string | null;
  assignee_name: string | null;
}

interface FlagBlocker {
  id: string;
  task_id: string;
  blocker_type: string;
  status: TaskBlockerStatus;
  created_at: string;
  raised_after_deadline: boolean;
  decision_comment: string | null;
  task_number: string;
  title: string;
  assignee_name: string | null;
  assigned_to: string | null;
}

interface FlagRepeatedBlocker {
  id: string;
  task_number: string;
  title: string;
  blocker_type: string;
  assignee_name: string | null;
  count: number;
}

interface FlagRepeatedDelay {
  employee_id: string;
  name: string;
  late_unexcused: number;
}

interface Flags {
  overdue?: FlagTask[];
  no_update?: FlagTask[];
  excessive_extensions?: FlagTask[];
  rework?: FlagTask[];
  blocker_after_deadline?: FlagBlocker[];
  rejected_blocker?: FlagBlocker[];
  blocker_sla?: FlagBlocker[];
  repeated_blocker?: FlagRepeatedBlocker[];
  repeated_delay?: FlagRepeatedDelay[];
}

type FlagKey = keyof Flags;

type SortKey = 'name' | 'due_today' | 'due_this_week' | 'overdue' | 'no_update' | 'unapproved_delays' | 'incomplete_work' | 'approved_blockers' | 'on_time_pct' | 'unexcused_delay_days';

/** Per-employee columns (after the name). `filter` = the /tasks/team drill-down for that count. */
const COLUMNS: { key: Exclude<SortKey, 'name'>; label: string; hint: string; risk?: boolean; filter?: 'due_today' | 'due_week' | 'overdue' | 'no_update' | 'unexcused' | 'blocker' }[] = [
  { key: 'due_today', label: 'Due today', hint: 'Open tasks with a deadline today', filter: 'due_today' },
  { key: 'due_this_week', label: 'Due 7 days', hint: 'Open tasks due within the next 7 days', filter: 'due_week' },
  { key: 'overdue', label: 'Overdue', hint: 'Open tasks past their deadline without an accepted blocker', risk: true, filter: 'overdue' },
  { key: 'no_update', label: 'No update', hint: 'Open tasks without a progress update within the priority limit', risk: true, filter: 'no_update' },
  { key: 'unapproved_delays', label: 'Unapproved delays', hint: 'Late (unexcused) + open & overdue in the period + rejected blockers', risk: true, filter: 'unexcused' },
  { key: 'incomplete_work', label: 'Incomplete work', hint: 'Tasks in the period sent back for rework or reopened' },
  { key: 'approved_blockers', label: 'Approved blockers', hint: 'Accepted blockers raised in the period (genuine dependencies)', filter: 'blocker' },
  { key: 'on_time_pct', label: 'On-time %', hint: 'On time ÷ completed, for tasks due in the period' },
  { key: 'unexcused_delay_days', label: 'Unexcused days', hint: 'Total unexcused delay in days for tasks due in the period' },
];

const FLAG_TABS: { id: FlagKey; label: string; hint: string }[] = [
  { id: 'overdue', label: 'Overdue', hint: 'Open tasks past their deadline without an accepted blocker.' },
  { id: 'no_update', label: 'No update', hint: 'Open tasks without a progress update within the limit for their priority.' },
  { id: 'excessive_extensions', label: 'Extended often', hint: 'Tasks extended more than the allowed number of times.' },
  { id: 'rework', label: 'Rework / reopened', hint: 'Tasks sent back for rework or reopened after completion (incomplete work).' },
  { id: 'blocker_after_deadline', label: 'Blocker after deadline', hint: 'Blockers raised only after the task was already overdue.' },
  { id: 'rejected_blocker', label: 'Rejected blockers', hint: 'Blockers the manager did not accept — the clock never paused.' },
  { id: 'blocker_sla', label: 'Blocker review pending', hint: 'Blockers waiting for a manager decision beyond the review SLA.' },
  { id: 'repeated_blocker', label: 'Repeated blocker', hint: 'The same blocker type raised repeatedly on one task.' },
  { id: 'repeated_delay', label: 'Repeated delays', hint: 'Employees at or above the repeated unexcused-delay threshold.' },
];

/** Desktop table: 7 metric columns; related values are stacked as a secondary line (nothing is dropped). */
const TABLE_COLS: { key: Exclude<SortKey, 'name'>; label: string; sub?: 'due_this_week' | 'unexcused_delay_days' }[] = [
  { key: 'due_today', label: 'Due today', sub: 'due_this_week' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'no_update', label: 'No update' },
  { key: 'unapproved_delays', label: 'Unapproved', sub: 'unexcused_delay_days' },
  { key: 'incomplete_work', label: 'Incomplete' },
  { key: 'approved_blockers', label: 'Blockers' },
  { key: 'on_time_pct', label: 'On-time' },
];

/** "Show" filter for the per-employee list (client-side). Counts are employees, not tasks. */
const SHOW_OPTIONS: { key: string; label: string; test: (e: EmployeeRow) => boolean; urgent?: boolean }[] = [
  { key: 'overdue', label: 'With overdue tasks', test: (e) => e.overdue > 0, urgent: true },
  { key: 'no_update', label: 'Without updates', test: (e) => e.no_update > 0 },
  { key: 'unapproved', label: 'With unapproved delays', test: (e) => e.unapproved_delays > 0 },
  { key: 'repeated', label: 'Repeated-delay flag', test: (e) => e.repeated_delay_flag, urgent: true },
  { key: 'due_today', label: 'Due today', test: (e) => e.due_today > 0 },
  { key: 'due_week', label: 'Due in 7 days', test: (e) => e.due_this_week > 0 },
  { key: 'incomplete', label: 'With incomplete work', test: (e) => e.incomplete_work > 0 },
  { key: 'approved', label: 'With approved blockers', test: (e) => e.approved_blockers > 0 },
  { key: 'inactive', label: 'Inactive employees', test: (e) => !e.is_active },
];

const PERIOD_PRESETS: { key: PeriodPreset; label: string }[] = [
  { key: 'this_month', label: 'This month' },
  { key: 'last_30', label: 'Last 30 days' },
  { key: 'this_quarter', label: 'This quarter' },
];
const periodLabel = (from: string, to: string) => PERIOD_PRESETS.find((p) => { const r = presetRange(p.key); return r.from === from && r.to === to; })?.label || 'Custom';
const dateInputCls = 'h-8 rounded-lg border border-[#C9C4B8] bg-white px-2.5 text-xs text-[#14213D] focus:border-[#0F5E63] focus:outline-none focus:ring-2 focus:ring-[#0F5E63]/15';

const roleLabel = (r: string) => r.replace(/_/g, ' ');
const pct = (v: number | null) => (v === null ? '—' : `${v}%`);

// ------------------------------------------------------------------ charts
const TREND_SERIES = DELAY_SERIES.filter((s) => s.key !== 'open_overdue') as { key: 'on_time' | 'late_excused' | 'late_unexcused'; label: string; color: string }[];

/** Weekly stacked columns of tasks completed: on time / late excused / late unexcused (IST weeks, Monday start). */
const WeeklyTrend: React.FC<{ trend: TrendPoint[] }> = ({ trend }) => {
  if (!trend.length) return <p className="text-xs text-[#6B7280] py-6 text-center">No tasks were completed in this period.</p>;
  const H = 120;
  const totals = trend.map((w) => w.on_time + w.late_excused + w.late_unexcused);
  const max = Math.max(1, ...totals);
  const summary = trend.map((w, i) => `week of ${formatTaskDate(w.week)}: ${totals[i]} completed (${TREND_SERIES.map((s) => `${s.label} ${w[s.key]}`).join(', ')})`).join('; ');
  return (
    <figure className="space-y-3">
      {/* overflowX inline: theme.css resets `.overflow-x-auto` below 1180px (for stacked tables), and the card
          clips — a long period's weeks would be cut off on a phone instead of scrolling. */}
      <div className="custom-scrollbar overscroll-x-contain" style={{ overflowX: 'auto' }}>
        <div role="img" aria-label={`Tasks completed per week — ${summary}`} className="flex min-w-full items-end gap-1.5 border-b border-[#ECE9E2] px-1" style={{ height: H + 22 }}>
          {trend.map((w, i) => (
            <div key={w.week} className="flex h-full min-w-[28px] flex-1 flex-col items-center justify-end">
              <span className="mb-1 font-mono text-[11px] font-semibold tabular-nums text-[#14213D]">{totals[i]}</span>
              <div className="flex w-full max-w-[24px] flex-col-reverse gap-[2px]" style={{ height: Math.max(3, (totals[i] / max) * H) }}>
                {TREND_SERIES.map((s) =>
                  w[s.key] > 0 ? (
                    <span
                      key={s.key}
                      title={`Week of ${formatTaskDate(w.week)} · ${s.label}: ${w[s.key]}`}
                      className="block w-full min-h-[3px] last:rounded-t-[4px]"
                      style={{ flexGrow: w[s.key], flexBasis: 0, background: s.color }}
                    />
                  ) : null,
                )}
              </div>
            </div>
          ))}
        </div>
        <div className="flex min-w-full gap-1.5 px-1 pt-1.5" aria-hidden>
          {trend.map((w) => (
            <span key={w.week} className="min-w-[28px] flex-1 text-center font-mono text-[10px] text-[#4A5568]" title={`Week of ${formatTaskDate(w.week)}`}>
              {formatTaskDate(w.week).slice(0, 5)}
            </span>
          ))}
        </div>
      </div>
      <figcaption>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#4A5568]">
          {TREND_SERIES.map((s) => (
            <li key={s.key} className="inline-flex items-center gap-1.5">
              <Swatch color={s.color} />
              {s.label}
              <span className="font-mono tabular-nums font-semibold text-[#14213D]">{trend.reduce((a, w) => a + w[s.key], 0)}</span>
            </li>
          ))}
        </ul>
        <p className="mt-1 text-[11px] text-[#6B7280]">Columns are weeks starting Monday (DD-MM), by IST completion date.</p>
      </figcaption>
    </figure>
  );
};

// ------------------------------------------------------------------ small pieces
const CountCell: React.FC<{ value: number; href?: string | null; risk?: boolean; label: string }> = ({ value, href, risk, label }) => {
  if (!value) return <span className="font-mono tabular-nums text-[#6B7280]">0</span>;
  const cls = `font-mono tabular-nums font-semibold ${risk ? 'text-[#9A3412]' : 'text-[#14213D]'}`;
  return href ? (
    <Link href={href} className={`${cls} underline decoration-[#C9C4B8] underline-offset-2 hover:text-[#0F5E63] hover:decoration-[#0F5E63]`} aria-label={`${value} — ${label}`}>
      {value}
    </Link>
  ) : (
    <span className={cls}>{value}</span>
  );
};

interface Tile {
  key: string;
  label: string;
  value: number;
  sub: string;
  variant?: 'default' | 'primary' | 'amber' | 'rose';
  href?: string;
  onClick?: () => void;
}

const SignalTile: React.FC<{ tile: Tile }> = ({ tile }) => {
  const cls = 'group block h-full w-full text-left rounded-[14px] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5E63]/40';
  const card = <StatCard label={tile.label} value={String(tile.value)} subtext={tile.sub} variant={tile.value ? tile.variant : 'default'} className="h-full group-hover:border-[#0F5E63]" />;
  const label = `${tile.label}: ${tile.value}. ${tile.href ? 'Open the task list' : 'Show the flagged items'}`;
  return tile.href ? (
    <Link href={tile.href} className={cls} aria-label={label}>
      {card}
    </Link>
  ) : (
    <button type="button" onClick={tile.onClick} className={cls} aria-label={label}>
      {card}
    </button>
  );
};

// ------------------------------------------------------------------ page
function Accountability() {
  const { user } = useAuth();
  const router = useRouter();
  const { summary } = useTaskSummary(Boolean(user));
  const { values, set } = useUrlFilters(KEYS);
  const { push, Toaster } = useToaster();
  const [departments, setDepartments] = useState<Department[] | null>(null);
  const [data, setData] = useState<Dashboard | null>(null);
  const [flags, setFlags] = useState<Flags | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drillId, setDrillId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [datesOpen, setDatesOpen] = useState(false);

  useEffect(() => {
    api
      .get<Department[]>('/task-calendar/departments')
      .then((d) => setDepartments(Array.isArray(d) ? d : []))
      .catch(() => setDepartments([]));
  }, []);

  const ready = Boolean(summary) && departments !== null;
  const canAll = Boolean(summary?.can_view_all);
  const hasTeam = Boolean(summary?.has_team);
  const canEvidence = Boolean(summary?.can_view_evidence);
  const headed = useMemo(() => (departments || []).filter((d) => user && d.head_user_id === user.id), [departments, user]);
  const deptOptions = canAll ? departments || [] : headed;
  const scopes = useMemo(() => {
    const s: { id: Scope; label: string }[] = [];
    if (hasTeam) s.push({ id: 'team', label: 'My team' });
    if (deptOptions.length) s.push({ id: 'department', label: 'Department' });
    if (canAll) s.push({ id: 'all', label: 'All employees' });
    return s;
  }, [hasTeam, deptOptions.length, canAll]);
  const scope: Scope = scopes.some((s) => s.id === values.scope) ? (values.scope as Scope) : scopes[0]?.id || 'team';
  const departmentId = scope === 'department' ? (deptOptions.some((d) => d.id === values.department_id) ? values.department_id : deptOptions[0]?.id || '') : '';
  const noAccess = ready && scopes.length === 0;

  const def = useMemo(() => defaultPeriod(), []);
  const from = values.from || def.from;
  const to = values.to || def.to;
  const rangeError = periodError(from, to);
  const today = istToday();

  const load = useCallback(async () => {
    if (!ready || noAccess || rangeError) return;
    setLoading(true);
    setError(null);
    const q = { scope, department_id: departmentId || undefined };
    try {
      const [d, f] = await Promise.all([
        api.get<Dashboard>('/accountability/dashboard', { ...q, from, to }),
        api.get<Flags>('/accountability/flags', q).catch((e) => {
          push('error', errorMessage(e, 'Flagged items could not be loaded.'));
          return null;
        }),
      ]);
      setData(d);
      setFlags(f);
    } catch (e) {
      setData(null);
      setFlags(null);
      setError(errorMessage(e, 'Could not load the dashboard.'));
    } finally {
      setLoading(false);
    }
  }, [ready, noAccess, rangeError, scope, departmentId, from, to, push]);

  useEffect(() => {
    load();
  }, [load]);

  // ---------------------------------------------------------------- drill-down links
  const base = useMemo<Record<string, string | undefined>>(() => (scope === 'department' && departmentId ? { department_ids: departmentId } : {}), [scope, departmentId]);
  const filterHref = useCallback(
    (filter: (typeof COLUMNS)[number]['filter'], extra: Record<string, string | undefined> = {}) => {
      const p = { ...base, ...extra };
      switch (filter) {
        case 'due_today':
          return teamTasksHref({ ...p, deadline_from: today, deadline_to: today, statuses: OPEN_STATUSES });
        case 'due_week':
          return teamTasksHref({ ...p, deadline_from: today, deadline_to: addDays(today, 6), statuses: OPEN_STATUSES });
        case 'overdue':
          return teamTasksHref({ ...p, statuses: 'overdue' });
        case 'no_update':
          return teamTasksHref({ ...p, no_update: 'true' });
        case 'unexcused':
          return teamTasksHref({ ...p, delay_class: 'late_unexcused' });
        case 'blocker':
          return teamTasksHref({ ...p, has_open_blocker: 'true' });
        default:
          return null;
      }
    },
    [base, today],
  );

  const showFlag = useCallback(
    (flag: FlagKey) => {
      set({ flag }, { resetPage: false });
      window.setTimeout(() => document.getElementById('flags')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    },
    [set],
  );

  // ---------------------------------------------------------------- sorting
  const sortKey: SortKey = values.sort === 'name' || COLUMNS.some((c) => c.key === values.sort) ? (values.sort as SortKey) : 'unapproved_delays';
  const dir: 'asc' | 'desc' = values.dir === 'asc' || values.dir === 'desc' ? values.dir : sortKey === 'name' ? 'asc' : 'desc';
  const toggleSort = (k: SortKey) => set(k === sortKey ? { sort: k, dir: dir === 'asc' ? 'desc' : 'asc' } : { sort: k, dir: k === 'name' ? 'asc' : 'desc' }, { resetPage: false });
  const show = SHOW_OPTIONS.find((o) => o.key === values.show) || null;
  const employees = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = (data?.employees || []).filter(
      (e) => (!show || show.test(e)) && (!q || [e.name, roleLabel(e.role), e.department, e.manager].some((v) => v && v.toLowerCase().includes(q))),
    );
    const val = (e: EmployeeRow) => (sortKey === 'on_time_pct' ? (e.on_time_pct ?? -1) : sortKey === 'name' ? 0 : (e[sortKey] as number));
    rows.sort((a, b) => {
      const c = sortKey === 'name' ? a.name.localeCompare(b.name) : val(a) - val(b);
      return (dir === 'asc' ? c : -c) || a.name.localeCompare(b.name);
    });
    return rows;
  }, [data, sortKey, dir, show, query]);

  const drill = drillId ? data?.employees.find((e) => e.employee_id === drillId) || null : null;
  const flagged = (data?.employees || []).filter((e) => e.repeated_delay_flag).length;
  const s = data?.settings;

  const flagTabs = FLAG_TABS.map((t) => ({ ...t, count: flags?.[t.id]?.length ?? 0 }));
  const activeFlag: FlagKey = FLAG_TABS.some((t) => t.id === values.flag) ? (values.flag as FlagKey) : flagTabs.find((t) => t.count > 0)?.id || 'overdue';

  const t = data?.totals;
  const tiles: Tile[] = t
    ? [
        { key: 'due_week', label: 'Due this week', value: t.due_this_week, sub: `${t.due_today} due today · to ${formatTaskDate(addDays(today, 6))}`, href: filterHref('due_week') || undefined },
        { key: 'overdue', label: 'Overdue', value: t.overdue, sub: 'Past deadline, no accepted blocker', variant: 'amber', href: filterHref('overdue') || undefined },
        { key: 'no_update', label: 'Without updates', value: t.no_update, sub: 'No progress update within the limit', variant: 'amber', href: filterHref('no_update') || undefined },
        { key: 'unapproved', label: 'Unapproved delays', value: t.unapproved_delays, sub: `${t.unexcused_delay_days} d unexcused · ${t.incomplete_work} reworked`, variant: 'rose', href: filterHref('unexcused') || undefined },
        { key: 'repeated', label: 'Repeated delays', value: flagged, sub: 'Employees flagged', variant: 'rose', onClick: () => showFlag('repeated_delay') },
      ]
    : [];

  // ---------------------------------------------------------------- filter row
  const scopeKey = scope === 'department' ? `dept:${departmentId}` : scope;
  const defaultScopeKey = scopes[0]?.id === 'department' ? `dept:${deptOptions[0]?.id || ''}` : scopes[0]?.id || 'team';
  const scopeOptions = [
    ...scopes.filter((x) => x.id !== 'department').map((x) => ({ key: x.id as string, label: x.label, icon: <Users />, onSelect: () => set({ scope: x.id, department_id: null, flag: null }, { resetPage: false }) })),
    ...(scopes.some((x) => x.id === 'department') ? deptOptions : []).map((d) => ({
      key: `dept:${d.id}`,
      label: d.name,
      icon: <Building2 />,
      onSelect: () => set({ scope: 'department', department_id: d.id, flag: null }, { resetPage: false }),
    })),
  ].map((o) => ({ ...o, active: o.key === scopeKey }));
  const datesSet = Boolean(values.from || values.to);
  const showDates = datesOpen || Boolean(rangeError);
  const hasActiveFilters = Boolean(query.trim() || show || datesSet || scopeKey !== defaultScopeKey);
  const clearFilters = () => {
    setQuery('');
    setDatesOpen(false);
    set({ scope: null, department_id: null, from: null, to: null, show: null, flag: null }, { resetPage: false });
  };

  const scopeLabel = scope === 'department' ? deptOptions.find((d) => d.id === departmentId)?.name || 'Department' : scope === 'all' ? 'All employees' : 'My team';

  // Plain render helpers (not components) so header buttons keep focus across re-sorts.
  const sortHead = (k: SortKey, label: string, hint?: string, right?: boolean) => {
    const active = sortKey === k;
    return (
      <TableHead key={k} aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'} className={right ? 'text-right' : undefined}>
        <button type="button" onClick={() => toggleSort(k)} title={hint} className={`inline-flex items-center gap-1 uppercase tracking-wider hover:text-[#0F5E63] ${right ? 'flex-row-reverse' : ''} ${active ? 'text-[#14213D]' : ''}`}>
          <span className="whitespace-nowrap">{label}</span>
          {active ? dir === 'asc' ? <ArrowUp className="h-3 w-3" aria-hidden /> : <ArrowDown className="h-3 w-3" aria-hidden /> : <ArrowUpDown className="h-3 w-3 opacity-40" aria-hidden />}
        </button>
      </TableHead>
    );
  };

  const employeeChips = (e: EmployeeRow) => (
    <>
      {e.repeated_delay_flag && <FlagChip tone="danger">Repeated delay</FlagChip>}
      {!e.is_active && <FlagChip>Inactive</FlagChip>}
    </>
  );

  const cellFor = (e: EmployeeRow, c: (typeof COLUMNS)[number]) => {
    if (c.key === 'on_time_pct') {
      return (
        <span className="font-mono tabular-nums">
          <span className="font-semibold text-[#14213D]">{pct(e.on_time_pct)}</span>
          <span className="block text-[10px] text-[#6B7280]">
            {e.completed}/{e.assigned} done
          </span>
        </span>
      );
    }
    if (c.key === 'unexcused_delay_days') return <span className={`font-mono tabular-nums ${e.unexcused_delay_days ? 'font-semibold text-[#9A3412]' : 'text-[#6B7280]'}`}>{e.unexcused_delay_days} d</span>;
    if (c.key === 'incomplete_work' && e.incomplete_work) {
      return (
        <button type="button" onClick={() => showFlag('rework')} className="font-mono tabular-nums font-semibold text-[#14213D] underline decoration-[#C9C4B8] underline-offset-2 hover:text-[#0F5E63]" aria-label={`${e.incomplete_work} — incomplete work for ${e.name}; show flagged rework`}>
          {e.incomplete_work}
        </button>
      );
    }
    return <CountCell value={e[c.key] as number} risk={c.risk} href={filterHref(c.filter, { assignee_ids: e.employee_id })} label={`${c.label} for ${e.name}`} />;
  };

  const subLine = (e: EmployeeRow, sub: 'due_this_week' | 'unexcused_delay_days') => {
    if (sub === 'unexcused_delay_days') {
      return <span className={`block font-mono text-[11px] tabular-nums ${e.unexcused_delay_days ? 'font-semibold text-[#9A3412]' : 'text-[#4A5568]'}`}>{e.unexcused_delay_days} d unexcused</span>;
    }
    const href = filterHref('due_week', { assignee_ids: e.employee_id });
    return (
      <span className="block text-[11px] text-[#4A5568]">
        {e.due_this_week && href ? (
          <Link href={href} className="font-mono tabular-nums font-semibold text-[#14213D] underline decoration-[#C9C4B8] underline-offset-2 hover:text-[#0F5E63]" aria-label={`${e.due_this_week} — due in 7 days for ${e.name}`}>
            {e.due_this_week}
          </Link>
        ) : (
          <span className="font-mono tabular-nums">{e.due_this_week}</span>
        )}{' '}
        in 7 d
      </span>
    );
  };

  return (
    <PageContainer>
      <PageHeader title="Accountability" icon={<BarChart3 className="h-5 w-5" />} />

      {/* Key metrics for the scope and period picked in the filter row below. */}
      {ready && !noAccess && !rangeError && tiles.length > 0 && (
        <StatGrid cols={5} className={`gap-3 transition-opacity ${loading ? 'opacity-60' : ''}`}>
          {tiles.map((tile) => (
            <SignalTile key={tile.key} tile={tile} />
          ))}
        </StatGrid>
      )}

      {!ready || noAccess ? (
        <TaskViewRow />
      ) : (
        /* One filter row: View, search (employees), scope, period, show, sort. */
        <Card padding="sm" className="relative z-20 space-y-2.5 overflow-visible border-[#DCD8CE]">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
            <TaskViewMenu />
            <div className="relative w-full min-w-[200px] lg:w-auto lg:flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6B7280]" aria-hidden />
              <input
                type="search"
                aria-label="Search employees"
                placeholder="Search employee, role, department…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="h-9 w-full rounded-lg border border-[#C9C4B8] bg-white pl-9 pr-3 text-xs text-[#14213D] placeholder:text-[#6B7280] focus:border-[#0F5E63] focus:outline-none focus:ring-2 focus:ring-[#0F5E63]/15"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2 lg:flex-nowrap">
              <FilterMenu label="Scope" icon={<Users />} neutralKeys={[defaultScopeKey]} options={scopeOptions} className="[&_.filter-menu-panel]:max-h-[320px] [&_.filter-menu-panel]:overflow-y-auto" />
              <button type="button" onClick={() => setDatesOpen((o) => !o)} aria-expanded={showDates} className={`filter-menu-btn ${showDates || datesSet ? 'filter-menu-btn--on' : ''}`}>
                <CalendarDays className="h-3.5 w-3.5" />
                <span>Period</span>
                <span className="filter-menu-chip max-w-[130px] truncate">{periodLabel(from, to)}</span>
              </button>
              <FilterMenu
                label="Show"
                icon={<Flag />}
                className="[&_.filter-menu-panel]:max-h-[320px] [&_.filter-menu-panel]:overflow-y-auto"
                options={[
                  { key: 'all', label: 'All employees', count: data?.employees.length, active: !show, onSelect: () => set({ show: null }, { resetPage: false }) },
                  ...SHOW_OPTIONS.map((o) => ({
                    key: o.key,
                    label: o.label,
                    urgent: o.urgent,
                    count: data ? data.employees.filter(o.test).length : undefined,
                    active: show?.key === o.key,
                    onSelect: () => set({ show: o.key }, { resetPage: false }),
                  })),
                ]}
              />
              <FilterMenu
                label="Sort"
                icon={<ArrowUpDown />}
                align="right"
                neutralKeys={['name', ...COLUMNS.map((c) => c.key), 'dir_desc', 'dir_asc']}
                className="[&_.filter-menu-panel]:max-h-[360px] [&_.filter-menu-panel]:overflow-y-auto"
                options={[
                  ...[{ key: 'name' as SortKey, label: 'Name' }, ...COLUMNS].map((o) => ({
                    key: o.key as string,
                    label: o.label,
                    active: sortKey === o.key,
                    onSelect: () => set({ sort: o.key, dir: o.key === 'name' ? 'asc' : 'desc' }, { resetPage: false }),
                  })),
                  { key: 'dir_desc', label: 'Descending', icon: <ChevronDown />, active: dir === 'desc', onSelect: () => set({ sort: sortKey, dir: 'desc' }, { resetPage: false }) },
                  { key: 'dir_asc', label: 'Ascending', icon: <ChevronUp />, active: dir === 'asc', onSelect: () => set({ sort: sortKey, dir: 'asc' }, { resetPage: false }) },
                ]}
              />
              {hasActiveFilters && (
                <Button variant="ghost" size="xs" onClick={clearFilters} className="text-xs text-[#4A5568] hover:text-[#881337]">
                  Clear
                </Button>
              )}
            </div>
          </div>

          {showDates && (
            <div className="flex flex-wrap items-center gap-3 border-t border-[#ECE9E2] pt-2.5 text-xs">
              <span className="font-semibold text-[#4A5568]">Period</span>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Period presets">
                {PERIOD_PRESETS.map((p) => {
                  const r = presetRange(p.key);
                  const on = r.from === from && r.to === to;
                  return (
                    <Button key={p.key} type="button" size="xs" variant={on ? 'primary' : 'secondary'} aria-pressed={on} onClick={() => set({ from: r.from, to: r.to }, { resetPage: false })}>
                      {p.label}
                    </Button>
                  );
                })}
              </div>
              <label className="flex items-center gap-1.5 text-[#4A5568]">
                From
                <input type="date" value={from} onChange={(e) => e.target.value && set({ from: e.target.value, to }, { resetPage: false })} className={dateInputCls} />
              </label>
              <label className="flex items-center gap-1.5 text-[#4A5568]">
                To
                <input type="date" value={to} min={from || undefined} onChange={(e) => e.target.value && set({ from, to: e.target.value }, { resetPage: false })} aria-invalid={Boolean(rangeError)} className={dateInputCls} />
              </label>
              {rangeError ? (
                <span role="alert" className="font-semibold text-[#9A3412]">
                  {rangeError}
                </span>
              ) : (
                <span className="text-[11px] text-[#6B7280]">Calendar days in IST.</span>
              )}
            </div>
          )}
        </Card>
      )}

      {!ready ? (
        <PageLoader rows={4} label="Loading accountability" />
      ) : noAccess ? (
        <EmptyState
          icon={Users}
          title="No team to show"
          description="The accountability dashboard covers people who report to you or a department you head. Your own numbers are under My Performance."
          action={
            <Button variant="secondary" onClick={() => router.push('/tasks/my-performance')}>
              Open My Performance
            </Button>
          }
        />
      ) : (
        <>
          {error && (
            <InfoCallout variant="danger" title="Could not load the dashboard">
              <div className="flex flex-wrap items-center gap-3">
                <span>{error}</span>
                <Button size="xs" variant="secondary" onClick={load}>
                  Try again
                </Button>
              </div>
            </InfoCallout>
          )}

          {rangeError ? null : loading && !data ? (
            <PageLoader rows={5} label="Loading accountability" />
          ) : (
            data &&
            t &&
            s && (
              <div className={`space-y-6 transition-opacity ${loading ? 'opacity-60' : ''}`} aria-busy={loading}>
                <p className="text-xs text-[#4A5568]">
                  <span className="font-semibold text-[#14213D]">{scopeLabel}</span> · {data.employees.length} employee(s) · period{' '}
                  <span className="font-mono">
                    {formatTaskDate(data.period.from)} – {formatTaskDate(data.period.to)}
                  </span>
                  . Due, overdue and no-update counts are live; the rest cover tasks whose original deadline falls in the period.
                </p>

                <div className="grid gap-4 lg:grid-cols-2">
                  <Card padding="md" className="space-y-4">
                    <SectionHeader title="Completed per week" description="On time vs late (excused) vs late (unexcused)." />
                    <WeeklyTrend trend={data.trend || []} />
                  </Card>
                  <Card padding="md" className="space-y-4">
                    <SectionHeader title="Delay classes in the period" description="All tasks due in the period, measured against the original deadline." />
                    <DelayMixBar title="Delay classes in the period" counts={{ on_time: t.on_time, late_excused: t.late_excused, late_unexcused: t.late_unexcused, open_overdue: t.open_overdue }} />
                    <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3 border-t border-[#ECE9E2] pt-3">
                      <Meta label="Due in period">
                        <span className="font-mono tabular-nums">{t.assigned}</span>
                      </Meta>
                      <Meta label="Completed">
                        <span className="font-mono tabular-nums">{t.completed}</span>
                      </Meta>
                      <Meta label="On-time rate">
                        <span className="font-mono tabular-nums">{pct(t.on_time_pct)}</span>
                      </Meta>
                      <Meta label="Unexcused delay">
                        <span className="font-mono tabular-nums">{t.unexcused_delay_days} d</span>
                      </Meta>
                      <Meta label="Incomplete work">
                        {t.incomplete_work ? (
                          <button type="button" onClick={() => showFlag('rework')} className="font-mono tabular-nums font-semibold underline decoration-[#C9C4B8] underline-offset-2 hover:text-[#0F5E63]" aria-label={`${t.incomplete_work} — incomplete work; show flagged rework`}>
                            {t.incomplete_work}
                          </button>
                        ) : (
                          <span className="font-mono tabular-nums">0</span>
                        )}
                      </Meta>
                      <Meta label="Approved blockers">
                        <CountCell value={t.approved_blockers} href={filterHref('blocker')} label="Approved blockers — open the task list" />
                      </Meta>
                    </dl>
                  </Card>
                </div>

                <section className="space-y-3" aria-labelledby="per-employee">
                  <SectionHeader title="Per employee" description="Click a column to sort. Numbers open the matching task list; a name opens the details." id="per-employee" />
                  {data.employees.length === 0 ? (
                    <EmptyState icon={Users} title="No employees in this scope" description="Nobody is assigned to this team or department yet." />
                  ) : employees.length === 0 ? (
                    <EmptyState
                      icon={Search}
                      title="No employees match"
                      description="Try another search or Show filter."
                      action={
                        <Button variant="secondary" onClick={() => { setQuery(''); set({ show: null }, { resetPage: false }); }}>
                          Clear search and Show
                        </Button>
                      }
                    />
                  ) : (
                    <>
                      <div className="hidden md:block">
                        <Table className="[&_td]:px-3 [&_th]:px-3">
                          <TableHeader>
                            <TableRow>
                              {sortHead('name', 'Employee')}
                              {TABLE_COLS.map((tc) => {
                                const c = COLUMNS.find((x) => x.key === tc.key);
                                const sub = tc.sub && COLUMNS.find((x) => x.key === tc.sub);
                                return sortHead(tc.key, tc.label, [c ? `${c.label}: ${c.hint}` : '', sub ? `Below: ${sub.label} — ${sub.hint}` : ''].filter(Boolean).join('\n'), true);
                              })}
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {employees.map((e) => (
                              <TableRow key={e.employee_id} className={e.is_active ? undefined : 'bg-[#FBFAF7]'}>
                                <TableCell className="w-[220px] max-w-[220px]">
                                  <button type="button" onClick={() => setDrillId(e.employee_id)} className="block w-full min-w-0 text-left group" aria-label={`Open details for ${e.name}`}>
                                    <span className="block truncate text-sm font-semibold text-[#14213D] group-hover:text-[#0F5E63] group-hover:underline" title={e.name}>
                                      {e.name}
                                    </span>
                                    <span className="block truncate text-[11px] text-[#4A5568] capitalize" title={[roleLabel(e.role), e.department].filter(Boolean).join(' · ')}>
                                      {[roleLabel(e.role), e.department].filter(Boolean).join(' · ')}
                                    </span>
                                  </button>
                                  <div className="mt-1 flex flex-wrap gap-1">
                                    {employeeChips(e)}
                                  </div>
                                </TableCell>
                                {TABLE_COLS.map((tc) => {
                                  const c = COLUMNS.find((x) => x.key === tc.key)!;
                                  return (
                                    <TableCell key={tc.key} className="text-right">
                                      {cellFor(e, c)}
                                      {tc.sub && subLine(e, tc.sub)}
                                    </TableCell>
                                  );
                                })}
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>

                      <div className="md:hidden space-y-3">
                        <ul className="space-y-2.5">
                          {employees.map((e) => (
                            <li key={e.employee_id} className={`rounded-[14px] border border-[#DCD8CE] p-3 space-y-2.5 ${e.is_active ? 'bg-white' : 'bg-[#FBFAF7]'}`}>
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <p className="text-sm font-semibold text-[#14213D] break-words">{e.name}</p>
                                  <p className="text-[11px] text-[#4A5568] capitalize">{[roleLabel(e.role), e.department].filter(Boolean).join(' · ')}</p>
                                </div>
                                <div className="flex flex-wrap justify-end gap-1">
                                  {employeeChips(e)}
                                </div>
                              </div>
                              <dl className="grid grid-cols-3 gap-x-2 gap-y-2">
                                {COLUMNS.map((c) => (
                                  <div key={c.key} className="min-w-0">
                                    <dt className="text-[10px] uppercase tracking-wide text-[#4A5568] truncate" title={c.hint}>
                                      {c.label}
                                    </dt>
                                    <dd className="text-sm">{cellFor(e, c)}</dd>
                                  </div>
                                ))}
                              </dl>
                              <Button size="xs" variant="secondary" fullWidth className="h-10" rightIcon={<ChevronRight className="h-3.5 w-3.5" />} onClick={() => setDrillId(e.employee_id)}>
                                Details
                              </Button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </>
                  )}
                </section>

                <section id="flags" className="space-y-3 scroll-mt-4" aria-labelledby="flags-title">
                  <SectionHeader id="flags-title" title="Flagged items" icon={<Flag className="h-4 w-4" />} description="Current state for this scope (not limited to the period)." />
                  <p className="text-[11px] text-[#4A5568] bg-[#FBFAF7] border border-[#ECE9E2] rounded-lg px-3 py-2">
                    <span className="font-semibold text-[#14213D]">Thresholds:</span> Repeated delay = ≥{s.repeated_delay_threshold} unexcused late tasks in {s.repeated_delay_window_days} days or a task extended more than {s.max_extensions_before_flag} times. Without
                    update = no progress update for {s.no_update_days.critical} / {s.no_update_days.high} / {s.no_update_days.medium} / {s.no_update_days.low} days (critical / high / medium / low priority).
                  </p>
                  {flags === null ? (
                    <p className="text-sm text-[#6B7280]">Flagged items are not available right now.</p>
                  ) : (
                    <Card padding="sm" className="space-y-3">
                      <Tabs variant="pills" size="sm" activeTab={activeFlag} onChange={(id) => set({ flag: id }, { resetPage: false })} tabs={flagTabs.map((f) => ({ id: f.id, label: f.label, count: f.count, badgeVariant: f.count ? 'warning' : undefined }))} />
                      <p className="text-xs text-[#4A5568]">{FLAG_TABS.find((f) => f.id === activeFlag)?.hint}</p>
                      <FlagList kind={activeFlag} flags={flags} windowDays={s.repeated_delay_window_days} knownIds={new Set(data.employees.map((e) => e.employee_id))} onEmployee={setDrillId} />
                    </Card>
                  )}
                </section>
              </div>
            )
          )}
        </>
      )}

      {drill && data && (
        <EmployeeDrawer
          e={drill}
          settings={data.settings}
          period={data.period}
          canEvidence={canEvidence}
          isSelf={drill.employee_id === user?.id}
          hrefFor={(f) => filterHref(f, { assignee_ids: drill.employee_id }) || teamTasksHref({ assignee_ids: drill.employee_id })}
          onClose={() => setDrillId(null)}
        />
      )}
      <Toaster />
    </PageContainer>
  );
}

// ------------------------------------------------------------------ flags list
const FlagList: React.FC<{ kind: FlagKey; flags: Flags; windowDays: number; knownIds: Set<string>; onEmployee: (id: string) => void }> = ({ kind, flags, windowDays, knownIds, onEmployee }) => {
  const rows = flags[kind] || [];
  if (!rows.length) return <p className="py-4 text-center text-sm text-[#6B7280]">Nothing flagged here.</p>;
  const item = 'flex flex-col gap-1 px-3 py-2.5 sm:flex-row sm:items-center sm:gap-3';
  const taskTitle = (id: string, number: string, title: string) => (
    <Link href={`/tasks/${id}`} className="min-w-0 flex-1 group">
      <span className="font-mono text-xs font-semibold text-[#0F5E63] group-hover:underline">{number}</span> <span className="text-sm text-[#14213D] break-words">{title}</span>
    </Link>
  );
  return (
    <ul className="divide-y divide-[#ECE9E2] rounded-lg border border-[#ECE9E2] max-h-[480px] overflow-y-auto">
      {kind === 'repeated_delay'
        ? (rows as FlagRepeatedDelay[]).map((r) => (
            <li key={r.employee_id} className={item}>
              {knownIds.has(r.employee_id) ? (
                <button type="button" onClick={() => onEmployee(r.employee_id)} className="min-w-0 flex-1 text-left text-sm font-semibold text-[#0F5E63] hover:underline" aria-label={`Open details for ${r.name}`}>
                  {r.name}
                </button>
              ) : (
                <span className="min-w-0 flex-1 text-sm font-semibold text-[#14213D]">{r.name}</span>
              )}
              <span className="text-xs text-[#4A5568]">
                <span className="font-mono font-semibold text-[#9A3412]">{r.late_unexcused}</span> unexcused late task(s) in the last {windowDays} days
              </span>
              <Link href={teamTasksHref({ assignee_ids: r.employee_id, delay_class: 'late_unexcused' })} className="text-xs font-semibold text-[#0F5E63] hover:underline whitespace-nowrap">
                View tasks
              </Link>
            </li>
          ))
        : kind === 'repeated_blocker'
          ? (rows as FlagRepeatedBlocker[]).map((r) => (
              <li key={`${r.id}-${r.blocker_type}`} className={item}>
                {taskTitle(r.id, r.task_number, r.title)}
                <span className="text-xs text-[#4A5568]">
                  {r.assignee_name || '—'} · {blockerTypeLabel(r.blocker_type)} raised <span className="font-mono font-semibold text-[#9A3412]">{r.count}</span> times
                </span>
              </li>
            ))
          : kind === 'blocker_after_deadline' || kind === 'rejected_blocker' || kind === 'blocker_sla'
            ? (rows as FlagBlocker[]).map((b) => (
                <li key={b.id} className={item}>
                  <div className="min-w-0 flex-1 space-y-0.5">
                    {taskTitle(b.task_id, b.task_number, b.title)}
                    {b.decision_comment && <p className="text-[11px] text-[#4A5568] break-words">Decision: {b.decision_comment}</p>}
                  </div>
                  <span className="text-xs text-[#4A5568]">
                    {b.assignee_name || '—'} · {blockerTypeLabel(b.blocker_type)} · raised <DateTime value={b.created_at} />
                  </span>
                  <BlockerBadge status={b.status} />
                </li>
              ))
            : (rows as FlagTask[]).map((r) => (
                <li key={r.id} className={item}>
                  {taskTitle(r.id, r.task_number, r.title)}
                  <span className="text-xs text-[#4A5568]">
                    {r.assignee_name || 'Unassigned'} ·{' '}
                    {kind === 'no_update' ? (
                      <>
                        last update <DateTime value={r.last_update_at} />
                      </>
                    ) : kind === 'excessive_extensions' ? (
                      <>
                        extended <span className="font-mono font-semibold">{r.extension_count}</span> times
                      </>
                    ) : kind === 'rework' ? (
                      [r.rework_count ? `sent back ×${r.rework_count}` : null, r.reopen_count ? `reopened ×${r.reopen_count}` : null].filter(Boolean).join(' · ')
                    ) : (
                      <>
                        deadline <DateTime value={r.deadline} />
                      </>
                    )}
                  </span>
                  <StatusBadge status={r.status} />
                </li>
              ))}
    </ul>
  );
};

// ------------------------------------------------------------------ employee drill-down
const EmployeeDrawer: React.FC<{
  e: EmployeeRow;
  settings: Dashboard['settings'];
  period: Dashboard['period'];
  canEvidence: boolean;
  isSelf: boolean;
  hrefFor: (f: (typeof COLUMNS)[number]['filter']) => string;
  onClose: () => void;
}> = ({ e, settings: s, period, canEvidence, isSelf, hrefFor, onClose }) => {
  const byType = Object.entries(e.approved_blockers_by_type || {});
  const num = (v: React.ReactNode) => <span className="font-mono tabular-nums">{v}</span>;
  const links: { label: string; href: string; count?: number }[] = [
    { label: 'Overdue tasks', href: hrefFor('overdue'), count: e.overdue },
    { label: 'Tasks without updates', href: hrefFor('no_update'), count: e.no_update },
    { label: 'Late (unexcused) tasks', href: hrefFor('unexcused') },
    { label: 'Tasks with an open blocker', href: hrefFor('blocker') },
    { label: 'Due in the next 7 days', href: hrefFor('due_week'), count: e.due_this_week },
    { label: 'All tasks', href: teamTasksHref({ assignee_ids: e.employee_id }) },
  ];
  return (
    <Modal isOpen onClose={onClose} title={e.name} description={[roleLabel(e.role), e.department, e.manager ? `reports to ${e.manager}` : null].filter(Boolean).join(' · ')} maxWidth="3xl">
      <div className="space-y-5">
        {(e.repeated_delay_flag || !e.is_active) && (
          <div className="flex flex-wrap gap-1.5">
            {e.repeated_delay_flag && <FlagChip tone="danger">Repeated delay</FlagChip>}
            {!e.is_active && <FlagChip>Inactive employee</FlagChip>}
          </div>
        )}
        {e.repeated_delay_flag && (
          <InfoCallout variant="warning" title="Why this employee is flagged">
            <ul className="list-disc pl-4 space-y-0.5">
              {e.late_unexcused_window >= s.repeated_delay_threshold && (
                <li>
                  {e.late_unexcused_window} task(s) completed late without an excuse in the last {s.repeated_delay_window_days} days (flag at {s.repeated_delay_threshold}).
                </li>
              )}
              {e.excessive_extension_tasks > 0 && (
                <li>
                  {e.excessive_extension_tasks} task(s) extended more than {s.max_extensions_before_flag} times.
                </li>
              )}
            </ul>
          </InfoCallout>
        )}

        <section className="space-y-2">
          <h4 className="font-serif text-sm font-bold text-[#14213D]">Right now</h4>
          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3">
            <Meta label="Due today">{num(e.due_today)}</Meta>
            <Meta label="Due in 7 days">{num(e.due_this_week)}</Meta>
            <Meta label="Overdue">{num(e.overdue)}</Meta>
            <Meta label="Without updates">{num(e.no_update)}</Meta>
            <Meta label={`Late unexcused (${s.repeated_delay_window_days} d)`}>{num(e.late_unexcused_window)}</Meta>
            <Meta label={`Extended > ${s.max_extensions_before_flag}×`}>{num(e.excessive_extension_tasks)}</Meta>
          </dl>
        </section>

        <section className="space-y-2">
          <h4 className="font-serif text-sm font-bold text-[#14213D]">
            Period <span className="font-mono text-xs font-semibold">{formatTaskDate(period.from)} – {formatTaskDate(period.to)}</span>
          </h4>
          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3">
            <Meta label="Due in period">{num(e.assigned)}</Meta>
            <Meta label="Completed">{num(e.completed)}</Meta>
            <Meta label="On-time rate">{num(pct(e.on_time_pct))}</Meta>
            <Meta label="Unexcused delay">{num(`${e.unexcused_delay_days} d`)}</Meta>
            <Meta label="Unapproved delays">{num(e.unapproved_delays)}</Meta>
            <Meta label="Incomplete work">{num(e.incomplete_work)}</Meta>
            <Meta label="Approved blockers">{num(e.approved_blockers)}</Meta>
            <Meta label="Rejected blockers">{num(e.rejected_blockers)}</Meta>
          </dl>
          <div className="pt-1">
            <DelayMixBar title={`Delay classes for ${e.name}`} counts={{ on_time: e.on_time, late_excused: e.late_excused, late_unexcused: e.late_unexcused, open_overdue: e.open_overdue }} />
          </div>
        </section>

        <section className="space-y-2">
          <h4 className="font-serif text-sm font-bold text-[#14213D]">Approved blockers by type</h4>
          {byType.length ? (
            <ul className="flex flex-wrap gap-1.5">
              {byType.map(([k, v]) => (
                <li key={k}>
                  <Badge variant="default" size="sm">
                    {blockerTypeLabel(k)} <span className="ml-1 font-mono font-semibold">{v}</span>
                  </Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-[#6B7280]">No accepted blockers in the period.</p>
          )}
        </section>

        <section className="space-y-2">
          <h4 className="font-serif text-sm font-bold text-[#14213D]">Open the task lists</h4>
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {links.map((l) => (
              <li key={l.label}>
                <Link href={l.href} className="flex min-h-10 items-center justify-between gap-2 rounded-lg border border-[#ECE9E2] px-3 py-2 text-sm text-[#14213D] hover:border-[#0F5E63] hover:text-[#0F5E63] sm:min-h-0">
                  <span>{l.label}</span>
                  <span className="inline-flex items-center gap-1">
                    {l.count !== undefined && <span className="font-mono text-xs text-[#4A5568]">{l.count}</span>}
                    <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {canEvidence && (
            <Link
              href={isSelf ? `/tasks/my-performance?from=${period.from}&to=${period.to}` : `/tasks/evidence?employee_id=${e.employee_id}&from=${period.from}&to=${period.to}`}
              className="mt-1 flex min-h-10 items-center justify-between gap-2 rounded-lg border border-[#0F5E63]/30 bg-[#E3EFEE] px-3 py-2 text-sm font-semibold text-[#0F5E63] hover:border-[#0F5E63] sm:min-h-0"
            >
              <span className="inline-flex items-center gap-2">
                <FileSearch className="h-4 w-4" aria-hidden />
                Performance evidence for this period
              </span>
              <ChevronRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          )}
        </section>
      </div>
    </Modal>
  );
};

export default function AccountabilityPage() {
  return (
    <Suspense fallback={<PageLoader rows={4} label="Loading accountability" />}>
      <Accountability />
    </Suspense>
  );
}
