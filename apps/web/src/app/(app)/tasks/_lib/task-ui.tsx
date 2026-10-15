'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { AlertTriangle, Download, FileText, Paperclip, RefreshCw, ShieldAlert, Trash2 } from 'lucide-react';
import { Badge, Button, InfoCallout, Modal, Spinner, Tabs } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import {
  TASK_ACTION_LABELS,
  TASK_BLOCKER_STATUS_LABELS,
  TASK_BLOCKER_TYPE_LABELS,
  TASK_DEADLINE_SOURCE_LABELS,
  TASK_DELAY_CLASS_LABELS,
  TASK_EVIDENCE_DISCLAIMER,
  TASK_PRIORITY_LABELS,
  TASK_REASSIGN_REASON_LABELS,
  TASK_STATUS_LABELS,
  formatTaskDate,
  formatTaskDateTime,
  relativeDue,
  type TaskBlockerStatus,
  type TaskBlockerType,
  type TaskDelayClass,
  type TaskDisplayStatus,
  type TaskPriority,
} from '@arihant/shared';
import { errorMessage, fileSize, saveBlob, useTaskSummary, type TaskAttachment, type TaskUpdate } from './task-lib';

export { useToaster } from '../../expenses/_lib/expense-ui';
export { MultiSelect } from '../../expenses/_lib/MultiSelect';
export { useUrlFilters } from '../../expenses/_lib/use-url-filters';

type BadgeVariant = 'default' | 'outline' | 'success' | 'warning' | 'danger' | 'urgent' | 'info' | 'cyber';

export const STATUS_VARIANT: Record<TaskDisplayStatus, BadgeVariant> = {
  not_started: 'default',
  in_progress: 'info',
  blocked: 'warning',
  overdue: 'urgent',
  awaiting_approval: 'cyber',
  completed: 'success',
  cancelled: 'outline',
};
export const PRIORITY_VARIANT: Record<TaskPriority, BadgeVariant> = { low: 'default', medium: 'outline', high: 'warning', critical: 'urgent' };
export const DELAY_VARIANT: Record<TaskDelayClass, BadgeVariant> = { on_time: 'success', late_excused: 'info', late_unexcused: 'danger', open_overdue: 'urgent', open: 'default' };
export const BLOCKER_VARIANT: Record<TaskBlockerStatus, BadgeVariant> = { pending_review: 'warning', accepted: 'info', rejected: 'danger', resolved: 'success', withdrawn: 'outline' };

export const StatusBadge: React.FC<{ status: TaskDisplayStatus; className?: string }> = ({ status, className }) => (
  <Badge variant={STATUS_VARIANT[status] || 'default'} size="sm" className={`whitespace-nowrap ${className || ''}`}>
    {TASK_STATUS_LABELS[status] || status}
  </Badge>
);

/** Shows the stored status, plus a red Overdue chip when the derived overdue applies. */
export const TaskStatusBadges: React.FC<{ status: TaskDisplayStatus | string; isOverdue: boolean; storedStatus?: string }> = ({ isOverdue, storedStatus, status }) => (
  <span className="inline-flex flex-wrap items-center gap-1">
    <StatusBadge status={(storedStatus || status) as TaskDisplayStatus} />
    {isOverdue && <StatusBadge status="overdue" />}
  </span>
);

export const PriorityBadge: React.FC<{ priority: TaskPriority }> = ({ priority }) => (
  <Badge variant={PRIORITY_VARIANT[priority] || 'default'} size="sm" className="whitespace-nowrap">
    {TASK_PRIORITY_LABELS[priority] || priority}
  </Badge>
);

export const DelayBadge: React.FC<{ delay: TaskDelayClass | null | undefined }> = ({ delay }) =>
  delay && delay !== 'open' ? (
    <Badge variant={DELAY_VARIANT[delay]} size="sm" className="whitespace-nowrap">
      {TASK_DELAY_CLASS_LABELS[delay]}
    </Badge>
  ) : null;

export const BlockerBadge: React.FC<{ status: TaskBlockerStatus }> = ({ status }) => (
  <Badge variant={BLOCKER_VARIANT[status]} size="sm" className="whitespace-nowrap">
    {TASK_BLOCKER_STATUS_LABELS[status]}
  </Badge>
);

export const blockerTypeLabel = (t: string) => TASK_BLOCKER_TYPE_LABELS[t as TaskBlockerType] || t.replace(/_/g, ' ');

