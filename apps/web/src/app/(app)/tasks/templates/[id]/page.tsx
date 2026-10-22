'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, CalendarClock, History, Pause, Pencil, Play, Repeat, Square } from 'lucide-react';
import { Badge, Button, Card, Checkbox, FormSteps, InfoCallout, Input, Modal, PageContainer, PageHeader, PageLoader, Select, Textarea } from '@/components/ui';
import { api } from '@/lib/api';
import {
  TASK_HOLIDAY_POLICIES,
  TASK_HOLIDAY_POLICY_LABELS,
  TASK_LEAVE_POLICY_LABELS,
  TASK_MIN_COMMENT_LENGTH,
  TASK_PRIORITIES,
  TASK_PRIORITY_LABELS,
  TASK_RECURRENCE_LABELS,
  TASK_TEXT_LIMITS,
  formatTaskDate,
  formatTaskDateTime,
  istDateOf,
  type TaskHolidayPolicy,
  type TaskLeavePolicy,
  type TaskPriority,
  type TaskRecurrenceType,
  type TaskTemplateStatus,
} from '@arihant/shared';
import { errorMessage, fieldErrors, isConflict, notifyTasksChanged, type AssigneeOption, type TaskRow } from '../../_lib/task-lib';
import { DelayBadge, DialogActions, DueText, FlagChip, Meta, PriorityBadge, TaskConflictCallout, TaskStatusBadges, TasksNav, useToaster } from '../../_lib/task-ui';
import { UserSelect } from '../../_lib/pickers';
import { OccurrenceList, TemplateStatusBadge, describeDue, type OccurrencePreviewRow } from '../../_lib/TaskForm';

interface TemplateSkip {
  id: string;
  occurrence_date: string;
  reason: 'skipped_holiday' | 'skipped_leave' | 'skipped_collision' | string;
  detail: string | null;
}

interface TemplateDetail {
  id: string;
  title: string;
  description: string | null;
  expected_outcome: string | null;
  category_id: string;
  customer_id: string | null;
  tender_id: string | null;
  demo_id: string | null;
  service_ticket_id: string | null;
  project_id: string | null;
  assigned_to: string;
  assigned_by: string | null;
  priority: TaskPriority;
  evidence_required: boolean;
  approval_required: boolean;
  recurrence_type: TaskRecurrenceType;
  start_date: string;
  end_date: string | null;
  max_occurrences: number | null;
  due_offset_days: number;
  due_time: string;
  holiday_policy: TaskHolidayPolicy;
  leave_policy: TaskLeavePolicy;
  status: TaskTemplateStatus;
  status_reason: string | null;
  needs_reassignment: boolean;
  version: number;
  created_at: string;
  updated_at: string;
  assignee_name: string | null;
  assignee_active: boolean | null;
  assigned_by_name: string | null;
  category_name: string | null;
  customer_name: string | null;
  schedule: string;
  instances: TaskRow[];
  skips: TemplateSkip[];
  upcoming: OccurrencePreviewRow[];
  can_manage: boolean;
}

type MutationResult = TemplateDetail & {
  purged_future_instances?: number;
  updated_future_instances?: number;
  regenerated?: number;
  cancelled_future_instances?: number;
  generated?: number;
};

type StatusAction = 'pause' | 'resume' | 'end';

