'use client';

/**
 * My performance (/performance, every employee): the facts of your own evidence report for a period — who it is
 * about, the §43 evidence as five small charts, the period's tasks (searchable, filterable by delay class and priority) and any
 * blockers, with the evidence-only disclaimer at the end. A submitted manager review waiting for you shows on top
 * until you acknowledge it (acknowledging means "I have read it", not "I agree"). Filters live in the URL; views
 * are audited server-side.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, CheckCircle2, Flag, Layers, ListChecks, MessageSquareText, PenLine, Search, ShieldAlert, X } from 'lucide-react';
import { Button, Card, FilterMenu, InfoCallout, Modal, PageLoader, SectionHeader, Textarea } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { TASK_DELAY_CLASS_LABELS, TASK_MIN_COMMENT_LENGTH, TASK_PRIORITIES, TASK_PRIORITY_LABELS, formatTaskDate, type TaskDelayClass } from '@arihant/shared';
import { errorMessage, fieldErrors, isConflict } from '../../tasks/_lib/task-lib';
import { DateTime, EvidenceDisclaimer, Meta, useToaster, useUrlFilters } from '../../tasks/_lib/task-ui';
import {
  BASIS_LABEL,
  BlockerHistory,
  EvidenceCharts,
  PERIOD_PRESETS,
  ReviewCard,
  TaskAppendix,
  defaultPeriod,
  periodError,
  periodLabel,
  presetRange,
  type EvidenceReportData,
  type EvidenceTaskRow,
  type PerformanceReview,
} from '../../tasks/_lib/EvidenceReport';

const KEYS = ['from', 'to', 'delay', 'priority'] as const;
type DelayFilter = TaskDelayClass | 'excluded';
const DELAY_FILTERS: DelayFilter[] = ['open_overdue', 'open', 'on_time', 'late_excused', 'late_unexcused', 'excluded'];
const delayLabel = (d: DelayFilter) => (d === 'excluded' ? 'Excluded (not counted)' : TASK_DELAY_CLASS_LABELS[d]);
const matchesDelay = (t: EvidenceTaskRow, d: DelayFilter) => (d === 'excluded' ? Boolean(t.excluded) : !t.excluded && t.delay_class === d);
const RESPONSE_MAX = 4000;
const dateInputCls = 'h-8 rounded-lg border border-[#C9C4B8] bg-white px-2.5 text-xs text-[#14213D] focus:border-[#0F5E63] focus:outline-none focus:ring-2 focus:ring-[#0F5E63]/15';
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');

/** Who and which period the report covers — the first card on the page. */
const ReportProfile: React.FC<{ report: EvidenceReportData }> = ({ report: r }) => {
  const e = r.employee;
  return (
    <Card padding="md" className="space-y-4">
      <div className="flex items-center gap-3">
        <span aria-hidden className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#0F5E63] font-serif text-base font-bold text-white">
          {initials(e.name)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-serif text-base font-bold text-[#14213D]">{e.name}</p>
          <p className="truncate text-xs capitalize text-[#4A5568]">{[e.role.replace(/_/g, ' '), e.department].filter(Boolean).join(' · ')}</p>
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-[#ECE9E2] pt-3 sm:grid-cols-3 xl:grid-cols-6">
        <Meta label="Reporting manager">{e.manager || '—'}</Meta>
        <Meta label="Region">{e.region || '—'}</Meta>
        <Meta label="Period">
          <span className="font-mono text-xs">
            {formatTaskDate(r.period.from)} – {formatTaskDate(r.period.to)}
          </span>
        </Meta>
        <Meta label="Counted">{BASIS_LABEL[r.period.basis] || r.period.basis}</Meta>
        <Meta label="Employee code">
          <span className="font-mono">{e.employee_code || '—'}</span>
        </Meta>
        <Meta label="Generated">
          <DateTime value={r.generated_at} />
        </Meta>
      </dl>
    </Card>
  );
};

export function MyPerformance() {
  const { user } = useAuth();
  const { values, set } = useUrlFilters(KEYS);
  const { push, Toaster } = useToaster();

  const def = useMemo(() => defaultPeriod(), []);
  const from = values.from || def.from;
  const to = values.to || def.to;
  const rangeError = periodError(from, to);
  const me = user?.id || '';

  const [report, setReport] = useState<EvidenceReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [reviews, setReviews] = useState<PerformanceReview[] | null>(null);
  const [reviewsError, setReviewsError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [responding, setResponding] = useState<PerformanceReview | null>(null);
  const [response, setResponse] = useState('');
  const [responseError, setResponseError] = useState<string | null>(null);
  const [acknowledging, setAcknowledging] = useState<PerformanceReview | null>(null);
  const [datesOpen, setDatesOpen] = useState(false);
  const [search, setSearch] = useState('');
  const datesSet = Boolean(values.from || values.to);
  const delay = (DELAY_FILTERS as string[]).includes(values.delay) ? (values.delay as DelayFilter) : null;
  const priority = (TASK_PRIORITIES as string[]).includes(values.priority) ? values.priority : null;
  const showDates = datesOpen || Boolean(rangeError || errors.from || errors.to);

  const loadReport = useCallback(async () => {
    if (!me || rangeError) return;
    setLoading(true);
    setError(null);
    setErrors({});
    try {
      setReport(await api.get<EvidenceReportData>('/performance/evidence', { employee_id: me, from, to }));
    } catch (e) {
      setReport(null);
      setErrors(fieldErrors(e));
      setError(errorMessage(e, 'Could not load your report.'));
    } finally {
      setLoading(false);
    }
  }, [me, from, to, rangeError]);

  const loadReviews = useCallback(async () => {
    if (!me) return;
    setReviewsError(null);
    try {
      const rows = await api.get<PerformanceReview[]>('/performance-reviews', { mine: 'true' });
      setReviews(rows.filter((r) => r.employee_id === me && r.status !== 'draft'));
    } catch (e) {
      setReviews([]);
      setReviewsError(errorMessage(e, 'Could not load your reviews.'));
    }
  }, [me]);

  useEffect(() => {
    loadReport();
  }, [loadReport]);
  useEffect(() => {
    loadReviews();
  }, [loadReviews]);

  const openResponse = (r: PerformanceReview) => {
    setResponse(r.employee_response || '');
    setResponseError(null);
    setResponding(r);
  };

  const saveResponse = async () => {
    if (!responding) return;
    const text = response.trim();
    if (text.length < TASK_MIN_COMMENT_LENGTH) {
      setResponseError(`Write at least ${TASK_MIN_COMMENT_LENGTH} characters.`);
      return;
    }
    setBusy(`respond:${responding.id}`);
    try {
      await api.post(`/performance-reviews/${responding.id}/respond`, { response: text });
      setResponding(null);
      push('success', 'Your response is saved and is now part of the evidence pack. Your manager has been notified.');
      loadReviews();
    } catch (e) {
      setResponseError(fieldErrors(e).response || errorMessage(e));
      if (isConflict(e)) loadReviews();
    } finally {
      setBusy(null);
    }
  };

  const acknowledge = async () => {
    if (!acknowledging) return;
    setBusy(`ack:${acknowledging.id}`);
    try {
      await api.post(`/performance-reviews/${acknowledging.id}/acknowledge`, {});
      setAcknowledging(null);
      push('success', 'Review acknowledged. Your manager has been notified.');
      loadReviews();
    } catch (e) {
      push('error', errorMessage(e, 'Could not acknowledge the review.'));
      if (isConflict(e)) {
        setAcknowledging(null);
        loadReviews();
      }
    } finally {
      setBusy(null);
    }
  };


  // The period's tasks, narrowed by the toolbar (search stays local; Show and Priority live in the URL).
  const allTasks = report?.tasks || [];
  const tasks = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allTasks.filter(
      (t) => (!delay || matchesDelay(t, delay)) && (!priority || t.priority === priority) && (!q || t.task_number.toLowerCase().includes(q) || t.title.toLowerCase().includes(q)),
    );
  }, [allTasks, delay, priority, search]);
  const narrowed = Boolean(delay || priority || search.trim());
  const clearTaskFilters = () => {
    setSearch('');
    set({ delay: null, priority: null });
  };

  const datesRow = showDates && (
    <div className="flex flex-wrap items-center gap-3 text-xs">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Period presets">
        {PERIOD_PRESETS.map((p) => {
          const r = presetRange(p.key);
          const on = r.from === from && r.to === to;
          return (
            <Button key={p.key} type="button" size="xs" variant={on ? 'primary' : 'secondary'} aria-pressed={on} onClick={() => set({ from: r.from, to: r.to })}>
              {p.label}
            </Button>
          );
        })}
      </div>
      <label className="flex items-center gap-1.5 text-[#4A5568]">
        From
        <input id="period-from" type="date" value={from} onChange={(e) => e.target.value && set({ from: e.target.value, to })} aria-invalid={Boolean(errors.from)} className={dateInputCls} />
      </label>
      <label className="flex items-center gap-1.5 text-[#4A5568]">
        To
        <input id="period-to" type="date" value={to} min={from || undefined} onChange={(e) => e.target.value && set({ from, to: e.target.value })} aria-invalid={Boolean(errors.to || rangeError)} className={dateInputCls} />
      </label>
      {errors.from || errors.to || rangeError ? (
        <span role="alert" className="font-semibold text-[#9A3412]">
          {[errors.from, errors.to || rangeError].filter(Boolean).join(' ')}
        </span>
      ) : (
        <span className="text-[11px] text-[#6B7280]">Calendar days in IST.</span>
      )}
    </div>
  );

  // Only a review still waiting for you shows here; acknowledged ones live in the evidence pack.
  const waiting = (reviews || []).filter((r) => r.status === 'submitted');
  const waitingPanel = waiting.length > 0 && (
    <Card padding="md" className="space-y-3 border-[#0F5E63]/40">
      <SectionHeader
        title={`${waiting.length} review${waiting.length === 1 ? '' : 's'} waiting for you`}
        icon={<MessageSquareText className="h-4 w-4" />}
        description="Add a response if you wish, then acknowledge. Acknowledging confirms you have read it; it does not mean you agree."
      />
      {waiting.map((r) => (
        <ReviewCard
          key={r.id}
          review={r}
          actions={
            <>
              <Button size="xs" variant="secondary" leftIcon={<PenLine className="h-3 w-3" />} disabled={busy !== null} onClick={() => openResponse(r)}>
                {r.employee_response ? 'Edit my response' : 'Add my response'}
              </Button>
              <Button size="xs" leftIcon={<CheckCircle2 className="h-3 w-3" />} disabled={busy !== null} onClick={() => setAcknowledging(r)}>
                Acknowledge
              </Button>
            </>
          }
        />
      ))}
    </Card>
  );

  return (
    <>
      {/* One filter row: search the period's tasks, then Period, Show and Priority. */}
      <Card className="relative z-20 overflow-visible p-0">
        <div className="flex flex-col gap-2 p-3 md:flex-row md:items-center">
          <div className="relative w-full min-w-[200px] md:w-auto md:flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6B7280]" aria-hidden />
            <input
              type="search"
              aria-label="Search tasks in this period"
              placeholder="Search task number or title…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 w-full rounded-lg border border-[#C9C4B8] bg-white pl-9 pr-9 text-xs text-[#14213D] placeholder:text-[#6B7280] focus:border-[#0F5E63] focus:outline-none focus:ring-2 focus:ring-[#0F5E63]/15"
            />
            {search && (
              <button type="button" aria-label="Clear search" onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#6B7280] hover:text-[#14213D]">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setDatesOpen((o) => !o)} aria-expanded={showDates} className={`filter-menu-btn ${showDates || datesSet ? 'filter-menu-btn--on' : ''}`}>
              <CalendarDays className="h-3.5 w-3.5" />
              <span>Period</span>
              <span className="filter-menu-chip max-w-[130px] truncate">{periodLabel(from, to)}</span>
            </button>
            <FilterMenu
              label="Show"
              icon={<Layers />}
              options={[
                { key: 'all', label: 'All tasks', count: report ? allTasks.length : undefined },
                ...DELAY_FILTERS.map((d) => ({ key: d, label: delayLabel(d), count: report ? allTasks.filter((t) => matchesDelay(t, d)).length : undefined, urgent: d === 'open_overdue' })),
              ].map((o) => ({ ...o, active: (delay || 'all') === o.key, onSelect: () => set({ delay: o.key === 'all' ? null : o.key }) }))}
            />
            <FilterMenu
              label="Priority"
              icon={<Flag />}
              align="right"
              options={[
                { key: 'all', label: 'Any priority', count: undefined as number | undefined },
                ...[...TASK_PRIORITIES].reverse().map((k) => ({ key: k as string, label: TASK_PRIORITY_LABELS[k], count: report ? allTasks.filter((t) => t.priority === k).length : undefined })),
              ].map((o) => ({ ...o, active: (priority || 'all') === o.key, onSelect: () => set({ priority: o.key === 'all' ? null : o.key }) }))}
            />
            {(datesSet || narrowed) && (
              <Button
                variant="ghost"
                size="xs"
                onClick={() => {
                  setDatesOpen(false);
                  setSearch('');
                  set({ from: null, to: null, delay: null, priority: null });
                }}
                className="text-xs text-[#4A5568] hover:text-[#881337]"
              >
                Clear
              </Button>
            )}
          </div>
        </div>
        {datesRow && <div className="border-t border-[#ECE9E2] px-3 py-2.5">{datesRow}</div>}
      </Card>

      {!user ? (
        <PageLoader rows={4} label="Loading your performance" />
      ) : (
        <>
          {reviewsError && (
            <InfoCallout variant="danger" title="Could not load your reviews">
              {reviewsError}
            </InfoCallout>
          )}
          {error && (
            <InfoCallout variant="danger" title="Could not load your report">
              <div className="flex flex-wrap items-center gap-3">
                <span>{error}</span>
                <Button size="xs" variant="secondary" onClick={loadReport}>
                  Try again
                </Button>
              </div>
            </InfoCallout>
          )}

          {rangeError ? null : !report ? (
            loading && <PageLoader rows={6} label="Building your report" />
          ) : (
            <div className={`space-y-5 transition-opacity ${loading ? 'opacity-60' : ''}`} aria-busy={loading}>
              <ReportProfile report={report} />
              {waitingPanel}
              <EvidenceCharts report={report} />
              <Card padding="md" className="space-y-3">
                <SectionHeader
                  title="Tasks in this period"
                  icon={<ListChecks className="h-4 w-4" />}
                  description={
                    narrowed
                      ? `${tasks.length} of ${allTasks.length} shown`
                      : `${allTasks.length} task${allTasks.length === 1 ? '' : 's'} · ${report.work_assigned.total} counted, ${allTasks.filter((t) => t.excluded).length} excluded (cancelled, backlog, generated late)`
                  }
                />
                {narrowed && tasks.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-[#DCD8CE] px-3 py-6 text-center">
                    <p className="text-xs text-[#6B7280]">No tasks match these filters.</p>
                    <Button size="xs" variant="secondary" onClick={clearTaskFilters}>
                      Clear filters
                    </Button>
                  </div>
                ) : (
                  <TaskAppendix tasks={tasks} />
                )}
              </Card>
              {report.blocker_list.length > 0 && (
                <Card padding="md" className="space-y-3">
                  <SectionHeader title="Blockers raised" icon={<ShieldAlert className="h-4 w-4" />} description={`${report.blocker_list.length} in this period`} />
                  <BlockerHistory rows={report.blocker_list} taskIds={new Map(report.tasks.map((t) => [t.task_number, t.id]))} />
                </Card>
              )}
            </div>
          )}

          {/* The evidence-only disclaimer closes the page. */}
          <div className="space-y-1.5">
            <EvidenceDisclaimer />
            <p className="px-1 text-[11px] text-[#6B7280]">The same facts your manager sees. Access to this report is logged.</p>
          </div>
        </>
      )}

      <Modal
        isOpen={Boolean(responding)}
        onClose={() => !busy && setResponding(null)}
        title={responding?.employee_response ? 'Edit my response' : 'Add my response'}
        description={responding ? `Review ${formatTaskDate(responding.period_from)} – ${formatTaskDate(responding.period_to)} by ${responding.reviewer_name}` : undefined}
        maxWidth="lg"
      >
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            saveResponse();
          }}
        >
          <p className="text-xs text-[#4A5568]">Your response becomes part of the evidence pack, next to the review. Stick to facts — for example blockers, approvals or dependencies that affected the work.</p>
          <Textarea
            id="review-response"
            label="My response *"
            rows={5}
            maxLength={RESPONSE_MAX}
            value={response}
            onChange={(e) => {
              setResponse(e.target.value);
              setResponseError(null);
            }}
            error={responseError || undefined}
            helperText={`At least ${TASK_MIN_COMMENT_LENGTH} characters. You can change it until you acknowledge the review.`}
          />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" disabled={busy !== null} onClick={() => setResponding(null)}>
              Cancel
            </Button>
            <Button type="submit" isLoading={Boolean(responding && busy === `respond:${responding.id}`)} disabled={busy !== null}>
              Save response
            </Button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={Boolean(acknowledging)} onClose={() => !busy && setAcknowledging(null)} title="Acknowledge this review?" description={acknowledging ? `Review ${formatTaskDate(acknowledging.period_from)} – ${formatTaskDate(acknowledging.period_to)} by ${acknowledging.reviewer_name}` : undefined} maxWidth="md">
        <div className="space-y-4">
          <p className="text-sm text-[#14213D]">Acknowledging confirms you have read it; it does not mean you agree. You can add a response first.</p>
          {acknowledging && !acknowledging.employee_response && <p className="text-xs text-[#4A5568]">You have not added a response. After acknowledging, the review and your response can no longer be changed.</p>}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" disabled={busy !== null} onClick={() => setAcknowledging(null)}>
              Cancel
            </Button>
            {acknowledging && (
              <Button
                variant="secondary"
                disabled={busy !== null}
                onClick={() => {
                  const r = acknowledging;
                  setAcknowledging(null);
                  openResponse(r);
                }}
              >
                {acknowledging.employee_response ? 'Edit my response first' : 'Add a response first'}
              </Button>
            )}
            <Button leftIcon={<CheckCircle2 className="h-4 w-4" />} isLoading={Boolean(acknowledging && busy === `ack:${acknowledging.id}`)} disabled={busy !== null} onClick={acknowledge}>
              Acknowledge
            </Button>
          </div>
        </div>
      </Modal>
      <Toaster />
    </>
  );
}
