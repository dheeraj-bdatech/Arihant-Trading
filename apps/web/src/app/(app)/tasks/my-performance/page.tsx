'use client';

/**
 * My Performance (every employee): the same factual evidence report managers see, for yourself, plus your
 * submitted manager reviews — where you can add a response and acknowledge each review. Acknowledging means
 * "I have read it", not "I agree". Period lives in the URL. Views are audited server-side.
 */
import React, { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Gauge, MessageSquareText, PenLine } from 'lucide-react';
import { Button, Card, InfoCallout, Modal, PageContainer, PageHeader, PageLoader, SectionHeader, Textarea } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { TASK_MIN_COMMENT_LENGTH, formatTaskDate } from '@arihant/shared';
import { errorMessage, fieldErrors, isConflict } from '../_lib/task-lib';
import { DateTime, EvidenceDisclaimer, TasksNav, useToaster, useUrlFilters } from '../_lib/task-ui';
import { EvidenceReport, PeriodPicker, ReviewCard, defaultPeriod, periodError, type EvidenceReportData, type PerformanceReview } from '../_lib/EvidenceReport';

const KEYS = ['from', 'to'] as const;
const RESPONSE_MAX = 4000;

function MyPerformance() {
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

  const pending = (reviews || []).filter((r) => r.status === 'submitted').length;

  return (
    <PageContainer>
      <PageHeader title="My Performance" icon={<Gauge className="h-5 w-5" />} />
      <TasksNav />
      <div className="space-y-1.5">
        <EvidenceDisclaimer />
        <p className="text-[11px] text-[#4A5568] px-1">These are the same facts your manager sees. Access to this report is logged.</p>
      </div>

      {!user ? (
        <PageLoader rows={4} label="Loading your performance" />
      ) : (
        <>
          <Card padding="sm" className="overflow-visible">
            <PeriodPicker from={from} to={to} errors={errors} onChange={(v) => set({ from: v.from, to: v.to })} />
          </Card>

          <Card padding="md" className="space-y-4">
            <SectionHeader
              title="My reviews"
              icon={<MessageSquareText className="h-4 w-4" />}
              description="Reviews your manager has submitted (all periods). Your response becomes part of the evidence pack."
            />
            {pending > 0 && (
              <InfoCallout variant="info" title={`${pending} review(s) waiting for you`}>
                Read each review, add your response if you wish, then acknowledge it. Acknowledging confirms you have read it; it does not mean you agree.
              </InfoCallout>
            )}
            {reviewsError && (
              <InfoCallout variant="danger" title="Could not load your reviews">
                {reviewsError}
              </InfoCallout>
            )}
            {reviews === null ? (
              <PageLoader rows={2} label="Loading reviews" />
            ) : reviews.length === 0 ? (
              <p className="text-sm text-[#8A8578]">No submitted reviews yet.</p>
            ) : (
              <div className="space-y-3">
                {reviews.map((r) => (
                  <ReviewCard
                    key={r.id}
                    review={r}
                    actions={
                      r.status === 'submitted' ? (
                        <>
                          <Button size="xs" variant="secondary" leftIcon={<PenLine className="h-3 w-3" />} disabled={busy !== null} onClick={() => openResponse(r)}>
                            {r.employee_response ? 'Edit my response' : 'Add my response'}
                          </Button>
                          <Button size="xs" leftIcon={<CheckCircle2 className="h-3 w-3" />} disabled={busy !== null} onClick={() => setAcknowledging(r)}>
                            Acknowledge
                          </Button>
                        </>
                      ) : r.employee_acknowledged_at ? (
                        <p className="text-xs text-[#4A5568]">
                          You acknowledged this review on <DateTime value={r.employee_acknowledged_at} />.
                        </p>
                      ) : undefined
                    }
                  />
                ))}
              </div>
            )}
          </Card>

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
          {rangeError ? null : loading && !report ? (
            <PageLoader rows={6} label="Building your report" />
          ) : (
            report && (
              <div className={loading ? 'opacity-60 transition-opacity' : undefined} aria-busy={loading}>
                <EvidenceReport report={report} reviewsSlot={<p className="text-sm text-[#4A5568]">Your reviews, responses and acknowledgements are listed under My reviews above.</p>} />
              </div>
            )
          )}
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
    </PageContainer>
  );
}

export default function MyPerformancePage() {
  return (
    <Suspense fallback={<PageLoader rows={4} label="Loading your performance" />}>
      <MyPerformance />
    </Suspense>
  );
}
