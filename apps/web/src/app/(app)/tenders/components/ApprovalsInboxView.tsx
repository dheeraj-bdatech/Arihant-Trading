'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Card,
  Button,
  Badge,
  Input,
  Select,
  Textarea,
  Modal,
  InfoCallout,
  EmptyState,
} from '@/components/ui';
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  Building2,
  MapPin,
  Calendar,
  IndianRupee,
  UserCheck,
  ShieldAlert,
  ArrowRight,
  ExternalLink,
  RefreshCw,
  HelpCircle,
  UserX,
  Sparkles,
} from 'lucide-react';
import { api } from '@/lib/api';

interface ApprovalsInboxViewProps {
  currentUser: any;
  onOpenDossier: (tenderId: string) => void;
}

export function ApprovalsInboxView({
  currentUser,
  onOpenDossier,
}: ApprovalsInboxViewProps) {
  const [tenders, setTenders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Decision Modal State
  const [selectedTender, setSelectedTender] = useState<any | null>(null);
  const [actionType, setActionType] = useState<
    'approve' | 'reject' | 'return' | null
  >(null);
  const [decisionReason, setDecisionReason] = useState('');
  const [approvalConditions, setApprovalConditions] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Delegation Modal State
  const [isDelegationOpen, setIsDelegationOpen] = useState(false);
  const [delegatesList, setDelegatesList] = useState<any[]>([]);
  const [delegationForm, setDelegationForm] = useState({
    delegate_user_id: '',
    start_date: new Date().toISOString().split('T')[0],
    end_date: '',
    reason: '',
  });

  const loadApprovals = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      // Fetch tenders awaiting approval
      const res = await api.get('/tenders', {
        params: {
          status: 'awaiting_internal_approval',
          limit: 50,
        },
      });

      let items = res.data?.data || res.data || [];
      // Also fetch 'awaiting_approval' if any exist in legacy state
      if (!Array.isArray(items)) {
        items = [];
      }
      setTenders(items);
    } catch (err: any) {
      console.error('Failed to load pending approvals:', err);
      setError(err?.response?.data?.message || 'Could not load approvals inbox.');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDelegates = useCallback(async () => {
    try {
      const res = await api.get('/tenders/delegations');
      setDelegatesList(res.data || []);
    } catch (err) {
      console.error('Failed to load delegations:', err);
    }
  }, []);

  useEffect(() => {
    loadApprovals();
    loadDelegates();
  }, [loadApprovals, loadDelegates]);

  const canApprove =
    currentUser?.role === 'management' || currentUser?.role === 'admin';

  const handleOpenDecision = (
    tender: any,
    type: 'approve' | 'reject' | 'return',
  ) => {
    if (!canApprove) {
      alert('Strict Governance: Only Management and Admin roles can record decisions during Internal Review.');
      return;
    }
    setSelectedTender(tender);
    setActionType(type);
    setDecisionReason('');
    setApprovalConditions('');
  };

  const handleConfirmDecision = async () => {
    if (!selectedTender || !actionType) return;
    if (!canApprove) {
      alert('Strict Governance: Only Management and Admin roles are authorized to approve or reject tender participation.');
      return;
    }

    if (
      (actionType === 'reject' || actionType === 'return') &&
      !decisionReason.trim()
    ) {
      alert('A clear reason or clarification question is strictly required.');
      return;
    }

    try {
      setIsSubmitting(true);
      if (actionType === 'approve') {
        await api.post(`/tenders/${selectedTender.id}/approve`, {
          decision: 'approved',
          remarks: approvalConditions.trim() || undefined,
        });
      } else if (actionType === 'reject') {
        await api.post(`/tenders/${selectedTender.id}/approve`, {
          decision: 'rejected',
          rejection_reason: decisionReason.trim(),
          remarks: decisionReason.trim(),
        });
      } else if (actionType === 'return') {
        // Return for clarification routes to Identified status with clarification question
        await api.post(`/tenders/${selectedTender.id}/transition`, {
          to_status: 'IDENTIFIED',
          target_status: 'identified',
          remarks: `Returned for Clarification: ${decisionReason.trim()}`,
        });
      }

      setActionType(null);
      setSelectedTender(null);
      await loadApprovals();
    } catch (err: any) {
      console.error('Approval action failed:', err);
      alert(err?.response?.data?.message || 'Action could not be completed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSaveDelegation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!delegationForm.delegate_user_id || !delegationForm.end_date) {
      alert('Please specify delegate and end date.');
      return;
    }

    try {
      setIsSubmitting(true);
      await api.post('/tenders/delegations', delegationForm);
      setIsDelegationOpen(false);
      setDelegationForm({
        delegate_user_id: '',
        start_date: new Date().toISOString().split('T')[0],
        end_date: '',
        reason: '',
      });
      await loadDelegates();
      alert('Out-of-office approval delegation configured successfully.');
    } catch (err: any) {
      console.error('Failed to create delegation:', err);
      alert(err?.response?.data?.message || 'Could not save delegation.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatCurrency = (val: number | null | undefined) => {
    if (val === null || val === undefined || isNaN(val)) return '—';
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    }).format(val);
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-5 rounded-[14px] bg-white border border-[#DCD8CE] shadow-sm">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="p-2 rounded-lg bg-[#E3EFEE] text-[#0F5E63]">
              <UserCheck className="w-5 h-5" />
            </span>
            <h2 className="text-xl font-serif font-bold text-[#14213D]">
              Approvals Inbox & Governance
            </h2>
            <Badge variant="urgent" size="sm">
              {tenders.length} Pending
            </Badge>
          </div>
          <p className="text-xs text-[#4A5568]">
            Multi-level authority queue with 24-hour SLA tracking, automatic escalation, and segregation of duties.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {canApprove && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsDelegationOpen(true)}
              leftIcon={<UserX className="w-4 h-4" />}
            >
              Out-of-Office Delegate
            </Button>
          )}
          <Button
            variant="secondary"
            size="sm"
            onClick={loadApprovals}
            isLoading={loading}
            leftIcon={<RefreshCw className="w-4 h-4" />}
          >
            Refresh
          </Button>
        </div>
      </div>

      {/* Strict Governance Notice for non-management/admin roles */}
      {!canApprove && (
        <div className="p-3.5 rounded-[12px] bg-[#FBEBDD] border border-[#9A3412]/30 flex items-center gap-3 text-xs text-[#9A3412]">
          <ShieldAlert className="w-5 h-5 shrink-0 text-[#9A3412]" />
          <div>
            <span className="font-semibold block text-[#7C2D12]">Strict Governance Enforcement</span>
            Only Management and Admin roles are authorized to approve or reject tender participation during Internal Review. You have read-only audit visibility.
          </div>
        </div>
      )}

      {/* Active Delegations Banner if any */}
      {delegatesList.length > 0 && (
        <div className="p-4 rounded-[14px] bg-[#FBFAF7] border border-[#DCD8CE] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <UserCheck className="w-5 h-5 text-[#0F5E63]" />
            <div className="text-xs">
              <span className="font-semibold text-[#14213D]">
                Active Delegation Configured:
              </span>{' '}
              Approvals delegated to{' '}
              <span className="font-mono font-medium text-[#0F5E63]">
                {delegatesList[0]?.delegate_name || delegatesList[0]?.delegate_user_id}
              </span>{' '}
              until {delegatesList[0]?.end_date}.
            </div>
          </div>
          <Badge variant="outline" size="sm">
            Active Rule
          </Badge>
        </div>
      )}

      {/* Tenders List */}
      {loading ? (
        <div className="p-12 text-center text-sm text-[#4A5568] flex items-center justify-center gap-2">
          <RefreshCw className="w-4 h-4 animate-spin text-[#0F5E63]" />
          Loading approval requests...
        </div>
      ) : error ? (
        <InfoCallout variant="danger" title="Error Loading Approvals">
          {error}
        </InfoCallout>
      ) : tenders.length === 0 ? (
        <Card className="p-12 text-center">
          <div className="mx-auto w-12 h-12 rounded-full bg-[#E3EFEE] flex items-center justify-center text-[#0F5E63] mb-4">
            <CheckCircle2 className="w-6 h-6" />
          </div>
          <h3 className="text-base font-serif font-bold text-[#14213D] mb-1">
            Approvals Inbox is Clear
          </h3>
          <p className="text-xs text-[#4A5568] max-w-md mx-auto">
            All submitted tenders have been evaluated. New internal approval submissions from tender executives and regional managers will appear here automatically.
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {tenders.map((tender) => {
            const isCreatorOrAssignee =
              currentUser?.id &&
              (tender.created_by === currentUser.id ||
                tender.assigned_person_id === currentUser.id);

            // Compute SLA Countdown
            const createdAtDate = new Date(tender.created_at || Date.now());
            const hoursPending = Math.round(
              (Date.now() - createdAtDate.getTime()) / (1000 * 60 * 60),
            );
            const slaHours = 24;
            const slaExceeded = hoursPending > slaHours;

            return (
              <Card
                key={tender.id}
                className="p-5 hover:border-[#0F5E63] transition-all bg-white"
              >
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                  {/* Left Column: Core Identity */}
                  <div className="space-y-2 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-bold text-[#0F5E63] px-2 py-0.5 rounded bg-[#E3EFEE]">
                        {tender.internal_ref || 'TND-REF'}
                      </span>
                      <span className="font-mono text-xs text-[#4A5568]">
                        Portal No: {tender.tender_number}
                      </span>
                      <Badge
                        variant={
                          tender.category_name === 'pq' ||
                          tender.category_name === 'PQ'
                            ? 'cyber'
                            : tender.category_name === 'mha' ||
                              tender.category_name === 'MHA'
                              ? 'urgent'
                              : 'default'
                        }
                        size="sm"
                      >
                        {tender.category_name?.toUpperCase() || 'GENERAL'}
                      </Badge>
                      {slaExceeded ? (
                        <Badge variant="danger" size="sm">
                          SLA Breached ({hoursPending}h / 24h)
                        </Badge>
                      ) : (
                        <Badge variant="warning" size="sm">
                          {24 - hoursPending}h remaining in SLA
                        </Badge>
                      )}
                    </div>

                    <h3 className="text-base font-serif font-bold text-[#14213D] leading-snug">
                      {tender.tender_title || tender.title || 'Untitled Tender'}
                    </h3>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1 text-xs text-[#4A5568]">
                      <div>
                        <span className="block text-[10px] text-[#4A5568]/70 uppercase font-semibold">
                          Buyer Organisation
                        </span>
                        <span className="font-medium text-[#14213D]">
                          {tender.organisation_name || 'Prospect Organisation'}
                        </span>
                      </div>
                      <div>
                        <span className="block text-[10px] text-[#4A5568]/70 uppercase font-semibold">
                          Estimated Value
                        </span>
                        <span className="font-mono font-semibold text-[#0F5E63]">
                          {formatCurrency(tender.estimated_value)}
                        </span>
                      </div>
                      <div>
                        <span className="block text-[10px] text-[#4A5568]/70 uppercase font-semibold">
                          Submission Deadline
                        </span>
                        <span className="font-mono text-[#9A3412] font-medium">
                          {tender.submission_deadline
                            ? new Date(tender.submission_deadline).toLocaleString(
                                'en-IN',
                                {
                                  dateStyle: 'medium',
                                  timeStyle: 'short',
                                },
                              )
                            : 'Not Set'}
                        </span>
                      </div>
                      <div>
                        <span className="block text-[10px] text-[#4A5568]/70 uppercase font-semibold">
                          Territory / Zone
                        </span>
                        <span className="font-medium text-[#14213D]">
                          {tender.zone_name || tender.state || 'National'}
                        </span>
                      </div>
                    </div>

                    {/* Segregation of Duties Notice */}
                    {isCreatorOrAssignee && (
                      <div className="p-2.5 rounded-lg bg-[#FBEBDD] border border-[#9A3412]/30 flex items-center gap-2 text-xs text-[#9A3412]">
                        <ShieldAlert className="w-4 h-4 shrink-0" />
                        <span>
                          <strong>Segregation of Duties:</strong> You created or are assigned to this tender. System policy requires a separate manager or delegate to approve.
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Right Column: Actions */}
                  <div className="flex flex-col sm:flex-row lg:flex-col gap-2 shrink-0 justify-center">
                    {canApprove ? (
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="primary"
                          onClick={() => handleOpenDecision(tender, 'approve')}
                          disabled={isCreatorOrAssignee}
                          leftIcon={<CheckCircle2 className="w-4 h-4" />}
                        >
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={() => handleOpenDecision(tender, 'reject')}
                          disabled={isCreatorOrAssignee}
                          leftIcon={<XCircle className="w-4 h-4" />}
                        >
                          Reject
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => handleOpenDecision(tender, 'return')}
                          disabled={isCreatorOrAssignee}
                          leftIcon={<HelpCircle className="w-4 h-4" />}
                        >
                          Return
                        </Button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <Badge variant="warning" size="sm">
                          Mgmt Approval Required
                        </Badge>
                      </div>
                    )}

                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => onOpenDossier(tender.id)}
                      rightIcon={<ArrowRight className="w-3.5 h-3.5" />}
                    >
                      View Full Dossier
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Decision Modal */}
      <Modal
        isOpen={Boolean(actionType)}
        onClose={() => setActionType(null)}
        title={
          actionType === 'approve'
            ? 'Approve Tender Submission'
            : actionType === 'reject'
              ? 'Reject Tender Preparation'
              : 'Return for Clarification'
        }
        description={`Tender: ${selectedTender?.internal_ref || selectedTender?.tender_number} • Buyer: ${selectedTender?.organisation_name}`}
        maxWidth="md"
      >
        <div className="space-y-4 text-xs">
          {actionType === 'approve' ? (
            <>
              <p className="text-[#4A5568]">
                Approving this tender authorizes the preparation team to begin preparing NIT compliance, commercial bids, and EMD documents.
              </p>
              <div>
                <label className="block text-xs font-semibold text-[#14213D] mb-1">
                  Approval Conditions (Optional)
                </label>
                <Input
                  placeholder="e.g. Quoted margin must not be less than 12%"
                  value={approvalConditions}
                  onChange={(e) => setApprovalConditions(e.target.value)}
                />
              </div>
            </>
          ) : (
            <>
              <p className="text-[#4A5568]">
                {actionType === 'reject'
                  ? 'A detailed business reason is mandatory for rejections. This will be preserved in the immutable audit history.'
                  : 'Specify the clarifications or missing information required before this tender can be evaluated.'}
              </p>
              <div>
                <label className="block text-xs font-semibold text-[#14213D] mb-1">
                  {actionType === 'reject'
                    ? 'Rejection Justification *'
                    : 'Clarification Notes *'}
                </label>
                <Textarea
                  rows={4}
                  placeholder={
                    actionType === 'reject'
                      ? 'Explain why Arihant will not participate in this tender...'
                      : 'List questions regarding specifications, delivery terms, or pricing...'
                  }
                  value={decisionReason}
                  onChange={(e) => setDecisionReason(e.target.value)}
                />
              </div>
            </>
          )}

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#ECE9E2]">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setActionType(null)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              variant={
                actionType === 'approve'
                  ? 'primary'
                  : actionType === 'reject'
                    ? 'danger'
                    : 'secondary'
              }
              size="sm"
              onClick={handleConfirmDecision}
              isLoading={isSubmitting}
            >
              {actionType === 'approve'
                ? 'Confirm Approval'
                : actionType === 'reject'
                  ? 'Confirm Rejection'
                  : 'Send Clarification'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Delegation Modal */}
      <Modal
        isOpen={isDelegationOpen}
        onClose={() => setIsDelegationOpen(false)}
        title="Out-of-Office Approval Delegation"
        description="Delegate your tender approval authority to another verified team member during leave or travel."
        maxWidth="md"
      >
        <form onSubmit={handleSaveDelegation} className="space-y-4 text-xs">
          <div>
            <label className="block text-xs font-semibold text-[#14213D] mb-1">
              Delegate Authority To (User ID / Colleague) *
            </label>
            <Input
              placeholder="Enter User UUID or email"
              value={delegationForm.delegate_user_id}
              onChange={(e) =>
                setDelegationForm({
                  ...delegationForm,
                  delegate_user_id: e.target.value,
                })
              }
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-[#14213D] mb-1">
                Start Date *
              </label>
              <Input
                type="date"
                value={delegationForm.start_date}
                onChange={(e) =>
                  setDelegationForm({
                    ...delegationForm,
                    start_date: e.target.value,
                  })
                }
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#14213D] mb-1">
                End Date *
              </label>
              <Input
                type="date"
                value={delegationForm.end_date}
                onChange={(e) =>
                  setDelegationForm({
                    ...delegationForm,
                    end_date: e.target.value,
                  })
                }
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#14213D] mb-1">
              Reason / Delegation Context
            </label>
            <Input
              placeholder="e.g. Annual leave / defence exhibition travel"
              value={delegationForm.reason}
              onChange={(e) =>
                setDelegationForm({
                  ...delegationForm,
                  reason: e.target.value,
                })
              }
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#ECE9E2]">
            <Button
              variant="outline"
              size="sm"
              type="button"
              onClick={() => setIsDelegationOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              type="submit"
              isLoading={isSubmitting}
            >
              Save Delegation Rule
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
