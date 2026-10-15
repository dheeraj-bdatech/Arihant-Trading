'use client';

import React, { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus, Repeat, Search, X } from 'lucide-react';
import {
  Button,
  Card,
  EmptyState,
  InfoCallout,
  Input,
  PageContainer,
  PageHeader,
  PageLoader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
} from '@/components/ui';
import { api } from '@/lib/api';
import { formatTaskDate, type TaskPriority, type TaskTemplateStatus } from '@arihant/shared';
import { errorMessage } from '../_lib/task-lib';
import { DueText, FlagChip, PriorityBadge, TasksNav, useUrlFilters } from '../_lib/task-ui';
import { TemplateStatusBadge, describeDue } from '../_lib/TaskForm';

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

const FILTER_KEYS = ['status', 'search'] as const;
type StatusTab = 'active' | 'paused' | 'ended' | 'all';
const TAB_LABELS: Record<StatusTab, string> = { active: 'Active', paused: 'Paused', ended: 'Ended', all: 'All' };

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
  const { values, set } = useUrlFilters(FILTER_KEYS);
  const tab: StatusTab = (['active', 'paused', 'ended', 'all'] as StatusTab[]).includes(values.status as StatusTab) ? (values.status as StatusTab) : 'active';
  const [rows, setRows] = useState<TemplateListRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState(values.search);

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

  // Debounced search → URL (shareable, survives refresh).
  useEffect(() => {
    if (search === values.search) return;
    const t = window.setTimeout(() => set({ search: search.trim() || null }), 350);
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
  const attention = useMemo(() => (rows || []).filter((r) => r.needs_reassignment || r.assignee_active === false).length, [rows]);
  const visible = useMemo(() => (rows || []).filter((r) => tab === 'all' || r.status === tab), [rows, tab]);

  return (
    <PageContainer>
      <PageHeader
        title="Recurring Tasks"
        icon={<Repeat className="h-5 w-5" />}
        actions={
          <Link href="/tasks/new?frequency=weekly">
            <Button size="sm" leftIcon={<Plus className="h-4 w-4" />}>
              New recurring task
            </Button>
          </Link>
        }
      />
      <TasksNav />

      <Card className="p-3.5 space-y-3 overflow-visible">
        <div className="flex flex-col md:flex-row md:items-end gap-3">
          <div className="overflow-x-auto -mx-1 px-1">
            <Tabs
              variant="segmented"
              tabs={(['active', 'paused', 'ended', 'all'] as StatusTab[]).map((s) => ({
                id: s,
                label: TAB_LABELS[s],
                count: rows ? counts[s] : undefined,
                badgeVariant: s === 'paused' && attention ? 'urgent' : undefined,
              }))}
              activeTab={tab}
              onChange={(id) => set({ status: id === 'active' ? null : id })}
            />
          </div>
          <div className="relative md:ml-auto md:w-80">
            <Input
              id="template-search"
              aria-label="Search recurring tasks by title"
              placeholder="Search by title…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 pr-9"
            />
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8A8578]" aria-hidden />
            {search && (
              <button type="button" aria-label="Clear search" onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8A8578] hover:text-[#14213D]">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
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
          title={values.search ? 'No recurring tasks match your search' : tab === 'all' ? 'No recurring tasks yet' : `No ${TAB_LABELS[tab].toLowerCase()} recurring tasks`}
          description={
            values.search
              ? 'Try a different title or clear the search.'
              : 'Recurring tasks generate a fresh task every day, week or month — weekly reports, monthly stock checks, daily follow-ups.'
          }
          action={
            values.search ? (
              <Button variant="secondary" onClick={() => setSearch('')}>
                Clear search
              </Button>
            ) : (
              <Link href="/tasks/new?frequency=weekly">
                <Button leftIcon={<Plus className="h-4 w-4" />}>New recurring task</Button>
              </Link>
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
