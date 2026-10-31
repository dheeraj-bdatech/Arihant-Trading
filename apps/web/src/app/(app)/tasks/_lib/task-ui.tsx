'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  AlertTriangle,
  Ban,
  CircleCheck,
  CircleDashed,
  CheckSquare,
  ClipboardCheck,
  Columns3,
  Download,
  FileText,
  Hourglass,
  LayoutList,
  OctagonAlert,
  Paperclip,
  RefreshCw,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  Timer,
  Trash2,
  Users,
} from 'lucide-react';
import { Badge, Button, Card, FilterMenu, InfoCallout, Modal, Spinner, StepTrack, type FilterMenuOption, type TrackStep } from '@/components/ui';
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
  taskViewsFor,
  type TaskBlockerStatus,
  type TaskBlockerType,
  type TaskDelayClass,
  type TaskDisplayStatus,
  type TaskPriority,
} from '@arihant/shared';
import { errorMessage, fileSize, formatDuration, saveBlob, useTaskSummary, type TaskAttachment, type TaskUpdate } from './task-lib';

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
  if (!deadline) return <span className="text-[#6B7280]">No deadline</span>;
  const rel = relativeDue(deadline);
  return (
    <span className="inline-flex flex-col leading-tight">
      <span className="font-mono tabular-nums text-xs text-[#14213D]">{formatTaskDateTime(deadline)}</span>
      {open && !compact && <span className={`text-[11px] font-medium ${rel.overdue ? 'text-[#9A3412]' : 'text-[#4A5568]'}`}>{rel.label}</span>}
    </span>
  );
};

/**
 * Where a task stands, as the Kanban board's columns in order (finished steps ticked, the current one filled).
 * Replaces the old percentage bar — status, not a number, says how far the work has got.
 */
export const StatusTrack: React.FC<{ status: string; approvalRequired?: boolean; className?: string }> = ({ status, approvalRequired, className }) => {
  if (status === 'cancelled') {
    return (
      <span className={`inline-flex items-center gap-1.5 rounded-full border border-[#DCD8CE] bg-[#ECE9E2] px-2.5 py-1 text-xs font-semibold text-[#4A5568] ${className || ''}`}>
        <Ban className="h-3.5 w-3.5" aria-hidden /> Cancelled
      </span>
    );
  }
  const steps: TrackStep[] = [
    { key: 'not_started', label: 'Not started', icon: CircleDashed },
    status === 'blocked' ? { key: 'blocked', label: 'Blocked', icon: OctagonAlert } : { key: 'in_progress', label: 'In progress', icon: Timer },
    ...(approvalRequired || status === 'awaiting_approval' ? [{ key: 'awaiting_approval', label: 'Approval', icon: Hourglass }] : []),
    { key: 'completed', label: 'Completed', icon: CircleCheck },
  ];
  return (
    <StepTrack
      steps={steps}
      current={Math.max(0, steps.findIndex((st) => st.key === status))}
      tone={status === 'blocked' ? 'danger' : status === 'awaiting_approval' ? 'warning' : 'primary'}
      complete={status === 'completed'}
      label={`Status: ${TASK_STATUS_LABELS[status as TaskDisplayStatus] || status}`}
      className={className}
    />
  );
};

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

// ------------------------------------------------------------------ navigation
/** Boards on the Tasks page (`?scope=`). The rest of the module lives on its own pages. */
export type TaskBoardScope = 'mine' | 'team' | 'blockers' | 'approvals';
export const TASK_BOARD_SCOPES: TaskBoardScope[] = ['mine', 'team', 'blockers', 'approvals'];

export const taskBoardHref = (scope: TaskBoardScope) => (scope === 'mine' ? '/tasks' : `/tasks?scope=${scope}`);

/** Views this user gets — role and reporting line, via the shared rule the API mirrors (taskViewsFor). */
export function useTaskViews() {
  const { user } = useAuth();
  const { summary } = useTaskSummary(Boolean(user));
  const views = useMemo(() => taskViewsFor(user?.role || 'sales', summary), [user?.role, summary]);
  return { views, summary, loaded: Boolean(summary) };
}

/** Pages reached from the View menu; the list pages of the boards map back to their board. */
const BOARD_LIST_PAGES: Record<string, TaskBoardScope> = { '/tasks/team': 'team', '/tasks/blockers': 'blockers', '/tasks/approvals': 'approvals' };
const TASK_PAGES = ['/tasks/settings'];

