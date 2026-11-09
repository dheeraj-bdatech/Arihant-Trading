'use client';

/**
 * Module 8 Kanban board (the Tasks page). Columns follow the stored status. A card is dragged on
 * desktop or moved from its ⋮ menu on touch / keyboard; only moves planKanbanMove allows for this viewer
 * are offered, and the API re-checks permission, status and version on every call.
 * Each column (lane) reads its own pages of GET /tasks (useBoardLanes): the board's view, search and quick filter, the
 * lane's status and the sort all go to the API, and a lane loads its next page as it is scrolled to the end.
 * The page owns the toolbar: BoardFilterMenu / BoardSortMenu feed `filter` and `sort` into the lane queries.
 * Sort (useBoardSort) and collapsed columns are remembered per browser.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { openTaskPeek } from './TaskPeek';
import {
  AlertTriangle,
  BadgeCheck,
  ChevronsLeft,
  ChevronsRight,
  CircleCheck,
  CircleDashed,
  ArrowUpDown,
  ExternalLink,
  FileCheck2,
  Filter,
  GripVertical,
  Hourglass,
  OctagonAlert,
  Repeat,
  RotateCcw,
  Timer,
  type LucideIcon,
} from 'lucide-react';
import { FilterMenu, RowMenu, Spinner, type RowMenuItem } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { formatTaskDate, formatTaskDateTime, isTaskClockPaused, relativeDue, type TaskActorKind, type TaskPriority, type TaskStatus } from '@arihant/shared';
import { errorMessage, isConflict, notifyTasksChanged, type TaskRow } from './task-lib';
import { BlockerBadge, DelayBadge, LoadMoreRow, PriorityBadge, StatusBadge, TaskConflictCallout } from './task-ui';
import { TaskActionDialog, type TaskDialogAction } from './TaskActions';
import { KANBAN_COLUMNS, TaskFlags, countsDown, planKanbanMove, rowActorKinds, useTaskPages, type TaskPages } from './TaskList';

// ------------------------------------------------------------------ board config
const COLUMN_META: Record<string, { icon: LucideIcon; accent: string; empty: string }> = {
  not_started: { icon: CircleDashed, accent: '#4A5568', empty: 'New assignments land here.' },
  in_progress: { icon: Timer, accent: '#0F5E63', empty: 'Drag a card here to start it.' },
  blocked: { icon: OctagonAlert, accent: '#9A3412', empty: 'Drop a card here to raise a blocker.' },
  awaiting_approval: { icon: Hourglass, accent: '#A15C07', empty: 'Work that needs sign-off waits here.' },
  completed: { icon: CircleCheck, accent: '#1F7A55', empty: 'Drop a card here to complete it.' },
};

export const PRIORITY_STRIPE: Record<TaskPriority, string> = { critical: '#9A3412', high: '#D97706', medium: '#0F5E63', low: '#C9C4B8' };

export type QuickFilter = 'all' | 'overdue' | 'due_week' | 'high' | 'no_update';
/** Quick filters as GET /tasks params: the database applies the same rules as the cards' flags (is_overdue, no_update). */
export const QUICK_FILTERS: { id: QuickFilter; label: string; params: Record<string, string | number> }[] = [
  { id: 'all', label: 'All', params: {} },
  { id: 'overdue', label: 'Overdue', params: { delay_class: 'open_overdue' } },
  // Still counting down and due within the next 7 days (never already late).
  { id: 'due_week', label: 'Due in 7 days', params: { due_within_days: 7 } },
  { id: 'high', label: 'High & critical', params: { priority: 'high,critical' } },
  { id: 'no_update', label: 'No update', params: { no_update: 'true' } },
];

export type SortKey = 'deadline' | 'priority' | 'updated';
const SORT_OPTIONS: { id: SortKey; label: string }[] = [
  { id: 'deadline', label: 'Deadline' },
  { id: 'priority', label: 'Priority' },
  { id: 'updated', label: 'Updated' },
];

/** GET /tasks sort of one lane: priority (critical first, then the nearest deadline), last updated, or by deadline — where
 * finished work reads newest first and open work by the nearest deadline. The API breaks ties on the task number. */
