'use client';

/**
 * Performance Evidence (restricted, Blueprint §43). Factual report per employee and period — work assigned,
 * completion, deadline compliance, blockers, repeated misses, reassignments and manager reviews — plus immutable
 * snapshots (data + PDF + Excel, SHA-256) and the manager review workflow (draft → submitted/locked →
 * acknowledged; changes only as a new version). Every view, export and download is audited server-side.
 * Employee, period and basis live in the URL.
 */
import React, { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Camera, Download, FileSearch, FileSpreadsheet, FileText, History, Lock, PenLine, Send, ShieldAlert, Snowflake, UserSearch } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  InfoCallout,
  Input,
  Modal,
  PageContainer,
  PageHeader,
  PageLoader,
  SectionHeader,
  Select,
  Textarea,
} from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { formatTaskDate, type TaskEvidenceBasis } from '@arihant/shared';
import { errorMessage, fieldErrors, isConflict, saveBlob, useTaskSettings, useTaskSummary, type AssigneeOption } from '../_lib/task-lib';
import { DateTime, EvidenceDisclaimer, TasksNav, useToaster, useUrlFilters } from '../_lib/task-ui';
import { BASIS_LABEL, EvidenceReport, PeriodPicker, ReviewCard, defaultPeriod, periodError, type EvidenceReportData, type PerformanceReview } from '../_lib/EvidenceReport';

const KEYS = ['employee_id', 'from', 'to', 'basis'] as const;
const ADMIN_LIKE = ['admin', 'management'];
const REVIEW_TEXT_MAX = 4000;
const SUBMIT_MIN_COMMENTS = 20;
const REVISE_MIN_REASON = 10;

interface Person {
  id: string;
  full_name: string;
  role: string;
  is_active: boolean;
  sub: string | null;
}

interface Snapshot {
  id: string;
  employee_id: string;
  period_from: string;
  period_to: string;
  period_basis: TaskEvidenceBasis;
  snapshot_no: number;
  generated_at: string;
  generated_by_name?: string | null;
  data_sha256: string;
  pdf_sha256: string;
  xlsx_sha256: string;
}

interface FrozenView {
  meta: Snapshot;
  data: EvidenceReportData;
}

const shortHash = (h: string | null | undefined) => (h ? `${h.slice(0, 12)}…` : '—');

// ------------------------------------------------------------------ review editor (create / edit draft)
interface ReviewForm {
  period_from: string;
  period_to: string;
  rating: string;
  strengths: string;
  improvement_areas: string;
  comments: string;
}

