'use client';

/**
 * Module 8 task list building blocks shared by My Tasks, Team Tasks and the queues:
 * desktop table, mobile cards, pagination and the Kanban move rules (the board itself is TaskBoard).
 * Kanban moves only offer transitions the shared TASK_TRANSITIONS map allows for this viewer;
 * the API re-checks permission, status and version on every call.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { openTaskPeek } from './TaskPeek';
import { ArrowDown, ArrowUp, ArrowUpDown, BadgeCheck, ChevronDown, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { Button, Card, Checkbox, Input, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui';
import { api } from '@/lib/api';
import {
  TASK_OVERDUE_CAPABLE_STATUSES,
  TASK_PRIORITY_LABELS,
  TASK_RECURRENCE_LABELS,
  TASK_STATUS_LABELS,
  formatTaskDateTime,
  relativeDue,
  resolveTaskAction,
  type TaskAction,
  type TaskActorKind,
  type TaskPriority,
  type TaskRecurrenceType,
  type TaskStatus,
} from '@arihant/shared';
import { errorMessage, type Paged, type TaskRow } from './task-lib';
import { BlockerBadge, DelayBadge, DueText, FlagChip, PriorityBadge, StatusBadge, TaskStatusBadges } from './task-ui';
import type { TaskDialogAction } from './TaskActions';

// ------------------------------------------------------------------ data
/**
 * GET /tasks with a stale-response guard. `data` is null while a *different* query is loading
 * (so a tab switch never shows the previous tab's rows); a reload of the same query keeps the rows on screen.
 * Pass `null` to skip loading.
 */
export function useTaskList(query: Record<string, string | number | boolean | undefined> | null) {
  const key = query ? JSON.stringify(query) : '';
  const [state, setState] = useState<{ key: string; data: Paged<TaskRow> } | null>(null);
  const [loading, setLoading] = useState(Boolean(key));
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const load = useCallback(async () => {
    const n = ++seq.current;
    if (!key) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<Paged<TaskRow>>('/tasks', JSON.parse(key));
      if (n === seq.current) setState({ key, data });
    } catch (e) {
      if (n === seq.current) setError(errorMessage(e));
    } finally {
      if (n === seq.current) setLoading(false);
    }
  }, [key]);
  useEffect(() => {
    load();
  }, [load]);
  return { data: state && state.key === key ? state.data : null, loading, error, reload: load };
}

// ------------------------------------------------------------------ helpers
/** Work the assignee still owes (the deadline countdown matters). */
export const countsDown = (t: Pick<TaskRow, 'status'>) => TASK_OVERDUE_CAPABLE_STATUSES.includes(t.status);

/** "General · Acme Hospital · Weekly" — category, linked record and recurrence. */
export const taskContextLine = (t: TaskRow) =>
  [
    t.category_name,
    t.customer_name,
    t.tender_no ? `Tender ${t.tender_no}` : null,
    t.demo_no ? `Demo ${t.demo_no}` : null,
    t.ticket_no ? `Ticket ${t.ticket_no}` : null,
    t.template_id ? TASK_RECURRENCE_LABELS[(t.recurrence_type || 'custom') as TaskRecurrenceType] || 'Recurring' : null,
  ]
    .filter(Boolean)
    .join(' · ');

/** Linked record and recurrence only — the category gets its own chip in the table. */
const taskLinksLine = (t: TaskRow) => taskContextLine({ ...t, category_name: '' } as TaskRow);

/** Attention flags: no update, blocker raised after the deadline, generated late, inactive assignee. */
export const TaskFlags: React.FC<{ task: TaskRow; showInactive?: boolean }> = ({ task, showInactive = true }) => {
  const chips: React.ReactNode[] = [];
  if (showInactive && task.assignee_active === false)
    chips.push(
      <FlagChip key="inactive" tone="danger">
        Inactive assignee
      </FlagChip>,
    );
  if (task.no_update) chips.push(<FlagChip key="no-update">No update</FlagChip>);
  if (task.open_blocker?.raised_after_deadline)
    chips.push(
      <FlagChip key="late-blocker" tone="danger">
        Blocker after deadline
      </FlagChip>,
    );
  if (task.generated_late) chips.push(<FlagChip key="generated-late">Generated late</FlagChip>);
  if (!chips.length) return null;
  return <span className="inline-flex flex-wrap items-center gap-1">{chips}</span>;
};

