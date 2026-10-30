'use client';

/** Blocker Review Queue (§12.5): pending blockers routed to me with age, SLA indicator, flags and quick decisions. */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Ban, CheckCircle2, ExternalLink, Eye, Flag, Search, ShieldCheck } from 'lucide-react';
import { Badge, Button, Card, EmptyState, FilterMenu, InfoCallout, PageContainer, PageHeader, PageLoader } from '@/components/ui';
import { api } from '@/lib/api';
import { formatTaskDateTime } from '@arihant/shared';
import { errorMessage, notifyTasksChanged, useTaskSummary } from '../_lib/task-lib';
import { DueText, FlagChip, PriorityBadge, TaskConflictCallout, TaskViewMenu, blockerTypeLabel, useToaster } from '../_lib/task-ui';
import { TaskActionDialog, type ActionTask, type TaskDialogAction } from '../_lib/TaskActions';
import { blockerActionTask as toActionTask, waitingAge as age, type PendingBlocker } from '../_lib/QueueBoards';

export default function BlockerQueuePage() {
  const { summary } = useTaskSummary();
  const { push, Toaster } = useToaster();
  // ?scope=all (the command dashboard's "Blockers to decide") opens every pending blocker; the API allows it to admin-like roles only
  const searchParams = useSearchParams();
  const [scope, setScope] = useState<'mine' | 'all'>(() => (searchParams.get('scope') === 'all' ? 'all' : 'mine'));
  const [search, setSearch] = useState('');
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
  const q = search.trim().toLowerCase();
  const visible = useMemo(
    () => (rows || []).filter((b) => !q || [b.task_number, b.task_title, b.assignee_name].some((f) => f?.toLowerCase().includes(q))),
    [rows, q],
  );
  const hasActiveFilters = Boolean(q) || scope !== 'mine';

  return (
    <PageContainer>
      <PageHeader title="Blocker Reviews" icon={<ShieldCheck className="h-5 w-5" />} />
      {/* One filter row: View, search the loaded queue, plus scope for management/admin. */}
      <Card padding="sm" className="relative z-20 overflow-visible border-[#DCD8CE]">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
          <TaskViewMenu />
          <div className="relative w-full min-w-[200px] lg:w-auto lg:flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6B7280]" aria-hidden />
            <input
              type="search"
              aria-label="Search blockers"
              placeholder="Search task no., title or assignee…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 w-full rounded-lg border border-[#C9C4B8] bg-white pl-9 pr-3 text-xs text-[#14213D] placeholder:text-[#6B7280] focus:border-[#0F5E63] focus:outline-none focus:ring-2 focus:ring-[#0F5E63]/15"
            />
          </div>
          {(adminLike || hasActiveFilters) && (
            <div className="flex flex-wrap items-center gap-2 lg:flex-nowrap">
              {adminLike && (
                <FilterMenu
                  label="Show"
                  icon={<Eye />}
                  neutralKeys={['mine']}
                  align="right"
                  options={[
                    { key: 'mine', label: 'Routed to me' },
                    { key: 'all', label: 'All pending' },
                  ].map((o) => ({ ...o, active: scope === o.key, onSelect: () => setScope(o.key as 'mine' | 'all') }))}
                />
              )}
              {hasActiveFilters && (
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => {
                    setSearch('');
                    setScope('mine');
                  }}
                  className="text-xs text-[#4A5568] hover:text-[#881337]"
                >
                  Clear
                </Button>
              )}
            </div>
          )}
        </div>
      </Card>
      <InfoCallout variant="info" title="Genuine dependency or poor execution?">
        Accept a genuine dependency (extend the deadline now, or pause the clock until it is resolved), or reject it — the task returns to its previous status and any delay counts as unapproved. Time a blocker waits for your review is never counted against the employee.
      </InfoCallout>
      {conflict && <TaskConflictCallout onRefresh={load} />}
      {error && <InfoCallout variant="danger" title="Could not load blockers">{error}</InfoCallout>}
      {!rows ? (
        <PageLoader rows={4} />
      ) : rows.length === 0 ? (
        <EmptyState icon={CheckCircle2} title="No blockers waiting for you" description="When someone in your team raises a blocker it appears here for a decision." />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={Search}
          title="No blockers match your search"
          description="Try a different task number, title or assignee name."
          action={
            <Button variant="secondary" onClick={() => setSearch('')}>
              Clear search
            </Button>
          }
        />
      ) : (
        <div className="space-y-3">
          {visible.map((b) => (
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
                {/* phones: Reject / Accept share a row as big thumb targets, the escalation link below */}
                <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap [&_button]:h-10 sm:[&_button]:h-8">
                  <Button size="sm" variant="secondary" leftIcon={<Ban className="h-4 w-4" />} onClick={() => setDialog({ action: 'reject_blocker', task: toActionTask(b) })}>
                    Reject
                  </Button>
                  <Button size="sm" leftIcon={<CheckCircle2 className="h-4 w-4" />} onClick={() => setDialog({ action: 'accept_blocker', task: toActionTask(b) })}>
                    Accept
                  </Button>
                  <Link href={`/tasks/${b.task_id}`} className="col-span-2">
                    <Button size="sm" variant="ghost" className="w-full sm:w-auto">
                      Reassign / escalate…
                    </Button>
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
