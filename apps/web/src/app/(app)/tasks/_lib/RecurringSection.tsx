'use client';

/**
 * Recurring (a tab on /tasks, Blueprint §38 daily / weekly / monthly / recurring tasks): every series you can see,
 * kept minimal — two charts (by frequency, what needs attention), then one short table. A row opens the series
 * (/tasks/templates/:id) where it is edited, paused or ended.
 */
import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Layers, Plus, Repeat, Search, X } from 'lucide-react';
import {
  BarList,
  Button,
  Card,
  EmptyState,
  FilterMenu,
  InfoCallout,
  PageLoader,
  SectionHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  ToolbarActions,
  type BarListItem,
} from '@/components/ui';
import { api } from '@/lib/api';
import { TASK_RECURRENCE_LABELS, TASK_RECURRENCE_TYPES, type TaskTemplateStatus } from '@arihant/shared';
import { errorMessage } from './task-lib';
import { DueText, FlagChip, useUrlFilters } from './task-ui';
import { TemplateStatusBadge, describeDue } from './TaskForm';
import { NewTaskButton } from './NewTaskModal';
import { TaskToolbar } from './TaskSections';

interface TemplateRow {
  id: string;
  title: string;
  status: TaskTemplateStatus;
  needs_reassignment: boolean;
  schedule: string;
  recurrence_type: string;
  assignee_name: string | null;
  assignee_active: boolean | null;
  category_name: string | null;
  instance_count: number;
  open_overdue_count: number;
  next_deadline: string | null;
  due_offset_days: number;
  due_time: string;
}

const FILTER_KEYS = ['status', 'search'] as const;
type StatusTab = 'active' | 'paused' | 'ended' | 'all';
const STATUS_LABELS: Record<StatusTab, string> = { active: 'Active', paused: 'Paused', ended: 'Ended', all: 'All statuses' };