const StatusCell: React.FC<{ task: TaskRow; compact?: boolean }> = ({ task, compact }) => (
  <span className="inline-flex flex-wrap items-center gap-1">
    {compact ? <StatusBadge status={task.status} /> : <TaskStatusBadges status={task.display_status} isOverdue={task.is_overdue} storedStatus={task.status} />}
    {task.open_blocker && <BlockerBadge status={task.open_blocker.status} />}
    {task.delay_class !== 'open_overdue' && <DelayBadge delay={task.delay_class} />}
  </span>
);

const DeadlineCell: React.FC<{ task: TaskRow }> = ({ task }) => (
  <span className="inline-flex flex-col gap-0.5">
    <DueText deadline={task.deadline} open={countsDown(task)} />
    {task.completed_at && (task.status === 'completed' || task.status === 'awaiting_approval') && (
      <span className="text-[11px] text-[#4A5568]">
        Done <span className="font-mono">{formatTaskDateTime(task.completed_at)}</span>
      </span>
    )}
  </span>
);

const PRIORITY_TONE: Record<TaskPriority, string> = {
  critical: 'text-[#9A3412] font-semibold',
  high: 'text-[#A15C07] font-semibold',
  medium: 'text-[#4A5568] font-medium',
  low: 'text-[#6B7280] font-medium',
};
const PRIORITY_DOT: Record<TaskPriority, string> = { critical: 'bg-[#9A3412]', high: 'bg-[#E0A458]', medium: 'bg-[#C9C4B8]', low: 'bg-[#ECE9E2] ring-1 ring-[#C9C4B8]' };

/** Quiet priority label for dense tables: a dot and the word, so a page of Critical rows does not drown the overdue signal. */
const PriorityMark: React.FC<{ priority: TaskPriority }> = ({ priority }) => (
  <span className={`inline-flex items-center gap-1.5 whitespace-nowrap text-xs ${PRIORITY_TONE[priority] || PRIORITY_TONE.medium}`}>
    <span className={`h-2 w-2 shrink-0 rounded-full ${PRIORITY_DOT[priority] || PRIORITY_DOT.medium}`} aria-hidden />
    {TASK_PRIORITY_LABELS[priority] || priority}
  </span>
);

/** Due column: how long is left (or late) first, the exact deadline underneath. */
const DueCell: React.FC<{ task: TaskRow }> = ({ task }) => {
  if (!task.deadline) return <span className="text-xs text-[#6B7280]">No deadline</span>;
  const open = countsDown(task);
  const rel = relativeDue(task.deadline);
  const done = task.completed_at && (task.status === 'completed' || task.status === 'awaiting_approval');
  return (
    <span className="inline-flex flex-col gap-0.5 leading-tight">
      {open ? (
        <span className={`text-xs font-semibold ${rel.overdue ? 'text-[#9A3412]' : 'text-[#14213D]'}`}>{rel.overdue ? `${rel.label.replace('overdue by ', '')} late` : rel.label.replace('due in ', 'In ')}</span>
      ) : done ? (
        <span className="text-xs font-medium text-[#0F5E63]">
          Done <span className="font-mono">{formatTaskDateTime(task.completed_at)}</span>
        </span>
      ) : null}
      <span className="font-mono tabular-nums text-[11px] text-[#6B7280]">{formatTaskDateTime(task.deadline)}</span>
    </span>
  );
};

/** Optional grouping of the list (collapsible headers with task / complete / overdue counts). */
export type TaskGroupBy = 'category' | 'client' | 'person';
export const TASK_GROUP_BY_LABELS: Record<TaskGroupBy, string> = { category: 'Category', client: 'Client', person: 'Person' };