const SKIP_LABEL: Record<string, string> = {
  skipped_holiday: 'Skipped — holiday / weekly off',
  skipped_leave: 'Skipped — assignee on approved leave',
  skipped_collision: 'Skipped — clashed with another occurrence',
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const isStale = (e: unknown) => isConflict(e) && (e as any)?.data?.code === 'STALE_VERSION';

// ======================================================================== edit series
interface EditState {
  title: string;
  description: string;
  expected_outcome: string;
  priority: TaskPriority;
  evidence_required: boolean;
  approval_required: boolean;
  due_time: string;
  due_offset_days: string;
  end_date: string;
  max_occurrences: string;
  holiday_policy: TaskHolidayPolicy;
  leave_policy: TaskLeavePolicy;
  assigned_to: string;
}

const editStateOf = (t: TemplateDetail): EditState => ({
  title: t.title,
  description: t.description || '',
  expected_outcome: t.expected_outcome || '',
  priority: t.priority,
  evidence_required: t.evidence_required,
  approval_required: t.approval_required,
  due_time: (t.due_time || '18:00').slice(0, 5),
  due_offset_days: String(t.due_offset_days ?? 0),
  end_date: t.end_date || '',
  max_occurrences: t.max_occurrences ? String(t.max_occurrences) : '',
  holiday_policy: t.holiday_policy,
  leave_policy: t.leave_policy,
  assigned_to: t.assigned_to,
});

const EditSeriesModal: React.FC<{
  template: TemplateDetail;
  open: boolean;
  onClose: () => void;
  onSaved: (r: MutationResult) => void;
  onConflict: () => void;
}> = ({ template: t, open, onClose, onSaved, onConflict }) => {
  const [s, setS] = useState<EditState>(() => editStateOf(t));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [options, setOptions] = useState<AssigneeOption[]>([]);

  useEffect(() => {
    if (!open) return;
    setS(editStateOf(t));
    setErrors({});
    setMessage(null);
    api
      .get<AssigneeOption[]>('/tasks/lookups/assignees')
      .then(setOptions)
      .catch(() => setOptions([]));
  }, [open, t]);

  const linked = Boolean(t.customer_id || t.tender_id || t.demo_id || t.service_ticket_id);
  const users = useMemo(() => {
    const list: { id: string; full_name: string; role?: string }[] = options.filter((o) => linked || o.scope !== 'peer').map((o) => ({ id: o.id, full_name: o.full_name, role: o.role }));
    if (!list.some((u) => u.id === t.assigned_to)) list.unshift({ id: t.assigned_to, full_name: `${t.assignee_name || 'Current assignee'}${t.assignee_active === false ? ' — inactive' : ''}` });
    return list;
  }, [options, linked, t.assigned_to, t.assignee_name, t.assignee_active]);

  const set = (patch: Partial<EditState>) => {
    setS((p) => ({ ...p, ...patch }));
    setErrors((p) => {
      const next = { ...p };
      for (const k of Object.keys(patch)) delete next[k];
      return next;
    });
  };

  const buildPatch = (): Record<string, unknown> => {
    const p: Record<string, unknown> = {};
    const text = (v: string) => v.trim() || null;
    if (s.title.trim() !== t.title) p.title = s.title.trim();
    if (text(s.description) !== (t.description || null)) p.description = text(s.description);
    if (text(s.expected_outcome) !== (t.expected_outcome || null)) p.expected_outcome = text(s.expected_outcome);
    if (s.priority !== t.priority) p.priority = s.priority;
    if (s.evidence_required !== t.evidence_required) p.evidence_required = s.evidence_required;
    if (s.approval_required !== t.approval_required) p.approval_required = s.approval_required;
    if (s.due_time !== (t.due_time || '').slice(0, 5)) p.due_time = s.due_time;
    if (Number(s.due_offset_days) !== Number(t.due_offset_days)) p.due_offset_days = Number(s.due_offset_days);
    if ((s.end_date || null) !== (t.end_date || null)) p.end_date = s.end_date || null;
    const maxOcc = s.max_occurrences.trim() === '' ? null : Number(s.max_occurrences);
    if (maxOcc !== (t.max_occurrences ?? null)) p.max_occurrences = maxOcc;
    if (s.holiday_policy !== t.holiday_policy) p.holiday_policy = s.holiday_policy;
    if (s.leave_policy !== t.leave_policy) p.leave_policy = s.leave_policy;
    if (s.assigned_to !== t.assigned_to) p.assigned_to = s.assigned_to;
    return p;
  };

  const validate = (): Record<string, string> => {
    const e: Record<string, string> = {};
    if (!s.title.trim()) e.title = 'Title is required.';
    else if (s.title.trim().length > TASK_TEXT_LIMITS.title) e.title = `Title must be at most ${TASK_TEXT_LIMITS.title} characters.`;
    const off = Number(s.due_offset_days);
    if (s.due_offset_days.trim() === '' || !Number.isInteger(off) || off < 0 || off > 60) e.due_offset_days = 'Due after must be a whole number between 0 and 60.';
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(s.due_time)) e.due_time = 'Due time must be HH:mm.';
    if (s.end_date && s.end_date < t.start_date) e.end_date = 'End date must be on or after the start date.';
    if (s.max_occurrences.trim() !== '') {
      const n = Number(s.max_occurrences);
      if (!Number.isInteger(n) || n < 1 || n > 1000) e.max_occurrences = 'Enter a whole number between 1 and 1000, or leave empty.';
    }
    if (!s.assigned_to) e.assigned_to = 'Choose the assignee.';
    return e;
  };

  const save = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setMessage(null);
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length) return;
    const patch = buildPatch();
    if (!Object.keys(patch).length) {
      setMessage('Nothing has changed.');
      return;
    }
    setBusy(true);
    try {
      const r = await api.patch<MutationResult>(`/task-templates/${t.id}`, { version: t.version, ...patch });
      onSaved(r);
    } catch (err) {
      if (isStale(err)) {
        onConflict();
        onClose();
        return;
      }
      const errs = fieldErrors(err);
      setErrors(errs);
      const shown = ['title', 'description', 'expected_outcome', 'priority', 'due_time', 'due_offset_days', 'end_date', 'max_occurrences', 'holiday_policy', 'leave_policy', 'assigned_to'];
      const rest = Object.entries(errs).filter(([k]) => !shown.includes(k));
      if (!Object.keys(errs).length) setMessage(errorMessage(err));
      else if (rest.length) setMessage(rest.map(([, v]) => v).join(' '));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen={open} onClose={busy ? () => undefined : onClose} title="Edit series" description={t.title} maxWidth="2xl">
      <form onSubmit={save} noValidate>
        <FormSteps
          onCancel={onClose}
          busy={busy}
          banner={message && <InfoCallout variant={message === 'Nothing has changed.' ? 'neutral' : 'danger'}>{message}</InfoCallout>}
          submit={
            <Button type="submit" isLoading={busy} disabled={busy} leftIcon={<Pencil className="h-4 w-4" />}>
              Save changes
            </Button>
          }
          steps={[
            {
              title: 'Details',
              icon: <Pencil />,
              description: 'What each task in this series is about.',
              content: (
                <div className="space-y-3">
                  <InfoCallout variant="info">
                    Changes apply to future instances that have not started; instances already in progress keep their details. To change a single instance, edit that task instead.
                  </InfoCallout>
                  <Input id="edit-title" label="Title *" value={s.title} maxLength={TASK_TEXT_LIMITS.title} onChange={(e) => set({ title: e.target.value })} error={errors.title} />
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
                    <Textarea id="edit-description" label="Description" rows={3} maxLength={TASK_TEXT_LIMITS.description} value={s.description} onChange={(e) => set({ description: e.target.value })} error={errors.description} />
                    <Textarea id="edit-outcome" label="Expected outcome" rows={3} maxLength={TASK_TEXT_LIMITS.expected_outcome} value={s.expected_outcome} onChange={(e) => set({ expected_outcome: e.target.value })} error={errors.expected_outcome} />
                  </div>
                </div>
              ),
            },
            {
              title: 'Assignment',
              icon: <Repeat />,
              description: 'Who does the work, how urgent it is, and what finishing needs.',
              content: (
                <div className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
                    <UserSelect
                      label="Assignee *"
                      value={s.assigned_to}
                      onChange={(v) => set({ assigned_to: v })}
                      users={users}
                      error={errors.assigned_to}
                      helperText={s.assigned_to !== t.assigned_to ? 'Upcoming tasks that have not started move to the new assignee.' : linked ? 'Your team, and colleagues for linked work.' : 'Your team.'}
                    />
                    <Select
                      id="edit-priority"
                      label="Priority"
                      value={s.priority}
                      searchable={false}
                      onChange={(e) => set({ priority: e.target.value as TaskPriority })}
                      options={TASK_PRIORITIES.map((p) => ({ value: p, label: TASK_PRIORITY_LABELS[p] }))}
                      error={errors.priority}
                    />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
                    <Checkbox id="edit-evidence" checked={s.evidence_required} onChange={(e) => set({ evidence_required: e.target.checked })} label="Evidence required" description="Proof file and remarks needed to complete." />
                    <Checkbox id="edit-approval" checked={s.approval_required} onChange={(e) => set({ approval_required: e.target.checked })} label="Approval required" description="Manager approves each completion." />
                  </div>
                </div>
              ),
            },
            {
              title: 'Schedule',
              icon: <CalendarClock />,
              description: 'When each task falls due, and when the series stops.',
              content: (
                <div className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
                    <Input
                      id="edit-due-offset"
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={60}
                      label="Due after (days)"
                      value={s.due_offset_days}
                      onChange={(e) => set({ due_offset_days: e.target.value.replace(/[^\d]/g, '') })}
                      error={errors.due_offset_days}
                      helperText={Number(s.due_offset_days) > 0 ? `${s.due_offset_days} day(s) after each occurrence` : 'Same day'}
                    />
                    <Input id="edit-due-time" type="time" label="Due time (IST)" value={s.due_time} onChange={(e) => set({ due_time: e.target.value })} error={errors.due_time} />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
                    <Input id="edit-end-date" type="date" label="Ends on" min={t.start_date} value={s.end_date} onChange={(e) => set({ end_date: e.target.value })} error={errors.end_date} helperText="Leave empty for no end date." />
                    <Input
                      id="edit-max-occurrences"
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={1000}
                      label="Max occurrences"
                      value={s.max_occurrences}
                      onChange={(e) => set({ max_occurrences: e.target.value.replace(/[^\d]/g, '') })}
                      error={errors.max_occurrences}
                      helperText="Leave empty for no limit."
                    />
                  </div>
                </div>
              ),
            },
            {
              title: 'Exceptions',
              icon: <Pause />,
              description: 'What happens when a date lands on a holiday or the assignee is on leave.',
              content: (
                <div className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
                    <Select
                      id="edit-holiday-policy"
                      label="If it falls on a holiday / weekly off"
                      value={s.holiday_policy}
                      searchable={false}
                      onChange={(e) => set({ holiday_policy: e.target.value as TaskHolidayPolicy })}
                      options={TASK_HOLIDAY_POLICIES.map((p) => ({ value: p, label: TASK_HOLIDAY_POLICY_LABELS[p] }))}
                      error={errors.holiday_policy}
                    />
                    <Select
                      id="edit-leave-policy"
                      label="If the assignee is on approved leave"
                      value={s.leave_policy}
                      searchable={false}
                      onChange={(e) => set({ leave_policy: e.target.value as TaskLeavePolicy })}
                      options={(['skip', 'keep'] as TaskLeavePolicy[]).map((p) => ({ value: p, label: TASK_LEAVE_POLICY_LABELS[p] }))}
                      error={errors.leave_policy}
                    />
                  </div>
                </div>
              ),
            },
          ]}
        />
      </form>
    </Modal>
  );
};

