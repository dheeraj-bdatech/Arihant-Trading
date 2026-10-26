'use client';

/**
 * Claim detail (§8.3): header, lines with receipts and per-line status, the approval timeline,
 * and the actions this user may take right now. Reviewers decide per line (approve / reduce /
 * reject) before approving; every action re-checks permissions and the claim version server-side.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRightLeft,
  CalendarX,
  Check,
  Copy,
  FileText,
  HelpCircle,
  ImageIcon,
  Paperclip,
  Pencil,
  Receipt,
  Undo2,
  X,
} from 'lucide-react';
import { Badge, Button, Card, Checkbox, InfoCallout, Input, Modal, PageLoader } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { canOpen } from '@/lib/route-access';
import { formatExpenseAmount, formatExpenseDate, roundMoney } from '@arihant/shared';
import { istToday } from '@/lib/ist-date';
import { errorMessage, fieldErrors, isConflict, notifyExpensesChanged, type ExpenseAttachment, type ExpenseClaim, type ExpenseItem } from './expense-lib';
import {
  CommentModal,
  ConflictCallout,
  DateText,
  ItemStatusBadge,
  LateFlag,
  Money,
  ProcessModal,
  ReassignModal,
  ReceiptViewer,
  StatusBadge,
  Timeline,
  useToaster,
} from './expense-ui';
import { ClaimFormModal } from './ClaimFormModal';

type Decision = { status: 'approved' | 'partially_approved' | 'rejected'; amount: string; comment: string };
type CommentAction = 'manager-reject' | 'accounts-reject' | 'request-clarification';

/** `inModal`: shown in the claim popup — the action bar pins to the dialog bottom, no room kept for page FABs. */
export const ClaimDetail: React.FC<{ claimId: string; inModal?: boolean }> = ({ claimId, inModal = false }) => {
  const router = useRouter();
  const { user } = useAuth();
  const { push, Toaster } = useToaster();
  // Edit / respond / copied draft open in a popup over this page instead of /expenses/:id/edit.
  const [editId, setEditId] = useState<string | null>(null);
  const [claim, setClaim] = useState<ExpenseClaim | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [decisionErrors, setDecisionErrors] = useState<Record<string, string>>({});
  const [commentAction, setCommentAction] = useState<CommentAction | null>(null);
  const [commentError, setCommentError] = useState<string | null>(null);
  const [processOpen, setProcessOpen] = useState(false);
  const [processErrors, setProcessErrors] = useState<Record<string, string>>({});
  const [processServerError, setProcessServerError] = useState<string | null>(null);
  /** Last refusal from an approve / process call, shown on the page (not only as a toast). */
  const [actionError, setActionError] = useState<string | null>(null);
  const [reassignOpen, setReassignOpen] = useState(false);
  const [reassignErrors, setReassignErrors] = useState<Record<string, string>>({});
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [approveOpen, setApproveOpen] = useState(false);
  const [preview, setPreview] = useState<ExpenseAttachment | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const c = await api.get<ExpenseClaim>(`/expense-claims/${claimId}`);
      setClaim(c);
      setDecisions({});
      setDecisionErrors({});
      setConflict(false);
    } catch (e) {
      setLoadError(errorMessage(e, 'This claim does not exist or you do not have access to it.'));
    } finally {
      setLoading(false);
    }
  }, [claimId]);

  useEffect(() => {
    load();
  }, [load]);

  const actions = claim?.allowed_actions || [];
  const stage: 'manager' | 'accounts' | null = actions.includes('manager_approve')
    ? 'manager'
    : actions.includes('accounts_approve') || (actions.includes('process') && claim?.status === 'accounts_review')
      ? 'accounts'
      : null;
  const ceiling = (i: ExpenseItem) => (stage === 'accounts' ? i.approved_amount ?? i.amount : i.amount);

  const decisionFor = (i: ExpenseItem): Decision =>
    decisions[i.id] || (stage === 'accounts' && ceiling(i) <= 0 ? { status: 'rejected', amount: '0', comment: '' } : { status: 'approved', amount: String(ceiling(i)), comment: '' });

  const projectedTotal = useMemo(() => {
    if (!claim?.items || !stage) return null;
    return roundMoney(
      claim.items.reduce((s, i) => {
        const d = decisionFor(i);
        return s + (d.status === 'rejected' ? 0 : d.status === 'approved' ? ceiling(i) : Number(d.amount) || 0);
      }, 0),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claim, decisions, stage]);

  const decisionPayload = () =>
    (claim?.items || [])
      .filter((i) => decisions[i.id])
      .map((i) => {
        const d = decisions[i.id];
        return { id: i.id, item_status: d.status, approved_amount: d.status === 'partially_approved' ? d.amount : undefined, reviewer_comment: d.comment || undefined };
      });

  const run = async (key: string, path: string, body: Record<string, unknown>, okText: string) => {
    if (!claim) return false;
    setBusy(key);
    setActionError(null);
    if (path === 'process') setProcessServerError(null);
    try {
      const updated = await api.post<ExpenseClaim>(`/expense-claims/${claim.id}/${path}`, { version: claim.version, ...body });
      setClaim(updated);
      setDecisions({});
      setDecisionErrors({});
      notifyExpensesChanged();
      push('success', okText);
      return true;
    } catch (e: any) {
      if (isConflict(e)) {
        setConflict(true);
        push('error', errorMessage(e));
      } else {
        const errs = fieldErrors(e);
        setDecisionErrors(errs);
        const paymentFields = ['tally_voucher_ref', 'payment_reference', 'payment_date'];
        const onlyPaymentFields = Object.keys(errs).length > 0 && Object.keys(errs).every((k) => paymentFields.includes(k));
        if (path === 'process') {
          setProcessErrors(errs);
          // Anything that is not a payment-field error (future-dated lines, line decisions…) is shown in the dialog.
          if (!onlyPaymentFields) setProcessServerError(errorMessage(e));
        }
        if (['manager-approve', 'accounts-approve', 'process'].includes(path) && !onlyPaymentFields) setActionError(errorMessage(e));
        if (path === 'reassign-approver') setReassignErrors(errs);
        if (errs.comment) setCommentError(errs.comment);
        if (!Object.keys(errs).length || Object.keys(errs).some((k) => k.startsWith('items'))) push('error', errorMessage(e));
      }
      return false;
    } finally {
      setBusy(null);
    }
  };

  const approve = () =>
    run(
      'approve',
      stage === 'manager' ? 'manager-approve' : 'accounts-approve',
      { items: decisionPayload() },
      stage === 'manager' ? 'Approved and forwarded to Accounts.' : 'Approved — ready for Tally.',
    );

  if (loading && !claim) return <PageLoader rows={4} />;
  if (loadError || !claim) {
    return (
      <InfoCallout variant="danger" title="Claim unavailable">
        <div className="space-y-2">
          <p>{loadError}</p>
          <Link href="/expenses"><Button size="sm" variant="secondary">Back to expenses</Button></Link>
        </div>
      </InfoCallout>
    );
  }

  const items = claim.items || [];
  const isOwner = claim.employee_id === user?.id;
  // In the Quick view popup the dialog already pads the body, so the cards inset less on phones.
  const cardPad = inModal ? 'p-3 sm:p-5' : 'p-4 sm:p-5';
  const flagged = items.filter((i) => i.is_late || i.duplicate_flag || i.receipt_missing || i.future_dated);
  // Reviewer anomalies. Future-dated lines block approval and payment (the server refuses them too); a missing
  // receipt is a warning the reviewer must acknowledge.
  const futureLines = items.filter((i) => i.future_dated);
  const payable = items.filter((i) => (stage ? decisionFor(i).status !== 'rejected' : i.item_status !== 'rejected'));
  const receiptGaps = payable.filter((i) => i.receipt_missing);
  const blockedByDates = futureLines.length > 0;
  const today = formatExpenseDate(istToday());
  const commentCopy: Record<CommentAction, { title: string; description: string; confirm: string; danger?: boolean }> = {
    'manager-reject': { title: 'Reject claim', description: 'The employee is notified with your comment. Rejection is final; they can copy the claim into a new draft.', confirm: 'Reject claim', danger: true },
    'accounts-reject': { title: 'Reject claim', description: 'The employee is notified with your comment. Rejection is final.', confirm: 'Reject claim', danger: true },
    'request-clarification': { title: 'Ask for clarification', description: 'The claim goes back to the employee to edit and resubmit; it then returns to the manager.', confirm: 'Send back' },
  };

  return (
    <div className="space-y-4">
      {!inModal && (
        <Button variant="ghost" size="sm" leftIcon={<ArrowLeft className="h-4 w-4" />} onClick={() => router.back()}>
          Back
        </Button>
      )}

      {conflict && <ConflictCallout onRefresh={load} />}

      {claim.status === 'clarification_required' && claim.last_reviewer_comment && (
        <InfoCallout variant="warning" title="Clarification requested">
          <p className="text-sm font-medium">“{claim.last_reviewer_comment}”</p>
          {isOwner && <p className="text-xs mt-1">Edit the claim to respond, then resubmit.</p>}
        </InfoCallout>
      )}
      {claim.status === 'rejected' && claim.last_reviewer_comment && (
        <InfoCallout variant="danger" title="Rejected">
          “{claim.last_reviewer_comment}”{isOwner ? ' — use “Copy to new draft” to fix and resubmit without retyping.' : ''}
        </InfoCallout>
      )}
      {claim.status === 'submitted' && claim.manager_active === false && (
        <InfoCallout variant="warning" title="The approver is no longer active">An administrator needs to reassign this claim.</InfoCallout>
      )}

      {/* Header: who, what, how much, and where it is in the two-stage approval */}
      <Card className={`${cardPad} space-y-4`}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#E3EFEE] font-mono text-sm font-bold text-[#0F5E63]" aria-hidden>
              {initials(claim.employee_name)}
            </span>
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs font-semibold text-[#0F5E63]">{claim.claim_number}</span>
                <StatusBadge status={claim.status} />
                {claim.copied_from_claim_number && <Badge variant="outline" size="sm">Copy of {claim.copied_from_claim_number}</Badge>}
              </div>
              <h2 className="font-serif text-xl leading-snug text-[#14213D] break-words">{claim.title}</h2>
              <p className="text-sm text-[#4A5568]">
                <span className="font-medium text-[#14213D]">{claim.employee_name}</span>
                {claim.employee_code ? ` (${claim.employee_code})` : ''}
                {claim.region_name ? ` · ${claim.region_name}` : ''}
              </p>
              {claim.remarks && <p className="text-sm text-[#4A5568] italic break-words">“{claim.remarks}”</p>}
            </div>
          </div>
          {/* two short figures side by side; one size down on phones so lakh amounts fit their half */}
          <div className="grid shrink-0 grid-cols-2 divide-x divide-[#ECE9E2] rounded-[12px] border border-[#ECE9E2] bg-[#FBFAF7] lg:min-w-[300px]">
            <div className="min-w-0 px-4 py-3">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-[#4A5568]">Claimed</div>
              <Money value={claim.total_claimed} className="text-lg font-semibold text-[#14213D] sm:text-xl" />
            </div>
            <div className="min-w-0 px-4 py-3">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-[#4A5568]">{stage ? 'Will approve' : 'Approved'}</div>
              <Money value={stage ? projectedTotal : claim.total_approved} className="text-lg font-semibold text-[#0F5E63] sm:text-xl" />
            </div>
          </div>
        </div>

        <StageTrack status={claim.status} />

        <dl className="grid grid-cols-2 gap-3 rounded-[12px] border border-[#ECE9E2] bg-[#FBFAF7] p-3 text-sm md:grid-cols-4">
          <Meta label="Period">{claim.period_from ? <><DateText value={claim.period_from} /> – <DateText value={claim.period_to} /></> : '—'}</Meta>
          <Meta label="Trip">{claim.trip_id ? <><DateText value={claim.trip_date} /> {claim.trip_location}</> : '—'}</Meta>
          <Meta label="Visit">
            {claim.visit_id ? (
              <>
                <DateText value={claim.visit_date} />{' '}
                {claim.visit_organisation_id && canOpen(user?.role, '/visits') ? (
                  <Link href={`/visits?customer=${claim.visit_organisation_id}`} className="text-[#0F5E63] hover:underline" title="Open this customer's visit history">
                    {claim.visit_organisation_name}
                  </Link>
                ) : (
                  claim.visit_organisation_name
                )}
              </>
            ) : (
              '—'
            )}
          </Meta>
          <Meta label="Approver">{claim.manager_name || '—'}{claim.manager_active === false ? ' (inactive)' : ''}</Meta>
          <Meta label="Submitted"><DateText value={claim.submitted_at} /></Meta>
          {claim.tally_voucher_ref && <Meta label="Tally voucher"><span className="font-mono">{claim.tally_voucher_ref}</span></Meta>}
          {(claim.status === 'processed' || claim.payment_reference) && (
            <Meta label="Payment ref (UTR)">
              {claim.payment_reference ? <span className="font-mono">{claim.payment_reference}</span> : <span className="text-[#9A3412]">Not recorded</span>}
            </Meta>
          )}
          {(claim.status === 'processed' || claim.payment_date) && <Meta label="Paid on">{claim.payment_date ? <DateText value={claim.payment_date} /> : '—'}</Meta>}
        </dl>
      </Card>

      {(stage || actions.includes('process')) && blockedByDates && (
        <InfoCallout variant="danger" title="Expenses dated after today">
          {futureLines.length} line{futureLines.length === 1 ? ' is' : 's are'} dated after today ({today}). This claim cannot be approved or paid until the
          dates are corrected — ask the employee for clarification or reject it.
        </InfoCallout>
      )}

      {stage && flagged.length > 0 && (
        <InfoCallout variant="warning" title="Lines that need a closer look">
          <ul className="text-sm space-y-0.5">
            {flagged.map((i) => (
              <li key={i.id}>
                {i.purpose}:{' '}
                {[
                  i.future_dated && `dated ${formatExpenseDate(i.expense_date)} (after today)`,
                  i.is_late && 'late submission',
                  i.duplicate_flag && 'possible duplicate',
                  i.receipt_missing && 'receipt missing',
                ]
                  .filter(Boolean)
                  .join(', ')}
              </li>
            ))}
          </ul>
        </InfoCallout>
      )}

      {/* Lines */}
      <Card className={`${cardPad} space-y-3`}>
        <div className="flex items-center justify-between">
          <h3 className="font-serif text-lg text-[#14213D]">Expense lines</h3>
          <span className="text-xs text-[#4A5568]">{items.length} line(s)</span>
        </div>
        {items.map((i) => (
          <LineRow
            key={i.id}
            item={i}
            stage={stage}
            ceiling={ceiling(i)}
            decision={decisionFor(i)}
            errors={decisionErrors}
            onDecision={(d) => setDecisions((prev) => ({ ...prev, [i.id]: d }))}
            onPreview={setPreview}
          />
        ))}
      </Card>

      {/* History folds away in the popup so the lines and actions stay in view */}
      <Card className={cardPad}>
        <details open={!inModal} className="group">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 [&::-webkit-details-marker]:hidden">
            <h3 className="font-serif text-lg text-[#14213D]">Approval history</h3>
            <span className="text-xs font-semibold text-[#0F5E63]">
              {(claim.history || []).length} step{(claim.history || []).length === 1 ? '' : 's'}
              <span className="ml-1 inline-block transition-transform group-open:rotate-180">▾</span>
            </span>
          </summary>
          <div className="mt-4">
            <Timeline history={claim.history || []} />
          </div>
        </details>
      </Card>

      {actionError && (
        <InfoCallout variant="danger" title="Action not completed" onClose={() => setActionError(null)}>
          {actionError}
        </InfoCallout>
      )}

      {/* Actions. Phones: buttons grow to fill each wrapped row (no ragged right-aligned leftovers) and the
          long labels get a short form; from sm the right-aligned row as before. */}
      {actions.length > 0 && (
        <div
          className={
            inModal
              ? 'sticky -bottom-4 z-10 -mx-4 -mb-4 flex flex-wrap items-center justify-end gap-2 border-t border-[#DCD8CE] bg-white px-4 py-3 sm:-bottom-5 sm:-mx-5 sm:-mb-5 sm:px-5 [&>button]:flex-auto sm:[&>button]:flex-initial'
              : 'sticky md:static bottom-0 z-30 -mx-4 md:mx-0 border-t md:border-0 border-[#DCD8CE] bg-white/95 md:bg-transparent backdrop-blur pl-4 pr-20 py-3 md:p-0 flex flex-wrap items-center gap-2 justify-end [&>button]:flex-auto sm:[&>button]:flex-initial'
          }
        >
          {actions.includes('edit') && (
            <Button variant="secondary" leftIcon={<Pencil className="h-4 w-4" />} onClick={() => setEditId(claim.id)}>
              {claim.status === 'clarification_required' ? (
                <>
                  <span className="sm:hidden">Respond</span>
                  <span className="hidden sm:inline">Respond & resubmit</span>
                </>
              ) : (
                'Edit draft'
              )}
            </Button>
          )}
          {actions.includes('withdraw') && (
            <Button variant="ghost" leftIcon={<Undo2 className="h-4 w-4" />} onClick={() => setWithdrawOpen(true)} disabled={Boolean(busy)}>Withdraw</Button>
          )}
          {actions.includes('copy') && (
            <Button
              variant="secondary"
              leftIcon={<Copy className="h-4 w-4" />}
              isLoading={busy === 'copy'}
              onClick={async () => {
                setBusy('copy');
                try {
                  const copy = await api.post<ExpenseClaim>(`/expense-claims/${claim.id}/copy`);
                  notifyExpensesChanged();
                  setEditId(copy.id);
                } catch (e) {
                  push('error', errorMessage(e));
                } finally {
                  setBusy(null);
                }
              }}
            >
              <span className="sm:hidden">Copy to draft</span>
              <span className="hidden sm:inline">Copy to new draft</span>
            </Button>
          )}
          {actions.includes('reassign_approver') && (
            <Button variant="secondary" leftIcon={<ArrowRightLeft className="h-4 w-4" />} onClick={() => { setReassignErrors({}); setReassignOpen(true); }}>
              <span className="sm:hidden">Reassign</span>
              <span className="hidden sm:inline">Reassign approver</span>
            </Button>
          )}
          {actions.includes('request_clarification') && (
            <Button variant="secondary" leftIcon={<HelpCircle className="h-4 w-4" />} onClick={() => { setCommentError(null); setCommentAction('request-clarification'); }} disabled={Boolean(busy)}>
              <span className="sm:hidden">Clarify</span>
              <span className="hidden sm:inline">Ask for clarification</span>
            </Button>
          )}
          {(actions.includes('manager_reject') || actions.includes('accounts_reject')) && (
            <Button variant="danger" leftIcon={<X className="h-4 w-4" />} onClick={() => { setCommentError(null); setCommentAction(actions.includes('manager_reject') ? 'manager-reject' : 'accounts-reject'); }} disabled={Boolean(busy)}>
              Reject
            </Button>
          )}
          {(actions.includes('manager_approve') || actions.includes('accounts_approve')) && (
            <Button
              leftIcon={<Check className="h-4 w-4" />}
              isLoading={busy === 'approve'}
              disabled={Boolean(busy) || blockedByDates}
              title={blockedByDates ? 'Expenses dated after today cannot be approved' : undefined}
              onClick={() => { setActionError(null); setApproveOpen(true); }}
            >
              Approve {projectedTotal !== null ? formatExpenseAmount(projectedTotal) : ''}
            </Button>
          )}
          {actions.includes('process') && (
            <Button
              variant={actions.includes('accounts_approve') ? 'secondary' : 'primary'}
              leftIcon={<Receipt className="h-4 w-4" />}
              disabled={Boolean(busy) || blockedByDates}
              title={blockedByDates ? 'Expenses dated after today cannot be paid' : undefined}
              onClick={() => { setProcessErrors({}); setProcessServerError(null); setProcessOpen(true); }}
            >
              {claim.status === 'accounts_review' ? 'Approve & mark paid' : 'Mark as paid'}
            </Button>
          )}
        </div>
      )}

      {commentAction && (
        <CommentModal
          open
          title={commentCopy[commentAction].title}
          description={commentCopy[commentAction].description}
          confirmLabel={commentCopy[commentAction].confirm}
          danger={commentCopy[commentAction].danger}
          busy={busy === 'comment'}
          serverError={commentError}
          onClose={() => setCommentAction(null)}
          onConfirm={async (comment) => {
            setBusy('comment');
            const ok = await run('comment', commentAction, { comment }, commentAction === 'request-clarification' ? 'Sent back to the employee.' : 'Claim rejected.');
            if (ok) setCommentAction(null);
          }}
        />
      )}

      <ProcessModal
        open={processOpen}
        busy={busy === 'process'}
        total={claim.status === 'accounts_review' ? projectedTotal : claim.total_approved}
        errors={processErrors}
        serverError={processServerError}
        anomalies={{ futureDated: futureLines.length, receiptMissing: receiptGaps.length }}
        onClose={() => setProcessOpen(false)}
        onConfirm={async (v) => {
          const ok = await run('process', 'process', { ...v, items: claim.status === 'accounts_review' ? decisionPayload() : undefined }, 'Marked as paid — payment reference saved.');
          if (ok) setProcessOpen(false);
        }}
      />

      {approveOpen && stage && (
        <ApproveDialog
          claim={claim}
          stage={stage}
          items={items}
          decisionFor={decisionFor}
          ceiling={ceiling}
          total={projectedTotal}
          busy={busy === 'approve'}
          serverError={actionError}
          onPreview={setPreview}
          onClose={() => setApproveOpen(false)}
          onConfirm={async () => {
            const ok = await approve();
            if (ok) setApproveOpen(false);
          }}
        />
      )}

      <ReassignModal
        open={reassignOpen}
        busy={busy === 'reassign'}
        employeeId={claim.employee_id}
        currentApproverId={claim.manager_id}
        errors={reassignErrors}
        onClose={() => setReassignOpen(false)}
        onConfirm={async (v) => {
          const ok = await run('reassign', 'reassign-approver', v, 'Approver reassigned.');
          if (ok) setReassignOpen(false);
        }}
      />

      <Modal isOpen={withdrawOpen} onClose={() => setWithdrawOpen(false)} title="Withdraw this claim?" description="It will be removed from your approver's queue. You can copy it into a new draft later." maxWidth="sm">
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" className="w-full sm:w-auto" onClick={() => setWithdrawOpen(false)}>Keep</Button>
          <Button
            variant="danger"
            className="w-full sm:w-auto"
            isLoading={busy === 'withdraw'}
            onClick={async () => {
              const ok = await run('withdraw', 'withdraw', {}, 'Claim withdrawn.');
              if (ok) setWithdrawOpen(false);
            }}
          >
            Withdraw
          </Button>
        </div>
      </Modal>

      <ReceiptViewer attachment={preview} onClose={() => setPreview(null)} />
      {editId && (
        <ClaimFormModal
          isOpen
          claimId={editId}
          onClose={() => {
            setEditId(null);
            load();
          }}
          onDone={(m) => push('success', m)}
        />
      )}
      <Toaster />
    </div>
  );
};

const initials = (name?: string | null) =>
  (name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');

/** Where an in-flight claim stands: Submitted → Manager → Accounts → Paid. Drafts and closed claims show none. */
const STAGE_STEPS = ['Submitted', 'Manager review', 'Accounts review', 'Paid'];
const stageIndex: Partial<Record<string, number>> = {
  submitted: 1,
  clarification_required: 1,
  manager_approved: 2,
  accounts_review: 2,
  accounts_approved: 3,
  processed: 4,
};
const StageTrack: React.FC<{ status: string }> = ({ status }) => {
  const current = stageIndex[status];
  if (current === undefined) return null;
  const waitingOnEmployee = status === 'clarification_required';
  return (
    <ol className="grid grid-cols-4 gap-1.5" aria-label="Approval progress">
      {STAGE_STEPS.map((label, i) => {
        const done = i < current;
        const now = i === current;
        return (
          <li key={label} className="min-w-0" aria-current={now ? 'step' : undefined}>
            <div
              className={`h-1.5 rounded-full ${
                done ? 'bg-[#0F5E63]' : now ? (waitingOnEmployee ? 'bg-[#9A3412]' : 'bg-[#0F5E63]/40') : 'bg-[#ECE9E2]'
              }`}
            />
            <div className={`mt-1 truncate text-[10px] font-semibold uppercase tracking-wider ${done || now ? 'text-[#14213D]' : 'text-[#6B7280]'}`}>
              {now && waitingOnEmployee ? 'With employee' : label}
            </div>
          </li>
        );
      })}
    </ol>
  );
};

const Meta: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="min-w-0">
    <dt className="text-[11px] uppercase tracking-wide text-[#4A5568]">{label}</dt>
    {/* phones: wrap (a half-width column would cut a visit's customer name to a few letters) */}
    <dd className="text-[#14213D] break-words sm:truncate">{children}</dd>
  </div>
);

const LineRow: React.FC<{
  item: ExpenseItem;
  stage: 'manager' | 'accounts' | null;
  ceiling: number;
  decision: Decision;
  errors: Record<string, string>;
  onDecision: (d: Decision) => void;
  onPreview: (a: ExpenseAttachment) => void;
}> = ({ item, stage, ceiling, decision, errors, onDecision, onPreview }) => {
  const { user } = useAuth();
  const det = item.category_details || {};
  const detail =
    item.category_code === 'TRAVEL' ? `${det.from} → ${det.to} · ${String(det.mode || '').replace('_', ' ')}`
      : item.category_code === 'HOTEL' ? `${det.hotel_name} · ${det.check_in?.split('-').reverse().join('-')} → ${det.check_out?.split('-').reverse().join('-')} · ${det.nights} night(s)`
        : item.category_code === 'LOCAL_CONVEYANCE' ? `${det.from} → ${det.to}${det.km ? ` · ${det.km} km × ₹${det.rate_per_km}` : ''}`
          : item.category_code === 'FOOD' ? `${String(det.meal_type || '').replace('_', ' ')} · ${det.persons} person(s)`
            : null;
  const err = (f: string) => errors[`items.${item.id}.${f}`];
  const lockedOut = stage === 'accounts' && ceiling <= 0;
  const set = (patch: Partial<Decision>) => onDecision({ ...decision, ...patch });

  return (
    <div className="rounded-[14px] border border-[#DCD8CE] p-3 sm:p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <DateText value={item.expense_date} className="text-xs text-[#4A5568]" />
            <Badge variant="outline" size="sm">{item.category_name}</Badge>
            {!stage && <ItemStatusBadge status={item.item_status} />}
            {item.is_late && <LateFlag />}
            {item.future_dated && <Badge variant="danger" size="sm" className="gap-1"><CalendarX className="h-3 w-3" /> Dated after today</Badge>}
            {item.duplicate_flag && <Badge variant="warning" size="sm" className="gap-1"><Copy className="h-3 w-3" /> Possible duplicate</Badge>}
            {item.receipt_missing && <Badge variant="urgent" size="sm" className="gap-1"><Paperclip className="h-3 w-3" /> No receipt</Badge>}
          </div>
          <div className="font-medium text-[#14213D] break-words">{item.purpose}</div>
          {detail && <div className="text-xs text-[#4A5568] break-words">{detail}</div>}
          {(item.customer_name || item.project_code) && (
            <div className="text-xs text-[#4A5568]">
              {item.customer_name &&
                (item.customer_id && canOpen(user?.role, '/leads') ? (
                  <Link href={`/leads?customer=${item.customer_id}`} className="text-[#0F5E63] hover:underline" title="Open Customer 360">
                    {item.customer_name}
                  </Link>
                ) : (
                  item.customer_name
                ))}
              {item.customer_name && item.project_code ? ' · ' : ''}
              {item.project_code && `${item.project_code} ${item.project_name || ''}`}
            </div>
          )}
          {item.remarks && <div className="text-xs text-[#4A5568] italic">“{item.remarks}”</div>}
          {item.late_submission_reason && <div className="text-xs text-[#9A3412]">Late: {item.late_submission_reason}</div>}
          {item.reviewer_comment && <div className="text-xs text-[#14213D] bg-[#FBFAF7] border border-[#ECE9E2] rounded-md px-2 py-1">Reviewer: {item.reviewer_comment}</div>}
        </div>
        <div className="text-right shrink-0">
          <Money value={item.amount} className="font-semibold text-[#14213D]" />
          {item.approved_amount !== null && item.approved_amount !== item.amount && (
            <div className="text-xs text-[#0F5E63]">approved <Money value={item.approved_amount} /></div>
          )}
        </div>
      </div>

      {(err('expense_date') || err('category_details.check_in') || err('category_details.check_out')) && (
        <p className="text-xs font-medium text-[#881337]">{[err('expense_date'), err('category_details.check_in'), err('category_details.check_out')].filter(Boolean).join(' ')}</p>
      )}

      {item.attachments.length === 0 && !item.receipt_missing && (
        <p className="flex items-center gap-1 text-[11px] text-[#6B7280]">
          <Paperclip className="h-3 w-3" /> No receipt attached (not required for this category and amount)
        </p>
      )}
      {item.attachments.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {item.attachments.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => onPreview(a)}
              className={`inline-flex items-center gap-1 rounded-lg border px-2 py-2 text-xs hover:underline sm:py-1 ${a.duplicate_of_attachment_id ? 'border-[#9A3412]/40 bg-[#FBEBDD]' : 'border-[#DCD8CE] bg-[#FBFAF7]'}`}
              title={a.duplicate_of_attachment_id ? `Same file as on ${a.duplicate_claim_number}` : undefined}
            >
              {a.mime_type === 'application/pdf' ? <FileText className="h-3.5 w-3.5" /> : <ImageIcon className="h-3.5 w-3.5" />}
              <span className="max-w-[160px] truncate">{a.file_name}</span>
              {a.duplicate_of_attachment_id && <AlertTriangle className="h-3 w-3 text-[#9A3412]" />}
            </button>
          ))}
        </div>
      )}

      {stage && (
        <div className="rounded-lg bg-[#FBFAF7] border border-[#ECE9E2] p-3 space-y-2">
          {lockedOut ? (
            <p className="text-xs text-[#4A5568]">Rejected by the manager — not payable.</p>
          ) : (
            <>
              <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={`Decision for ${item.purpose}`}>
                {(['approved', 'partially_approved', 'rejected'] as const).map((s) => (
                  <Button
                    key={s}
                    size="xs"
                    type="button"
                    role="radio"
                    aria-checked={decision.status === s}
                    className="h-9 sm:h-7"
                    variant={decision.status === s ? (s === 'rejected' ? 'danger' : 'primary') : 'secondary'}
                    onClick={() => set({ status: s, amount: s === 'partially_approved' ? decision.amount : String(ceiling) })}
                  >
                    {s === 'approved' ? `Approve ${formatExpenseAmount(ceiling)}` : s === 'partially_approved' ? 'Reduce' : 'Reject'}
                  </Button>
                ))}
              </div>
              {decision.status === 'partially_approved' && (
                <Input id={`approved-${item.id}`} label="Approved amount (₹)" inputMode="decimal" className="font-mono" value={decision.amount} onChange={(e) => set({ amount: e.target.value.replace(/[^\d.]/g, '') })} error={err('approved_amount')} />
              )}
              {decision.status !== 'approved' && (
                <Input id={`review-comment-${item.id}`} label="Comment for the employee *" value={decision.comment} maxLength={1000} onChange={(e) => set({ comment: e.target.value })} placeholder="Why is this reduced / rejected?" error={err('reviewer_comment')} />
              )}
              {err('item_status') && <p className="text-xs text-[#881337]">{err('item_status')}</p>}
            </>
          )}
        </div>
      )}
    </div>
  );
};