function laneSort(by: SortKey, lane: TaskStatus): { sort_by: string; sort_dir: 'asc' | 'desc' } {
  if (by === 'updated') return { sort_by: 'updated_at', sort_dir: 'desc' };
  if (by === 'priority') return { sort_by: 'priority', sort_dir: 'desc' };
  return lane === 'completed' ? { sort_by: 'completed_at', sort_dir: 'desc' } : { sort_by: 'deadline', sort_dir: 'asc' };
}

/** Cards a lane reads per page. */
const LANE_PAGE_SIZE = 25;

/** The board's GET /tasks params shared by every lane: view, search and the quick filter's params. */
export type BoardQuery = Record<string, string | number | undefined>;

/** One lane per status column, keyed by its status. */
export type BoardLanes = Record<string, TaskPages>;

/**
 * The status board's data. Every lane (status column) pages GET /tasks on its own — the board's query plus
 * `statuses=<lane>` and the lane's sort — so a long column never holds the others back, and each loads its next page
 * when it is scrolled to the end (LoadMoreRow inside the lane). `query` null skips loading.
 */
export function useBoardLanes(query: BoardQuery | null, sort: SortKey) {
  const lane = (status: TaskStatus) => (query ? { ...query, statuses: status, ...laneSort(sort, status) } : null);
  const lanes: BoardLanes = {
    not_started: useTaskPages(lane('not_started'), LANE_PAGE_SIZE),
    in_progress: useTaskPages(lane('in_progress'), LANE_PAGE_SIZE),
    blocked: useTaskPages(lane('blocked'), LANE_PAGE_SIZE),
    awaiting_approval: useTaskPages(lane('awaiting_approval'), LANE_PAGE_SIZE),
    completed: useTaskPages(lane('completed'), LANE_PAGE_SIZE),
  };
  const all = KANBAN_COLUMNS.map((c) => lanes[c.id]);
  return {
    lanes,
    /** Every lane has its first page for the current query. */
    ready: all.every((l) => l.ready),
    error: all.find((l) => l.error)?.error ?? null,
    /** Cards loaded so far across the lanes. */
    rows: all.flatMap((l) => l.rows),
    /** Tasks per lane in the database (not just the loaded cards), and their sum. */
    totals: Object.fromEntries(KANBAN_COLUMNS.map((c) => [c.id, lanes[c.id].total])) as Record<string, number>,
    total: all.reduce((n, l) => n + l.total, 0),
    /** Some lane has cards it has not loaded yet. */
    partial: all.some((l) => l.hasMore),
    /** Re-read the pages each lane has loaded, in place (after a move or an edit). */
    refresh: () => Promise.all(all.map((l) => l.refresh())),
  };
}

