'use client';

/**
 * Decision boards for the two review queues (Tasks → View → Blocker reviews / Approvals).
 * What waits on me sits in the first column; dragging a card onto a decision column, or using its buttons,
 * opens the same dialog as the queue pages, and the API re-checks routing, status and version.
 * The decision columns also show what is already decided in my scope, so each board reads as a pipeline.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Ban, CheckCircle2, CircleCheck, ExternalLink, Flag, Hourglass, Paperclip, PauseCircle, ShieldAlert, Undo2, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui';
import { api } from '@/lib/api';
import { formatTaskDate, formatTaskDateTime, type TaskPriority } from '@arihant/shared';
import { errorMessage, notifyTasksChanged, type TaskAttachment, type TaskRow } from './task-lib';
import { DelayBadge, FileViewer, FlagChip, PriorityBadge, TaskConflictCallout, blockerTypeLabel } from './task-ui';
import { TaskActionDialog, type ActionTask, type TaskDialogAction } from './TaskActions';
import { DueChip, PRIORITY_STRIPE, initials } from './TaskBoard';
import { useTaskList } from './TaskList';

// ------------------------------------------------------------------ queue rows
export interface PendingBlocker {
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

export type ApprovalRow = TaskRow & { evidence: TaskAttachment[]; waiting_hours: number; sla_breached: boolean };

/** "5h", "2d 3h". */
export const waitingAge = (h: number) => (h < 24 ? `${h}h` : `${Math.floor(h / 24)}d ${h % 24}h`);

/** The blocker queue row in the shape the action dialog needs. */
export const blockerActionTask = (b: PendingBlocker): ActionTask => ({
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

const matches = (q: string, ...fields: (string | null | undefined)[]) => !q || fields.some((f) => f?.toLowerCase().includes(q));

// ------------------------------------------------------------------ shared board pieces
interface QueueBoardProps {
  /** Committed search text (task number, title or assignee). */
  search: string;
  /** 'all' shows every pending item (management / admin); 'mine' only what is routed to me. */
  scope: 'mine' | 'all';
  /** GET /tasks view for the decided columns. */
  teamView: 'team' | 'all';
  notify: (kind: 'success' | 'error', text: string) => void;
  /** Called after a decision (refresh counts). */
  onChanged: () => void;
}

interface ColumnDef {
  id: string;
  label: string;
  icon: LucideIcon;
  accent: string;
  empty: string;
  /** Dropping a waiting card here opens this decision. */
  drop?: { action: TaskDialogAction; label: string };
}

/** One board column; a drop target when `drop` is set and a waiting card is being dragged. */
const QueueColumn: React.FC<{
  col: ColumnDef;
  count: number;
  badge?: React.ReactNode;
  dragging: boolean;
  isOver: boolean;
  onOver: (over: boolean) => void;
  onDrop: () => void;
  footnote?: string;
  children: React.ReactNode;
}> = ({ col, count, badge, dragging, isOver, onOver, onDrop, footnote, children }) => {
  const Icon = col.icon;
  const target = dragging && Boolean(col.drop);
  return (
    <section
      aria-label={`${col.label} (${count})`}
      onDragOver={(e) => {
        if (!target) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (!isOver) onOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onOver(false);
      }}
      onDrop={(e) => {
        if (!target) return;
        e.preventDefault();
        onDrop();
      }}
      className={`flex w-[84vw] max-w-[340px] shrink-0 snap-start flex-col rounded-[14px] border border-t-[3px] border-[#DCD8CE] bg-[#FBFAF7] transition-colors sm:w-[300px] lg:w-auto lg:min-w-[260px] lg:max-w-none lg:flex-1 ${
        target ? 'border-[#0F5E63] bg-[#E3EFEE]/40' : dragging ? 'opacity-55' : ''
      } ${isOver && target ? 'ring-2 ring-[#0F5E63]/30' : ''}`}
      style={{ borderTopColor: col.accent }}
    >
      <header className="flex items-center gap-1.5 border-b border-[#ECE9E2] px-3 py-2.5">
        <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: col.accent }} aria-hidden />
        <h3 className="min-w-0 truncate font-serif text-[13px] font-bold text-[#14213D]" title={col.label}>
          {col.label}
        </h3>
        <span className="shrink-0 rounded-full border border-[#DCD8CE] bg-white px-1.5 py-px font-mono text-[10px] font-semibold text-[#4A5568]">{count}</span>
        {badge}
      </header>
      <ul className="flex min-h-[180px] flex-1 flex-col gap-2 p-2 md:max-h-[calc(100dvh-240px)] md:overflow-y-auto custom-scrollbar">
        {target && (
          <li
            aria-hidden
            className={`shrink-0 rounded-[10px] border border-dashed px-3 py-2.5 text-center text-[11px] font-semibold text-[#0F5E63] transition-colors ${isOver ? 'border-[#0F5E63] bg-[#E3EFEE]' : 'border-[#0F5E63]/50'}`}
          >
            Drop to {col.drop!.label.toLowerCase()}
          </li>
        )}
        {count === 0 && !target && (
          <li className="flex flex-1 flex-col items-center justify-center gap-1.5 rounded-[10px] border border-dashed border-[#DCD8CE] p-4 text-center">
            <Icon className="h-5 w-5 text-[#C9C4B8]" aria-hidden />
            <span className="text-[11px] text-[#8A8578]">{col.empty}</span>
          </li>
        )}
        {children}
      </ul>
      {footnote && <p className="border-t border-[#ECE9E2] px-3 py-2 text-[11px] text-[#8A8578]">{footnote}</p>}
    </section>
  );
};

