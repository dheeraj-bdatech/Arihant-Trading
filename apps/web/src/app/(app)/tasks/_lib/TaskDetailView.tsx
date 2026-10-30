'use client';

/**
 * Task detail (§12.3): status + overdue + delay badges, original vs current deadline, links, supporting docs,
 * the status track (the board's columns), an update box (comment, photos from the phone camera) and the actions this
 * user may take right now (server-computed `allowed_actions`; every call is re-checked server-side).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  ArrowRightLeft,
  BadgeCheck,
  Ban,
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  FilePlus2,
  FileText,
  Flag,
  History,
  MessageSquare,
  Paperclip,
  Pencil,
  Play,
  Repeat,
  RotateCcw,
  Send,
  ShieldAlert,
  Tag,
  Target,
  Trash2,
  Undo2,
  Users,
  Wrench,
} from 'lucide-react';
import { Badge, Button, Card, FormSteps, InfoCallout, Input, Modal, PageLoader, RowMenu, Select, Textarea } from '@/components/ui';
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
  relativeDue,
  type TaskDeadlineChangeSource,
  type TaskReassignReason,
} from '@arihant/shared';
import { errorMessage, fieldErrors, isConflict, notifyTasksChanged, useTaskCategories, type TaskAttachment, type TaskDetail } from './task-lib';
import {
  ActivityTimeline,
  BlockerBadge,
  DateTime,
  DelayBadge,
  FileList,
  FileViewer,
  FlagChip,
  PriorityBadge,
  StatusTrack,
  TaskConflictCallout,
  TaskStatusBadges,
  blockerTypeLabel,
  useToaster,
  DialogActions,
} from './task-ui';
import { TaskActionDialog, uploadTaskFiles, type TaskDialogAction } from './TaskActions';
import { LinkPicker } from './pickers';

/** Readable escalation states (never the raw code). */
const ESCALATION_STATUS_LABELS: Record<string, string> = { open: 'Open', acknowledged: 'Acknowledged', closed: 'Closed' };

