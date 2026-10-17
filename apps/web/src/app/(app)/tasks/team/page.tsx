'use client';

import React, { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowDownWideNarrow,
  ArrowUpDown,
  ArrowUpNarrowWide,
  BellOff,
  CalendarClock,
  CheckCircle2,
  Clock,
  Eye,
  Flag,
  Layers,
  Plus,
  Repeat,
  ShieldAlert,
  SlidersHorizontal,
  Tag,
  User,
  UserCog,
  Users,
  UserX,
  X,
  XCircle,
} from 'lucide-react';
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
  RowMenu,
  SectionHeader,
  Select,
  Textarea,
} from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import {
  TASK_DELAY_CLASSES,
  TASK_DELAY_CLASS_LABELS,
  TASK_DISPLAY_STATUSES,
  TASK_MIN_COMMENT_LENGTH,
  TASK_PRIORITIES,
  TASK_PRIORITY_LABELS,
  TASK_REASSIGN_REASONS,
  TASK_REASSIGN_REASON_LABELS,
  TASK_RECURRENCE_LABELS,
  TASK_RECURRENCE_TYPES,
  TASK_STATUS_LABELS,
  resolveTaskAction,
  type TaskRecurrenceType,
  type TaskReassignReason,
} from '@arihant/shared';
import { errorMessage, fieldErrors, istToday, notifyTasksChanged, useTaskCategories, useTaskSummary, type AssigneeOption, type TaskRow } from '../_lib/task-lib';
import { TaskConflictCallout, TaskViewMenu, TaskViewRow, useToaster, useUrlFilters } from '../_lib/task-ui';
import { DeadlineInput, UserSelect } from '../_lib/pickers';
import { TaskActionDialog, type TaskDialogAction } from '../_lib/TaskActions';
import { TaskCards, TaskPagination, TaskSearchInput, TaskTable, rowActorKinds, useTaskList } from '../_lib/TaskList';

/** Filter params — also used by dashboard drill-down links, so the names must not change. */
const EDITABLE = ['search', 'assignee_ids', 'category_ids', 'priority', 'statuses', 'recurrence_type', 'deadline_from', 'deadline_to', 'has_open_blocker', 'no_update', 'delay_class'] as const;
/** Drill-down context from other screens (accountability, task creation, linked records): shown as removable chips. */
const CONTEXT = ['department_ids', 'manager_ids', 'group_id', 'template_id', 'customer_id', 'tender_id', 'demo_id', 'service_ticket_id'] as const;
const FILTERS = [...EDITABLE, ...CONTEXT] as const;
type ContextKey = (typeof CONTEXT)[number];
const CONTEXT_LABEL: Record<ContextKey, string> = {
  department_ids: 'Department',
  manager_ids: 'Manager',
  group_id: 'Assigned together',
  template_id: 'Recurring series',
  customer_id: 'Customer',
  tender_id: 'Tender',
  demo_id: 'Demo',
  service_ticket_id: 'Service ticket',
};
/** Name for a context chip from the loaded rows, when one is available. */
const contextName = (k: ContextKey, id: string, rows: TaskRow[]): string | null => {
  const r = rows[0];
  if (!r) return null;
  switch (k) {
    case 'department_ids':
      return id.includes(',') ? null : rows.find((x) => x.department_id === id)?.department_name || null;
    case 'customer_id':
      return r.customer_name;
    case 'tender_id':
      return r.tender_no;
    case 'demo_id':
      return r.demo_no;
    case 'service_ticket_id':
      return r.ticket_no;
    case 'template_id':
      return r.title;
    default:
      return null;
  }
};
/** Less-used filters, shown in the inline "More" row (Priority lives here so the main row fits one line with View). */
const MORE_KEYS = ['priority', 'category_ids', 'recurrence_type', 'has_open_blocker', 'delay_class', 'no_update', 'deadline_from', 'deadline_to'] as const;
const URL_KEYS = ['section', 'view', ...FILTERS, 'sort_by', 'sort_dir', 'page'] as const;
const PAGE_SIZE = 25;

const SORT_OPTIONS = [
  { value: 'deadline', label: 'Deadline' },
  { value: 'priority', label: 'Priority' },
  { value: 'last_update_at', label: 'Last update' },
  { value: 'assignee_name', label: 'Assignee' },
];
/** Natural direction when a sort is picked: most urgent / stalest first. */
const SORT_DEFAULT_DIR: Record<string, 'asc' | 'desc'> = { deadline: 'asc', priority: 'desc', last_update_at: 'asc', assignee_name: 'asc' };

