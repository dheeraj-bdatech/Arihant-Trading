'use client';

/**
 * Three bar lists above the task board, computed from the rows the board already shows (no extra request):
 * open tasks by status, by when they are due, and by priority.
 */
import React from 'react';
import { TASK_PRIORITIES, TASK_PRIORITY_LABELS, TASK_STATUS_LABELS } from '@arihant/shared';
import { BarList, Card, SectionHeader, daysFromToday, type BarListItem } from '@/components/ui';
import type { TaskRow } from './task-lib';

const OPEN = ['not_started', 'in_progress', 'blocked', 'awaiting_approval'] as const;
const WORKING = ['not_started', 'in_progress', 'blocked'];

export const TaskCharts: React.FC<{ rows: TaskRow[] }> = ({ rows }) => {
  const open = rows.filter((r) => (OPEN as readonly string[]).includes(r.status));
  if (!open.length) return null;
  const count = (test: (r: TaskRow) => boolean, from: TaskRow[] = open) => from.filter(test).length;

  const status: BarListItem[] = OPEN.map((s) => ({ key: s, label: TASK_STATUS_LABELS[s], value: count((r) => r.status === s) }));

  // When the work is due: still-to-do tasks only (awaiting approval is already handed in).
  const working = open.filter((r) => WORKING.includes(r.status));
  const bucket = (r: TaskRow) => {
    if (r.display_status === 'overdue') return 'overdue';
    if (!r.deadline) return 'none';
    const d = daysFromToday(r.deadline) ?? 0;
    return d <= 0 ? 'today' : d <= 7 ? 'week' : 'later';
  };
  const due: BarListItem[] = [
    { key: 'overdue', label: 'Overdue' },
    { key: 'today', label: 'Due by today' },
    { key: 'week', label: 'Next 7 days' },
    { key: 'later', label: 'Later' },
    { key: 'none', label: 'No deadline' },
  ].map((b) => ({ ...b, value: count((r) => bucket(r) === b.key, working) }));

  const priority: BarListItem[] = [...TASK_PRIORITIES].reverse().map((p) => ({ key: p, label: TASK_PRIORITY_LABELS[p], value: count((r) => r.priority === p) }));

  const chart = (title: string, description: string, items: BarListItem[]) => (
    <Card padding="md" className="space-y-2">
      <SectionHeader title={title} description={description} />
      <BarList items={items} label={title} />
    </Card>
  );
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {chart('Open by status', `${open.length} open on this board`, status)}
      {chart('When it is due', 'Tasks still to do', due)}
      {chart('By priority', 'Open tasks', priority)}
    </div>
  );
};