export function RecurringSection() {
  const router = useRouter();
  const { values, set } = useUrlFilters(FILTER_KEYS);
  const tab: StatusTab = (['active', 'paused', 'ended', 'all'] as StatusTab[]).includes(values.status as StatusTab) ? (values.status as StatusTab) : 'active';
  const [rows, setRows] = useState<TemplateRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    let live = true;
    const load = () =>
      api
        .get<TemplateRow[]>('/task-templates')
        .then((r) => live && setRows(r))
        .catch((e) => live && setError(errorMessage(e, 'Could not load recurring tasks.')));
    load();
    window.addEventListener('tasks:changed', load);
    return () => {
      live = false;
      window.removeEventListener('tasks:changed', load);
    };
  }, []);

  const counts = useMemo(() => {
    const c: Record<StatusTab, number> = { active: 0, paused: 0, ended: 0, all: 0 };
    for (const r of rows || []) {
      c[r.status as StatusTab] = (c[r.status as StatusTab] || 0) + 1;
      c.all += 1;
    }
    return c;
  }, [rows]);
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (rows || []).filter((r) => (tab === 'all' || r.status === tab) && (!q || r.title.toLowerCase().includes(q) || (r.assignee_name || '').toLowerCase().includes(q)));
  }, [rows, tab, search]);

  const byFrequency: BarListItem[] = TASK_RECURRENCE_TYPES.filter((k) => k !== 'one_time').map((k) => ({
    key: k,
    label: TASK_RECURRENCE_LABELS[k],
    value: (rows || []).filter((r) => r.status === 'active' && r.recurrence_type === k).length,
  }));
  const attention: BarListItem[] = [
    { key: 'reassign', label: 'Needs a new assignee', value: (rows || []).filter((r) => r.needs_reassignment || r.assignee_active === false).length, detail: 'Paused when its assignee was deactivated' },
    { key: 'overdue', label: 'Has overdue tasks', value: (rows || []).filter((r) => r.open_overdue_count > 0).length },
    { key: 'paused', label: 'Paused', value: counts.paused },
  ];

  return (
    <>
      <ToolbarActions>
        <NewTaskButton size="sm" prefill={{ frequency: 'weekly' }} leftIcon={<Plus className="h-4 w-4" />}>
          New recurring task
        </NewTaskButton>
      </ToolbarActions>

      <TaskToolbar>
        <div className="relative w-full min-w-[200px] md:w-auto md:flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6B7280]" aria-hidden />
          <input
            type="search"
            aria-label="Search recurring tasks"
            placeholder="Search by title or assignee…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 w-full rounded-lg border border-[#C9C4B8] bg-white pl-9 pr-9 text-xs text-[#14213D] placeholder:text-[#6B7280] focus:border-[#0F5E63] focus:outline-none focus:ring-2 focus:ring-[#0F5E63]/15"
          />
          {search && (
            <button type="button" aria-label="Clear search" onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#6B7280] hover:text-[#14213D]">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <FilterMenu
          label="Status"
          icon={<Layers />}
          neutralKeys={['active']}
          align="right"
          options={(['active', 'paused', 'ended', 'all'] as StatusTab[]).map((k) => ({
            key: k,
            label: STATUS_LABELS[k],
            count: rows ? counts[k] : undefined,
            active: tab === k,
            onSelect: () => set({ status: k === 'active' ? null : k }),
          }))}
        />
      </TaskToolbar>

      {error && <InfoCallout variant="danger" title="Could not load recurring tasks">{error}</InfoCallout>}

      {!rows ? (
        !error && <PageLoader rows={4} label="Loading recurring tasks" />
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            <Card padding="md" className="space-y-2">
              <SectionHeader title="Active series by frequency" description={`${counts.active} active · ${counts.all} in total`} />
              <BarList items={byFrequency} label="Active series by frequency" emptyText="No active recurring series." />
            </Card>
            <Card padding="md" className="space-y-2">
              <SectionHeader title="Needs attention" description="Series a manager should look at." />
              <BarList items={attention} label="Recurring series needing attention" labelWidth="50%" emptyText="Every series is running normally." />
            </Card>
          </div>

          {visible.length === 0 ? (
            <EmptyState
              icon={Repeat}
              title={search.trim() ? 'No recurring tasks match' : tab === 'all' ? 'No recurring tasks yet' : `No ${STATUS_LABELS[tab].toLowerCase()} recurring tasks`}
              description="A recurring task creates a fresh task every day, week or month — weekly reports, monthly stock checks, daily follow-ups."
              action={<NewTaskButton prefill={{ frequency: 'weekly' }} leftIcon={<Plus className="h-4 w-4" />}>New recurring task</NewTaskButton>}
            />
          ) : (
            <Card className="overflow-hidden p-0">
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Series</TableHead>
                      <TableHead>Schedule</TableHead>
                      <TableHead>Assignee</TableHead>
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
                          <div className="flex flex-wrap items-center gap-1 text-[11px] text-[#4A5568]">
                            {t.category_name}
                            {(t.needs_reassignment || t.assignee_active === false) && <FlagChip tone="danger">Needs reassignment</FlagChip>}
                            {t.open_overdue_count > 0 && <FlagChip>{t.open_overdue_count} overdue</FlagChip>}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="font-medium text-[#14213D]">{t.schedule}</div>
                          <div className="text-[11px] text-[#4A5568]">{describeDue(t.due_offset_days, t.due_time)}</div>
                        </TableCell>
                        <TableCell>
                          <span className={t.assignee_active === false ? 'text-[#881337] line-through' : 'text-[#14213D]'}>{t.assignee_name || '—'}</span>
                        </TableCell>
                        <TableCell>{t.status === 'active' ? <DueText deadline={t.next_deadline} open compact /> : <span className="text-[#6B7280]">—</span>}</TableCell>
                        <TableCell className="text-right font-mono tabular-nums">{t.instance_count}</TableCell>
                        <TableCell>
                          <TemplateStatusBadge status={t.status} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <ul className="divide-y divide-[#ECE9E2] md:hidden">
                {visible.map((t) => (
                  <li key={t.id}>
                    <Link href={`/tasks/templates/${t.id}`} className="block space-y-1 px-4 py-3">
                      <div className="flex items-start justify-between gap-2">
                        <span className="min-w-0 break-words font-semibold text-[#14213D]">{t.title}</span>
                        <TemplateStatusBadge status={t.status} />
                      </div>
                      <div className="text-xs font-medium text-[#0F5E63]">{t.schedule}</div>
                      <div className="text-[11px] text-[#4A5568]">
                        {t.assignee_name || '—'} · {t.instance_count} task(s)
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </>
  );
}