/** Group key + label for a row; empty values collect under a trailing "No …" group. */
const groupOf = (t: TaskRow, by: TaskGroupBy, showAssignee?: boolean): { key: string; label: string; empty: boolean } => {
  const value =
    by === 'category' ? t.category_name : by === 'client' ? t.customer_name : showAssignee ? t.assignee_name : t.assigned_by_name;
  const empty = !value;
  const fallback = by === 'category' ? 'Uncategorised' : by === 'client' ? 'No client' : showAssignee ? 'Unassigned' : 'No assigner';
  return { key: value || `__none_${by}`, label: value || fallback, empty };
};

export interface TaskListProps {
  rows: TaskRow[];
  /** Show who the task is assigned to (team views). */
  showAssignee?: boolean;
  /** Pass both to enable row checkboxes for bulk actions. */
  selected?: Set<string>;
  onSelectedChange?: (next: Set<string>) => void;
  /** Extra per-row controls (buttons / RowMenu). */
  rowActions?: (row: TaskRow) => React.ReactNode;
  /** Current deadline order; with onDueSort the When (Due) header becomes a sort toggle. */
  dueSort?: 'asc' | 'desc';
  onDueSort?: () => void;
  /** Split rows under collapsible group headers. */
  groupBy?: TaskGroupBy;
}