const SORT_KEY = 'bos.tasks.board.sort';
const COLLAPSED_KEY = 'bos.tasks.board.collapsed';
function readPref<T>(key: string): T | null {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null');
  } catch {
    return null;
  }
}
function writePref(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

/** Board sort, remembered per browser. */
export function useBoardSort(): [SortKey, (s: SortKey) => void] {
  const [sort, setSort] = useState<SortKey>('deadline');
  useEffect(() => {
    const saved = readPref<SortKey>(SORT_KEY);
    if (saved && SORT_OPTIONS.some((o) => o.id === saved)) setSort(saved);
  }, []);
  const update = useCallback((s: SortKey) => {
    setSort(s);
    writePref(SORT_KEY, s);
  }, []);
  return [sort, update];
}

/** "Filter" dropdown for the board toolbar; the active filter shows how many tasks match it on the board (`total`). */
export const BoardFilterMenu: React.FC<{ value: QuickFilter; onChange: (f: QuickFilter) => void; total?: number }> = ({ value, onChange, total }) => {
  const options = useMemo(
    () =>
      QUICK_FILTERS.map((f) => ({
        key: f.id,
        label: f.label,
        count: value === f.id ? total : undefined,
        urgent: f.id === 'overdue',
        active: value === f.id,
        onSelect: () => onChange(f.id),
      })),
    [value, onChange, total],
  );
  return <FilterMenu label="Filter" icon={<Filter />} options={options} />;
};

/** "Sort" dropdown for the board toolbar. */
export const BoardSortMenu: React.FC<{ value: SortKey; onChange: (s: SortKey) => void }> = ({ value, onChange }) => (
  <FilterMenu
    label="Sort"
    icon={<ArrowUpDown />}
    neutralKeys={[]}
    align="right"
    options={SORT_OPTIONS.map((o) => ({ key: o.id, label: o.label, active: value === o.id, onSelect: () => onChange(o.id) }))}
  />
);

export const initials = (name: string | null) =>
  (name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');

// ------------------------------------------------------------------ board
export const TaskBoard: React.FC<{
  /** One paged GET /tasks per column (useBoardLanes). */
  lanes: BoardLanes;
  /** Viewer has a team or can view all (manager actions are offered on others' tasks). */
  isManager: boolean;
  showAssignee?: boolean;
  /** A quick filter narrows the lanes (an empty lane says so). */
  filtered: boolean;
  /** Re-read the lanes after a move; the optimistic column of a started card is dropped once this settles. */
  onChanged: () => Promise<unknown> | void;
  notify: (kind: 'success' | 'error', text: string) => void;
}> = ({ lanes, isManager, showAssignee, filtered, onChanged, notify }) => {
  const [collapsed, setCollapsed] = useState<TaskStatus[]>([]);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<TaskStatus | null>(null);
  /** Optimistic column for a card whose move is in flight; cleared once the lanes have re-read. */
  const [moved, setMoved] = useState<Record<string, TaskStatus>>({});
  const { kindsOf, move, busyId, dialogs } = useTaskMover({
    isManager,
    notify,
    onChanged: () => {
      Promise.resolve(onChanged()).finally(() => setMoved({}));
    },
    onOptimistic: (id, to) =>
      setMoved((m) => {
        const next = { ...m };
        if (to) next[id] = to;
        else delete next[id];
        return next;
      }),
  });

  useEffect(() => {
    const saved = readPref<TaskStatus[]>(COLLAPSED_KEY);
    if (Array.isArray(saved)) setCollapsed(saved.filter((c) => KANBAN_COLUMNS.some((k) => k.id === c)));
  }, []);

  const toggleCollapsed = (id: TaskStatus) => {
    const next = collapsed.includes(id) ? collapsed.filter((c) => c !== id) : [...collapsed, id];
    setCollapsed(next);
    writePref(COLLAPSED_KEY, next);
  };

  const statusOf = (r: TaskRow) => moved[r.id] || r.status;

  // Every loaded card once: while lanes re-read one by one a moved card can sit in two of them for a moment, so the
  // newest version (highest `version`) wins. Lane order is the API's (filtered and sorted in the database).
  const rows = useMemo(() => {
    const byId = new Map<string, TaskRow>();
    for (const c of KANBAN_COLUMNS) {
      for (const r of lanes[c.id].rows) {
        const had = byId.get(r.id);
        if (!had || r.version > had.version) byId.set(r.id, r);
      }
    }
    return Array.from(byId.values());
  }, [lanes]);

  const columns = useMemo(() => {
    const all = new Map<TaskStatus, TaskRow[]>(KANBAN_COLUMNS.map((c) => [c.id, []]));
    // A started card waits at the top of its new column until the lanes re-read.
    rows.filter((r) => moved[r.id]).forEach((r) => all.get(moved[r.id])?.push(r));
    rows.filter((r) => !moved[r.id]).forEach((r) => all.get(r.status)?.push(r));
    return KANBAN_COLUMNS.map((c) => {
      const lane = lanes[c.id];
      const shown = all.get(c.id) || [];
      // The database total, adjusted for cards optimistically moved in or out of this column.
      const shift = rows.reduce((n, r) => (!moved[r.id] || moved[r.id] === r.status ? n : moved[r.id] === c.id ? n + 1 : r.status === c.id ? n - 1 : n), 0);
      const overdue = shown.filter((r) => r.is_overdue).length;
      return { ...c, lane, shown, total: Math.max(0, lane.total + shift), overdue, overdueMore: lane.hasMore };
    });
  }, [rows, lanes, moved]);

  const dragRow = dragId ? rows.find((r) => r.id === dragId) || null : null;

  const endDrag = () => {
    setDragId(null);
    setOverCol(null);
  };

  const dropProps = (colId: TaskStatus) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!dragId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (overCol !== colId) setOverCol(colId);
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOverCol((c) => (c === colId ? null : c));
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      const id = e.dataTransfer.getData('text/plain') || dragId;
      endDrag();
      const row = rows.find((r) => r.id === id);
      if (row) move(row, colId);
    },
  });

  return (
    <div className="space-y-3">
      {dialogs.conflict}

      <p className="hidden text-[11px] text-[#4A5568] md:block">Drag a card to another column, or use its ⋮ menu. Only moves allowed for you are applied.</p>

      {/* overflowX inline: theme.css resets `.overflow-x-auto` below 1180px for stacked tables */}
      <div className="custom-scrollbar -mx-1 overscroll-x-contain px-1 pb-2" style={{ overflowX: 'auto' }}>
        <div className="flex items-stretch gap-3 snap-x snap-mandatory lg:snap-none">
          {columns.map((col) => {
            const meta = COLUMN_META[col.id];
            const Icon = meta.icon;
            const plan = dragRow ? planKanbanMove(dragRow, col.id, kindsOf(dragRow)) : null;
            const isOver = overCol === col.id;
            const dropTone = !dragRow || !plan ? '' : plan.ok ? 'border-[#0F5E63] bg-[#E3EFEE]/40' : 'opacity-55';
            const isCollapsed = collapsed.includes(col.id);

            if (isCollapsed) {
              return (
                <section
                  key={col.id}
                  aria-label={`${col.label} (${col.total}, collapsed)`}
                  {...dropProps(col.id)}
                  className={`flex w-12 shrink-0 snap-start flex-col items-center gap-3 rounded-[14px] border border-t-[3px] border-[#DCD8CE] bg-[#FBFAF7] py-2 transition-colors ${dropTone} ${isOver && plan?.ok ? 'ring-2 ring-[#0F5E63]/30' : ''}`}
                  style={{ borderTopColor: meta.accent }}
                >
                  <button
                    type="button"
                    onClick={() => toggleCollapsed(col.id)}
                    aria-label={`Expand ${col.label}`}
                    title={`Expand ${col.label}`}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-[#4A5568] hover:bg-white hover:text-[#14213D] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5E63]/40"
                  >
                    <ChevronsRight className="h-4 w-4" />
                  </button>
                  <Icon className="h-4 w-4" style={{ color: meta.accent }} aria-hidden />
                  <span className="rounded-full border border-[#DCD8CE] bg-white px-1.5 py-0.5 font-mono text-[10px] font-semibold text-[#4A5568]">{col.total}</span>
                  <span className="font-serif text-sm font-bold text-[#14213D] [writing-mode:vertical-rl]">{col.label}</span>
                </section>
              );
            }

            return (
              <section
                key={col.id}
                aria-label={`${col.label} (${col.total})`}
                {...dropProps(col.id)}
                className={`flex w-[84vw] max-w-[320px] shrink-0 snap-start flex-col rounded-[14px] border border-t-[3px] border-[#DCD8CE] bg-[#FBFAF7] transition-colors sm:w-[288px] lg:w-auto lg:min-w-[196px] lg:max-w-none lg:flex-1 ${dropTone} ${isOver && plan?.ok ? 'ring-2 ring-[#0F5E63]/30' : ''}`}
                style={{ borderTopColor: meta.accent }}
              >
                <header className="flex items-center gap-1.5 border-b border-[#ECE9E2] py-2.5 pl-2.5 pr-1.5">
                  <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: meta.accent }} aria-hidden />
                  <h3 className="min-w-0 truncate font-serif text-[13px] font-bold text-[#14213D]" title={col.label}>
                    {col.label}
                  </h3>
                  <span className="shrink-0 rounded-full border border-[#DCD8CE] bg-white px-1.5 py-px font-mono text-[10px] font-semibold text-[#4A5568]">{col.total}</span>
                  {/* Overdue among the cards loaded so far ("3+" while the lane has more to load) */}
                  {col.overdue > 0 && (
                    <span
                      className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-[#FBEBDD] px-1.5 py-px font-mono text-[10px] font-bold text-[#9A3412]"
                      title={col.overdueMore ? `${col.overdue} overdue among the cards loaded so far` : `${col.overdue} overdue`}
                      aria-label={col.overdueMore ? `At least ${col.overdue} overdue` : `${col.overdue} overdue`}
                    >
                      <AlertTriangle className="h-2.5 w-2.5" aria-hidden />
                      {col.overdue}
                      {col.overdueMore ? '+' : ''}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => toggleCollapsed(col.id)}
                    aria-label={`Collapse ${col.label}`}
                    title={`Collapse ${col.label}`}
                    className="ml-auto hidden h-6 w-6 shrink-0 items-center justify-center rounded-md text-[#6B7280] hover:bg-white hover:text-[#14213D] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5E63]/40 lg:flex"
                  >
                    <ChevronsLeft className="h-3.5 w-3.5" />
                  </button>
                </header>

                <ul
                  aria-busy={col.lane.loadingMore || undefined}
                  className="flex min-h-[160px] flex-1 flex-col gap-2 p-2 md:max-h-[calc(100dvh-240px)] md:overflow-y-auto custom-scrollbar"
                >
                  {dragRow && plan && (
                    <li
                      aria-hidden
                      className={`shrink-0 rounded-[10px] border border-dashed px-3 py-2.5 text-center text-[11px] font-semibold transition-colors ${
                        plan.ok ? (isOver ? 'border-[#0F5E63] bg-[#E3EFEE] text-[#0F5E63]' : 'border-[#0F5E63]/50 text-[#0F5E63]') : 'border-[#DCD8CE] text-[#6B7280]'
                      }`}
                    >
                      {plan.ok ? `Drop to ${plan.label.toLowerCase()}` : isOver ? plan.message : 'Not allowed'}
                    </li>
                  )}
                  {col.shown.length === 0 && !dragRow && (
                    <li className="flex flex-1 flex-col items-center justify-center gap-1.5 rounded-[10px] border border-dashed border-[#DCD8CE] p-4 text-center">
                      <Icon className="h-5 w-5 text-[#C9C4B8]" aria-hidden />
                      <span className="text-[11px] text-[#6B7280]">{filtered ? 'No tasks match this filter.' : meta.empty}</span>
                    </li>
                  )}
                  {col.shown.map((t) => (
                    <BoardCard
                      key={t.id}
                      task={t}
                      status={statusOf(t)}
                      showAssignee={showAssignee}
                      busy={busyId === t.id}
                      dragging={dragId === t.id}
                      kinds={kindsOf(t)}
                      onMove={(to) => move(t, to)}
                      onDragStart={(e) => {
                        e.dataTransfer.setData('text/plain', t.id);
                        e.dataTransfer.effectAllowed = 'move';
                        setDragId(t.id);
                      }}
                      onDragEnd={endDrag}
                    />
                  ))}
                  {/* This lane's next page, read when the end of the lane scrolls into view */}
                  <LoadMoreRow as="li" hasMore={col.lane.hasMore} loading={col.lane.loadingMore} onLoadMore={col.lane.loadMore} count={col.lane.rows.length} />
                </ul>
              </section>
            );
          })}
        </div>
      </div>

      {dialogs.action}
    </div>
  );
};