export const DateTime: React.FC<{ value: string | null | undefined; dateOnly?: boolean; className?: string }> = ({ value, dateOnly, className }) => (
  <span className={`font-mono tabular-nums ${className || ''}`}>{dateOnly ? formatTaskDate(value) : formatTaskDateTime(value)}</span>
);

/** Deadline with a relative hint ("due in 3h", "overdue by 2 days"). */
export const DueText: React.FC<{ deadline: string | null; open: boolean; compact?: boolean }> = ({ deadline, open, compact }) => {
  if (!deadline) return <span className="text-[#8A8578]">No deadline</span>;
  const rel = relativeDue(deadline);
  return (
    <span className="inline-flex flex-col leading-tight">
      <span className="font-mono tabular-nums text-xs text-[#14213D]">{formatTaskDateTime(deadline)}</span>
      {open && !compact && <span className={`text-[11px] font-medium ${rel.overdue ? 'text-[#9A3412]' : 'text-[#4A5568]'}`}>{rel.label}</span>}
    </span>
  );
};

export const ProgressBar: React.FC<{ value: number; className?: string }> = ({ value, className }) => (
  <div className={`flex items-center gap-2 ${className || ''}`} aria-label={`Progress ${value}%`}>
    <div className="h-1.5 flex-1 rounded-full bg-[#ECE9E2] overflow-hidden">
      <div className="h-full rounded-full bg-[#0F5E63] transition-all" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
    <span className="font-mono text-[11px] text-[#4A5568] w-8 text-right">{value}%</span>
  </div>
);

export const EvidenceDisclaimer: React.FC = () => (
  <InfoCallout variant="warning" title="Evidence only" icon={<ShieldAlert className="h-4 w-4" />}>
    <span className="font-medium">{TASK_EVIDENCE_DISCLAIMER}</span>
  </InfoCallout>
);

export const TaskConflictCallout: React.FC<{ onRefresh: () => void }> = ({ onRefresh }) => (
  <InfoCallout variant="warning" title="Task updated by someone else">
    <div className="flex flex-wrap items-center gap-3">
      <span>Your view is out of date. Refresh to see the latest version before acting.</span>
      <Button size="xs" variant="secondary" leftIcon={<RefreshCw className="h-3 w-3" />} onClick={onRefresh}>
        Refresh
      </Button>
    </div>
  </InfoCallout>
);