const ReviewEditor: React.FC<{
  open: boolean;
  employeeId: string;
  employeeName: string;
  scale: number;
  initial: PerformanceReview | null;
  defaultFrom: string;
  defaultTo: string;
  onClose: () => void;
  onSaved: (message: string) => void;
}> = ({ open, employeeId, employeeName, scale, initial, defaultFrom, defaultTo, onClose, onSaved }) => {
  const blank = useCallback(
    (): ReviewForm => ({
      period_from: initial?.period_from || defaultFrom,
      period_to: initial?.period_to || defaultTo,
      rating: initial?.rating ? String(initial.rating) : '',
      strengths: initial?.strengths || '',
      improvement_areas: initial?.improvement_areas || '',
      comments: initial?.comments || '',
    }),
    [initial, defaultFrom, defaultTo],
  );
  const [form, setForm] = useState<ReviewForm>(blank);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'save' | 'submit' | null>(null);
  const [confirmSubmit, setConfirmSubmit] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(blank());
      setErrors({});
      setServerError(null);
      setConfirmSubmit(false);
    }
  }, [open, blank]);

  const patch = (p: Partial<ReviewForm>) => setForm((f) => ({ ...f, ...p }));

  const validate = (submit: boolean) => {
    const e: Record<string, string> = {};
    if (!form.period_from) e.period_from = 'Period from is required.';
    if (!form.period_to) e.period_to = 'Period to is required.';
    if (form.period_from && form.period_to && form.period_from > form.period_to) e.period_to = '"To" must be on or after "From".';
    for (const k of ['strengths', 'improvement_areas', 'comments'] as const) if (form[k].length > REVIEW_TEXT_MAX) e[k] = `At most ${REVIEW_TEXT_MAX} characters.`;
    if (submit) {
      if (!form.rating) e.rating = 'Give a rating before submitting.';
      if (form.comments.trim().length < SUBMIT_MIN_COMMENTS) e.comments = `Add review comments (at least ${SUBMIT_MIN_COMMENTS} characters) before submitting.`;
    }
    return e;
  };

  const save = async (submit: boolean) => {
    const e = validate(submit);
    setErrors(e);
    setServerError(null);
    if (Object.keys(e).length) {
      setConfirmSubmit(false);
      return;
    }
    setBusy(submit ? 'submit' : 'save');
    const body = {
      period_from: form.period_from,
      period_to: form.period_to,
      rating: form.rating ? Number(form.rating) : null,
      strengths: form.strengths.trim() || null,
      improvement_areas: form.improvement_areas.trim() || null,
      comments: form.comments.trim() || null,
    };
    try {
      let r = initial ? await api.patch<PerformanceReview>(`/performance-reviews/${initial.id}`, { ...body, version: initial.version }) : await api.post<PerformanceReview>('/performance-reviews', { employee_id: employeeId, ...body });
      if (submit) r = await api.post<PerformanceReview>(`/performance-reviews/${r.id}/submit`, { version: r.version });
      onSaved(submit ? 'Review submitted and locked. The employee can now respond and acknowledge it.' : 'Draft saved. Only you can see a draft.');
    } catch (err) {
      setErrors(fieldErrors(err));
      setServerError(isConflict(err) ? 'This review was changed elsewhere (or is already submitted). Close this dialog to reload it.' : errorMessage(err));
      setConfirmSubmit(false);
    } finally {
      setBusy(null);
    }
  };

  const ratingOptions = [{ value: '', label: 'Not rated yet' }, ...Array.from({ length: scale }, (_, i) => ({ value: String(i + 1), label: `${i + 1} of ${scale}` }))];

  return (
    <Modal isOpen={open} onClose={busy ? () => undefined : onClose} title={initial ? 'Edit draft review' : 'Write a review'} description={`For ${employeeName}. A draft is visible only to you until you submit it.`} maxWidth="2xl">
      <form
        className="space-y-4"
        onSubmit={(ev) => {
          ev.preventDefault();
          save(false);
        }}
        noValidate
      >
        {initial?.revision_reason && (
          <p className="text-xs text-[#4A5568] bg-[#FBFAF7] border border-[#ECE9E2] rounded-lg px-3 py-2">
            <span className="font-semibold text-[#14213D]">New version — reason:</span> {initial.revision_reason}
          </p>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-start">
          <Input id="review-from" label="Period from" type="date" required value={form.period_from} onChange={(e) => patch({ period_from: e.target.value })} error={errors.period_from} />
          <Input id="review-to" label="Period to" type="date" required value={form.period_to} min={form.period_from || undefined} onChange={(e) => patch({ period_to: e.target.value })} error={errors.period_to} />
          <Select id="review-rating" label="Rating" value={form.rating} onChange={(e) => patch({ rating: e.target.value })} options={ratingOptions} error={errors.rating} helperText="Required to submit." />
        </div>
        <Textarea id="review-strengths" label="Strengths" rows={3} maxLength={REVIEW_TEXT_MAX} value={form.strengths} onChange={(e) => patch({ strengths: e.target.value })} error={errors.strengths} placeholder="Specific, observable examples" />
        <Textarea
          id="review-improvement"
          label="Improvement areas"
          rows={3}
          maxLength={REVIEW_TEXT_MAX}
          value={form.improvement_areas}
          onChange={(e) => patch({ improvement_areas: e.target.value })}
          error={errors.improvement_areas}
          placeholder="What to do differently, with examples"
        />
        <Textarea
          id="review-comments"
          label="Comments"
          rows={4}
          maxLength={REVIEW_TEXT_MAX}
          value={form.comments}
          onChange={(e) => patch({ comments: e.target.value })}
          error={errors.comments}
          helperText={`At least ${SUBMIT_MIN_COMMENTS} characters to submit (${form.comments.trim().length} so far). Keep it factual — refer to the evidence above.`}
        />
        {serverError && (
          <InfoCallout variant="danger" title="Not saved">
            {serverError}
          </InfoCallout>
        )}
        {confirmSubmit ? (
          <InfoCallout variant="warning" title="Submit and lock this review?" icon={<Lock className="h-4 w-4" />}>
            <p>Once submitted the review cannot be edited — a change needs a new version with a reason, and the original stays on record. The employee is notified and can respond.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button type="button" size="sm" isLoading={busy === 'submit'} disabled={busy !== null} leftIcon={<Send className="h-3.5 w-3.5" />} onClick={() => save(true)}>
                Submit (locks the review)
              </Button>
              <Button type="button" size="sm" variant="secondary" disabled={busy !== null} onClick={() => setConfirmSubmit(false)}>
                Not yet
              </Button>
            </div>
          </InfoCallout>
        ) : (
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" disabled={busy !== null} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="secondary" isLoading={busy === 'save'} disabled={busy !== null}>
              Save draft
            </Button>
            <Button
              type="button"
              disabled={busy !== null}
              leftIcon={<Send className="h-3.5 w-3.5" />}
              onClick={() => {
                const e = validate(true);
                setErrors(e);
                if (!Object.keys(e).length) setConfirmSubmit(true);
              }}
            >
              Save &amp; submit…
            </Button>
          </div>
        )}
      </form>
    </Modal>
  );
};

// ------------------------------------------------------------------ page
function Evidence() {
  const { user } = useAuth();
  const router = useRouter();
  const { summary } = useTaskSummary(Boolean(user));
  const { settings } = useTaskSettings();
  const { values, set } = useUrlFilters(KEYS);
  const { push, Toaster } = useToaster();

  const allowed = Boolean(summary?.can_view_evidence);
  const canAll = Boolean(summary?.can_view_all);
  const canSnapshot = Boolean(summary?.can_snapshot_evidence);
  const hasTeam = Boolean(summary?.has_team);
  const isAdminLike = ADMIN_LIKE.includes(user?.role || '');

  const def = useMemo(() => defaultPeriod(), []);
  const from = values.from || def.from;
  const to = values.to || def.to;
  const basis: TaskEvidenceBasis | '' = values.basis === 'deadline' || values.basis === 'completion' ? values.basis : '';
  const employeeId = values.employee_id;
  const rangeError = periodError(from, to);
  const scale = settings?.review_rating_scale || 5;

  const [people, setPeople] = useState<Person[] | null>(null);
  const [report, setReport] = useState<EvidenceReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [snapshots, setSnapshots] = useState<Snapshot[] | null>(null);
  const [frozen, setFrozen] = useState<FrozenView | null>(null);
  const [reviews, setReviews] = useState<PerformanceReview[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmSnapshot, setConfirmSnapshot] = useState(false);
  const [editor, setEditor] = useState<{ open: boolean; review: PerformanceReview | null }>({ open: false, review: null });
  const [submitting, setSubmitting] = useState<PerformanceReview | null>(null);
  const [revising, setRevising] = useState<PerformanceReview | null>(null);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);

  // ---------------------------------------------------------------- employee options
  useEffect(() => {
    if (!allowed) return;
    const req: Promise<Person[]> = canAll
      ? api.get('/users', { limit: 100 }).then((r: any) =>
          ((r?.data || r || []) as any[]).map((u) => ({ id: u.id, full_name: u.full_name, role: u.role, is_active: u.is_active !== false, sub: u.region_name || null })),
        )
      : api.get<AssigneeOption[]>('/tasks/lookups/assignees').then((rows) =>
          rows.filter((o) => o.scope === 'team' || o.scope === 'all').map((o) => ({ id: o.id, full_name: o.full_name, role: o.role, is_active: true, sub: o.department_name })),
        );
    req.then((rows) => setPeople([...rows].sort((a, b) => a.full_name.localeCompare(b.full_name)))).catch(() => setPeople([]));
  }, [allowed, canAll]);

  // ---------------------------------------------------------------- data
  const loadReport = useCallback(async () => {
    if (!allowed || !employeeId || rangeError) {
      setReport(null);
      return;
    }
    setLoading(true);
    setError(null);
    setErrors({});
    try {
      setReport(await api.get<EvidenceReportData>('/performance/evidence', { employee_id: employeeId, from, to, basis: basis || undefined }));
    } catch (e) {
      setReport(null);
      setErrors(fieldErrors(e));
      setError(errorMessage(e, 'Could not load the evidence report.'));
    } finally {
      setLoading(false);
    }
  }, [allowed, employeeId, from, to, basis, rangeError]);

  const loadSnapshots = useCallback(async () => {
    if (!allowed || !employeeId) return setSnapshots(null);
    try {
      setSnapshots(await api.get<Snapshot[]>('/performance/evidence/snapshots', { employee_id: employeeId }));
    } catch {
      setSnapshots([]);
    }
  }, [allowed, employeeId]);

  const loadReviews = useCallback(async () => {
    if (!allowed || !employeeId) return setReviews(null);
    try {
      setReviews(await api.get<PerformanceReview[]>('/performance-reviews', { employee_id: employeeId }));
    } catch {
      setReviews([]);
    }
  }, [allowed, employeeId]);

  useEffect(() => {
    loadReport();
  }, [loadReport]);
  useEffect(() => {
    setFrozen(null);
    loadSnapshots();
    loadReviews();
  }, [loadSnapshots, loadReviews]);

  // ---------------------------------------------------------------- actions
  const exportAs = async (format: 'pdf' | 'xlsx') => {
    setBusy(`export:${format}`);
    try {
      const { blob, fileName } = await api.blob('/performance/evidence/export', { format, employee_id: employeeId, from, to, basis: basis || undefined });
      saveBlob(blob, fileName || `evidence-${from}-to-${to}.${format}`);
      push('success', `${format === 'pdf' ? 'PDF' : 'Excel'} exported. The export is recorded in the audit log.`);
    } catch (e) {
      push('error', errorMessage(e, 'Export failed.'));
    } finally {
      setBusy(null);
    }
  };

  const generateSnapshot = async () => {
    setBusy('snapshot');
    try {
      const row = await api.post<Snapshot>('/performance/evidence/snapshots', { employee_id: employeeId, from, to, basis: basis || undefined });
      setConfirmSnapshot(false);
      push('success', `Snapshot v${row.snapshot_no} generated and frozen.`);
      loadSnapshots();
    } catch (e) {
      const fe = fieldErrors(e);
      push('error', Object.values(fe)[0] || errorMessage(e, 'Snapshot could not be generated.'));
    } finally {
      setBusy(null);
    }
  };

  const downloadSnapshot = async (s: Snapshot, format: 'pdf' | 'xlsx') => {
    setBusy(`${s.id}:${format}`);
    try {
      const { blob, fileName } = await api.blob(`/performance/evidence/snapshots/${s.id}/file`, { format });
      saveBlob(blob, fileName || `evidence-snapshot-v${s.snapshot_no}-${s.period_from}-to-${s.period_to}.${format}`);
    } catch (e) {
      push('error', errorMessage(e, 'Download failed.'));
    } finally {
      setBusy(null);
    }
  };

  const viewSnapshot = async (s: Snapshot) => {
    setBusy(`${s.id}:view`);
    try {
      const row = await api.get<Snapshot & { data: EvidenceReportData }>(`/performance/evidence/snapshots/${s.id}`);
      setFrozen({ meta: { ...s, ...row }, data: row.data });
      window.setTimeout(() => document.getElementById('evidence-report')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    } catch (e) {
      push('error', errorMessage(e, 'Snapshot could not be opened.'));
    } finally {
      setBusy(null);
    }
  };

  const submitReview = async (r: PerformanceReview) => {
    setBusy(`submit:${r.id}`);
    try {
      await api.post(`/performance-reviews/${r.id}/submit`, { version: r.version });
      setSubmitting(null);
      push('success', 'Review submitted and locked. The employee can now respond and acknowledge it.');
      loadReviews();
      loadReport();
    } catch (e) {
      const fe = fieldErrors(e);
      push('error', Object.values(fe).join(' ') || (isConflict(e) ? 'This review changed elsewhere — reloaded.' : errorMessage(e)));
      if (isConflict(e)) loadReviews();
    } finally {
      setBusy(null);
    }
  };

  const reviseReview = async () => {
    if (!revising) return;
    if (reason.trim().length < REVISE_MIN_REASON) {
      setReasonError(`Give a reason of at least ${REVISE_MIN_REASON} characters.`);
      return;
    }
    setBusy(`revise:${revising.id}`);
    try {
      const fresh = await api.post<PerformanceReview>(`/performance-reviews/${revising.id}/revise`, { reason: reason.trim() });
      setRevising(null);
      push('success', 'New draft version created. The original stays on record — edit and submit the new version.');
      await loadReviews();
      setEditor({ open: true, review: fresh });
    } catch (e) {
      const fe = fieldErrors(e);
      setReasonError(fe.reason || errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  // ---------------------------------------------------------------- derived
  const options = useMemo(() => {
    const list = people || [];
    const opts = list.map((p) => ({ value: p.id, label: `${p.full_name} · ${p.role.replace(/_/g, ' ')}${p.is_active ? '' : ' · inactive'}${p.sub ? ` · ${p.sub}` : ''}` }));
    if (employeeId && !list.some((p) => p.id === employeeId)) opts.unshift({ value: employeeId, label: report?.employee.name || 'Selected employee' });
    return [{ value: '', label: 'Choose an employee…' }, ...opts];
  }, [people, employeeId, report]);
  const employeeName = report?.employee.name || people?.find((p) => p.id === employeeId)?.full_name || 'this employee';
  const isSelf = Boolean(user && employeeId === user.id);
  const canWriteReview = Boolean(employeeId) && !isSelf && (hasTeam || isAdminLike);
  const shown = frozen?.data || report;

  return (
    <PageContainer>
      <PageHeader title="Performance Evidence" icon={<FileSearch className="h-5 w-5" />} />
      <TasksNav />
      <div className="space-y-1.5">
        <EvidenceDisclaimer />
        <p className="text-[11px] text-[#4A5568] px-1">Access to this report is logged.</p>
      </div>

      {!summary ? (
        <PageLoader rows={4} label="Loading evidence" />
      ) : !allowed ? (
        <EmptyState
          icon={ShieldAlert}
          title="Performance evidence is restricted"
          description="Only an employee's managers, department heads and authorised management / accounts can open this page. Your own numbers are under My Performance."
          action={
            <Button variant="secondary" onClick={() => router.push('/tasks/my-performance')}>
              Open My Performance
            </Button>
          }
        />
      ) : (
        <>
          <Card padding="sm" className="space-y-4 overflow-visible">
            <div className="max-w-xl">
              <Select
                id="evidence-employee"
                label="Employee"
                value={employeeId}
                onChange={(e) => set({ employee_id: e.target.value })}
                options={options}
                error={errors.employee_id}
                helperText={canAll ? 'Everyone in the company (first 100 users).' : 'People in your team or department.'}
                searchPlaceholder="Search people…"
              />
            </div>
            <PeriodPicker from={from} to={to} errors={errors} onChange={(v) => set({ from: v.from, to: v.to })}>
              <Select
                id="evidence-basis"
                label="Period basis"
                value={basis || settings?.evidence_period_basis || 'deadline'}
                onChange={(e) => set({ basis: e.target.value })}
                options={[
                  { value: 'deadline', label: BASIS_LABEL.deadline },
                  { value: 'completion', label: BASIS_LABEL.completion },
                ]}
                searchable={false}
              />
            </PeriodPicker>
          </Card>

          {!employeeId ? (
            <EmptyState icon={UserSearch} title="Choose an employee" description="Pick an employee and a period to see the factual evidence report, snapshots and manager reviews." />
          ) : (
            <>
              {canSnapshot && (
                <Card padding="sm" className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-xs text-[#4A5568]">
                    Exports and snapshots use exactly this employee, period and basis. Each one is recorded in the audit log and carries the disclaimer.
                  </p>
                  <div className="flex flex-wrap gap-2 shrink-0">
                    <Button size="sm" variant="secondary" leftIcon={<FileText className="h-4 w-4" />} isLoading={busy === 'export:pdf'} disabled={!report || busy !== null} onClick={() => exportAs('pdf')}>
                      Export PDF
                    </Button>
                    <Button size="sm" variant="secondary" leftIcon={<FileSpreadsheet className="h-4 w-4" />} isLoading={busy === 'export:xlsx'} disabled={!report || busy !== null} onClick={() => exportAs('xlsx')}>
                      Export Excel
                    </Button>
                    <Button size="sm" leftIcon={<Camera className="h-4 w-4" />} disabled={!report || busy !== null} onClick={() => setConfirmSnapshot(true)}>
                      Generate snapshot
                    </Button>
                  </div>
                </Card>
              )}

              {error && (
                <InfoCallout variant="danger" title="Could not load the report">
                  {error}
                </InfoCallout>
              )}

              <div id="evidence-report" className="scroll-mt-4 space-y-3">
                {frozen && (
                  <InfoCallout variant="info" title={`Frozen snapshot v${frozen.meta.snapshot_no}`} icon={<Snowflake className="h-4 w-4" />}>
                    <div className="space-y-2">
                      <p>
                        Generated <DateTime value={frozen.meta.generated_at} />
                        {frozen.meta.generated_by_name ? ` by ${frozen.meta.generated_by_name}` : ''} for{' '}
                        <span className="font-mono">
                          {formatTaskDate(frozen.meta.period_from)} – {formatTaskDate(frozen.meta.period_to)}
                        </span>{' '}
                        ({BASIS_LABEL[frozen.meta.period_basis] || frozen.meta.period_basis}). This is the data exactly as it was then; it cannot change.
                      </p>
                      <p className="font-mono text-[11px] break-all">Data SHA-256 {frozen.meta.data_sha256}</p>
                      <Button size="xs" variant="secondary" onClick={() => setFrozen(null)}>
                        Back to the live report
                      </Button>
                    </div>
                  </InfoCallout>
                )}
                {loading && !shown ? (
                  <PageLoader rows={6} label="Building the evidence report" />
                ) : (
                  shown && (
                    <div className={loading && !frozen ? 'opacity-60 transition-opacity' : undefined} aria-busy={loading && !frozen}>
                      <EvidenceReport report={shown} snapshotLabel={frozen ? `Frozen snapshot v${frozen.meta.snapshot_no}` : undefined} />
                    </div>
                  )
                )}
              </div>

              <div className="grid gap-4 xl:grid-cols-[3fr_2fr] items-start">
                <Card padding="md" className="space-y-4">
                  <SectionHeader
                    title="Manager reviews"
                    icon={<PenLine className="h-4 w-4" />}
                    description="All versions for this employee. A submitted review is locked; changes create a new version with a reason."
                    actions={
                      canWriteReview ? (
                        <Button size="sm" leftIcon={<PenLine className="h-3.5 w-3.5" />} onClick={() => setEditor({ open: true, review: null })}>
                          Write review
                        </Button>
                      ) : undefined
                    }
                  />
                  {isSelf && <p className="text-xs text-[#4A5568]">You cannot review yourself. Respond to your own reviews under My Performance.</p>}
                  {reviews === null ? (
                    <PageLoader rows={2} label="Loading reviews" />
                  ) : reviews.length === 0 ? (
                    <p className="text-sm text-[#8A8578]">No reviews recorded for {employeeName} yet.</p>
                  ) : (
                    <div className="space-y-3">
                      {reviews.map((r) => {
                        const mine = r.reviewer_id === user?.id;
                        const canRevise = r.status !== 'draft' && !r.superseded_by_id && r.employee_id !== user?.id && (mine || isAdminLike);
                        return (
                          <div key={r.id} className={r.superseded_by_id ? 'opacity-75' : undefined}>
                            <ReviewCard
                              review={r}
                              actions={
                                r.status === 'draft' && mine ? (
                                  <>
                                    <Button size="xs" variant="secondary" leftIcon={<PenLine className="h-3 w-3" />} disabled={busy !== null} onClick={() => setEditor({ open: true, review: r })}>
                                      Edit draft
                                    </Button>
                                    <Button size="xs" leftIcon={<Send className="h-3 w-3" />} disabled={busy !== null} onClick={() => setSubmitting(r)}>
                                      Submit (locks the review)
                                    </Button>
                                  </>
                                ) : canRevise ? (
                                  <Button
                                    size="xs"
                                    variant="secondary"
                                    leftIcon={<History className="h-3 w-3" />}
                                    disabled={busy !== null}
                                    onClick={() => {
                                      setReason('');
                                      setReasonError(null);
                                      setRevising(r);
                                    }}
                                  >
                                    Create new version
                                  </Button>
                                ) : undefined
                              }
                            />
                          </div>
                        );
                      })}
                    </div>
                  )}
                </Card>

                <Card padding="md" className="space-y-4">
                  <SectionHeader title="Snapshot history" icon={<Snowflake className="h-4 w-4" />} description="Frozen copies of the report (data, PDF and Excel) with SHA-256 fingerprints. Snapshots never change." />
                  {snapshots === null ? (
                    <PageLoader rows={2} label="Loading snapshots" />
                  ) : snapshots.length === 0 ? (
                    <p className="text-sm text-[#8A8578]">No snapshots yet{canSnapshot ? ' — generate one to freeze the report for this period.' : '.'}</p>
                  ) : (
                    <ul className="space-y-2.5">
                      {snapshots.map((s) => {
                        const viewing = frozen?.meta.id === s.id;
                        return (
                          <li key={s.id} className={`rounded-[14px] border p-3 space-y-2 ${viewing ? 'border-[#0F5E63] bg-[#E3EFEE]/40' : 'border-[#DCD8CE] bg-white'}`}>
                            <div className="flex flex-wrap items-center gap-1.5">
                              <Badge variant="cyber" size="sm">
                                v{s.snapshot_no}
                              </Badge>
                              <span className="font-mono text-xs font-semibold text-[#14213D]">
                                {formatTaskDate(s.period_from)} – {formatTaskDate(s.period_to)}
                              </span>
                              <span className="text-[11px] text-[#4A5568]">{BASIS_LABEL[s.period_basis] || s.period_basis}</span>
                            </div>
                            <p className="text-[11px] text-[#4A5568]">
                              Generated <DateTime value={s.generated_at} />
                              {s.generated_by_name ? ` by ${s.generated_by_name}` : ''}
                            </p>
                            <p className="font-mono text-[10px] text-[#8A8578] break-all" title={`Data ${s.data_sha256}\nPDF ${s.pdf_sha256}\nExcel ${s.xlsx_sha256}`}>
                              SHA-256 data {shortHash(s.data_sha256)} · pdf {shortHash(s.pdf_sha256)} · xlsx {shortHash(s.xlsx_sha256)}
                            </p>
                            <div className="flex flex-wrap gap-1.5">
                              <Button size="xs" variant={viewing ? 'primary' : 'secondary'} isLoading={busy === `${s.id}:view`} disabled={busy !== null || viewing} onClick={() => viewSnapshot(s)}>
                                {viewing ? 'Viewing' : 'View'}
                              </Button>
                              <Button size="xs" variant="ghost" leftIcon={<Download className="h-3 w-3" />} isLoading={busy === `${s.id}:pdf`} disabled={busy !== null} onClick={() => downloadSnapshot(s, 'pdf')} aria-label={`Download snapshot v${s.snapshot_no} as PDF`}>
                                PDF
                              </Button>
                              <Button size="xs" variant="ghost" leftIcon={<Download className="h-3 w-3" />} isLoading={busy === `${s.id}:xlsx`} disabled={busy !== null} onClick={() => downloadSnapshot(s, 'xlsx')} aria-label={`Download snapshot v${s.snapshot_no} as Excel`}>
                                Excel
                              </Button>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </Card>
              </div>
            </>
          )}
        </>
      )}

      <Modal isOpen={confirmSnapshot} onClose={() => busy !== 'snapshot' && setConfirmSnapshot(false)} title="Generate an evidence snapshot" description={`${employeeName} · ${formatTaskDate(from)} – ${formatTaskDate(to)}`} maxWidth="lg">
        <div className="space-y-4">
          <div className="space-y-2 text-sm text-[#14213D]">
            <p>A snapshot freezes this report — the data, a PDF and an Excel file — exactly as it is now, with SHA-256 fingerprints.</p>
            <p>Snapshots are immutable: nobody can edit or delete them. Generating again for the same period creates a new version (v2, v3 …) and earlier versions stay on record.</p>
          </div>
          <EvidenceDisclaimer />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" disabled={busy === 'snapshot'} onClick={() => setConfirmSnapshot(false)}>
              Cancel
            </Button>
            <Button leftIcon={<Camera className="h-4 w-4" />} isLoading={busy === 'snapshot'} disabled={busy === 'snapshot'} onClick={generateSnapshot}>
              Generate snapshot
            </Button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={Boolean(submitting)} onClose={() => !busy && setSubmitting(null)} title="Submit this review?" description={submitting ? `${formatTaskDate(submitting.period_from)} – ${formatTaskDate(submitting.period_to)}` : undefined} maxWidth="md">
        <div className="space-y-4">
          <p className="text-sm text-[#14213D]">Submitting locks the review. After that it can only be changed by creating a new version with a reason; the original stays on record. The employee is notified and can add a response.</p>
          <p className="text-xs text-[#4A5568]">A rating and comments of at least {SUBMIT_MIN_COMMENTS} characters are required.</p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" disabled={busy !== null} onClick={() => setSubmitting(null)}>
              Cancel
            </Button>
            <Button leftIcon={<Lock className="h-4 w-4" />} isLoading={Boolean(submitting && busy === `submit:${submitting.id}`)} disabled={busy !== null} onClick={() => submitting && submitReview(submitting)}>
              Submit (locks the review)
            </Button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={Boolean(revising)} onClose={() => !busy && setRevising(null)} title="Create a new version" description="The submitted review stays on record unchanged. A new draft is created from it for you to edit and submit." maxWidth="lg">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            reviseReview();
          }}
        >
          <Textarea
            id="revise-reason"
            label="Reason for the new version *"
            rows={3}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              setReasonError(null);
            }}
            error={reasonError || undefined}
            helperText={`At least ${REVISE_MIN_REASON} characters. Recorded with the new version and in the audit log.`}
          />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" disabled={busy !== null} onClick={() => setRevising(null)}>
              Cancel
            </Button>
            <Button type="submit" leftIcon={<History className="h-4 w-4" />} isLoading={Boolean(revising && busy === `revise:${revising.id}`)} disabled={busy !== null}>
              Create new version
            </Button>
          </div>
        </form>
      </Modal>

      {employeeId && (
        <ReviewEditor
          open={editor.open}
          employeeId={employeeId}
          employeeName={employeeName}
          scale={scale}
          initial={editor.review}
          defaultFrom={from}
          defaultTo={to}
          onClose={() => {
            setEditor({ open: false, review: null });
            loadReviews();
          }}
          onSaved={(msg) => {
            setEditor({ open: false, review: null });
            push('success', msg);
            loadReviews();
            loadReport();
          }}
        />
      )}
      <Toaster />
    </PageContainer>
  );
}

export default function PerformanceEvidencePage() {
  return (
    <Suspense fallback={<PageLoader rows={4} label="Loading evidence" />}>
      <Evidence />
    </Suspense>
  );
}
