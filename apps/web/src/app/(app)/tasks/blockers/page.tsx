'use client';

/** Blocker Review Queue (§12.5): pending blockers routed to me with age, SLA indicator, flags and quick decisions. */
import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Ban, CheckCircle2, ExternalLink, Flag, ShieldCheck } from 'lucide-react';
import { Badge, Button, Card, EmptyState, InfoCallout, PageContainer, PageHeader, PageLoader, Tabs } from '@/components/ui';
import { api } from '@/lib/api';
import { formatTaskDateTime } from '@arihant/shared';
import { errorMessage, notifyTasksChanged, useTaskSummary } from '../_lib/task-lib';
import { DueText, FlagChip, PriorityBadge, TaskConflictCallout, TasksNav, blockerTypeLabel, useToaster } from '../_lib/task-ui';
import { TaskActionDialog, type ActionTask, type TaskDialogAction } from '../_lib/TaskActions';

interface PendingBlocker {
  id: string;
  task_id: string;
  blocker_type: string;
  description: string;
  created_at: string;
  raised_after_deadline: boolean;
  vendor_name: string | null;
  portal_name: string | null;
  approval_pending_from: string | null;
  expected_resolution_date: string | null;
  requested_new_deadline: string | null;
  task_number: string;
  task_title: string;
  deadline: string | null;
  priority: any;
  task_version: number;
  assigned_to: string;
  assignee_name: string;
  dependency_user_name: string | null;
  dependency_customer_name: string | null;
  extension_count: number;
  same_type_count: number;
  blocker_count: number;
  age_hours: number;
  sla_hours: number;
  sla_breached: boolean;
  repeated_flag: boolean;
  is_task_overdue: boolean;
}

const age = (h: number) => (h < 24 ? `${h}h` : `${Math.floor(h / 24)}d ${h % 24}h`);

const toActionTask = (b: PendingBlocker): ActionTask => ({
  id: b.task_id,
  task_number: b.task_number,
  title: b.task_title,
  version: b.task_version,
  status: 'blocked',
  deadline: b.deadline,
  progress_percent: 0,
  evidence_required: false,
  approval_required: false,
  assigned_to: b.assigned_to,
  customer_id: null,
  is_overdue: b.is_task_overdue,
  start_date: null,
  open_blocker: { id: b.id, status: 'pending_review', blocker_type: b.blocker_type as any, raised_at: b.created_at, raised_after_deadline: b.raised_after_deadline, raised_by: b.assigned_to, dependency_user_id: null },
});

