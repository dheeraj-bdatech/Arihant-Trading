'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  Modal,
  Button,
  Badge,
  Card,
  Input,
  Select,
  Textarea,
  Checkbox,
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
  InfoCallout,
  EmptyState,
  Spinner,
  FormSection,
  ScrollStrip,
} from '@/components/ui';
import {
  FileText,
  Calendar,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Building2,
  DollarSign,
  Paperclip,
  MessageSquare,
  ShieldAlert,
  ArrowRight,
  Plus,
  RefreshCw,
  ExternalLink,
  Layers,
  ShoppingBag,
  Send,
  UserCheck,
  Check,
  X,
  ShieldCheck,
  Award,
} from 'lucide-react';
import { api } from '@/lib/api';
import { formatINR, formatTaskDate, formatTaskDateTime, TENDER_STATUS_LABELS } from '@arihant/shared';
import { istToday, istNowLocalInput, fromIstLocalInput, toIstLocalInput } from '@/lib/ist-date';
import { safeHttpUrl, validateHttpUrl } from '@/lib/safe-url';

/** Server-computed submission readiness (GET /tenders/:id → document_readiness). */
interface DocumentReadiness {
  mandatory_total: number;
  mandatory_ready: number;
  percentage: number;
  all_mandatory_ready: boolean;
  checklist_created: boolean;
  source: 'checklist' | 'template';
  missing: string[];
}

const SUBMISSION_STAGES = ['submitted', 'pq_submitted'];
/** Closed stages: the BOQ, deadline countdown and lifecycle are frozen (mirrors the API's terminal statuses). */
const CLOSED_STAGES = ['won', 'lost', 'cancelled', 'rejected_internally'];
/** Stages where the submission deadline still drives a live countdown (the bid has not gone in yet). */
const PRE_SUBMISSION_STAGES = ['identified', 'awaiting_approval', 'under_preparation', 'pq_qualified', 'on_hold'];
/** Lifecycle cards that declare a verdict: the API only accepts these through the Record outcome form. */
const RESULT_TARGETS = ['won', 'lost'];
/** Stages with something to link (shown on Overview): a Sales Order from an award, a General tender from a PQ qualification. */
const LINKABLE_STAGES = ['won', 'pq_qualified'];
/** Lifecycle card that lifts a hold (POST /resume restores the stage the tender was held at). */
const RESUME_TARGET = 'resume';
/** Stages whose bid / PQ closing time gates the result: a verdict is dated on or after the closing day. */
const CLOSING_GATED_STAGES = ['submitted', 'pq_submitted'];

/**
 * @Roles of every endpoint the dossier calls (apps/api/src/modules/tenders/tenders.controller.ts). An action is shown
 * only to the roles its endpoint accepts, so nobody is offered a button that answers 403.
 */
const ENDPOINT_ROLES = {
  update: ['management', 'regional_manager', 'tender_team', 'sales', 'admin'], // PATCH :id (team, Drive folder)
  transition: ['management', 'regional_manager', 'tender_team', 'sales', 'admin'], // POST :id/transitions
  holdResume: ['management', 'regional_manager', 'tender_team', 'admin'], // POST :id/hold, :id/resume
  approve: ['management', 'admin'], // POST :id/approve
  result: ['management', 'tender_team', 'sales', 'admin'], // POST :id/result, :id/outcome
  corrigendum: ['management', 'regional_manager', 'tender_team', 'admin'], // POST :id/corrigenda
  lineItems: ['management', 'regional_manager', 'tender_team', 'sales', 'admin'], // POST / DELETE :id/line-items
  documents: ['management', 'regional_manager', 'sales', 'tender_team', 'demo_team', 'service_team', 'accounts', 'admin'], // POST / PATCH :id/documents
  initChecklist: ['management', 'regional_manager', 'sales', 'tender_team', 'admin'], // POST :id/documents/init-checklist
  instrument: ['management', 'regional_manager', 'tender_team', 'accounts', 'admin'], // POST :id/financial-instruments
  comment: ['management', 'regional_manager', 'sales', 'tender_team', 'demo_team', 'service_team', 'accounts', 'admin'], // POST :id/comments
  linkedTender: ['management', 'regional_manager', 'tender_team', 'admin'], // POST :id/create-linked-tender
  salesOrder: ['management', 'regional_manager', 'tender_team', 'sales', 'admin'], // POST :id/create-sales-order
} as const;
type DossierEndpoint = keyof typeof ENDPOINT_ROLES;

/** Readable names for tender_activities.event_type codes (History tab); unknown codes are title-cased. */
const ACTIVITY_LABELS: Record<string, string> = {
  IDENTIFIED: 'Tender identified',
  ON_HOLD: 'Put on hold',
  RESUMED: 'Resumed',
  DEADLINE_CHANGED: 'Deadline changed',
  REOPENED: 'Reopened',
  DELETED: 'Deleted',
  TEAM_REASSIGNED: 'Team reassigned',
  PORTAL_ISSUE_LOGGED: 'Portal issue logged',
  PORTAL_ISSUE_UPDATED: 'Portal issue updated',
  LINE_ITEM_ADDED: 'BOQ line added',
  LINE_ITEM_UPDATED: 'BOQ line updated',
  LINE_ITEM_DELETED: 'BOQ line removed',
  DOCUMENT_ADDED: 'Document added',
  DOCUMENT_UPDATED: 'Document updated',
  DOCUMENT_DELETED: 'Document removed',
  CHECKLIST_INITIALIZED: 'Document checklist initialised',
  CORRIGENDUM_ISSUED: 'Corrigendum recorded',
  FINANCIAL_INSTRUMENT_REQUESTED: 'EMD / PBG requested',
  FINANCIAL_INSTRUMENT_UPDATED: 'EMD / PBG updated',
  COMMENT_POSTED: 'Note posted',
  LINKED_TENDER_CREATED: 'Linked General tender created',
  SALES_ORDER_CREATED: 'Sales Order created',
};
const titleCaseCode = (code: string) =>
  code.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
function activityLabel(eventType?: string | null): string {
  const code = String(eventType || '').trim().toUpperCase();
  if (!code) return 'Activity';
  if (ACTIVITY_LABELS[code]) return ACTIVITY_LABELS[code];
  // STATUS_TENDER_SUBMITTED → "Moved to Tender Submitted"; OUTCOME_WON → "Result recorded: Won".
  if (code.startsWith('STATUS_')) {
    const stage = code.slice('STATUS_'.length);
    return `Moved to ${TENDER_STATUS_LABELS[stage] || titleCaseCode(stage)}`;
  }
  if (code.startsWith('OUTCOME_')) return `Result recorded: ${titleCaseCode(code.slice('OUTCOME_'.length))}`;
  return titleCaseCode(code);
}

/** Lakh display for a rupee amount, or "—" when nothing was recorded (never a stand-in value). */
const lakhOrDash = (value: unknown): string => {
  const n = Number(value);
  return value !== null && value !== undefined && value !== '' && Number.isFinite(n) && n > 0
    ? `₹ ${(n / 100000).toFixed(2)} Lakh`
    : '—';
};

type DossierTransition = {
  status: string;
  label: string;
  variant: 'primary' | 'secondary' | 'success' | 'warning' | 'danger';
  description: string;
  defaultRemarks: string;
};

/** PRD §22 tracker: Identified → Submitted for Internal Review → Approved / Rejected → Tender Preparation → Submitted → Result Tracking. */
const PRD_STEPS: { label: string; reachedAt: string[] }[] = [
  { label: '1. Tender Identified', reachedAt: ['identified', 'awaiting_approval', 'rejected_internally', 'under_preparation', 'pq_submitted', 'pq_qualified', 'submitted', 'technical_eval', 'commercial_eval', 'won', 'lost'] },
  { label: '2. Internal Review', reachedAt: ['awaiting_approval', 'rejected_internally', 'under_preparation', 'pq_submitted', 'pq_qualified', 'submitted', 'technical_eval', 'commercial_eval', 'won', 'lost'] },
  { label: '3. Approved / Rejected', reachedAt: ['rejected_internally', 'under_preparation', 'pq_submitted', 'pq_qualified', 'submitted', 'technical_eval', 'commercial_eval', 'won', 'lost'] },
  { label: '4. Tender Preparation', reachedAt: ['under_preparation', 'pq_submitted', 'pq_qualified', 'submitted', 'technical_eval', 'commercial_eval', 'won', 'lost'] },
  { label: '5. Submitted', reachedAt: ['pq_submitted', 'pq_qualified', 'submitted', 'technical_eval', 'commercial_eval', 'won', 'lost'] },
  { label: '6. Result Tracking', reachedAt: ['technical_eval', 'commercial_eval', 'won', 'lost'] },
];

const HOLD: DossierTransition = {
  status: 'on_hold',
  label: 'Put On Hold',
  variant: 'warning',
  description: 'Freeze the tender at this stage (corrigendum, court stay, budget freeze). Resume returns it here.',
  defaultRemarks: 'Put on hold pending clarifications.',
};
const CANCEL: DossierTransition = {
  status: 'cancelled',
  label: 'Cancelled',
  variant: 'danger',
  description: 'Buyer cancelled the procurement, or Arihant formally dropped the tender.',
  defaultRemarks: 'Tender cancelled.',
};
const RESULT_WON: DossierTransition = {
  status: 'won',
  label: 'Result: Won',
  variant: 'success',
  description: 'Record the award: product, region, responsible person, category, result date and value (PRD §26).',
  defaultRemarks: '',
};
const RESULT_LOST: DossierTransition = {
  status: 'lost',
  label: 'Result: Lost',
  variant: 'danger',
  description: 'Record why: pricing, technical, eligibility, documentation, competitor or other (PRD §26).',
  defaultRemarks: '',
};

/**
 * Next stages offered from each PRD §23 stage (mirrors the API state machine in tenders.workflow.ts).
 * A held tender keeps its stage; the only moves are Resume and Cancelled.
 */
function prdTransitions(status: string, category: string, onHold: boolean): DossierTransition[] {
  if (onHold) {
    return [
      { status: RESUME_TARGET, label: 'Resume', variant: 'primary', description: 'Lift the hold and continue from the stage the tender was held at.', defaultRemarks: 'Hold lifted; work continues from the held stage.' },
      CANCEL,
    ];
  }
  const isPq = (category || '').toLowerCase().includes('pq');
  switch ((status || '').toLowerCase()) {
    case 'identified':
      return [
        { status: 'awaiting_approval', label: 'Submit for Internal Review', variant: 'primary', description: 'Send to the authorised person (Management) for an approve / reject decision.', defaultRemarks: 'Submitted for internal review.' },
        HOLD,
        CANCEL,
      ];
    // Approve / reject happen in the Decision panel; the request can still be withdrawn, held or cancelled.
    case 'awaiting_approval':
      return [
        { status: 'identified', label: 'Return to Identified', variant: 'secondary', description: 'Withdraw the internal-review request and send the tender back to Identified.', defaultRemarks: 'Internal review request withdrawn.' },
        HOLD,
        CANCEL,
      ];
    case 'rejected_internally':
      return [
        { status: 'awaiting_approval', label: 'Re-submit for Internal Review', variant: 'primary', description: 'Clarified; ask the authorised person to decide again (new approval round).', defaultRemarks: 'Re-submitted for internal review with clarifications.' },
        CANCEL,
      ];
    case 'under_preparation':
      return [
        isPq
          ? { status: 'pq_submitted', label: 'PQ Submitted', variant: 'primary', description: 'Pre-qualification documents submitted on the portal.', defaultRemarks: 'PQ submitted on the portal.' }
          : { status: 'submitted', label: 'Tender Submitted', variant: 'primary', description: 'Tender submitted on the portal before the submission deadline.', defaultRemarks: 'Tender submitted on the portal.' },
        HOLD,
        CANCEL,
      ];
    case 'pq_submitted':
      return [
        { status: 'pq_qualified', label: 'PQ Qualified', variant: 'success', description: 'Buyer qualified Arihant at the pre-qualification stage.', defaultRemarks: 'Arihant qualified at PQ.' },
        { ...RESULT_LOST, description: 'Not qualified at PQ: record it as Lost with reason Eligibility (PRD §26).' },
        HOLD,
        CANCEL,
      ];
    case 'pq_qualified':
      return [
        { status: 'submitted', label: 'Tender Submitted', variant: 'primary', description: 'Main tender submitted on the portal after PQ clearance.', defaultRemarks: 'Tender submitted on the portal after PQ.' },
        { status: 'under_preparation', label: 'Back to Tender Preparation', variant: 'secondary', description: 'Prepare the main tender documents after PQ clearance.', defaultRemarks: 'Preparing the main tender after PQ.' },
        HOLD,
        CANCEL,
      ];
    case 'submitted':
      return [
        { status: 'technical_eval', label: 'Technical Evaluation', variant: 'primary', description: 'Buyer opened the technical bid.', defaultRemarks: 'Technical evaluation started by the buyer.' },
        { status: 'commercial_eval', label: 'Commercial Evaluation', variant: 'secondary', description: 'Buyer opened the price bid directly.', defaultRemarks: 'Commercial evaluation started by the buyer.' },
        RESULT_WON,
        RESULT_LOST,
        HOLD,
        CANCEL,
      ];
    case 'technical_eval':
      return [
        { status: 'commercial_eval', label: 'Commercial Evaluation', variant: 'primary', description: 'Technically qualified; price bid opened.', defaultRemarks: 'Technically qualified; commercial evaluation started.' },
        { ...RESULT_LOST, description: 'Not qualified technically: record it as Lost with reason Technical (PRD §26).' },
        HOLD,
        CANCEL,
      ];
    case 'commercial_eval':
      return [RESULT_WON, RESULT_LOST, HOLD, CANCEL];
    default:
      return [];
  }
}

/**
 * A deadline instant as IST date + time. Legacy date-only deadlines were stored as UTC midnight (05:30 IST);
 * those carry no real time, so they are shown as the date alone instead of a misleading "5:30 AM".
 */
const formatDeadline = (value?: string | Date | null): string => {
  if (!value) return 'N/A';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return 'N/A';
  const isDateOnly = d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0;
  return isDateOnly ? formatTaskDate(d) : `${formatTaskDateTime(d)} IST`;
};
/** Submitted bids whose verdict can now be recorded (same stages as the pipeline's Record outcome action). */
const AWAITING_RESULT = ['submitted', 'technical_eval', 'commercial_eval'];
import { RelatedRecords } from '@/components/links/RelatedRecords';
import { GuardedLink } from '@/components/links/GuardedLink';
import { userWithRole } from '@/lib/role-label';
import { tenderCategoryLabel, bidStillOpen, BID_OPENING_STAGES } from '@/components/tender/labels';

interface TenderDossierModalProps {
  isOpen: boolean;
  onClose: () => void;
  tenderId: string | null;
  currentUser: any;
  users?: any[];
  onTenderUpdated?: () => void;
  /** Opens the page's Record outcome form for a submitted bid; omitted when the user may not record one. */
  onRecordOutcome?: (tender: any) => void;
}

