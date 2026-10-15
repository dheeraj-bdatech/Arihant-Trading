'use client';

/**
 * Module 8 task list building blocks shared by My Tasks, Team Tasks and the queues:
 * desktop table, mobile cards, a drag-and-drop Kanban board and pagination.
 * Kanban moves only offer transitions the shared TASK_TRANSITIONS map allows for this viewer;
 * the API re-checks permission, status and version on every call.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronLeft, ChevronRight, GripVertical, MoveRight } from 'lucide-react';
import { Button, Card, Checkbox, Input, Spinner, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import {
  TASK_OVERDUE_CAPABLE_STATUSES,
  TASK_RECURRENCE_LABELS,
  TASK_STATUS_LABELS,
  formatTaskDateTime,
  resolveTaskAction,
  type TaskAction,
  type TaskActorKind,
  type TaskRecurrenceType,
  type TaskStatus,
} from '@arihant/shared';
import { errorMessage, isConflict, notifyTasksChanged, type Paged, type TaskRow } from './task-lib';
import { BlockerBadge, DelayBadge, DueText, FlagChip, PriorityBadge, ProgressBar, StatusBadge, TaskConflictCallout, TaskStatusBadges } from './task-ui';
import { TaskActionDialog, type TaskDialogAction } from './TaskActions';

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
const countsDown = (t: Pick<TaskRow, 'status'>) => TASK_OVERDUE_CAPABLE_STATUSES.includes(t.status);

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

const StatusCell: React.FC<{ task: TaskRow }> = ({ task }) => (
  <span className="inline-flex flex-wrap items-center gap-1">
    <TaskStatusBadges status={task.display_status} isOverdue={task.is_overdue} storedStatus={task.status} />
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

export interface TaskListProps {
  rows: TaskRow[];
  /** Show who the task is assigned to (team views). */
  showAssignee?: boolean;
  /** Pass both to enable row checkboxes for bulk actions. */
  selected?: Set<string>;
  onSelectedChange?: (next: Set<string>) => void;
  /** Extra per-row controls (buttons / RowMenu). */
  rowActions?: (row: TaskRow) => React.ReactNode;
}

// ------------------------------------------------------------------ desktop table
export const TaskTable: React.FC<TaskListProps> = ({ rows, showAssignee, selected, onSelectedChange, rowActions }) => {
  const router = useRouter();
  const selectable = Boolean(selected && onSelectedChange);
  const allChecked = selectable && rows.length > 0 && rows.every((r) => selected!.has(r.id));
  const someChecked = selectable && rows.some((r) => selected!.has(r.id));
  const toggle = (ids: string[], on: boolean) => {
    const next = new Set(selected);
    ids.forEach((id) => (on ? next.add(id) : next.delete(id)));
    onSelectedChange!(next);
  };

  return (
    <div className="hidden md:block">
      <Table>
        <TableHeader>
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
            {showAssignee && <TableHead>Assignee</TableHead>}
            <TableHead>Priority</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Deadline</TableHead>
            <TableHead className="w-32">Progress</TableHead>
            <TableHead>Flags</TableHead>
            {rowActions && <TableHead className="text-right">Actions</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((t) => {
            const isSelected = selectable && selected!.has(t.id);
            return (
              <TableRow
                key={t.id}
                data-selected={isSelected || undefined}
                className={`cursor-pointer ${t.assignee_active === false && showAssignee ? 'bg-[#FBEBDD]/40' : ''}`}
                onClick={() => router.push(`/tasks/${t.id}`)}
              >
                {selectable && (
                  <TableCell className="pr-0" onClick={(e) => e.stopPropagation()}>
                    <Checkbox aria-label={`Select ${t.task_number}`} checked={isSelected} onChange={(e) => toggle([t.id], e.target.checked)} />
                  </TableCell>
                )}
                <TableCell className="max-w-[320px]">
                  <div className="font-mono text-xs font-semibold text-[#0F5E63]">{t.task_number}</div>
                  <Link href={`/tasks/${t.id}`} onClick={(e) => e.stopPropagation()} className="block truncate font-medium text-[#14213D] hover:underline focus:underline focus:outline-none">
                    {t.title}
                  </Link>
                  <div className="truncate text-[11px] text-[#4A5568]">{taskContextLine(t)}</div>
                </TableCell>
                {showAssignee && (
                  <TableCell className="max-w-[180px]">
                    <div className={`truncate text-xs font-medium ${t.assignee_active === false ? 'text-[#881337]' : 'text-[#14213D]'}`}>{t.assignee_name || 'Unassigned'}</div>
                    {t.department_name && <div className="truncate text-[11px] text-[#4A5568]">{t.department_name}</div>}
                  </TableCell>
                )}
                <TableCell>
                  <PriorityBadge priority={t.priority} />
                </TableCell>
                <TableCell className="max-w-[220px]">
                  <StatusCell task={t} />
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  <DeadlineCell task={t} />
                </TableCell>
                <TableCell>
                  <ProgressBar value={t.progress_percent} />
                </TableCell>
                <TableCell className="max-w-[200px]">
                  <TaskFlags task={t} showInactive={Boolean(showAssignee)} />
                </TableCell>
                {rowActions && (
                  <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="flex justify-end gap-1">{rowActions(t)}</div>
                  </TableCell>
                )}
              </TableRow>
            );
          })}
        </TableBody>
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
              {t.status !== 'completed' && <ProgressBar value={t.progress_percent} />}
              {rowActions && <div className="relative z-10 flex flex-wrap gap-2 pt-1">{rowActions(t)}</div>}
            </Card>
          </li>
        );
      })}
    </ul>
  );
};