// ------------------------------------------------------------------ moves (board + list)
/**
 * Status moves shared by the board and the task list: plans the move for this viewer, starts straight away
 * (no fields), opens the matching TaskActionDialog for everything else, and surfaces version conflicts.
 * Render `dialogs.conflict` above the rows and `dialogs.action` once anywhere below.
 */
export function useTaskMover({
  isManager,
  notify,
  onChanged,
  onOptimistic,
}: {
  isManager: boolean;
  notify: (kind: 'success' | 'error', text: string) => void;
  onChanged: () => void;
  /** Show a started card in its new column before the server answers (null = undo). */
  onOptimistic?: (id: string, to: TaskStatus | null) => void;
}) {
  const { user } = useAuth();
  const [dialog, setDialog] = useState<{ action: TaskDialogAction; task: TaskRow } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);

  const kindsOf = (row: TaskRow) => rowActorKinds(row, user?.id, isManager);

  const move = async (row: TaskRow, to: TaskStatus) => {
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
    setBusyId(row.id);
    onOptimistic?.(row.id, 'in_progress');
    try {
      await api.post(`/tasks/${row.id}/start`, { version: row.version });
      notifyTasksChanged();
      notify('success', `${row.task_number} started.`);
      onChanged();
    } catch (e) {
      onOptimistic?.(row.id, null);
      if (isConflict(e) && (e as any)?.data?.code === 'STALE_VERSION') setConflict(true);
      else notify('error', errorMessage(e));
    } finally {
      setBusyId(null);
    }
  };

  const dialogs = {
    conflict: conflict ? (
      <TaskConflictCallout
        onRefresh={() => {
          setConflict(false);
          onChanged();
        }}
      />
    ) : null,
    action: (
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
    ),
  };

  return { kindsOf, move, busyId, dialogs };
}