// ------------------------------------------------------------------ sub-navigation
export const TasksNav: React.FC = () => {
  const { user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const { summary } = useTaskSummary(Boolean(user));
  const tabs = useMemo(() => {
    const s = summary;
    const manager = Boolean(s?.has_team || s?.can_view_all);
    const t: { id: string; label: string; count?: number; badgeVariant?: 'urgent' | 'warning' | 'info' }[] = [
      { id: '/tasks', label: 'My Tasks', count: s?.my_overdue || undefined, badgeVariant: 'urgent' },
    ];
    if (manager) t.push({ id: '/tasks/team', label: 'Team Tasks', count: s?.needs_reassignment || undefined, badgeVariant: 'warning' });
    if (manager || s?.pending_blockers) t.push({ id: '/tasks/blockers', label: 'Blocker Reviews', count: s?.pending_blockers || undefined, badgeVariant: 'urgent' });
    if (manager || s?.pending_approvals) t.push({ id: '/tasks/approvals', label: 'Approvals', count: s?.pending_approvals || undefined, badgeVariant: 'warning' });
    t.push({ id: '/tasks/waiting', label: 'Waiting on Me', count: s?.waiting_on_me || undefined, badgeVariant: 'warning' });
    t.push({ id: '/tasks/templates', label: 'Recurring' });
    if (manager) t.push({ id: '/tasks/accountability', label: 'Accountability' });
    if (s?.can_view_evidence) t.push({ id: '/tasks/evidence', label: 'Performance Evidence' });
    t.push({ id: '/tasks/my-performance', label: 'My Performance' });
    t.push({ id: '/tasks/calendar', label: 'Leave & Holidays' });
    if (s?.can_manage_settings) t.push({ id: '/tasks/settings', label: 'Settings' });
    return t;
  }, [summary]);
  const active =
    tabs
      .map((t) => t.id)
      .filter((id) => id !== '/tasks' && pathname.startsWith(id))
      .sort((a, b) => b.length - a.length)[0] || '/tasks';
  return (
    <div className="overflow-x-auto -mx-1 px-1">
      <Tabs variant="underline" tabs={tabs} activeTab={active} onChange={(id) => router.push(id)} />
    </div>
  );
};

// ------------------------------------------------------------------ files
export const FileViewer: React.FC<{ file: TaskAttachment | null; onClose: () => void }> = ({ file, onClose }) => {
  const [url, setUrl] = useState<string | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!file) return;
    let objectUrl: string | null = null;
    setUrl(null);
    setError(null);
    api
      .blob(`/task-attachments/${file.id}`)
      .then(({ blob: b }) => {
        setBlob(b);
        objectUrl = URL.createObjectURL(b);
        setUrl(objectUrl);
      })
      .catch((e) => setError(errorMessage(e, 'Could not load the file.')));
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file]);
  if (!file) return null;
  const isImage = file.mime_type.startsWith('image/');
  const isPdf = file.mime_type === 'application/pdf';
  return (
    <Modal isOpen onClose={onClose} title={file.file_name} description={`${fileSize(file.size_bytes)} · ${file.uploaded_by_name || ''} · ${formatTaskDateTime(file.uploaded_at)}`} maxWidth="4xl">
      <div className="space-y-3">
        <div className="min-h-[280px] rounded-[14px] border border-[#DCD8CE] bg-[#FBFAF7] flex items-center justify-center overflow-hidden">
          {error ? (
            <p className="text-sm text-[#881337] p-6">{error}</p>
          ) : !url ? (
            <Spinner size="lg" />
          ) : isImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt={file.file_name} className="max-h-[70vh] w-auto object-contain" />
          ) : isPdf ? (
            <iframe src={url} title={file.file_name} className="w-full h-[70vh]" />
          ) : (
            <div className="text-center p-6 space-y-2">
              <FileText className="h-10 w-10 mx-auto text-[#4A5568]" />
              <p className="text-sm text-[#4A5568]">This format cannot be previewed — download it instead.</p>
            </div>
          )}
        </div>
        <div className="flex justify-end">
          <Button variant="secondary" size="sm" disabled={!blob} leftIcon={<Download className="h-4 w-4" />} onClick={() => blob && saveBlob(blob, file.file_name)}>
            Download
          </Button>
        </div>
      </div>
    </Modal>
  );
};

const PURPOSE_LABEL: Record<TaskAttachment['purpose'], string> = { supporting_doc: 'Supporting', evidence: 'Evidence', blocker_evidence: 'Blocker', update: 'Update' };

