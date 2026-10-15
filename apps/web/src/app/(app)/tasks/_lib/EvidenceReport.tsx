'use client';

/**
 * Performance evidence report renderer (Blueprint §43), shared by /tasks/evidence (live + frozen snapshots)
 * and /tasks/my-performance. Purely factual: counts, dates and days. There is deliberately no monetary
 * field, recommendation or score here — the disclaimer is rendered by the page above this component.
 *
 * Also exports the period picker, the delay-mix bar and the review card used by the Module 8 evidence pages.
 */
import React from 'react';
import Link from 'next/link';
import { Lock, Snowflake } from 'lucide-react';
import {
  Badge,
  Button,
  ButtonGroup,
  Card,
  InfoCallout,
  Input,
  SectionHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui';
import {
  TASK_DELAY_CLASS_LABELS,
  TASK_PRIORITY_LABELS,
  TASK_REASSIGN_REASON_LABELS,
  formatTaskDate,
  formatTaskDateTime,
  type PerformanceReviewStatus,
  type TaskBlockerStatus,
  type TaskDelayClass,
  type TaskDisplayStatus,
  type TaskEvidenceBasis,
  type TaskPriority,
  type TaskReassignReason,
} from '@arihant/shared';
import { addDays, istToday } from './task-lib';
import { BlockerBadge, DateTime, DelayBadge, FlagChip, Meta, StatusBadge, blockerTypeLabel } from './task-ui';

// ------------------------------------------------------------------ types (mirror PerformanceEvidenceService.report())
export interface EvidenceReview {
  id: string;
  period_from: string;
  period_to: string;
  rating: number | null;
  rating_scale: number;
  strengths: string | null;
  improvement_areas: string | null;
  comments: string | null;
  employee_response: string | null;
  employee_responded_at: string | null;
  employee_acknowledged_at: string | null;
  status: PerformanceReviewStatus;
  submitted_at?: string | null;
  version: number;
  reviewer_name: string;
}

/** A row of GET /performance-reviews. */
export interface PerformanceReview extends EvidenceReview {
  employee_id: string;
  employee_name?: string;
  reviewer_id: string;
  supersedes_id: string | null;
  superseded_by_id: string | null;
  revision_reason: string | null;
  created_at?: string;
}

export interface EvidenceTaskRow {
  id: string;
  task_number: string;
  title: string;
  category: string | null;
  priority: TaskPriority;
  recurring: boolean;
  status: string;
  original_deadline: string | null;
  deadline: string | null;
  completed_at: string | null;
  delay_class: TaskDelayClass | null;
  excluded: 'cancelled' | 'backlog' | 'generated_late' | null;
  unexcused_delay_days: number;
  excused_delay_days: number;
  extensions: number;
  blockers: string;
  rework: number;
  reopened: number;
  reassigned: number;
  delay_reason: string | null;
  cancelled_reason: string | null;
  customer: string | null;
  tender_no: string | null;
}

export interface EvidenceBlockerRow {
  id: string;
  task_number: string;
  type: string;
  status: TaskBlockerStatus;
  decision: string | null;
  raised_at: string;
  raised_after_deadline: boolean;
  excused_days: number;
  description: string;
  decision_comment: string | null;
}

export interface EvidenceReassignment {
  id: string;
  task_id: string;
  task_number: string;
  title: string;
  to_name: string | null;
  reason: string;
  reason_type: TaskReassignReason | string;
  was_overdue: boolean;
  overdue_days: number;
  counted_as_miss: boolean;
  created_at: string;
}

export interface EvidenceReportData {
  employee: {
    id: string;
    name: string;
    email: string | null;
    employee_code: string | null;
    role: string;
    department: string | null;
    manager: string | null;
    region: string | null;
    is_active: boolean;
    deactivated_at: string | null;
  };
  period: { from: string; to: string; requested_to: string; basis: TaskEvidenceBasis; basis_note: string; frozen_at_deactivation: string | null };
  generated_at: string;
  disclaimer: string;
  work_assigned: { total: number; by_category: Record<string, number>; by_priority: Record<string, number>; recurring: number; one_time: number };
  completion: { completed: number; awaiting_approval: number; open: number; cancelled: number; completion_rate_pct: number | null };
  compliance: {
    assessed: number;
    completed: number;
    on_time: number;
    late_excused: number;
    late_unexcused: number;
    open_overdue: number;
    open: number;
    on_time_pct: number | null;
    avg_unexcused_delay_days: number;
    total_unexcused_delay_days: number;
    total_excused_delay_days: number;
    extensions_requested: number;
    extensions_granted: number;
  };
  blockers: {
    raised: number;
    accepted: number;
    accepted_by_type: Record<string, number>;
    rejected: number;
    pending: number;
    withdrawn: number;
    raised_after_deadline: number;
    excused_days: number;
    extensions_requested: number;
  };
  repeated_misses: { recurring_instances_missed: number; tasks_with_multiple_extensions: number; rework_count: number; reopen_count: number; tasks_reworked_or_reopened: number };
  reassignments: { reassigned_away: EvidenceReassignment[]; counted_as_miss: number };
  excluded: { cancelled: number; backlog_entries: number; generated_late: number };
  reviews: EvidenceReview[];
  blocker_list: EvidenceBlockerRow[];
  tasks: EvidenceTaskRow[];
}

export const BASIS_LABEL: Record<TaskEvidenceBasis, string> = { deadline: 'By original deadline', completion: 'By completion date' };

const pct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${v}%`);
const days = (v: number | null | undefined) => `${v ?? 0} d`;
const roleLabel = (r: string) => r.replace(/_/g, ' ');
const Num: React.FC<{ children: React.ReactNode }> = ({ children }) => <span className="font-mono tabular-nums">{children}</span>;

// ------------------------------------------------------------------ period picker
export type PeriodPreset = 'this_month' | 'last_month' | 'last_30' | 'this_quarter';

const PRESET_LABEL: Record<PeriodPreset, string> = { this_month: 'This month', last_month: 'Last month', last_30: 'Last 30 days', this_quarter: 'This quarter' };

/** IST calendar ranges. Indian financial-year quarters coincide with calendar quarters (Apr–Jun, Jul–Sep, …). */
export function presetRange(p: PeriodPreset): { from: string; to: string } {
  const today = istToday();
  const monthStart = `${today.slice(0, 7)}-01`;
  if (p === 'last_month') {
    const prevEnd = addDays(monthStart, -1);
    return { from: `${prevEnd.slice(0, 7)}-01`, to: prevEnd };
  }
  if (p === 'last_30') return { from: addDays(today, -29), to: today };
  if (p === 'this_quarter') {
    const m = Number(today.slice(5, 7));
    const qm = Math.floor((m - 1) / 3) * 3 + 1;
    return { from: `${today.slice(0, 4)}-${String(qm).padStart(2, '0')}-01`, to: today };
  }
  return { from: monthStart, to: today };
}

export const defaultPeriod = () => presetRange('this_month');

export const periodError = (from: string, to: string) => (from && to && from > to ? '"To" must be on or after "From".' : undefined);

export const PeriodPicker: React.FC<{
  from: string;
  to: string;
  onChange: (v: { from: string; to: string }) => void;
  errors?: Record<string, string>;
  presets?: PeriodPreset[];
  children?: React.ReactNode;
}> = ({ from, to, onChange, errors = {}, presets = ['this_month', 'last_month', 'last_30', 'this_quarter'], children }) => {
  const toError = errors.to || periodError(from, to);
  return (
    <div className="space-y-3">
      <ButtonGroup className="flex-wrap" role="group" aria-label="Period presets">
        {presets.map((p) => {
          const r = presetRange(p);
          const on = r.from === from && r.to === to;
          return (
            <Button key={p} type="button" size="xs" variant={on ? 'primary' : 'secondary'} aria-pressed={on} onClick={() => onChange(r)}>
              {PRESET_LABEL[p]}
            </Button>
          );
        })}
      </ButtonGroup>
      <div className={`grid grid-cols-2 gap-3 items-start ${children ? 'lg:grid-cols-4' : 'sm:max-w-md'}`}>
        <Input id="period-from" label="From" type="date" value={from} onChange={(e) => e.target.value && onChange({ from: e.target.value, to })} error={errors.from} />
        <Input id="period-to" label="To" type="date" value={to} min={from || undefined} onChange={(e) => e.target.value && onChange({ from, to: e.target.value })} error={toError} />
        {children}
      </div>
      <p className="text-[11px] text-[#4A5568]">Dates are calendar days in IST.</p>
    </div>
  );
};

// ------------------------------------------------------------------ delay mix bar
type MixKey = 'on_time' | 'late_excused' | 'late_unexcused' | 'open_overdue';

/**
 * Delay-class colours (validated for colour-vision separation; the amber has low contrast on white, so every
 * use carries visible numbers in the legend). Teal = on time, amber = excused, wine = unexcused, rust = overdue.
 */
export const DELAY_SERIES: { key: MixKey; label: string; color: string }[] = [
  { key: 'on_time', label: TASK_DELAY_CLASS_LABELS.on_time, color: '#16808A' },
  { key: 'late_excused', label: TASK_DELAY_CLASS_LABELS.late_excused, color: '#D9A23A' },
  { key: 'late_unexcused', label: TASK_DELAY_CLASS_LABELS.late_unexcused, color: '#8E1B4A' },
  { key: 'open_overdue', label: TASK_DELAY_CLASS_LABELS.open_overdue, color: '#C2410C' },
];

export const Swatch: React.FC<{ color: string }> = ({ color }) => <span aria-hidden className="inline-block h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: color }} />;

/** 100% stacked bar of delay classes with a legend that carries every number (identity is never colour-only). */
export const DelayMixBar: React.FC<{ counts: Partial<Record<MixKey, number>>; title: string; series?: MixKey[]; emptyText?: string }> = ({
  counts,
  title,
  series = ['on_time', 'late_excused', 'late_unexcused', 'open_overdue'],
  emptyText = 'No finished or overdue tasks in this period.',
}) => {
  const rows = DELAY_SERIES.filter((s) => series.includes(s.key)).map((s) => ({ ...s, n: counts[s.key] || 0 }));
  const total = rows.reduce((a, r) => a + r.n, 0);
  if (!total) return <p className="text-xs text-[#8A8578]">{emptyText}</p>;
  const share = (n: number) => Math.round((n / total) * 1000) / 10;
  return (
    <figure className="space-y-2.5">
      <div role="img" aria-label={`${title}: ${rows.map((r) => `${r.label} ${r.n}`).join(', ')} (of ${total})`} className="flex h-3 w-full gap-[2px] bg-white">
        {rows
          .filter((r) => r.n > 0)
          .map((r) => (
            <span
              key={r.key}
              title={`${r.label}: ${r.n} (${share(r.n)}%)`}
              className="h-full min-w-[4px] first:rounded-l-[4px] last:rounded-r-[4px]"
              style={{ flexGrow: r.n, flexBasis: 0, background: r.color }}
            />
          ))}
      </div>
      <figcaption>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#14213D]">
          {rows.map((r) => (
            <li key={r.key} className="inline-flex items-center gap-1.5">
              <Swatch color={r.color} />
              <span className="text-[#4A5568]">{r.label}</span>
              <span className="font-mono tabular-nums font-semibold">{r.n}</span>
              <span className="font-mono tabular-nums text-[11px] text-[#8A8578]">({share(r.n)}%)</span>
            </li>
          ))}
        </ul>
      </figcaption>
    </figure>
  );
};

// ------------------------------------------------------------------ review card
const REVIEW_STATUS: Record<PerformanceReviewStatus, { label: string; variant: 'outline' | 'info' | 'success' }> = {
  draft: { label: 'Draft', variant: 'outline' },
  submitted: { label: 'Submitted · locked', variant: 'info' },
  acknowledged: { label: 'Acknowledged by employee', variant: 'success' },
};

export const ReviewStatusBadge: React.FC<{ status: PerformanceReviewStatus }> = ({ status }) => (
  <Badge variant={REVIEW_STATUS[status]?.variant || 'outline'} size="sm" className="whitespace-nowrap">
    {status !== 'draft' && <Lock className="h-3 w-3" aria-hidden />}
    {REVIEW_STATUS[status]?.label || status}
  </Badge>
);

const TextBlock: React.FC<{ label: string; value: string | null | undefined }> = ({ label, value }) =>
  value ? (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-[#4A5568]">{label}</p>
      <p className="mt-0.5 text-sm text-[#14213D] whitespace-pre-wrap break-words">{value}</p>
    </div>
  ) : null;

/** One manager review with the employee's response and acknowledgement. `actions` / `children` render below. */
export const ReviewCard: React.FC<{ review: EvidenceReview & Partial<PerformanceReview>; actions?: React.ReactNode; children?: React.ReactNode; showEmployee?: boolean }> = ({
  review: r,
  actions,
  children,
  showEmployee,
}) => (
  <article className="rounded-[14px] border border-[#DCD8CE] bg-white p-4 space-y-3" aria-label={`Review for ${formatTaskDate(r.period_from)} to ${formatTaskDate(r.period_to)}`}>
    <header className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0">
        <p className="font-serif text-sm font-bold text-[#14213D]">
          Review period <span className="font-mono font-semibold">{formatTaskDate(r.period_from)}</span> to <span className="font-mono font-semibold">{formatTaskDate(r.period_to)}</span>
        </p>
        <p className="text-xs text-[#4A5568]">
          {showEmployee && r.employee_name ? `${r.employee_name} · ` : ''}Reviewer: {r.reviewer_name}
          {r.submitted_at ? (
            <>
              {' '}· submitted <DateTime value={r.submitted_at} />
            </>
          ) : null}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <ReviewStatusBadge status={r.status} />
        {r.supersedes_id && (
          <Badge variant="default" size="sm">
            Revised version
          </Badge>
        )}
        {r.superseded_by_id && (
          <Badge variant="outline" size="sm">
            Replaced by a newer version
          </Badge>
        )}
      </div>
    </header>
    {r.revision_reason && (
      <p className="text-xs text-[#4A5568] bg-[#FBFAF7] border border-[#ECE9E2] rounded-lg px-3 py-2">
        <span className="font-semibold text-[#14213D]">Reason for this version:</span> {r.revision_reason}
      </p>
    )}
    <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2">
      <Meta label="Rating">{r.rating ? <Num>{`${r.rating} / ${r.rating_scale}`}</Num> : <span className="text-[#8A8578]">Not given</span>}</Meta>
      <Meta label="Employee acknowledgement">{r.employee_acknowledged_at ? <DateTime value={r.employee_acknowledged_at} /> : <span className="text-[#8A8578]">{r.status === 'draft' ? '—' : 'Not yet'}</span>}</Meta>
    </dl>
    <div className="space-y-2.5">
      <TextBlock label="Strengths" value={r.strengths} />
      <TextBlock label="Improvement areas" value={r.improvement_areas} />
      <TextBlock label="Comments" value={r.comments} />
    </div>
    {r.status !== 'draft' && (
      <div className="rounded-lg border border-[#ECE9E2] bg-[#FBFAF7] px-3 py-2.5">
        <p className="text-[11px] uppercase tracking-wide text-[#4A5568]">
          Employee response
          {r.employee_responded_at && (
            <span className="normal-case tracking-normal">
              {' '}· <DateTime value={r.employee_responded_at} />
            </span>
          )}
        </p>
        <p className={`mt-0.5 text-sm whitespace-pre-wrap break-words ${r.employee_response ? 'text-[#14213D]' : 'text-[#8A8578]'}`}>{r.employee_response || 'No response added.'}</p>
      </div>
    )}
    {children}
    {actions && <div className="flex flex-wrap gap-2 pt-1">{actions}</div>}
  </article>
);

// ------------------------------------------------------------------ report sections
const Section: React.FC<{ n?: string; title: string; description?: string; children: React.ReactNode }> = ({ n, title, description, children }) => (
  <Card padding="md" className="space-y-4 break-inside-avoid">
    <SectionHeader title={n ? `${n}. ${title}` : title} description={description} />
    {children}
  </Card>
);

const KV: React.FC<{ rows: [string, React.ReactNode][] }> = ({ rows }) => (
  <dl className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-3">
    {rows.map(([k, v]) => (
      <Meta key={k} label={k}>
        {typeof v === 'string' || typeof v === 'number' ? <Num>{v}</Num> : v}
      </Meta>
    ))}
  </dl>
);

const EXCLUDED_LABEL: Record<NonNullable<EvidenceTaskRow['excluded']>, string> = {
  cancelled: 'Excluded · cancelled',
  backlog: 'Excluded · backlog entry',
  generated_late: 'Excluded · generated late',
};

const ExcludedChip: React.FC<{ value: EvidenceTaskRow['excluded'] }> = ({ value }) =>
  value ? (
    <Badge variant="outline" size="sm" className="whitespace-nowrap">
      {EXCLUDED_LABEL[value]}
    </Badge>
  ) : null;

const taskNote = (t: EvidenceTaskRow) => [t.excluded === 'cancelled' && t.cancelled_reason ? `Cancelled: ${t.cancelled_reason}` : null, t.delay_reason ? `Reason for delay: ${t.delay_reason}` : null].filter(Boolean).join(' · ');

const TaskLink: React.FC<{ id?: string | null; number: string }> = ({ id, number }) =>
  id ? (
    <Link href={`/tasks/${id}`} className="font-mono text-xs font-semibold text-[#0F5E63] hover:underline whitespace-nowrap">
      {number}
    </Link>
  ) : (
    <span className="font-mono text-xs font-semibold text-[#14213D] whitespace-nowrap">{number}</span>
  );

const TaskAppendix: React.FC<{ tasks: EvidenceTaskRow[] }> = ({ tasks }) => {
  if (!tasks.length) return <p className="text-sm text-[#8A8578]">No tasks fall in this period.</p>;
  return (
    <>
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Task</TableHead>
              <TableHead>Title</TableHead>
              <TableHead>Original deadline</TableHead>
              <TableHead>Completed</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Delay class</TableHead>
              <TableHead className="text-right">Unexcused</TableHead>
              <TableHead className="text-right">Excused</TableHead>
              <TableHead className="text-right">Ext.</TableHead>
              <TableHead>Blockers / notes</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tasks.map((t) => {
              const note = taskNote(t);
              return (
                <TableRow key={t.id} className={t.excluded ? 'bg-[#FBFAF7]' : undefined}>
                  <TableCell>
                    <TaskLink id={t.id} number={t.task_number} />
                  </TableCell>
                  <TableCell className="min-w-[180px] max-w-[260px]">
                    <div className="truncate" title={t.title}>
                      {t.title}
                    </div>
                    <div className="text-[11px] text-[#4A5568]">
                      {[t.category, TASK_PRIORITY_LABELS[t.priority] || t.priority, t.recurring ? 'Recurring' : null, t.customer, t.tender_no].filter(Boolean).join(' · ')}
                    </div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    <DateTime value={t.original_deadline} />
                    {t.deadline && t.deadline !== t.original_deadline && (
                      <div className="text-[11px] text-[#4A5568]">
                        now <DateTime value={t.deadline} />
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{t.completed_at ? <DateTime value={t.completed_at} /> : <span className="text-[#8A8578]">—</span>}</TableCell>
                  <TableCell>
                    <StatusBadge status={t.status as TaskDisplayStatus} />
                  </TableCell>
                  <TableCell>
                    {t.excluded ? (
                      <ExcludedChip value={t.excluded} />
                    ) : t.delay_class && t.delay_class !== 'open' ? (
                      <DelayBadge delay={t.delay_class} />
                    ) : (
                      <span className="text-[#8A8578]">Open, not yet due</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Num>{days(t.unexcused_delay_days)}</Num>
                  </TableCell>
                  <TableCell className="text-right">
                    <Num>{days(t.excused_delay_days)}</Num>
                  </TableCell>
                  <TableCell className="text-right">
                    <Num>{t.extensions}</Num>
                  </TableCell>
                  <TableCell className="min-w-[200px] max-w-[320px] text-[11px] text-[#4A5568]">
                    {t.blockers && <div className="text-[#14213D]">{t.blockers}</div>}
                    {(t.rework > 0 || t.reopened > 0) && <div>{[t.rework ? `Sent back ×${t.rework}` : null, t.reopened ? `Reopened ×${t.reopened}` : null].filter(Boolean).join(' · ')}</div>}
                    {note && <div className="break-words">{note}</div>}
                    {!t.blockers && !note && !t.rework && !t.reopened && '—'}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <ul className="md:hidden space-y-2.5">
        {tasks.map((t) => {
          const note = taskNote(t);
          return (
            <li key={t.id} className={`rounded-[14px] border border-[#DCD8CE] p-3 space-y-2 ${t.excluded ? 'bg-[#FBFAF7]' : 'bg-white'}`}>
              <div className="flex flex-wrap items-center gap-1.5">
                <TaskLink id={t.id} number={t.task_number} />
                <StatusBadge status={t.status as TaskDisplayStatus} />
                {t.excluded ? <ExcludedChip value={t.excluded} /> : <DelayBadge delay={t.delay_class} />}
              </div>
              <p className="text-sm text-[#14213D] break-words">{t.title}</p>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                <Meta label="Original deadline">
                  <DateTime value={t.original_deadline} className="text-xs" />
                </Meta>
                <Meta label="Completed">{t.completed_at ? <DateTime value={t.completed_at} className="text-xs" /> : '—'}</Meta>
                <Meta label="Unexcused / excused">
                  <Num>{`${days(t.unexcused_delay_days)} / ${days(t.excused_delay_days)}`}</Num>
                </Meta>
                <Meta label="Extensions">
                  <Num>{t.extensions}</Num>
                </Meta>
              </dl>
              {(t.blockers || note) && <p className="text-[11px] text-[#4A5568] break-words">{[t.blockers, note].filter(Boolean).join(' · ')}</p>}
            </li>
          );
        })}
      </ul>
    </>
  );
};