/** View-menu key for a task page: a board's list page maps to its board scope, any other page to its own path ('' if none). */
export function taskViewKey(pathname: string | null | undefined): string {
  const path = pathname || '';
  const boardScope = Object.entries(BOARD_LIST_PAGES).find(([p]) => path.startsWith(p))?.[1];
  return boardScope || TASK_PAGES.find((p) => path.startsWith(p)) || '';
}

/**
 * Every task board (and Settings) behind one "View" dropdown, filtered by role. Leave & holidays is a tab on My / All
 * tasks (TaskSections); performance pages live in their own area (/performance). Boards (My / Team tasks, Blocker reviews,
 * Approvals) switch in place via `onScope` on the Tasks page, or open it from elsewhere; the rest open their page.
 * `active` defaults to the current page (taskViewKey), so the sub-pages can drop it in as the first filter-row control.
 */
export const TaskViewMenu: React.FC<{ active?: string; onScope?: (scope: TaskBoardScope) => void; align?: 'left' | 'right'; className?: string }> = ({
  active: activeProp,
  onScope,
  align,
  className,
}) => {
  const router = useRouter();
  const pathname = usePathname();
  const active = activeProp ?? taskViewKey(pathname);
  const { views, summary: s } = useTaskViews();
  const n = (v?: number) => (v && v > 0 ? v : undefined);

  const options = useMemo(() => {
    const board = (id: TaskBoardScope, label: string, icon: React.ReactNode, extra?: Partial<FilterMenuOption>): FilterMenuOption => ({
      key: id,
      label,
      icon,
      active: active === id,
      onSelect: () => (onScope ? onScope(id) : router.push(taskBoardHref(id))),
      ...extra,
    });
    const page = (href: string, label: string, icon: React.ReactNode, extra?: Partial<FilterMenuOption>): FilterMenuOption => ({
      key: href,
      label,
      icon,
      active: active === href,
      onSelect: () => router.push(href),
      ...extra,
    });
    const o: FilterMenuOption[] = [board('mine', 'My tasks', <CheckSquare />, { count: n(s?.my_overdue), urgent: true })];
    if (views.has('team')) o.push(board('team', s?.can_view_all && !s?.has_team ? 'All tasks' : 'Team tasks', <Users />, { count: n(s?.needs_reassignment) }));
    if (views.has('blockers')) o.push(board('blockers', 'Blocker reviews', <ShieldCheck />, { count: n(s?.pending_blockers), urgent: true }));
    if (views.has('approvals')) o.push(board('approvals', 'Approvals', <ClipboardCheck />, { count: n(s?.pending_approvals), urgent: true }));
    if (views.has('settings')) o.push(page('/tasks/settings', 'Settings', <Settings2 />));
    return o;
  }, [s, views, active, onScope, router]);

  // Nothing to switch to (no team board, review queue or manager page): no menu at all.
  if (options.length < 2) return null;
  return <FilterMenu label="View" icon={<LayoutList />} options={options} neutralKeys={[]} align={align} className={`shrink-0 ${className || ''}`} />;
};

/**
 * The filter-row card of a task page with only the View menu — for the states of a filter-row page that have
 * nothing to filter yet (loading, no access), so the navigation stays in the same place.
 */
export const TaskViewRow: React.FC = () => (
  <Card padding="sm" className="relative z-20 overflow-visible border-[#DCD8CE]">
    <TaskViewMenu />
  </Card>
);

/** Header bar for the task pages without a filter row (forms, details, settings): back to the board, plus the View dropdown. */
export const TasksNav: React.FC = () => {
  const active = taskViewKey(usePathname());
  const boardScope = (TASK_BOARD_SCOPES as string[]).includes(active) ? (active as TaskBoardScope) : 'mine';
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Link href={taskBoardHref(boardScope)}>
        <Button size="sm" variant="secondary" className="h-9" leftIcon={<Columns3 className="h-4 w-4" />}>
          Task board
        </Button>
      </Link>
      <TaskViewMenu active={active} />
    </div>
  );
};

// ------------------------------------------------------------------ dialogs
/**
 * Phones: sticky to the bottom of the sheet, edge to edge (the negative margins cancel the modal body's
 * px-4 / pb-4). `!-mb-4` because a parent's space-y would otherwise reset that bottom margin.
 */
const STICKY_ACTIONS = 'sticky -bottom-4 z-10 -mx-4 !-mb-4 border-t border-[#DCD8CE] bg-white px-4 py-3 sm:static sm:mx-0 sm:!mb-0 sm:border-t-0 sm:bg-transparent sm:p-0';