interface NeedsTemplate {
  id: string;
  title: string;
  status: string;
  status_reason: string | null;
  recurrence_type: string;
  assigned_to: string;
  assignee_name: string | null;
  assignee_active: boolean;
}

function TeamTasks() {
  const { user } = useAuth();
  const { summary, reload: reloadSummary } = useTaskSummary();
  const { values, set } = useUrlFilters(URL_KEYS);
  const { categories } = useTaskCategories();
  const { push, Toaster } = useToaster();
  // Opens by itself when a drill-down link arrives with one of the "More" filters set.
  const [filtersOpen, setFiltersOpen] = useState(() => MORE_KEYS.some((k) => values[k]));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<'reassign' | 'extend' | null>(null);
  const [dialog, setDialog] = useState<{ action: TaskDialogAction; task: TaskRow } | null>(null);
  const [conflict, setConflict] = useState(false);
  const [people, setPeople] = useState<{ value: string; label: string }[]>([]);
  const [needs, setNeeds] = useState<{ tasks: TaskRow[]; templates: NeedsTemplate[] } | null>(null);
  const [needsError, setNeedsError] = useState<string | null>(null);

  const allowed = summary ? Boolean(summary.has_team || summary.can_view_all) : null;
  const canViewAll = Boolean(summary?.can_view_all);
  const defaultView = canViewAll ? 'all' : 'team';
  const view = ['team', 'assigned_by_me', 'all'].includes(values.view) ? values.view : defaultView;
  const section: 'tasks' | 'needs' = values.section === 'needs' ? 'needs' : 'tasks';
  const page = Math.max(1, Number(values.page) || 1);
  const sortBy = SORT_OPTIONS.some((o) => o.value === values.sort_by) ? values.sort_by : 'deadline';
  const sortDir = values.sort_dir === 'desc' ? 'desc' : values.sort_dir === 'asc' ? 'asc' : SORT_DEFAULT_DIR[sortBy];
  const activeFilters = FILTERS.filter((k) => values[k]).length;
  const listOf = (k: (typeof FILTERS)[number]) => (values[k] ? values[k].split(',').filter(Boolean) : []);
  /** Clears filters only — the chosen view, section and sort stay. */
  const clearFilters = () => set(Object.fromEntries(FILTERS.map((k) => [k, null])) as Record<(typeof FILTERS)[number], null>);

  const query = useMemo(() => {
    if (!allowed || section !== 'tasks') return null;
    const q: Record<string, string | number> = { view, page, page_size: PAGE_SIZE, sort_by: sortBy, sort_dir: sortDir };
    for (const k of FILTERS) if (values[k]) q[k] = values[k];
    return q;
  }, [allowed, section, view, page, sortBy, sortDir, values]);
  const tasks = useTaskList(query);

  // Selection belongs to one page of one query.
  const selectionKey = `${section}|${JSON.stringify(query)}`;
  useEffect(() => setSelected(new Set()), [selectionKey]);

  // People for the assignee filter: the team (or everyone for management/admin).
  useEffect(() => {
    if (!allowed) return;
    const load = canViewAll
      ? api.get<any>('/users', { limit: 100 }).then((r) => ((r?.data || r || []) as { id: string; full_name: string; is_active?: boolean }[]).map((u) => ({ value: u.id, label: u.is_active === false ? `${u.full_name} (inactive)` : u.full_name })))
      : api.get<AssigneeOption[]>('/tasks/lookups/assignees').then((r) => r.filter((a) => a.scope === 'team' || a.scope === 'all').map((a) => ({ value: a.id, label: a.full_name })));
    load.then(setPeople).catch(() => setPeople([]));
  }, [allowed, canViewAll]);

  const loadNeeds = useCallback(async () => {
    setNeedsError(null);
    try {
      setNeeds(await api.get('/tasks/needs-reassignment'));
    } catch (e) {
      setNeedsError(errorMessage(e));
    }
  }, []);
  useEffect(() => {
    if (allowed && section === 'needs') loadNeeds();
  }, [allowed, section, loadNeeds]);

  const refresh = () => {
    if (section === 'needs') loadNeeds();
    else tasks.reload();
    reloadSummary();
  };

  const rows = section === 'needs' ? needs?.tasks || [] : tasks.data?.data || [];
  const selectedRows = rows.filter((r) => selected.has(r.id));

  // Assignee filter: keep drill-down ids visible even if they are not in the picker (e.g. inactive people).
  const assigneeOptions = useMemo(() => {
    const known = new Set(people.map((p) => p.value));
    const extra = listOf('assignee_ids')
      .filter((id) => !known.has(id))
      .map((id) => ({ value: id, label: rows.find((r) => r.assigned_to === id)?.assignee_name || 'Selected person' }));
    return [...people, ...extra];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [people, values.assignee_ids, rows]);

  const rowActions = (t: TaskRow) => {
    const kinds = rowActorKinds(t, user?.id, true);
    const canReassign = resolveTaskAction(t.status, 'reassign', kinds).ok;
    const canExtend = resolveTaskAction(t.status, 'extend_deadline', kinds).ok;
    if (!canReassign && !canExtend) return null;
    return (
      <>
        <span className="hidden md:inline-flex">
          <RowMenu
            label={`Actions for ${t.task_number}`}
            items={[
              { key: 'reassign', label: 'Reassign', icon: <UserCog className="h-4 w-4" />, onSelect: () => setDialog({ action: 'reassign', task: t }), hidden: !canReassign },
              { key: 'extend', label: 'Extend deadline', icon: <CalendarClock className="h-4 w-4" />, onSelect: () => setDialog({ action: 'extend_deadline', task: t }), hidden: !canExtend },
            ]}
          />
        </span>
        <span className="flex flex-wrap gap-2 md:hidden">
          {canReassign && (
            <Button size="sm" variant="secondary" className="h-10" leftIcon={<UserCog className="h-4 w-4" />} onClick={() => setDialog({ action: 'reassign', task: t })}>
              Reassign
            </Button>
          )}
          {canExtend && (
            <Button size="sm" variant="secondary" className="h-10" leftIcon={<CalendarClock className="h-4 w-4" />} onClick={() => setDialog({ action: 'extend_deadline', task: t })}>
              Extend
            </Button>
          )}
        </span>
      </>
    );
  };

  // Until the summary says who may see this page, the row carries just the View menu (it is the navigation).
  if (!summary || !allowed) {
    return (
      <PageContainer>
        <PageHeader title="Team Tasks" icon={<Users className="h-5 w-5" />} />
        <TaskViewRow />
        {!summary ? (
          <PageLoader rows={5} label="Loading team tasks" />
        ) : (
          <EmptyState
            icon={Users}
            title="Team Tasks is for managers"
            description="This view lists the work of people who report to you. You have no reporting team, so your own work lives in My Tasks."
            action={
              <Link href="/tasks">
                <Button variant="secondary">Go to My Tasks</Button>
              </Link>
            }
          />
        )}
      </PageContainer>
    );
  }

  const showOptions = [
    { key: 'team', label: 'My team' },
    { key: 'assigned_by_me', label: 'Assigned by me' },
    { key: 'all', label: canViewAll ? 'All tasks' : 'All I can see' },
  ].map((o) => ({ ...o, active: section === 'tasks' && view === o.key, onSelect: () => set({ section: null, view: o.key === defaultView ? null : o.key }) }));
  const moreActive = MORE_KEYS.filter((k) => values[k]).length;
  const contextChips = CONTEXT.filter((k) => values[k]);
  const scrollPanel = '[&_.filter-menu-panel]:max-h-[320px] [&_.filter-menu-panel]:overflow-y-auto';
  /** Single-select over a comma-list param: drill-down links may carry several ids, each shows as active. */
  const listMenu = (key: (typeof EDITABLE)[number], anyLabel: string, opts: { value: string; label: string }[]) => [
    { key: '__any', label: anyLabel, active: !values[key], onSelect: () => set({ [key]: null }) },
    ...opts.map((o) => ({ key: o.value, label: o.label, active: listOf(key).includes(o.value), onSelect: () => set({ [key]: o.value }) })),
  ];
  const dateCls = 'h-8 rounded-lg border border-[#C9C4B8] bg-white px-2.5 text-xs text-[#14213D] focus:border-[#0F5E63] focus:outline-none';

  return (
    <PageContainer>
      <PageHeader
        title="Team Tasks"
        icon={<Users className="h-5 w-5" />}
        actions={
          <Link href="/tasks/new">
            <Button size="sm" leftIcon={<Plus className="h-4 w-4" />}>
              Assign Task
            </Button>
          </Link>
        }
      />

      {/* One filter row on both sections: View, search, then compact dropdowns. "More" opens the less-used filters inline. */}
      <Card padding="sm" className="relative z-20 space-y-2.5 overflow-visible border-[#DCD8CE]">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
          <TaskViewMenu />
          <div className="w-full min-w-[200px] lg:w-auto lg:flex-1">
            {section === 'tasks' ? (
              <TaskSearchInput compact label="Search team tasks" placeholder="Search task number or title" value={values.search} onSearch={(q) => set({ search: q })} />
            ) : (
              <p className="text-xs text-[#4A5568]">Open tasks and recurring series owned by people who are no longer active.</p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 lg:flex-nowrap">
            <FilterMenu
              label="Show"
              icon={<Eye />}
              neutralKeys={[defaultView]}
              options={[
                ...showOptions,
                { key: 'needs', label: 'Needs reassignment', icon: <UserX />, count: summary.needs_reassignment || undefined, urgent: true, active: section === 'needs', onSelect: () => set({ section: 'needs' }) },
              ]}
            />
            {section === 'tasks' && (
              <>
                <FilterMenu label="Assignee" icon={<User />} className={scrollPanel} options={listMenu('assignee_ids', 'Anyone', assigneeOptions)} neutralKeys={['__any']} />
                <FilterMenu
                  label="Status"
                  icon={<Layers />}
                  className={scrollPanel}
                  options={listMenu('statuses', 'Open & completed', TASK_DISPLAY_STATUSES.map((st) => ({ value: st, label: TASK_STATUS_LABELS[st] })))}
                  neutralKeys={['__any']}
                />
                <button type="button" onClick={() => setFiltersOpen((o) => !o)} aria-expanded={filtersOpen} className={`filter-menu-btn ${filtersOpen || moreActive ? 'filter-menu-btn--on' : ''}`}>
                  <SlidersHorizontal className="h-3.5 w-3.5" />
                  <span>More</span>
                  {moreActive > 0 && <span className="filter-menu-chip">{moreActive}</span>}
                </button>
                <FilterMenu
                  label="Sort"
                  icon={<ArrowUpDown />}
                  neutralKeys={[...SORT_OPTIONS.map((o) => o.value), 'dir_desc', 'dir_asc']}
                  align="right"
                  options={[
                    ...SORT_OPTIONS.map((o) => ({ key: o.value, label: o.label, active: sortBy === o.value, onSelect: () => set({ sort_by: o.value === 'deadline' ? null : o.value, sort_dir: null }) })),
                    { key: 'dir_desc', label: 'Descending', icon: <ArrowDownWideNarrow />, active: sortDir === 'desc', onSelect: () => set({ sort_dir: 'desc' }) },
                    { key: 'dir_asc', label: 'Ascending', icon: <ArrowUpNarrowWide />, active: sortDir === 'asc', onSelect: () => set({ sort_dir: 'asc' }) },
                  ]}
                />
                {activeFilters > 0 && (
                  <Button variant="ghost" size="xs" onClick={clearFilters} className="text-xs text-[#4A5568] hover:text-[#881337]">
                    Clear
                  </Button>
                )}
              </>
            )}
          </div>
        </div>

        {section === 'tasks' && filtersOpen && (
          <div className="flex flex-wrap items-center gap-2 border-t border-[#ECE9E2] pt-2.5 text-xs">
            <FilterMenu label="Priority" icon={<Flag />} options={listMenu('priority', 'Any priority', TASK_PRIORITIES.map((p) => ({ value: p, label: TASK_PRIORITY_LABELS[p] })))} neutralKeys={['__any']} />
            <FilterMenu label="Category" icon={<Tag />} className={scrollPanel} options={listMenu('category_ids', 'Any category', categories.map((c) => ({ value: c.id, label: c.name })))} neutralKeys={['__any']} />
            <FilterMenu
              label="Frequency"
              icon={<Repeat />}
              neutralKeys={['__any']}
              options={[
                { key: '__any', label: 'Any frequency', active: !values.recurrence_type, onSelect: () => set({ recurrence_type: null }) },
                ...TASK_RECURRENCE_TYPES.map((r) => ({ key: r, label: TASK_RECURRENCE_LABELS[r as TaskRecurrenceType], active: values.recurrence_type === r, onSelect: () => set({ recurrence_type: r }) })),
              ]}
            />
            <FilterMenu
              label="Blocker"
              icon={<ShieldAlert />}
              neutralKeys={['__any']}
              options={[
                { key: '__any', label: 'Any', active: !values.has_open_blocker, onSelect: () => set({ has_open_blocker: null }) },
                { key: 'true', label: 'Has an open blocker', active: values.has_open_blocker === 'true', onSelect: () => set({ has_open_blocker: 'true' }) },
                { key: 'false', label: 'No open blocker', active: values.has_open_blocker === 'false', onSelect: () => set({ has_open_blocker: 'false' }) },
              ]}
            />
            <FilterMenu
              label="Delay"
              icon={<Clock />}
              neutralKeys={['__any']}
              options={[
                { key: '__any', label: 'Any', active: !values.delay_class, onSelect: () => set({ delay_class: null }) },
                ...TASK_DELAY_CLASSES.map((d) => ({ key: d, label: TASK_DELAY_CLASS_LABELS[d], active: values.delay_class === d, onSelect: () => set({ delay_class: d }) })),
              ]}
            />
            <button
              type="button"
              aria-pressed={values.no_update === 'true'}
              onClick={() => set({ no_update: values.no_update === 'true' ? null : 'true' })}
              className={`filter-menu-btn ${values.no_update === 'true' ? 'filter-menu-btn--on' : ''}`}
            >
              <BellOff className="h-3.5 w-3.5" />
              <span>No recent update</span>
            </button>
            <span className="ml-1 font-semibold text-[#4A5568]">Deadline</span>
            <label className="flex items-center gap-1.5 text-[#4A5568]">
              From
              <input type="date" aria-label="Deadline from" value={values.deadline_from} max={values.deadline_to || undefined} onChange={(e) => set({ deadline_from: e.target.value })} className={dateCls} />
            </label>
            <label className="flex items-center gap-1.5 text-[#4A5568]">
              To
              <input type="date" aria-label="Deadline to" value={values.deadline_to} min={values.deadline_from || undefined} onChange={(e) => set({ deadline_to: e.target.value })} className={dateCls} />
            </label>
            {moreActive > 0 && (
              <Button variant="ghost" size="xs" onClick={() => set(Object.fromEntries(MORE_KEYS.map((k) => [k, null])) as Record<(typeof MORE_KEYS)[number], null>)} className="text-xs text-[#4A5568] hover:text-[#881337]">
                Reset
              </Button>
            )}
          </div>
        )}

        {section === 'tasks' && contextChips.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-t border-[#ECE9E2] pt-2.5" aria-label="Drill-down filters">
            {contextChips.map((k) => {
              const name = contextName(k, values[k], tasks.data?.data || []);
              return (
                <span key={k} className="inline-flex max-w-full items-center gap-1 rounded-full border border-[#0F5E63]/30 bg-[#E3EFEE] py-0.5 pl-3 pr-1 text-xs font-semibold text-[#0F5E63]">
                  <span className="truncate">
                    {CONTEXT_LABEL[k]}
                    {name ? `: ${name}` : ''}
                  </span>
                  <button type="button" aria-label={`Remove ${CONTEXT_LABEL[k]} filter`} onClick={() => set({ [k]: null })} className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-white/70">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </span>
              );
            })}
          </div>
        )}
      </Card>

      {conflict && (
        <TaskConflictCallout
          onRefresh={() => {
            setConflict(false);
            refresh();
          }}
        />
      )}

      {section === 'tasks' ? (
        <>
          {tasks.error && (
            <InfoCallout variant="danger" title="Could not load team tasks">
              {tasks.error}
            </InfoCallout>
          )}

          {!tasks.data ? (
            !tasks.error && <PageLoader rows={6} label="Loading team tasks" />
          ) : tasks.data.data.length === 0 ? (
            <EmptyState
              icon={Users}
              title={activeFilters ? 'No tasks match these filters' : 'No tasks in this view'}
              description={activeFilters ? 'Try widening the deadline range or clearing some filters.' : view === 'assigned_by_me' ? 'Tasks you assign to others appear here.' : 'Your team has no open or completed tasks yet.'}
              action={
                activeFilters ? (
                  <Button variant="secondary" onClick={clearFilters}>
                    Clear filters
                  </Button>
                ) : (
                  <Link href="/tasks/new">
                    <Button leftIcon={<Plus className="h-4 w-4" />}>Assign Task</Button>
                  </Link>
                )
              }
            />
          ) : (
            <div className={`space-y-3 transition-opacity ${tasks.loading ? 'opacity-60' : ''}`}>
              <BulkBar count={selected.size} total={tasks.data.total} onReassign={() => setBulk('reassign')} onExtend={() => setBulk('extend')} onClear={() => setSelected(new Set())} />
              <TaskTable rows={tasks.data.data} showAssignee selected={selected} onSelectedChange={setSelected} rowActions={rowActions} />
              <TaskCards rows={tasks.data.data} showAssignee selected={selected} onSelectedChange={setSelected} rowActions={rowActions} />
              <TaskPagination page={tasks.data.page} totalPages={tasks.data.totalPages} total={tasks.data.total} onPage={(p) => set({ page: String(p) }, { resetPage: false })} />
            </div>
          )}
        </>
      ) : (
        <NeedsReassignment
          data={needs}
          error={needsError}
          selected={selected}
          onSelectedChange={setSelected}
          onReassign={(t) => setDialog({ action: 'reassign', task: t })}
          onBulkReassign={() => setBulk('reassign')}
        />
      )}

      <BulkModal
        mode={bulk}
        rows={selectedRows}
        onClose={() => setBulk(null)}
        onFinished={() => {
          setSelected(new Set());
          notifyTasksChanged();
          refresh();
        }}
      />

      <TaskActionDialog
        action={dialog?.action ?? null}
        task={dialog?.task ?? null}
        onClose={() => setDialog(null)}
        onDone={(_detail, message) => {
          setDialog(null);
          push('success', message);
          refresh();
        }}
        onConflict={() => setConflict(true)}
        initial={dialog?.action === 'reassign' && dialog.task.assignee_active === false ? { reason_type: 'deactivation' } : undefined}
      />
      <Toaster />
    </PageContainer>
  );
}

// ------------------------------------------------------------------ bulk actions
const BulkBar: React.FC<{ count: number; total: number; onReassign: () => void; onExtend: () => void; onClear: () => void }> = ({ count, total, onReassign, onExtend, onClear }) => (
  <div className="flex flex-wrap items-center justify-between gap-2" aria-live="polite">
    <span className="text-xs text-[#4A5568]">{count ? <strong className="text-[#14213D]">{count} selected</strong> : `${total} task${total === 1 ? '' : 's'} · tick rows for bulk actions`}</span>
    {count > 0 && (
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" className="h-10 md:h-8" leftIcon={<UserCog className="h-4 w-4" />} onClick={onReassign}>
          Reassign selected
        </Button>
        <Button size="sm" variant="secondary" className="h-10 md:h-8" leftIcon={<CalendarClock className="h-4 w-4" />} onClick={onExtend}>
          Extend deadline
        </Button>
        <Button size="sm" variant="ghost" className="h-10 md:h-8" onClick={onClear}>
          Clear
        </Button>
      </div>
    )}
  </div>
);

interface BulkResult {
  results: { id: string; task_number?: string; ok: boolean; error?: string }[];
  succeeded: number;
  failed: number;
}

const BulkModal: React.FC<{ mode: 'reassign' | 'extend' | null; rows: TaskRow[]; onClose: () => void; onFinished: () => void }> = ({ mode, rows, onClose, onFinished }) => {
  const [toUser, setToUser] = useState('');
  const [reasonType, setReasonType] = useState<TaskReassignReason>('workload');
  const [reason, setReason] = useState('');
  const [deadline, setDeadline] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<BulkResult | null>(null);
  const [snapshot, setSnapshot] = useState<TaskRow[]>([]);
  const [assignees, setAssignees] = useState<AssigneeOption[]>([]);

  useEffect(() => {
    if (!mode) return;
    setToUser('');
    setReasonType(rows.some((r) => r.assignee_active === false) ? 'deactivation' : 'workload');
    setReason('');
    setDeadline('');
    setErrors({});
    setMessage(null);
    setResult(null);
    setSnapshot(rows);
    if (mode === 'reassign') api.get<AssigneeOption[]>('/tasks/lookups/assignees').then((r) => setAssignees(r.filter((a) => a.scope !== 'self'))).catch(() => setAssignees([]));
    // Snapshot the selection when the dialog opens; the list may refresh underneath.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  if (!mode) return null;
  const byId = new Map(snapshot.map((r) => [r.id, r]));
  const title = mode === 'reassign' ? 'Reassign selected tasks' : 'Extend deadline for selected tasks';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (mode === 'reassign' && !toUser) errs.to_user_id = 'Choose the new assignee.';
    if (mode === 'extend' && !deadline) errs.new_deadline = 'Pick the new deadline.';
    if (reason.trim().length < TASK_MIN_COMMENT_LENGTH) errs.reason = `Reason needs at least ${TASK_MIN_COMMENT_LENGTH} characters.`;
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    setMessage(null);
    try {
      const items = snapshot.map((r) => ({ id: r.id, version: r.version }));
      const res =
        mode === 'reassign'
          ? await api.post<BulkResult>('/tasks/bulk/reassign', { items, to_user_id: toUser, reason_type: reasonType, reason: reason.trim(), ...(deadline ? { new_deadline: deadline } : {}) })
          : await api.post<BulkResult>('/tasks/bulk/extend-deadline', { items, new_deadline: deadline, reason: reason.trim() });
      setResult(res);
      onFinished();
    } catch (err) {
      const f = fieldErrors(err);
      setErrors(f);
      if (!Object.keys(f).length) setMessage(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen onClose={busy ? () => undefined : onClose} title={title} description={`${snapshot.length} task${snapshot.length === 1 ? '' : 's'} · each is checked and recorded individually`} maxWidth="xl">
      {result ? (
        <div className="space-y-4">
          <InfoCallout variant={result.failed ? 'warning' : 'success'} title={result.failed ? `${result.succeeded} done, ${result.failed} not changed` : `All ${result.succeeded} tasks updated`}>
            {result.failed ? 'Tasks that failed were left unchanged. Fix the reason shown and try them again.' : 'Assignees have been notified.'}
          </InfoCallout>
          <ul className="divide-y divide-[#ECE9E2] rounded-[10px] border border-[#DCD8CE]" aria-label="Results per task">
            {result.results.map((r) => {
              const row = byId.get(r.id);
              return (
                <li key={r.id} className="flex items-start gap-3 px-3 py-2.5">
                  {r.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#0F5E63]" aria-label="Done" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#881337]" aria-label="Failed" />}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-mono text-xs font-semibold text-[#0F5E63]">{r.task_number || row?.task_number || r.id.slice(0, 8)}</span>
                      <span className="truncate text-xs text-[#14213D]">{row?.title}</span>
                    </div>
                    <p className={`text-[11px] ${r.ok ? 'text-[#4A5568]' : 'text-[#881337]'}`}>{r.ok ? (mode === 'reassign' ? 'Reassigned' : 'Deadline extended') : r.error || 'Failed'}</p>
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="flex justify-end">
            <Button onClick={onClose}>Done</Button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          <div className="max-h-28 overflow-y-auto rounded-[10px] border border-[#ECE9E2] bg-[#FBFAF7] px-3 py-2">
            <ul className="space-y-0.5 text-xs">
              {snapshot.map((r) => (
                <li key={r.id} className="flex gap-2 min-w-0">
                  <span className="font-mono font-semibold text-[#0F5E63] shrink-0">{r.task_number}</span>
                  <span className="truncate text-[#14213D]">{r.title}</span>
                  <span className="ml-auto shrink-0 text-[#4A5568]">{r.assignee_name}</span>
                </li>
              ))}
            </ul>
          </div>
          {mode === 'reassign' ? (
            <>
              <UserSelect label="New assignee *" value={toUser} onChange={setToUser} users={assignees} error={errors.to_user_id} helperText="Your team (and colleagues for linked work)." />
              <Select
                label="Reason type *"
                value={reasonType}
                searchable={false}
                onChange={(e) => setReasonType(e.target.value as TaskReassignReason)}
                helperText="Only “Non-performance” counts against the previous assignee."
                options={TASK_REASSIGN_REASONS.map((r) => ({ value: r, label: TASK_REASSIGN_REASON_LABELS[r] }))}
              />
              <DeadlineInput label="New deadline (optional)" value={deadline} min={istToday()} onChange={setDeadline} error={errors.new_deadline} helperText="Leave empty to keep each task’s current deadline." />
            </>
          ) : (
            <>
              <DeadlineInput label="New deadline" required value={deadline} min={istToday()} onChange={setDeadline} error={errors.new_deadline} />
              <InfoCallout variant="neutral">Original deadlines are kept for honest measurement. Time a task was already overdue stays unexcused.</InfoCallout>
            </>
          )}
          <Textarea
            label="Reason *"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            maxLength={2000}
            placeholder={mode === 'reassign' ? 'Why are these tasks being reassigned?' : 'Why is more time needed?'}
            error={errors.reason}
          />
          {message && <InfoCallout variant="danger">{message}</InfoCallout>}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
              Back
            </Button>
            <Button type="submit" isLoading={busy} disabled={busy}>
              {mode === 'reassign' ? `Reassign ${snapshot.length}` : `Extend ${snapshot.length}`}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
};

// ------------------------------------------------------------------ needs reassignment
const NeedsReassignment: React.FC<{
  data: { tasks: TaskRow[]; templates: NeedsTemplate[] } | null;
  error: string | null;
  selected: Set<string>;
  onSelectedChange: (s: Set<string>) => void;
  onReassign: (t: TaskRow) => void;
  onBulkReassign: () => void;
}> = ({ data, error, selected, onSelectedChange, onReassign, onBulkReassign }) => {
  if (error)
    return (
      <InfoCallout variant="danger" title="Could not load tasks that need reassignment">
        {error}
      </InfoCallout>
    );
  if (!data) return <PageLoader rows={4} label="Checking for inactive assignees" />;
  if (!data.tasks.length && !data.templates.length)
    return <EmptyState icon={UserX} title="Nothing needs reassignment" description="Every open task and recurring series belongs to an active employee." />;

  const reassignButton = (t: TaskRow) => (
    <Button size="sm" variant="secondary" className="h-10 md:h-8" leftIcon={<UserCog className="h-4 w-4" />} onClick={() => onReassign(t)}>
      Reassign
    </Button>
  );

  return (
    <div className="space-y-5">
      <InfoCallout variant="warning" title="Assigned to people who are no longer active">
        Work stalls until these tasks have a new owner. Reassign them and choose the reason “{TASK_REASSIGN_REASON_LABELS.deactivation}” so the previous assignee is not held accountable.
      </InfoCallout>

      {data.tasks.length > 0 && (
        <section className="space-y-3">
          <SectionHeader
            title="Open tasks"
            icon={<UserX className="h-4 w-4" />}
            badge={<Badge variant="warning" size="sm">{data.tasks.length}</Badge>}
            actions={
              selected.size > 0 ? (
                <Button size="sm" className="h-10 md:h-8" leftIcon={<UserCog className="h-4 w-4" />} onClick={onBulkReassign}>
                  Reassign {selected.size} selected
                </Button>
              ) : undefined
            }
          />
          <TaskTable rows={data.tasks} showAssignee selected={selected} onSelectedChange={onSelectedChange} rowActions={reassignButton} />
          <TaskCards rows={data.tasks} showAssignee selected={selected} onSelectedChange={onSelectedChange} rowActions={reassignButton} />
        </section>
      )}

      {data.templates.length > 0 && (
        <section className="space-y-3">
          <SectionHeader
            title="Recurring series paused"
            description="New occurrences stop until the series has an active assignee."
            icon={<Repeat className="h-4 w-4" />}
            badge={<Badge variant="warning" size="sm">{data.templates.length}</Badge>}
          />
          <ul className="space-y-2">
            {data.templates.map((tp) => (
              <li key={tp.id}>
                <Card className="flex flex-col gap-3 p-3.5 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-[#14213D]">{tp.title}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[#4A5568]">
                      <span>{TASK_RECURRENCE_LABELS[tp.recurrence_type as TaskRecurrenceType] || tp.recurrence_type}</span>
                      <span aria-hidden>·</span>
                      <span className={tp.assignee_active ? '' : 'font-semibold text-[#881337]'}>
                        {tp.assignee_name || 'Unassigned'}
                        {tp.assignee_active ? '' : ' (inactive)'}
                      </span>
                      <Badge variant={tp.status === 'active' ? 'success' : 'warning'} size="sm" className="capitalize">
                        {tp.status}
                      </Badge>
                    </div>
                    {tp.status_reason && <p className="mt-1 text-xs text-[#7C2D12]">{tp.status_reason}</p>}
                  </div>
                  <Link href={`/tasks/templates/${tp.id}`} className="shrink-0">
                    <Button size="sm" variant="secondary" className="h-10 md:h-8" fullWidth>
                      Open series
                    </Button>
                  </Link>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
};

export default function TeamTasksPage() {
  return (
    <Suspense fallback={<PageLoader rows={5} />}>
      <TeamTasks />
    </Suspense>
  );
}
