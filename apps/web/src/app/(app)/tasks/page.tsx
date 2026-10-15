'use client';

import React, { Suspense, useMemo } from 'react';
import Link from 'next/link';
import { CheckSquare, Columns3, List, Plus, X } from 'lucide-react';
import { Button, ButtonGroup, Card, EmptyState, InfoCallout, PageContainer, PageHeader, PageLoader, StatCard, StatGrid, Tabs } from '@/components/ui';
import { addDays, istToday, useTaskSummary } from './_lib/task-lib';
import { TasksNav, useToaster, useUrlFilters } from './_lib/task-ui';
import { TaskCards, TaskKanban, TaskPagination, TaskSearchInput, TaskTable, useTaskList } from './_lib/TaskList';

const FILTER_KEYS = ['tab', 'mode', 'search', 'page'] as const;
const OPEN_WORK = 'not_started,in_progress,blocked';

type TabId = 'today' | 'upcoming' | 'overdue' | 'blocked' | 'awaiting' | 'completed';
const TAB_IDS: TabId[] = ['today', 'upcoming', 'overdue', 'blocked', 'awaiting', 'completed'];

/** GET /tasks filters per tab (always view=mine). */
function tabQuery(tab: TabId, today: string): Record<string, string> {
  switch (tab) {
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
  today: { title: 'Nothing due today', description: 'No open task has today’s deadline. Check Upcoming for what is next.' },
  upcoming: { title: 'No upcoming tasks', description: 'Nothing is scheduled after today. New assignments will appear here.' },
  overdue: { title: 'Nothing overdue', description: 'Every open task is within its deadline. Keep it that way.' },
  blocked: { title: 'No blocked tasks', description: 'If something stops you, raise a blocker from the task so your manager can help.' },
  awaiting: { title: 'Nothing awaiting approval', description: 'Tasks that need sign-off wait here after you complete them.' },
  completed: { title: 'No completed tasks yet', description: 'Finished work is listed here, newest first.' },
};

function MyTasks() {
  const { values, set } = useUrlFilters(FILTER_KEYS);
  const { summary, reload: reloadSummary } = useTaskSummary();
  const { push, Toaster } = useToaster();
  const tab: TabId = (TAB_IDS as string[]).includes(values.tab) ? (values.tab as TabId) : 'today';
  const kanban = values.mode === 'kanban';
  const page = Math.max(1, Number(values.page) || 1);
  const today = istToday();
  const search = values.search || undefined;

  const listQuery = useMemo(
    () => (kanban ? null : { view: 'mine', ...tabQuery(tab, today), search, page, page_size: 20 }),
    [kanban, tab, today, search, page],
  );
  const openQuery = useMemo(
    () => (kanban ? { view: 'mine', statuses: 'not_started,in_progress,blocked,awaiting_approval', sort_by: 'deadline', search, page_size: 100 } : null),
    [kanban, search],
  );
  const doneQuery = useMemo(() => (kanban ? { view: 'mine', statuses: 'completed', sort_by: 'updated_at', sort_dir: 'desc', search, page_size: 25 } : null), [kanban, search]);

  const list = useTaskList(listQuery);
  const open = useTaskList(openQuery);
  const done = useTaskList(doneQuery);

  const s = summary;
  const isManager = Boolean(s?.has_team || s?.can_view_all);
  const tabs = [
    { id: 'today', label: 'Today', count: s?.my_due_today || undefined },
    { id: 'upcoming', label: 'Upcoming' },
    { id: 'overdue', label: 'Overdue', count: s?.my_overdue || undefined, badgeVariant: 'urgent' as const },
    { id: 'blocked', label: 'Blocked', count: s?.my_blocked || undefined, badgeVariant: 'warning' as const },
    { id: 'awaiting', label: 'Awaiting approval', count: s?.my_awaiting_approval || undefined },
    { id: 'completed', label: 'Completed' },
  ];

  const refreshBoard = () => {
    open.reload();
    done.reload();
    reloadSummary();
  };

  const kanbanRows = useMemo(() => [...(open.data?.data || []), ...(done.data?.data || [])], [open.data, done.data]);
  const loadError = kanban ? open.error || done.error : list.error;

  return (
    <PageContainer>
      <PageHeader
        title="My Tasks"
        icon={<CheckSquare className="h-5 w-5" />}
        actions={
          <div className="flex items-center gap-2">
            <ButtonGroup attached role="group" aria-label="Layout">
              <Button size="sm" variant={kanban ? 'secondary' : 'primary'} aria-pressed={!kanban} leftIcon={<List className="h-4 w-4" />} onClick={() => set({ mode: null })}>
                <span className="hidden sm:inline">List</span>
                <span className="sr-only sm:hidden">List view</span>
              </Button>
              <Button size="sm" variant={kanban ? 'primary' : 'secondary'} aria-pressed={kanban} leftIcon={<Columns3 className="h-4 w-4" />} onClick={() => set({ mode: 'kanban' })}>
                <span className="hidden sm:inline">Board</span>
                <span className="sr-only sm:hidden">Board view</span>
              </Button>
            </ButtonGroup>
            <Link href="/tasks/new">
              <Button size="sm" leftIcon={<Plus className="h-4 w-4" />}>
                New Task
              </Button>
            </Link>
          </div>
        }
      />
      <TasksNav />

      <StatGrid cols={4} className="grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Open" value={s?.my_open} subtext="Assigned to you" />
        <StatCard label="Overdue" value={s?.my_overdue} subtext="Past the deadline" variant={s?.my_overdue ? 'amber' : 'default'} />
        <StatCard label="Due today" value={s?.my_due_today} subtext="Deadline today (IST)" variant="primary" />
        <StatCard label="Blocked" value={s?.my_blocked} subtext="Waiting on a blocker" />
        <StatCard label="Awaiting approval" value={s?.my_awaiting_approval} subtext="With your manager" />
        <StatCard label="No update" value={s?.my_no_update} subtext="Post progress soon" variant={s?.my_no_update ? 'rose' : 'default'} />
      </StatGrid>

      <Card className="p-3.5 space-y-3 overflow-visible">
        {!kanban && (
          <div className="-mx-1 overflow-x-auto px-1">
            <Tabs variant="segmented" tabs={tabs} activeTab={tab} onChange={(id) => set({ tab: id === 'today' ? null : id })} className="w-max min-w-full" />
          </div>
        )}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="w-full sm:max-w-sm">
            <TaskSearchInput label="Search my tasks" placeholder="Task number or title" value={values.search} onSearch={(q) => set({ search: q })} />
          </div>
          {values.search && (
            <Button variant="ghost" size="sm" className="h-10" leftIcon={<X className="h-3.5 w-3.5" />} onClick={() => set({ search: null })}>
              Clear search
            </Button>
          )}
        </div>
      </Card>

      {loadError && (
        <InfoCallout variant="danger" title="Could not load your tasks">
          {loadError}
        </InfoCallout>
      )}

      {kanban ? (
        !open.data || !done.data ? (
          !loadError && <PageLoader rows={4} label="Loading board" />
        ) : (
          <>
            {open.data.total > open.data.data.length && (
              <InfoCallout variant="neutral">
                Showing the first {open.data.data.length} of {open.data.total} open tasks. Use the list view or search to find the rest.
              </InfoCallout>
            )}
            {kanbanRows.length === 0 ? (
              <EmptyState
                icon={CheckSquare}
                title={search ? 'No tasks match your search' : 'No tasks on your board'}
                description={search ? 'Try a different task number or title.' : 'Tasks assigned to you appear here. Drag a card to start, block or complete it.'}
              />
            ) : (
              <TaskKanban rows={kanbanRows} isManager={isManager} onChanged={refreshBoard} notify={push} />
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
          <TaskTable rows={list.data.data} />
          <TaskCards rows={list.data.data} />
          <TaskPagination page={list.data.page} totalPages={list.data.totalPages} total={list.data.total} onPage={(p) => set({ page: String(p) }, { resetPage: false })} />
        </div>
      )}

      <Toaster />
    </PageContainer>
  );
}

export default function MyTasksPage() {
  return (
    <Suspense fallback={<PageLoader rows={5} />}>
      <MyTasks />
    </Suspense>
  );
}