/**
 * The action row at the end of a task dialog. Phones (bottom sheet): the buttons share the full width as
 * big thumb targets, and the row sticks to the bottom of the sheet. From `sm` up: the plain right-aligned
 * row it always was. Pass the desktop spacing (e.g. `sm:pt-1`) in `className`.
 * `sticky={false}` for a confirm-only dialog with nothing above the buttons to scroll past.
 */
export const DialogActions: React.FC<{ children: React.ReactNode; className?: string; sticky?: boolean }> = ({ children, className, sticky = true }) => (
  <div className={`flex items-center gap-2 [&>*]:min-w-0 [&>*]:flex-1 sm:justify-end sm:[&>*]:flex-none ${sticky ? STICKY_ACTIONS : ''} ${className || ''}`}>{children}</div>
);

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
            <img src={url} alt={file.file_name} className="max-h-[60dvh] max-w-full h-auto w-auto object-contain sm:max-h-[70vh]" />
          ) : isPdf ? (
            <iframe src={url} title={file.file_name} className="w-full h-[60dvh] sm:h-[70vh]" />
          ) : (
            <div className="text-center p-6 space-y-2">
              <FileText className="h-10 w-10 mx-auto text-[#4A5568]" />
              <p className="text-sm text-[#4A5568]">This format cannot be previewed — download it instead.</p>
            </div>
          )}
        </div>
        <div className="flex justify-end">
          <Button variant="secondary" size="sm" className="h-10 w-full sm:h-8 sm:w-auto" disabled={!blob} leftIcon={<Download className="h-4 w-4" />} onClick={() => blob && saveBlob(blob, file.file_name)}>
            Download
          </Button>
        </div>
      </div>
    </Modal>
  );
};

const PURPOSE_LABEL: Record<TaskAttachment['purpose'], string> = { supporting_doc: 'Supporting', evidence: 'Evidence', blocker_evidence: 'Blocker', update: 'Update' };

export const FileList: React.FC<{ files: TaskAttachment[]; onOpen: (f: TaskAttachment) => void; onRemove?: (f: TaskAttachment) => void; canRemove?: (f: TaskAttachment) => boolean }> = ({ files, onOpen, onRemove, canRemove }) => {
  if (!files.length) return <p className="text-xs text-[#6B7280]">No files yet.</p>;
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
          <span className="hidden sm:inline text-[11px] text-[#6B7280] font-mono">{fileSize(f.size_bytes)}</span>
          {onRemove && canRemove?.(f) && (
            <button type="button" aria-label={`Remove ${f.file_name}`} onClick={() => onRemove(f)} className="-my-1 p-2 text-[#6B7280] hover:text-[#881337] sm:my-0 sm:p-1">
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
  if (m.blocker_type) bits.push(blockerTypeLabel(m.blocker_type));
  if (m.raised_after_deadline) bits.push('raised after the deadline');
  if (m.new_deadline) bits.push(`new deadline ${formatTaskDateTime(m.new_deadline)}`);
  if (m.source && TASK_DEADLINE_SOURCE_LABELS[m.source as keyof typeof TASK_DEADLINE_SOURCE_LABELS]) bits.push(TASK_DEADLINE_SOURCE_LABELS[m.source as keyof typeof TASK_DEADLINE_SOURCE_LABELS]);
  if (m.locked_unexcused_minutes) bits.push(`${formatDuration(m.locked_unexcused_minutes)} already overdue stays unexcused`);
  if (m.to_name) bits.push(`to ${m.to_name}`);
  if (m.reason_type) bits.push(TASK_REASSIGN_REASON_LABELS[m.reason_type as keyof typeof TASK_REASSIGN_REASON_LABELS] || m.reason_type);
  if (m.mode) bits.push(m.mode === 'pause' ? 'pause (deadline moves when resolved)' : 'extend now');
  if (m.late) bits.push('completed after the deadline');
  if (m.generated_late) bits.push('generated late (excluded from metrics)');
  if (m.delay_reason) bits.push(`delay reason: ${m.delay_reason}`);
  return bits.length ? bits.join(' · ') : null;
}

export const ActivityTimeline: React.FC<{ updates: TaskUpdate[] }> = ({ updates }) => {
  if (!updates.length) return <p className="text-sm text-[#6B7280]">No activity yet.</p>;
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
              <span className="text-[11px] font-mono text-[#6B7280] ml-auto">{formatTaskDateTime(u.created_at)}</span>
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