/** What a line's receipt situation is, for reviewers: attached files, missing (required) or not required. */
const ReceiptCell: React.FC<{ item: ExpenseItem; onPreview: (a: ExpenseAttachment) => void }> = ({ item, onPreview }) => {
  if (item.attachments.length > 0) {
    return (
      <div className="flex flex-wrap gap-1">
        {item.attachments.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => onPreview(a)}
            className="inline-flex max-w-full items-center gap-1 rounded-md border border-[#DCD8CE] bg-[#FBFAF7] px-1.5 py-1 text-[11px] text-[#0F5E63] hover:underline"
          >
            {a.mime_type === 'application/pdf' ? <FileText className="h-3 w-3 shrink-0" /> : <ImageIcon className="h-3 w-3 shrink-0" />}
            <span className="max-w-[120px] truncate">{a.file_name}</span>
          </button>
        ))}
      </div>
    );
  }
  if (item.receipt_missing) {
    return <Badge variant="warning" size="sm" className="gap-1 whitespace-nowrap"><Paperclip className="h-3 w-3" /> Missing — required</Badge>;
  }
  return <span className="text-[11px] text-[#6B7280]">None (not required)</span>;
};

/**
 * Stage-1 (manager) / Stage-2 (Accounts) approval confirmation: every line with its date, category, amount, the
 * decision being recorded and its receipt, plus the anomalies the reviewer must see before signing off. Future-dated
 * lines block the approval (the API refuses them too); missing receipts need an explicit acknowledgement.
 */