// ======================================================================== pause / resume / end
const STATUS_COPY: Record<StatusAction, { title: string; confirm: string; warning: string; reason: boolean; danger?: boolean }> = {
  pause: {
    title: 'Pause series',
    confirm: 'Pause series',
    warning: 'Pausing cancels upcoming tasks of this series that have not started yet. Tasks already in progress stay with the assignee. No new tasks are generated until you resume.',
    reason: true,
  },
  resume: {
    title: 'Resume series',
    confirm: 'Resume series',
    warning: 'New tasks are generated again from today using the current definition. Tasks cancelled by the pause are regenerated.',
    reason: false,
  },
  end: {
    title: 'End series',
    confirm: 'End series',
    warning: 'Ending is permanent: upcoming tasks that have not started are cancelled and the series cannot be resumed. Tasks already in progress are kept. Create a new recurring task to start again.',
    reason: true,
    danger: true,
  },
};

const StatusActionModal: React.FC<{
  action: StatusAction | null;
  template: TemplateDetail;
  onClose: () => void;
  onDone: (action: StatusAction, r: MutationResult) => void;
  onConflict: () => void;
}> = ({ action, template, onClose, onDone, onConflict }) => {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setReason('');
    setError(null);
    setMessage(null);
  }, [action]);

  if (!action) return null;
  const copy = STATUS_COPY[action];

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setMessage(null);
    if (copy.reason && reason.trim().length < TASK_MIN_COMMENT_LENGTH) {
      setError(`Reason needs at least ${TASK_MIN_COMMENT_LENGTH} characters.`);
      return;
    }
    setBusy(true);
    try {
      const r = await api.post<MutationResult>(`/task-templates/${template.id}/${action}`, copy.reason ? { version: template.version, reason: reason.trim() } : { version: template.version });
      onDone(action, r);
    } catch (err) {
      if (isStale(err)) {
        onConflict();
        onClose();
        return;
      }
      const errs = fieldErrors(err);
      if (errs.reason) setError(errs.reason);
      else setMessage(errs.assigned_to || Object.values(errs)[0] || errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen onClose={busy ? () => undefined : onClose} title={copy.title} description={template.title} maxWidth="md">
      <form onSubmit={submit} noValidate className="space-y-4">
        <InfoCallout variant={copy.danger ? 'danger' : action === 'resume' ? 'info' : 'warning'}>{copy.warning}</InfoCallout>
        {action === 'resume' && template.assignee_active === false && (
          <InfoCallout variant="danger">The assignee is inactive — choose a new assignee with “Edit series” before resuming.</InfoCallout>
        )}
        {copy.reason && (
          <Textarea
            id="series-status-reason"
            label="Reason *"
            rows={3}
            maxLength={TASK_TEXT_LIMITS.comment}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              setError(null);
            }}
            placeholder={action === 'pause' ? 'e.g. Customer site closed for renovation until next month' : 'e.g. Contract completed — weekly reports no longer needed'}
            error={error || undefined}
            helperText={`${reason.trim().length}/${TASK_MIN_COMMENT_LENGTH} characters minimum`}
          />
        )}
        {message && <InfoCallout variant="danger">{message}</InfoCallout>}
        <DialogActions className="sm:pt-1">
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            Back
          </Button>
          <Button type="submit" variant={copy.danger ? 'danger' : 'primary'} isLoading={busy} disabled={busy}>
            {copy.confirm}
          </Button>
        </DialogActions>
      </form>
    </Modal>
  );
};

