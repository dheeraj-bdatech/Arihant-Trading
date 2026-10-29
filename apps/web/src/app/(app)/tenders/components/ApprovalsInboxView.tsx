'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Card, Button, Badge, Input, Select, Textarea, Modal, InfoCallout, Spinner } from '@/components/ui';
import { CheckCircle2, XCircle, ShieldAlert, ArrowRight, RefreshCw, HelpCircle, UserX, UserCheck } from 'lucide-react';
import { formatTaskDate, formatTaskDateTime } from '@arihant/shared';
import { api } from '@/lib/api';
import { istToday, istDateOf } from '@/lib/ist-date';

/** Row of GET /tenders/delegations (the user is the delegator or the delegatee). */
interface DelegationRow {
  id: string;
  delegator_id: string;
  delegatee_id: string;
  start_date: string;
  end_date: string;
  reason?: string | null;
  is_active: boolean;
  delegator_name?: string | null;
  delegatee_name?: string | null;
}

/** A DATE column (bare YYYY-MM-DD, or a midnight instant from the driver) as its IST calendar day. */
const delegationDay = (value: string | null | undefined): string | null => {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : istDateOf(d);
};

/** Roles that hold Go/No-Go approval (RBAC spec): the only sensible cover for an approver. */
const DELEGATE_ROLES = ['management', 'admin'] as const;

interface ApprovalsInboxViewProps {
  currentUser: any;
  onOpenDossier: (tenderId: string) => void;
  /** Called after a decision so the page can refresh the pipeline / KPIs. */
  onChanged?: () => void;
  /** The inbox total, so the page KPI and the View-menu count show the same number as this heading. */
  onCountChange?: (count: number) => void;
}

/** Shape returned by GET /tenders/approvals-inbox (one server query feeds the list, heading and KPI counts). */
interface InboxItem {
  id: string;
  tender_number: string;
  internal_ref?: string | null;
  tender_title?: string | null;
  requirement_text?: string | null;
  organisation_name?: string | null;
  category?: string | null;
  category_name?: string | null;
  estimated_value?: number | string | null;
  submission_deadline?: string | null;
  zone_name?: string | null;
  region_name?: string | null;
  state?: string | null;
  assigned_to_name?: string | null;
  requested_at: string;
  requested_by_name?: string | null;
  requested_by_role?: string | null;
  request_note?: string | null;
  hours_pending: number;
  sla_hours: number;
  sla_breached: boolean;
  deadline_passed: boolean;
  days_left: number | null;
  can_decide: boolean;
  decision_blocked_reason?: string | null;
}

type DecisionType = 'approve' | 'reject' | 'return';

const formatCurrency = (val: number | string | null | undefined) => {
  const n = Number(val);
  if (val === null || val === undefined || val === '' || Number.isNaN(n)) return '—';
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
};

const errorText = (err: any, fallback: string) => {
  const m = err?.data?.message ?? err?.message;
  return Array.isArray(m) ? m.join(', ') : m || fallback;
};