const CardShell: React.FC<{ priority: TaskPriority; draggable?: boolean; dragging?: boolean; alert?: boolean; onDragStart?: (e: React.DragEvent<HTMLLIElement>) => void; onDragEnd?: () => void; children: React.ReactNode }> = ({
  priority,
  draggable,
  dragging,
  alert,
  onDragStart,
  onDragEnd,
  children,
}) => (
  <li
    draggable={draggable}
    onDragStart={onDragStart}
    onDragEnd={onDragEnd}
    className={`relative shrink-0 overflow-hidden rounded-[12px] border bg-white shadow-[0_1px_0_rgba(20,33,61,0.04)] transition-all hover:border-[#C9C4B8] hover:shadow-sm ${alert ? 'border-[#E9C9B4]' : 'border-[#DCD8CE]'} ${
      dragging ? 'rotate-1 opacity-40' : ''
    } ${draggable ? 'cursor-grab active:cursor-grabbing' : ''}`}
  >
    <span aria-hidden className="absolute inset-y-0 left-0 w-[3px]" style={{ background: PRIORITY_STRIPE[priority] || '#C9C4B8' }} />
    <div className="space-y-2 py-2.5 pl-3.5 pr-2.5">{children}</div>
  </li>
);

const CardTop: React.FC<{ id: string; number: string; right?: React.ReactNode }> = ({ id, number, right }) => (
  <div className="flex items-center gap-1.5">
    <Link href={`/tasks/${id}`} draggable={false} className="inline-flex shrink-0 items-center gap-1 font-mono text-[11px] font-semibold text-[#0F5E63] hover:underline">
      {number}
      <ExternalLink className="h-3 w-3" aria-hidden />
    </Link>
    <span className="min-w-0 flex-1" />
    {right}
  </div>
);

const Person: React.FC<{ name: string | null; label?: string }> = ({ name, label }) => (
  <span className="inline-flex min-w-0 items-center gap-1.5 text-[11px] text-[#4A5568]" title={label}>
    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#E3EFEE] font-mono text-[9px] font-bold text-[#0F5E63]">{initials(name)}</span>
    <span className="truncate">{name || 'Unassigned'}</span>
  </span>
);

const WaitChip: React.FC<{ hours: number; breached: boolean; sla?: number }> = ({ hours, breached, sla }) => (
  <span
    className={`shrink-0 rounded-full px-2 py-0.5 font-mono text-[10px] font-bold ${breached ? 'bg-[#9A3412] text-white' : 'bg-[#FBEBDD] text-[#7C2D12]'}`}
    title={breached && sla ? `Over the ${sla}h review SLA` : 'Waiting for your decision'}
  >
    {waitingAge(hours)}
  </span>
);

/** Read-only card for work already decided (approved, sent back, accepted). */
const DecidedCard: React.FC<{ task: TaskRow; children?: React.ReactNode }> = ({ task: t, children }) => (
  <CardShell priority={t.priority} alert={t.is_overdue}>
    <CardTop id={t.id} number={t.task_number} right={<PriorityBadge priority={t.priority} />} />
    <Link href={`/tasks/${t.id}`} className="block text-sm font-medium leading-snug text-[#14213D] line-clamp-2 hover:underline">
      {t.title}
    </Link>
    {children}
    <div className="flex items-center justify-between gap-2 border-t border-[#ECE9E2] pt-2">
      <DueChip task={t} />
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#E3EFEE] font-mono text-[10px] font-bold text-[#0F5E63] ring-2 ring-white" title={`Assigned to ${t.assignee_name || 'nobody'}`}>
        {initials(t.assignee_name)}
      </span>
    </div>
  </CardShell>
);

