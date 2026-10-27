'use client';

/**
 * The task views that live as tabs on My tasks / All tasks (`/tasks?section=`): the board itself, Recurring and
 * Leave & holidays. (Performance has its own area: /performance.) Each section draws its own filter controls
 * into the shared toolbar card (View menu first, section tabs underneath), so the frame never moves when
 * switching tabs. The old routes /tasks/templates and /tasks/calendar redirect here, keeping their query string.
 */
import React, { Suspense, createContext, useContext, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { CalendarDays, CheckSquare, Repeat, Users } from 'lucide-react';
import { TASK_VIEWS_FOR_EVERYONE } from '@arihant/shared';
import { Card, PageLoader, Tabs, type TabItem } from '@/components/ui';
import { TaskViewMenu, useTaskViews, type TaskBoardScope } from './task-ui';

export type TaskSection = 'tasks' | 'recurring' | 'leave';
export const TASK_SECTIONS: TaskSection[] = ['tasks', 'recurring', 'leave'];
/** Boards that carry the section tabs; the review queues (blockers, approvals) do not. */
export const SECTION_SCOPES: TaskBoardScope[] = ['mine', 'team'];

export const taskSectionHref = (section: TaskSection, scope: TaskBoardScope = 'mine') => {
  const q = new URLSearchParams();
  if (scope !== 'mine') q.set('scope', scope);
  if (section !== 'tasks') q.set('section', section);
  const qs = q.toString();
  return qs ? `/tasks?${qs}` : '/tasks';
};

interface SectionCtx {
  scope: TaskBoardScope;
  onScope: (scope: TaskBoardScope) => void;
  section: TaskSection;
  onSection: (section: TaskSection) => void;
}
const TaskSectionContext = createContext<SectionCtx | null>(null);
export const TaskSectionProvider = TaskSectionContext.Provider;

/**
 * The toolbar card every section starts with: View menu + the section's own controls (`children`), an optional
 * extra row (`below`, e.g. a period picker), then the section tabs on My / All tasks.
 */
export const TaskToolbar: React.FC<{ children?: React.ReactNode; below?: React.ReactNode }> = ({ children, below }) => {
  const ctx = useContext(TaskSectionContext);
  const { views, summary: s } = useTaskViews();
  const n = (v?: number) => (v && v > 0 ? v : undefined);
  const tabs: TabItem[] = ctx
    ? [
        {
          id: 'tasks',
          label: ctx.scope === 'team' ? (s?.can_view_all && !s?.has_team ? 'All tasks' : 'Team tasks') : 'My tasks',
          icon: ctx.scope === 'team' ? <Users className="h-3.5 w-3.5" /> : <CheckSquare className="h-3.5 w-3.5" />,
          count: ctx.scope === 'mine' ? n(s?.my_open) : undefined,
        },
        { id: 'recurring', label: 'Recurring', icon: <Repeat className="h-3.5 w-3.5" /> },
        { id: 'leave', label: 'Leave & holidays', icon: <CalendarDays className="h-3.5 w-3.5" /> },
      ]
    : [];
  const showTabs = Boolean(ctx && SECTION_SCOPES.includes(ctx.scope));
  // The View menu only shows when there is another board or manager page to switch to (see TaskViewMenu).
  const hasViewMenu = [...views].some((v) => !TASK_VIEWS_FOR_EVERYONE.includes(v));
  const hasControls = React.Children.toArray(children).length > 0;
  return (
    <Card className="relative z-20 overflow-visible p-0">
      {(hasViewMenu || hasControls) && (
        <div className="flex flex-col gap-2 border-b border-[#ECE9E2] p-3 last:border-b-0 md:flex-row md:items-center">
          <TaskViewMenu active={ctx?.scope} onScope={ctx?.onScope} className="self-start md:self-auto" />
          {children}
        </div>
      )}
      {below && <div className="border-b border-[#ECE9E2] px-3 py-2.5 last:border-b-0">{below}</div>}
      {showTabs && ctx && (
        <div className="px-3 pt-2">
          <Tabs variant="underline" tabs={tabs} activeTab={ctx.section} onChange={(id) => ctx.onSection(id as TaskSection)} className="border-b-0" />
        </div>
      )}
    </Card>
  );
};

function Redirect({ section }: { section: TaskSection }) {
  const router = useRouter();
  const params = useSearchParams();
  useEffect(() => {
    const q = new URLSearchParams(params.toString());
    q.set('section', section);
    router.replace(`/tasks?${q.toString()}`);
  }, [router, params, section]);
  return <PageLoader rows={3} />;
}

/** An old task sub-page: forwards to its tab on /tasks with the same query string. */
export const TaskSectionRedirect: React.FC<{ section: TaskSection }> = ({ section }) => (
  <Suspense fallback={<PageLoader rows={3} />}>
    <Redirect section={section} />
  </Suspense>
);