export default function BlockerQueuePage() {
  const { summary } = useTaskSummary();
  const { push, Toaster } = useToaster();
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const [rows, setRows] = useState<PendingBlocker[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [dialog, setDialog] = useState<{ action: TaskDialogAction; task: ActionTask } | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setRows(await api.get<PendingBlocker[]>('/task-blockers/pending', { scope }));
      setConflict(false);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [scope]);

  useEffect(() => {
    load();
  }, [load]);

  const adminLike = Boolean(summary?.can_view_all);

  return (
    <PageContainer>
      <PageHeader title="Blocker Reviews" icon={<ShieldCheck className="h-5 w-5" />} />
      <TasksNav />
      <InfoCallout variant="info" title="Genuine dependency or poor execution?">
        Accept a genuine dependency (extend the deadline now, or pause the clock until it is resolved), or reject it — the task returns to its previous status and any delay counts as unapproved. Time a blocker waits for your review is never counted against the employee.
      </InfoCallout>
      {adminLike && (
        <Tabs
          variant="segmented"
          size="sm"
          tabs={[
            { id: 'mine', label: 'Routed to me' },
            { id: 'all', label: 'All pending' },
          ]}
          activeTab={scope}
          onChange={(id) => setScope(id as 'mine' | 'all')}
        />
      )}
      {conflict && <TaskConflictCallout onRefresh={load} />}
      {error && <InfoCallout variant="danger" title="Could not load blockers">{error}</InfoCallout>}
      {!rows ? (
        <PageLoader rows={4} />
      ) : rows.length === 0 ? (
        <EmptyState icon={CheckCircle2} title="No blockers waiting for you" description="When someone in your team raises a blocker it appears here for a decision." />
      ) : (
        <div className="space-y-3">
          {rows.map((b) => (
            <Card key={b.id} className={`p-4 space-y-3 ${b.sla_breached ? 'border-[#9A3412]/40' : ''}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <Link href={`/tasks/${b.task_id}`} className="font-mono text-xs font-semibold text-[#0F5E63] hover:underline inline-flex items-center gap-1">
                    {b.task_number} <ExternalLink className="h-3 w-3" />
                  </Link>
                  <div className="font-medium text-[#14213D] break-words">{b.task_title}</div>
                  <div className="text-xs text-[#4A5568]">{b.assignee_name}</div>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <PriorityBadge priority={b.priority} />
                  <Badge variant={b.sla_breached ? 'urgent' : 'warning'} size="sm">
                    Waiting {age(b.age_hours)} {b.sla_breached ? `· over ${b.sla_hours}h SLA` : ''}
                  </Badge>
                </div>
              </div>
              <div className="rounded-lg border border-[#ECE9E2] bg-[#FBFAF7] p-3 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Flag className="h-3.5 w-3.5 text-[#9A3412]" />
                  <span className="text-sm font-semibold text-[#14213D]">{blockerTypeLabel(b.blocker_type)}</span>
                  {b.raised_after_deadline && <FlagChip>Raised after deadline</FlagChip>}
                  {b.repeated_flag && <FlagChip tone="danger">Same blocker raised {b.same_type_count}×</FlagChip>}
                  {b.extension_count >= 2 && <FlagChip>{b.extension_count} extensions so far</FlagChip>}
                </div>
                <p className="text-sm text-[#14213D] whitespace-pre-wrap break-words">{b.description}</p>
                <p className="text-[11px] text-[#4A5568]">
                  Raised {formatTaskDateTime(b.created_at)}
                  {b.dependency_user_name ? ` · waiting on ${b.dependency_user_name}` : ''}
                  {b.dependency_customer_name ? ` · customer ${b.dependency_customer_name}` : ''}
                  {b.vendor_name ? ` · vendor ${b.vendor_name}` : ''}
                  {b.portal_name ? ` · portal ${b.portal_name}` : ''}
                  {b.approval_pending_from ? ` · approval pending from ${b.approval_pending_from}` : ''}
                  {b.expected_resolution_date ? ` · expected resolution ${b.expected_resolution_date.split('-').reverse().join('-')}` : ''}
                  {b.requested_new_deadline ? ` · asks for ${formatTaskDateTime(b.requested_new_deadline)}` : ''}
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs text-[#4A5568] flex items-center gap-2">
                  Deadline <DueText deadline={b.deadline} open compact />
                  {b.is_task_overdue && <Badge variant="urgent" size="sm">Overdue</Badge>}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" leftIcon={<Ban className="h-4 w-4" />} onClick={() => setDialog({ action: 'reject_blocker', task: toActionTask(b) })}>
                    Reject
                  </Button>
                  <Button size="sm" leftIcon={<CheckCircle2 className="h-4 w-4" />} onClick={() => setDialog({ action: 'accept_blocker', task: toActionTask(b) })}>
                    Accept
                  </Button>
                  <Link href={`/tasks/${b.task_id}`}>
                    <Button size="sm" variant="ghost">Reassign / escalate…</Button>
                  </Link>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
      <TaskActionDialog
        action={dialog?.action ?? null}
        task={dialog?.task ?? null}
        onClose={() => setDialog(null)}
        onDone={(_, msg) => {
          setDialog(null);
          push('success', msg);
          notifyTasksChanged();
          load();
        }}
        onConflict={() => setConflict(true)}
      />
      <Toaster />
    </PageContainer>
  );
}
