'use client';

/**
 * Every task workflow action as a dialog: complete (remarks, evidence with camera capture, delay reason),
 * raise blocker (type-specific fields), accept (extend vs pause) / reject / resolve / withdraw blocker,
 * extend, reassign, escalate, cancel, reopen, send back, approve, admin correction.
 * The server re-checks permission, status and version for every call; a 409 offers a refresh.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Camera, Paperclip, X } from 'lucide-react';
import { Button, Checkbox, InfoCallout, Input, Modal, Select, Textarea } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import {
  TASK_BLOCKER_REQUIREMENTS,
  TASK_BLOCKER_TYPES,
  TASK_BLOCKER_TYPE_LABELS,
  TASK_MIN_BLOCKER_DESCRIPTION,
  TASK_MIN_COMMENT_LENGTH,
  TASK_MIN_EVIDENCE_REMARKS,
  TASK_REASSIGN_REASONS,
  TASK_REASSIGN_REASON_LABELS,
  TASK_STATUSES,
  TASK_STATUS_LABELS,
  formatTaskDateTime,
  type TaskBlockerType,
} from '@arihant/shared';
import { errorMessage, fieldErrors, isConflict, istToday, notifyTasksChanged, type AssigneeOption, type TaskDetail } from './task-lib';
import { DeadlineInput, LinkPicker, UserSelect, useActiveUsers } from './pickers';

export type TaskDialogAction =
  | 'start'
  | 'complete'
  | 'approve'
  | 'send_back'
  | 'reopen'
  | 'cancel'
  | 'extend_deadline'
  | 'reassign'
  | 'escalate'
  | 'raise_blocker'
  | 'accept_blocker'
  | 'reject_blocker'
  | 'resolve_blocker'
  | 'withdraw_blocker'
  | 'correction';

/** Minimal task shape the dialogs need (list rows and detail both satisfy it). */
export type ActionTask = Pick<
  TaskDetail,
  'id' | 'task_number' | 'title' | 'version' | 'status' | 'deadline' | 'progress_percent' | 'evidence_required' | 'approval_required' | 'assigned_to' | 'customer_id' | 'is_overdue' | 'open_blocker' | 'start_date'
>;

const COPY: Record<TaskDialogAction, { title: string; description: string; confirm: string; danger?: boolean }> = {
  start: { title: 'Start task', description: 'Marks the task In Progress.', confirm: 'Start' },
  complete: { title: 'Complete task', description: 'Hand in the work. Remarks and evidence are part of the record.', confirm: 'Complete' },
  approve: { title: 'Approve completion', description: 'Confirms the work meets the expected outcome.', confirm: 'Approve' },
  send_back: { title: 'Send back for rework', description: 'The task returns to In Progress and the rework is recorded.', confirm: 'Send back', danger: true },
  reopen: { title: 'Reopen task', description: 'Moves a completed task back to In Progress. The reopen is recorded.', confirm: 'Reopen', danger: true },
  cancel: { title: 'Cancel task', description: 'Cancelled tasks are kept in history and excluded from compliance metrics.', confirm: 'Cancel task', danger: true },
  extend_deadline: { title: 'Extend deadline', description: 'The original deadline is kept for honest measurement; time already overdue stays unexcused.', confirm: 'Extend' },
  reassign: { title: 'Reassign task', description: 'The new assignee is notified; the previous assignee keeps a read-only record.', confirm: 'Reassign' },
  escalate: { title: 'Escalate', description: 'The person you escalate to can act on this task with manager powers.', confirm: 'Escalate' },
  raise_blocker: { title: 'Raise a blocker', description: 'Tell your manager what is stopping you. They can accept it (deadline relief), reject it, reassign or escalate.', confirm: 'Raise blocker' },
  accept_blocker: { title: 'Accept blocker', description: 'A genuine dependency: the delay it causes will be excused.', confirm: 'Accept' },
  reject_blocker: { title: 'Reject blocker', description: 'The task returns to its previous status. Any delay counts as unapproved.', confirm: 'Reject', danger: true },
  resolve_blocker: { title: 'Mark blocker resolved', description: 'Work resumes. For a paused deadline, the blocked time is added back automatically.', confirm: 'Resolve' },
  withdraw_blocker: { title: 'Withdraw blocker', description: 'Withdraw a blocker that is still waiting for review.', confirm: 'Withdraw' },
  correction: { title: 'Admin correction', description: 'Fixes data with a recorded reason. Use only for genuine mistakes.', confirm: 'Apply correction', danger: true },
};