const ApproveDialog: React.FC<{
  claim: ExpenseClaim;
  stage: 'manager' | 'accounts';
  items: ExpenseItem[];
  decisionFor: (i: ExpenseItem) => Decision;
  ceiling: (i: ExpenseItem) => number;
  total: number | null;
  busy: boolean;
  serverError: string | null;
  onPreview: (a: ExpenseAttachment) => void;
  onClose: () => void;
  onConfirm: () => void;
}> = ({ claim, stage, items, decisionFor, ceiling, total, busy, serverError, onPreview, onClose, onConfirm }) => {
  const [ack, setAck] = useState(false);
  const futureLines = items.filter((i) => i.future_dated);
  const gaps = items.filter((i) => i.receipt_missing && decisionFor(i).status !== 'rejected');
  const blocked = futureLines.length > 0;
  const canConfirm = !blocked && (gaps.length === 0 || ack);
  const decisionText = (i: ExpenseItem) => {
    const d = decisionFor(i);
    if (d.status === 'rejected') return <span className="font-semibold text-[#881337]">Reject</span>;
    const amount = d.status === 'approved' ? ceiling(i) : Number(d.amount) || 0;
    return (
      <span className="font-semibold text-[#0F5E63]">
        {d.status === 'partially_approved' ? 'Reduce to ' : 'Approve '}
        <Money value={amount} />
      </span>
    );
  };
  return (
    <Modal
      isOpen
      onClose={onClose}
      title={stage === 'manager' ? 'Approve claim · Stage 1' : 'Approve claim · Stage 2 (Accounts)'}
      description={`${claim.claim_number} · ${claim.employee_name} · ${claim.title}`}
      maxWidth="2xl"
    >
      <div className="space-y-4">
        {blocked && (
          <InfoCallout variant="danger" title="Cannot approve: expenses dated after today">
            {futureLines.map((i) => `${i.purpose} (${formatExpenseDate(i.expense_date)})`).join(', ')} {futureLines.length === 1 ? 'is' : 'are'} dated after
            today ({formatExpenseDate(istToday())}). Close this and ask for clarification or reject the claim.
          </InfoCallout>
        )}
        {gaps.length > 0 && (
          <InfoCallout variant="warning" title="Receipt missing">
            <p>
              {gaps.length} line{gaps.length === 1 ? '' : 's'} you are approving {gaps.length === 1 ? 'has' : 'have'} no receipt although the category requires one:{' '}
              {gaps.map((i) => i.purpose).join(', ')}. Reject {gaps.length === 1 ? 'it' : 'them'} or ask for clarification, or confirm below — the approval is
              recorded in the claim history.
            </p>
            <div className="mt-2">
              <Checkbox label="I have verified these lines without a receipt" checked={ack} onChange={(e) => setAck(e.target.checked)} />
            </div>
          </InfoCallout>
        )}

        <ul className="divide-y divide-[#ECE9E2] rounded-[14px] border border-[#DCD8CE]">
          {items.map((i) => (
            <li key={i.id} className={`grid grid-cols-1 gap-2 p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start ${i.future_dated ? 'bg-[#FCE8EC]/50' : ''}`}>
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-1.5 text-xs text-[#4A5568]">
                  <DateText value={i.expense_date} className={i.future_dated ? 'font-semibold text-[#881337]' : ''} />
                  <Badge variant="outline" size="sm">{i.category_name}</Badge>
                  {i.future_dated && <Badge variant="danger" size="sm" className="gap-1"><CalendarX className="h-3 w-3" /> After today</Badge>}
                  {i.is_late && <LateFlag />}
                </div>
                <div className="break-words text-sm font-medium text-[#14213D]">{i.purpose}</div>
                <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-[#4A5568]">
                  <span className="font-semibold uppercase tracking-wide">Receipt</span>
                  <ReceiptCell item={i} onPreview={onPreview} />
                </div>
              </div>
              <div className="text-left text-sm sm:text-right">
                <div className="text-xs text-[#4A5568]">Claimed <Money value={i.amount} /></div>
                <div>{decisionText(i)}</div>
              </div>
            </li>
          ))}
        </ul>

        <div className="flex items-center justify-between rounded-[14px] border border-[#ECE9E2] bg-[#FBFAF7] px-3 py-2.5">
          <span className="text-sm text-[#4A5568]">{stage === 'manager' ? 'Forward to Accounts' : 'Mark ready for Tally'}</span>
          <Money value={total} className="text-lg font-semibold text-[#14213D]" />
        </div>

        {serverError && <InfoCallout variant="danger" title="Not approved">{serverError}</InfoCallout>}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" className="w-full sm:w-auto" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button className="w-full sm:w-auto" leftIcon={<Check className="h-4 w-4" />} isLoading={busy} disabled={!canConfirm} onClick={onConfirm}>
            Approve {total !== null ? formatExpenseAmount(total) : ''}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