export function ApprovalsInboxView({ currentUser, onOpenDossier, onChanged, onCountChange }: ApprovalsInboxViewProps) {
  const [items, setItems] = useState<InboxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Decision dialog
  const [selected, setSelected] = useState<InboxItem | null>(null);
  const [actionType, setActionType] = useState<DecisionType | null>(null);
  const [decisionReason, setDecisionReason] = useState('');
  const [approvalConditions, setApprovalConditions] = useState('');
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Delegation dialog
  const [isDelegationOpen, setIsDelegationOpen] = useState(false);
  const [delegatesList, setDelegatesList] = useState<DelegationRow[]>([]);
  const [delegationError, setDelegationError] = useState<string | null>(null);
  const [delegateOptions, setDelegateOptions] = useState<{ value: string; label: string }[]>([]);
  const [delegateOptionsLoading, setDelegateOptionsLoading] = useState(false);
  const [delegateOptionsError, setDelegateOptionsError] = useState<string | null>(null);
  const [delegationForm, setDelegationForm] = useState({
    delegatee_id: '',
    start_date: istToday(),
    end_date: '',
    reason: '',
  });

  const canApprove = currentUser?.role === 'management' || currentUser?.role === 'admin';

  const loadApprovals = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.get<{ data: InboxItem[]; total: number }>('/tenders/approvals-inbox');
      const list = Array.isArray(res?.data) ? res.data : [];
      setItems(list);
      onCountChange?.(typeof res?.total === 'number' ? res.total : list.length);
    } catch (err: any) {
      setError(errorText(err, 'Could not load the approvals inbox.'));
    } finally {
      setLoading(false);
    }
  }, [onCountChange]);

  const loadDelegates = useCallback(async () => {
    try {
      const res = await api.get('/tenders/delegations');
      setDelegatesList(Array.isArray(res) ? res : []);
    } catch {
      setDelegatesList([]);
    }
  }, []);

  useEffect(() => {
    loadApprovals();
    loadDelegates();
  }, [loadApprovals, loadDelegates]);

  /** Active Management / Admin users other than me, for the delegate picker. */
  const loadDelegateOptions = useCallback(async () => {
    try {
      setDelegateOptionsLoading(true);
      setDelegateOptionsError(null);
      const lists = await Promise.all(
        DELEGATE_ROLES.map((role) => api.get<any>('/users', { role, is_active: 'true', limit: 100 })),
      );
      const seen = new Set<string>();
      const options: { value: string; label: string }[] = [];
      lists.forEach((res, idx) => {
        const rows: any[] = Array.isArray(res?.data) ? res.data : Array.isArray(res) ? res : [];
        const roleLabel = DELEGATE_ROLES[idx] === 'admin' ? 'Admin' : 'Management';
        for (const u of rows) {
          if (!u?.id || u.id === currentUser?.id || u.is_active === false || seen.has(u.id)) continue;
          seen.add(u.id);
          options.push({ value: u.id, label: `${u.full_name || u.email || 'User'} — ${roleLabel}` });
        }
      });
      options.sort((a, b) => a.label.localeCompare(b.label));
      setDelegateOptions(options);
    } catch (err: any) {
      setDelegateOptions([]);
      setDelegateOptionsError(errorText(err, 'Could not load Management / Admin users.'));
    } finally {
      setDelegateOptionsLoading(false);
    }
  }, [currentUser?.id]);

  const openDelegation = () => {
    setDelegationError(null);
    setDelegationForm({ delegatee_id: '', start_date: istToday(), end_date: '', reason: '' });
    setIsDelegationOpen(true);
    loadDelegateOptions();
  };

  // Delegations that matter today (IST): mine going out (active now or scheduled), and ones naming me as cover.
  const todayIst = istToday();
  const myId = currentUser?.id;
  const delegationWindow = (d: DelegationRow) => {
    const start = delegationDay(d.start_date);
    const end = delegationDay(d.end_date);
    if (!d.is_active || !start || !end || end < todayIst) return null;
    return start <= todayIst ? ('active' as const) : ('scheduled' as const);
  };
  const outgoingDelegations = delegatesList
    .filter((d) => myId && d.delegator_id === myId)
    .map((d) => ({ row: d, state: delegationWindow(d) }))
    .filter((d): d is { row: DelegationRow; state: 'active' | 'scheduled' } => d.state !== null);
  const incomingDelegations = delegatesList.filter(
    (d) => myId && d.delegatee_id === myId && d.delegator_id !== myId && delegationWindow(d) === 'active',
  );

  const openDecision = (item: InboxItem, type: DecisionType) => {
    setSelected(item);
    setActionType(type);
    setDecisionReason('');
    setApprovalConditions('');
    setDecisionError(null);
  };

  const closeDecision = () => {
    if (isSubmitting) return;
    setActionType(null);
    setSelected(null);
    setDecisionError(null);
  };

  const handleConfirmDecision = async () => {
    if (!selected || !actionType) return;
    setDecisionError(null);
    if ((actionType === 'reject' || actionType === 'return') && !decisionReason.trim()) {
      setDecisionError(
        actionType === 'reject'
          ? 'A rejection reason is mandatory when rejecting tender participation.'
          : 'Write the clarification needed before returning this tender.',
      );
      return;
    }

    try {
      setIsSubmitting(true);
      if (actionType === 'approve') {
        await api.post(`/tenders/${selected.id}/approve`, {
          decision: 'approved',
          remarks: approvalConditions.trim() || undefined,
        });
      } else if (actionType === 'reject') {
        await api.post(`/tenders/${selected.id}/reject`, {
          rejection_reason: decisionReason.trim(),
          remarks: decisionReason.trim(),
        });
      } else {
        await api.post(`/tenders/${selected.id}/transition`, {
          to_status: 'IDENTIFIED',
          note: `Returned for clarification: ${decisionReason.trim()}`,
        });
      }
      const ref = selected.tender_number;
      setNotice(
        actionType === 'approve'
          ? `${ref} approved — moved to Under Preparation.`
          : actionType === 'reject'
            ? `${ref} rejected internally.`
            : `${ref} returned to Identified for clarification.`,
      );
      setActionType(null);
      setSelected(null);
      await loadApprovals();
      onChanged?.();
    } catch (err: any) {
      // Keep the dialog open and show exactly what the server refused.
      setDecisionError(errorText(err, 'The decision could not be recorded.'));
      await loadApprovals();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSaveDelegation = async (e: React.FormEvent) => {
    e.preventDefault();
    setDelegationError(null);
    if (!delegationForm.delegatee_id.trim() || !delegationForm.end_date) {
      setDelegationError('Choose the delegate and an end date.');
      return;
    }
    if (delegationForm.end_date < delegationForm.start_date) {
      setDelegationError('End date cannot be before the start date.');
      return;
    }
    try {
      setIsSubmitting(true);
      await api.post('/tenders/delegations', {
        delegatee_id: delegationForm.delegatee_id.trim(),
        start_date: delegationForm.start_date,
        end_date: delegationForm.end_date,
        reason: delegationForm.reason.trim() || undefined,
      });
      setIsDelegationOpen(false);
      setDelegationForm({ delegatee_id: '', start_date: istToday(), end_date: '', reason: '' });
      setNotice('Out-of-office approval delegation saved.');
      await loadDelegates();
    } catch (err: any) {
      setDelegationError(errorText(err, 'Could not save the delegation.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const total = items.length;
  const breached = items.filter((i) => i.sla_breached).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-5 rounded-[14px] bg-white border border-[#DCD8CE] shadow-sm">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="p-2 rounded-lg bg-[#E3EFEE] text-[#0F5E63]">
              <UserCheck className="w-5 h-5" />
            </span>
            <h2 className="text-xl font-serif font-bold text-[#14213D]">Approvals Inbox</h2>
            <Badge variant={total > 0 ? 'urgent' : 'outline'} size="sm">
              <span className="font-mono">{total}</span>&nbsp;Pending
            </Badge>
            {breached > 0 && (
              <Badge variant="danger" size="sm">
                <span className="font-mono">{breached}</span>&nbsp;past SLA
              </Badge>
            )}
          </div>
          <p className="text-xs text-[#4A5568]">
            Tenders currently awaiting internal approval{canApprove ? '' : ' in your territory'}, most urgent deadline
            first. Requests whose tender has moved on never appear here.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {canApprove && (
            <Button
              variant="outline"
              size="sm"
              onClick={openDelegation}
              leftIcon={<UserX className="w-4 h-4" />}
            >
              Out-of-Office Delegate
            </Button>
          )}
        </div>
      </div>

      {!canApprove && (
        <InfoCallout variant="warning" title="Read-only">
          Only Management and Admin can approve or reject tender participation. You can follow the queue here.
        </InfoCallout>
      )}

      {notice && (
        <InfoCallout variant="success" onClose={() => setNotice(null)}>
          {notice}
        </InfoCallout>
      )}

      {outgoingDelegations.length > 0 && (
        <div className="p-4 rounded-[14px] bg-[#FBFAF7] border border-[#DCD8CE] space-y-2">
          {outgoingDelegations.map(({ row, state }) => (
            <div key={row.id} className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 text-xs">
                <UserCheck className="w-5 h-5 text-[#0F5E63] shrink-0" />
                <div>
                  <span className="font-semibold text-[#14213D]">
                    {state === 'active' ? 'Your active delegation:' : 'Your scheduled delegation:'}
                  </span>{' '}
                  <span className="font-medium text-[#0F5E63]">{row.delegatee_name || 'Delegate'}</span> covers for you{' '}
                  {state === 'scheduled' && (
                    <>
                      from <span className="font-mono">{formatTaskDate(delegationDay(row.start_date))}</span>{' '}
                    </>
                  )}
                  until <span className="font-mono">{formatTaskDate(delegationDay(row.end_date))}</span>
                  {row.reason ? <span className="text-[#4A5568]"> — {row.reason}</span> : null}
                </div>
              </div>
              <Badge variant={state === 'active' ? 'success' : 'outline'} size="sm">
                {state === 'active' ? 'Active' : 'Scheduled'}
              </Badge>
            </div>
          ))}
        </div>
      )}

      {incomingDelegations.length > 0 && (
        <InfoCallout variant="info" title="You are covering approvals">
          {incomingDelegations.map((row) => (
            <p key={row.id}>
              {row.delegator_name || 'An approver'} named you as out-of-office cover until{' '}
              <span className="font-mono">{formatTaskDate(delegationDay(row.end_date))}</span>
              {row.reason ? ` — ${row.reason}` : ''}.
            </p>
          ))}
        </InfoCallout>
      )}

      {loading && items.length === 0 ? (
        <div className="p-12 text-center text-sm text-[#4A5568] flex items-center justify-center gap-2">
          <Spinner size="xs" />
          Loading approval requests...
        </div>
      ) : error ? (
        <InfoCallout variant="danger" title="Could not load approvals">
          {error}
        </InfoCallout>
      ) : items.length === 0 ? (
        <Card className="p-12 text-center">
          <div className="mx-auto w-12 h-12 rounded-full bg-[#E3EFEE] flex items-center justify-center text-[#0F5E63] mb-4">
            <CheckCircle2 className="w-6 h-6" />
          </div>
          <h3 className="text-base font-serif font-bold text-[#14213D] mb-1">Approvals Inbox is clear</h3>
          <p className="text-xs text-[#4A5568] max-w-md mx-auto">
            When a tender is submitted for review it appears here immediately.
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {items.map((item) => {
            const slaLeft = item.sla_hours - item.hours_pending;
            const decisionsEnabled = canApprove && item.can_decide;
            return (
              <Card key={item.id} className="p-5 hover:border-[#0F5E63] transition-all bg-white">
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                  <div className="space-y-2 flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-bold text-[#0F5E63] px-2 py-0.5 rounded bg-[#E3EFEE]">
                        {item.tender_number}
                      </span>
                      <Badge variant={(item.category || '').toLowerCase().includes('pq') ? 'cyber' : 'default'} size="sm">
                        {(item.category_name || item.category || 'General').toUpperCase()}
                      </Badge>
                      {item.sla_breached ? (
                        <Badge variant="danger" size="sm">
                          SLA breached ({item.hours_pending}h / {item.sla_hours}h)
                        </Badge>
                      ) : (
                        <Badge variant="warning" size="sm">
                          {slaLeft}h left in SLA
                        </Badge>
                      )}
                      {item.deadline_passed && (
                        <Badge variant="danger" size="sm">
                          Bid deadline passed
                        </Badge>
                      )}
                    </div>

                    <h3 className="text-base font-serif font-bold text-[#14213D] leading-snug break-words">
                      {item.tender_title || item.requirement_text || item.tender_number}
                    </h3>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1 text-xs text-[#4A5568]">
                      <div>
                        <span className="block text-[10px] uppercase font-semibold text-[#4A5568]/70">Buyer</span>
                        <span className="font-medium text-[#14213D]">{item.organisation_name || '—'}</span>
                      </div>
                      <div>
                        <span className="block text-[10px] uppercase font-semibold text-[#4A5568]/70">Est. value</span>
                        <span className="font-mono font-semibold text-[#0F5E63]">{formatCurrency(item.estimated_value)}</span>
                      </div>
                      <div>
                        <span className="block text-[10px] uppercase font-semibold text-[#4A5568]/70">Submission deadline (IST)</span>
                        <span className="font-mono text-[#9A3412] font-medium">
                          {item.submission_deadline ? formatTaskDateTime(item.submission_deadline) : 'Not set'}
                        </span>
                      </div>
                      <div>
                        <span className="block text-[10px] uppercase font-semibold text-[#4A5568]/70">Territory</span>
                        <span className="font-medium text-[#14213D]">
                          {[item.zone_name, item.region_name].filter(Boolean).join(' / ') || item.state || '—'}
                        </span>
                      </div>
                    </div>

                    <p className="text-[11px] text-[#4A5568]">
                      Requested by{' '}
                      <span className="font-semibold text-[#14213D]">{item.requested_by_name || 'team member'}</span>
                      {item.requested_by_role ? ` (${item.requested_by_role.replace(/_/g, ' ')})` : ''} on{' '}
                      <span className="font-mono">{formatTaskDateTime(item.requested_at)}</span>
                      {item.request_note ? ` — “${item.request_note}”` : ''}
                    </p>

                    {canApprove && !item.can_decide && item.decision_blocked_reason && (
                      <div className="p-2.5 rounded-lg bg-[#FBEBDD] border border-[#9A3412]/30 flex items-center gap-2 text-xs text-[#9A3412]">
                        <ShieldAlert className="w-4 h-4 shrink-0" />
                        <span>{item.decision_blocked_reason}</span>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col sm:flex-row lg:flex-col gap-2 shrink-0 justify-center">
                    {canApprove ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          size="sm"
                          variant="primary"
                          onClick={() => openDecision(item, 'approve')}
                          disabled={!decisionsEnabled}
                          leftIcon={<CheckCircle2 className="w-4 h-4" />}
                        >
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={() => openDecision(item, 'reject')}
                          disabled={!decisionsEnabled}
                          leftIcon={<XCircle className="w-4 h-4" />}
                        >
                          Reject
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => openDecision(item, 'return')}
                          disabled={!decisionsEnabled}
                          leftIcon={<HelpCircle className="w-4 h-4" />}
                        >
                          Return
                        </Button>
                      </div>
                    ) : (
                      <Badge variant="warning" size="sm">
                        Awaiting Management
                      </Badge>
                    )}
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => onOpenDossier(item.id)}
                      rightIcon={<ArrowRight className="w-3.5 h-3.5" />}
                    >
                      View full dossier
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Decision dialog — reuses POST /tenders/:id/approve | /reject | /transition */}
      <Modal
        isOpen={Boolean(actionType)}
        onClose={closeDecision}
        title={
          actionType === 'approve'
            ? 'Approve participation'
            : actionType === 'reject'
              ? 'Reject participation'
              : 'Return for clarification'
        }
        description={selected ? `${selected.tender_number} • ${selected.organisation_name || ''}` : undefined}
        maxWidth="md"
      >
        <div className="space-y-4 text-xs">
          {decisionError && (
            <InfoCallout variant="danger" title="Not recorded" onClose={() => setDecisionError(null)}>
              {decisionError}
            </InfoCallout>
          )}
          {actionType === 'approve' ? (
            <>
              <p className="text-[#4A5568]">
                Approving moves the tender to Under Preparation so the team can start the bid documents.
              </p>
              <Input
                label="Approval conditions (optional)"
                placeholder="e.g. Margin must not be less than 12%"
                value={approvalConditions}
                onChange={(e) => setApprovalConditions(e.target.value)}
              />
            </>
          ) : (
            <>
              <p className="text-[#4A5568]">
                {actionType === 'reject'
                  ? 'A reason is mandatory for rejections and is kept in the audit history.'
                  : 'The tender goes back to Identified with your note so the requester can resubmit.'}
              </p>
              <Textarea
                label={actionType === 'reject' ? 'Rejection reason *' : 'Clarification needed *'}
                rows={4}
                placeholder={
                  actionType === 'reject'
                    ? 'Why Arihant will not participate in this tender...'
                    : 'Questions on specifications, delivery terms or pricing...'
                }
                value={decisionReason}
                onChange={(e) => setDecisionReason(e.target.value)}
              />
            </>
          )}

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#ECE9E2]">
            <Button variant="outline" size="sm" onClick={closeDecision} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button
              variant={actionType === 'approve' ? 'primary' : actionType === 'reject' ? 'danger' : 'secondary'}
              size="sm"
              onClick={handleConfirmDecision}
              isLoading={isSubmitting}
            >
              {actionType === 'approve' ? 'Confirm approval' : actionType === 'reject' ? 'Confirm rejection' : 'Send back'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Delegation dialog */}
      <Modal
        isOpen={isDelegationOpen}
        onClose={() => setIsDelegationOpen(false)}
        title="Out-of-office approval delegation"
        description="Record which Management or Admin colleague covers your tender approvals while you are on leave or travelling."
        maxWidth="md"
      >
        <form onSubmit={handleSaveDelegation} className="space-y-4 text-xs">
          {delegationError && (
            <InfoCallout variant="danger" onClose={() => setDelegationError(null)}>
              {delegationError}
            </InfoCallout>
          )}
          {delegateOptionsError && (
            <InfoCallout variant="danger" title="Could not load colleagues">
              <p>{delegateOptionsError}</p>
              <Button
                variant="outline"
                size="xs"
                type="button"
                onClick={loadDelegateOptions}
                isLoading={delegateOptionsLoading}
                leftIcon={<RefreshCw className="w-3.5 h-3.5" />}
              >
                Retry
              </Button>
            </InfoCallout>
          )}
          <Select
            label="Delegate"
            required
            value={delegationForm.delegatee_id}
            onChange={(e) => setDelegationForm({ ...delegationForm, delegatee_id: e.target.value })}
            options={delegateOptions}
            disabled={delegateOptionsLoading}
            placeholder={
              delegateOptionsLoading
                ? 'Loading Management / Admin users…'
                : delegateOptions.length === 0 && !delegateOptionsError
                  ? 'No other active Management / Admin users'
                  : 'Choose a Management or Admin colleague'
            }
            searchPlaceholder="Search by name…"
            helperText="Recorded for out-of-office cover only — it does not grant approval rights; Go/No-Go stays with Management and Admin."
          />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input
              label="Start date *"
              type="date"
              value={delegationForm.start_date}
              onChange={(e) => setDelegationForm({ ...delegationForm, start_date: e.target.value })}
              required
            />
            <Input
              label="End date *"
              type="date"
              min={delegationForm.start_date}
              value={delegationForm.end_date}
              onChange={(e) => setDelegationForm({ ...delegationForm, end_date: e.target.value })}
              required
            />
          </div>
          <Input
            label="Reason"
            placeholder="e.g. Annual leave"
            value={delegationForm.reason}
            onChange={(e) => setDelegationForm({ ...delegationForm, reason: e.target.value })}
          />
          <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#ECE9E2]">
            <Button variant="outline" size="sm" type="button" onClick={() => setIsDelegationOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" type="submit" isLoading={isSubmitting}>
              Save delegation
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