// ======================================================================== page
type HistoryItem = { kind: 'task'; date: string; task: TaskRow } | { kind: 'skip'; date: string; skip: TemplateSkip };

export default function RecurringTaskDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const { push, Toaster } = useToaster();
  const [template, setTemplate] = useState<TemplateDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [statusAction, setStatusAction] = useState<StatusAction | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoadError(null);
    try {
      setTemplate(await api.get<TemplateDetail>(`/task-templates/${id}`));
      setConflict(false);
    } catch (e) {
      setLoadError(errorMessage(e, 'Could not load this recurring task.'));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const history = useMemo<HistoryItem[]>(() => {
    if (!template) return [];
    const items: HistoryItem[] = [
      ...template.instances.map((task) => ({ kind: 'task' as const, date: task.occurrence_date || task.start_date || istDateOf(task.created_at), task })),
      ...template.skips.map((skip) => ({ kind: 'skip' as const, date: skip.occurrence_date, skip })),
    ];
    return items.sort((a, b) => b.date.localeCompare(a.date));
  }, [template]);

  const onSaved = (r: MutationResult) => {
    setTemplate(r);
    setEditOpen(false);
    notifyTasksChanged();
    const bits: string[] = [];
    if (r.updated_future_instances) bits.push(`${plural(r.updated_future_instances, 'upcoming task')} updated`);
    if (r.purged_future_instances) bits.push(`${plural(r.purged_future_instances, 'upcoming task')} replaced`);
    if (r.regenerated) bits.push(`${plural(r.regenerated, 'task')} generated`);
    push('success', `Series updated${bits.length ? ` — ${bits.join(', ')}` : ''}.`);
  };

  const onStatusDone = (action: StatusAction, r: MutationResult) => {
    setTemplate(r);
    setStatusAction(null);
    notifyTasksChanged();
    const cancelled = r.cancelled_future_instances || 0;
    if (action === 'pause') push('success', `Series paused${cancelled ? ` — ${plural(cancelled, 'upcoming task')} cancelled` : ''}.`);
    else if (action === 'end') push('success', `Series ended${cancelled ? ` — ${plural(cancelled, 'upcoming task')} cancelled` : ''}.`);
    else push('success', `Series resumed${r.generated ? ` — ${plural(r.generated, 'task')} generated` : ''}.`);
  };

  if (loading) {
    return (
      <PageContainer>
        <PageHeader title="Recurring task" />
        <TasksNav />
        <PageLoader rows={4} label="Loading series" />
      </PageContainer>
    );
  }

  if (loadError || !template) {
    return (
      <PageContainer>
        <PageHeader title="Recurring task" />
        <TasksNav />
        <InfoCallout variant="danger" title="Could not open this recurring task">
          <div className="space-y-2">
            <p>{loadError || 'Not found.'}</p>
            <Link href="/tasks/templates">
              <Button size="sm" variant="secondary" leftIcon={<ArrowLeft className="h-4 w-4" />}>
                Back to recurring tasks
              </Button>
            </Link>
          </div>
        </InfoCallout>
      </PageContainer>
    );
  }

  const t = template;
  const generatedCount = t.instances.length;
  const skippedCount = t.skips.length;

  return (
    <PageContainer>
      <PageHeader title={`Recurring task — ${t.title}`} icon={<Repeat className="h-5 w-5" />} />
      <TasksNav />

      <div>
        <Link href="/tasks/templates">
          <Button variant="ghost" size="sm" leftIcon={<ArrowLeft className="h-4 w-4" />}>
            Recurring tasks
          </Button>
        </Link>
      </div>

      {conflict && <TaskConflictCallout onRefresh={load} />}

      {/* Header */}
      <Card className="p-4 sm:p-5 space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <TemplateStatusBadge status={t.status} />
              <Badge variant="outline" size="sm">
                <Repeat className="h-3 w-3" />
                {TASK_RECURRENCE_LABELS[t.recurrence_type] || t.recurrence_type}
              </Badge>
              <PriorityBadge priority={t.priority} />
              {t.needs_reassignment && <FlagChip tone="danger">Needs reassignment</FlagChip>}
              {t.assignee_active === false && !t.needs_reassignment && <FlagChip tone="danger">Assignee inactive</FlagChip>}
            </div>
            <h2 className="font-serif text-xl sm:text-2xl leading-tight text-[#14213D] break-words">{t.title}</h2>
            <p className="text-sm font-semibold text-[#0F5E63]">{t.schedule}</p>
            <p className="text-xs text-[#4A5568]">
              {describeDue(t.due_offset_days, t.due_time)} · {t.assignee_name || '—'}
            </p>
          </div>
          {t.can_manage && t.status !== 'ended' && (
            <div className="flex flex-wrap gap-2 lg:justify-end shrink-0 [&>button]:h-10 sm:[&>button]:h-8">
              <Button size="sm" variant="secondary" leftIcon={<Pencil className="h-4 w-4" />} onClick={() => setEditOpen(true)}>
                Edit series
              </Button>
              {t.status === 'active' && (
                <Button size="sm" variant="secondary" leftIcon={<Pause className="h-4 w-4" />} onClick={() => setStatusAction('pause')}>
                  Pause
                </Button>
              )}
              {t.status === 'paused' && (
                <Button size="sm" leftIcon={<Play className="h-4 w-4" />} onClick={() => setStatusAction('resume')}>
                  Resume
                </Button>
              )}
              <Button size="sm" variant="ghost" className="text-[#881337] hover:text-[#881337]" leftIcon={<Square className="h-4 w-4" />} onClick={() => setStatusAction('end')}>
                End series
              </Button>
            </div>
          )}
        </div>
      </Card>

      {t.needs_reassignment && (
        <InfoCallout variant="danger" title="This series needs a new assignee">
          {t.assignee_name || 'The assignee'} is no longer active, so the series was paused.{' '}
          {t.can_manage ? 'Choose a new assignee with “Edit series”, then resume it.' : 'Ask the assigner or a manager to reassign it.'}
        </InfoCallout>
      )}
      {t.status === 'paused' && !t.needs_reassignment && (
        <InfoCallout variant="warning" title="Paused">
          {t.status_reason ? <>Reason: “{t.status_reason}”. </> : null}No new tasks are generated until the series is resumed.
        </InfoCallout>
      )}
      {t.status === 'ended' && (
        <InfoCallout variant="neutral" title="This series has ended">
          {t.status_reason ? <>Reason: “{t.status_reason}”. </> : null}No new tasks will be generated. Create a new recurring task to start again.
        </InfoCallout>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
        {/* Details */}
        <Card className="p-4 sm:p-5 space-y-4">
          <h3 className="font-serif text-lg text-[#14213D]">Details</h3>
          <dl className="grid grid-cols-2 lg:grid-cols-1 xl:grid-cols-2 gap-x-4 gap-y-3">
            <Meta label="Assignee">
              <span className={t.assignee_active === false ? 'text-[#881337] line-through' : ''}>{t.assignee_name || '—'}</span>
            </Meta>
            <Meta label="Assigned by">{t.assigned_by_name || '—'}</Meta>
            <Meta label="Category">{t.category_name || '—'}</Meta>
            <Meta label="Customer">{t.customer_name || '—'}</Meta>
            <Meta label="Starts">
              <span className="font-mono">{formatTaskDate(t.start_date)}</span>
            </Meta>
            <Meta label="Ends">
              {t.end_date ? (
                <>
                  <span className="font-mono">{formatTaskDate(t.end_date)}</span>
                  {t.max_occurrences ? <span className="block text-xs text-[#4A5568]">or after {plural(t.max_occurrences, 'occurrence')}</span> : null}
                </>
              ) : t.max_occurrences ? (
                `After ${plural(t.max_occurrences, 'occurrence')}`
              ) : (
                'Never'
              )}
            </Meta>
            <Meta label="On holidays / weekly offs">{TASK_HOLIDAY_POLICY_LABELS[t.holiday_policy] || t.holiday_policy}</Meta>
            <Meta label="During approved leave">{TASK_LEAVE_POLICY_LABELS[t.leave_policy] || t.leave_policy}</Meta>
            <Meta label="Evidence">{t.evidence_required ? 'Required' : 'Not required'}</Meta>
            <Meta label="Approval">{t.approval_required ? 'Manager approves' : 'Not required'}</Meta>
          </dl>
          {t.description && (
            <div>
              <div className="text-[11px] uppercase tracking-wide text-[#4A5568]">Description</div>
              <p className="text-sm text-[#14213D] whitespace-pre-wrap break-words">{t.description}</p>
            </div>
          )}
          {t.expected_outcome && (
            <div>
              <div className="text-[11px] uppercase tracking-wide text-[#4A5568]">Expected outcome</div>
              <p className="text-sm text-[#14213D] whitespace-pre-wrap break-words">{t.expected_outcome}</p>
            </div>
          )}
          <p className="text-[11px] text-[#6B7280] font-mono">Updated {formatTaskDateTime(t.updated_at)}</p>
        </Card>

        <div className="lg:col-span-2 space-y-5 min-w-0">
          {/* Upcoming */}
          <Card className="p-4 sm:p-5 space-y-3">
            <div className="flex items-center gap-2">
              <CalendarClock className="h-4 w-4 text-[#0F5E63]" />
              <h3 className="font-serif text-lg text-[#14213D]">Next 10 occurrences</h3>
            </div>
            {t.status === 'ended' ? (
              <p className="text-xs text-[#6B7280]">This series has ended — nothing more will be generated.</p>
            ) : (
              <>
                {t.status === 'paused' && <p className="text-xs text-[#9A3412] font-medium">Paused — these dates are generated only after the series is resumed.</p>}
                <OccurrenceList rows={t.upcoming || []} />
                <p className="text-[11px] text-[#4A5568]">Tasks are created a few days ahead of each date. Holidays and leave follow the policies on the left.</p>
              </>
            )}
          </Card>

          {/* History */}
          <Card className="p-4 sm:p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <History className="h-4 w-4 text-[#0F5E63]" />
                <h3 className="font-serif text-lg text-[#14213D]">Occurrence history</h3>
              </div>
              <span className="text-xs text-[#4A5568]">
                {plural(generatedCount, 'task')} generated{skippedCount ? ` · ${skippedCount} skipped` : ''}
              </span>
            </div>
            {history.length === 0 ? (
              <p className="text-xs text-[#6B7280]">No tasks generated yet.</p>
            ) : (
              <ol className="divide-y divide-[#ECE9E2] rounded-[10px] border border-[#ECE9E2]">
                {history.map((h) =>
                  h.kind === 'task' ? (
                    <li key={`t-${h.task.id}`}>
                      <Link href={`/tasks/${h.task.id}`} className="flex flex-col sm:flex-row sm:items-center gap-2 px-3 py-2.5 hover:bg-[#FBFAF7]">
                        <div className="min-w-0 sm:w-40 shrink-0">
                          <div className="font-mono text-xs font-semibold text-[#0F5E63]">{h.task.task_number}</div>
                          <div className="font-mono text-[11px] text-[#4A5568]">{formatTaskDate(h.date)}</div>
                        </div>
                        <div className="min-w-0 flex-1">
                          <DueText deadline={h.task.deadline} open={['not_started', 'in_progress', 'blocked'].includes(h.task.status)} />
                          {h.task.assignee_name && h.task.assigned_to !== t.assigned_to && <div className="text-[11px] text-[#4A5568]">{h.task.assignee_name}</div>}
                        </div>
                        <div className="flex flex-wrap items-center gap-1 sm:justify-end">
                          <TaskStatusBadges status={h.task.display_status} storedStatus={h.task.status} isOverdue={h.task.is_overdue} />
                          <DelayBadge delay={h.task.delay_class} />
                          {h.task.generated_late && <FlagChip>Generated late</FlagChip>}
                        </div>
                      </Link>
                    </li>
                  ) : (
                    <li key={`s-${h.skip.id}`} className="flex flex-col sm:flex-row sm:items-center gap-2 px-3 py-2.5 bg-[#FBFAF7]">
                      <div className="sm:w-40 shrink-0 font-mono text-[11px] text-[#6B7280] line-through">{formatTaskDate(h.date)}</div>
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-semibold text-[#4A5568]">{SKIP_LABEL[h.skip.reason] || 'Skipped'}</div>
                        {h.skip.detail && <div className="text-[11px] text-[#6B7280] break-words">{h.skip.detail}</div>}
                      </div>
                      <Badge variant="outline" size="sm" className="self-start sm:self-center">
                        Not counted as missed
                      </Badge>
                    </li>
                  ),
                )}
              </ol>
            )}
          </Card>
        </div>
      </div>

      <EditSeriesModal template={t} open={editOpen} onClose={() => setEditOpen(false)} onSaved={onSaved} onConflict={() => setConflict(true)} />
      <StatusActionModal action={statusAction} template={t} onClose={() => setStatusAction(null)} onDone={onStatusDone} onConflict={() => setConflict(true)} />
      <Toaster />
    </PageContainer>
  );
}
