'use client';

import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Flag, Layers, Plus, Repeat, Search, SlidersHorizontal, User, X } from 'lucide-react';
import {
  Button,
  Card,
  EmptyState,
  FilterMenu,
  InfoCallout,
  PageContainer,
  PageHeader,
  PageLoader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui';
import { api } from '@/lib/api';
import {
  TASK_PRIORITIES,
  TASK_PRIORITY_LABELS,
  TASK_RECURRENCE_LABELS,
  TASK_RECURRENCE_TYPES,
  formatTaskDate,
  type TaskPriority,
  type TaskRecurrenceType,
  type TaskTemplateStatus,
} from '@arihant/shared';
import { errorMessage } from '../_lib/task-lib';
import { DueText, FlagChip, PriorityBadge, TaskViewMenu, useUrlFilters } from '../_lib/task-ui';
import { TemplateStatusBadge, describeDue } from '../_lib/TaskForm';
import { NewTaskButton } from '../_lib/NewTaskModal';

interface TemplateListRow {
  id: string;
  title: string;
  status: TaskTemplateStatus;
  status_reason: string | null;
  needs_reassignment: boolean;
  schedule: string;
  recurrence_type: string;
  assignee_name: string | null;
  assignee_active: boolean | null;
  assigned_by_name: string | null;
  category_name: string | null;
  priority: TaskPriority;
  instance_count: number;
  open_overdue_count: number;
  next_deadline: string | null;
  start_date: string;
  end_date: string | null;
  due_offset_days: number;
  due_time: string;
}

const FILTER_KEYS = ['status', 'search', 'recurrence', 'assignee', 'priority', 'flag'] as const;
type StatusTab = 'active' | 'paused' | 'ended' | 'all';
const TAB_LABELS: Record<StatusTab, string> = { active: 'Active', paused: 'Paused', ended: 'Ended', all: 'All' };
type FlagFilter = 'attention' | 'overdue';
const FLAG_LABELS: Record<FlagFilter, string> = { attention: 'Needs a new assignee', overdue: 'Has overdue tasks' };
const UNASSIGNED = '__none__';
const SCROLL_PANEL = '[&_.filter-menu-panel]:max-h-[320px] [&_.filter-menu-panel]:overflow-y-auto';
const needsAttention = (r: TemplateListRow) => r.needs_reassignment || r.assignee_active === false;

/** Flags that need a manager's attention: inactive assignee / series paused for reassignment. */
const RowFlags: React.FC<{ t: TemplateListRow }> = ({ t }) => (
  <>
    {t.needs_reassignment && <FlagChip tone="danger">Needs reassignment</FlagChip>}
    {t.assignee_active === false && !t.needs_reassignment && <FlagChip tone="danger">Assignee inactive</FlagChip>}
    {t.open_overdue_count > 0 && <FlagChip>{t.open_overdue_count} overdue</FlagChip>}
  </>
);

const period = (t: TemplateListRow) => `From ${formatTaskDate(t.start_date)}${t.end_date ? ` to ${formatTaskDate(t.end_date)}` : ''}`;

function RecurringTasks() {
  const router = useRouter();
  const { values, set, clear } = useUrlFilters(FILTER_KEYS);
  const tab: StatusTab = (['active', 'paused', 'ended', 'all'] as StatusTab[]).includes(values.status as StatusTab) ? (values.status as StatusTab) : 'active';
  const [rows, setRows] = useState<TemplateListRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState(values.search);
  // Recurrence and Priority sit in the inline "More" row; it opens by itself when a link arrives with one set.
  const [moreOpen, setMoreOpen] = useState(() => Boolean(values.recurrence || values.priority));

  // All statuses are fetched once (the list is small) so every tab shows its count.
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await api.get<TemplateListRow[]>('/task-templates', { search: values.search || undefined }));
    } catch (e) {
      setError(errorMessage(e, 'Could not load recurring tasks.'));
    } finally {
      setLoading(false);
    }
  }, [values.search]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const onChange = () => load();
    window.addEventListener('tasks:changed', onChange);
    return () => window.removeEventListener('tasks:changed', onChange);
  }, [load]);

  // Debounced search → URL (shareable, survives refresh). Uses the latest `set` so a
  // pending write never restores filters that "Clear" removed in the meantime.
  const setRef = useRef(set);
  setRef.current = set;
  useEffect(() => {
    if (search === values.search) return;
    const t = window.setTimeout(() => setRef.current({ search: search.trim() || null }), 350);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const counts = useMemo(() => {
    const c: Record<StatusTab, number> = { active: 0, paused: 0, ended: 0, all: 0 };
    for (const r of rows || []) {
      c[r.status] += 1;
      c.all += 1;
    }
    return c;
  }, [rows]);
  const attention = useMemo(() => (rows || []).filter(needsAttention).length, [rows]);
  const overdueSeries = useMemo(() => (rows || []).filter((r) => r.open_overdue_count > 0).length, [rows]);
  const flag: FlagFilter | '' = values.flag === 'attention' || values.flag === 'overdue' ? values.flag : '';
  const visible = useMemo(
    () =>
      (rows || []).filter(
        (r) =>
          (tab === 'all' || r.status === tab) &&
          (!values.recurrence || r.recurrence_type === values.recurrence) &&
          (!values.priority || r.priority === values.priority) &&
          (!values.assignee || (values.assignee === UNASSIGNED ? !r.assignee_name : r.assignee_name === values.assignee)) &&
          (flag !== 'attention' || needsAttention(r)) &&
          (flag !== 'overdue' || r.open_overdue_count > 0),
      ),
    [rows, tab, values.recurrence, values.priority, values.assignee, flag],
  );
  // Option lists come from the loaded series so every option has at least one match.
  const recurrenceCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of rows || []) c[r.recurrence_type] = (c[r.recurrence_type] || 0) + 1;
    return c;
  }, [rows]);
  const assignees = useMemo(() => {
    const c = new Map<string, number>();
    for (const r of rows || []) c.set(r.assignee_name || UNASSIGNED, (c.get(r.assignee_name || UNASSIGNED) || 0) + 1);
    return [...c.entries()].sort(([a], [b]) => (a === UNASSIGNED ? 1 : b === UNASSIGNED ? -1 : a.localeCompare(b)));
  }, [rows]);
  const priorityCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of rows || []) c[r.priority] = (c[r.priority] || 0) + 1;
    return c;
  }, [rows]);
  const moreActive = [values.recurrence, values.priority].filter(Boolean).length;
  const narrowed = Boolean(values.recurrence || values.priority || values.assignee || flag);
  const hasActiveFilters = Boolean(search || values.search || values.status || narrowed);
  const clearFilters = () => {
    setSearch('');
    clear();
  };

  return (
    <PageContainer>
      <PageHeader
        title="Recurring Tasks"
        icon={<Repeat className="h-5 w-5" />}
        actions={
          <NewTaskButton size="sm" prefill={{ frequency: 'weekly' }} leftIcon={<Plus className="h-4 w-4" />}>
            New recurring task
          </NewTaskButton>
        }
      />

      {/* One filter row: View, search, then compact dropdowns. "More" opens Recurrence and Priority inline. */}
      <Card padding="sm" className="relative z-20 space-y-2.5 overflow-visible border-[#DCD8CE]">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
          <TaskViewMenu />
          <div className="relative w-full min-w-[200px] lg:w-auto lg:flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8A8578]" aria-hidden />
            <input
              id="template-search"
              type="text"
              aria-label="Search recurring tasks by title"
              placeholder="Search by title…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 w-full rounded-lg border border-[#C9C4B8] bg-white pl-9 pr-9 text-xs text-[#14213D] placeholder:text-[#8A8578] focus:border-[#0F5E63] focus:outline-none focus:ring-2 focus:ring-[#0F5E63]/15"
            />
            {search && (
              <button type="button" aria-label="Clear search" onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8A8578] hover:text-[#14213D]">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 lg:flex-nowrap">
            <FilterMenu
              label="Status"
              icon={<Layers />}
              neutralKeys={['active']}
              options={(['active', 'paused', 'ended', 'all'] as StatusTab[]).map((s) => ({
                key: s,
                label: s === 'all' ? 'All statuses' : TAB_LABELS[s],
                count: rows ? counts[s] : undefined,
                active: tab === s,
                onSelect: () => set({ status: s === 'active' ? null : s }),
              }))}
            />
            <FilterMenu
              label="Assignee"
              icon={<User />}
              className={SCROLL_PANEL}
              options={[
                { key: 'all', label: 'Anyone', count: undefined as number | undefined },
                ...assignees.map(([name, n]) => ({ key: name, label: name === UNASSIGNED ? 'Unassigned' : name, count: n })),
              ].map((o) => ({ ...o, active: (values.assignee || 'all') === o.key, onSelect: () => set({ assignee: o.key === 'all' ? null : o.key }) }))}
            />
            <FilterMenu
              label="Attention"
              icon={<AlertTriangle />}
              align="right"
              options={[
                { key: 'all', label: 'All series', count: undefined as number | undefined },
                { key: 'attention', label: FLAG_LABELS.attention, count: attention, urgent: true },
                { key: 'overdue', label: FLAG_LABELS.overdue, count: overdueSeries, urgent: true },
              ].map((o) => ({ ...o, active: (flag || 'all') === o.key, onSelect: () => set({ flag: o.key === 'all' ? null : o.key }) }))}
            />
            <button type="button" onClick={() => setMoreOpen((o) => !o)} aria-expanded={moreOpen} className={`filter-menu-btn ${moreOpen || moreActive ? 'filter-menu-btn--on' : ''}`}>
              <SlidersHorizontal className="h-3.5 w-3.5" />
              <span>More</span>
              {moreActive > 0 && <span className="filter-menu-chip">{moreActive}</span>}
            </button>
            {hasActiveFilters && (
              <Button variant="ghost" size="xs" onClick={clearFilters} className="text-xs text-[#4A5568] hover:text-[#881337]">
                Clear
              </Button>
            )}
          </div>
        </div>

        {moreOpen && (
          <div className="flex flex-wrap items-center gap-2 border-t border-[#ECE9E2] pt-2.5">
            <FilterMenu
              label="Recurrence"
              icon={<Repeat />}
              options={[
                { key: 'all', label: 'Any recurrence', count: undefined as number | undefined },
                ...TASK_RECURRENCE_TYPES.filter((k) => recurrenceCounts[k] || values.recurrence === k).map((k: TaskRecurrenceType) => ({
                  key: k,
                  label: TASK_RECURRENCE_LABELS[k],
                  count: recurrenceCounts[k] || 0,
                })),
              ].map((o) => ({ ...o, active: (values.recurrence || 'all') === o.key, onSelect: () => set({ recurrence: o.key === 'all' ? null : o.key }) }))}
            />
            <FilterMenu
              label="Priority"
              icon={<Flag />}
              options={[
                { key: 'all', label: 'Any priority', count: undefined as number | undefined },
                ...TASK_PRIORITIES.map((k) => ({ key: k, label: TASK_PRIORITY_LABELS[k], count: priorityCounts[k] || 0 })),
              ].map((o) => ({ ...o, active: (values.priority || 'all') === o.key, onSelect: () => set({ priority: o.key === 'all' ? null : o.key }) }))}
            />
          </div>
        )}
      </Card>

      {attention > 0 && (
        <InfoCallout variant="warning" title={`${attention} series need${attention === 1 ? 's' : ''} a new assignee`}>
          A series pauses automatically when its assignee is deactivated. Open it, choose a new assignee under “Edit series”, then resume it.
        </InfoCallout>
      )}

      {error && <InfoCallout variant="danger" title="Could not load recurring tasks">{error}</InfoCallout>}

      {loading && !rows ? (
        <PageLoader rows={4} label="Loading recurring tasks" />
      ) : rows && visible.length === 0 ? (
        <EmptyState
          icon={Repeat}
          title={
            values.search || narrowed
              ? 'No recurring tasks match your filters'
              : tab === 'all'
                ? 'No recurring tasks yet'
                : `No ${TAB_LABELS[tab].toLowerCase()} recurring tasks`
          }
          description={
            values.search || narrowed
              ? 'Try a different title or clear the filters.'
              : 'Recurring tasks generate a fresh task every day, week or month — weekly reports, monthly stock checks, daily follow-ups.'
          }
          action={
            values.search || narrowed ? (
              <Button variant="secondary" onClick={clearFilters}>
                Clear filters
              </Button>
            ) : (
              <NewTaskButton prefill={{ frequency: 'weekly' }} leftIcon={<Plus className="h-4 w-4" />}>New recurring task</NewTaskButton>
            )
          }
        />
      ) : (
        rows && (
          <>
            {/* Desktop table */}
            <div className={`hidden md:block ${loading ? 'opacity-60 transition-opacity' : ''}`}>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Series</TableHead>
                    <TableHead>Schedule</TableHead>
                    <TableHead>Assignee</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead>Next due</TableHead>
                    <TableHead className="text-right">Tasks</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((t) => (
                    <TableRow key={t.id} className="cursor-pointer" onClick={() => router.push(`/tasks/templates/${t.id}`)}>
                      <TableCell className="max-w-[280px]">
                        <Link href={`/tasks/templates/${t.id}`} onClick={(e) => e.stopPropagation()} className="block truncate font-semibold text-[#14213D] hover:text-[#0F5E63] hover:underline">
                          {t.title}
                        </Link>
                        <div className="text-[11px] text-[#4A5568] truncate">{[t.category_name, t.assigned_by_name && `by ${t.assigned_by_name}`].filter(Boolean).join(' · ')}</div>
                        <div className="mt-1 flex flex-wrap gap-1">
                          <RowFlags t={t} />
                        </div>
                      </TableCell>
                      <TableCell className="max-w-[240px]">
                        <div className="font-medium text-[#14213D]">{t.schedule}</div>
                        <div className="text-[11px] text-[#4A5568]">{describeDue(t.due_offset_days, t.due_time)}</div>
                        <div className="text-[11px] text-[#8A8578] font-mono">{period(t)}</div>
                      </TableCell>
                      <TableCell>
                        <span className={t.assignee_active === false ? 'text-[#881337] line-through' : 'text-[#14213D]'}>{t.assignee_name || '—'}</span>
                      </TableCell>
                      <TableCell>
                        <PriorityBadge priority={t.priority} />
                      </TableCell>
                      <TableCell>{t.status === 'active' ? <DueText deadline={t.next_deadline} open compact /> : <span className="text-[#8A8578]">—</span>}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{t.instance_count}</TableCell>
                      <TableCell>
                        <TemplateStatusBadge status={t.status} />
                        {t.status !== 'active' && t.status_reason && <div className="mt-1 max-w-[180px] truncate text-[11px] text-[#4A5568]" title={t.status_reason}>{t.status_reason}</div>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Mobile cards */}
            <div className={`md:hidden space-y-3 ${loading ? 'opacity-60 transition-opacity' : ''}`}>
              {visible.map((t) => (
                <Link key={t.id} href={`/tasks/templates/${t.id}`} className="block">
                  <Card variant="interactive" className="p-4 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-semibold text-[#14213D] break-words">{t.title}</div>
                        <div className="text-[11px] text-[#4A5568]">{t.category_name}</div>
                      </div>
                      <TemplateStatusBadge status={t.status} />
                    </div>
                    <div className="text-xs font-medium text-[#0F5E63]">{t.schedule}</div>
                    <div className="text-[11px] text-[#4A5568]">{describeDue(t.due_offset_days, t.due_time)}</div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#4A5568]">
                      <span className={t.assignee_active === false ? 'text-[#881337] line-through' : ''}>{t.assignee_name || '—'}</span>
                      <PriorityBadge priority={t.priority} />
                      <span className="font-mono">{t.instance_count} task(s)</span>
                    </div>
                    {t.status === 'active' && t.next_deadline && (
                      <div className="text-xs text-[#4A5568]">
                        Next due <DueText deadline={t.next_deadline} open compact />
                      </div>
                    )}
                    {t.status !== 'active' && t.status_reason && <p className="text-[11px] text-[#4A5568] break-words">“{t.status_reason}”</p>}
                    <div className="flex flex-wrap gap-1">
                      <RowFlags t={t} />
                    </div>
                  </Card>
                </Link>
              ))}
            </div>
          </>
        )
      )}
    </PageContainer>
  );
}

export default function RecurringTasksPage() {
  return (
    <Suspense fallback={<PageLoader rows={4} label="Loading recurring tasks" />}>
      <RecurringTasks />
    </Suspense>
  );
}