const BlockerHistory: React.FC<{ rows: EvidenceBlockerRow[]; taskIds: Map<string, string> }> = ({ rows, taskIds }) => {
  if (!rows.length) return <p className="text-sm text-[#8A8578]">No blockers were raised in this period.</p>;
  return (
    <>
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Task</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Raised</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Excused</TableHead>
              <TableHead>Description / decision</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((b) => (
              <TableRow key={b.id}>
                <TableCell>
                  <TaskLink id={taskIds.get(b.task_number)} number={b.task_number} />
                </TableCell>
                <TableCell className="whitespace-nowrap">{blockerTypeLabel(b.type)}</TableCell>
                <TableCell className="whitespace-nowrap">
                  <DateTime value={b.raised_at} />
                  {b.raised_after_deadline && (
                    <div className="mt-1">
                      <FlagChip>After deadline</FlagChip>
                    </div>
                  )}
                </TableCell>
                <TableCell>
                  <BlockerBadge status={b.status} />
                </TableCell>
                <TableCell className="text-right">
                  <Num>{days(b.excused_days)}</Num>
                </TableCell>
                <TableCell className="min-w-[240px] max-w-[420px]">
                  <div className="break-words">{b.description}</div>
                  {b.decision_comment && <div className="mt-0.5 text-[11px] text-[#4A5568] break-words">Decision: {b.decision_comment}</div>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ul className="md:hidden space-y-2.5">
        {rows.map((b) => (
          <li key={b.id} className="rounded-[14px] border border-[#DCD8CE] bg-white p-3 space-y-1.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <TaskLink id={taskIds.get(b.task_number)} number={b.task_number} />
              <BlockerBadge status={b.status} />
              {b.raised_after_deadline && <FlagChip>After deadline</FlagChip>}
            </div>
            <p className="text-xs text-[#4A5568]">
              {blockerTypeLabel(b.type)} · raised <DateTime value={b.raised_at} /> · excused <Num>{days(b.excused_days)}</Num>
            </p>
            <p className="text-sm text-[#14213D] break-words">{b.description}</p>
            {b.decision_comment && <p className="text-[11px] text-[#4A5568] break-words">Decision: {b.decision_comment}</p>}
          </li>
        ))}
      </ul>
    </>
  );
};

const Reassignments: React.FC<{ rows: EvidenceReassignment[] }> = ({ rows }) => (
  <ul className="divide-y divide-[#ECE9E2] rounded-lg border border-[#ECE9E2]">
    {rows.map((h) => (
      <li key={h.id} className="px-3 py-2 space-y-0.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <TaskLink id={h.task_id} number={h.task_number} />
          <span className="text-sm text-[#14213D] min-w-0 truncate">{h.title}</span>
          {h.counted_as_miss && <FlagChip tone="danger">Counted as a miss</FlagChip>}
        </div>
        <p className="text-xs text-[#4A5568]">
          To {h.to_name || '—'} · {TASK_REASSIGN_REASON_LABELS[h.reason_type as TaskReassignReason] || h.reason_type} · <DateTime value={h.created_at} />
          {h.was_overdue ? ` · overdue by ${h.overdue_days} d at the time` : ''}
        </p>
        <p className="text-xs text-[#14213D] break-words">{h.reason}</p>
      </li>
    ))}
  </ul>
);

/** The full evidence report. `reviewsSlot` replaces the read-only section 6 (e.g. My Performance with actions). */
export const EvidenceReport: React.FC<{ report: EvidenceReportData; reviewsSlot?: React.ReactNode; snapshotLabel?: string }> = ({ report: r, reviewsSlot, snapshotLabel }) => {
  const taskIds = new Map(r.tasks.map((t) => [t.task_number, t.id]));
  const e = r.employee;
  const excludedTotal = r.excluded.cancelled + r.excluded.backlog_entries + r.excluded.generated_late;
  return (
    <div className="space-y-4">
      <Card padding="md" className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-serif text-lg font-bold text-[#14213D] break-words">{e.name}</h2>
            <p className="text-xs text-[#4A5568] capitalize">{[roleLabel(e.role), e.department].filter(Boolean).join(' · ')}</p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {!e.is_active && (
              <Badge variant="warning" size="sm">
                Inactive since {formatTaskDate(e.deactivated_at)}
              </Badge>
            )}
            <Badge variant={snapshotLabel ? 'cyber' : 'outline'} size="sm">
              {snapshotLabel || 'Live data'}
            </Badge>
          </div>
        </div>
        <dl className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-3">
          <Meta label="Employee code">
            <Num>{e.employee_code || '—'}</Num>
          </Meta>
          <Meta label="Reporting manager">{e.manager || '—'}</Meta>
          <Meta label="Region">{e.region || '—'}</Meta>
          <Meta label="Period">
            <Num>
              {formatTaskDate(r.period.from)} – {formatTaskDate(r.period.to)}
            </Num>
          </Meta>
          <Meta label="Period basis">{BASIS_LABEL[r.period.basis] || r.period.basis}</Meta>
          <Meta label="Generated">
            <DateTime value={r.generated_at} />
          </Meta>
        </dl>
        <p className="text-xs text-[#4A5568] bg-[#FBFAF7] border border-[#ECE9E2] rounded-lg px-3 py-2">
          <span className="font-semibold text-[#14213D]">Period rule:</span> {r.period.basis_note} Cancelled tasks, backlog entries and recurring instances generated late after a system outage are listed but not counted.
        </p>
        {r.period.frozen_at_deactivation && (
          <InfoCallout variant="neutral" title="Metrics frozen at deactivation" icon={<Snowflake className="h-4 w-4" />}>
            This employee was deactivated on <span className="font-mono">{formatTaskDateTime(r.period.frozen_at_deactivation)}</span>. The period ends on{' '}
            <span className="font-mono">{formatTaskDate(r.period.to)}</span>
            {r.period.requested_to !== r.period.to ? (
              <>
                {' '}
                instead of <span className="font-mono">{formatTaskDate(r.period.requested_to)}</span>
              </>
            ) : null}
            .
          </InfoCallout>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section n="1" title="Work assigned" description="Tasks counted in this period (exclusions are listed in the appendix).">
          <KV
            rows={[
              ['Tasks assessed', String(r.work_assigned.total)],
              ['Recurring / one-time', `${r.work_assigned.recurring} / ${r.work_assigned.one_time}`],
              ...Object.entries(r.work_assigned.by_priority).map(([k, v]) => [`Priority · ${TASK_PRIORITY_LABELS[k as TaskPriority] || k}`, String(v)] as [string, React.ReactNode]),
              ...Object.entries(r.work_assigned.by_category).map(([k, v]) => [`Category · ${k}`, String(v)] as [string, React.ReactNode]),
            ]}
          />
        </Section>

        <Section n="2" title="Completion status">
          <KV
            rows={[
              ['Completed', String(r.completion.completed)],
              ['Awaiting approval', String(r.completion.awaiting_approval)],
              ['Still open', String(r.completion.open)],
              ['Completion rate', pct(r.completion.completion_rate_pct)],
              ['Excluded', String(excludedTotal)],
              ['Cancelled / backlog / generated late', `${r.excluded.cancelled} / ${r.excluded.backlog_entries} / ${r.excluded.generated_late}`],
            ]}
          />
        </Section>
      </div>

      <Section n="3" title="Deadline compliance" description="Measured against the original deadline. Excused time comes only from approved extensions and accepted blockers; time already overdue when an excuse was granted stays unexcused.">
        <DelayMixBar
          title="Delay classes in this period"
          counts={{ on_time: r.compliance.on_time, late_excused: r.compliance.late_excused, late_unexcused: r.compliance.late_unexcused, open_overdue: r.compliance.open_overdue }}
        />
        <KV
          rows={[
            ['On time', String(r.compliance.on_time)],
            ['On-time rate (of completed)', pct(r.compliance.on_time_pct)],
            ['Late · excused', String(r.compliance.late_excused)],
            ['Late · unexcused', String(r.compliance.late_unexcused)],
            ['Open and overdue', String(r.compliance.open_overdue)],
            ['Open, not yet due', String(r.compliance.open)],
            ['Avg unexcused delay', days(r.compliance.avg_unexcused_delay_days)],
            ['Total unexcused delay', days(r.compliance.total_unexcused_delay_days)],
            ['Total excused delay', days(r.compliance.total_excused_delay_days)],
            ['Extensions requested / granted', `${r.compliance.extensions_requested} / ${r.compliance.extensions_granted}`],
          ]}
        />
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section n="4" title="Blockers" description="Accepted blockers are approved dependencies, not execution delays.">
          <KV
            rows={[
              ['Raised', String(r.blockers.raised)],
              ['Accepted', String(r.blockers.accepted)],
              ['Rejected', String(r.blockers.rejected)],
              ['Pending review', String(r.blockers.pending)],
              ['Withdrawn', String(r.blockers.withdrawn)],
              ['Raised after the deadline', String(r.blockers.raised_after_deadline)],
              ['Excused days from blockers', days(r.blockers.excused_days)],
            ]}
          />
          {Object.keys(r.blockers.accepted_by_type).length > 0 && (
            <div>
              <p className="text-[11px] uppercase tracking-wide text-[#4A5568] mb-1.5">Accepted by type</p>
              <ul className="flex flex-wrap gap-1.5">
                {Object.entries(r.blockers.accepted_by_type).map(([k, v]) => (
                  <li key={k}>
                    <Badge variant="default" size="sm">
                      {blockerTypeLabel(k)} <span className="font-mono font-semibold ml-1">{v}</span>
                    </Badge>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Section>

        <Section n="5" title="Repeated misses & rework">
          <KV
            rows={[
              ['Recurring instances missed', String(r.repeated_misses.recurring_instances_missed)],
              ['Tasks with 2+ extensions', String(r.repeated_misses.tasks_with_multiple_extensions)],
              ['Sent back for rework', String(r.repeated_misses.rework_count)],
              ['Reopened after completion', String(r.repeated_misses.reopen_count)],
              ['Tasks reworked or reopened', String(r.repeated_misses.tasks_reworked_or_reopened)],
              ['Reassigned away', `${r.reassignments.reassigned_away.length} (${r.reassignments.counted_as_miss} counted as a miss)`],
            ]}
          />
          {r.reassignments.reassigned_away.length > 0 && (
            <div>
              <p className="text-[11px] uppercase tracking-wide text-[#4A5568] mb-1.5">Reassigned away</p>
              <Reassignments rows={r.reassignments.reassigned_away} />
              <p className="mt-1.5 text-[11px] text-[#4A5568]">Only reassignments for non-performance are counted as a miss.</p>
            </div>
          )}
        </Section>
      </div>

      <Section n="6" title="Manager review" description={reviewsSlot ? undefined : 'Submitted reviews overlapping this period, with the employee’s response.'}>
        {reviewsSlot ??
          (r.reviews.length ? (
            <div className="space-y-3">
              {r.reviews.map((rv) => (
                <ReviewCard key={rv.id} review={rv} />
              ))}
            </div>
          ) : (
            <p className="text-sm text-[#8A8578]">No submitted manager review overlaps this period.</p>
          ))}
      </Section>

      <Section title="Appendix A · Task list" description={`${r.tasks.length} task(s) in the period, including excluded ones.`}>
        <TaskAppendix tasks={r.tasks} />
      </Section>

      <Section title="Appendix B · Blocker history">
        <BlockerHistory rows={r.blocker_list} taskIds={taskIds} />
      </Section>
    </div>
  );
};