/** `short`: the label in the phone action bar, where two buttons share the width. */
const PRIMARY: { action: TaskDialogAction; label: string; short?: string; icon: React.ReactNode; variant?: 'primary' | 'secondary' | 'danger' }[] = [
  { action: 'start', label: 'Start', icon: <Play className="h-4 w-4" /> },
  { action: 'complete', label: 'Complete', icon: <CheckCircle2 className="h-4 w-4" /> },
  { action: 'approve', label: 'Approve', icon: <CheckCircle2 className="h-4 w-4" /> },
  { action: 'accept_blocker', label: 'Accept blocker', short: 'Accept', icon: <CheckCircle2 className="h-4 w-4" /> },
  { action: 'resolve_blocker', label: 'Blocker resolved', short: 'Resolved', icon: <CheckCircle2 className="h-4 w-4" />, variant: 'secondary' },
  { action: 'raise_blocker', label: 'Raise blocker', icon: <Flag className="h-4 w-4" />, variant: 'secondary' },
  { action: 'send_back', label: 'Send back', icon: <Undo2 className="h-4 w-4" />, variant: 'secondary' },
  { action: 'reject_blocker', label: 'Reject blocker', short: 'Reject', icon: <Ban className="h-4 w-4" />, variant: 'secondary' },
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

/** `popup`: the essentials only (status, due, people, the work, actions), for the task quick view opened from any list. */
export const TaskDetailView: React.FC<{ taskId: string; variant?: 'page' | 'popup'; onLoaded?: (task: TaskDetail) => void }> = ({ taskId, variant = 'page', onLoaded }) => {
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
  const [showAll, setShowAll] = useState(false);
  const popup = variant === 'popup';
  const [busy, setBusy] = useState(false);

  // read through a ref so a new callback from the parent does not refetch the task
  const onLoadedRef = useRef(onLoaded);
  onLoadedRef.current = onLoaded;

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const fresh = await api.get<TaskDetail>(`/tasks/${taskId}`);
      setTask(fresh);
      onLoadedRef.current?.(fresh);
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
  // Blockers are raised by the assignee and decided by their manager (Module 8): explain the rule when it applies.
  const blockerUnavailableReason = ob
    ? 'A blocker is already open on this task — it has to be resolved or withdrawn before another can be raised.'
    : !isAssignee
      ? `Only the assignee${task.assignee_name ? ` (${task.assignee_name})` : ''} can raise a blocker; their manager then accepts or rejects it.${
          task.viewer.kinds.includes('manager') ? ' To change the plan yourself, extend the deadline or reassign the task.' : ''
        }`
      : 'Blockers can be raised while the task is not started or in progress.';
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

  const rel = task.deadline ? relativeDue(task.deadline) : null;
  const dueHeadline = !task.deadline
    ? 'No deadline'
    : !open
      ? task.completed_at
        ? 'Done'
        : 'Closed'
      : rel!.overdue
        ? `${rel!.label.replace('overdue by ', '')} late`
        : rel!.label.replace('due in ', 'Due in ');
  const dueTone = !open ? 'text-[#0F5E63]' : rel?.overdue ? 'text-[#9A3412]' : 'text-[#14213D]';
  const delayed = task.delay_class === 'late_excused' || task.delay_class === 'late_unexcused' || task.delay_class === 'open_overdue';
  const historyLine = [
    task.rework_count && `${task.rework_count} rework`,
    task.reopen_count && `${task.reopen_count} reopened`,
    task.extension_count && `${task.extension_count} extension${task.extension_count === 1 ? '' : 's'}`,
    task.reassign_count && `${task.reassign_count} reassignment${task.reassign_count === 1 ? '' : 's'}`,
  ]
    .filter(Boolean)
    .join(' · ');

  const chips = (
  <div className="flex flex-wrap items-center gap-1.5">
    {task.category_name && (
      <span className="inline-flex items-center gap-1 rounded-md border border-[#DCD8CE] bg-[#FBFAF7] px-2 py-0.5 text-xs font-medium text-[#14213D]">
        <Tag className="h-3 w-3 text-[#4A5568]" aria-hidden />
        {task.category_name}
      </span>
    )}
    {links.map((l) =>
      l.href ? (
        <Link key={l.label} href={l.href} className="inline-flex items-center gap-1 rounded-md border border-[#D0E5E3] bg-[#E3EFEE] px-2 py-0.5 text-xs font-medium text-[#0F5E63] hover:border-[#0F5E63]">
          <span className="text-[#4A5568]">{l.label}:</span> {l.value}
        </Link>
      ) : (
        <span key={l.label} className="inline-flex items-center gap-1 rounded-md border border-[#DCD8CE] bg-white px-2 py-0.5 text-xs font-medium text-[#14213D]">
          <span className="text-[#4A5568]">{l.label}:</span> {l.value}
        </span>
      ),
    )}
    {task.approval_required && (
      <span
        className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold ${task.status === 'awaiting_approval' ? 'bg-[#FFF8EB] text-[#A15C07] ring-1 ring-[#E9C9B4]' : 'bg-[#EEF1F5] text-[#1F2E52]'}`}
      >
        <BadgeCheck className="h-3 w-3" aria-hidden /> {task.status === 'awaiting_approval' ? 'Approval pending' : 'Approval required'}
      </span>
    )}
    {task.evidence_required && (
      <span className="inline-flex items-center gap-1 rounded-md bg-[#EEF1F5] px-2 py-0.5 text-xs font-semibold text-[#1F2E52]">
        <Paperclip className="h-3 w-3" aria-hidden /> Evidence required
      </span>
    )}
  </div>
  );

  const overlays = (
    <>
        <TaskActionDialog action={dialog} task={task} onClose={() => setDialog(null)} onDone={done} onConflict={() => setConflict(true)} />
        <FileViewer file={viewer} onClose={() => setViewer(null)} />
        {editOpen && <EditTaskModal task={task} onClose={() => setEditOpen(false)} onSaved={(d) => done(d, 'Task updated.')} onConflict={() => setConflict(true)} />}
        <Modal isOpen={deleteOpen} onClose={() => setDeleteOpen(false)} title="Delete this task?" description="Only possible within a few minutes of creating it and before anyone worked on it. Otherwise cancel it with a reason." maxWidth="md">
          <DialogActions sticky={false}>
            <Button variant="ghost" onClick={() => setDeleteOpen(false)} disabled={busy}>
              Keep it
            </Button>
            <Button variant="danger" isLoading={busy} onClick={doDelete}>
              Delete permanently
            </Button>
          </DialogActions>
        </Modal>
        <Toaster />
    </>
  );

  // Who and when: in the popup this leads the expanded details, on the page it heads the side column.
  const approvers = task.approvers.map((ap) => ap.full_name).join(', ') || task.reporting_manager_name || 'the manager';
  const approvalText = !task.approval_required
    ? 'Not required'
    : task.status === 'awaiting_approval'
      ? `Pending with ${approvers}`
      : `${approvers} approves once it is marked done`;
  // Who and when beyond the people up top: shared by the page's Details card and the popup's summary box
  const detailRows = (
    <>
      <SideRow label="Reporting manager">
        <Person name={task.reporting_manager_name} />
      </SideRow>
      <SideRow label="Department">{task.department_name || '—'}</SideRow>
      <SideRow label="Start date">
        <DateTime value={task.start_date} dateOnly />
      </SideRow>
      <SideRow label="Last update">
        <DateTime value={task.last_update_at} />
      </SideRow>
      {task.completed_at && (
        <SideRow label="Completed">
          <DateTime value={task.completed_at} />
        </SideRow>
      )}
      {task.approved_at && (
        <SideRow label="Approved">
          <DateTime value={task.approved_at} />
        </SideRow>
      )}
      {task.template && <SideRow label="Series">{describeRecurrence(task.template.recurrence_type as any, (task.template as any).recurrence_rule) || task.template.title}</SideRow>}
      {historyLine && <SideRow label="History">{historyLine}</SideRow>}
      {delayed && (
        <SideRow label="Delay">
          <span className="text-[#9A3412]">{Number(task.unexcused_delay_days).toFixed(1)} d unexcused</span>
          <span className="text-[#4A5568]"> · {Number(task.excused_delay_days).toFixed(1)} d excused</span>
        </SideRow>
      )}
    </>
  );
  const detailsCard = (
    <Card className="p-4">
      <SectionTitle icon={<Users className="h-4 w-4" />}>Details</SectionTitle>
      <dl className="mt-3 divide-y divide-[#ECE9E2]">
        <SideRow label="Assignee">
          <Person name={task.assignee_name} note={task.assignee_active === false ? 'inactive' : undefined} />
        </SideRow>
        <SideRow label="Assigned by">
          <Person name={task.assigned_by_name || 'System'} />
        </SideRow>
        <SideRow label="Evidence">{task.evidence_required ? 'Required' : 'Not required'}</SideRow>
        <SideRow label="Approval">{approvalText}</SideRow>
        {detailRows}
      </dl>
    </Card>
  );

  // Everything below the header: the work, activity, people, files, blockers and the decision trail.
  const fullSections = (
        <div className={popup ? 'space-y-4' : 'grid grid-cols-1 gap-5 xl:grid-cols-3'}>
          {/* Main column: the work itself, the update box and the history */}
          <div className={popup ? 'space-y-4' : 'space-y-5 xl:col-span-2'}>
            {(!popup || task.completion_remarks) && (
            <Card className="space-y-4 p-4 sm:p-5">
              <SectionTitle icon={<FileText className="h-4 w-4" />}>{popup ? 'Completion' : 'About this task'}</SectionTitle>
              {popup ? null : task.description ? (
                <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-[#14213D]">{task.description}</p>
              ) : (
                <p className="text-sm text-[#6B7280]">No description.</p>
              )}
              {!popup && task.expected_outcome && (
                <div className="rounded-[12px] border border-[#D0E5E3] bg-[#E3EFEE]/50 px-4 py-3">
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#0F5E63]">
                    <Target className="h-3.5 w-3.5" aria-hidden /> Expected outcome
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-[#14213D]">{task.expected_outcome}</p>
                </div>
              )}
              {task.completion_remarks && (
                <div className="rounded-[12px] border border-[#ECE9E2] bg-[#FBFAF7] px-4 py-3 text-sm">
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#4A5568]">
                    <CheckCircle2 className="h-3.5 w-3.5 text-[#0F5E63]" aria-hidden /> Completion remarks
                  </div>
                  <p className="mt-1 text-[#14213D]">{task.completion_remarks}</p>
                  {task.delay_reason && <p className="mt-1 text-[#9A3412]">Reason for delay: {task.delay_reason}</p>}
                </div>
              )}
            </Card>
            )}

            {allowed.has('progress') && <ProgressBox task={task} isAssignee={isAssignee} onSaved={(d, m) => done(d, m)} onConflict={() => setConflict(true)} onError={(m) => push('error', m)} />}

            <Card className="space-y-3 p-4 sm:p-5">
              <SectionTitle icon={<History className="h-4 w-4" />} count={task.updates.length}>
                Activity
              </SectionTitle>
              <ActivityTimeline updates={task.updates} />
            </Card>
          </div>

          {/* Side column: who, when, rules, linked files and the decision trail */}
          <div className={popup ? 'space-y-4' : 'space-y-5'}>
            {!popup && detailsCard}

            <Card className="space-y-3 p-4">
              <div className="flex items-center justify-between gap-2">
                <SectionTitle icon={<Paperclip className="h-4 w-4" />} count={task.attachments.length}>
                  Files
                </SectionTitle>
                {open && (isAssignee || task.viewer.kinds.includes('manager') || task.viewer.kinds.includes('assigner')) && (
                  <SupportingUpload taskId={task.id} purpose={isAssignee ? 'evidence' : 'supporting_doc'} onDone={(failures) => (failures.length ? push('error', failures.join(' ')) : (push('success', 'File attached.'), load()))} />
                )}
              </div>
              <FileList files={task.attachments} onOpen={setViewer} onRemove={removeFile} canRemove={(f) => open && (f.uploaded_by === user?.id || (task.viewer.kinds.includes('manager') && !isAssignee))} />
            </Card>

            <Card className="space-y-3 p-4">
              <div className="flex items-center justify-between gap-2">
                <SectionTitle icon={<Flag className="h-4 w-4" />} count={task.blockers.length}>
                  Blockers
                </SectionTitle>
                {allowed.has('raise_blocker') && (
                  <Button size="xs" variant="secondary" leftIcon={<Flag className="h-3.5 w-3.5" />} onClick={() => setDialog('raise_blocker')}>
                    Raise blocker
                  </Button>
                )}
              </div>
              {/* When this viewer cannot raise one, say why instead of leaving the section silent. */}
              {!allowed.has('raise_blocker') && open && <p className="text-[11px] text-[#4A5568]">{blockerUnavailableReason}</p>}
              {task.blockers.length === 0 ? (
                <p className="text-xs text-[#6B7280]">No blockers raised.</p>
              ) : (
                <ul className="space-y-3">
                  {task.blockers.map((b) => (
                    <li key={b.id} className="space-y-1 rounded-[10px] border border-[#ECE9E2] p-3">
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
              <Card className="space-y-3 p-4">
                <SectionTitle icon={<Clock className="h-4 w-4" />} count={task.deadline_changes.length}>
                  Deadline changes
                </SectionTitle>
                <ul className="space-y-2">
                  {task.deadline_changes.map((c) => (
                    <li key={c.id} className="border-l-2 border-[#0F5E63] pl-2 text-xs">
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
              <Card className="space-y-3 p-4">
                <SectionTitle icon={<ArrowRightLeft className="h-4 w-4" />} count={task.assignment_history.length}>
                  Reassignments
                </SectionTitle>
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
              <Card className="space-y-3 p-4">
                <SectionTitle icon={<ShieldAlert className="h-4 w-4" />} count={task.escalations.length}>
                  Escalations
                </SectionTitle>
                <ul className="space-y-3">
                  {task.escalations.map((e) => (
                    <EscalationRow key={e.id} esc={e} mine={e.escalated_to === user?.id} onChanged={(d, m) => done(d, m)} onError={(m) => push('error', m)} />
                  ))}
                </ul>
              </Card>
            )}
          </div>
        </div>
  );

  if (variant === 'popup') {
    const tile = 'rounded-[12px] border border-[#ECE9E2] bg-[#FBFAF7] px-3 py-2.5';
    const tileLabel = 'text-[10px] font-semibold uppercase tracking-wider text-[#4A5568]';
    return (
      <div className="space-y-4">
        {/* Where it stands (the board's columns), how urgent, and what it is about. Title and number sit in the dialog header. */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <StatusTrack status={task.status} approvalRequired={task.approval_required} />
          <div className="flex items-center gap-1.5">
            <PriorityBadge priority={task.priority} />
            <DelayBadge delay={task.delay_class} />
          </div>
        </div>
        {chips}

        {conflict && <TaskConflictCallout onRefresh={load} />}
        {ob && (
          <InfoCallout variant={ob.status === 'accepted' ? 'info' : 'warning'} title={`Blocked: ${blockerTypeLabel(ob.blocker_type)} (${TASK_BLOCKER_STATUS_LABELS[ob.status]})`}>
            <p className="line-clamp-2 text-sm">“{ob.description}”</p>
          </InfoCallout>
        )}

        {/* The three things to know at a glance */}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <div className={tile}>
            <div className={tileLabel}>Due</div>
            <div className={`mt-0.5 text-sm font-semibold ${dueTone}`}>{dueHeadline}</div>
            {task.deadline && <DateTime value={task.deadline} className="text-[11px] text-[#4A5568]" />}
          </div>
          <div className={tile}>
            <div className={tileLabel}>Assignee</div>
            <div className="mt-1 text-sm">
              <Person name={task.assignee_name} note={task.assignee_active === false ? 'inactive' : undefined} />
            </div>
            <div className="mt-0.5 text-[11px] text-[#4A5568]">Assigned by {task.assigned_by_name || 'System'}</div>
          </div>
          <div className={tile}>
            <div className={tileLabel}>Approval</div>
            {task.approval_required ? (
              <>
                <div className="mt-0.5 text-sm font-semibold text-[#14213D]">{approvers}</div>
                <div className={`text-[11px] ${task.status === 'awaiting_approval' ? 'font-semibold text-[#A15C07]' : 'text-[#4A5568]'}`}>
                  {task.status === 'awaiting_approval' ? 'Waiting for sign-off now' : 'Approves when it is marked done'}
                </div>
              </>
            ) : (
              <div className="mt-0.5 text-sm text-[#4A5568]">Not required</div>
            )}
          </div>
        </div>

        {(task.description || task.expected_outcome) && (
          <div className="space-y-2">
            {task.description && <p className="line-clamp-4 whitespace-pre-wrap break-words text-sm leading-relaxed text-[#14213D]">{task.description}</p>}
            {task.expected_outcome && (
              <p className="line-clamp-3 rounded-[10px] border border-[#D0E5E3] bg-[#E3EFEE]/50 px-3 py-2 text-sm text-[#14213D]">
                <span className="font-semibold text-[#0F5E63]">Expected outcome: </span>
                {task.expected_outcome}
              </p>
            )}
          </div>
        )}

        <dl className="grid grid-cols-1 gap-x-8 gap-y-1 rounded-[12px] border border-[#ECE9E2] px-4 py-3 sm:grid-cols-2 [&>div]:py-1">{detailRows}</dl>

        {showAll && (
          <div className="space-y-4 border-t border-[#ECE9E2] pt-4 animate-in fade-in duration-150">
            {fullSections}
          </div>
        )}
        {/* Footer pinned to the bottom of the popup, so the actions (pencil at the far right) stay in reach while scrolling */}
        <div className="sticky -bottom-4 z-10 -mx-4 -mb-4 flex flex-col-reverse gap-3 border-t border-[#ECE9E2] bg-white px-4 py-3 sm:-bottom-5 sm:-mx-5 sm:-mb-5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <button
            type="button"
            aria-expanded={showAll}
            onClick={() => setShowAll((x) => !x)}
            className="inline-flex items-center gap-1 self-start text-xs font-semibold text-[#0F5E63] hover:underline"
          >
            {showAll ? 'Hide full details' : 'Show full details (activity, files, history)'}
            {showAll ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
          {(primary.length > 0 || secondary.length > 0) && (
            <div className="flex flex-wrap items-center gap-2">
              {primary.map((p, i) => (
                <Button key={p.action} size="sm" variant={p.variant || (i === 0 ? 'primary' : 'secondary')} leftIcon={p.icon} onClick={() => setDialog(p.action)}>
                  {p.label}
                </Button>
              ))}
              {secondary.length > 0 && (
                <RowMenu
                  label="Edit, reassign and more"
                  icon={<Pencil className="h-4 w-4" />}
                  items={secondary.map((sec) => ({ key: sec.action, label: sec.label, icon: sec.icon, danger: sec.danger, onSelect: () => onSecondary(sec.action) }))}
                />
              )}
            </div>
          )}
        </div>
        {overlays}
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0">
      {/* Header: identity, title, links, due and the actions this user may take */}
      <Card className={`overflow-hidden p-0 ${task.is_overdue ? 'border-l-[3px] border-l-[#9A3412]' : ''}`}>
        <div className="flex flex-wrap items-center gap-2 border-b border-[#ECE9E2] bg-[#FBFAF7] px-4 py-2.5 sm:px-5">
          <Button variant="ghost" size="xs" leftIcon={<ArrowLeft className="h-3.5 w-3.5" />} onClick={() => router.back()}>
            Back
          </Button>
          <span aria-hidden className="h-4 w-px bg-[#DCD8CE]" />
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

        <div className="grid grid-cols-1 gap-5 p-4 sm:p-5 lg:grid-cols-[1fr_auto]">
          <div className="min-w-0 space-y-3">
            <h2 className="font-serif text-2xl leading-tight text-[#14213D] break-words">{task.title}</h2>
            <StatusTrack status={task.status} approvalRequired={task.approval_required} />
            {chips}
          </div>

          {/* Due */}
          <div className="flex items-stretch gap-3 lg:min-w-[260px]">
            <div className="flex-1 rounded-[12px] border border-[#ECE9E2] bg-[#FBFAF7] px-4 py-3">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-[#4A5568]">Deadline</div>
              <div className={`mt-0.5 text-lg font-semibold leading-tight ${dueTone}`}>{dueHeadline}</div>
              {task.deadline && <DateTime value={task.deadline} className="text-xs text-[#4A5568]" />}
              {deadlineMoved && (
                <div className="mt-1 text-[11px] text-[#6B7280]">
                  Originally <DateTime value={task.original_deadline} />
                </div>
              )}
            </div>
          </div>
        </div>

        {(primary.length > 0 || secondary.length > 0) && (
          <div className="hidden flex-wrap items-center gap-2 border-t border-[#ECE9E2] px-5 py-3 md:flex">
            {primary.map((p, i) => (
              <Button key={p.action} size="sm" variant={p.variant || (i === 0 ? 'primary' : 'secondary')} leftIcon={p.icon} onClick={() => setDialog(p.action)}>
                {p.label}
              </Button>
            ))}
            {secondary.length > 0 && <RowMenu label="More task actions" buttonLabel="More" items={secondary.map((s) => ({ key: s.action, label: s.label, icon: s.icon, danger: s.danger, onSelect: () => onSecondary(s.action) }))} />}
          </div>
        )}
      </Card>

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

      {fullSections}

      {/* Mobile sticky action bar */}
      {(primary.length > 0 || secondary.length > 0) && (
        <div className="md:hidden fixed bottom-0 inset-x-0 z-30 border-t border-[#DCD8CE] bg-white/95 backdrop-blur px-3 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] flex items-center gap-2">
          {primary.slice(0, 2).map((p, i) => (
            <Button key={p.action} size="md" className="flex-1 whitespace-nowrap" variant={i === 0 ? 'primary' : 'secondary'} leftIcon={p.icon} onClick={() => setDialog(p.action)}>
              <span className="truncate">{p.short || p.label}</span>
            </Button>
          ))}
          {(primary.length > 2 || secondary.length > 0) && (
            // the ⋮ button matches the 40px action buttons beside it
            <span className="shrink-0 [&>button]:!h-10 [&>button]:!w-10">
              <RowMenu
                label="More task actions"
                items={[...primary.slice(2).map((p) => ({ key: p.action, label: p.label, icon: p.icon, onSelect: () => setDialog(p.action) })), ...secondary.map((s) => ({ key: s.action, label: s.label, icon: s.icon, danger: s.danger, onSelect: () => onSecondary(s.action) }))]}
              />
            </span>
          )}
        </div>
      )}

      {overlays}
    </div>
  );
};

// ------------------------------------------------------------------ layout helpers
const SectionTitle: React.FC<{ icon: React.ReactNode; count?: number; children: React.ReactNode }> = ({ icon, count, children }) => (
  <h3 className="flex items-center gap-2 font-serif text-base font-semibold text-[#14213D]">
    <span className="text-[#0F5E63]">{icon}</span>
    {children}
    {count !== undefined && count > 0 && <span className="rounded-full border border-[#DCD8CE] bg-[#FBFAF7] px-1.5 py-px font-mono text-[10px] font-semibold text-[#4A5568]">{count}</span>}
  </h3>
);

const SideRow: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex items-start justify-between gap-3 py-2 first:pt-0 last:pb-0">
    <dt className="shrink-0 pt-0.5 text-xs text-[#4A5568]">{label}</dt>
    <dd className="min-w-0 text-right text-sm text-[#14213D] break-words [&_.font-mono]:text-[13px]">{children}</dd>
  </div>
);

const initialsOf = (name?: string | null) =>
  (name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');

const Person: React.FC<{ name?: string | null; note?: string }> = ({ name, note }) =>
  name ? (
    <span className="inline-flex items-center gap-2">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#E3EFEE] font-mono text-[10px] font-bold text-[#0F5E63]">{initialsOf(name)}</span>
      <span className="font-medium">{name}</span>
      {note && <span className="text-xs text-[#881337]">({note})</span>}
    </span>
  ) : (
    <span className="text-[#6B7280]">—</span>
  );

// ------------------------------------------------------------------ update box
const ProgressBox: React.FC<{
  task: TaskDetail;
  isAssignee: boolean;
  onSaved: (d: TaskDetail, msg: string) => void;
  onConflict: () => void;
  onError: (m: string) => void;
}> = ({ task, isAssignee, onSaved, onConflict, onError }) => {
  const [comment, setComment] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const camRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!comment.trim() && !files.length) {
      setError('Write an update or attach a photo / file.');
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
      });
      setComment('');
      setFiles([]);
      notifyTasksChanged();
      onSaved(d, isAssignee ? 'Update posted.' : 'Comment added.');
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
        <SectionTitle icon={<MessageSquare className="h-4 w-4" />}>{isAssignee ? 'Post an update' : 'Add a comment'}</SectionTitle>
        <Textarea label={isAssignee ? 'What happened since the last update?' : 'Comment to the assignee'} value={comment} onChange={(e) => setComment(e.target.value)} rows={3} maxLength={2000} placeholder={isAssignee ? 'e.g. Met the procurement officer; revised quote due Friday' : 'Your note is sent to the assignee'} />
        <div className="flex flex-wrap items-center gap-2">
          <input ref={fileRef} type="file" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,image/*" className="hidden" onChange={(e) => e.target.files && setFiles([...files, ...Array.from(e.target.files)].slice(0, 5))} />
          <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => e.target.files && setFiles([...files, ...Array.from(e.target.files)].slice(0, 5))} />
          <Button type="button" size="sm" variant="secondary" className="h-10 sm:h-8" leftIcon={<Camera className="h-4 w-4" />} onClick={() => camRef.current?.click()}>
            Photo
          </Button>
          <Button type="button" size="sm" variant="secondary" className="h-10 sm:h-8" leftIcon={<Paperclip className="h-4 w-4" />} onClick={() => fileRef.current?.click()}>
            File
          </Button>
          {files.map((f, i) => (
            <Badge key={`${f.name}-${i}`} variant="outline" size="sm" className="max-w-full gap-1">
              <span className="min-w-0 truncate">{f.name}</span>
              <button type="button" aria-label={`Remove ${f.name}`} className="-my-1 shrink-0 p-1 sm:my-0 sm:p-0" onClick={() => setFiles(files.filter((_, j) => j !== i))}>
                ×
              </button>
            </Badge>
          ))}
          <Button type="submit" size="sm" className="ml-auto h-10 sm:h-8" isLoading={busy} leftIcon={<Send className="h-4 w-4" />}>
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
          {ESCALATION_STATUS_LABELS[esc.status] || String(esc.status || '').replace(/_/g, ' ')}
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
              <div className="flex flex-wrap gap-2">
                <Button size="xs" variant="ghost" onClick={() => setClosing(false)} disabled={busy}>
                  Back
                </Button>
                <Button size="xs" isLoading={busy} onClick={() => act('close')}>
                  Close escalation
                </Button>
              </div>
            </>
          ) : (
            <div className="flex flex-wrap gap-2">
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
      <form onSubmit={save}>
        <FormSteps
          maxSteps={1}
          onCancel={onClose}
          busy={busy}
          banner={(errors._ || errors.deadline || errors.version) && <InfoCallout variant="danger">{errors._ || errors.deadline || errors.version}</InfoCallout>}
          submit={
            <Button type="submit" isLoading={busy}>
              Save changes
            </Button>
          }
          steps={[
            {
              title: 'Details',
              icon: <Pencil />,
              description: 'What the task is and what a good result looks like.',
              content: (
                <div className="space-y-3">
                  <Input label="Title *" value={v.title} onChange={(e) => set('title', e.target.value)} maxLength={200} error={errors.title} />
                  <Textarea label="Description" value={v.description} onChange={(e) => set('description', e.target.value)} rows={3} maxLength={5000} error={errors.description} />
                  <Textarea label="Expected outcome" value={v.expected_outcome} onChange={(e) => set('expected_outcome', e.target.value)} rows={2} maxLength={1000} error={errors.expected_outcome} />
                </div>
              ),
            },
            {
              title: 'Category',
              icon: <Flag />,
              description: 'How urgent it is, what kind of work it is, and the record it belongs to.',
              content: (
                <div className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Select label="Priority" value={v.priority} onChange={(e) => set('priority', e.target.value)} options={TASK_PRIORITIES.map((p) => ({ value: p, label: TASK_PRIORITY_LABELS[p] }))} error={errors.priority} />
                    <Select label="Category" value={v.category_id} onChange={(e) => set('category_id', e.target.value)} options={categories.map((c) => ({ value: c.id, label: c.name }))} error={errors.category_id} />
                  </div>
                  {cat?.requires_link_type === 'customer' && <LinkPicker type="customer" required value={v.customer_id} onChange={(id) => set('customer_id', id)} error={errors.customer_id} />}
                  {cat?.requires_link_type === 'tender' && <LinkPicker type="tender" required value={v.tender_id} onChange={(id) => set('tender_id', id)} error={errors.tender_id} />}
                  {cat?.requires_link_type === 'demo' && <LinkPicker type="demo" value={v.demo_id} onChange={(id) => set('demo_id', id)} error={errors.demo_id} helperText="Or link the customer below." />}
                  {cat?.requires_link_type === 'service' && <LinkPicker type="service" value={v.service_ticket_id} onChange={(id) => set('service_ticket_id', id)} error={errors.service_ticket_id} helperText="Or link the customer below." />}
                  {cat?.requires_link_type && cat.requires_link_type !== 'customer' && cat.requires_link_type !== 'tender' && <LinkPicker type="customer" value={v.customer_id} onChange={(id) => set('customer_id', id)} error={errors.customer_id} />}
                </div>
              ),
            },
            {
              title: 'Rules',
              icon: <ShieldAlert />,
              description: 'What is needed to finish it, and why you are making this change.',
              content: (
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-4 text-sm">
                    <label className="inline-flex items-center gap-2">
                      <input type="checkbox" checked={v.evidence_required} onChange={(e) => set('evidence_required', e.target.checked)} className="accent-[#0F5E63] h-4 w-4" /> Evidence required
                    </label>
                    <label className="inline-flex items-center gap-2">
                      <input type="checkbox" checked={v.approval_required} onChange={(e) => set('approval_required', e.target.checked)} className="accent-[#0F5E63] h-4 w-4" /> Approval required
                    </label>
                  </div>
                  <Input label="Reason for the change (optional)" value={v.reason} onChange={(e) => set('reason', e.target.value)} maxLength={500} />
                </div>
              ),
            },
          ]}
        />
      </form>
    </Modal>
  );
};