export function TenderDossierModal({
  isOpen,
  onClose,
  tenderId,
  currentUser,
  users,
  onTenderUpdated,
  onRecordOutcome,
}: TenderDossierModalProps) {
  const [tender, setTender] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [userList, setUserList] = useState<any[]>(users || []);
  const [isReassignOpen, setIsReassignOpen] = useState(false);
  const [reassignSalesperson, setReassignSalesperson] = useState('');
  const [reassignOwner, setReassignOwner] = useState('');
  const [isReassigning, setIsReassigning] = useState(false);

  useEffect(() => {
    if (users && users.length > 0) {
      setUserList(users);
    } else if (isOpen) {
      api.get<any>('/users', { limit: 100 })
        .then((res) => {
          if (res?.data) setUserList(res.data);
          else if (Array.isArray(res)) setUserList(res);
        })
        .catch(() => {});
    }
  }, [users, isOpen]);

  /** True when the signed-in role is accepted by the endpoint behind an action (see ENDPOINT_ROLES). */
  const can = (endpoint: DossierEndpoint) => (ENDPOINT_ROLES[endpoint] as readonly string[]).includes(currentUser?.role);

  /**
   * A submitted bid / PQ before its closing time: evaluation and result stages stay locked (bids open after closing,
   * and the API only accepts a result dated on or after the closing day).
   */
  const awaitingBidOpening = CLOSING_GATED_STAGES.includes(tender?.status) && bidStillOpen(tender);

  const canReassign =
    can('update') &&
    (['management', 'admin', 'tender_team', 'regional_manager'].includes(currentUser?.role) ||
      tender?.tender_owner_id === currentUser?.id ||
      tender?.owner === currentUser?.id);
  const [reassignError, setReassignError] = useState<string | null>(null);

  const handleOpenReassign = () => {
    setReassignSalesperson(tender?.assigned_to || tender?.assigned_person_id || '');
    setReassignOwner(tender?.tender_owner_id || tender?.owner || '');
    setReassignError(null);
    setIsReassignOpen(true);
  };

  const handleSaveReassign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tender?.id || isReassigning) return;
    setReassignError(null);
    setIsReassigning(true);
    try {
      await api.patch(`/tenders/${tender.id}`, {
        assigned_to: reassignSalesperson || null,
        assigned_person_id: reassignSalesperson || null,
        tender_owner_id: reassignOwner || null,
        owner: reassignOwner || null,
      });
      setFeedbackMsg({ type: 'success', text: 'Tender team assignment updated successfully.' });
      setIsReassignOpen(false);
      await loadTender();
      onTenderUpdated?.();
    } catch (err: any) {
      // Shown inside the dialog (the dossier banner is hidden behind it).
      setReassignError(err?.message || 'Failed to update team assignment.');
    } finally {
      setIsReassigning(false);
    }
  };
  // Five tabs, grouped by what the user is doing with the tender (PRD §19–27).
  const [activeTab, setActiveTab] = useState<'overview' | 'transitions' | 'preparation' | 'discussion' | 'history'>('overview');

  // Lifecycle Transitions state
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [selectedNextStatus, setSelectedNextStatus] = useState<string>('');
  const [transitionNotes, setTransitionNotes] = useState<string>('');
  const [portalSubmissionDate, setPortalSubmissionDate] = useState<string>(istToday());
  const [transitionError, setTransitionError] = useState<string | null>(null);

  const handlePerformTransition = async (targetStatus: string, defaultRemarks?: string) => {
    if (!tender?.id || isTransitioning) return;
    setFeedbackMsg(null);
    setTransitionError(null);
    // PQ Submitted and Tender Submitted both record the portal submission date (saved by the API).
    if (SUBMISSION_STAGES.includes(targetStatus) && !portalSubmissionDate) {
      setTransitionError('Enter the portal submission date.');
      return;
    }
    setIsTransitioning(true);
    const remarks = transitionNotes.trim() || defaultRemarks || `Transitioned to ${targetStatus.replace(/_/g, ' ')}`;
    try {
      // On Hold is a flag over the current stage (hold / resume), not a stage of its own.
      if (targetStatus === 'on_hold') {
        await api.post(`/tenders/${tender.id}/hold`, { reason: remarks });
      } else if (targetStatus === RESUME_TARGET) {
        // ResumeTenderDto: the remarks are saved in the status-history note.
        await api.post(`/tenders/${tender.id}/resume`, { remarks });
      } else {
        await api.post(`/tenders/${tender.id}/transitions`, {
          target_status: targetStatus,
          remarks,
          submission_date: SUBMISSION_STAGES.includes(targetStatus) ? portalSubmissionDate : undefined,
        });
      }
      setFeedbackMsg({
        type: 'success',
        text:
          targetStatus === 'on_hold'
            ? 'Tender put on hold.'
            : targetStatus === RESUME_TARGET
              ? 'Tender resumed at its previous stage.'
              : `Tender moved to ${TENDER_STATUS_LABELS[targetStatus] || targetStatus.replace(/_/g, ' ')}.`,
      });
      setSelectedNextStatus('');
      setTransitionNotes('');
      await loadTender();
      onTenderUpdated?.();
    } catch (err: any) {
      // Shown inline next to the Confirm button (the server's exact reason, e.g. which documents are not Ready).
      setTransitionError(err?.message || 'Failed to transition tender stage.');
    } finally {
      setIsTransitioning(false);
    }
  };

  /**
   * Whether this role may use a lifecycle card: hold / resume, the Won / Lost result form and plain stage moves each
   * go through a different endpoint with its own @Roles.
   */
  const transitionPermitted = (tr: DossierTransition) =>
    tr.status === 'on_hold' || tr.status === RESUME_TARGET
      ? can('holdResume')
      : RESULT_TARGETS.includes(tr.status)
        ? can('result') && Boolean(onRecordOutcome)
        : can('transition');

  // Before the bid closes, evaluation and result stages cannot be used yet (bids open only after closing), so they are
  // not offered as cards; the "Bids not opened yet" note names them instead.
  const getAllowedDossierTransitions = (status: string, category: string) =>
    prdTransitions(status, category, Boolean(tender?.on_hold)).filter(
      (tr) => transitionPermitted(tr) && !(awaitingBidOpening && BID_OPENING_STAGES.includes(tr.status)),
    );
  const stagesAfterClosing = awaitingBidOpening
    ? prdTransitions(tender?.status, tender?.category, false)
        .filter((tr) => BID_OPENING_STAGES.includes(tr.status) && transitionPermitted(tr))
        .map((tr) => tr.label)
    : [];

  // Sub-action modal states
  const [isAddLineItemOpen, setIsAddLineItemOpen] = useState(false);
  const [newLineItem, setNewLineItem] = useState({
    product_description: '',
    quantity: 1,
    unit: 'Nos',
    specification_summary: '',
    quoted_unit_price: '',
    is_compliant: 'Not Checked',
  });

  const [lineItemError, setLineItemError] = useState<string | null>(null);
  const [lineItemToDelete, setLineItemToDelete] = useState<any | null>(null);

  const [isCorrigendumOpen, setIsCorrigendumOpen] = useState(false);
  const [newCorrigendum, setNewCorrigendum] = useState({
    corrigendum_number: '',
    new_deadline: '',
    summary: '',
  });
  const [corrigendumError, setCorrigendumError] = useState<string | null>(null);

  const [isInstrumentOpen, setIsInstrumentOpen] = useState(false);
  const [newInstrument, setNewInstrument] = useState({
    instrument_type: 'EMD',
    amount: '',
    mode: 'DD',
    bank: '',
    reference_number: '',
    status: 'Requested',
  });
  const [instrumentError, setInstrumentError] = useState<string | null>(null);

  const [isCommentSubmitting, setIsCommentSubmitting] = useState(false);
  const [commentText, setCommentText] = useState('');

  // Document checklist enhancement state
  const [attachingDocId, setAttachingDocId] = useState<string | null>(null);
  const [attachedFileName, setAttachedFileName] = useState<string>('');
  const [attachedDriveUrl, setAttachedDriveUrl] = useState<string>('');
  const [driveFolderUrl, setDriveFolderUrl] = useState<string>('');
  const [isEditingDriveFolder, setIsEditingDriveFolder] = useState<boolean>(false);
  const [isSavingDriveFolder, setIsSavingDriveFolder] = useState<boolean>(false);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [driveFolderError, setDriveFolderError] = useState<string | null>(null);
  const [isAddCustomDocOpen, setIsAddCustomDocOpen] = useState(false);
  const [newCustomDoc, setNewCustomDoc] = useState({
    document_type: '',
    is_mandatory: true,
    owner_id: '',
    status: 'In Progress',
    file_url: '',
  });
  const [customDocError, setCustomDocError] = useState<string | null>(null);
  const [customDocUrlError, setCustomDocUrlError] = useState<string | null>(null);
  const [isAddingCustomDoc, setIsAddingCustomDoc] = useState(false);

  // PQ → General linked tender dialog (CreateLinkedTenderDto: number, title, IST submission deadline)
  const [isLinkedTenderOpen, setIsLinkedTenderOpen] = useState(false);
  const [linkedTenderForm, setLinkedTenderForm] = useState({ tender_number: '', tender_title: '', submission_deadline: '' });
  const [linkedTenderError, setLinkedTenderError] = useState<string | null>(null);
  const [isCreatingLinkedTender, setIsCreatingLinkedTender] = useState(false);

  // Won → Sales Order: the PO / LoA reference is asked for only when the recorded result carries none
  const [isSalesOrderOpen, setIsSalesOrderOpen] = useState(false);
  const [salesOrderRef, setSalesOrderRef] = useState('');
  const [salesOrderError, setSalesOrderError] = useState<string | null>(null);
  const [isCreatingSalesOrder, setIsCreatingSalesOrder] = useState(false);
  const [salesOrderCreated, setSalesOrderCreated] = useState(false);
  const salesOrderInFlight = useRef(false);

  const [actionLoading, setActionLoading] = useState(false);
  const [linkedRefresh, setLinkedRefresh] = useState(0); // reloads the linked-records panel after a sales order
  const [feedbackMsg, setFeedbackMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  /** The tender currently open in the dossier: a slower response for a previously opened tender is ignored. */
  const openTenderId = useRef<string | null>(null);

  // Executive Decision state on Overview Tab
  const [decisionType, setDecisionType] = useState<'approved' | 'rejected'>('approved');
  const [directivesRemarks, setDirectivesRemarks] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');
  const [isSubmittingDecision, setIsSubmittingDecision] = useState(false);
  const [decisionError, setDecisionError] = useState<string | null>(null);

  const isMgmtOrAdmin = currentUser?.role === 'management' || currentUser?.role === 'admin';

  const handleCommitExecutiveDecision = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!tenderId) return;
    setDecisionError(null);

    if (decisionType === 'rejected' && !rejectionReason.trim()) {
      setDecisionError('A valid rejection reason is mandatory when declining participation.');
      return;
    }

    if (!directivesRemarks.trim()) {
      setDecisionError('Directives / Remarks are mandatory for management sign-off.');
      return;
    }

    setIsSubmittingDecision(true);
    try {
      await api.post(`/tenders/${tenderId}/approve`, {
        decision: decisionType,
        remarks: directivesRemarks.trim(),
        rejection_reason: decisionType === 'rejected' ? rejectionReason : undefined,
      });

      setFeedbackMsg({
        type: 'success',
        text:
          decisionType === 'approved'
            ? 'Participation approved & mobilized for preparation!'
            : 'Participation declined & internally rejected.',
      });
      setDirectivesRemarks('');
      setRejectionReason('');
      await loadTender();
      if (onTenderUpdated) onTenderUpdated();
    } catch (err: any) {
      setDecisionError(err?.message || 'Failed to submit decision.');
    } finally {
      setIsSubmittingDecision(false);
    }
  };

  /**
   * The dossier stays mounted between tenders, so everything typed or opened for one tender is cleared before the
   * next one shows: a note, a pending hold confirm or a half-filled dialog must never be applied to another tender.
   */
  const resetPerTenderState = () => {
    setTender(null);
    setFeedbackMsg(null);
    setActionLoading(false);
    // Each tender opens on Overview, not on the tab left open for the previous one.
    setActiveTab('overview');
    // Lifecycle
    setSelectedNextStatus('');
    setTransitionNotes('');
    setTransitionError(null);
    setPortalSubmissionDate(istToday());
    // Decision
    setDecisionType('approved');
    setDirectivesRemarks('');
    setRejectionReason('');
    setDecisionError(null);
    // Team
    setIsReassignOpen(false);
    setReassignSalesperson('');
    setReassignOwner('');
    setReassignError(null);
    // BOQ
    setIsAddLineItemOpen(false);
    setNewLineItem({ product_description: '', quantity: 1, unit: 'Nos', specification_summary: '', quoted_unit_price: '', is_compliant: 'Not Checked' });
    setLineItemError(null);
    setLineItemToDelete(null);
    // Corrigendum
    setIsCorrigendumOpen(false);
    setNewCorrigendum({ corrigendum_number: '', new_deadline: '', summary: '' });
    setCorrigendumError(null);
    // EMD / PBG
    setIsInstrumentOpen(false);
    setNewInstrument({ instrument_type: 'EMD', amount: '', mode: 'DD', bank: '', reference_number: '', status: 'Requested' });
    setInstrumentError(null);
    // Discussion
    setCommentText('');
    // Documents & Drive folder
    setAttachingDocId(null);
    setAttachedFileName('');
    setAttachedDriveUrl('');
    setAttachError(null);
    setDriveFolderUrl('');
    setDriveFolderError(null);
    setIsEditingDriveFolder(false);
    setIsAddCustomDocOpen(false);
    setNewCustomDoc({ document_type: '', is_mandatory: true, owner_id: '', status: 'In Progress', file_url: '' });
    setCustomDocError(null);
    setCustomDocUrlError(null);
    // Linked tender & sales order
    setIsLinkedTenderOpen(false);
    setLinkedTenderForm({ tender_number: '', tender_title: '', submission_deadline: '' });
    setLinkedTenderError(null);
    setIsSalesOrderOpen(false);
    setSalesOrderRef('');
    setSalesOrderError(null);
    setSalesOrderCreated(false);
  };

  useEffect(() => {
    openTenderId.current = isOpen && tenderId ? tenderId : null;
    resetPerTenderState();
    if (openTenderId.current) {
      loadTender();
    } else {
      setLoading(false);
    }
  }, [isOpen, tenderId]);

  /** Loads the tender open right now (never a previously open one, even from a slow handler of the old tender). */
  const loadTender = async () => {
    const requestedId = openTenderId.current;
    if (!requestedId) return;
    setLoading(true);
    try {
      const res = await api.get<any>(`/tenders/${requestedId}`);
      if (openTenderId.current !== requestedId) return; // another tender was opened meanwhile
      setTender(res);
      setDriveFolderUrl(res?.tender_url || '');
    } catch (err: any) {
      if (openTenderId.current !== requestedId) return;
      setFeedbackMsg({ type: 'error', text: err?.message || 'Failed to load tender specifications' });
    } finally {
      if (openTenderId.current === requestedId) setLoading(false);
    }
  };

  const handleAddLineItem = async () => {
    if (!tenderId) return;
    setLineItemError(null);
    // Same rules as the API: a description, quantity ≥ 1 and a non-negative unit price.
    const qty = Number(newLineItem.quantity);
    const price = newLineItem.quoted_unit_price === '' ? null : Number(newLineItem.quoted_unit_price);
    if (!newLineItem.product_description.trim()) {
      setLineItemError('Product description is required.');
      return;
    }
    if (!Number.isFinite(qty) || qty < 1) {
      setLineItemError('Quantity must be at least 1.');
      return;
    }
    if (price !== null && (!Number.isFinite(price) || price < 0)) {
      setLineItemError('Quoted unit price cannot be negative.');
      return;
    }
    setActionLoading(true);
    try {
      await api.post(`/tenders/${tenderId}/line-items`, {
        ...newLineItem,
        product_description: newLineItem.product_description.trim(),
        quantity: qty,
        quoted_unit_price: price ?? undefined,
      });
      setIsAddLineItemOpen(false);
      setNewLineItem({
        product_description: '',
        quantity: 1,
        unit: 'Nos',
        specification_summary: '',
        quoted_unit_price: '',
        is_compliant: 'Not Checked',
      });
      await loadTender();
      onTenderUpdated?.();
      setFeedbackMsg({ type: 'success', text: 'Product line item added successfully' });
    } catch (err: any) {
      // Shown inside the dialog (the dossier banner is hidden behind it).
      setLineItemError(err?.message || 'Failed to add line item');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteLineItem = async () => {
    if (!tenderId || !lineItemToDelete) return;
    setActionLoading(true);
    try {
      await api.delete(`/tenders/${tenderId}/line-items/${lineItemToDelete.id}`);
      setLineItemToDelete(null);
      await loadTender();
      onTenderUpdated?.();
      setFeedbackMsg({ type: 'success', text: 'Line item removed.' });
    } catch (err: any) {
      setLineItemToDelete(null);
      setFeedbackMsg({ type: 'error', text: err?.message || 'Failed to remove line item' });
    } finally {
      setActionLoading(false);
    }
  };

  const handleInitChecklist = async () => {
    if (!tenderId || actionLoading) return;
    setActionLoading(true);
    try {
      await api.post(`/tenders/${tenderId}/documents/init-checklist`, {});
      await loadTender();
      onTenderUpdated?.();
      setFeedbackMsg({ type: 'success', text: 'Standard category document checklist initialized' });
    } catch (err: any) {
      setFeedbackMsg({ type: 'error', text: err?.message || 'Failed to initialize checklist' });
    } finally {
      setActionLoading(false);
    }
  };

  const handleUpdateDocStatus = async (docId: string, status: string) => {
    if (!tenderId) return;
    try {
      await api.patch(`/tenders/${tenderId}/documents/${docId}`, { status });
      await loadTender();
      onTenderUpdated?.();
      setFeedbackMsg({ type: 'success', text: `Document status updated to "${status}".` });
    } catch (err: any) {
      setFeedbackMsg({ type: 'error', text: err?.message || 'Failed to update document status' });
    }
  };

  const handleUpdateDocOwner = async (docId: string, ownerId: string) => {
    if (!tenderId) return;
    try {
      await api.patch(`/tenders/${tenderId}/documents/${docId}`, { owner_id: ownerId || null });
      await loadTender();
      onTenderUpdated?.();
      setFeedbackMsg({ type: 'success', text: 'Document owner assigned successfully.' });
    } catch (err: any) {
      setFeedbackMsg({ type: 'error', text: err?.message || 'Failed to assign document owner' });
    }
  };

  const handleSaveDriveFolder = async (overrideUrl?: string) => {
    if (!tenderId || isSavingDriveFolder) return;
    const urlToSave = (overrideUrl !== undefined ? overrideUrl : driveFolderUrl).trim();
    // Only http(s) links are stored: the folder is rendered as a clickable link.
    const urlError = validateHttpUrl(urlToSave, 'Drive folder link');
    setDriveFolderError(urlError);
    if (urlError) return;
    setIsSavingDriveFolder(true);
    try {
      await api.patch(`/tenders/${tenderId}`, {
        tender_url: urlToSave || null,
      });
      await loadTender();
      onTenderUpdated?.();
      setIsEditingDriveFolder(false);
      setFeedbackMsg({
        type: 'success',
        text: urlToSave
          ? 'Tender Google Drive Workspace linked successfully.'
          : 'Tender Google Drive Workspace link cleared.',
      });
    } catch (err: any) {
      setDriveFolderError(err?.message || 'Failed to update Google Drive folder link');
    } finally {
      setIsSavingDriveFolder(false);
    }
  };

  const closeAttachPanel = () => {
    setAttachingDocId(null);
    setAttachedFileName('');
    setAttachedDriveUrl('');
    setAttachError(null);
  };

  const handleAttachFile = async (docId: string) => {
    if (!tenderId || actionLoading) return;
    const finalUrl = attachedDriveUrl.trim();
    const finalName = attachedFileName.trim() || (finalUrl ? 'Google Drive Document' : '');
    if (!finalName && !finalUrl) return;
    const urlError = validateHttpUrl(finalUrl, 'Document link');
    setAttachError(urlError);
    if (urlError) return;

    setActionLoading(true);
    try {
      await api.patch(`/tenders/${tenderId}/documents/${docId}`, {
        file_name: finalName || 'Drive Document.pdf',
        file_url: finalUrl || undefined,
        status: 'Ready',
      });
      closeAttachPanel();
      await loadTender();
      onTenderUpdated?.();
      setFeedbackMsg({
        type: 'success',
        text: `Document "${finalName}" linked successfully and marked Ready.`,
      });
    } catch (err: any) {
      // Shown in the attach panel next to the row being edited.
      setAttachError(err?.message || 'Failed to attach file');
    } finally {
      setActionLoading(false);
    }
  };

  const handleRemoveFile = async (docId: string) => {
    if (!tenderId) return;
    try {
      await api.patch(`/tenders/${tenderId}/documents/${docId}`, {
        file_name: null as any,
        file_url: null as any,
        status: 'In Progress',
      });
      await loadTender();
      onTenderUpdated?.();
      setFeedbackMsg({ type: 'success', text: 'Document attachment removed.' });
    } catch (err: any) {
      setFeedbackMsg({ type: 'error', text: err?.message || 'Failed to remove attachment' });
    }
  };

  const openAddCustomDoc = () => {
    setCustomDocError(null);
    setCustomDocUrlError(null);
    setIsAddCustomDocOpen(true);
  };

  const handleAddCustomDoc = async (e: React.FormEvent) => {
    e.preventDefault();
    // Guarded against double submit: a second click while saving would add the same document twice.
    if (!tenderId || isAddingCustomDoc || !newCustomDoc.document_type.trim()) return;
    setCustomDocError(null);
    const urlError = validateHttpUrl(newCustomDoc.file_url, 'File link');
    setCustomDocUrlError(urlError);
    if (urlError) return;
    setIsAddingCustomDoc(true);
    try {
      const hasUrl = Boolean(newCustomDoc.file_url?.trim());
      await api.post(`/tenders/${tenderId}/documents`, {
        document_type: newCustomDoc.document_type.trim(),
        is_mandatory: newCustomDoc.is_mandatory,
        owner_id: newCustomDoc.owner_id || currentUser?.id || undefined,
        status: hasUrl ? 'Ready' : newCustomDoc.status,
        file_url: hasUrl ? newCustomDoc.file_url.trim() : undefined,
        file_name: hasUrl ? `${newCustomDoc.document_type.trim().replace(/[^a-zA-Z0-9]/g, '_')}.pdf` : undefined,
      });
      setIsAddCustomDocOpen(false);
      setNewCustomDoc({ document_type: '', is_mandatory: true, owner_id: '', status: 'In Progress', file_url: '' });
      await loadTender();
      onTenderUpdated?.();
      setFeedbackMsg({ type: 'success', text: 'Custom compliance document added to checklist.' });
    } catch (err: any) {
      // Shown inside the dialog (the dossier banner is hidden behind it).
      setCustomDocError(err?.message || 'Failed to add document');
    } finally {
      setIsAddingCustomDoc(false);
    }
  };

  const handleAddCorrigendum = async () => {
    if (!tenderId) return;
    setCorrigendumError(null);
    // The box holds IST wall-clock time; send it as an IST instant so the deadline shown is the time entered.
    const newDeadlineIso = fromIstLocalInput(newCorrigendum.new_deadline);
    if (!newCorrigendum.corrigendum_number.trim() || !newDeadlineIso) {
      setCorrigendumError('Corrigendum number and the new deadline (date and time, IST) are required.');
      return;
    }
    setActionLoading(true);
    try {
      await api.post(`/tenders/${tenderId}/corrigenda`, { ...newCorrigendum, new_deadline: newDeadlineIso });
      setIsCorrigendumOpen(false);
      setNewCorrigendum({ corrigendum_number: '', new_deadline: '', summary: '' });
      await loadTender();
      onTenderUpdated?.();
      setFeedbackMsg({ type: 'success', text: 'Corrigendum recorded and deadline updated' });
    } catch (err: any) {
      setCorrigendumError(err?.message || 'Failed to record corrigendum');
    } finally {
      setActionLoading(false);
    }
  };

  const handleAddInstrument = async () => {
    if (!tenderId) return;
    setInstrumentError(null);
    const amount = Number(newInstrument.amount);
    if (!newInstrument.amount || !Number.isFinite(amount) || amount <= 0) {
      setInstrumentError('Amount must be greater than zero.');
      return;
    }
    setActionLoading(true);
    try {
      await api.post(`/tenders/${tenderId}/financial-instruments`, {
        ...newInstrument,
        amount,
      });
      setIsInstrumentOpen(false);
      setNewInstrument({
        instrument_type: 'EMD',
        amount: '',
        mode: 'DD',
        bank: '',
        reference_number: '',
        status: 'Requested',
      });
      await loadTender();
      onTenderUpdated?.();
      setFeedbackMsg({
        type: 'success',
        text: 'Financial instrument request registered — it now appears in the Finance & EMD / PBG repository.',
      });
    } catch (err: any) {
      setInstrumentError(err?.message || 'Failed to request financial instrument');
    } finally {
      setActionLoading(false);
    }
  };

  const handlePostComment = async () => {
    if (!tenderId || isCommentSubmitting || !commentText.trim()) return;
    setIsCommentSubmitting(true);
    try {
      await api.post(`/tenders/${tenderId}/comments`, {
        body: commentText.trim(),
        is_internal: true,
      });
      setCommentText('');
      await loadTender();
    } catch (err: any) {
      setFeedbackMsg({ type: 'error', text: err?.message || 'Failed to post note' });
    } finally {
      setIsCommentSubmitting(false);
    }
  };

  const openLinkedTenderDialog = () => {
    if (!tender) return;
    setLinkedTenderError(null);
    setLinkedTenderForm({
      tender_number: `${tender.tender_number || tender.tender_no || ''}-GEN`,
      tender_title: `${tender.tender_title || 'Tender'} (Main General Bid)`,
      submission_deadline: '',
    });
    setIsLinkedTenderOpen(true);
  };

  const handleCreateLinkedTender = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!tenderId || !tender || isCreatingLinkedTender) return;
    setLinkedTenderError(null);
    const tenderNumber = linkedTenderForm.tender_number.trim();
    const tenderTitle = linkedTenderForm.tender_title.trim();
    // The box holds IST wall-clock time; it is sent as the matching ISO instant.
    const deadlineIso = fromIstLocalInput(linkedTenderForm.submission_deadline);
    if (!tenderNumber || !tenderTitle || !deadlineIso) {
      setLinkedTenderError('Tender number, title and the submission deadline (date and time, IST) are required.');
      return;
    }
    if (new Date(deadlineIso).getTime() <= Date.now()) {
      setLinkedTenderError('The submission deadline must be in the future.');
      return;
    }
    setIsCreatingLinkedTender(true);
    try {
      const res = await api.post<any>(`/tenders/${tenderId}/create-linked-tender`, {
        tender_number: tenderNumber,
        tender_title: tenderTitle,
        submission_deadline: deadlineIso,
      });
      setIsLinkedTenderOpen(false);
      setFeedbackMsg({
        type: 'success',
        text: `General Bid created successfully: Ref ${res?.internal_ref || res?.tender_number || tenderNumber}`,
      });
      await loadTender();
      onTenderUpdated?.();
    } catch (err: any) {
      setLinkedTenderError(err?.message || 'Failed to generate linked General tender');
    } finally {
      setIsCreatingLinkedTender(false);
    }
  };

  /** PO / LoA reference recorded with the award (never invented): the Sales Order carries it as order_reference. */
  const awardOrderRef: string =
    String(tender?.tender_result?.po_number || tender?.tender_result?.order_number || tender?.tender_result?.loa_number || '').trim();
  /** A Sales Order already raised from this tender (logged on its timeline) — a second one would be refused (409). */
  const hasSalesOrder =
    salesOrderCreated || (tender?.activities || []).some((a: any) => String(a?.event_type || '').toUpperCase() === 'SALES_ORDER_CREATED');

  const handleCreateSalesOrder = async (orderRef: string) => {
    const ref = orderRef.trim();
    if (!tenderId || !tender || !ref || salesOrderInFlight.current) return;
    salesOrderInFlight.current = true;
    setIsCreatingSalesOrder(true);
    setSalesOrderError(null);
    try {
      const res = await api.post<any>(`/tenders/${tenderId}/create-sales-order`, { order_number: ref });
      setSalesOrderCreated(true);
      setIsSalesOrderOpen(false);
      setFeedbackMsg({
        type: 'success',
        text: `Sales Order registered in Deliveries pipeline: Ref ${res?.sales_order?.delivery_no || res?.order_number || ref}`,
      });
      setLinkedRefresh((n) => n + 1);
      await loadTender();
      onTenderUpdated?.();
    } catch (err: any) {
      // 409 = a Sales Order with this PO / LoA reference already exists; the server message names it. Shown in the
      // dialog when it is open, otherwise under the Create Sales Order button.
      setSalesOrderError(err?.message || 'Failed to create sales order');
    } finally {
      salesOrderInFlight.current = false;
      setIsCreatingSalesOrder(false);
    }
  };

  const startSalesOrder = () => {
    setFeedbackMsg(null);
    if (awardOrderRef) {
      handleCreateSalesOrder(awardOrderRef);
      return;
    }
    // No PO / LoA on the recorded result: ask for it (required).
    setSalesOrderRef('');
    setSalesOrderError(null);
    setIsSalesOrderOpen(true);
  };

  // Submission readiness from the server (mandatory checklist items Ready). No checklist = not ready, never 100%.
  const docReadiness: DocumentReadiness | undefined = tender?.document_readiness;
  const docsSubmissionReady = Boolean(docReadiness?.checklist_created && docReadiness?.all_mandatory_ready);
  // The server's required set = category template's mandatory items ∪ the tender's mandatory rows, so a template item
  // missing from the checklist counts as not Ready; Initialise Checklist adds those rows.
  const checklistTypes = new Set<string>((tender?.documents || []).map((d: any) => String(d?.document_type || '').trim()));
  const templateDocsNotOnChecklist = (docReadiness?.missing || []).filter((type) => !checklistTypes.has(String(type).trim()));
  const needsChecklistInit = Boolean(docReadiness) && (!docReadiness?.checklist_created || templateDocsNotOnChecklist.length > 0);
  const readinessSummary = docReadiness
    ? `${docReadiness.mandatory_ready} of ${docReadiness.mandatory_total} mandatory Ready (${docReadiness.percentage}%)${
        docReadiness.checklist_created ? '' : ' · checklist not initialised'
      }`
    : 'Checklist not initialised';
  const boqLocked = CLOSED_STAGES.includes((tender?.status || '').toLowerCase());
  // Same roles as DELETE /tenders/:id/line-items/:itemId (sales only on their own tenders — enforced by the API).
  const canDeleteLineItems = !boqLocked && can('lineItems');
  const canEditDocuments = can('documents');
  // Internal review (PRD §22): the decision form while it is pending, otherwise the latest decided round.
  const decisionPending = ['identified', 'awaiting_approval', 'awaiting_internal_approval'].includes((tender?.status || '').toLowerCase());
  const latestDecision: any = (tender?.approvals || []).find((a: any) =>
    ['APPROVED', 'REJECTED'].includes(String(a?.status || '').toUpperCase()),
  );
  const latestDecisionRejected = String(latestDecision?.status || '').toUpperCase() === 'REJECTED';
  // Lifecycle cards: every move the stage allows, and the ones this role may use right now.
  const inInternalReview = ['awaiting_approval', 'under_review'].includes(tender?.status);
  const lifecycleStageMoves = tender ? prdTransitions(tender.status, tender.category, Boolean(tender.on_hold)) : [];
  const lifecycleMoves = tender ? getAllowedDossierTransitions(tender.status, tender.category) : [];
  // Five tabs grouped by what the user is doing (PRD §19–27): Overview (details, decision, links), Lifecycle (stages,
  // deadline & corrigenda, result), Preparation (documents, BOQ, EMD / PBG), Discussion (comments, portal issues), History.
  const visibleTabs = (t: any) => {
    const readiness = t?.document_readiness;
    const openIssues = (t?.portal_issues || []).filter((i: any) => !['RESOLVED', 'CLOSED'].includes(String(i.status || '').toUpperCase())).length;
    return [
      { id: 'overview', label: 'Overview', icon: <FileText className="h-3.5 w-3.5" /> },
      { id: 'transitions', label: 'Lifecycle', icon: <ArrowRight className="h-3.5 w-3.5" /> },
      {
        id: 'preparation',
        label: 'Preparation',
        icon: <Paperclip className="h-3.5 w-3.5" />,
        count: readiness?.checklist_created ? `${readiness?.percentage ?? t?.document_completion_percentage ?? 0}%` : undefined,
        tone: readiness?.checklist_created && readiness?.all_mandatory_ready ? 'done' : 'neutral',
      },
      {
        id: 'discussion',
        label: 'Discussion',
        icon: <MessageSquare className="h-3.5 w-3.5" />,
        count: (t?.comments?.length || 0) + openIssues || undefined,
        tone: openIssues > 0 ? 'alert' : 'neutral',
      },
      { id: 'history', label: 'History', icon: <Calendar className="h-3.5 w-3.5" /> },
    ] as { id: typeof activeTab; label: string; icon: React.ReactNode; count?: number | string; tone?: 'neutral' | 'done' | 'alert' }[];
  };
  const openAddLineItem = () => {
    setLineItemError(null);
    setIsAddLineItemOpen(true);
  };

  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={tender?.tender_title || tender?.tender_number || 'Tender Dossier & Lifecycle'}
      // The reference and bid number sit in the dark header strip below; the subtitle only names the buyer and portal.
      description={[tender?.organisation_name || tender?.organisation || 'Government buyer', tender?.portal || 'GeM'].join(' · ')}
      maxWidth="4xl"
    >
      {loading ? (
        <div className="py-20 flex flex-col items-center justify-center space-y-3">
          <Spinner size="md" />
          <p className="text-sm font-medium text-[#4A5568]">Loading comprehensive tender dossier...</p>
        </div>
      ) : tender ? (
        <div className="space-y-5 text-xs text-[#14213D]">
          {/* Feedback alerts */}
          {feedbackMsg && (
            <InfoCallout
              variant={feedbackMsg.type === 'success' ? 'success' : 'danger'}
              title={feedbackMsg.type === 'success' ? 'Action Completed' : 'Operation Alert'}
              onClose={() => setFeedbackMsg(null)}
            >
              {feedbackMsg.text}
            </InfoCallout>
          )}

          {/* Dossier Header Strip */}
          <div className="p-3 sm:p-4 rounded-xl bg-gradient-to-r from-[#14213D] to-[#1F2E52] text-white flex flex-wrap items-center justify-between gap-3 sm:gap-4 shadow-sm">
            <div className="min-w-0 space-y-1">
              {/* wraps on phones instead of squeezing the ref onto three lines and pushing chips off the card */}
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="whitespace-nowrap font-mono text-sm font-bold text-[#F2B872]">
                  {tender.internal_ref || 'TND-2026-00000'}
                </span>
                <span className="text-white/40">•</span>
                <span className="break-all font-semibold text-white/90">{tender.tender_number || tender.tender_no}</span>
                <Badge
                  variant={
                    String(tender.category || '').toLowerCase() === 'pq'
                      ? 'cyber'
                      : String(tender.category || '').toLowerCase() === 'mha'
                        ? 'warning'
                        : 'default'
                  }
                  size="sm"
                >
                  {tenderCategoryLabel(tender.category_code || tender.category, tender.category_name) || 'General'}
                </Badge>
                <Badge
                  variant={
                    tender.priority === 'High' ? 'danger' : tender.priority === 'Low' ? 'default' : 'warning'
                  }
                  size="sm"
                >
                  {tender.priority || 'Medium'} Priority
                </Badge>
              </div>
              {/* the dialog title already names the tender; on phones the strip keeps only the ref, chips and stage */}
              <p className="hidden text-xs text-white/70 line-clamp-1 sm:block">{tender.tender_title || tender.requirement_text || 'Standard Tender Supply Specification'}</p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {/* only an http(s) link is clickable; anything else is shown as text on the Overview tab */}
              {safeHttpUrl(tender.tender_url) && (
                <a
                  href={safeHttpUrl(tender.tender_url) as string}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-[#F2B872] border border-white/20 text-xs font-semibold transition-colors shadow-xs"
                  title={`Open Google Drive Workspace: ${tender.tender_url}`}
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  <span>Drive Workspace ↗</span>
                </a>
              )}
              <div className="sm:text-right">
                <span className="text-[10px] text-white/60 block uppercase font-bold tracking-wider">Current Stage</span>
                <Badge
                  variant={
                    tender.status === 'won' || tender.status === 'WON'
                      ? 'success'
                      : ['lost', 'LOST', 'cancelled', 'CANCELLED'].includes(tender.status)
                      ? 'danger'
                      : 'info'
                  }
                  size="md"
                >
                  {(tender.status || 'IDENTIFIED').replace(/_/g, ' ').toUpperCase()}
                </Badge>
              </div>

              {/* live countdown only while the bid is still to be submitted; closed tenders show "Closed" */}
              {CLOSED_STAGES.includes((tender.status || '').toLowerCase()) ? (
                <div className="p-2 rounded-lg bg-white/10 text-center min-w-[70px] border border-white/15">
                  <span className="text-[10px] text-white/70 block uppercase font-bold">Deadline</span>
                  <span className="font-mono text-xs font-bold text-white/80">Closed</span>
                </div>
              ) : PRE_SUBMISSION_STAGES.includes((tender.status || '').toLowerCase()) &&
                tender.days_left !== null &&
                tender.days_left !== undefined && (
                <div className="p-2 rounded-lg bg-white/10 text-center min-w-[70px] border border-white/15">
                  <span className="text-[10px] text-white/70 block uppercase font-bold">Deadline</span>
                  <span
                    className={`font-mono text-xs font-bold ${
                      tender.days_left <= 2 ? 'text-[#F3C7CF] animate-pulse' : 'text-[#F2B872]'
                    }`}
                  >
                    {tender.days_left < 0 ? 'Overdue' : `${tender.days_left}d left`}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Dossier tabs: segmented control, pinned under the dialog header so the sections stay reachable while a
              long tab scrolls (phones especially) */}
          <ScrollStrip
            role="tablist"
            aria-label="Dossier sections"
            activeKey={activeTab}
            wrapperClassName="sticky -top-4 z-10 -mx-4 bg-[var(--th-pop,#FBFAF7)] px-4 py-2 sm:-top-5 sm:-mx-5 sm:px-5"
            className="gap-1 rounded-[10px] border border-[#DCD8CE] bg-white p-1 select-none"
          >
            {visibleTabs(tender).map((tab) => {
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-[8px] px-3.5 py-1.5 text-xs transition-all duration-150 cursor-pointer ${
                    active
                      ? 'bg-[#E3EFEE] font-semibold text-[#0F5E63] shadow-xs'
                      : 'font-medium text-[#4A5568] hover:bg-[#F6F5F1] hover:text-[#14213D]'
                  }`}
                >
                  <span className="shrink-0">{tab.icon}</span>
                  <span>{tab.label}</span>
                  {tab.count !== undefined && (
                    <span
                      className={`rounded-full px-1.5 py-px font-mono text-[10px] leading-4 ${
                        tab.tone === 'alert'
                          ? 'bg-[#FBEBDD] text-[#9A3412]'
                          : tab.tone === 'done'
                            ? 'bg-[#0F5E63] text-white'
                            : 'bg-[#ECE9E2] text-[#4A5568]'
                      }`}
                    >
                      {tab.count}
                    </span>
                  )}
                </button>
              );
            })}
          </ScrollStrip>

          {/* TAB 1: OVERVIEW */}
          {activeTab === 'overview' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <Card className="p-3.5 space-y-2 border-[#DCD8CE]">
                  <span className="text-[10px] font-bold text-[#4A5568] uppercase block">Authority & Location</span>
                  <div className="space-y-1">
                    {tender.organisation_id ? (
                      <GuardedLink href={`/leads?customer=${tender.organisation_id}`} className="font-semibold text-xs text-[#0F5E63] hover:underline block" title="Open Customer 360">
                        {tender.organisation_name || tender.organisation}
                      </GuardedLink>
                    ) : (
                      <p className="font-semibold text-xs text-[#14213D]">{tender.organisation_name || tender.organisation}</p>
                    )}
                    <p className="text-[11px] text-[#4A5568]">{tender.department || 'General Administration'}</p>
                    <p className="text-[11px] text-[#4A5568]">
                      {tender.city || 'Delhi'}, {tender.state || 'Delhi'} • Region: {tender.region_name || 'North'}
                    </p>
                    {tender.tender_url && (
                      <p className="text-[11px] text-[#4A5568] flex items-center gap-1 min-w-0">
                        Drive Workspace:{' '}
                        {safeHttpUrl(tender.tender_url) ? (
                          <a
                            href={safeHttpUrl(tender.tender_url) as string}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-semibold text-[#0F5E63] hover:underline inline-flex items-center gap-0.5"
                          >
                            <span>Open Folder</span>
                            <ExternalLink className="w-2.5 h-2.5" />
                          </a>
                        ) : (
                          // not an http(s) link: shown as text, never as a clickable href
                          <span className="break-all font-mono text-[#14213D]" title="Not a web link">
                            {tender.tender_url}
                          </span>
                        )}
                      </p>
                    )}
                  </div>
                </Card>

                <Card className="p-3.5 space-y-2 border-[#DCD8CE]">
                  <span className="text-[10px] font-bold text-[#4A5568] uppercase block">Key Milestones</span>
                  <div className="space-y-1 font-mono text-[11px]">
                    <p className="text-[#4A5568]">
                      Published: <span className="font-bold text-[#14213D]">{tender.publication_date ? formatTaskDate(tender.publication_date) : 'N/A'}</span>
                    </p>
                    <p className="text-[#4A5568]">
                      Deadline:{' '}
                      <span className="font-bold text-[#9A3412]">
                        {formatDeadline(tender.submission_deadline)}
                      </span>
                    </p>
                    {tender.pre_bid_meeting_date && (
                      <p className="text-[#4A5568]">
                        Pre-Bid: <span className="font-medium text-[#14213D]">{formatTaskDateTime(tender.pre_bid_meeting_date)} IST</span>
                      </p>
                    )}
                  </div>
                </Card>

                <Card className="p-3.5 space-y-2 border-[#DCD8CE]">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-[#4A5568] uppercase block">Financials & Team</span>
                    <div className="flex items-center gap-3">
                      {canReassign && (
                        <button
                          type="button"
                          onClick={handleOpenReassign}
                          className="text-[11px] font-semibold text-[#0F5E63] hover:underline flex items-center gap-1 cursor-pointer"
                        >
                          <UserCheck className="w-3.5 h-3.5" />
                          Reassign Team
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[11px] text-[#4A5568]">
                      Est. Value:{' '}
                      <span className="font-bold font-mono text-[#0F5E63]">
                        {tender.estimated_value ? `₹ ${(tender.estimated_value / 100000).toFixed(2)} Lakh` : 'Not Specified'}
                      </span>
                    </p>
                    <p className="text-[11px] text-[#4A5568]">
                      EMD:{' '}
                      <span className="font-medium font-mono text-[#14213D]">
                        {tender.emd_required ? `₹ ${tender.emd_amount || 0} (${tender.emd_mode})` : 'Exempted / Nil'}
                      </span>
                    </p>
                    <p className="text-[11px] text-[#4A5568]">
                      Tender Owner:{' '}
                      <span className="font-semibold text-[#14213D]">{tender.tender_owner_name || 'Unassigned'}</span>
                    </p>
                    <p className="text-[11px] text-[#4A5568]">
                      Assigned Salesperson:{' '}
                      <span className="font-semibold text-[#14213D]">{tender.assigned_to_name || 'Unassigned'}</span>
                    </p>
                  </div>
                </Card>
              </div>

              {tender.remarks && (
                <div className="p-3 rounded-lg bg-[#FBFAF7] border border-[#ECE9E2]">
                  <span className="text-[10px] font-bold text-[#4A5568] uppercase block mb-1">Operational Remarks</span>
                  <p className="text-xs text-[#14213D]">{tender.remarks}</p>
                </div>
              )}

              {/* Executive Decision & Management Review Card (§22, §23) */}
              <Card className="p-4 sm:p-5 border-[#DCD8CE] bg-white rounded-[14px] shadow-xs space-y-4">
                <div className="flex items-center justify-between border-b border-[#ECE9E2] pb-3">
                  <div className="space-y-0.5">
                    <h4 className="font-serif font-bold text-sm text-[#14213D] flex items-center gap-2">
                      <ShieldCheck className="w-4 h-4 text-[#0F5E63]" />
                      Decision
                    </h4>
                    <p className="text-[11px] text-[#4A5568]">
                      Executive management participation review and authorization for bid preparation.
                    </p>
                  </div>
                  <Badge
                    variant={
                      ['under_preparation', 'submitted', 'won'].includes((tender.status || '').toLowerCase())
                        ? 'success'
                        : (tender.status || '').toLowerCase() === 'rejected_internally'
                        ? 'danger'
                        : 'warning'
                    }
                    size="sm"
                    className="shrink-0 whitespace-nowrap"
                  >
                    {(tender.status || 'IDENTIFIED').replace(/_/g, ' ').toUpperCase()}
                  </Badge>
                </div>

                {decisionError && (
                  <div className="p-3 rounded-lg bg-[#FCE8EC] border border-[#F3C7CF] text-xs text-[#700F2D]">
                    {decisionError}
                  </div>
                )}

                {isMgmtOrAdmin && decisionPending ? (
                    <form onSubmit={handleCommitExecutiveDecision} className="space-y-4">
                      <div>
                        <label className="block text-[11px] font-bold text-[#14213D] uppercase tracking-wider mb-1.5">
                          Decision
                        </label>
                        <Select
                          value={decisionType}
                          onChange={(e) => setDecisionType(e.target.value as any)}
                          options={[
                            {
                              value: 'approved',
                              label: 'Approve Participation & Mobilize Preparation',
                            },
                            {
                              value: 'rejected',
                              label: 'Decline / Reject Opportunity Internally',
                            },
                          ]}
                        />
                      </div>

                      {decisionType === 'rejected' && (
                        <div>
                          <label className="block text-[11px] font-bold text-[#14213D] uppercase tracking-wider mb-1.5">
                            Rejection Justification *
                          </label>
                          <Select
                            value={rejectionReason}
                            onChange={(e) => setRejectionReason(e.target.value)}
                            options={[
                              { value: '', label: '-- Select Reason --' },
                              { value: 'Insufficient eligibility', label: 'Insufficient eligibility (Turnover / Experience QR)' },
                              { value: 'Commercial concern', label: 'Commercial concern (Unviable margin or high penalty)' },
                              { value: 'Documentation unavailable', label: 'Documentation unavailable (OEM Authorization missing)' },
                              { value: 'Management decision', label: 'Management decision' },
                              { value: 'Other', label: 'Other operational reason' },
                            ]}
                          />
                        </div>
                      )}

                      <div>
                        <label className="block text-[11px] font-bold text-[#14213D] uppercase tracking-wider mb-1.5">
                          Directives / Remarks*
                        </label>
                        <Input
                          value={directivesRemarks}
                          onChange={(e) => setDirectivesRemarks(e.target.value)}
                          placeholder="e.g. Approved with Belgian OEM authorization. Ensure 2% margin."
                          required
                        />
                      </div>

                      <div className="pt-1 flex items-center justify-end">
                        <Button
                          type="submit"
                          size="sm"
                          variant={decisionType === 'approved' ? 'primary' : 'danger'}
                          isLoading={isSubmittingDecision}
                          className={decisionType === 'approved' ? 'bg-[#0F5E63] hover:bg-[#0B4A4E] text-white font-medium px-4' : ''}
                          leftIcon={decisionType === 'approved' ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
                        >
                          {decisionType === 'approved'
                            ? 'Approve Participation & Mobilize Preparation'
                            : 'Decline & Reject Opportunity'}
                        </Button>
                      </div>
                    </form>
                ) : decisionPending ? (
                  <div className="p-3.5 rounded-lg bg-[#FBFAF7] border border-[#ECE9E2] text-xs text-[#4A5568] flex items-center gap-3">
                    <ShieldAlert className="w-5 h-5 text-[#9A3412] shrink-0" />
                    <div>
                      <span className="font-semibold text-[#14213D] block mb-0.5">
                        Strict Governance: Management Review Required
                      </span>
                      Only Management and Admin roles are authorized to record tender participation decisions during Internal Review.
                    </div>
                  </div>
                ) : latestDecision ? (
                  // The decided internal-review round itself (tender_approvals), not the tender's free-text remarks.
                  <div className="p-3.5 rounded-xl bg-[#FBFAF7] border border-[#ECE9E2] space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        {latestDecisionRejected ? (
                          <XCircle className="w-4 h-4 text-[#881337]" />
                        ) : (
                          <CheckCircle2 className="w-4 h-4 text-[#0F5E63]" />
                        )}
                        <span className="text-xs font-bold text-[#14213D]">
                          Decision Recorded: {latestDecisionRejected ? 'REJECTED' : 'APPROVED'}
                        </span>
                        <Badge variant={latestDecisionRejected ? 'danger' : 'success'} size="sm">
                          Round {latestDecision.approval_round || 1}
                        </Badge>
                      </div>
                      {(latestDecision.decided_at || latestDecision.responded_at) && (
                        <span className="text-[11px] font-mono text-[#4A5568]">
                          {formatTaskDateTime(latestDecision.decided_at || latestDecision.responded_at)} IST
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-[#4A5568]">
                      By{' '}
                      <span className="font-semibold text-[#14213D]">
                        {latestDecision.approver_name || tender.internal_approval_by_name || 'Not recorded'}
                      </span>
                    </p>
                    {latestDecisionRejected && latestDecision.rejection_reason && (
                      <p className="text-xs text-[#700F2D] bg-[#FCE8EC] p-2.5 rounded-lg border border-[#F3C7CF]">
                        <strong>Rejection reason:</strong> {latestDecision.rejection_reason}
                      </p>
                    )}
                    {(latestDecision.approval_conditions || latestDecision.remarks) && (
                      <p className="text-xs text-[#4A5568] bg-white p-2.5 rounded-lg border border-[#DCD8CE]">
                        <strong>Directives / Remarks:</strong> {latestDecision.approval_conditions || latestDecision.remarks}
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="p-3.5 rounded-lg bg-[#FBFAF7] border border-[#ECE9E2] text-xs text-[#4A5568]">
                    No internal-review decision is recorded for this tender.
                  </p>
                )}
                {/* Approval history (PRD §22): every internal-review round with its decision, kept with the decision itself. */}
                {tender.approvals && tender.approvals.length > 0 && (
                  <div className="mt-4 space-y-2 border-t border-[#ECE9E2] pt-3">
                    <h5 className="text-[11px] font-semibold uppercase tracking-wide text-[#4A5568]">Approval history</h5>
                    <div className="space-y-2">
                      {tender.approvals.map((app: any, idx: number) => (
                        <Card key={app.id || idx} className="p-3 border-[#DCD8CE]">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center space-x-2">
                              <UserCheck className="h-4 w-4 text-[#0F5E63]" />
                              <span className="font-semibold text-xs text-[#14213D]">
                                Round {app.approval_round || idx + 1}: {app.approver_name || 'Designated Approver'}
                              </span>
                            </div>
                            <Badge
                              variant={
                                app.status === 'APPROVED'
                                  ? 'success'
                                  : app.status === 'REJECTED'
                                  ? 'danger'
                                  : app.status === 'PENDING' || !app.status
                                  ? 'warning'
                                  : 'default'
                              }
                              size="sm"
                            >
                              {app.status === 'WITHDRAWN' || app.status === 'SUPERSEDED' ? 'CLOSED' : app.status || 'PENDING'}
                            </Badge>
                          </div>
                          {app.decision_reason && (
                            <p className="text-[11px] text-[#4A5568] mt-1 pl-6">
                              <strong>Note:</strong> {app.decision_reason}
                            </p>
                          )}
                        </Card>
                      ))}
                    </div>
                  </div>
                )}
              </Card>
            </div>
          )}

          {/* TAB: LIFECYCLE & STAGE TRANSITIONS */}
          {activeTab === 'transitions' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                {/* the heading keeps ~12rem; on a phone the action button drops below it instead of squeezing */}
                <div className="min-w-[12rem] flex-1">
                  <h4 className="font-serif font-bold text-sm text-[#14213D]">Tender Lifecycle & Stage Advancement</h4>
                  <p className="text-[11px] text-[#4A5568]">Controlled stage transitions adhering to the Arihant BOS finite-state machine.</p>
                </div>
                <Badge
                  variant={
                    tender.status === 'won'
                      ? 'success'
                      : ['lost', 'cancelled', 'rejected_internally'].includes(tender.status)
                      ? 'danger'
                      : ['under_preparation', 'pq_submitted', 'pq_qualified'].includes(tender.status)
                      ? 'cyber'
                      : 'info'
                  }
                  size="md"
                >
                  Current: {(TENDER_STATUS_LABELS[tender.status] || tender.status?.replace(/_/g, ' '))?.toUpperCase()}{tender.on_hold ? ' · ON HOLD' : ''}
                </Badge>
              </div>

              {/* PRD §22 six-step tracker */}
              <div className="p-3 rounded-xl bg-[#FBFAF7] border border-[#DCD8CE]">
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-1 text-center text-[10px] font-semibold">
                  {PRD_STEPS.map((step, i) => {
                    const status = (tender.status || '').toLowerCase();
                    const reached = step.reachedAt.includes(status);
                    const isLast = i === PRD_STEPS.length - 1;
                    const failed = (i === 2 && status === 'rejected_internally') || (isLast && status === 'lost');
                    return (
                      <div
                        key={step.label}
                        className={`p-2 rounded ${
                          failed ? 'bg-[#881337] text-white' : reached ? 'bg-[#0F5E63] text-white' : 'bg-[#DCD8CE] text-[#4A5568]'
                        }`}
                      >
                        {step.label}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Status Specific Helper / Actions. During internal review the sign-off note sits above the moves that
                  stay open (return to Identified, hold, cancel). */}
              {inInternalReview && (
                <div className="p-4 rounded-xl bg-[#FFF8EB] border border-[#E9C9B4] text-[#7C2D12] space-y-2">
                  <div className="flex items-center gap-2">
                    <ShieldAlert className="h-5 w-5 text-[#7C2D12] shrink-0" />
                    <span className="font-bold text-xs">Awaiting Executive Management Signoff</span>
                  </div>
                  <p className="text-xs text-[#7C2D12] leading-relaxed">
                    Submitted for internal review. The authorised person (Management / Admin) approves it to <strong>Under Preparation</strong> or rejects it with a reason in the <strong>Decision</strong> panel on the Overview tab.
                  </p>
                  <Button
                    size="xs"
                    variant="primary"
                    className="bg-[#9A3412] hover:bg-[#7C2D12] text-white"
                    onClick={() => setActiveTab('overview')}
                  >
                    Go to Decision
                  </Button>
                </div>
              )}
              {lifecycleStageMoves.length === 0 ? (
                !inInternalReview && (
                  <div className="p-4 rounded-xl bg-[#FBFAF7] border border-[#DCD8CE] text-[#14213D] text-xs">
                    This tender is closed (<strong>{(TENDER_STATUS_LABELS[tender.status] || tender.status)?.toUpperCase()}</strong>). No further stage changes are permitted.
                  </div>
                )
              ) : lifecycleMoves.length === 0 ? (
                <div className="p-4 rounded-xl bg-[#FBFAF7] border border-[#DCD8CE] text-[#4A5568] text-xs">
                  No stage changes are available to your role at this stage.
                </div>
              ) : (
                <div className="space-y-4">
                  {['under_preparation', 'UNDER_PREPARATION'].includes(tender.status) && (
                    <div className="p-3 rounded-xl bg-white border border-[#DCD8CE] flex flex-wrap items-center justify-between gap-2 text-xs">
                      <div className="flex flex-wrap items-center gap-2">
                        <Paperclip className="h-4 w-4 text-[#0F5E63]" />
                        <span className="text-[#4A5568]">Document Compliance Gate:</span>
                        <span className="font-bold text-[#14213D]">{readinessSummary}</span>
                      </div>
                      {docsSubmissionReady ? (
                        <span className="text-[#0B4A4E] font-semibold text-[11px] flex items-center gap-1">
                          <CheckCircle2 className="h-3.5 w-3.5" /> All Mandatory Files Ready for Submission
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setActiveTab('preparation')}
                          className="text-[#9A3412] hover:underline font-semibold text-[11px] flex items-center gap-1 cursor-pointer"
                        >
                          {needsChecklistInit ? 'Initialise Checklist' : 'Review Incomplete Documents'} <ArrowRight className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  )}

                  {transitionError && (
                    <InfoCallout variant="danger" title="Stage not changed" onClose={() => setTransitionError(null)}>
                      {transitionError}
                    </InfoCallout>
                  )}

                  <div className="p-3.5 rounded-xl bg-white border border-[#DCD8CE] space-y-3">
                    <span className="text-xs text-[#14213D] font-bold block uppercase tracking-wide">
                      Next PRD Stages ({lifecycleMoves.length})
                    </span>
                    {awaitingBidOpening && (
                      <InfoCallout variant="warning" title={tender.status === 'pq_submitted' ? 'PQ not closed yet' : 'Bids not opened yet'}>
                        {tender.status === 'pq_submitted' ? 'The PQ closes' : 'Bids open after the bid closes'} on{' '}
                        {formatDeadline(tender.submission_deadline || tender.bid_closing_date)}.
                        {stagesAfterClosing.length > 0 && ` Then you can move to ${stagesAfterClosing.join(', ')}; a result is dated on or after the closing day.`}
                        {tender.status === 'submitted' && ' Until then the tender can only be put on hold or cancelled.'} Record a
                        corrigendum if the closing date changed.
                      </InfoCallout>
                    )}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {lifecycleMoves.map((tr) => {
                        const choose = () => {
                          setTransitionError(null);
                          // Won / Lost are recorded only through the Record outcome form (award value, date, reasons).
                          // (The cards are only offered when onRecordOutcome is set — see transitionPermitted.)
                          if (RESULT_TARGETS.includes(tr.status)) {
                            setSelectedNextStatus('');
                            onRecordOutcome?.({ ...tender, preset_result: tr.status === 'lost' ? 'lost' : 'won' });
                            return;
                          }
                          setSelectedNextStatus(tr.status);
                          setTransitionNotes(tr.defaultRemarks || '');
                        };
                        return (
                        // A card is a choice: reachable and operable from the keyboard like a button (QA BUG-014).
                        <div
                          key={tr.status}
                          role="button"
                          tabIndex={0}
                          aria-pressed={selectedNextStatus === tr.status}
                          className={`p-3.5 rounded-xl border transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5E63]/40 ${
                            selectedNextStatus === tr.status
                              ? 'cursor-pointer border-[#0F5E63] bg-[#E3EFEE]/40 ring-1 ring-[#0F5E63]'
                              : 'cursor-pointer border-[#DCD8CE] hover:border-[#0F5E63]/50 bg-white'
                          }`}
                          onClick={choose}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              choose();
                            }
                          }}
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-bold text-xs text-[#14213D]">{tr.label}</span>
                            <Badge variant={tr.variant as any} size="sm">
                              {RESULT_TARGETS.includes(tr.status) ? 'RECORD OUTCOME' : tr.status.replace(/_/g, ' ').toUpperCase()}
                            </Badge>
                          </div>
                          <p className="text-[11px] text-[#4A5568] leading-relaxed">{tr.description}</p>
                        </div>
                        );
                      })}
                    </div>
                  </div>

                  {selectedNextStatus && (
                    <div className="p-4 rounded-xl bg-[#FBFAF7] border border-[#0F5E63]/30 space-y-3 animate-in fade-in duration-200">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-xs text-[#0F5E63]">
                          Confirm: {(selectedNextStatus === 'on_hold' ? 'Put On Hold' : selectedNextStatus === RESUME_TARGET ? 'Resume' : TENDER_STATUS_LABELS[selectedNextStatus] || selectedNextStatus.replace(/_/g, ' '))?.toUpperCase()}
                        </span>
                        <Button
                          size="xs"
                          variant="ghost"
                          onClick={() => setSelectedNextStatus('')}
                        >
                          Cancel
                        </Button>
                      </div>

                      {SUBMISSION_STAGES.includes(selectedNextStatus) && (
                        <Input
                          label="Portal Submission Date"
                          type="date"
                          value={portalSubmissionDate}
                          onChange={(e) => setPortalSubmissionDate(e.target.value)}
                          required
                        />
                      )}

                      <Input
                        label="Remarks"
                        value={transitionNotes}
                        onChange={(e) => setTransitionNotes(e.target.value)}
                        placeholder="e.g. PQ eligibility dossier submitted on government portal."
                        helperText="Saved on the tender's audit timeline with this stage change."
                        required
                      />

                      <div className="flex justify-end gap-2 pt-1">
                        <Button
                          variant="primary"
                          size="sm"
                          isLoading={isTransitioning}
                          onClick={() => handlePerformTransition(selectedNextStatus, transitionNotes)}
                          leftIcon={<ArrowRight className="h-3.5 w-3.5" />}
                        >
                          Confirm
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Deadline management (PRD §24): corrigenda live with the stage they affect. */}
              <div className="p-3.5 rounded-xl bg-white border border-[#DCD8CE] space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-[12rem] flex-1">
                    <span className="text-xs text-[#14213D] font-bold block uppercase tracking-wide">
                      Deadline &amp; Corrigenda ({tender.corrigenda?.length || 0})
                    </span>
                    <p className="text-[11px] text-[#4A5568]">
                      Submission deadline: <span className="font-mono text-[#14213D]">{formatDeadline(tender.submission_deadline)}</span>. A
                      corrigendum records the portal extension and moves the deadline.
                    </p>
                  </div>
                  {!CLOSED_STAGES.includes((tender.status || '').toLowerCase()) && can('corrigendum') && (
                    <Button variant="secondary" size="sm" leftIcon={<Plus className="h-3.5 w-3.5" />} onClick={() => {
                      setCorrigendumError(null);
                      // Pre-fill with the current deadline as IST wall clock, so editing keeps the time the user sees.
                      setNewCorrigendum((prev) => ({ ...prev, new_deadline: prev.new_deadline || toIstLocalInput(tender.submission_deadline) }));
                      setIsCorrigendumOpen(true);
                    }}>
                      Add Corrigendum
                    </Button>
                  )}
                </div>
                {tender.corrigenda && tender.corrigenda.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Corrigendum No.</TableHead>
                        <TableHead>Issued Date</TableHead>
                        <TableHead>Old Deadline</TableHead>
                        <TableHead>New Deadline</TableHead>
                        <TableHead>Summary</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {tender.corrigenda.map((c: any) => (
                        <TableRow key={c.id}>
                          <TableCell className="font-bold font-mono text-xs text-[#14213D]">{c.corrigendum_number}</TableCell>
                          <TableCell className="font-mono text-xs">{c.issued_date ? formatTaskDate(c.issued_date) : 'N/A'}</TableCell>
                          <TableCell className="font-mono text-xs text-[#4A5568]">{formatDeadline(c.old_deadline)}</TableCell>
                          <TableCell className="font-mono text-xs font-bold text-[#0F5E63]">{formatDeadline(c.new_deadline)}</TableCell>
                          <TableCell className="text-xs text-[#4A5568]">{c.summary || 'Deadline extended'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <p className="text-[11px] text-[#6B7280]">No corrigenda recorded.</p>
                )}
              </div>
            </div>
          )}

          {/* TAB 4: DOCUMENTS CHECKLIST */}
          {activeTab === 'preparation' && (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
                <div>
                  <h4 className="font-serif font-bold text-sm text-[#14213D]">Document Compliance Checklist</h4>
                  <p className="text-[11px] text-[#4A5568]">Mandatory submission criteria: each required item must be linked to a responsible member and marked Ready.</p>
                </div>
                {/* Until the category checklist exists, initialising it is the primary step; custom documents come on top. */}
                <div className="flex flex-wrap items-center gap-2">
                  {canEditDocuments && (
                    <Button
                      variant={needsChecklistInit && can('initChecklist') ? 'outline' : 'primary'}
                      size="sm"
                      onClick={openAddCustomDoc}
                      leftIcon={<Plus className="h-3.5 w-3.5" />}
                    >
                      Add Document
                    </Button>
                  )}
                  {can('initChecklist') && (
                    <Button
                      variant={needsChecklistInit ? 'primary' : 'outline'}
                      size="sm"
                      onClick={handleInitChecklist}
                      isLoading={actionLoading}
                      leftIcon={<RefreshCw className="h-3.5 w-3.5" />}
                    >
                      {docReadiness?.checklist_created ? 'Re-initialize Templates' : 'Initialise Checklist'}
                    </Button>
                  )}
                </div>
              </div>

              {needsChecklistInit && (
                <InfoCallout variant="warning" title={docReadiness?.checklist_created ? 'Template documents missing' : 'Checklist not initialised'}>
                  {docReadiness?.checklist_created
                    ? `${templateDocsNotOnChecklist.length} mandatory template document${templateDocsNotOnChecklist.length === 1 ? ' is' : 's are'} not on the checklist yet (${templateDocsNotOnChecklist.join(', ')}). They count as not Ready until added.`
                    : `The category template's ${docReadiness?.mandatory_total ?? 0} mandatory documents are required before submission.`}{' '}
                  {can('initChecklist')
                    ? `Click ${docReadiness?.checklist_created ? 'Re-initialize Templates' : 'Initialise Checklist'} first; custom documents are added on top of the template and never replace it.`
                    : 'Ask the tender owner to initialise the checklist.'}
                </InfoCallout>
              )}

              {/* Central Tender Google Drive Workspace */}
              <div className="p-3.5 rounded-xl border border-[#DCD8CE] bg-[#FBFAF7] flex flex-col md:flex-row md:items-center justify-between gap-3 shadow-xs">
                <div className="flex items-start md:items-center gap-3">
                  <div className="p-2.5 rounded-lg bg-[#E3EFEE] text-[#0F5E63] shrink-0 border border-[#0F5E63]/20 flex items-center justify-center">
                    <svg className="w-5 h-5" viewBox="0 0 87.3 78" fill="none">
                      <path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8H0c0 1.55.4 3.1 1.2 4.5z" fill="#0066DA"/>
                      <path d="M43.65 25 29.9 1.2c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44C.4 49.9 0 51.45 0 53h27.5z" fill="#00AC47"/>
                      <path d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.5l5.85 10.15z" fill="#EA4335"/>
                      <path d="M43.65 25 57.4 1.2C56.05.4 54.5 0 52.95 0H34.35c-1.55 0-3.1.4-4.45 1.2z" fill="#00832D"/>
                      <path d="M59.8 53H87.3c0-1.55-.4-3.1-1.2-4.5L72.35 24.7c-.8-1.4-1.95-2.5-3.3-3.3L55.3 45.2z" fill="#2684FC"/>
                      <path d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l-13.75-23.8H27.5L41.25 73.5c.8 1.4 1.95 2.5 3.3 3.3z" fill="#FFBA00"/>
                    </svg>
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-serif font-bold text-xs text-[#14213D]">Central Tender Google Drive Workspace</span>
                      <Badge variant="cyber" size="sm">Cloud Repository</Badge>
                    </div>
                    <p className="text-[11px] text-[#4A5568]">
                      Shared Google Drive directory for tender notices, technical sheets, drawings, and scanned submissions.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 min-w-0">
                  {/* The saved link (not the draft being typed) decides between the link view and the editor. */}
                  {tender.tender_url && !isEditingDriveFolder ? (
                    <div className="flex items-center gap-2 flex-wrap min-w-0">
                      {safeHttpUrl(tender.tender_url) ? (
                        <a
                          href={safeHttpUrl(tender.tender_url) as string}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0F5E63] text-white hover:bg-[#0B4A4E] text-xs font-semibold shadow-xs transition-colors"
                          title={tender.tender_url}
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          <span>Open Drive Folder ↗</span>
                        </a>
                      ) : (
                        // Not an http(s) link: shown as text only (never a clickable href) until it is corrected.
                        <span className="break-all font-mono text-[11px] text-[#881337]" title="Not a web link — edit it to a https:// address">
                          {tender.tender_url}
                        </span>
                      )}
                      {can('update') && (
                        <Button
                          variant="outline"
                          size="xs"
                          onClick={() => {
                            setDriveFolderUrl(tender.tender_url || '');
                            setDriveFolderError(null);
                            setIsEditingDriveFolder(true);
                          }}
                        >
                          Edit Link
                        </Button>
                      )}
                    </div>
                  ) : can('update') ? (
                    <div className="flex flex-col gap-1 w-full md:w-auto">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <input
                          type="url"
                          placeholder="https://drive.google.com/drive/folders/..."
                          value={driveFolderUrl}
                          onChange={(e) => {
                            setDriveFolderUrl(e.target.value);
                            setDriveFolderError(null);
                          }}
                          aria-invalid={Boolean(driveFolderError)}
                          className={`text-xs px-2.5 py-1.5 rounded-lg border bg-white min-w-0 flex-1 sm:min-w-[240px] outline-none focus:ring-1 ${
                            driveFolderError
                              ? 'border-[#881337] focus:border-[#881337] focus:ring-[#881337]/15'
                              : 'border-[#C9C4B8] focus:border-[#0F5E63] focus:ring-[#0F5E63]/20'
                          }`}
                        />
                        <Button
                          variant="primary"
                          size="xs"
                          onClick={() => handleSaveDriveFolder()}
                          isLoading={isSavingDriveFolder}
                          disabled={!driveFolderUrl.trim()}
                        >
                          Save Link
                        </Button>
                        {isEditingDriveFolder && (
                          <Button
                            variant="ghost"
                            size="xs"
                            onClick={() => {
                              setDriveFolderUrl(tender.tender_url || '');
                              setDriveFolderError(null);
                              setIsEditingDriveFolder(false);
                            }}
                          >
                            Cancel
                          </Button>
                        )}
                      </div>
                      {driveFolderError && <p className="text-[11px] font-medium text-[#881337]">{driveFolderError}</p>}
                    </div>
                  ) : (
                    <span className="text-[11px] text-[#6B7280]">No Drive folder linked.</span>
                  )}
                </div>
              </div>

              {/* Completion Progress Bar */}
              <div className="space-y-1">
                <div className="flex justify-between text-[11px] font-semibold">
                  <span>Readiness Progress</span>
                  {/* the server's numbers: template mandatory items ∪ the tender's mandatory rows */}
                  <span className="font-mono text-[#0F5E63]">{readinessSummary}</span>
                </div>
                <div className="w-full h-2 rounded-full bg-[#DCD8CE] overflow-hidden">
                  <div
                    className="h-full bg-[#0F5E63] transition-all duration-300"
                    style={{ width: `${Math.min(100, Math.max(0, docReadiness?.percentage ?? 0))}%` }}
                  />
                </div>
                {(docReadiness?.missing || []).length > 0 && (
                  <p className="text-[11px] text-[#4A5568]">
                    Not Ready: <span className="text-[#14213D]">{(docReadiness?.missing || []).join(', ')}</span>
                  </p>
                )}
              </div>

              {/* Status Linkage Banner: only when the server reports the checklist initialised and every mandatory item Ready */}
              {docsSubmissionReady &&
                ['under_preparation', 'UNDER_PREPARATION'].includes(tender.status) &&
                !tender.on_hold &&
                can('transition') && (
                <div className="p-3.5 rounded-xl bg-[#E3EFEE] border border-[#D0E5E3] flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-[#0B4A4E] animate-in fade-in duration-200">
                  <div className="flex items-center gap-2.5">
                    <CheckCircle2 className="h-5 w-5 text-[#0F5E63] shrink-0" />
                    <div>
                      <div className="font-bold text-xs">All Mandatory Documents Verified & Ready (100%)!</div>
                      <div className="text-[11px] text-[#0B4A4E]">Document compliance is fully satisfied. Tender is ready for portal submission.</div>
                    </div>
                  </div>
                  <Button
                    size="xs"
                    variant="success"
                    onClick={() => {
                      setActiveTab('transitions');
                      setTransitionError(null);
                      const isPq = (tender.category || '').toLowerCase().includes('pq');
                      setSelectedNextStatus(isPq ? 'pq_submitted' : 'submitted');
                      setTransitionNotes(isPq ? 'Pre-qualification dossier submitted on government portal.' : 'Technical and financial bids submitted on GeM portal.');
                    }}
                    leftIcon={<ArrowRight className="h-3.5 w-3.5" />}
                  >
                    {(tender.category || '').toLowerCase().includes('pq') ? 'Advance to PQ Submitted' : 'Advance to Tender Submitted'}
                  </Button>
                </div>
              )}

              {tender.documents && tender.documents.length > 0 ? (
                <div className="border border-[#DCD8CE] rounded-xl overflow-hidden bg-white">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-[#FBFAF7]">
                        <TableHead>Document Type</TableHead>
                        <TableHead>Mandatory</TableHead>
                        <TableHead className="min-w-[170px]">Assigned To (Linked)</TableHead>
                        <TableHead>Current Status</TableHead>
                        <TableHead className="min-w-[180px]">Attached File</TableHead>
                        <TableHead>Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {tender.documents.map((doc: any) => (
                        <TableRow key={doc.id} className="hover:bg-[#FBFAF7]">
                          <TableCell className="font-semibold text-xs text-[#14213D] max-w-[200px]">
                            <div className="truncate font-medium" title={doc.document_type}>
                              {doc.document_type}
                            </div>
                            {doc.notes && (
                              <div className="text-[10px] text-[#4A5568] truncate">{doc.notes}</div>
                            )}
                          </TableCell>
                          <TableCell>
                            {doc.is_mandatory ? (
                              <Badge variant="danger" size="sm">Required</Badge>
                            ) : (
                              <Badge variant="default" size="sm">Optional</Badge>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="space-y-1">
                              <select
                                value={doc.owner_id || ''}
                                onChange={(e) => handleUpdateDocOwner(doc.id, e.target.value)}
                                disabled={!canEditDocuments}
                                className="text-[11px] p-1 rounded border border-[#DCD8CE] bg-white cursor-pointer w-full disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                <option value="">-- Unassigned (None) --</option>
                                {users && users.map((u: any) => (
                                  <option key={u.id} value={u.id}>
                                    {userWithRole(u)}
                                  </option>
                                ))}
                              </select>
                              {doc.owner_id && doc.owner_id === currentUser?.id && (
                                <Badge variant="info" size="sm" className="gap-1">
                                  <UserCheck className="h-3 w-3 shrink-0" aria-hidden="true" />
                                  Assigned to you
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={
                                doc.status === 'Ready'
                                  ? 'success'
                                  : doc.status === 'In Progress'
                                  ? 'warning'
                                  : doc.status === 'Not Applicable'
                                  ? 'default'
                                  : 'outline'
                              }
                              size="sm"
                            >
                              {doc.status}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {attachingDocId === doc.id ? (
                              <div className="p-2.5 rounded-lg bg-[#FBFAF7] border border-[#0F5E63] space-y-2 w-full sm:min-w-[260px] shadow-sm animate-in fade-in duration-150">
                                <div className="flex items-center justify-between text-[11px] font-bold text-[#0F5E63]">
                                  <span>Link Google Drive / File</span>
                                  <button
                                    type="button"
                                    onClick={closeAttachPanel}
                                    className="text-[#6B7280] hover:text-[#4A5568] cursor-pointer p-0.5"
                                    aria-label="Close"
                                  >
                                    <X className="h-3 w-3" />
                                  </button>
                                </div>
                                <div>
                                  <label className="text-[10px] text-[#4A5568] block mb-0.5 font-medium">Google Drive URL (or Document Link)</label>
                                  <input
                                    type="url"
                                    value={attachedDriveUrl}
                                    onChange={(e) => {
                                      setAttachedDriveUrl(e.target.value);
                                      setAttachError(null);
                                    }}
                                    placeholder="https://drive.google.com/file/d/..."
                                    aria-invalid={Boolean(attachError)}
                                    className={`w-full text-[11px] px-2 py-1 rounded border bg-white outline-none ${
                                      attachError ? 'border-[#881337] focus:border-[#881337]' : 'border-[#C9C4B8] focus:border-[#0F5E63]'
                                    }`}
                                    autoFocus
                                  />
                                </div>
                                {attachError && <p className="text-[10px] font-medium text-[#881337]">{attachError}</p>}
                                <div>
                                  <label className="text-[10px] text-[#4A5568] block mb-0.5 font-medium">Document Label / File Name</label>
                                  <input
                                    type="text"
                                    value={attachedFileName}
                                    onChange={(e) => setAttachedFileName(e.target.value)}
                                    placeholder="e.g. OEM_MAF_Letter.pdf"
                                    className="w-full text-[11px] px-2 py-1 rounded border border-[#C9C4B8] focus:border-[#0F5E63] bg-white outline-none"
                                  />
                                </div>
                                <div className="flex items-center justify-end gap-1.5 pt-1 border-t border-[#ECE9E2]">
                                  <button
                                    type="button"
                                    onClick={closeAttachPanel}
                                    className="px-2 py-1 rounded text-[10px] text-[#4A5568] hover:bg-[#ECE9E2] cursor-pointer"
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleAttachFile(doc.id)}
                                    disabled={actionLoading || (!attachedFileName.trim() && !attachedDriveUrl.trim())}
                                    className="px-2.5 py-1 rounded bg-[#0F5E63] text-white text-[10px] font-bold hover:bg-[#0B4A4E] disabled:opacity-50 cursor-pointer transition-colors shadow-xs"
                                  >
                                    {actionLoading ? 'Saving…' : 'Save & Mark Ready'}
                                  </button>
                                </div>
                              </div>
                            ) : doc.file_url ? (
                              <div className="flex items-center gap-1.5 max-w-[220px]">
                                {safeHttpUrl(doc.file_url) ? (
                                  <a
                                    href={safeHttpUrl(doc.file_url) as string}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-[#E3EFEE] hover:bg-[#D0E5E3] text-[#0F5E63] font-mono text-[11px] font-semibold border border-[#0F5E63]/25 truncate group transition-colors shadow-2xs"
                                    title={`Open in Drive: ${doc.file_url}`}
                                  >
                                    <ExternalLink className="h-3 w-3 shrink-0 text-[#0F5E63]" />
                                    <span className="truncate max-w-[110px]">{doc.file_name || 'Drive Document'}</span>
                                    <span className="text-[10px] text-[#0F5E63]/70 font-normal">↗</span>
                                  </a>
                                ) : (
                                  // Not an http(s) link: the label is shown as plain text, never as a clickable href.
                                  <span
                                    className="inline-flex items-center gap-1.5 font-mono text-[11px] text-[#14213D] truncate"
                                    title={`Not a web link: ${doc.file_url}`}
                                  >
                                    <Paperclip className="h-3 w-3 shrink-0 text-[#4A5568]" />
                                    <span className="truncate max-w-[110px]">{doc.file_name || doc.file_url}</span>
                                  </span>
                                )}
                                {canEditDocuments && (
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveFile(doc.id)}
                                    className="text-[#881337] hover:text-[#700F2D] p-0.5 rounded hover:bg-[#FCE8EC] shrink-0 cursor-pointer transition-colors"
                                    title="Remove attachment"
                                  >
                                    <X className="h-3 w-3" />
                                  </button>
                                )}
                              </div>
                            ) : doc.file_name ? (
                              <div className="flex items-center gap-1.5 font-mono text-[11px]">
                                <Paperclip className="h-3.5 w-3.5 text-[#0F5E63] shrink-0" />
                                <span className="text-[#0F5E63] font-semibold truncate max-w-[120px]" title={doc.file_name}>
                                  {doc.file_name}
                                </span>
                                {canEditDocuments && (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setAttachingDocId(doc.id);
                                        setAttachedFileName(doc.file_name);
                                        setAttachedDriveUrl('');
                                        setAttachError(null);
                                      }}
                                      className="text-[10px] text-[#0F5E63] hover:underline font-semibold cursor-pointer"
                                      title="Add Drive URL"
                                    >
                                      + Link URL
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleRemoveFile(doc.id)}
                                      className="text-[#881337] hover:text-[#700F2D] p-0.5 rounded hover:bg-[#FCE8EC] shrink-0 cursor-pointer"
                                      title="Remove attachment"
                                    >
                                      <X className="h-3 w-3" />
                                    </button>
                                  </>
                                )}
                              </div>
                            ) : canEditDocuments ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setAttachingDocId(doc.id);
                                  setAttachedFileName(`${doc.document_type.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`);
                                  setAttachedDriveUrl('');
                                  setAttachError(null);
                                }}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] text-[#0F5E63] hover:bg-[#E3EFEE] border border-dashed border-[#0F5E63]/30 font-medium cursor-pointer transition-colors"
                              >
                                <ExternalLink className="h-3 w-3" />
                                <span>Link Drive / File</span>
                              </button>
                            ) : (
                              <span className="text-[11px] text-[#6B7280]">—</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <select
                              value={doc.status}
                              onChange={(e) => handleUpdateDocStatus(doc.id, e.target.value)}
                              disabled={!canEditDocuments}
                              className="text-[11px] p-1 rounded border border-[#DCD8CE] bg-white cursor-pointer font-medium disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              <option value="Not Started">Not Started</option>
                              <option value="In Progress">In Progress</option>
                              <option value="Ready">Ready</option>
                              <option value="Not Applicable">Not Applicable</option>
                            </select>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <EmptyState
                  title="Checklist not initialized"
                  description="Click 'Initialise Checklist' to populate the category's standard NIT and PQ documents before adding custom ones."
                />
              )}

              {/* Add Custom Document Modal */}
              <Modal
                isOpen={isAddCustomDocOpen}
                onClose={() => setIsAddCustomDocOpen(false)}
                title="Add Required Compliance Document"
                description="Include an additional tender compliance item to the mandatory checklist."
                maxWidth="md"
              >
                <form onSubmit={handleAddCustomDoc} className="space-y-4 text-xs">
                  {customDocError && (
                    <InfoCallout variant="danger" title="Document not added" onClose={() => setCustomDocError(null)}>
                      {customDocError}
                    </InfoCallout>
                  )}
                  {needsChecklistInit && (
                    <InfoCallout variant="warning" title="Initialise the checklist first">
                      The category checklist is not complete yet, so its mandatory template documents still count as missing. A
                      custom document is added on top of the template and does not replace it.
                      {can('initChecklist') && (
                        <span className="mt-2 block">
                          <Button
                            type="button"
                            variant="secondary"
                            size="xs"
                            isLoading={actionLoading}
                            leftIcon={<RefreshCw className="h-3 w-3" />}
                            onClick={async () => {
                              setIsAddCustomDocOpen(false);
                              await handleInitChecklist();
                            }}
                          >
                            {docReadiness?.checklist_created ? 'Re-initialize Templates' : 'Initialise Checklist'}
                          </Button>
                        </span>
                      )}
                    </InfoCallout>
                  )}
                  <Input
                    label="Document Name / Type"
                    placeholder="e.g. OEM Factory Audit Certificate, Site Survey Signoff"
                    value={newCustomDoc.document_type}
                    onChange={(e) => setNewCustomDoc({ ...newCustomDoc, document_type: e.target.value })}
                    required
                  />

                  <Select
                    label="Assign to Responsible Person (Link)"
                    value={newCustomDoc.owner_id}
                    onChange={(e) => setNewCustomDoc({ ...newCustomDoc, owner_id: e.target.value })}
                    options={[
                      { value: '', label: '-- Unassigned --' },
                      ...(users || []).map((u: any) => ({
                        value: u.id,
                        label: userWithRole(u),
                      })),
                    ]}
                  />

                  <Input
                    label="Google Drive / File URL (Optional)"
                    type="url"
                    placeholder="https://drive.google.com/file/d/..."
                    value={newCustomDoc.file_url || ''}
                    onChange={(e) => {
                      setNewCustomDoc({ ...newCustomDoc, file_url: e.target.value });
                      setCustomDocUrlError(null);
                    }}
                    error={customDocUrlError || undefined}
                    helperText="Providing a link will automatically mark this requirement Ready."
                  />

                  <Checkbox
                    id="mandatory_chk"
                    checked={newCustomDoc.is_mandatory}
                    onChange={(e) => setNewCustomDoc({ ...newCustomDoc, is_mandatory: e.target.checked })}
                    label="Mandatory Document (Required before submission)"
                  />

                  <div className="flex justify-end gap-2 pt-2">
                    <Button type="button" variant="ghost" size="sm" onClick={() => setIsAddCustomDocOpen(false)}>
                      Cancel
                    </Button>
                    <Button type="submit" variant="primary" size="sm" isLoading={isAddingCustomDoc}>
                      Add to Checklist
                    </Button>
                  </div>
                </form>
              </Modal>
            </div>
          )}

          {/* TAB 5: CORRIGENDA */}
          {/* PREPARATION: Bill of Quantities */}
          {activeTab === 'preparation' && (
            <div className="space-y-3 mt-6 border-t border-[#ECE9E2] pt-5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                {/* the heading keeps ~12rem; on a phone the action button drops below it instead of squeezing */}
                <div className="min-w-[12rem] flex-1">
                  <h4 className="font-serif font-bold text-sm text-[#14213D]">Tender Products & BOQ Specifications</h4>
                  <p className="text-[11px] text-[#4A5568]">Products linked to this tender with catalogue and GeM compliance checks</p>
                </div>
                {!boqLocked && can('lineItems') && (
                  <Button variant="primary" size="sm" leftIcon={<Plus className="h-3.5 w-3.5" />} onClick={openAddLineItem}>
                    Add Line Item
                  </Button>
                )}
              </div>

              {boqLocked && (
                <InfoCallout variant="neutral" title="BOQ locked">
                  This tender is closed ({(tender.status || '').replace(/_/g, ' ').toUpperCase()}); line items can no longer be added, edited or removed.
                </InfoCallout>
              )}

              {tender.line_items && tender.line_items.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product / Description</TableHead>
                      <TableHead>GeM Status</TableHead>
                      <TableHead>Quantity</TableHead>
                      <TableHead>Compliance</TableHead>
                      <TableHead>Quoted Unit Price</TableHead>
                      <TableHead>Quoted Total</TableHead>
                      {canDeleteLineItems && <TableHead className="text-right">Action</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tender.line_items.map((item: any) => (
                      <TableRow key={item.id}>
                        <TableCell>
                          <span className="font-semibold text-xs block text-[#14213D]">{item.product_name || item.product_description}</span>
                          {item.specification_summary && (
                            <span className="text-[10px] text-[#4A5568] line-clamp-1">{item.specification_summary}</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {item.product_gem_listed ? (
                            <Badge variant="success" size="sm">GeM Listed</Badge>
                          ) : (
                            <Badge variant="danger" size="sm" title="Suggested to raise portal issue if portal requires listing">
                              Not on GeM
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-xs font-semibold">
                          {item.quantity} {item.unit || 'Nos'}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              item.is_compliant === 'Yes'
                                ? 'success'
                                : item.is_compliant === 'No'
                                ? 'danger'
                                : item.is_compliant === 'Partial'
                                ? 'warning'
                                : 'default'
                            }
                            size="sm"
                          >
                            {item.is_compliant}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {item.quoted_unit_price ? `₹ ${Number(item.quoted_unit_price).toLocaleString('en-IN')}` : '—'}
                        </TableCell>
                        <TableCell className="font-mono text-xs font-bold text-[#0F5E63]">
                          {item.quoted_total ? `₹ ${Number(item.quoted_total).toLocaleString('en-IN')}` : '—'}
                        </TableCell>
                        {canDeleteLineItems && (
                          <TableCell className="text-right">
                            <Button variant="ghost" size="xs" className="text-[#9A3412]" onClick={() => setLineItemToDelete(item)}>
                              Remove
                            </Button>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-[11px] text-[#6B7280]">No BOQ line items yet. Add them only if the tender has a bill of quantities.</p>
              )}
            </div>
          )}

          {/* TAB 6: FINANCIAL INSTRUMENTS */}
          {activeTab === 'preparation' && (
            <div className="space-y-4 mt-6 border-t border-[#ECE9E2] pt-5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                {/* the heading keeps ~12rem; on a phone the action button drops below it instead of squeezing */}
                <div className="min-w-[12rem] flex-1">
                  <h4 className="font-serif font-bold text-sm text-[#14213D]">Financial Instruments (EMD, PBG & Fees)</h4>
                  <p className="text-[11px] text-[#4A5568]">Tracked in real time with the Finance department until refund or contract release.</p>
                </div>
                {can('instrument') && (
                  <Button variant="primary" size="sm" leftIcon={<Plus className="h-3.5 w-3.5" />} onClick={() => {
                    setInstrumentError(null);
                    setIsInstrumentOpen(true);
                  }}>
                    Request Instrument
                  </Button>
                )}
              </div>

              {tender.financial_instruments && tender.financial_instruments.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Type</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Mode / Bank</TableHead>
                      <TableHead>Reference No.</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tender.financial_instruments.map((fi: any) => (
                      <TableRow key={fi.id}>
                        <TableCell className="font-bold text-xs text-[#14213D]">{fi.instrument_type}</TableCell>
                        <TableCell className="font-mono text-xs font-bold text-[#0F5E63]">
                          ₹ {Number(fi.amount || 0).toLocaleString('en-IN')}
                        </TableCell>
                        <TableCell className="text-xs">
                          {fi.mode} • {fi.bank || 'SBI'}
                        </TableCell>
                        <TableCell className="font-mono text-xs">{fi.reference_number || 'Pending Generation'}</TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              fi.status === 'Issued' || fi.status === 'Refunded'
                                ? 'success'
                                : fi.status === 'Refund Due' || fi.status === 'Forfeited'
                                ? 'danger'
                                : 'warning'
                            }
                            size="sm"
                          >
                            {fi.status}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <EmptyState
                  title="No financial instruments recorded"
                  description="Raise EMD demand notes or Bank Guarantee requests to central Finance."
                />
              )}
            </div>
          )}

          {/* TAB 7: PORTAL ISSUES */}
          {activeTab === 'discussion' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                {/* the heading keeps ~12rem; on a phone the action button drops below it instead of squeezing */}
                <div className="min-w-[12rem] flex-1">
                  <h4 className="font-serif font-bold text-sm text-[#14213D]">External Portal Glitch / Downtime Log</h4>
                  <p className="text-[11px] text-[#4A5568]">External GeM/CPPP portal problems are tracked for deadline extension claims.</p>
                </div>
              </div>

              {tender.portal_issues && tender.portal_issues.length > 0 ? (
                <div className="space-y-2">
                  {tender.portal_issues.map((pi: any) => (
                    <Card key={pi.id} className="p-3 border-[#DCD8CE]">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-xs text-[#14213D]">{pi.issue || pi.issue_description}</span>
                        <Badge
                          variant={String(pi.resolution_status || '').toUpperCase() === 'RESOLVED' ? 'success' : 'warning'}
                          size="sm"
                        >
                          {String(pi.resolution_status || 'OPEN').toUpperCase().replace(/_/g, ' ')}
                        </Badge>
                      </div>
                      <p className="text-[11px] text-[#4A5568] mt-1">
                        Reported on {pi.reported_date ? formatTaskDate(pi.reported_date) : 'N/A'} • Responsible: {pi.responsible_name || 'Executive'}
                      </p>
                      {pi.resolution && (
                        <p className="text-[11px] text-[#0B4A4E] font-medium mt-1 bg-[#E3EFEE] p-1.5 rounded">
                          Resolution: {pi.resolution}
                        </p>
                      )}
                    </Card>
                  ))}
                </div>
              ) : (
                <EmptyState
                  title="No portal issues logged"
                  description="GeM server timeouts, catalogue missing items, or DSC failures can be registered here."
                />
              )}
            </div>
          )}

          {/* TAB 8: DISCUSSION */}
          {activeTab === 'discussion' && (
            <div className="space-y-4 mt-6 border-t border-[#ECE9E2] pt-5">
              <div>
                <h4 className="font-serif font-bold text-sm text-[#14213D]">Collaborative Discussion (WhatsApp Replacement)</h4>
                <p className="text-[11px] text-[#4A5568]">Team discussions, technical clarifications, and executive notes are saved permanently.</p>
              </div>

              {can('comment') && (
                <div className="flex space-x-2">
                  <Input
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    placeholder="Type an internal note or mention team members..."
                    className="flex-1"
                  />
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={handlePostComment}
                    isLoading={isCommentSubmitting}
                    disabled={!commentText.trim()}
                    leftIcon={<Send className="h-3.5 w-3.5" />}
                  >
                    Post Note
                  </Button>
                </div>
              )}

              {tender.comments && tender.comments.length > 0 ? (
                <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                  {tender.comments.map((cm: any) => (
                    <div key={cm.id} className="p-3 rounded-lg bg-[#FBFAF7] border border-[#ECE9E2] space-y-1">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="font-bold text-[#14213D]">{cm.author_name || 'Team Member'}</span>
                        <span className="text-[#4A5568] font-mono">{formatTaskDateTime(cm.created_at)}</span>
                      </div>
                      <p className="text-xs text-[#14213D]">{cm.body}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState title="No discussion notes yet" description="Start a discussion to replace WhatsApp chats." />
              )}
            </div>
          )}

          {/* TAB 9: RESULT & POST-MORTEM */}
          {activeTab === 'transitions' && ['won', 'lost'].includes((tender.status || '').toLowerCase()) && (
            <div className="space-y-4 mt-6 border-t border-[#ECE9E2] pt-5">
              {['won', 'WON', 'lost', 'LOST'].includes(tender.status) ? (
                <Card className="p-4 space-y-3 border-[#DCD8CE]">
                  <div className="flex items-center justify-between">
                    <h4 className="font-serif font-bold text-sm text-[#14213D]">Declared Tender Outcome</h4>
                    <Badge
                      variant={
                        tender.status.toLowerCase().includes('won') ? 'success' : 'danger'
                      }
                      size="md"
                    >
                      {tender.status.toUpperCase()}
                    </Badge>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                    <div>
                      <span className="text-[10px] text-[#4A5568] block uppercase font-bold">Result Date</span>
                      <span className="font-mono font-semibold">
                        {tender.result_date || tender.tender_result?.result_date
                          ? formatTaskDate(tender.result_date || tender.tender_result?.result_date)
                          : 'N/A'}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] text-[#4A5568] block uppercase font-bold">Awarded Value</span>
                      {/* From the result row only (awarded value; else the winner's price on a loss, the won value on a win) —
                          never the tender's estimate. */}
                      <span className="font-mono font-bold text-[#0F5E63]">
                        {lakhOrDash(
                          tender.tender_result?.awarded_value ??
                            (String(tender.status).toLowerCase() === 'lost'
                              ? tender.tender_result?.winning_price
                              : tender.tender_result?.value),
                        )}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] text-[#4A5568] block uppercase font-bold">Our Rank</span>
                      <span className="font-mono font-bold">{tender.tender_result?.our_rank || '—'}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-[#4A5568] block uppercase font-bold">
                        {String(tender.status).toLowerCase() === 'lost' ? 'Winning Competitor' : 'Competitor'}
                      </span>
                      <span className="font-semibold">{tender.tender_result?.competitor || '—'}</span>
                    </div>
                  </div>

                  {tender.tender_result?.loss_reasons && tender.tender_result.loss_reasons.length > 0 && (
                    <div className="p-2.5 rounded bg-[#FCE8EC] border border-[#F3C7CF]">
                      <span className="text-[10px] text-[#700F2D] font-bold block uppercase mb-1">Loss Reasons</span>
                      <div className="flex flex-wrap gap-1">
                        {tender.tender_result.loss_reasons.map((r: string, i: number) => (
                          <Badge key={i} variant="danger" size="sm">{r}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </Card>
              ) : (
                <EmptyState
                  title={AWAITING_RESULT.includes(tender.status) ? 'Awaiting result' : 'Tender in progress'}
                  description={
                    awaitingBidOpening
                      ? `The bid is submitted. The result can be recorded after the bid closes on ${formatDeadline(tender.submission_deadline || tender.bid_closing_date)}.`
                      : AWAITING_RESULT.includes(tender.status)
                      ? 'The bid is submitted. Record the outcome (won or lost) once the buyer declares the result.'
                      : 'Results (Won / Lost) can be recorded once the tender is submitted and the bids are opened.'
                  }
                  action={
                    onRecordOutcome && AWAITING_RESULT.includes(tender.status) && !awaitingBidOpening ? (
                      <Button variant="primary" size="sm" leftIcon={<Award className="h-4 w-4" />} onClick={() => onRecordOutcome(tender)}>
                        Record outcome
                      </Button>
                    ) : undefined
                  }
                />
              )}
            </div>
          )}

          {/* TAB 10: LINKED RECORDS */}
          {activeTab === 'overview' && LINKABLE_STAGES.includes((tender.status || '').toLowerCase()) && (
            <div className="space-y-4 mt-6 border-t border-[#ECE9E2] pt-5">
              <div>
                <h4 className="font-serif font-bold text-sm text-[#14213D]">Inter-Module Operational Links</h4>
                <p className="text-[11px] text-[#4A5568]">Seamless linkages between PQ tenders, General Bids, Sales Orders, and Warranties.</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card className="p-4 space-y-2 border-[#DCD8CE]">
                  <h5 className="font-semibold text-xs text-[#0F5E63]">PQ to General Tender Conversion</h5>
                  <p className="text-[11px] text-[#4A5568]">
                    When a PQ tender is officially qualified, generate the linked General or MHA tender with cloned documents and lines.
                  </p>
                  {tender.status !== 'pq_qualified' ? (
                    <p className="text-[11px] text-[#4A5568] italic">Available when tender status is PQ_QUALIFIED.</p>
                  ) : can('linkedTender') ? (
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={openLinkedTenderDialog}
                      leftIcon={<ArrowRight className="h-3.5 w-3.5" />}
                    >
                      Create Linked General Tender
                    </Button>
                  ) : (
                    <p className="text-[11px] text-[#4A5568] italic">
                      Management, Regional Managers, the Tender Team or Admin create the linked General tender.
                    </p>
                  )}
                </Card>

                <Card className="p-4 space-y-2 border-[#DCD8CE]">
                  <h5 className="font-semibold text-xs text-[#0F5E63]">Won Tender to Sales Order Conversion</h5>
                  <p className="text-[11px] text-[#4A5568]">
                    Automatically populates Deliveries & Sales Pipeline with awarded items, customer site, and warranty terms.
                  </p>
                  {!['won', 'WON'].includes(tender.status) ? (
                    <p className="text-[11px] text-[#4A5568] italic">Available when the tender is Won.</p>
                  ) : hasSalesOrder ? (
                    // Already raised (logged on the timeline): a second order for the same PO / LoA is refused with 409.
                    <p className="text-[11px] text-[#0B4A4E] font-semibold flex items-center gap-1">
                      <CheckCircle2 className="h-3.5 w-3.5" /> Sales Order created — see Deliveries below.
                    </p>
                  ) : can('salesOrder') ? (
                    <div className="space-y-1.5">
                      <Button
                        variant="success"
                        size="sm"
                        onClick={startSalesOrder}
                        isLoading={isCreatingSalesOrder}
                        leftIcon={<ShoppingBag className="h-3.5 w-3.5" />}
                      >
                        Create Sales Order
                      </Button>
                      <p className="text-[11px] text-[#4A5568]">
                        {awardOrderRef ? (
                          <>
                            PO / LoA reference: <span className="font-mono text-[#14213D]">{awardOrderRef}</span>
                          </>
                        ) : (
                          'No PO / LoA reference was recorded with the result; you will be asked for it.'
                        )}
                      </p>
                      {salesOrderError && !isSalesOrderOpen && (
                        <InfoCallout variant="danger" title="Sales Order not created" onClose={() => setSalesOrderError(null)}>
                          {salesOrderError}
                        </InfoCallout>
                      )}
                    </div>
                  ) : (
                    <p className="text-[11px] text-[#4A5568] italic">Your role cannot raise Sales Orders.</p>
                  )}
                </Card>
              </div>

              <RelatedRecords
                to={{ kind: 'tender', id: tender.id, organisationId: tender.organisation_id }}
                sections={['demos', 'deliveries', 'tasks', 'proposals', 'service']}
                description="Demos run for this bid, sales orders raised from it, its tasks, and the buyer's proposals and service tickets."
                refreshKey={linkedRefresh}
              />
            </div>
          )}

          {/* TAB 11: AUDIT TIMELINE */}
          {activeTab === 'history' && (
            <div className="space-y-3">
              <div>
                <h4 className="font-serif font-bold text-sm text-[#14213D]">Immutable Audit Log & Stage Transitions</h4>
                <p className="text-[11px] text-[#4A5568]">Zero tampering: every status transition, approval, and deadline edit is timestamped.</p>
              </div>

              {tender.activities && tender.activities.length > 0 ? (
                <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                  {tender.activities.map((act: any) => (
                    <div key={act.id} className="flex items-start space-x-2.5 p-2.5 rounded-lg bg-[#FBFAF7] border border-[#ECE9E2]">
                      <div className="h-2 w-2 rounded-full bg-[#0F5E63] mt-1.5 shrink-0" />
                      <div className="space-y-0.5 flex-1">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="font-bold text-[#14213D]" title={act.event_type}>{activityLabel(act.event_type)}</span>
                          <span className="font-mono text-[#4A5568]">{formatTaskDateTime(act.created_at)}</span>
                        </div>
                        <p className="text-xs text-[#4A5568]">{act.description}</p>
                        {act.performed_by_name && (
                          <p className="text-[10px] text-[#0F5E63]">By: {act.performed_by_name}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState title="No timeline entries logged yet" description="All future actions will appear in this chronological log." />
              )}
            </div>
          )}
        </div>
      ) : null}

      {/* Sub-Modal: Add Line Item */}
      <Modal
        isOpen={isAddLineItemOpen}
        onClose={() => setIsAddLineItemOpen(false)}
        title="Add Product Line Item"
        maxWidth="lg"
      >
        <div className="space-y-5 text-xs">
          {lineItemError && (
            <InfoCallout variant="danger" onClose={() => setLineItemError(null)}>
              {lineItemError}
            </InfoCallout>
          )}
          <FormSection title="Product" icon={<ShoppingBag />} description="What is being quoted and its key specifications.">
            <Input
              label="Product Description / Name"
              value={newLineItem.product_description}
              onChange={(e) => setNewLineItem({ ...newLineItem, product_description: e.target.value })}
              placeholder="e.g. Thermal Night Vision Sensor Model T-40"
              required
            />
            <Textarea
              label="Technical Specifications Summary"
              value={newLineItem.specification_summary}
              onChange={(e) => setNewLineItem({ ...newLineItem, specification_summary: e.target.value })}
              placeholder="Key technical capabilities and MIL-STD compliance..."
            />
          </FormSection>
          <FormSection title="Quantity & Price" icon={<DollarSign />}>
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Quantity"
                type="number"
                min="1"
                step="any"
                value={newLineItem.quantity}
                onChange={(e) => setNewLineItem({ ...newLineItem, quantity: Number(e.target.value) })}
                required
              />
              <Input
                label="Unit"
                value={newLineItem.unit}
                onChange={(e) => setNewLineItem({ ...newLineItem, unit: e.target.value })}
                placeholder="Units, Nos, Sets"
              />
            </div>
            <Input
              label="Quoted Unit Price (INR)"
              type="number"
              min="0"
              value={newLineItem.quoted_unit_price}
              onChange={(e) => setNewLineItem({ ...newLineItem, quoted_unit_price: e.target.value })}
              placeholder="e.g. 150000"
              helperText={
                Number(newLineItem.quantity) >= 1 && newLineItem.quoted_unit_price !== '' && Number(newLineItem.quoted_unit_price) >= 0
                  ? `Quoted total: ${formatINR(Number(newLineItem.quantity) * Number(newLineItem.quoted_unit_price))}`
                  : 'Quoted total = quantity × unit price.'
              }
            />
          </FormSection>
          <div className="flex justify-end space-x-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => setIsAddLineItemOpen(false)}>Cancel</Button>
            <Button variant="primary" size="sm" onClick={handleAddLineItem} isLoading={actionLoading}>Save Line Item</Button>
          </div>
        </div>
      </Modal>

      {/* Sub-Modal: Confirm line item removal (in-app, never a browser confirm) */}
      <Modal
        isOpen={Boolean(lineItemToDelete)}
        onClose={() => setLineItemToDelete(null)}
        title="Remove line item?"
        description={lineItemToDelete?.product_name || lineItemToDelete?.product_description || undefined}
        maxWidth="sm"
      >
        <div className="space-y-4 text-xs">
          <p className="text-[#4A5568]">
            The line ({lineItemToDelete?.quantity} {lineItemToDelete?.unit || 'Nos'}) is removed from this tender's BOQ. The removal is
            recorded in the audit timeline.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setLineItemToDelete(null)}>
              Cancel
            </Button>
            <Button variant="danger" size="sm" isLoading={actionLoading} onClick={handleDeleteLineItem}>
              Remove line item
            </Button>
          </div>
        </div>
      </Modal>

      {/* Sub-Modal: Add Corrigendum */}
      <Modal
        isOpen={isCorrigendumOpen}
        onClose={() => setIsCorrigendumOpen(false)}
        title="Issue Corrigendum & Update Deadline"
        maxWidth="md"
      >
        <div className="space-y-3 text-xs">
          {corrigendumError && (
            <InfoCallout variant="danger" onClose={() => setCorrigendumError(null)}>
              {corrigendumError}
            </InfoCallout>
          )}
          <Input
            label="Corrigendum Number"
            value={newCorrigendum.corrigendum_number}
            onChange={(e) => setNewCorrigendum({ ...newCorrigendum, corrigendum_number: e.target.value })}
            placeholder="e.g. CORR-01/2026"
            required
          />
          <Input
            label="New Submission Deadline (IST)"
            type="datetime-local"
            min={istNowLocalInput()}
            value={newCorrigendum.new_deadline}
            onChange={(e) => setNewCorrigendum({ ...newCorrigendum, new_deadline: e.target.value })}
            required
          />
          <Textarea
            label="Corrigendum Summary / Justification"
            value={newCorrigendum.summary}
            onChange={(e) => setNewCorrigendum({ ...newCorrigendum, summary: e.target.value })}
            placeholder="Reason for extension or specification change..."
          />
          <div className="flex justify-end space-x-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => setIsCorrigendumOpen(false)}>Cancel</Button>
            <Button variant="primary" size="sm" onClick={handleAddCorrigendum} isLoading={actionLoading}>Record Corrigendum</Button>
          </div>
        </div>
      </Modal>

      {/* Sub-Modal: Add Financial Instrument */}
      <Modal
        isOpen={isInstrumentOpen}
        onClose={() => setIsInstrumentOpen(false)}
        title="Request Financial Instrument (EMD / PBG)"
        maxWidth="md"
      >
        <div className="space-y-3 text-xs">
          {instrumentError && (
            <InfoCallout variant="danger" onClose={() => setInstrumentError(null)}>
              {instrumentError}
            </InfoCallout>
          )}
          <Select
            label="Instrument Type"
            value={newInstrument.instrument_type}
            onChange={(e) => setNewInstrument({ ...newInstrument, instrument_type: e.target.value })}
            options={[
              { value: 'EMD', label: 'Earnest Money Deposit (EMD)' },
              { value: 'PBG', label: 'Performance Bank Guarantee (PBG)' },
              { value: 'Tender Fee', label: 'Tender Document Fee' },
              { value: 'Security Deposit', label: 'Security Deposit' },
            ]}
          />
          <Input
            label="Amount (INR)"
            type="number"
            min="1"
            value={newInstrument.amount}
            onChange={(e) => setNewInstrument({ ...newInstrument, amount: e.target.value })}
            placeholder="e.g. 500000"
            required
          />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Select
              label="Mode"
              value={newInstrument.mode}
              onChange={(e) => setNewInstrument({ ...newInstrument, mode: e.target.value })}
              options={[
                { value: 'DD', label: 'Demand Draft (DD)' },
                { value: 'BG', label: 'Bank Guarantee (BG)' },
                { value: 'Online', label: 'Online Portal Gateway' },
                { value: 'Exempted', label: 'MSE / Startup Exemption' },
              ]}
            />
            <Input
              label="Bank"
              value={newInstrument.bank}
              onChange={(e) => setNewInstrument({ ...newInstrument, bank: e.target.value })}
              placeholder="e.g. State Bank of India"
            />
          </div>
          <div className="flex justify-end space-x-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => setIsInstrumentOpen(false)}>Cancel</Button>
            <Button variant="primary" size="sm" onClick={handleAddInstrument} isLoading={actionLoading}>Submit to Finance</Button>
          </div>
        </div>
      </Modal>

      {/* Sub-modal: Reassign Team */}
      {isReassignOpen && (
        <Modal
          isOpen={isReassignOpen}
          onClose={() => setIsReassignOpen(false)}
          title="Reassign Tender Team"
          description="Designate executive ownership and field sales responsibility for this tender."
          maxWidth="md"
        >
          <form onSubmit={handleSaveReassign} className="space-y-4">
            <div className="space-y-3 text-xs">
              {reassignError && (
                <InfoCallout variant="danger" title="Team not updated" onClose={() => setReassignError(null)}>
                  {reassignError}
                </InfoCallout>
              )}
              <div>
                <Select
                  label="Assigned Salesperson"
                  placeholder="-- Select Assigned Salesperson --"
                  helperText="Ground executive managing client meetings, QRs, trials & depot demos."
                  value={reassignSalesperson}
                  onChange={(e) => setReassignSalesperson(e.target.value)}
                >
                  <option value="">-- Unassigned (None) --</option>
                  {userList.map((u) => (
                    <option key={u.id} value={u.id}>
                      {userWithRole(u)}
                    </option>
                  ))}
                </Select>
              </div>

              <div>
                <Select
                  label="Tender Owner (Responsible Executive)"
                  placeholder="-- Select Tender Owner --"
                  helperText="Accountable executive for bid review, approvals & GeM submission."
                  value={reassignOwner}
                  onChange={(e) => setReassignOwner(e.target.value)}
                >
                  <option value="">-- Unassigned (None) --</option>
                  {userList.map((u) => (
                    <option key={u.id} value={u.id}>
                      {userWithRole(u)}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="p-3 rounded-lg bg-[#FBFAF7] border border-[#ECE9E2] space-y-1.5 text-[11px] text-[#4A5568]">
                <p className="font-semibold text-[#14213D]">Operational Roles Definition:</p>
                <p>• <span className="font-medium text-[#14213D]">Assigned Salesperson</span>: In-person client meetings, pre-bid conferences, MHA QR clarifications, equipment demo requests, and competitor L1 rate collection.</p>
                <p>• <span className="font-medium text-[#14213D]">Tender Owner</span>: Executive strategy, internal review submission, bank guarantees (EMD/PBG), and portal bid execution.</p>
              </div>
            </div>

            <div className="pt-2 flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setIsReassignOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" isLoading={isReassigning}>
                Update Team Assignment
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* Sub-modal: PQ → linked General tender (CreateLinkedTenderDto requires number, title and submission deadline) */}
      <Modal
        isOpen={isLinkedTenderOpen}
        onClose={() => {
          if (!isCreatingLinkedTender) setIsLinkedTenderOpen(false);
        }}
        title="Create Linked General Tender"
        description="The main General bid that follows this PQ. Line items are copied and its document checklist is initialised."
        maxWidth="md"
      >
        <form onSubmit={handleCreateLinkedTender} className="space-y-3 text-xs">
          {linkedTenderError && (
            <InfoCallout variant="danger" title="Tender not created" onClose={() => setLinkedTenderError(null)}>
              {linkedTenderError}
            </InfoCallout>
          )}
          <Input
            label="Tender Number"
            value={linkedTenderForm.tender_number}
            onChange={(e) => setLinkedTenderForm({ ...linkedTenderForm, tender_number: e.target.value })}
            placeholder="e.g. GEM/2026/B/1234567"
            className="font-mono"
            required
          />
          <Input
            label="Tender Title"
            value={linkedTenderForm.tender_title}
            onChange={(e) => setLinkedTenderForm({ ...linkedTenderForm, tender_title: e.target.value })}
            required
          />
          <Input
            label="Submission Deadline (IST)"
            type="datetime-local"
            min={istNowLocalInput()}
            value={linkedTenderForm.submission_deadline}
            onChange={(e) => setLinkedTenderForm({ ...linkedTenderForm, submission_deadline: e.target.value })}
            helperText="Bid closing date and time on the portal, in IST."
            required
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" size="sm" disabled={isCreatingLinkedTender} onClick={() => setIsLinkedTenderOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" size="sm" isLoading={isCreatingLinkedTender} leftIcon={<ArrowRight className="h-3.5 w-3.5" />}>
              Create General Tender
            </Button>
          </div>
        </form>
      </Modal>

      {/* Sub-modal: Sales Order PO / LoA reference (asked only when the recorded result has none) */}
      <Modal
        isOpen={isSalesOrderOpen}
        onClose={() => {
          if (!isCreatingSalesOrder) setIsSalesOrderOpen(false);
        }}
        title="Create Sales Order"
        description="The buyer's PO / LoA number becomes the delivery's order reference."
        maxWidth="sm"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!salesOrderRef.trim()) {
              setSalesOrderError('Enter the PO / LoA reference number issued by the buyer.');
              return;
            }
            handleCreateSalesOrder(salesOrderRef);
          }}
          className="space-y-3 text-xs"
        >
          {salesOrderError && (
            <InfoCallout variant="danger" title="Sales Order not created" onClose={() => setSalesOrderError(null)}>
              {salesOrderError}
            </InfoCallout>
          )}
          <Input
            label="PO / LoA Reference Number"
            value={salesOrderRef}
            onChange={(e) => {
              setSalesOrderRef(e.target.value);
              setSalesOrderError(null);
            }}
            placeholder="e.g. GEMC-511687712345678"
            className="font-mono"
            required
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" size="sm" disabled={isCreatingSalesOrder} onClick={() => setIsSalesOrderOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="success" size="sm" isLoading={isCreatingSalesOrder} leftIcon={<ShoppingBag className="h-3.5 w-3.5" />}>
              Create Sales Order
            </Button>
          </div>
        </form>
      </Modal>
    </Modal>
  );
}