// ------------------------------------------------------------------ search
/** Search box that commits on Enter or blur (keeps the URL quiet while typing). */
export const TaskSearchInput: React.FC<{ value: string; onSearch: (q: string) => void; label?: string; placeholder?: string }> = ({
  value,
  onSearch,
  label = 'Search',
  placeholder = 'Task number or title',
}) => {
  const [q, setQ] = useState(value);
  useEffect(() => setQ(value), [value]);
  const commit = () => {
    if (q.trim() !== value) onSearch(q.trim());
  };
  return (
    <form
      role="search"
      className="w-full"
      onSubmit={(e) => {
        e.preventDefault();
        commit();
      }}
    >
      <Input label={label} type="search" value={q} placeholder={placeholder} enterKeyHint="search" onChange={(e) => setQ(e.target.value)} onBlur={commit} />
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

// ------------------------------------------------------------------ kanban board
export const TaskKanban: React.FC<{
  rows: TaskRow[];
  /** Viewer has a team or can view all (manager actions are offered on others' tasks). */
  isManager: boolean;
  showAssignee?: boolean;
  /** Reload the board after a move. */
  onChanged: () => void;
  notify: (kind: 'success' | 'error', text: string) => void;
}> = ({ rows, isManager, showAssignee, onChanged, notify }) => {
  const { user } = useAuth();
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<TaskStatus | null>(null);
  const [dialog, setDialog] = useState<{ action: TaskDialogAction; task: TaskRow } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);

  const columns = useMemo(() => {
    const map = new Map<TaskStatus, TaskRow[]>(KANBAN_COLUMNS.map((c) => [c.id, []]));
    rows.forEach((r) => map.get(r.status)?.push(r));
    return map;
  }, [rows]);

  const kindsOf = (row: TaskRow) => rowActorKinds(row, user?.id, isManager);
  const dragRow = dragId ? rows.find((r) => r.id === dragId) || null : null;

  const move = async (row: TaskRow, to: TaskStatus) => {
    setMenuFor(null);
    const plan = planKanbanMove(row, to, kindsOf(row));
    if (!plan) return;
    if (!plan.ok) {
      notify('error', plan.message);
      return;
    }
    if (plan.action !== 'start') {
      setDialog({ action: plan.action, task: row });
      return;
    }
    // Starting has no fields — do it straight from the drop.
    setBusyId(row.id);
    try {
      await api.post(`/tasks/${row.id}/start`, { version: row.version });
      notifyTasksChanged();
      notify('success', `${row.task_number} started.`);
      onChanged();
    } catch (e) {
      if (isConflict(e) && (e as any)?.data?.code === 'STALE_VERSION') setConflict(true);
      else notify('error', errorMessage(e));
    } finally {
      setBusyId(null);
    }
  };

  const endDrag = () => {
    setDragId(null);
    setOverCol(null);
  };

  return (
    <div className="space-y-3">
      {conflict && (
        <TaskConflictCallout
          onRefresh={() => {
            setConflict(false);
            onChanged();
          }}
        />
      )}
      <p className="hidden md:block text-[11px] text-[#4A5568]">Drag a card to another column, or use “Move to…” on the card. Only moves allowed for you are applied.</p>
      <div className="-mx-1 overflow-x-auto px-1 pb-2">
        <div className="flex gap-3 snap-x snap-mandatory lg:grid lg:grid-cols-5">
          {KANBAN_COLUMNS.map((col) => {
            const items = columns.get(col.id) || [];
            const plan = dragRow ? planKanbanMove(dragRow, col.id, kindsOf(dragRow)) : null;
            const isOver = overCol === col.id;
            const tone = !dragRow || !plan ? 'border-[#DCD8CE]' : plan.ok ? 'border-[#0F5E63] border-dashed bg-[#E3EFEE]/40' : 'border-[#DCD8CE] opacity-60';
            return (
              <section
                key={col.id}
                aria-label={`${col.label} (${items.length})`}
                onDragOver={(e) => {
                  if (!dragId) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  if (overCol !== col.id) setOverCol(col.id);
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOverCol((c) => (c === col.id ? null : c));
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const id = e.dataTransfer.getData('text/plain') || dragId;
                  endDrag();
                  const row = rows.find((r) => r.id === id);
                  if (row) move(row, col.id);
                }}
                className={`flex w-[82vw] max-w-[320px] shrink-0 snap-start flex-col rounded-[14px] border bg-[#FBFAF7] transition-colors sm:w-[300px] lg:w-auto lg:max-w-none ${tone} ${isOver && plan?.ok ? 'ring-2 ring-[#0F5E63]/30' : ''}`}
              >
                <header className="flex items-center justify-between gap-2 border-b border-[#ECE9E2] px-3 py-2.5">
                  <h3 className="font-serif text-sm font-bold text-[#14213D]">{col.label}</h3>
                  <span className="rounded-full bg-white border border-[#DCD8CE] px-2 py-0.5 font-mono text-[11px] font-semibold text-[#4A5568]">{items.length}</span>
                </header>
                {dragRow && plan && (
                  <p className={`px-3 pt-2 text-[11px] font-semibold ${plan.ok ? 'text-[#0F5E63]' : 'text-[#8A8578]'}`}>{plan.ok ? `Drop to ${plan.label.toLowerCase()}` : 'Not allowed'}</p>
                )}
                <ul className="flex min-h-[120px] flex-1 flex-col gap-2 p-2">
                  {items.length === 0 && <li className="flex flex-1 items-center justify-center rounded-[10px] border border-dashed border-[#DCD8CE] p-4 text-center text-[11px] text-[#8A8578]">No tasks</li>}
                  {items.map((t) => (
                    <KanbanCard
                      key={t.id}
                      task={t}
                      showAssignee={showAssignee}
                      busy={busyId === t.id}
                      dragging={dragId === t.id}
                      menuOpen={menuFor === t.id}
                      kinds={kindsOf(t)}
                      onToggleMenu={() => setMenuFor((m) => (m === t.id ? null : t.id))}
                      onMove={(to) => move(t, to)}
                      onDragStart={(e) => {
                        e.dataTransfer.setData('text/plain', t.id);
                        e.dataTransfer.effectAllowed = 'move';
                        setMenuFor(null);
                        setDragId(t.id);
                      }}
                      onDragEnd={endDrag}
                    />
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      </div>

      <TaskActionDialog
        action={dialog?.action ?? null}
        task={dialog?.task ?? null}
        onClose={() => setDialog(null)}
        onDone={(_detail, message) => {
          setDialog(null);
          notify('success', message);
          onChanged();
        }}
        onConflict={() => setConflict(true)}
      />
    </div>
  );
};

const KanbanCard: React.FC<{
  task: TaskRow;
  showAssignee?: boolean;
  busy: boolean;
  dragging: boolean;
  menuOpen: boolean;
  kinds: Set<TaskActorKind>;
  onToggleMenu: () => void;
  onMove: (to: TaskStatus) => void;
  onDragStart: (e: React.DragEvent<HTMLLIElement>) => void;
  onDragEnd: () => void;
}> = ({ task: t, showAssignee, busy, dragging, menuOpen, kinds, onToggleMenu, onMove, onDragStart, onDragEnd }) => {
  const menuId = `move-${t.id}`;
  const showDelay = (t.status === 'completed' || t.status === 'awaiting_approval') && Boolean(t.delay_class) && t.delay_class !== 'open';
  const hasChips = t.is_overdue || Boolean(t.open_blocker) || showDelay || t.no_update || t.generated_late || (showAssignee && t.assignee_active === false);
  return (
    <li
      draggable={!busy}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      aria-busy={busy || undefined}
      className={`group rounded-[10px] border bg-white p-3 shadow-2xs space-y-2 transition-opacity ${dragging ? 'opacity-40' : ''} ${t.is_overdue ? 'border-[#DCD8CE] border-l-[3px] border-l-[#9A3412]' : 'border-[#DCD8CE]'} ${busy ? 'cursor-wait' : 'cursor-grab active:cursor-grabbing'}`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="inline-flex items-center gap-1 font-mono text-[11px] font-semibold text-[#0F5E63]">
          <GripVertical className="hidden md:inline h-3.5 w-3.5 text-[#C9C4B8]" aria-hidden />
          {t.task_number}
        </span>
        <PriorityBadge priority={t.priority} />
      </div>
      <Link href={`/tasks/${t.id}`} draggable={false} className="block text-sm font-medium leading-snug text-[#14213D] line-clamp-2 hover:underline focus:underline focus:outline-none">
        {t.title}
      </Link>
      {hasChips && (
        <div className="flex flex-wrap items-center gap-1">
          {t.is_overdue && <StatusBadge status="overdue" />}
          {t.open_blocker && <BlockerBadge status={t.open_blocker.status} />}
          {showDelay && <DelayBadge delay={t.delay_class} />}
          <TaskFlags task={t} showInactive={Boolean(showAssignee)} />
        </div>
      )}
      <div className="flex items-end justify-between gap-2">
        <DueText deadline={t.deadline} open={countsDown(t)} />
        {showAssignee && <span className="min-w-0 truncate text-right text-[11px] text-[#4A5568]">{t.assignee_name}</span>}
      </div>
      {t.status === 'in_progress' && <ProgressBar value={t.progress_percent} />}
      <div className="flex items-center justify-between gap-2">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-10 md:h-8 -ml-2"
          aria-expanded={menuOpen}
          aria-controls={menuId}
          disabled={busy}
          rightIcon={<MoveRight className="h-3.5 w-3.5" />}
          onClick={onToggleMenu}
        >
          Move to…
        </Button>
        {busy && <Spinner size="xs" />}
      </div>
      {menuOpen && (
        <div
          id={menuId}
          role="group"
          aria-label={`Move ${t.task_number} to`}
          className="grid gap-1 border-t border-[#ECE9E2] pt-2"
          onKeyDown={(e) => {
            if (e.key === 'Escape') onToggleMenu();
          }}
        >
          {KANBAN_COLUMNS.filter((c) => c.id !== t.status).map((c, i) => {
            const plan = planKanbanMove(t, c.id, kinds);
            return (
              <button
                key={c.id}
                type="button"
                autoFocus={i === 0}
                onClick={() => onMove(c.id)}
                className={`flex h-10 items-center justify-between gap-2 rounded-lg px-3 text-left text-xs transition-colors hover:bg-[#E3EFEE] focus:bg-[#E3EFEE] focus:outline-none ${plan?.ok ? 'font-semibold text-[#14213D]' : 'text-[#8A8578]'}`}
              >
                <span>{c.label}</span>
                <span className="text-[11px] font-medium">{plan?.ok ? plan.label : 'Not allowed'}</span>
              </button>
            );
          })}
        </div>
      )}
    </li>
  );
};