/** The card ⋮ menu: open the task, then every move this viewer may make from `status`. */
export function taskMoveMenu(t: TaskRow, status: TaskStatus, kinds: Set<TaskActorKind>, onMove: (to: TaskStatus) => void, openTask: () => void): RowMenuItem[] {
  return [
    { key: 'open', label: 'Open task', icon: <ExternalLink />, onSelect: openTask },
    ...KANBAN_COLUMNS.filter((c) => c.id !== status).flatMap((c) => {
      const plan = planKanbanMove(t, c.id, kinds);
      if (!plan?.ok) return [];
      const I = COLUMN_META[c.id].icon;
      return [{ key: c.id, label: `${plan.label} → ${c.label}`, icon: <I />, onSelect: () => onMove(c.id) }];
    }),
  ];
}

// ------------------------------------------------------------------ card
/** "40m", "12h", "3d" — short enough for a narrow card. */
const shortSpan = (ms: number) => {
  const mins = Math.round(Math.abs(ms) / 60000);
  if (mins < 60) return `${Math.max(1, mins)}m`;
  const hours = Math.round(mins / 60);
  return hours < 24 ? `${hours}h` : `${Math.round(hours / 24)}d`;
};

/** Deadline chip: time left or late, toned by urgency; finished work shows when it was done. Full date-time on hover. */
export const DueChip: React.FC<{ task: TaskRow }> = ({ task: t }) => {
  if ((t.status === 'completed' || t.status === 'awaiting_approval') && t.completed_at) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-[#EAF6F0] px-2 py-0.5 text-[11px] font-semibold text-[#1F7A55]" title={`Done ${formatTaskDateTime(t.completed_at)}`}>
        <CircleCheck className="h-3 w-3" aria-hidden />
        Done <span className="font-mono">{formatTaskDate(t.completed_at)}</span>
      </span>
    );
  }
  if (!t.deadline) return <span className="text-[11px] text-[#6B7280]">No deadline</span>;
  const diff = new Date(t.deadline).getTime() - Date.now();
  const paused = isTaskClockPaused({ status: t.status, has_accepted_blocker: t.open_blocker?.status === 'accepted', accepted_blocker_decision: t.open_blocker?.decision });
  const late = !paused && (t.is_overdue || diff < 0);
  const tone = paused
    ? 'bg-[#EEF1F5] text-[#4A5568]'
    : late
      ? 'bg-[#FBEBDD] text-[#9A3412]'
      : diff <= 86400000
        ? 'bg-[#FFF8EB] text-[#A15C07]'
        : 'border border-[#ECE9E2] bg-white text-[#4A5568]';
  const label = paused ? 'Paused' : !countsDown(t) ? 'Due' : late ? `${shortSpan(diff)} late` : `${shortSpan(diff)} left`;
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5" title={`Deadline ${formatTaskDateTime(t.deadline)} · ${relativeDue(t.deadline).label}`}>
      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${tone}`}>{label}</span>
      <span className="truncate font-mono text-[11px] text-[#4A5568]">{formatTaskDate(t.deadline)}</span>
    </span>
  );
};

const Indicator: React.FC<{ icon: LucideIcon; label: string; count?: number }> = ({ icon: I, label, count }) => (
  <span role="img" className="inline-flex items-center gap-0.5 text-[#6B7280]" title={label} aria-label={label}>
    <I className="h-3.5 w-3.5" aria-hidden />
    {count ? <span className="font-mono text-[10px] font-semibold">{count}</span> : null}
  </span>
);

const BoardCard: React.FC<{
  task: TaskRow;
  /** Column the card sits in (differs from task.status while an optimistic move is in flight). */
  status: TaskStatus;
  showAssignee?: boolean;
  busy: boolean;
  dragging: boolean;
  kinds: Set<TaskActorKind>;
  onMove: (to: TaskStatus) => void;
  onDragStart: (e: React.DragEvent<HTMLLIElement>) => void;
  onDragEnd: () => void;
}> = ({ task: t, status, showAssignee, busy, dragging, kinds, onMove, onDragStart, onDragEnd }) => {
  const showDelay = (t.status === 'completed' || t.status === 'awaiting_approval') && Boolean(t.delay_class) && t.delay_class !== 'open';
  const links = [t.customer_name, t.tender_no ? `Tender ${t.tender_no}` : null, t.demo_no ? `Demo ${t.demo_no}` : null, t.ticket_no ? `Ticket ${t.ticket_no}` : null].filter(Boolean).join(' · ');
  const person = showAssignee ? { name: t.assignee_name, label: `Assigned to ${t.assignee_name || 'nobody'}` } : t.assigned_by && t.assigned_by !== t.assigned_to ? { name: t.assigned_by_name, label: `Assigned by ${t.assigned_by_name || 'someone'}` } : null;
  const reworks = t.rework_count + t.reopen_count;

  const menu = taskMoveMenu(t, status, kinds, onMove, () => openTaskPeek(t.id));

  return (
    <li
      draggable={!busy}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      aria-busy={busy || undefined}
      className={`group relative shrink-0 overflow-hidden rounded-[12px] border bg-white shadow-[0_1px_0_rgba(20,33,61,0.04)] transition-all hover:border-[#C9C4B8] hover:shadow-sm ${
        dragging ? 'rotate-1 opacity-40' : ''
      } ${t.is_overdue ? 'border-[#E9C9B4]' : 'border-[#DCD8CE]'} ${busy ? 'cursor-wait' : 'cursor-grab active:cursor-grabbing'}`}
    >
      <span aria-hidden className="absolute inset-y-0 left-0 w-[3px]" style={{ background: PRIORITY_STRIPE[t.priority] }} />
      <div className="space-y-2 py-2.5 pl-3.5 pr-2.5">
        <div className="flex items-center gap-1.5">
          <GripVertical className="-ml-1 hidden h-3.5 w-3.5 shrink-0 text-[#C9C4B8] md:inline" aria-hidden />
          <span className="shrink-0 font-mono text-[11px] font-semibold text-[#0F5E63]">{t.task_number}</span>
          <span className="min-w-0 flex-1 truncate text-[11px] text-[#6B7280]">{t.category_name}</span>
          <span className="flex shrink-0 items-center gap-1.5">
            {t.template_id && <Indicator icon={Repeat} label="Recurring task" />}
            {t.evidence_required && <Indicator icon={FileCheck2} label="Evidence required" />}
            {t.approval_required && <Indicator icon={BadgeCheck} label={t.status === 'awaiting_approval' ? 'Approval pending' : 'Approval required'} />}
            {reworks > 0 && <Indicator icon={RotateCcw} label={`Sent back or reopened ${reworks}×`} count={reworks} />}
          </span>
          {busy ? (
            <span className="flex h-7 w-7 shrink-0 items-center justify-center">
              <Spinner size="xs" />
            </span>
          ) : (
            <span className="-my-1.5 -mr-1.5 shrink-0 transition-opacity md:my-0 md:mr-0 md:opacity-0 md:focus-within:opacity-100 md:group-hover:opacity-100 [&:has(>button[aria-expanded=true])]:opacity-100 [&>button:hover]:!bg-[#E3EFEE] [&>button]:!h-10 [&>button]:!w-10 md:[&>button]:!h-7 md:[&>button]:!w-7 [&>button]:!border-transparent [&>button]:!bg-transparent">
              <RowMenu items={menu} label={`Actions for ${t.task_number}`} />
            </span>
          )}
        </div>

        <Link href={`/tasks/${t.id}`} draggable={false} className="block text-sm font-medium leading-snug text-[#14213D] line-clamp-2 hover:underline focus:underline focus:outline-none">
          {t.title}
        </Link>
        {links && <p className="truncate text-[11px] text-[#4A5568]">{links}</p>}

        <div className="flex flex-wrap items-center gap-1">
          <PriorityBadge priority={t.priority} />
          {t.is_overdue && <StatusBadge status="overdue" />}
          {t.open_blocker && <BlockerBadge status={t.open_blocker.status} />}
          {showDelay && <DelayBadge delay={t.delay_class} />}
          <TaskFlags task={t} showInactive={Boolean(showAssignee)} />
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-[#ECE9E2] pt-2">
          <DueChip task={t} />
          {person && (
            <span
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#E3EFEE] font-mono text-[10px] font-bold text-[#0F5E63] ring-2 ring-white"
              title={person.label}
              aria-label={person.label}
            >
              {initials(person.name)}
            </span>
          )}
        </div>
      </div>
    </li>
  );
};