const ENDPOINT = (a: TaskDialogAction, task: ActionTask): string => {
  const b = task.open_blocker?.id;
  switch (a) {
    case 'raise_blocker':
      return `/tasks/${task.id}/blockers`;
    case 'accept_blocker':
      return `/task-blockers/${b}/accept`;
    case 'reject_blocker':
      return `/task-blockers/${b}/reject`;
    case 'resolve_blocker':
      return `/task-blockers/${b}/resolve`;
    case 'withdraw_blocker':
      return `/task-blockers/${b}/withdraw`;
    default:
      return `/tasks/${task.id}/${a.replace(/_/g, '-')}`;
  }
};

const isMobileCapable = () => typeof window !== 'undefined' && 'ontouchstart' in window;

/** File picker that also offers the camera on phones. */
const FilePick: React.FC<{ files: File[]; onChange: (f: File[]) => void; label: string; error?: string; accept?: string }> = ({ files, onChange, label, error, accept = '.pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,image/*,application/pdf' }) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);
  const add = (list: FileList | null) => list && onChange([...files, ...Array.from(list)].slice(0, 10));
  return (
    <div>
      <span className="block text-xs font-semibold text-[#14213D] mb-1.5">{label}</span>
      <input ref={fileRef} type="file" multiple accept={accept} className="hidden" onChange={(e) => add(e.target.files)} />
      <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => add(e.target.files)} />
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="secondary" leftIcon={<Paperclip className="h-4 w-4" />} onClick={() => fileRef.current?.click()}>
          Attach files
        </Button>
        {isMobileCapable() && (
          <Button type="button" size="sm" variant="secondary" leftIcon={<Camera className="h-4 w-4" />} onClick={() => camRef.current?.click()}>
            Take photo
          </Button>
        )}
      </div>
      {files.length > 0 && (
        <ul className="mt-2 space-y-1">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex items-center gap-2 text-xs text-[#14213D]">
              <Paperclip className="h-3 w-3 text-[#4A5568]" />
              <span className="truncate flex-1">{f.name}</span>
              <span className="text-[#8A8578] font-mono">{Math.max(1, Math.round(f.size / 1024))} KB</span>
              <button type="button" aria-label={`Remove ${f.name}`} onClick={() => onChange(files.filter((_, j) => j !== i))} className="text-[#8A8578] hover:text-[#881337]">
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[11px] text-[#4A5568] mt-1">PDF, Word, Excel, JPG or PNG · up to 10 MB each.</p>
      {error && <p className="text-xs text-[#881337] mt-1">{error}</p>}
    </div>
  );
};

export async function uploadTaskFiles(taskId: string, files: File[], purpose: string, relatedId?: string) {
  const failures: string[] = [];
  for (const f of files) {
    const form = new FormData();
    form.append('purpose', purpose);
    if (relatedId) form.append('related_id', relatedId);
    form.append('file', f);
    try {
      await api.upload(`/tasks/${taskId}/attachments`, form);
    } catch (e) {
      const errs = fieldErrors(e);
      failures.push(`${f.name}: ${errs.file || errorMessage(e)}`);
    }
  }
  return failures;
}

export const TaskActionDialog: React.FC<{
  action: TaskDialogAction | null;
  task: ActionTask | null;
  onClose: () => void;
  onDone: (detail: TaskDetail, message: string) => void;
  onConflict: () => void;
  /** Pre-filled values, e.g. { reason_type: 'deactivation' } when reassigning an inactive employee's work. */
  initial?: Record<string, unknown>;
}> = ({ action, task, onClose, onDone, onConflict, initial }) => {
  const { user } = useAuth();
  const [v, setV] = useState<Record<string, any>>({});
  const [files, setFiles] = useState<File[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [assignees, setAssignees] = useState<AssigneeOption[]>([]);
  const [leaves, setLeaves] = useState<{ id: string; from_date: string; to_date: string; leave_type: string }[]>([]);
  const users = useActiveUsers([task?.assigned_to, user?.id]);

  useEffect(() => {
    if (!action || !task) return;
    const defaults = action === 'accept_blocker' ? { mode: 'pause' } : action === 'reassign' ? { reason_type: 'workload' } : action === 'raise_blocker' ? { blocker_type: '' } : {};
    setV({ ...defaults, ...(initial || {}) });
    setFiles([]);
    setErrors({});
    setMessage(null);
    if (action === 'reassign') api.get<AssigneeOption[]>('/tasks/lookups/assignees').then((r) => setAssignees(r.filter((a) => a.id !== task.assigned_to && a.scope !== 'self'))).catch(() => setAssignees([]));
    if (action === 'raise_blocker' && task.assigned_to) {
      api.get<any[]>('/task-calendar/leaves', { employee_id: task.assigned_to, from: istToday() }).then(setLeaves).catch(() => setLeaves([]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action, task]);

  if (!action || !task) return null;
  const copy = COPY[action];
  const set = (k: string, val: unknown) => setV((p) => ({ ...p, [k]: val }));
  const late = Boolean(task.deadline && new Date(task.deadline).getTime() < Date.now());

  const clientCheck = (): Record<string, string> => {
    const e: Record<string, string> = {};
    const need = (k: string, min = TASK_MIN_COMMENT_LENGTH, label = 'This') => {
      if (!v[k] || String(v[k]).trim().length < min) e[k] = `${label} needs at least ${min} characters.`;
    };
    switch (action) {
      case 'complete':
        if (task.evidence_required) need('remarks', TASK_MIN_EVIDENCE_REMARKS, 'Completion remarks');
        if (task.evidence_required && !files.length) e.evidence = 'Attach at least one evidence file (photo, signed document…).';
        if (late) need('delay_reason', 10, 'Reason for delay');
        if (task.progress_percent < 100 && !v.confirm_full_completion) e.confirm_full_completion = 'Confirm the work is fully complete.';
        break;
      case 'raise_blocker': {
        if (!v.blocker_type) e.blocker_type = 'Choose what is blocking you.';
        need('description', TASK_MIN_BLOCKER_DESCRIPTION, 'Description');
        const req = v.blocker_type ? TASK_BLOCKER_REQUIREMENTS[v.blocker_type as TaskBlockerType] : null;
        if (req?.field && req.field !== 'leave_id' && req.field !== 'dependency_customer_id' && !v[req.field]) e[req.field] = `${req.label} is required.`;
        if (req?.field === 'dependency_customer_id' && !v.dependency_customer_id && !task.customer_id) e.dependency_customer_id = 'Choose the customer.';
        break;
      }
      case 'accept_blocker':
        need('comment', TASK_MIN_COMMENT_LENGTH, 'Comment');
        if (v.mode === 'extend' && !v.new_deadline) e.new_deadline = 'Pick the new deadline.';
        break;
      case 'reject_blocker':
        need('comment', TASK_MIN_COMMENT_LENGTH, 'Comment');
        break;
      case 'resolve_blocker':
        need('note', TASK_MIN_COMMENT_LENGTH, 'Resolution note');
        break;
      case 'extend_deadline':
        if (!v.new_deadline) e.new_deadline = 'Pick the new deadline.';
        need('reason', TASK_MIN_COMMENT_LENGTH, 'Reason');
        break;
      case 'reassign':
        if (!v.to_user_id) e.to_user_id = 'Choose the new assignee.';
        need('reason', TASK_MIN_COMMENT_LENGTH, 'Reason');
        break;
      case 'escalate':
      case 'cancel':
      case 'reopen':
      case 'send_back':
      case 'correction':
        need('reason', TASK_MIN_COMMENT_LENGTH, 'Reason');
        break;
    }
    return e;
  };

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    const e = clientCheck();
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    setMessage(null);
    try {
      let version = task.version;
      if (action === 'complete' && files.length) {
        const failures = await uploadTaskFiles(task.id, files, 'evidence');
        if (failures.length) {
          setErrors({ evidence: failures.join(' ') });
          setBusy(false);
          return;
        }
      }
      const body: Record<string, unknown> = { ...v, version };
      if (action === 'raise_blocker' && v.blocker_type === 'customer_dependency' && !v.dependency_customer_id) body.dependency_customer_id = task.customer_id;
      if (action === 'correction') {
        if (!body.status) delete body.status;
        if (body.progress_percent === '' || body.progress_percent === undefined) delete body.progress_percent;
        if (!body.deadline) delete body.deadline;
      }
      const detail = await api.post<TaskDetail>(ENDPOINT(action, task), body);
      version = detail.version;
      let note = '';
      if (action === 'raise_blocker' && files.length) {
        const blockerId = detail.blockers?.find((b) => b.open)?.id;
        const failures = await uploadTaskFiles(task.id, files, 'blocker_evidence', blockerId);
        if (failures.length) note = ` Some files were not attached: ${failures.join(' ')}`;
      }
      notifyTasksChanged();
      const msgs: Partial<Record<TaskDialogAction, string>> = {
        complete: detail.status === 'awaiting_approval' ? 'Submitted for approval.' : 'Task completed.',
        raise_blocker: detail.open_blocker?.status === 'accepted' ? 'Blocker raised and accepted automatically (approved leave).' : 'Blocker raised — your manager has been notified.',
        approve: 'Completion approved.',
        accept_blocker: 'Blocker accepted.',
        reject_blocker: 'Blocker rejected.',
        resolve_blocker: 'Blocker resolved — work resumes.',
      };
      onDone(detail, (msgs[action] || `${copy.title} done.`) + note);
    } catch (err) {
      if (isConflict(err) && (err as any)?.data?.code === 'STALE_VERSION') {
        onConflict();
        onClose();
        return;
      }
      const errs = fieldErrors(err);
      setErrors(errs);
      if (!Object.keys(errs).length) setMessage(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const req = v.blocker_type ? TASK_BLOCKER_REQUIREMENTS[v.blocker_type as TaskBlockerType] : null;
  const commentField = (field: string, label: string, placeholder: string, required = true) => (
    <Textarea label={`${label}${required ? ' *' : ''}`} value={v[field] || ''} onChange={(e) => set(field, e.target.value)} rows={3} maxLength={2000} placeholder={placeholder} error={errors[field]} />
  );
  const optionalNewDeadline = (
    <DeadlineInput label="New deadline (optional)" value={v.new_deadline || ''} min={istToday()} onChange={(x) => set('new_deadline', x)} error={errors.new_deadline} helperText="Give extra time for the rework if the delay is not the employee's fault." />
  );

  return (
    <Modal isOpen onClose={busy ? () => undefined : onClose} title={copy.title} description={`${task.task_number} · ${task.title}`} maxWidth="lg">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <p className="text-xs text-[#4A5568]">{copy.description}</p>

        {action === 'complete' && (
          <>
            {late && (
              <InfoCallout variant="warning" title="This task is past its deadline">
                Deadline was {formatTaskDateTime(task.deadline)}. A reason for the delay is required.
              </InfoCallout>
            )}
            {commentField('remarks', 'Completion remarks', task.evidence_required ? `What was done (at least ${TASK_MIN_EVIDENCE_REMARKS} characters)` : 'What was done', task.evidence_required)}
            {late && commentField('delay_reason', 'Reason for delay', 'Why was this finished after the deadline?')}
            <FilePick files={files} onChange={setFiles} label={task.evidence_required ? 'Evidence *' : 'Evidence (optional)'} error={errors.evidence} />
            {task.progress_percent < 100 && (
              <Checkbox
                checked={Boolean(v.confirm_full_completion)}
                onChange={(e) => set('confirm_full_completion', e.target.checked)}
                label={`Progress is ${task.progress_percent}% — I confirm the work is fully complete`}
                description="Progress will be set to 100%."
              />
            )}
            {errors.confirm_full_completion && <p className="text-xs text-[#881337]">{errors.confirm_full_completion}</p>}
            {task.approval_required && <p className="text-xs text-[#4A5568]">This task needs approval — it will go to your manager.</p>}
          </>
        )}

        {action === 'raise_blocker' && (
          <>
            <Select
              label="What is blocking you? *"
              value={v.blocker_type || ''}
              onChange={(e) => set('blocker_type', e.target.value)}
              error={errors.blocker_type}
              options={[{ value: '', label: 'Choose a blocker type…' }, ...TASK_BLOCKER_TYPES.map((t) => ({ value: t, label: TASK_BLOCKER_TYPE_LABELS[t] }))]}
            />
            {req && <p className="text-[11px] text-[#4A5568] -mt-2">{req.hint}</p>}
            {req?.field === 'dependency_user_id' && <UserSelect label="Waiting on *" value={v.dependency_user_id || ''} onChange={(x) => set('dependency_user_id', x)} users={users} error={errors.dependency_user_id} />}
            {req?.field === 'dependency_customer_id' && (
              <LinkPicker type="customer" value={v.dependency_customer_id || task.customer_id || ''} onChange={(id) => set('dependency_customer_id', id)} required error={errors.dependency_customer_id} />
            )}
            {req?.field === 'vendor_name' && <Input label="Vendor / reference *" value={v.vendor_name || ''} onChange={(e) => set('vendor_name', e.target.value)} maxLength={200} error={errors.vendor_name} />}
            {req?.field === 'portal_name' && <Input label="Portal *" value={v.portal_name || ''} onChange={(e) => set('portal_name', e.target.value)} maxLength={200} placeholder="e.g. GeM" error={errors.portal_name} />}
            {req?.field === 'approval_pending_from' && <Input label="Approval pending from *" value={v.approval_pending_from || ''} onChange={(e) => set('approval_pending_from', e.target.value)} maxLength={200} error={errors.approval_pending_from} />}
            {req?.field === 'leave_id' && (
              <Select
                label="Approved leave"
                value={v.leave_id || ''}
                onChange={(e) => set('leave_id', e.target.value)}
                error={errors.leave_id}
                helperText={leaves.length ? 'Leave recorded by your manager.' : 'No approved leave is recorded for you yet — ask your manager to record it.'}
                options={[{ value: '', label: leaves.length ? 'Pick the matching leave (or leave blank to auto-match)' : 'No approved leave found' }, ...leaves.map((l) => ({ value: l.id, label: `${l.from_date} → ${l.to_date} (${l.leave_type.replace('_', ' ')})` }))]}
              />
            )}
            <Textarea
              label="Describe the blocker *"
              value={v.description || ''}
              onChange={(e) => set('description', e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="What exactly are you waiting for, from whom, since when?"
              error={errors.description}
              helperText={`${(v.description || '').trim().length}/${TASK_MIN_BLOCKER_DESCRIPTION} characters minimum`}
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input label="Expected resolution" type="date" min={istToday()} value={v.expected_resolution_date || ''} onChange={(e) => set('expected_resolution_date', e.target.value)} error={errors.expected_resolution_date} />
              <Input label="Request a new deadline" type="date" min={istToday()} value={v.requested_new_deadline || ''} onChange={(e) => set('requested_new_deadline', e.target.value)} error={errors.requested_new_deadline} />
            </div>
            <FilePick files={files} onChange={setFiles} label={v.blocker_type === 'external_portal_issue' ? 'Screenshot (recommended)' : 'Supporting file (optional)'} />
            {late && <InfoCallout variant="warning">The deadline has already passed — this blocker will be flagged as raised after the deadline.</InfoCallout>}
          </>
        )}

        {action === 'accept_blocker' && (
          <>
            <fieldset className="space-y-2">
              <legend className="text-xs font-semibold text-[#14213D] mb-1">How should the deadline change?</legend>
              {[
                { id: 'pause', title: 'Pause the clock', text: 'When the blocker is resolved, the deadline moves out by the time it was blocked.' },
                { id: 'extend', title: 'Set a new deadline now', text: 'Pick the new deadline yourself.' },
              ].map((o) => (
                <label key={o.id} className={`flex cursor-pointer gap-3 rounded-lg border p-3 ${v.mode === o.id ? 'border-[#0F5E63] bg-[#E3EFEE]/50' : 'border-[#DCD8CE]'}`}>
                  <input type="radio" name="mode" value={o.id} checked={v.mode === o.id} onChange={() => set('mode', o.id)} className="mt-0.5 accent-[#0F5E63]" />
                  <span>
                    <span className="block text-sm font-semibold text-[#14213D]">{o.title}</span>
                    <span className="block text-xs text-[#4A5568]">{o.text}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            {v.mode === 'extend' && <DeadlineInput label="New deadline" required value={v.new_deadline || ''} min={istToday()} onChange={(x) => set('new_deadline', x)} error={errors.new_deadline} />}
            {task.open_blocker?.raised_after_deadline && (
              <InfoCallout variant="warning">Raised after the deadline — time already overdue before it was raised stays unexcused.</InfoCallout>
            )}
            {commentField('comment', 'Comment', 'Why is this a genuine dependency?')}
          </>
        )}

        {action === 'reject_blocker' && commentField('comment', 'Comment', 'Why is this not a genuine blocker? What should the employee do?')}
        {action === 'resolve_blocker' && commentField('note', 'Resolution note', 'What changed? e.g. "Customer shared the revised specs"')}
        {action === 'withdraw_blocker' && commentField('comment', 'Comment', 'Optional', false)}
        {action === 'approve' && commentField('comment', 'Comment', 'Optional note to the employee', false)}

        {action === 'extend_deadline' && (
          <>
            <DeadlineInput label="New deadline" required value={v.new_deadline || ''} min={istToday()} onChange={(x) => set('new_deadline', x)} error={errors.new_deadline} />
            {task.is_overdue && <InfoCallout variant="warning">This task is already overdue — that time stays unexcused; only the remaining delay is covered.</InfoCallout>}
            {commentField('reason', 'Reason', 'Why is more time needed?')}
          </>
        )}

        {action === 'reassign' && (
          <>
            <UserSelect label="New assignee *" value={v.to_user_id || ''} onChange={(x) => set('to_user_id', x)} users={assignees} error={errors.to_user_id} helperText="Your team (and colleagues for linked work)." />
            <Select
              label="Reason type *"
              value={v.reason_type || 'workload'}
              onChange={(e) => set('reason_type', e.target.value)}
              helperText="Only “Non-performance” counts against the previous assignee."
              options={TASK_REASSIGN_REASONS.map((r) => ({ value: r, label: TASK_REASSIGN_REASON_LABELS[r] }))}
            />
            <DeadlineInput label="New deadline (optional)" value={v.new_deadline || ''} min={istToday()} onChange={(x) => set('new_deadline', x)} error={errors.new_deadline} helperText="Leave empty to keep the current deadline." />
            {commentField('reason', 'Reason', 'Why is this being reassigned?')}
          </>
        )}

        {action === 'escalate' && (
          <>
            <UserSelect label="Escalate to" value={v.to_user_id || ''} onChange={(x) => set('to_user_id', x)} users={users} placeholder="Your own manager (default)" error={errors.to_user_id} />
            {commentField('reason', 'Reason', 'What decision or help is needed?')}
          </>
        )}

        {action === 'cancel' && commentField('reason', 'Reason', 'Why is this task no longer needed?')}
        {(action === 'reopen' || action === 'send_back') && (
          <>
            {commentField('reason', 'Reason', action === 'send_back' ? 'What is missing or needs to be redone?' : 'Why is this being reopened?')}
            {optionalNewDeadline}
          </>
        )}

        {action === 'correction' && (
          <>
            <InfoCallout variant="danger">Corrections are written to the task history and the audit log with your name and reason.</InfoCallout>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Select label="Status" value={v.status || ''} onChange={(e) => set('status', e.target.value)} error={errors.status} options={[{ value: '', label: 'Unchanged' }, ...TASK_STATUSES.map((s) => ({ value: s, label: TASK_STATUS_LABELS[s] }))]} />
              <Input label="Progress %" type="number" min={0} max={100} value={v.progress_percent ?? ''} onChange={(e) => set('progress_percent', e.target.value)} error={errors.progress_percent} />
            </div>
            <DeadlineInput label="Deadline" value={v.deadline || ''} onChange={(x) => set('deadline', x)} error={errors.deadline} helperText="Leave empty to keep it." />
            {commentField('reason', 'Reason', 'What was wrong and why is this correction needed?')}
          </>
        )}

        {message && <InfoCallout variant="danger">{message}</InfoCallout>}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            Back
          </Button>
          <Button type="submit" variant={copy.danger ? 'danger' : 'primary'} isLoading={busy} disabled={busy}>
            {copy.confirm}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