/** Shared drag / dialog / reload plumbing for both boards. */
function useDecisionBoard(reloadAll: () => void, notify: QueueBoardProps['notify'], onChanged: () => void) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ action: TaskDialogAction; task: ActionTask } | null>(null);
  const [conflict, setConflict] = useState(false);
  const endDrag = () => {
    setDragId(null);
    setOverCol(null);
  };
  const dialogEl = (
    <TaskActionDialog
      action={dialog?.action ?? null}
      task={dialog?.task ?? null}
      onClose={() => setDialog(null)}
      onDone={(_detail, message) => {
        setDialog(null);
        notify('success', message);
        notifyTasksChanged();
        reloadAll();
        onChanged();
      }}
      onConflict={() => setConflict(true)}
    />
  );
  const conflictEl = conflict && (
    <TaskConflictCallout
      onRefresh={() => {
        setConflict(false);
        reloadAll();
      }}
    />
  );
  return { dragId, setDragId, overCol, setOverCol, endDrag, setDialog, dialogEl, conflictEl };
}

function usePending<T>(path: string, scope: 'mine' | 'all') {
  const [rows, setRows] = useState<T[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setError(null);
    try {
      setRows(await api.get<T[]>(path, { scope }));
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [path, scope]);
  useEffect(() => {
    load();
  }, [load]);
  return { rows, error, reload: load };
}

const BoardFrame: React.FC<{ hint: string; error: string | null; conflict: React.ReactNode; dialog: React.ReactNode; children: React.ReactNode; extra?: React.ReactNode }> = ({ hint, error, conflict, dialog, children, extra }) => (
  <div className="space-y-3">
    {conflict}
    {error && <p className="rounded-lg border border-[#F3C7CF] bg-[#FCE8EC] px-3 py-2 text-xs font-medium text-[#881337]">{error}</p>}
    <p className="hidden text-[11px] text-[#4A5568] md:block">{hint}</p>
    {/* overflowX inline: theme.css resets `.overflow-x-auto` below 1180px for stacked tables */}
    <div className="custom-scrollbar -mx-1 px-1 pb-2" style={{ overflowX: 'auto' }}>
      <div className="flex items-stretch gap-3 snap-x snap-mandatory lg:snap-none">{children}</div>
    </div>
    {dialog}
    {extra}
  </div>
);

// ------------------------------------------------------------------ blocker reviews
const BLOCKER_COLUMNS: ColumnDef[] = [
  { id: 'review', label: 'Needs your review', icon: ShieldAlert, accent: '#9A3412', empty: 'No blocker is waiting for your decision.' },
  { id: 'accepted', label: 'Accepted · clock paused', icon: PauseCircle, accent: '#0F5E63', empty: 'Accepted blockers stay here until the dependency clears.', drop: { action: 'accept_blocker', label: 'Accept' } },
  { id: 'rejected', label: 'Reject', icon: Ban, accent: '#881337', empty: 'Drop a blocker here to reject it. The task returns to its previous status and the delay counts as unapproved.', drop: { action: 'reject_blocker', label: 'Reject' } },
];

export const BlockerReviewBoard: React.FC<QueueBoardProps> = ({ search, scope, teamView, notify, onChanged }) => {
  const pending = usePending<PendingBlocker>('/task-blockers/pending', scope);
  const blocked = useTaskList({ view: teamView, statuses: 'blocked', sort_by: 'deadline', page_size: 100 });
  const reloadAll = () => {
    pending.reload();
    blocked.reload();
  };
  const b = useDecisionBoard(reloadAll, notify, onChanged);
  const q = search.trim().toLowerCase();

  const waiting = useMemo(() => (pending.rows || []).filter((r) => matches(q, r.task_number, r.task_title, r.assignee_name)), [pending.rows, q]);
  const accepted = useMemo(
    () => (blocked.data?.data || []).filter((t) => t.open_blocker?.status === 'accepted' && matches(q, t.task_number, t.title, t.assignee_name)),
    [blocked.data, q],
  );
  const breached = waiting.filter((r) => r.sla_breached).length;
  const dragRow = b.dragId ? waiting.find((r) => r.id === b.dragId) : undefined;

  const decide = (col: ColumnDef, row: PendingBlocker | undefined) => {
    b.endDrag();
    if (row && col.drop) b.setDialog({ action: col.drop.action, task: blockerActionTask(row) });
  };

  if (!pending.rows && !pending.error) return <BoardSkeleton />;

  return (
    <BoardFrame
      hint="Genuine dependency or poor execution? Drag a blocker onto Accepted (deadline relief) or Reject, or use the buttons on the card. Review time is never counted against the employee."
      error={pending.error || blocked.error}
      conflict={b.conflictEl}
      dialog={b.dialogEl}
    >
      {BLOCKER_COLUMNS.map((col) => {
        const count = col.id === 'review' ? waiting.length : col.id === 'accepted' ? accepted.length : 0;
        return (
          <QueueColumn
            key={col.id}
            col={col}
            count={count}
            badge={
              col.id === 'review' && breached > 0 ? (
                <span className="shrink-0 rounded-full bg-[#9A3412] px-1.5 py-px font-mono text-[10px] font-bold text-white" title={`${breached} over the review SLA`}>
                  {breached} SLA
                </span>
              ) : undefined
            }
            dragging={Boolean(dragRow)}
            isOver={b.overCol === col.id}
            onOver={(over) => b.setOverCol(over ? col.id : null)}
            onDrop={() => decide(col, dragRow)}
            footnote={col.id === 'accepted' && blocked.data && blocked.data.total > blocked.data.data.length ? `Showing accepted blockers among the first ${blocked.data.data.length} blocked tasks.` : undefined}
          >
            {col.id === 'review' &&
              waiting.map((r) => (
                <CardShell
                  key={r.id}
                  priority={r.priority}
                  alert={r.sla_breached || r.is_task_overdue}
                  draggable
                  dragging={b.dragId === r.id}
                  onDragStart={(e) => {
                    e.dataTransfer.setData('text/plain', r.id);
                    e.dataTransfer.effectAllowed = 'move';
                    b.setDragId(r.id);
                  }}
                  onDragEnd={b.endDrag}
                >
                  <CardTop id={r.task_id} number={r.task_number} right={<WaitChip hours={r.age_hours} breached={r.sla_breached} sla={r.sla_hours} />} />
                  <Link href={`/tasks/${r.task_id}`} draggable={false} className="block text-sm font-medium leading-snug text-[#14213D] line-clamp-2 hover:underline">
                    {r.task_title}
                  </Link>
                  <div className="flex items-center justify-between gap-2">
                    <Person name={r.assignee_name} label="Raised by the assignee" />
                    <PriorityBadge priority={r.priority} />
                  </div>
                  <div className="space-y-1 rounded-lg border border-[#ECE9E2] bg-[#FBFAF7] p-2">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-[#14213D]">
                      <Flag className="h-3 w-3 shrink-0 text-[#9A3412]" aria-hidden />
                      <span className="truncate">{blockerTypeLabel(r.blocker_type)}</span>
                    </div>
                    <p className="text-[11px] leading-snug text-[#4A5568] line-clamp-3">{r.description}</p>
                    {r.requested_new_deadline && (
                      <p className="text-[11px] text-[#4A5568]">
                        Asks for <span className="font-mono">{formatTaskDateTime(r.requested_new_deadline)}</span>
                      </p>
                    )}
                  </div>
                  {(r.raised_after_deadline || r.repeated_flag || r.extension_count >= 2 || r.is_task_overdue) && (
                    <div className="flex flex-wrap gap-1">
                      {r.is_task_overdue && <FlagChip tone="danger">Task overdue</FlagChip>}
                      {r.raised_after_deadline && <FlagChip>After deadline</FlagChip>}
                      {r.repeated_flag && <FlagChip tone="danger">Raised {r.same_type_count}×</FlagChip>}
                      {r.extension_count >= 2 && <FlagChip>{r.extension_count} extensions</FlagChip>}
                    </div>
                  )}
                  <div className="flex items-center gap-2 border-t border-[#ECE9E2] pt-2">
                    <Button size="xs" variant="secondary" className="h-9 flex-1 md:h-7" leftIcon={<Ban className="h-3.5 w-3.5" />} onClick={() => b.setDialog({ action: 'reject_blocker', task: blockerActionTask(r) })}>
                      Reject
                    </Button>
                    <Button size="xs" className="h-9 flex-1 md:h-7" leftIcon={<CheckCircle2 className="h-3.5 w-3.5" />} onClick={() => b.setDialog({ action: 'accept_blocker', task: blockerActionTask(r) })}>
                      Accept
                    </Button>
                  </div>
                </CardShell>
              ))}
            {col.id === 'accepted' &&
              accepted.map((t) => (
                <DecidedCard key={t.id} task={t}>
                  <p className="flex items-center gap-1.5 text-[11px] text-[#4A5568]">
                    <Flag className="h-3 w-3 shrink-0 text-[#0F5E63]" aria-hidden />
                    <span className="truncate">{t.open_blocker ? blockerTypeLabel(t.open_blocker.blocker_type) : 'Blocker'}</span>
                  </p>
                  <Button size="xs" variant="secondary" className="h-9 w-full md:h-7" leftIcon={<CheckCircle2 className="h-3.5 w-3.5" />} onClick={() => b.setDialog({ action: 'resolve_blocker', task: t })}>
                    Mark resolved
                  </Button>
                </DecidedCard>
              ))}
          </QueueColumn>
        );
      })}
    </BoardFrame>
  );
};

// ------------------------------------------------------------------ approvals
const APPROVAL_COLUMNS: ColumnDef[] = [
  { id: 'review', label: 'Awaiting your approval', icon: Hourglass, accent: '#A15C07', empty: 'Nothing to approve. Completed work that needs sign-off appears here.' },
  { id: 'approved', label: 'Approved', icon: CircleCheck, accent: '#1F7A55', empty: 'Recently approved work in your team shows here.', drop: { action: 'approve', label: 'Approve' } },
  { id: 'sent_back', label: 'Sent back for rework', icon: Undo2, accent: '#9A3412', empty: 'Work sent back for rework shows here until it is handed in again.', drop: { action: 'send_back', label: 'Send back' } },
];

export const ApprovalBoard: React.FC<QueueBoardProps> = ({ search, scope, teamView, notify, onChanged }) => {
  const pending = usePending<ApprovalRow>('/tasks/approvals/pending', scope);
  const completed = useTaskList({ view: teamView, statuses: 'completed', sort_by: 'updated_at', sort_dir: 'desc', page_size: 50 });
  const working = useTaskList({ view: teamView, statuses: 'in_progress', sort_by: 'updated_at', sort_dir: 'desc', page_size: 100 });
  const [viewer, setViewer] = useState<TaskAttachment | null>(null);
  const reloadAll = () => {
    pending.reload();
    completed.reload();
    working.reload();
  };
  const b = useDecisionBoard(reloadAll, notify, onChanged);
  const q = search.trim().toLowerCase();

  const waiting = useMemo(() => (pending.rows || []).filter((r) => matches(q, r.task_number, r.title, r.assignee_name)), [pending.rows, q]);
  const approved = useMemo(() => (completed.data?.data || []).filter((t) => t.approved_at && matches(q, t.task_number, t.title, t.assignee_name)), [completed.data, q]);
  const sentBack = useMemo(() => (working.data?.data || []).filter((t) => t.rework_count > 0 && matches(q, t.task_number, t.title, t.assignee_name)), [working.data, q]);
  const breached = waiting.filter((r) => r.sla_breached).length;
  const dragRow = b.dragId ? waiting.find((r) => r.id === b.dragId) : undefined;

  const decide = (col: ColumnDef, row: ApprovalRow | undefined) => {
    b.endDrag();
    if (row && col.drop) b.setDialog({ action: col.drop.action, task: row });
  };

  if (!pending.rows && !pending.error) return <BoardSkeleton />;

  return (
    <BoardFrame
      hint="Drag finished work onto Approved or Sent back, or use the buttons on the card. Check the evidence before you approve."
      error={pending.error || completed.error || working.error}
      conflict={b.conflictEl}
      dialog={b.dialogEl}
      extra={<FileViewer file={viewer} onClose={() => setViewer(null)} />}
    >
      {APPROVAL_COLUMNS.map((col) => {
        const count = col.id === 'review' ? waiting.length : col.id === 'approved' ? approved.length : sentBack.length;
        return (
          <QueueColumn
            key={col.id}
            col={col}
            count={count}
            badge={
              col.id === 'review' && breached > 0 ? (
                <span className="shrink-0 rounded-full bg-[#9A3412] px-1.5 py-px font-mono text-[10px] font-bold text-white" title={`${breached} over the approval SLA`}>
                  {breached} SLA
                </span>
              ) : undefined
            }
            dragging={Boolean(dragRow)}
            isOver={b.overCol === col.id}
            onOver={(over) => b.setOverCol(over ? col.id : null)}
            onDrop={() => decide(col, dragRow)}
            footnote={col.id === 'approved' && approved.length ? 'Latest approvals in your scope.' : undefined}
          >
            {col.id === 'review' &&
              waiting.map((t) => (
                <CardShell
                  key={t.id}
                  priority={t.priority}
                  alert={t.sla_breached}
                  draggable
                  dragging={b.dragId === t.id}
                  onDragStart={(e) => {
                    e.dataTransfer.setData('text/plain', t.id);
                    e.dataTransfer.effectAllowed = 'move';
                    b.setDragId(t.id);
                  }}
                  onDragEnd={b.endDrag}
                >
                  <CardTop id={t.id} number={t.task_number} right={<WaitChip hours={t.waiting_hours} breached={t.sla_breached} />} />
                  <Link href={`/tasks/${t.id}`} draggable={false} className="block text-sm font-medium leading-snug text-[#14213D] line-clamp-2 hover:underline">
                    {t.title}
                  </Link>
                  <div className="flex items-center justify-between gap-2">
                    <Person name={t.assignee_name} label="Completed by" />
                    <PriorityBadge priority={t.priority} />
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    <span className="text-[11px] text-[#4A5568]">
                      Done <span className="font-mono">{formatTaskDate(t.completed_at)}</span>
                    </span>
                    <DelayBadge delay={t.delay_class} />
                    {t.rework_count > 0 && <FlagChip>{t.rework_count} rework</FlagChip>}
                  </div>
                  {t.completion_remarks && <p className="rounded-lg border border-[#ECE9E2] bg-[#FBFAF7] px-2 py-1.5 text-[11px] leading-snug text-[#14213D] line-clamp-3">{t.completion_remarks}</p>}
                  {t.evidence.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {t.evidence.slice(0, 2).map((f) => (
                        <button
                          key={f.id}
                          type="button"
                          draggable={false}
                          onClick={() => setViewer(f)}
                          className="inline-flex max-w-full items-center gap-1 rounded-full border border-[#DCD8CE] bg-white px-2 py-0.5 text-[10px] font-medium text-[#0F5E63] hover:bg-[#E3EFEE]"
                        >
                          <Paperclip className="h-3 w-3 shrink-0" aria-hidden />
                          <span className="truncate">{f.file_name}</span>
                        </button>
                      ))}
                      {t.evidence.length > 2 && (
                        <Link href={`/tasks/${t.id}`} className="text-[10px] font-semibold text-[#0F5E63] hover:underline">
                          +{t.evidence.length - 2} more
                        </Link>
                      )}
                    </div>
                  ) : t.evidence_required ? (
                    <FlagChip tone="danger">Evidence missing</FlagChip>
                  ) : null}
                  <div className="flex items-center gap-2 border-t border-[#ECE9E2] pt-2">
                    <Button size="xs" variant="secondary" className="h-9 flex-1 md:h-7" leftIcon={<Undo2 className="h-3.5 w-3.5" />} onClick={() => b.setDialog({ action: 'send_back', task: t })}>
                      Send back
                    </Button>
                    <Button size="xs" className="h-9 flex-1 md:h-7" leftIcon={<CheckCircle2 className="h-3.5 w-3.5" />} onClick={() => b.setDialog({ action: 'approve', task: t })}>
                      Approve
                    </Button>
                  </div>
                </CardShell>
              ))}
            {col.id === 'approved' && approved.map((t) => <DecidedCard key={t.id} task={t}>{t.delay_class && <DelayBadge delay={t.delay_class} />}</DecidedCard>)}
            {col.id === 'sent_back' &&
              sentBack.map((t) => (
                <DecidedCard key={t.id} task={t}>
                  <FlagChip>Rework round {t.rework_count}</FlagChip>
                </DecidedCard>
              ))}
          </QueueColumn>
        );
      })}
    </BoardFrame>
  );
};

const BoardSkeleton: React.FC = () => (
  <div className="flex gap-3 overflow-hidden" aria-busy aria-label="Loading board">
    {[0, 1, 2].map((i) => (
      <div key={i} className="h-[320px] w-[84vw] max-w-[340px] shrink-0 animate-pulse rounded-[14px] border border-[#ECE9E2] bg-[#FBFAF7] sm:w-[300px] lg:w-auto lg:flex-1" />
    ))}
  </div>
);