// ------------------------------------------------------------------ desktop table
export const TaskTable: React.FC<TaskListProps> = ({ rows, showAssignee, selected, onSelectedChange, rowActions, dueSort, onDueSort, groupBy }) => {
  const selectable = Boolean(selected && onSelectedChange);
  const allChecked = selectable && rows.length > 0 && rows.every((r) => selected!.has(r.id));
  const someChecked = selectable && rows.some((r) => selected!.has(r.id));
  const toggle = (ids: string[], on: boolean) => {
    const next = new Set(selected);
    ids.forEach((id) => (on ? next.add(id) : next.delete(id)));
    onSelectedChange!(next);
  };
  const SortIcon = !onDueSort ? null : dueSort === 'desc' ? ArrowDown : dueSort === 'asc' ? ArrowUp : ArrowUpDown;
  const columns = 6 + (selectable ? 1 : 0) + (rowActions ? 1 : 0);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  useEffect(() => setCollapsed(new Set()), [groupBy]);
  const groups = useMemo(() => {
    if (!groupBy) return null;
    const map = new Map<string, { key: string; label: string; empty: boolean; rows: TaskRow[] }>();
    for (const r of rows) {
      const g = groupOf(r, groupBy, showAssignee);
      if (!map.has(g.key)) map.set(g.key, { ...g, rows: [] });
      map.get(g.key)!.rows.push(r);
    }
    // Alphabetical, the "No …" bucket last; rows keep their sort order inside a group.
    return [...map.values()].sort((a, b) => Number(a.empty) - Number(b.empty) || a.label.localeCompare(b.label));
  }, [rows, groupBy, showAssignee]);
  const toggleGroup = (key: string) =>
    setCollapsed((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const renderRow = (t: TaskRow) => {
    const isSelected = selectable && selected!.has(t.id);
    return (
      <TableRow
        key={t.id}
        data-selected={isSelected || undefined}
        className={`group cursor-pointer ${t.assignee_active === false && showAssignee ? 'bg-[#FBEBDD]/40' : ''}`}
        onClick={() => openTaskPeek(t.id)}
      >
        {selectable && (
          <TableCell className="w-10 pr-0" onClick={(e) => e.stopPropagation()}>
            <Checkbox aria-label={`Select ${t.task_number}`} checked={isSelected} onChange={(e) => toggle([t.id], e.target.checked)} />
          </TableCell>
        )}
        {/* Overdue rows carry a terracotta edge instead of a second status pill. */}
        <TableCell className={`py-3 ${t.is_overdue ? 'shadow-[inset_3px_0_0_#9A3412]' : ''}`}>
          <div className="min-w-0">
            <Link
              href={`/tasks/${t.id}`}
              onClick={(e) => e.stopPropagation()}
              title={t.title}
              className="line-clamp-1 text-[13px] font-semibold text-[#14213D] group-hover:text-[#0F5E63] hover:underline focus:underline focus:outline-none"
            >
              {t.title}
            </Link>
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5 text-[11px] text-[#4A5568]">
              <span className="shrink-0 font-mono font-semibold text-[#0F5E63]">{t.task_number}</span>
              {t.approval_required && (
                <span
                  className={`inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-px font-semibold ${t.status === 'awaiting_approval' ? 'bg-[#FFF8EB] text-[#A15C07] ring-1 ring-[#E9C9B4]' : 'bg-[#EEF1F5] text-[#1F2E52]'}`}
                  title={t.status === 'awaiting_approval' ? 'Handed in — waiting for manager sign-off' : 'Manager approval is needed when this is completed'}
                >
                  <BadgeCheck className="h-3 w-3" aria-hidden />
                  {t.status === 'awaiting_approval' ? 'Approval pending' : 'Approval required'}
                </span>
              )}
              {taskLinksLine(t) && (
                <span className="min-w-0 truncate" title={taskLinksLine(t)}>
                  {taskLinksLine(t)}
                </span>
              )}
            </div>
          </div>
        </TableCell>
        <TableCell className="py-3">
          {t.category_name ? (
            <span className="inline-block max-w-full truncate rounded-md border border-[#DCD8CE] bg-[#FBFAF7] px-2 py-0.5 text-[11px] font-medium text-[#14213D]" title={t.category_name}>
              {t.category_name}
            </span>
          ) : (
            <span className="text-xs text-[#6B7280]">—</span>
          )}
        </TableCell>
        <TableCell className="py-3">
          <div className="min-w-0">
            {showAssignee ? (
              <div className={`truncate text-xs font-medium ${t.assignee_active === false ? 'text-[#881337]' : 'text-[#14213D]'}`} title={t.assignee_name || undefined}>
                {t.assignee_name || 'Unassigned'}
              </div>
            ) : (
              <div className="truncate text-xs font-medium text-[#14213D]">{t.department_name || '—'}</div>
            )}
            <div className="truncate text-[11px] text-[#4A5568]">
              {showAssignee ? t.department_name : t.assigned_by_name ? `From ${t.assigned_by_name}` : null}
            </div>
          </div>
        </TableCell>
        <TableCell className="py-3 whitespace-nowrap">
          <PriorityMark priority={t.priority} />
        </TableCell>
        <TableCell className="py-3">
          <div className="min-w-0 space-y-1">
            <StatusCell task={t} compact />
            <TaskFlags task={t} showInactive={Boolean(showAssignee)} />
          </div>
        </TableCell>
        <TableCell className="py-3 whitespace-nowrap">
          <DueCell task={t} />
        </TableCell>
        {rowActions && (
          <TableCell className="py-3 text-right" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-end gap-1">{rowActions(t)}</div>
          </TableCell>
        )}
      </TableRow>
    );
  };

  return (
    <div className="hidden md:block">
      <Table className="min-w-[1000px] table-fixed [&_td]:px-4 [&_th]:px-4">
        <TableHeader className="border-[#DCD8CE] bg-[#EEF1F5] [&_th]:h-11 [&_th]:text-[11px] [&_th]:font-bold [&_th]:tracking-[0.08em] [&_th]:text-[#0F5E63]">
          <TableRow>
            {selectable && (
              <TableHead className="w-10 pr-0">
                <Checkbox
                  aria-label="Select all tasks on this page"
                  checked={allChecked}
                  ref={(el) => {
                    if (el) el.indeterminate = someChecked && !allChecked;
                  }}
                  onChange={(e) => toggle(rows.map((r) => r.id), e.target.checked)}
                />
              </TableHead>
            )}
            <TableHead>Task</TableHead>
            <TableHead className="w-[150px]">Category</TableHead>
            <TableHead className="w-[130px]">Team</TableHead>
            <TableHead className="w-[100px]">Priority</TableHead>
            <TableHead className="w-[170px]">Status</TableHead>
            <TableHead className="w-[150px]" aria-sort={dueSort === 'desc' ? 'descending' : dueSort === 'asc' ? 'ascending' : undefined}>
              {onDueSort && SortIcon ? (
                <button type="button" onClick={onDueSort} className="inline-flex items-center gap-1 uppercase hover:text-[#0B4A4E] focus:outline-none focus-visible:underline">
                  When (due)
                  <SortIcon className="h-3.5 w-3.5" aria-hidden />
                </button>
              ) : (
                'When (due)'
              )}
            </TableHead>
            {rowActions && <TableHead className="w-[84px] text-right">Actions</TableHead>}
          </TableRow>
        </TableHeader>
        {groups ? (
          groups.map((g) => {
            const open = !collapsed.has(g.key);
            const done = g.rows.filter((r) => r.status === 'completed').length;
            const late = g.rows.filter((r) => r.is_overdue).length;
            return (
              <TableBody key={g.key}>
                <tr className="bg-[#FBFAF7] hover:bg-[#F6F5F1]">
                  <td colSpan={columns} className="border-y border-[#ECE9E2] px-3 py-2">
                    <button
                      type="button"
                      onClick={() => toggleGroup(g.key)}
                      aria-expanded={open}
                      className="flex w-full items-center gap-2.5 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5E63]/30 rounded-lg"
                    >
                      {open ? <ChevronDown className="h-4 w-4 shrink-0 text-[#4A5568]" aria-hidden /> : <ChevronRight className="h-4 w-4 shrink-0 text-[#4A5568]" aria-hidden />}
                      <span className={`truncate rounded-lg border px-2.5 py-1 text-[13px] font-semibold ${g.empty ? 'border-[#DCD8CE] bg-white text-[#4A5568]' : 'border-[#D0E5E3] bg-white text-[#0F5E63]'}`}>{g.label}</span>
                      <span className="shrink-0 text-xs text-[#4A5568]">
                        {g.rows.length} task{g.rows.length === 1 ? '' : 's'}
                      </span>
                      <span aria-hidden className="h-4 w-px shrink-0 bg-[#DCD8CE]" />
                      {done > 0 && <span className="shrink-0 rounded-md bg-[#E3EFEE] px-2 py-0.5 text-[11px] font-semibold text-[#0F5E63]">{done} Complete</span>}
                      {late > 0 && <span className="shrink-0 rounded-md bg-[#FBEBDD] px-2 py-0.5 text-[11px] font-semibold text-[#9A3412]">{late} Overdue</span>}
                      {g.rows.length - done - late > 0 && (
                        <span className="shrink-0 rounded-md bg-[#EEF1F5] px-2 py-0.5 text-[11px] font-semibold text-[#1F2E52]">{g.rows.length - done - late} Open</span>
                      )}
                    </button>
                  </td>
                </tr>
                {open && g.rows.map(renderRow)}
              </TableBody>
            );
          })
        ) : (
          <TableBody>{rows.map(renderRow)}</TableBody>
        )}
      </Table>
    </div>
  );
};

// ------------------------------------------------------------------ mobile cards
export const TaskCards: React.FC<TaskListProps> = ({ rows, showAssignee, selected, onSelectedChange, rowActions }) => {
  const selectable = Boolean(selected && onSelectedChange);
  return (
    <ul className="md:hidden space-y-3">
      {rows.map((t) => {
        const isSelected = selectable && selected!.has(t.id);
        return (
          <li key={t.id}>
            <Card selected={isSelected} className={`p-4 space-y-2.5 ${t.is_overdue ? 'border-l-[3px] border-l-[#9A3412]' : ''}`}>
              <div className="flex items-start gap-2">
                {selectable && (
                  <Checkbox
                    aria-label={`Select ${t.task_number}`}
                    checked={isSelected}
                    onChange={(e) => {
                      const next = new Set(selected);
                      if (e.target.checked) next.add(t.id);
                      else next.delete(t.id);
                      onSelectedChange!(next);
                    }}
                    className="relative z-10 -m-3 p-3"
                  />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-mono text-xs font-semibold text-[#0F5E63]">{t.task_number}</span>
                    <PriorityBadge priority={t.priority} />
                  </div>
                  {/* Stretched link: the whole card opens the task; controls sit above it (z-10). */}
                  <Link href={`/tasks/${t.id}`} className="mt-0.5 block font-medium text-[#14213D] line-clamp-2 after:absolute after:inset-0 after:content-[''] focus:underline focus:outline-none">
                    {t.title}
                  </Link>
                  <div className="truncate text-[11px] text-[#4A5568]">{taskContextLine(t)}</div>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1">
                <StatusCell task={t} />
                <TaskFlags task={t} showInactive={Boolean(showAssignee)} />
              </div>
              <div className="flex items-end justify-between gap-3">
                <DeadlineCell task={t} />
                {showAssignee && <span className={`min-w-0 truncate text-right text-xs ${t.assignee_active === false ? 'text-[#881337] font-semibold' : 'text-[#4A5568]'}`}>{t.assignee_name || 'Unassigned'}</span>}
              </div>
              {rowActions && <div className="relative z-10 flex flex-wrap gap-2 pt-1">{rowActions(t)}</div>}
            </Card>
          </li>
        );
      })}
    </ul>
  );
};

// ------------------------------------------------------------------ search
/**
 * Search box that commits on Enter or blur (keeps the URL quiet while typing); clearing it applies at once.
 * `compact` drops the visible label and shows a search icon, for toolbar rows.
 */
export const TaskSearchInput: React.FC<{ value: string; onSearch: (q: string) => void; label?: string; placeholder?: string; compact?: boolean }> = ({
  value,
  onSearch,
  label = 'Search',
  placeholder = 'Task number or title',
  compact,
}) => {
  const [q, setQ] = useState(value);
  useEffect(() => setQ(value), [value]);
  const commit = () => {
    if (q.trim() !== value) onSearch(q.trim());
  };
  return (
    <form
      role="search"
      className={`w-full ${compact ? 'relative' : ''}`}
      onSubmit={(e) => {
        e.preventDefault();
        commit();
      }}
    >
      {compact && <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6B7280]" aria-hidden />}
      <Input
        label={compact ? undefined : label}
        aria-label={compact ? label : undefined}
        type="search"
        value={q}
        placeholder={placeholder}
        enterKeyHint="search"
        className={compact ? 'h-9 pl-9' : undefined}
        onChange={(e) => {
          setQ(e.target.value);
          if (!e.target.value && value) onSearch('');
        }}
        onBlur={commit}
      />
    </form>
  );
};

// ------------------------------------------------------------------ pagination
export const TaskPagination: React.FC<{ page: number; totalPages: number; total: number; onPage: (page: number) => void; noun?: string }> = ({ page, totalPages, total, onPage, noun = 'tasks' }) =>
  totalPages > 1 ? (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-2 text-xs text-[#4A5568]">
      <span>
        Page {page} of {totalPages} · {total} {noun}
      </span>
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" className="h-10 md:h-8" disabled={page <= 1} onClick={() => onPage(page - 1)} leftIcon={<ChevronLeft className="h-4 w-4" />}>
          Prev
        </Button>
        <Button size="sm" variant="secondary" className="h-10 md:h-8" disabled={page >= totalPages} onClick={() => onPage(page + 1)} rightIcon={<ChevronRight className="h-4 w-4" />}>
          Next
        </Button>
      </div>
    </nav>
  ) : null;

// ------------------------------------------------------------------ kanban rules
export const KANBAN_COLUMNS: { id: TaskStatus; label: string }[] = [
  { id: 'not_started', label: TASK_STATUS_LABELS.not_started },
  { id: 'in_progress', label: TASK_STATUS_LABELS.in_progress },
  { id: 'blocked', label: TASK_STATUS_LABELS.blocked },
  { id: 'awaiting_approval', label: TASK_STATUS_LABELS.awaiting_approval },
  { id: 'completed', label: TASK_STATUS_LABELS.completed },
];

/**
 * Viewer's relation to a list row (lists carry no per-row permissions; the server re-checks).
 * `isManager` = the viewer has a team or can see everything.
 */
export function rowActorKinds(row: Pick<TaskRow, 'assigned_to' | 'assigned_by'>, userId: string | null | undefined, isManager: boolean): Set<TaskActorKind> {
  const kinds = new Set<TaskActorKind>();
  if (!userId) return kinds;
  if (row.assigned_to === userId) kinds.add('assignee');
  else {
    if (isManager) kinds.add('manager');
    if (row.assigned_by === userId) kinds.add('assigner');
  }
  return kinds;
}

const MOVE_LABEL: Partial<Record<TaskDialogAction, string>> = {
  start: 'Start',
  complete: 'Complete',
  raise_blocker: 'Raise blocker',
  approve: 'Approve',
  send_back: 'Send back',
  resolve_blocker: 'Resolve blocker',
  reopen: 'Reopen',
};

const DENIED: Partial<Record<TaskAction, { self?: string; forbidden: string }>> = {
  start: { forbidden: 'Only the assignee can start this task.' },
  complete: { forbidden: 'Only the assignee can mark this task complete.' },
  raise_blocker: { forbidden: 'Only the assignee can raise a blocker on this task.' },
  approve: { self: 'Only your manager can approve your work.', forbidden: 'Only the assignee’s manager can approve this task.' },
  send_back: { self: 'Only your manager can send your work back.', forbidden: 'Only the assignee’s manager can send this back for rework.' },
  reopen: { self: 'Only your manager can reopen a completed task.', forbidden: 'Only the assignee’s manager can reopen this task.' },
};

export type KanbanMovePlan = { ok: true; action: TaskDialogAction; label: string } | { ok: false; message: string };

/** What dropping `row` on column `to` would do for this viewer — or why it is not allowed. `null` = same column. */
export function planKanbanMove(row: TaskRow, to: TaskStatus, kinds: Set<TaskActorKind>): KanbanMovePlan | null {
  const from = row.status;
  if (from === to) return null;
  const check = (action: TaskAction & TaskDialogAction): KanbanMovePlan => {
    const r = resolveTaskAction(from, action, kinds);
    if (r.ok) return { ok: true, action, label: MOVE_LABEL[action] || action };
    const copy = DENIED[action];
    if (r.reason === 'self') return { ok: false, message: copy?.self || 'You cannot do this on your own task.' };
    if (r.reason === 'forbidden') return { ok: false, message: copy?.forbidden || 'You do not have permission for this move.' };
    return { ok: false, message: `This move is not allowed while the task is ${TASK_STATUS_LABELS[from]}.` };
  };

  switch (to) {
    case 'not_started':
      return { ok: false, message: 'Tasks never move back to Not Started.' };
    case 'awaiting_approval':
      return {
        ok: false,
        message: from === 'completed' ? 'Completed work cannot go back to approval — reopen it instead.' : 'Drop the card on Completed to hand it in — tasks that need approval move here automatically.',
      };
    case 'in_progress': {
      if (from === 'not_started') return check('start');
      if (from === 'awaiting_approval') return check('send_back');
      if (from === 'completed') return check('reopen');
      if (from === 'blocked') {
        const b = row.open_blocker;
        if (!b) return { ok: false, message: 'This task has no open blocker to resolve — refresh the board.' };
        const isAssignee = kinds.has('assignee');
        const isManager = kinds.has('manager') && !isAssignee;
        if (b.status === 'pending_review') {
          if (isAssignee) return { ok: true, action: 'resolve_blocker', label: MOVE_LABEL.resolve_blocker! };
          if (isManager) return { ok: false, message: 'Review the blocker first — accept or reject it on the task page.' };
        } else if (b.status === 'accepted' && (isAssignee || isManager)) {
          return { ok: true, action: 'resolve_blocker', label: MOVE_LABEL.resolve_blocker! };
        }
        return { ok: false, message: 'Only the assignee or their manager can resolve this blocker.' };
      }
      return { ok: false, message: `This move is not allowed while the task is ${TASK_STATUS_LABELS[from]}.` };
    }
    case 'blocked':
      if (from === 'not_started' || from === 'in_progress') return check('raise_blocker');
      return { ok: false, message: 'Only tasks that are not started or in progress can be blocked.' };
    case 'completed':
      if (from === 'not_started' || from === 'in_progress') return check('complete');
      if (from === 'awaiting_approval') return check('approve');
      if (from === 'blocked') return { ok: false, message: 'Resolve the blocker first — drop the card on In Progress.' };
      return { ok: false, message: `This move is not allowed while the task is ${TASK_STATUS_LABELS[from]}.` };
    default:
      return { ok: false, message: 'This move is not allowed.' };
  }
}
