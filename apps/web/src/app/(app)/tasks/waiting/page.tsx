'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Hourglass, RefreshCw } from 'lucide-react';
import { Badge, Button, Card, EmptyState, InfoCallout, PageContainer, PageHeader, PageLoader, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui';
import { api } from '@/lib/api';
import { formatTaskDate, formatTaskDateTime, type TaskBlockerStatus, type TaskPriority } from '@arihant/shared';
import { errorMessage } from '../_lib/task-lib';
import { BlockerBadge, DueText, FlagChip, PriorityBadge, TasksNav, blockerTypeLabel } from '../_lib/task-ui';

interface WaitingRow {
  id: string;
  task_id: string;
  blocker_type: string;
  description: string;
  status: TaskBlockerStatus;
  created_at: string;
  raised_after_deadline: boolean;
  expected_resolution_date: string | null;
  task_number: string;
  task_title: string;
  deadline: string | null;
  priority: TaskPriority;
  assignee_name: string | null;
  waiting_hours: number;
}

/** "under an hour", "5 hours", "2 days". */
const waitingFor = (hours: number) => {
  if (hours < 1) return 'under an hour';
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'}`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'}`;
};

/** Waiting for two days or more is shown in terracotta. */
const isLong = (hours: number) => hours >= 48;

export default function WaitingOnMePage() {
  const [rows, setRows] = useState<WaitingRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await api.get<WaitingRow[]>('/task-blockers/waiting-on-me'));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const onChange = () => load();
    window.addEventListener('tasks:changed', onChange);
    return () => window.removeEventListener('tasks:changed', onChange);
  }, [load]);

  return (
    <PageContainer>
      <PageHeader
        title="Waiting on Me"
        icon={<Hourglass className="h-5 w-5" />}
        actions={
          <Button size="sm" variant="secondary" isLoading={loading} disabled={loading} leftIcon={<RefreshCw className="h-4 w-4" />} onClick={load}>
            Refresh
          </Button>
        }
      />
      <TasksNav />

      <InfoCallout variant="info" title="Colleagues are blocked until you respond">
        Help them, then they mark the blocker resolved. Each item below is a task someone cannot finish without you.
      </InfoCallout>

      {error && (
        <InfoCallout variant="danger" title="Could not load the list">
          {error}
        </InfoCallout>
      )}

      {!rows ? (
        !error && <PageLoader rows={4} label="Loading" />
      ) : rows.length === 0 ? (
        <EmptyState icon={Hourglass} title="Nobody is waiting on you" description="When a colleague raises a blocker naming you as the person they depend on, it shows up here." />
      ) : (
        <div className={`space-y-3 transition-opacity ${loading ? 'opacity-60' : ''}`}>
          <p className="text-xs text-[#4A5568]">
            <strong className="text-[#14213D]">{rows.length}</strong> {rows.length === 1 ? 'colleague is' : 'colleagues are'} waiting · oldest first
          </p>

          {/* Desktop table */}
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Task</TableHead>
                  <TableHead>Waiting</TableHead>
                  <TableHead>For</TableHead>
                  <TableHead>What they need</TableHead>
                  <TableHead>Task deadline</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="max-w-[240px] align-top">
                      <div className="font-mono text-xs font-semibold text-[#0F5E63]">{r.task_number}</div>
                      <Link href={`/tasks/${r.task_id}`} className="block truncate font-medium text-[#14213D] hover:underline focus:underline focus:outline-none">
                        {r.task_title}
                      </Link>
                      <div className="mt-1">
                        <PriorityBadge priority={r.priority} />
                      </div>
                    </TableCell>
                    <TableCell className="align-top text-sm font-medium">{r.assignee_name || '—'}</TableCell>
                    <TableCell className="align-top whitespace-nowrap">
                      <div className={`text-sm font-semibold ${isLong(r.waiting_hours) ? 'text-[#9A3412]' : 'text-[#14213D]'}`}>{waitingFor(r.waiting_hours)}</div>
                      <div className="font-mono text-[11px] text-[#4A5568]">since {formatTaskDateTime(r.created_at)}</div>
                    </TableCell>
                    <TableCell className="max-w-[360px] align-top">
                      <div className="flex flex-wrap items-center gap-1">
                        <Badge variant="outline" size="sm">
                          {blockerTypeLabel(r.blocker_type)}
                        </Badge>
                        <BlockerBadge status={r.status} />
                        {r.raised_after_deadline && <FlagChip tone="danger">Raised after deadline</FlagChip>}
                      </div>
                      <p className="mt-1 text-xs text-[#14213D] whitespace-pre-wrap break-words line-clamp-3">{r.description}</p>
                      {r.expected_resolution_date && <p className="mt-0.5 text-[11px] text-[#4A5568]">Expected by {formatTaskDate(r.expected_resolution_date)}</p>}
                    </TableCell>
                    <TableCell className="align-top whitespace-nowrap">
                      <DueText deadline={r.deadline} open />
                    </TableCell>
                    <TableCell className="align-top text-right">
                      <Link href={`/tasks/${r.task_id}`}>
                        <Button size="xs" variant="secondary" rightIcon={<ArrowRight className="h-3 w-3" />}>
                          Open task
                        </Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobile cards */}
          <ul className="md:hidden space-y-3">
            {rows.map((r) => (
              <li key={r.id}>
                <Card className={`p-4 space-y-2.5 ${isLong(r.waiting_hours) ? 'border-l-[3px] border-l-[#9A3412]' : ''}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-[#14213D]">{r.assignee_name || 'A colleague'} is waiting</div>
                      <div className={`text-xs font-semibold ${isLong(r.waiting_hours) ? 'text-[#9A3412]' : 'text-[#4A5568]'}`}>for {waitingFor(r.waiting_hours)}</div>
                    </div>
                    <PriorityBadge priority={r.priority} />
                  </div>
                  <div className="min-w-0">
                    <span className="font-mono text-xs font-semibold text-[#0F5E63]">{r.task_number}</span>
                    <div className="truncate text-sm text-[#14213D]">{r.task_title}</div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    <Badge variant="outline" size="sm">
                      {blockerTypeLabel(r.blocker_type)}
                    </Badge>
                    <BlockerBadge status={r.status} />
                    {r.raised_after_deadline && <FlagChip tone="danger">Raised after deadline</FlagChip>}
                  </div>
                  <p className="rounded-lg border border-[#ECE9E2] bg-[#FBFAF7] px-3 py-2 text-xs text-[#14213D] whitespace-pre-wrap break-words">{r.description}</p>
                  <div className="flex items-end justify-between gap-3">
                    <DueText deadline={r.deadline} open />
                    <span className="font-mono text-[11px] text-[#4A5568]">since {formatTaskDate(r.created_at)}</span>
                  </div>
                  <Link href={`/tasks/${r.task_id}`} className="block">
                    <Button variant="secondary" fullWidth className="h-10" rightIcon={<ArrowRight className="h-4 w-4" />}>
                      Open task
                    </Button>
                  </Link>
                </Card>
              </li>
            ))}
          </ul>
        </div>
      )}
    </PageContainer>
  );
}
