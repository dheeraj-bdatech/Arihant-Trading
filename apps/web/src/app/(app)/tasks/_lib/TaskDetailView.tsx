'use client';

/**
 * Task detail (§12.3): status + overdue + delay badges, original vs current deadline, links, supporting docs,
 * the activity timeline, a progress box (comment, % slider, photos from the phone camera) and the actions this
 * user may take right now (server-computed `allowed_actions`; every call is re-checked server-side).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  ArrowRightLeft,
  Ban,
  Camera,
  CheckCircle2,
  Clock,
  FilePlus2,
  Flag,
  Paperclip,
  Pencil,
  Play,
  Repeat,
  RotateCcw,
  Send,
  ShieldAlert,
  Trash2,
  Undo2,
  Wrench,
} from 'lucide-react';
import { Badge, Button, Card, InfoCallout, Input, Modal, PageLoader, RowMenu, Select, Textarea } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { canOpen } from '@/lib/route-access';
import {
  TASK_BLOCKER_STATUS_LABELS,
  TASK_DEADLINE_SOURCE_LABELS,
  TASK_PRIORITIES,
  TASK_PRIORITY_LABELS,
  TASK_REASSIGN_REASON_LABELS,
  describeRecurrence,
  formatTaskDateTime,
  minutesToDays,
  type TaskDeadlineChangeSource,
  type TaskReassignReason,
} from '@arihant/shared';
import { errorMessage, fieldErrors, isConflict, notifyTasksChanged, useTaskCategories, type TaskAttachment, type TaskDetail } from './task-lib';
import {
  ActivityTimeline,
  BlockerBadge,
  DateTime,
  DelayBadge,
  DueText,
  FileList,
  FileViewer,
  FlagChip,
  Meta,
  PriorityBadge,
  ProgressBar,
  TaskConflictCallout,
  TaskStatusBadges,
  blockerTypeLabel,
  useToaster,
} from './task-ui';
import { TaskActionDialog, uploadTaskFiles, type TaskDialogAction } from './TaskActions';
import { LinkPicker } from './pickers';

const PRIMARY: { action: TaskDialogAction; label: string; icon: React.ReactNode; variant?: 'primary' | 'secondary' | 'danger' }[] = [
  { action: 'start', label: 'Start', icon: <Play className="h-4 w-4" /> },
  { action: 'complete', label: 'Complete', icon: <CheckCircle2 className="h-4 w-4" /> },
  { action: 'approve', label: 'Approve', icon: <CheckCircle2 className="h-4 w-4" /> },
  { action: 'accept_blocker', label: 'Accept blocker', icon: <CheckCircle2 className="h-4 w-4" /> },
  { action: 'resolve_blocker', label: 'Blocker resolved', icon: <CheckCircle2 className="h-4 w-4" />, variant: 'secondary' },
  { action: 'raise_blocker', label: 'Raise blocker', icon: <Flag className="h-4 w-4" />, variant: 'secondary' },
  { action: 'send_back', label: 'Send back', icon: <Undo2 className="h-4 w-4" />, variant: 'secondary' },
  { action: 'reject_blocker', label: 'Reject blocker', icon: <Ban className="h-4 w-4" />, variant: 'secondary' },
];

const SECONDARY: { action: TaskDialogAction | 'edit' | 'delete'; label: string; icon: React.ReactNode; danger?: boolean }[] = [
  { action: 'extend_deadline', label: 'Extend deadline', icon: <Clock className="h-4 w-4" /> },
  { action: 'reassign', label: 'Reassign', icon: <ArrowRightLeft className="h-4 w-4" /> },
  { action: 'escalate', label: 'Escalate', icon: <ShieldAlert className="h-4 w-4" /> },
  { action: 'edit', label: 'Edit details', icon: <Pencil className="h-4 w-4" /> },
  { action: 'withdraw_blocker', label: 'Withdraw blocker', icon: <Undo2 className="h-4 w-4" /> },
  { action: 'reopen', label: 'Reopen', icon: <RotateCcw className="h-4 w-4" />, danger: true },
  { action: 'cancel', label: 'Cancel task', icon: <Ban className="h-4 w-4" />, danger: true },
  { action: 'delete', label: 'Delete (created by mistake)', icon: <Trash2 className="h-4 w-4" />, danger: true },
  { action: 'correction', label: 'Admin correction', icon: <Wrench className="h-4 w-4" />, danger: true },
];

export const TaskDetailView: React.FC<{ taskId: string }> = ({ taskId }) => {
  const router = useRouter();
  const { user } = useAuth();
  const { push, Toaster } = useToaster();
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [dialog, setDialog] = useState<TaskDialogAction | null>(null);
  const [viewer, setViewer] = useState<TaskAttachment | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setTask(await api.get<TaskDetail>(`/tasks/${taskId}`));
      setConflict(false);
    } catch (e) {
      setLoadError(errorMessage(e, 'Task not found or you do not have access to it.'));
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading && !task) return <PageLoader rows={5} />;
  if (loadError || !task) {
    return (
      <InfoCallout variant="danger" title="Task unavailable">
        <div className="space-y-2">
          <p>{loadError}</p>
          <Link href="/tasks">
            <Button size="sm" variant="secondary">Back to my tasks</Button>
          </Link>
        </div>
      </InfoCallout>
    );
  }

  const allowed = new Set(task.allowed_actions);
  const isAssignee = task.assigned_to === user?.id;
  const ob = task.blockers.find((b) => b.open) || null;
  const open = ['not_started', 'in_progress', 'blocked'].includes(task.status);
  const deadlineMoved = task.original_deadline && task.deadline && task.original_deadline !== task.deadline;
  const primary = PRIMARY.filter((p) => allowed.has(p.action));
  const secondary = SECONDARY.filter((p) => allowed.has(p.action));
  const done = (d: TaskDetail, msg: string) => {
    setTask(d);
    setDialog(null);
    push('success', msg);
  };
  const onSecondary = (a: (typeof SECONDARY)[number]['action']) => {
    if (a === 'edit') setEditOpen(true);
    else if (a === 'delete') setDeleteOpen(true);
    else setDialog(a);
  };

  const removeFile = async (f: TaskAttachment) => {
    if (!window.confirm(`Remove "${f.file_name}"?`)) return;
    try {
      await api.delete(`/task-attachments/${f.id}`);
      push('success', 'File removed.');
      load();
    } catch (e) {
      push('error', errorMessage(e));
    }
  };

  const doDelete = async () => {
    setBusy(true);
    try {
      await api.delete(`/tasks/${task.id}`);
      notifyTasksChanged();
      push('success', 'Task deleted.');
      router.push('/tasks');
    } catch (e) {
      push('error', errorMessage(e));
      setDeleteOpen(false);
    } finally {
      setBusy(false);
    }
  };

  // Linked records open in their own module when this role may open that page; otherwise plain text.
  const role = user?.role;
  const follow = (href: string) => (canOpen(role, href) ? href : null);
  const links = [
    task.customer_name && { label: 'Customer', value: task.customer_name, href: task.customer_id ? follow(`/leads?customer=${task.customer_id}`) : null },
    task.tender_no && { label: 'Tender', value: task.tender_no, href: task.tender_id ? follow(`/tenders?highlight=${task.tender_id}`) : null },
    task.demo_no && { label: 'Demo', value: task.demo_no, href: task.demo_id ? follow(`/demos?open=${task.demo_id}`) : null },
    task.ticket_no && { label: 'Service ticket', value: task.ticket_no, href: task.service_ticket_id ? follow(`/service?open=${task.service_ticket_id}`) : null },
    task.related_entity_type === 'proposal' && task.related_entity_id && { label: 'Proposal', value: 'Proposal follow-up', href: follow(`/proposals?open=${task.related_entity_id}`) },
  ].filter(Boolean) as { label: string; value: string; href: string | null }[];

  return (
    <div className="space-y-5 pb-24 md:pb-12">
      {/* Title row */}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" leftIcon={<ArrowLeft className="h-4 w-4" />} onClick={() => router.back()}>
          Back
        </Button>
        <span className="font-mono text-sm font-semibold text-[#0F5E63]">{task.task_number}</span>
        <TaskStatusBadges status={task.display_status} storedStatus={task.status} isOverdue={task.is_overdue} />
        <PriorityBadge priority={task.priority} />
        <DelayBadge delay={task.delay_class} />
        {task.template && (
          <Link href={`/tasks/templates/${task.template.id}`}>
            <Badge variant="outline" size="sm" className="gap-1 cursor-pointer">
              <Repeat className="h-3 w-3" /> Recurring
            </Badge>
          </Link>
        )}
        {task.is_backlog && <Badge variant="outline" size="sm">Backlog entry (excluded from metrics)</Badge>}
        {task.generated_late && <Badge variant="outline" size="sm">Generated late (excluded from metrics)</Badge>}
        {task.no_update && <FlagChip>No update recently</FlagChip>}
      </div>

      {conflict && <TaskConflictCallout onRefresh={load} />}

      {/* Situation callouts */}
      {ob && (
        <InfoCallout variant={ob.status === 'accepted' ? 'info' : 'warning'} title={`${blockerTypeLabel(ob.blocker_type)} — ${TASK_BLOCKER_STATUS_LABELS[ob.status]}`}>
          <div className="space-y-1 text-sm">
            <p>“{ob.description}”</p>
            <p className="text-xs text-[#4A5568]">
              Raised by {ob.raised_by_name || '—'} · {formatTaskDateTime(ob.created_at)}
              {ob.dependency_user_name ? ` · waiting on ${ob.dependency_user_name}` : ''}
              {ob.dependency_customer_name ? ` · customer ${ob.dependency_customer_name}` : ''}
              {ob.vendor_name ? ` · vendor ${ob.vendor_name}` : ''}
              {ob.portal_name ? ` · portal ${ob.portal_name}` : ''}
              {ob.approval_pending_from ? ` · pending from ${ob.approval_pending_from}` : ''}
              {ob.leave_from ? ` · leave ${ob.leave_from} → ${ob.leave_to}` : ''}
            </p>
            {ob.raised_after_deadline && <FlagChip>Raised after the deadline</FlagChip>}
            {ob.status === 'pending_review' && <p className="text-xs">Waiting for review by {task.approvers.map((a) => a.full_name).join(', ') || 'the manager'}. The overdue clock keeps running until it is accepted.</p>}
            {ob.status === 'accepted' && (
              <p className="text-xs">
                {ob.decision === 'accept_extend' ? 'Accepted with a new deadline.' : 'Accepted — the clock is paused; the blocked time is added to the deadline when resolved.'}
                {ob.decision_comment ? ` “${ob.decision_comment}”` : ''}
              </p>
            )}
          </div>
        </InfoCallout>
      )}
      {task.status === 'awaiting_approval' && (
        <InfoCallout variant="info" title="Awaiting approval">
          Completed {formatTaskDateTime(task.completed_at)} · approver{task.approvers.length > 1 ? 's' : ''}: {task.approvers.map((a) => a.full_name).join(', ') || '—'}
          {task.approver_via_fallback ? ' (fallback — no active manager)' : ''}
        </InfoCallout>
      )}
      {task.status === 'cancelled' && task.cancelled_reason && (
        <InfoCallout variant="neutral" title="Cancelled">
          “{task.cancelled_reason}” — excluded from compliance metrics.
        </InfoCallout>
      )}
      {task.assignee_active === false && open && <InfoCallout variant="warning" title="Assignee is inactive">This task needs to be reassigned.</InfoCallout>}
      {task.repeated_blocker_types.some((r) => r.flagged) && (
        <InfoCallout variant="warning" title="Repeated blockers">
          {task.repeated_blocker_types
            .filter((r) => r.flagged)
            .map((r) => `${blockerTypeLabel(r.type)} raised ${r.count} times`)
            .join(' · ')}
        </InfoCallout>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <div className="xl:col-span-2 space-y-5">
          {/* Header card */}
          <Card className="p-4 sm:p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-start gap-3 sm:justify-between">
              <div className="min-w-0 space-y-1">
                <h2 className="font-serif text-xl text-[#14213D] break-words">{task.title}</h2>
                <p className="text-sm text-[#4A5568]">
                  {task.category_name}
                  {links.length ? ` · ${links.map((l) => l.value).join(' · ')}` : ''}
                </p>
              </div>
              <div className="sm:text-right shrink-0">
                <div className="text-[11px] uppercase tracking-wide text-[#4A5568]">Deadline</div>
                <DueText deadline={task.deadline} open={open} />
                {deadlineMoved && (
                  <div className="text-[11px] text-[#4A5568] mt-1">
                    Original: <DateTime value={task.original_deadline} />
                  </div>
                )}
              </div>
            </div>
            <ProgressBar value={task.progress_percent} />
            {task.description && <p className="text-sm text-[#14213D] whitespace-pre-wrap break-words">{task.description}</p>}
            {task.expected_outcome && (
              <div className="rounded-lg bg-[#FBFAF7] border border-[#ECE9E2] px-3 py-2">
                <div className="text-[11px] uppercase tracking-wide text-[#4A5568]">Expected outcome</div>
                <p className="text-sm text-[#14213D] whitespace-pre-wrap">{task.expected_outcome}</p>
              </div>
            )}
            <dl className="grid grid-cols-2 md:grid-cols-4 gap-3 border-t border-[#ECE9E2] pt-4">
              <Meta label="Assignee">
                {task.assignee_name || '—'}
                {task.assignee_active === false ? ' (inactive)' : ''}
              </Meta>
              <Meta label="Assigned by">{task.assigned_by_name || 'System'}</Meta>
              <Meta label="Reporting manager (at assignment)">{task.reporting_manager_name || '—'}</Meta>
              <Meta label="Department">{task.department_name || '—'}</Meta>
              <Meta label="Start date">
                <DateTime value={task.start_date} dateOnly />
              </Meta>
              <Meta label="Last update">
                <DateTime value={task.last_update_at} />
              </Meta>
              {task.completed_at && (
                <Meta label="Completed">
                  <DateTime value={task.completed_at} />
                </Meta>
              )}
              {task.approved_at && (
                <Meta label="Approved">
                  <DateTime value={task.approved_at} />
                </Meta>
              )}
              <Meta label="Evidence required">{task.evidence_required ? 'Yes' : 'No'}</Meta>
              <Meta label="Approval required">{task.approval_required ? 'Yes' : 'No'}</Meta>
              {links.map((l) => (
                <Meta key={l.label} label={l.label}>
                  {l.href ? (
                    <Link href={l.href} className="text-[#0F5E63] font-medium hover:underline">
                      {l.value}
                    </Link>
                  ) : (
                    l.value
                  )}
                </Meta>
              ))}
              {task.template && <Meta label="Series">{describeRecurrence(task.template.recurrence_type as any, (task.template as any).recurrence_rule) || task.template.title}</Meta>}
              {(task.rework_count > 0 || task.reopen_count > 0 || task.extension_count > 0 || task.reassign_count > 0) && (
                <Meta label="History">
                  {[task.rework_count && `${task.rework_count} rework`, task.reopen_count && `${task.reopen_count} reopened`, task.extension_count && `${task.extension_count} extension(s)`, task.reassign_count && `${task.reassign_count} reassignment(s)`]
                    .filter(Boolean)
                    .join(' · ')}
                </Meta>
              )}
              {(task.delay_class === 'late_excused' || task.delay_class === 'late_unexcused' || task.delay_class === 'open_overdue') && (
                <Meta label="Delay (days)">
                  {task.unexcused_delay_days} unexcused · {task.excused_delay_days} excused
                </Meta>
              )}
            </dl>
            {task.completion_remarks && (
              <div className="rounded-lg bg-[#E3EFEE]/50 border border-[#0F5E63]/20 px-3 py-2 text-sm">
                <span className="font-semibold text-[#0F5E63]">Completion remarks: </span>
                {task.completion_remarks}
                {task.delay_reason && <span className="block text-[#9A3412] mt-1">Reason for delay: {task.delay_reason}</span>}
              </div>
            )}

            {/* Actions */}
            {(primary.length > 0 || secondary.length > 0) && (
              <div className="hidden md:flex flex-wrap items-center gap-2 border-t border-[#ECE9E2] pt-4">
                {primary.map((p, i) => (
                  <Button key={p.action} size="sm" variant={p.variant || (i === 0 ? 'primary' : 'secondary')} leftIcon={p.icon} onClick={() => setDialog(p.action)}>
                    {p.label}
                  </Button>
                ))}
                {secondary.length > 0 && <RowMenu label="More task actions" buttonLabel="More" items={secondary.map((s) => ({ key: s.action, label: s.label, icon: s.icon, danger: s.danger, onSelect: () => onSecondary(s.action) }))} />}
              </div>
            )}
          </Card>

          {allowed.has('progress') && <ProgressBox task={task} isAssignee={isAssignee} onSaved={(d, m) => done(d, m)} onConflict={() => setConflict(true)} onError={(m) => push('error', m)} />}

          <Card className="p-4 sm:p-5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-serif text-lg text-[#14213D]">Files</h3>
              {open && (isAssignee || task.viewer.kinds.includes('manager') || task.viewer.kinds.includes('assigner')) && (
                <SupportingUpload taskId={task.id} purpose={isAssignee ? 'evidence' : 'supporting_doc'} onDone={(failures) => (failures.length ? push('error', failures.join(' ')) : (push('success', 'File attached.'), load()))} />
              )}
            </div>
            <FileList files={task.attachments} onOpen={setViewer} onRemove={removeFile} canRemove={(f) => open && (f.uploaded_by === user?.id || (task.viewer.kinds.includes('manager') && !isAssignee))} />
          </Card>

          <Card className="p-4 sm:p-5 space-y-3">
            <h3 className="font-serif text-lg text-[#14213D]">Activity</h3>
            <ActivityTimeline updates={task.updates} />
          </Card>
        </div>

        {/* Side panels */}
        <div className="space-y-5">
          <Card className="p-4 space-y-3">
            <h3 className="font-serif text-base text-[#14213D]">Blockers</h3>
            {task.blockers.length === 0 ? (
              <p className="text-xs text-[#8A8578]">No blockers raised.</p>
            ) : (
              <ul className="space-y-3">
                {task.blockers.map((b) => (
                  <li key={b.id} className="rounded-lg border border-[#ECE9E2] p-3 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-[#14213D]">{blockerTypeLabel(b.blocker_type)}</span>
                      <BlockerBadge status={b.status} />
                    </div>
                    <p className="text-xs text-[#14213D]">{b.description}</p>
                    <p className="text-[11px] text-[#4A5568]">
                      {formatTaskDateTime(b.created_at)}
                      {b.raised_after_deadline ? ' · after deadline' : ''}
                      {b.excused_minutes ? ` · ${minutesToDays(b.excused_minutes)} day(s) excused` : ''}
                    </p>
                    {b.decision_comment && (
                      <p className="text-[11px] text-[#4A5568]">
                        {b.decided_by_name || 'System'}: “{b.decision_comment}”
                      </p>
                    )}
                    {b.resolution_note && <p className="text-[11px] text-[#4A5568]">Resolved: “{b.resolution_note}”</p>}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {task.deadline_changes.length > 0 && (
            <Card className="p-4 space-y-3">
              <h3 className="font-serif text-base text-[#14213D]">Deadline changes</h3>
              <ul className="space-y-2">
                {task.deadline_changes.map((c) => (
                  <li key={c.id} className="text-xs border-l-2 border-[#0F5E63] pl-2">
                    <div className="font-semibold text-[#14213D]">{TASK_DEADLINE_SOURCE_LABELS[c.source as TaskDeadlineChangeSource] || c.source}</div>
                    <div className="font-mono text-[11px] text-[#4A5568]">
                      {formatTaskDateTime(c.old_deadline)} → {formatTaskDateTime(c.new_deadline)}
                    </div>
                    {c.excused_minutes > 0 && <div className="text-[#0F5E63]">{minutesToDays(c.excused_minutes)} day(s) excused</div>}
                    {c.locked_unexcused_minutes > 0 && <div className="text-[#9A3412]">{minutesToDays(c.locked_unexcused_minutes)} day(s) already overdue — stays unexcused</div>}
                    <div className="text-[#4A5568]">
                      {c.changed_by_name || 'System'} · “{c.reason}”
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {task.assignment_history.length > 0 && (
            <Card className="p-4 space-y-3">
              <h3 className="font-serif text-base text-[#14213D]">Reassignments</h3>
              <ul className="space-y-2">
                {task.assignment_history.map((h) => (
                  <li key={h.id} className="text-xs">
                    <div className="font-semibold text-[#14213D]">
                      {h.from_name || '—'} → {h.to_name || '—'}
                    </div>
                    <div className="text-[#4A5568]">
                      {TASK_REASSIGN_REASON_LABELS[h.reason_type as TaskReassignReason] || h.reason_type}
                      {h.was_overdue ? ' · was overdue' : ''} · {formatTaskDateTime(h.created_at)}
                    </div>
                    <div className="text-[#4A5568]">“{h.reason}”</div>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {task.escalations.length > 0 && (
            <Card className="p-4 space-y-3">
              <h3 className="font-serif text-base text-[#14213D]">Escalations</h3>
              <ul className="space-y-3">
                {task.escalations.map((e) => (
                  <EscalationRow key={e.id} esc={e} mine={e.escalated_to === user?.id} onChanged={(d, m) => done(d, m)} onError={(m) => push('error', m)} />
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>

      {/* Mobile sticky action bar */}
      {(primary.length > 0 || secondary.length > 0) && (
        <div className="md:hidden fixed bottom-0 inset-x-0 z-30 border-t border-[#DCD8CE] bg-white/95 backdrop-blur px-3 py-2 flex items-center gap-2">
          {primary.slice(0, 2).map((p, i) => (
            <Button key={p.action} size="md" className="flex-1" variant={i === 0 ? 'primary' : 'secondary'} leftIcon={p.icon} onClick={() => setDialog(p.action)}>
              {p.label}
            </Button>
          ))}
          {(primary.length > 2 || secondary.length > 0) && (
            <RowMenu
              label="More task actions"
              items={[...primary.slice(2).map((p) => ({ key: p.action, label: p.label, icon: p.icon, onSelect: () => setDialog(p.action) })), ...secondary.map((s) => ({ key: s.action, label: s.label, icon: s.icon, danger: s.danger, onSelect: () => onSecondary(s.action) }))]}
            />
          )}
        </div>
      )}

      <TaskActionDialog action={dialog} task={task} onClose={() => setDialog(null)} onDone={done} onConflict={() => setConflict(true)} />
      <FileViewer file={viewer} onClose={() => setViewer(null)} />
      {editOpen && <EditTaskModal task={task} onClose={() => setEditOpen(false)} onSaved={(d) => done(d, 'Task updated.')} onConflict={() => setConflict(true)} />}
      <Modal isOpen={deleteOpen} onClose={() => setDeleteOpen(false)} title="Delete this task?" description="Only possible within a few minutes of creating it and before anyone worked on it. Otherwise cancel it with a reason." maxWidth="md">
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setDeleteOpen(false)} disabled={busy}>
            Keep it
          </Button>
          <Button variant="danger" isLoading={busy} onClick={doDelete}>
            Delete permanently
          </Button>
        </div>
      </Modal>
      <Toaster />
    </div>
  );
};

// ------------------------------------------------------------------ progress box
const ProgressBox: React.FC<{
  task: TaskDetail;
  isAssignee: boolean;
  onSaved: (d: TaskDetail, msg: string) => void;
  onConflict: () => void;
  onError: (m: string) => void;
}> = ({ task, isAssignee, onSaved, onConflict, onError }) => {
  const [comment, setComment] = useState('');
  const [progress, setProgress] = useState(task.progress_percent);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const camRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => setProgress(task.progress_percent), [task.progress_percent]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const changed = isAssignee && progress !== task.progress_percent;
    if (!comment.trim() && !changed && !files.length) {
      setError('Add a comment, move the progress slider or attach a photo.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (files.length) {
        const failures = await uploadTaskFiles(task.id, files, 'update');
        if (failures.length) onError(failures.join(' '));
      }
      const fresh = files.length ? await api.get<TaskDetail>(`/tasks/${task.id}`) : task;
      const d = await api.post<TaskDetail>(`/tasks/${task.id}/progress`, {
        version: fresh.version,
        comment: comment.trim() || undefined,
        ...(changed ? { progress_percent: progress } : {}),
      });
      setComment('');
      setFiles([]);
      notifyTasksChanged();
      onSaved(d, isAssignee ? 'Progress updated.' : 'Comment added.');
    } catch (err) {
      if (isConflict(err)) onConflict();
      const errs = fieldErrors(err);
      setError(Object.values(errs).join(' ') || errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-4 sm:p-5">
      <form onSubmit={save} className="space-y-3">
        <h3 className="font-serif text-lg text-[#14213D]">{isAssignee ? 'Update progress' : 'Add a comment'}</h3>
        <Textarea label={isAssignee ? 'What happened since the last update?' : 'Comment to the assignee'} value={comment} onChange={(e) => setComment(e.target.value)} rows={3} maxLength={2000} placeholder={isAssignee ? 'e.g. Met the procurement officer; revised quote due Friday' : 'Your note is sent to the assignee'} />
        {isAssignee && (
          <div>
            <label htmlFor="task-progress" className="block text-xs font-semibold text-[#14213D] mb-1.5">
              Progress: <span className="font-mono">{progress}%</span>
            </label>
            <input id="task-progress" type="range" min={0} max={100} step={5} value={progress} onChange={(e) => setProgress(Number(e.target.value))} className="w-full accent-[#0F5E63] h-8" />
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <input ref={fileRef} type="file" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,image/*" className="hidden" onChange={(e) => e.target.files && setFiles([...files, ...Array.from(e.target.files)].slice(0, 5))} />
          <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => e.target.files && setFiles([...files, ...Array.from(e.target.files)].slice(0, 5))} />
          <Button type="button" size="sm" variant="secondary" leftIcon={<Camera className="h-4 w-4" />} onClick={() => camRef.current?.click()}>
            Photo
          </Button>
          <Button type="button" size="sm" variant="secondary" leftIcon={<Paperclip className="h-4 w-4" />} onClick={() => fileRef.current?.click()}>
            File
          </Button>
          {files.map((f, i) => (
            <Badge key={`${f.name}-${i}`} variant="outline" size="sm" className="gap-1">
              {f.name}
              <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))}>
                ×
              </button>
            </Badge>
          ))}
          <Button type="submit" size="sm" className="ml-auto" isLoading={busy} leftIcon={<Send className="h-4 w-4" />}>
            {isAssignee ? 'Post update' : 'Post comment'}
          </Button>
        </div>
        {error && <p className="text-xs text-[#881337]">{error}</p>}
      </form>
    </Card>
  );
};

const SupportingUpload: React.FC<{ taskId: string; purpose: string; onDone: (failures: string[]) => void }> = ({ taskId, purpose, onDone }) => {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <input
        ref={ref}
        type="file"
        multiple
        accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,image/*"
        className="hidden"
        onChange={async (e) => {
          const list = e.target.files ? Array.from(e.target.files) : [];
          e.target.value = '';
          if (!list.length) return;
          setBusy(true);
          const failures = await uploadTaskFiles(taskId, list, purpose);
          setBusy(false);
          notifyTasksChanged();
          onDone(failures);
        }}
      />
      <Button size="xs" variant="secondary" isLoading={busy} leftIcon={<FilePlus2 className="h-3.5 w-3.5" />} onClick={() => ref.current?.click()}>
        {purpose === 'evidence' ? 'Add evidence' : 'Add document'}
      </Button>
    </>
  );
};

const EscalationRow: React.FC<{
  esc: TaskDetail['escalations'][number];
  mine: boolean;
  onChanged: (d: TaskDetail, m: string) => void;
  onError: (m: string) => void;
}> = ({ esc, mine, onChanged, onError }) => {
  const [closing, setClosing] = useState(false);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const act = async (action: 'acknowledge' | 'close') => {
    setBusy(true);
    try {
      const d = await api.post<TaskDetail>(`/task-escalations/${esc.id}/${action}`, { comment });
      notifyTasksChanged();
      onChanged(d, action === 'acknowledge' ? 'Escalation acknowledged.' : 'Escalation closed.');
      setClosing(false);
    } catch (e) {
      onError(Object.values(fieldErrors(e)).join(' ') || errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className="rounded-lg border border-[#ECE9E2] p-3 space-y-1 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold text-[#14213D]">To {esc.escalated_to_name}</span>
        <Badge variant={esc.status === 'closed' ? 'outline' : 'warning'} size="sm">
          {esc.status}
        </Badge>
      </div>
      <p className="text-[#4A5568]">
        {esc.escalated_by_name || 'System (SLA)'} · {formatTaskDateTime(esc.created_at)}
      </p>
      <p className="text-[#14213D]">“{esc.reason}”</p>
      {esc.outcome_comment && <p className="text-[#0F5E63]">Outcome: “{esc.outcome_comment}”</p>}
      {mine && esc.status !== 'closed' && (
        <div className="space-y-2 pt-1">
          {closing ? (
            <>
              <Textarea label="Outcome *" value={comment} onChange={(e) => setComment(e.target.value)} rows={2} maxLength={1000} />
              <div className="flex gap-2">
                <Button size="xs" variant="ghost" onClick={() => setClosing(false)} disabled={busy}>
                  Back
                </Button>
                <Button size="xs" isLoading={busy} onClick={() => act('close')}>
                  Close escalation
                </Button>
              </div>
            </>
          ) : (
            <div className="flex gap-2">
              {esc.status === 'open' && (
                <Button size="xs" variant="secondary" isLoading={busy} onClick={() => act('acknowledge')}>
                  Acknowledge
                </Button>
              )}
              <Button size="xs" variant="secondary" onClick={() => setClosing(true)}>
                Close with outcome
              </Button>
            </div>
          )}
        </div>
      )}
    </li>
  );
};

// ------------------------------------------------------------------ edit
const EditTaskModal: React.FC<{ task: TaskDetail; onClose: () => void; onSaved: (d: TaskDetail) => void; onConflict: () => void }> = ({ task, onClose, onSaved, onConflict }) => {
  const router = useRouter();
  const { categories } = useTaskCategories();
  const [scope, setScope] = useState<'instance' | 'series' | null>(task.template ? null : 'instance');
  const [v, setV] = useState({
    title: task.title,
    description: task.description || '',
    expected_outcome: task.expected_outcome || '',
    priority: task.priority,
    category_id: task.category_id,
    customer_id: task.customer_id || '',
    tender_id: task.tender_id || '',
    demo_id: task.demo_id || '',
    service_ticket_id: task.service_ticket_id || '',
    evidence_required: task.evidence_required,
    approval_required: task.approval_required,
    reason: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const cat = categories.find((c) => c.id === v.category_id);
  const set = (k: keyof typeof v, val: any) => setV((p) => ({ ...p, [k]: val }));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    try {
      const body: Record<string, unknown> = { version: task.version };
      (Object.keys(v) as (keyof typeof v)[]).forEach((k) => {
        const before = (task as any)[k] ?? '';
        if (k === 'reason') return;
        if (String(v[k] ?? '') !== String(before ?? '')) body[k] = v[k] === '' ? null : v[k];
      });
      if (v.reason.trim()) body.reason = v.reason.trim();
      const d = await api.patch<TaskDetail>(`/tasks/${task.id}`, body);
      notifyTasksChanged();
      onSaved(d);
    } catch (err) {
      if (isConflict(err)) {
        onConflict();
        onClose();
        return;
      }
      const errs = fieldErrors(err);
      setErrors(Object.keys(errs).length ? errs : { _: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  if (scope === null) {
    return (
      <Modal isOpen onClose={onClose} title="Edit a recurring task" description="This task is one instance of a recurring series." maxWidth="md">
        <div className="space-y-3">
          <Button fullWidth variant="secondary" onClick={() => setScope('instance')}>
            This instance only
          </Button>
          <Button fullWidth variant="secondary" onClick={() => router.push(`/tasks/templates/${task.template!.id}`)}>
            Future instances (edit the series)
          </Button>
          <p className="text-[11px] text-[#4A5568]">Series edits change only future instances that have not started; work already in progress keeps its details.</p>
        </div>
      </Modal>
    );
  }

  return (
    <Modal isOpen onClose={onClose} title="Edit task" description="Deadline changes go through “Extend deadline” so they are recorded." maxWidth="2xl">
      <form onSubmit={save} className="space-y-4">
        <Input label="Title *" value={v.title} onChange={(e) => set('title', e.target.value)} maxLength={200} error={errors.title} />
        <Textarea label="Description" value={v.description} onChange={(e) => set('description', e.target.value)} rows={3} maxLength={5000} error={errors.description} />
        <Textarea label="Expected outcome" value={v.expected_outcome} onChange={(e) => set('expected_outcome', e.target.value)} rows={2} maxLength={1000} error={errors.expected_outcome} />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Select label="Priority" value={v.priority} onChange={(e) => set('priority', e.target.value)} options={TASK_PRIORITIES.map((p) => ({ value: p, label: TASK_PRIORITY_LABELS[p] }))} error={errors.priority} />
          <Select label="Category" value={v.category_id} onChange={(e) => set('category_id', e.target.value)} options={categories.map((c) => ({ value: c.id, label: c.name }))} error={errors.category_id} />
        </div>
        {cat?.requires_link_type === 'customer' && <LinkPicker type="customer" required value={v.customer_id} onChange={(id) => set('customer_id', id)} error={errors.customer_id} />}
        {cat?.requires_link_type === 'tender' && <LinkPicker type="tender" required value={v.tender_id} onChange={(id) => set('tender_id', id)} error={errors.tender_id} />}
        {cat?.requires_link_type === 'demo' && <LinkPicker type="demo" value={v.demo_id} onChange={(id) => set('demo_id', id)} error={errors.demo_id} helperText="Or link the customer below." />}
        {cat?.requires_link_type === 'service' && <LinkPicker type="service" value={v.service_ticket_id} onChange={(id) => set('service_ticket_id', id)} error={errors.service_ticket_id} helperText="Or link the customer below." />}
        {cat?.requires_link_type && cat.requires_link_type !== 'customer' && cat.requires_link_type !== 'tender' && <LinkPicker type="customer" value={v.customer_id} onChange={(id) => set('customer_id', id)} error={errors.customer_id} />}
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={v.evidence_required} onChange={(e) => set('evidence_required', e.target.checked)} className="accent-[#0F5E63] h-4 w-4" /> Evidence required
          </label>
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={v.approval_required} onChange={(e) => set('approval_required', e.target.checked)} className="accent-[#0F5E63] h-4 w-4" /> Approval required
          </label>
        </div>
        <Input label="Reason for the change (optional)" value={v.reason} onChange={(e) => set('reason', e.target.value)} maxLength={500} />
        {(errors._ || errors.deadline || errors.version) && <InfoCallout variant="danger">{errors._ || errors.deadline || errors.version}</InfoCallout>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" isLoading={busy}>
            Save changes
          </Button>
        </div>
      </form>
    </Modal>
  );
};