export const FileList: React.FC<{ files: TaskAttachment[]; onOpen: (f: TaskAttachment) => void; onRemove?: (f: TaskAttachment) => void; canRemove?: (f: TaskAttachment) => boolean }> = ({ files, onOpen, onRemove, canRemove }) => {
  if (!files.length) return <p className="text-xs text-[#8A8578]">No files yet.</p>;
  return (
    <ul className="divide-y divide-[#ECE9E2] rounded-lg border border-[#ECE9E2]">
      {files.map((f) => (
        <li key={f.id} className="flex items-center gap-2 px-3 py-2">
          <Paperclip className="h-3.5 w-3.5 text-[#4A5568] shrink-0" />
          <button type="button" onClick={() => onOpen(f)} className="min-w-0 flex-1 text-left text-sm text-[#0F5E63] hover:underline truncate">
            {f.file_name}
          </button>
          <Badge variant={f.purpose === 'evidence' ? 'success' : 'outline'} size="sm">
            {PURPOSE_LABEL[f.purpose]}
          </Badge>
          <span className="hidden sm:inline text-[11px] text-[#8A8578] font-mono">{fileSize(f.size_bytes)}</span>
          {onRemove && canRemove?.(f) && (
            <button type="button" aria-label={`Remove ${f.file_name}`} onClick={() => onRemove(f)} className="p-1 text-[#8A8578] hover:text-[#881337]">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
};

// ------------------------------------------------------------------ activity timeline
const DOT: Record<string, string> = {
  complete: 'bg-[#0F5E63]',
  approve: 'bg-[#0F5E63]',
  submit_for_approval: 'bg-[#0F5E63]',
  blocker_accepted: 'bg-[#0F5E63]',
  blocker_auto_accepted: 'bg-[#0F5E63]',
  blocker_resolved: 'bg-[#0F5E63]',
  send_back: 'bg-[#9A3412]',
  reopen: 'bg-[#9A3412]',
  cancel: 'bg-[#881337]',
  blocker_raised: 'bg-[#9A3412]',
  blocker_rejected: 'bg-[#881337]',
  escalate: 'bg-[#9A3412]',
  sla_escalated: 'bg-[#9A3412]',
  extend_deadline: 'bg-[#14213D]',
  reassign: 'bg-[#14213D]',
  correction: 'bg-[#881337]',
};

function updateDetails(u: TaskUpdate): string | null {
  const m = u.metadata || {};
  const bits: string[] = [];
  if (u.status_from && u.status_to && u.status_from !== u.status_to) bits.push(`${TASK_STATUS_LABELS[u.status_from as TaskDisplayStatus] || u.status_from} → ${TASK_STATUS_LABELS[u.status_to as TaskDisplayStatus] || u.status_to}`);
  if (u.progress_percent !== null && u.progress_percent !== undefined) bits.push(`progress ${u.progress_percent}%`);
  if (m.blocker_type) bits.push(blockerTypeLabel(m.blocker_type));
  if (m.raised_after_deadline) bits.push('raised after the deadline');
  if (m.new_deadline) bits.push(`new deadline ${formatTaskDateTime(m.new_deadline)}`);
  if (m.source && TASK_DEADLINE_SOURCE_LABELS[m.source as keyof typeof TASK_DEADLINE_SOURCE_LABELS]) bits.push(TASK_DEADLINE_SOURCE_LABELS[m.source as keyof typeof TASK_DEADLINE_SOURCE_LABELS]);
  if (m.locked_unexcused_minutes) bits.push(`${Math.round(m.locked_unexcused_minutes / 144) / 10} day(s) already overdue stay unexcused`);
  if (m.to_name) bits.push(`to ${m.to_name}`);
  if (m.reason_type) bits.push(TASK_REASSIGN_REASON_LABELS[m.reason_type as keyof typeof TASK_REASSIGN_REASON_LABELS] || m.reason_type);
  if (m.mode) bits.push(m.mode === 'pause' ? 'pause (deadline moves when resolved)' : 'extend now');
  if (m.late) bits.push('completed after the deadline');
  if (m.generated_late) bits.push('generated late (excluded from metrics)');
  if (m.delay_reason) bits.push(`delay reason: ${m.delay_reason}`);
  return bits.length ? bits.join(' · ') : null;
}

export const ActivityTimeline: React.FC<{ updates: TaskUpdate[] }> = ({ updates }) => {
  if (!updates.length) return <p className="text-sm text-[#8A8578]">No activity yet.</p>;
  return (
    <ol className="relative border-l border-[#DCD8CE] ml-2 space-y-4">
      {updates.map((u) => {
        const details = updateDetails(u);
        return (
          <li key={u.id} className="ml-4">
            <span className={`absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full ${DOT[u.kind] || 'bg-[#C9C4B8]'}`} aria-hidden />
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-sm font-semibold text-[#14213D]">{TASK_ACTION_LABELS[u.kind] || u.kind.replace(/_/g, ' ')}</span>
              <span className="text-xs text-[#4A5568]">{u.author_name || 'System'}</span>
              <span className="text-[11px] font-mono text-[#8A8578] ml-auto">{formatTaskDateTime(u.created_at)}</span>
            </div>
            {details && <p className="mt-0.5 text-xs text-[#4A5568]">{details}</p>}
            {u.comment && <p className="mt-1 text-sm text-[#14213D] bg-[#FBFAF7] border border-[#ECE9E2] rounded-lg px-3 py-2 whitespace-pre-wrap break-words">{u.comment}</p>}
          </li>
        );
      })}
    </ol>
  );
};

export const Meta: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="min-w-0">
    <dt className="text-[11px] uppercase tracking-wide text-[#4A5568]">{label}</dt>
    <dd className="text-sm text-[#14213D] break-words">{children}</dd>
  </div>
);

export const FlagChip: React.FC<{ children: React.ReactNode; tone?: 'warn' | 'danger' }> = ({ children, tone = 'warn' }) => (
  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${tone === 'danger' ? 'bg-[#FCE8EC] text-[#881337]' : 'bg-[#FBEBDD] text-[#7C2D12]'}`}>
    <AlertTriangle className="h-3 w-3" />
    {children}
  </span>
);
