'use client';

import React, { Suspense, useCallback, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { openTaskPeek } from './_lib/TaskPeek';
import { CalendarClock, CheckSquare, ClipboardCheck, Columns3, Inbox, Layers, List, Pencil, Plus, ShieldCheck, Users } from 'lucide-react';
import { Button, ButtonGroup, EmptyState, FilterMenu, InfoCallout, PageContainer, PageHeader, PageLoader, RowMenu, Spinner } from '@/components/ui';
import { TASK_FALLBACK_REVIEWER_ROLES } from '@arihant/shared';
import { useAuth } from '@/lib/auth-context';
import { addDays, istToday, useTaskSummary } from './_lib/task-lib';
import { TASK_BOARD_SCOPES, useTaskViews, useToaster, useUrlFilters, type TaskBoardScope } from './_lib/task-ui';
import { ApprovalBoard, BlockerReviewBoard } from './_lib/QueueBoards';
import { BoardFilterMenu, BoardSortMenu, QUICK_FILTERS, TaskBoard, taskMoveMenu, useBoardSort, useTaskMover, type QuickFilter } from './_lib/TaskBoard';
import { TASK_GROUP_BY_LABELS, TaskCards, TaskPagination, TaskSearchInput, TaskTable, useTaskList, type TaskGroupBy } from './_lib/TaskList';
import type { TaskRow } from './_lib/task-lib';
import { NewTaskButton } from './_lib/NewTaskModal';
import { TaskCharts } from './_lib/TaskCharts';
import { SECTION_SCOPES, TASK_SECTIONS, TaskSectionProvider, TaskToolbar, taskSectionHref, type TaskSection } from './_lib/TaskSections';
import { LeaveSection } from './_lib/LeaveSection';
import { RecurringSection } from './_lib/RecurringSection';

/**
 * `scope` picks the board: my tasks (default), team, blocker reviews or approvals — each only for roles that get it
 * (taskViewsFor). `mode=list` switches My tasks to the list; the other boards' lists are their own pages.
 * `queue=all` shows every pending blocker / approval (management, admin).
 * `section` picks a tab on My / All tasks: the tasks themselves (default), Recurring or Leave & holidays (see TaskSections).
 * The old `section=performance` link forwards to /performance.
 */
const FILTER_KEYS = ['mode', 'scope', 'queue', 'filter', 'tab', 'search', 'page', 'dir', 'group', 'section'] as const;
const LIST_PAGES: Partial<Record<TaskBoardScope, string>> = { team: '/tasks/team', blockers: '/tasks/blockers', approvals: '/tasks/approvals' };
const SCOPE_TITLE: Record<TaskBoardScope, { title: string; icon: React.ReactNode }> = {
  mine: { title: 'My Tasks', icon: <CheckSquare className="h-5 w-5" /> },
  team: { title: 'Team Tasks', icon: <Users className="h-5 w-5" /> },
  blockers: { title: 'Blocker Reviews', icon: <ShieldCheck className="h-5 w-5" /> },
  approvals: { title: 'Approvals', icon: <ClipboardCheck className="h-5 w-5" /> },
};
const OPEN_WORK = 'not_started,in_progress,blocked';
const BOARD_OPEN = 'not_started,in_progress,blocked,awaiting_approval';

type TabId = 'open' | 'today' | 'upcoming' | 'overdue' | 'blocked' | 'awaiting' | 'completed';
const TAB_IDS: TabId[] = ['open', 'today', 'upcoming', 'overdue', 'blocked', 'awaiting', 'completed'];

/** GET /tasks filters per list tab (always view=mine). */
function tabQuery(tab: TabId, today: string): Record<string, string> {
  switch (tab) {
    case 'open':
      return { statuses: BOARD_OPEN, sort_by: 'deadline' };
    case 'today':
      return { deadline_from: today, deadline_to: today, statuses: OPEN_WORK, sort_by: 'deadline' };
    case 'upcoming':
      return { deadline_from: addDays(today, 1), statuses: OPEN_WORK, sort_by: 'deadline' };
    case 'overdue':
      return { statuses: 'overdue', sort_by: 'deadline' };
    case 'blocked':
      return { statuses: 'blocked', sort_by: 'deadline' };
    case 'awaiting':
      return { statuses: 'awaiting_approval', sort_by: 'deadline' };
    case 'completed':
      return { statuses: 'completed', sort_by: 'updated_at', sort_dir: 'desc' };
  }
}

const EMPTY: Record<TabId, { title: string; description: string }> = {
  open: { title: 'No open tasks', description: 'You have nothing in progress. New assignments will appear here.' },
  today: { title: 'Nothing due today', description: 'No open task has today’s deadline. Check Upcoming for what is next.' },
  upcoming: { title: 'No upcoming tasks', description: 'Nothing is scheduled after today. New assignments will appear here.' },
  overdue: { title: 'Nothing overdue', description: 'Every open task is within its deadline. Keep it that way.' },
  blocked: { title: 'No blocked tasks', description: 'If something stops you, raise a blocker from the task so your manager can help.' },
  awaiting: { title: 'Nothing awaiting approval', description: 'Tasks that need sign-off wait here after you complete them.' },
  completed: { title: 'No completed tasks yet', description: 'Finished work is listed here, newest first.' },
};

const TAB_LABELS: Record<TabId, string> = { open: 'All open', today: 'Due today', upcoming: 'Upcoming', overdue: 'Overdue', blocked: 'Blocked', awaiting: 'Awaiting approval', completed: 'Completed' };

function Tasks() {
  const router = useRouter();
  const { user } = useAuth();
  const { values, set } = useUrlFilters(FILTER_KEYS);
  const { reload: reloadSummary } = useTaskSummary();
  const { views, summary: s, loaded } = useTaskViews();
  const { push, Toaster } = useToaster();
  const [sort, setSort] = useBoardSort();

  const isManager = Boolean(s?.has_team || s?.can_view_all);
  // Until the summary loads, trust the URL; afterwards a board this role does not get falls back to My tasks.
  const wanted = (TASK_BOARD_SCOPES as string[]).includes(values.scope) ? (values.scope as TaskBoardScope) : 'mine';
  const scope: TaskBoardScope = !loaded || views.has(wanted) ? wanted : 'mine';
  const section: TaskSection =
    SECTION_SCOPES.includes(scope) && (TASK_SECTIONS as string[]).includes(values.section) ? (values.section as TaskSection) : 'tasks';
  const onTasks = section === 'tasks';
  // My performance moved out of Tasks: an old tab link lands on its page with the same period / filters.
  useEffect(() => {
    if (values.section !== 'performance') return;
    const q = new URLSearchParams(window.location.search);
    q.delete('section');
    const qs = q.toString();
    router.replace(qs ? `/performance?${qs}` : '/performance');
  }, [values.section, router]);
  const queue = scope === 'blockers' || scope === 'approvals';
  const canSeeAllQueues = Boolean(user && TASK_FALLBACK_REVIEWER_ROLES.includes(user.role));
  const queueScope = values.queue === 'all' && canSeeAllQueues ? 'all' : 'mine';
  const board = values.mode !== 'list' || scope !== 'mine';
  const filter: QuickFilter = QUICK_FILTERS.some((f) => f.id === values.filter) ? (values.filter as QuickFilter) : 'all';
  const tab: TabId = (TAB_IDS as string[]).includes(values.tab) ? (values.tab as TabId) : 'open';
  const page = Math.max(1, Number(values.page) || 1);
  const today = istToday();
  const search = values.search || undefined;
  const teamView = s?.can_view_all ? 'all' : 'team';
  const view = scope === 'team' ? teamView : 'mine';
  const statusBoard = onTasks && board && !queue;

  // Completed sorts by finish time; every other tab sorts by deadline, soonest first unless the user flips it.
  const dueSort = tab === 'completed' ? undefined : values.dir === 'desc' ? 'desc' : 'asc';
  const groupBy = (Object.keys(TASK_GROUP_BY_LABELS) as TaskGroupBy[]).find((g) => g === values.group);
  // Grouped lists load a fuller page so a group is not split across pages.
  const pageSize = groupBy ? 100 : 20;
  const listQuery = useMemo(
    () => (board || !onTasks ? null : { view: 'mine', ...tabQuery(tab, today), ...(dueSort ? { sort_by: 'deadline', sort_dir: dueSort } : {}), search, page, page_size: pageSize }),
    [board, onTasks, tab, today, dueSort, search, page, pageSize],
  );
  const openQuery = useMemo(() => (statusBoard ? { view, statuses: BOARD_OPEN, sort_by: 'deadline', search, page_size: 100 } : null), [statusBoard, view, search]);
  const doneQuery = useMemo(() => (statusBoard ? { view, statuses: 'completed', sort_by: 'updated_at', sort_dir: 'desc', search, page_size: 25 } : null), [statusBoard, view, search]);

  const list = useTaskList(listQuery);
  const open = useTaskList(openQuery);
  const done = useTaskList(doneQuery);

  // List rows get the board's moves behind a pencil menu (same rules, same dialogs).
  const mover = useTaskMover({
    isManager,
    notify: push,
    onChanged: () => {
      list.reload();
      reloadSummary();
    },
  });
  const listActions = (t: TaskRow) =>
    mover.busyId === t.id ? (
      <span className="flex h-8 w-8 items-center justify-center">
        <Spinner size="xs" />
      </span>
    ) : (
      <RowMenu
        icon={<Pencil className="h-4 w-4" />}
        label={`Update ${t.task_number}`}
        items={taskMoveMenu(t, t.status, mover.kindsOf(t), (to) => mover.move(t, to), () => openTaskPeek(t.id))}
      />
    );

  const refreshBoard = () => {
    open.reload();
    done.reload();
    reloadSummary();
  };

  const boardRows = useMemo(() => [...(open.data?.data || []), ...(done.data?.data || [])], [open.data, done.data]);
  const loadError = queue || !onTasks ? null : board ? open.error || done.error : list.error;

  const onScope = useCallback((next: TaskBoardScope) => set({ scope: next === 'mine' ? null : next, mode: null, queue: null, filter: null, section: null }), [set]);
  // A tab starts clean: every section keeps its own filters in the query string, so only the board scope carries over.
  const onSection = useCallback((next: TaskSection) => router.replace(taskSectionHref(next, scope), { scroll: false }), [router, scope]);
  const sectionCtx = useMemo(() => ({ scope, onScope, section, onSection }), [scope, onScope, section, onSection]);
  const onFilter = useCallback((f: QuickFilter) => set({ filter: f === 'all' ? null : f }), [set]);
  const showList = () => (LIST_PAGES[scope] ? router.push(LIST_PAGES[scope]!) : set({ mode: 'list' }));

  const listTabs = [
    { id: 'open' as const, count: s?.my_open },
    { id: 'today' as const, count: s?.my_due_today },
    { id: 'upcoming' as const },
    { id: 'overdue' as const, count: s?.my_overdue, urgent: true },
    { id: 'blocked' as const, count: s?.my_blocked },
    { id: 'awaiting' as const, count: s?.my_awaiting_approval },
    { id: 'completed' as const },
  ];

  return (
    <TaskSectionProvider value={sectionCtx}>
      <PageContainer>
        <PageHeader
          title={SCOPE_TITLE[scope].title}
          icon={SCOPE_TITLE[scope].icon}
          actions={
            onTasks && (
              <div className="flex items-center gap-2">
                <ButtonGroup attached role="group" aria-label="Layout">
                  <Button size="sm" variant={board ? 'primary' : 'secondary'} aria-pressed={board} leftIcon={<Columns3 className="h-4 w-4" />} onClick={() => set({ mode: null })}>
                    <span className="hidden sm:inline">Board</span>
                    <span className="sr-only sm:hidden">Board view</span>
                  </Button>
                  <Button size="sm" variant={board ? 'secondary' : 'primary'} aria-pressed={!board} leftIcon={<List className="h-4 w-4" />} onClick={showList}>
                    <span className="hidden sm:inline">List</span>
                    <span className="sr-only sm:hidden">List view</span>
                  </Button>
                </ButtonGroup>
                <NewTaskButton size="sm" leftIcon={<Plus className="h-4 w-4" />}>
                  New Task
                </NewTaskButton>
              </div>
            )
          }
        />

        {section === 'recurring' ? (
          <RecurringSection />
        ) : section === 'leave' ? (
          <LeaveSection />
        ) : (
          <>
            {/* One toolbar row: View first, then search and the Filter / Sort dropdowns; the section tabs underneath. */}
            <TaskToolbar>
              <div className="w-full min-w-[200px] md:w-auto md:flex-1">
                <TaskSearchInput
                  compact
                  label={`Search ${SCOPE_TITLE[scope].title.toLowerCase()}`}
                  placeholder={queue ? 'Search task, title or person' : 'Search task number or title'}
                  value={values.search}
                  onSearch={(q) => set({ search: q })}
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {queue ? (
                  canSeeAllQueues && (
                    <FilterMenu
                      label="Show"
                      icon={<Inbox />}
                      neutralKeys={[]}
                      align="right"
                      options={[
                        { key: 'mine', label: 'Routed to me', active: queueScope === 'mine', onSelect: () => set({ queue: null }) },
                        { key: 'all', label: scope === 'blockers' ? 'All pending blockers' : 'All awaiting approval', active: queueScope === 'all', onSelect: () => set({ queue: 'all' }) },
                      ]}
                    />
                  )
                ) : board ? (
                  <>
                    <BoardFilterMenu rows={boardRows} value={filter} onChange={onFilter} />
                    <BoardSortMenu value={sort} onChange={setSort} />
                  </>
                ) : (
                  <FilterMenu
                    label="Show"
                    icon={<CalendarClock />}
                    neutralKeys={[]}
                    align="right"
                    options={listTabs.map((t) => ({
                      key: t.id,
                      label: TAB_LABELS[t.id],
                      count: t.count || undefined,
                      urgent: t.urgent,
                      active: tab === t.id,
                      onSelect: () => set({ tab: t.id === 'open' ? null : t.id }),
                    }))}
                  />
                )}
                {!queue && !board && (
                  <FilterMenu
                    label="Group by"
                    icon={<Layers />}
                    neutralKeys={['none']}
                    align="right"
                    options={[
                      { key: 'none', label: 'No grouping', active: !groupBy, onSelect: () => set({ group: null }) },
                      ...(Object.keys(TASK_GROUP_BY_LABELS) as TaskGroupBy[]).map((g) => ({
                        key: g,
                        label: g === 'person' ? 'Assigned by' : TASK_GROUP_BY_LABELS[g],
                        active: groupBy === g,
                        onSelect: () => set({ group: g }),
                      })),
                    ]}
                  />
                )}
              </div>
            </TaskToolbar>

            {loadError && (
              <InfoCallout variant="danger" title="Could not load tasks">
                {loadError}
              </InfoCallout>
            )}

            {scope === 'blockers' ? (
              <BlockerReviewBoard search={values.search} scope={queueScope} teamView={teamView} notify={push} onChanged={reloadSummary} />
            ) : scope === 'approvals' ? (
              <ApprovalBoard search={values.search} scope={queueScope} teamView={teamView} notify={push} onChanged={reloadSummary} />
            ) : board ? (
              !open.data || !done.data ? (
                !loadError && <PageLoader rows={4} label="Loading board" />
              ) : (
                <>
                  {/* Where the open work stands, from the rows on this board */}
                  {!search && <TaskCharts rows={boardRows} />}
                  {open.data.total > open.data.data.length && (
                    <InfoCallout variant="neutral">
                      Showing the first {open.data.data.length} of {open.data.total} open tasks. Search to narrow the board{scope === 'team' ? ', or use the List view for every task.' : '.'}
                    </InfoCallout>
                  )}
                  {boardRows.length === 0 && search ? (
                    <EmptyState
                      icon={CheckSquare}
                      title="No tasks match your search"
                      description="Try a different task number or title."
                      action={
                        <Button variant="secondary" onClick={() => set({ search: null })}>
                          Clear search
                        </Button>
                      }
                    />
                  ) : (
                    <TaskBoard
                      rows={boardRows}
                      isManager={isManager}
                      showAssignee={scope === 'team'}
                      filter={filter}
                      sort={sort}
                      notes={
                        done.data.total > done.data.data.length
                          ? { completed: `Latest ${done.data.data.length} of ${done.data.total} shown${scope === 'mine' ? ' — older work is in List → Completed.' : '.'}` }
                          : undefined
                      }
                      onChanged={refreshBoard}
                      notify={push}
                    />
                  )}
                </>
              )
            ) : !list.data ? (
              !loadError && <PageLoader rows={5} label="Loading tasks" />
            ) : list.data.data.length === 0 ? (
              <EmptyState
                icon={CheckSquare}
                title={search ? 'No tasks match your search' : EMPTY[tab].title}
                description={search ? 'Try a different task number or title, or clear the search.' : EMPTY[tab].description}
                action={
                  search ? (
                    <Button variant="secondary" onClick={() => set({ search: null })}>
                      Clear search
                    </Button>
                  ) : tab === 'today' ? (
                    <Button variant="secondary" onClick={() => set({ tab: 'upcoming' })}>
                      See upcoming
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <div className={`space-y-3 transition-opacity ${list.loading ? 'opacity-60' : ''}`}>
                {mover.dialogs.conflict}
                <TaskTable rows={list.data.data} rowActions={listActions} groupBy={groupBy} dueSort={dueSort} onDueSort={dueSort ? () => set({ dir: dueSort === 'asc' ? 'desc' : null }) : undefined} />
                <TaskCards rows={list.data.data} rowActions={listActions} />
                <TaskPagination page={list.data.page} totalPages={list.data.totalPages} total={list.data.total} onPage={(p) => set({ page: String(p) }, { resetPage: false })} />
              </div>
            )}

            {mover.dialogs.action}
          </>
        )}
        <Toaster />
      </PageContainer>
    </TaskSectionProvider>
  );
}

export default function TasksPage() {
  return (
    <Suspense fallback={<PageLoader rows={5} />}>
      <Tasks />
    </Suspense>
  );
}
