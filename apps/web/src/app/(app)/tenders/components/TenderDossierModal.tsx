'use client';

import React, { useState, useEffect } from 'react';
import {
  Modal,
  Button,
  Badge,
  Card,
  Input,
  Select,
  Textarea,
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
  InfoCallout,
  EmptyState,
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
} from 'lucide-react';
import { api } from '@/lib/api';

interface TenderDossierModalProps {
  isOpen: boolean;
  onClose: () => void;
  tenderId: string | null;
  currentUser: any;
  users?: any[];
  onTenderUpdated?: () => void;
}

export function TenderDossierModal({
  isOpen,
  onClose,
  tenderId,
  currentUser,
  users,
  onTenderUpdated,
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

  const canReassign =
    ['management', 'admin', 'tender_team', 'regional_manager'].includes(currentUser?.role) ||
    tender?.tender_owner_id === currentUser?.id ||
    tender?.owner === currentUser?.id;

  const handleOpenReassign = () => {
    setReassignSalesperson(tender?.assigned_to || tender?.assigned_person_id || '');
    setReassignOwner(tender?.tender_owner_id || tender?.owner || '');
    setIsReassignOpen(true);
  };

  const handleSaveReassign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tender?.id) return;
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
      setFeedbackMsg({ type: 'error', text: err?.message || 'Failed to update team assignment.' });
    } finally {
      setIsReassigning(false);
    }
  };
  const [activeTab, setActiveTab] = useState<
    | 'overview'
    | 'line_items'
    | 'approvals'
    | 'transitions'
    | 'documents'
    | 'corrigenda'
    | 'finance'
    | 'portal_issues'
    | 'discussion'
    | 'result'
    | 'linked'
    | 'timeline'
  >('overview');

  // Lifecycle Transitions state
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [selectedNextStatus, setSelectedNextStatus] = useState<string>('');
  const [transitionNotes, setTransitionNotes] = useState<string>('');
  const [portalSubmissionDate, setPortalSubmissionDate] = useState<string>(
    new Date().toISOString().split('T')[0]
  );

  const handlePerformTransition = async (targetStatus: string, defaultRemarks?: string) => {
    if (!tender?.id) return;
    setIsTransitioning(true);
    setFeedbackMsg(null);
    try {
      await api.post(`/tenders/${tender.id}/transitions`, {
        target_status: targetStatus,
        remarks: transitionNotes || defaultRemarks || `Transitioned to ${targetStatus.replace(/_/g, ' ')}`,
        submission_date: targetStatus === 'submitted' ? portalSubmissionDate : undefined,
      });
      setFeedbackMsg({
        type: 'success',
        text: `Tender successfully advanced to ${targetStatus.replace(/_/g, ' ').toUpperCase()}.`,
      });
      setSelectedNextStatus('');
      setTransitionNotes('');
      await loadTender();
      onTenderUpdated?.();
    } catch (err: any) {
      setFeedbackMsg({
        type: 'error',
        text: err?.message || 'Failed to transition tender stage.',
      });
    } finally {
      setIsTransitioning(false);
    }
  };

  const getAllowedDossierTransitions = (status: string, category: string) => {
    const norm = (status || '').toLowerCase();
    const isPq = (category || '').toLowerCase().includes('pq');

    switch (norm) {
      case 'identified':
        return [
          {
            status: 'awaiting_approval',
            label: 'Submit for Internal Approval',
            variant: 'primary' as const,
            description: 'Request executive review & participation clearance from Management.',
            defaultRemarks: 'Submitted tender for executive management review.',
          },
        ];
      case 'awaiting_approval':
      case 'under_review':
        return [];
      case 'under_preparation':
        if (isPq) {
          return [
            {
              status: 'pq_submitted',
              label: 'Submit Pre-Qualification (PQ)',
              variant: 'primary' as const,
              description: 'Record PQ eligibility dossier uploaded on GeM/CPPP portal.',
              defaultRemarks: 'Pre-qualification dossier submitted on government portal.',
            },
            {
              status: 'submitted',
              label: 'Submit Bid Directly',
              variant: 'secondary' as const,
              description: 'Advance directly if PQ was bypassed or already cleared.',
              defaultRemarks: 'Technical and commercial bids submitted.',
            },
            {
              status: 'on_hold',
              label: 'Put On Hold',
              variant: 'warning' as const,
              description: 'Temporarily freeze preparation pending departmental clarifications.',
              defaultRemarks: 'Put on hold pending clarifications.',
            },
          ];
        }
        return [
          {
            status: 'submitted',
            label: 'Submit Tender Bid',
            variant: 'primary' as const,
            description: 'Upload encrypted technical & financial envelopes on GeM.',
            defaultRemarks: 'Tender bids uploaded to GeM with digital signature token.',
          },
          {
            status: 'on_hold',
            label: 'Put On Hold',
            variant: 'warning' as const,
            description: 'Temporarily freeze preparation.',
            defaultRemarks: 'Put on hold pending clarifications.',
          },
        ];
      case 'pq_submitted':
        return [
          {
            status: 'pq_qualified',
            label: 'Mark PQ Qualified',
            variant: 'success' as const,
            description: 'Buyer committee accepted credentials; eligible for commercial bidding.',
            defaultRemarks: 'Buyer published PQ minutes; Arihant officially qualified.',
          },
          {
            status: 'lost',
            label: 'Mark PQ Disqualified / Lost',
            variant: 'danger' as const,
            description: 'Buyer rejected credentials during pre-qualification screening.',
            defaultRemarks: 'Disqualified in PQ screening.',
          },
          {
            status: 'on_hold',
            label: 'Put On Hold',
            variant: 'warning' as const,
            description: 'Pre-qualification proceedings stayed or extended.',
            defaultRemarks: 'PQ evaluation delayed by department.',
          },
        ];
      case 'pq_qualified':
        return [
          {
            status: 'submitted',
            label: 'Submit Commercial & Technical Envelopes',
            variant: 'primary' as const,
            description: 'Submit main price envelopes on portal.',
            defaultRemarks: 'Commercial envelope submitted on portal following PQ clearance.',
          },
          {
            status: 'under_preparation',
            label: 'Return to Preparation',
            variant: 'secondary' as const,
            description: 'Assemble additional compliance items.',
            defaultRemarks: 'Returned to preparation.',
          },
        ];
      case 'submitted':
        return [
          {
            status: 'technical_eval',
            label: 'Enter Technical Evaluation',
            variant: 'primary' as const,
            description: 'Buyer opened technical envelope; sample trials & tests active.',
            defaultRemarks: 'Technical evaluation initiated by buyer.',
          },
          {
            status: 'commercial_eval',
            label: 'Enter Commercial Evaluation',
            variant: 'secondary' as const,
            description: 'Direct commercial opening.',
            defaultRemarks: 'Commercial envelopes opened.',
          },
          {
            status: 'lost',
            label: 'Disqualified in Preliminary Screening',
            variant: 'danger' as const,
            description: 'Rejected before technical committee.',
            defaultRemarks: 'Disqualified in preliminary evaluation.',
          },
        ];
      case 'technical_eval':
        return [
          {
            status: 'commercial_eval',
            label: 'Advance to Commercial Evaluation',
            variant: 'primary' as const,
            description: 'Technical compliance and field trials successfully cleared.',
            defaultRemarks: 'Technical evaluation and trial report cleared; commercial opened.',
          },
          {
            status: 'lost',
            label: 'Disqualified in Technical Evaluation',
            variant: 'danger' as const,
            description: 'Field trial or spec non-compliance rejection.',
            defaultRemarks: 'Disqualified during technical evaluation.',
          },
        ];
      case 'commercial_eval':
        return [
          {
            status: 'won',
            label: 'Declare L1 & Won',
            variant: 'success' as const,
            description: 'Arihant awarded lowest bidder; contract award confirmed.',
            defaultRemarks: 'Declared L1 bidder and contract awarded.',
          },
          {
            status: 'lost',
            label: 'Declare L2 / Lost',
            variant: 'danger' as const,
            description: 'Competitor placed lower bid or won contract.',
            defaultRemarks: 'Lost in commercial evaluation to competitor.',
          },
        ];
      case 'on_hold':
        return [
          {
            status: 'under_preparation',
            label: 'Resume Preparation',
            variant: 'primary' as const,
            description: 'Remove hold and resume bid preparation.',
            defaultRemarks: 'Hold lifted; resumed preparation.',
          },
          {
            status: 'cancelled',
            label: 'Cancel Tender',
            variant: 'danger' as const,
            description: 'Formally withdraw or cancel bid.',
            defaultRemarks: 'Tender cancelled by department or withdrawn.',
          },
        ];
      default:
        return [];
    }
  };

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

  const [isCorrigendumOpen, setIsCorrigendumOpen] = useState(false);
  const [newCorrigendum, setNewCorrigendum] = useState({
    corrigendum_number: '',
    new_deadline: '',
    summary: '',
  });

  const [isInstrumentOpen, setIsInstrumentOpen] = useState(false);
  const [newInstrument, setNewInstrument] = useState({
    instrument_type: 'EMD',
    amount: '',
    mode: 'DD',
    bank: '',
    reference_number: '',
    status: 'Requested',
  });

  const [isCommentSubmitting, setIsCommentSubmitting] = useState(false);
  const [commentText, setCommentText] = useState('');

  // Document checklist enhancement state
  const [attachingDocId, setAttachingDocId] = useState<string | null>(null);
  const [attachedFileName, setAttachedFileName] = useState<string>('');
  const [attachedDriveUrl, setAttachedDriveUrl] = useState<string>('');
  const [driveFolderUrl, setDriveFolderUrl] = useState<string>('');
  const [isEditingDriveFolder, setIsEditingDriveFolder] = useState<boolean>(false);
  const [isSavingDriveFolder, setIsSavingDriveFolder] = useState<boolean>(false);
  const [isAddCustomDocOpen, setIsAddCustomDocOpen] = useState(false);
  const [newCustomDoc, setNewCustomDoc] = useState({
    document_type: '',
    is_mandatory: true,
    owner_id: '',
    status: 'In Progress',
    file_url: '',
  });

  const [actionLoading, setActionLoading] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

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
      setDecisionError(
        err?.response?.data?.message || err?.message || 'Failed to submit decision.',
      );
    } finally {
      setIsSubmittingDecision(false);
    }
  };

  useEffect(() => {
    if (isOpen && tenderId) {
      setAttachingDocId(null);
      setAttachedFileName('');
      setAttachedDriveUrl('');
      setIsEditingDriveFolder(false);
      loadTender();
    } else {
      setTender(null);
      setFeedbackMsg(null);
    }
  }, [isOpen, tenderId]);

  const loadTender = async () => {
    if (!tenderId) return;
    setLoading(true);
    try {
      const res = await api.get<any>(`/tenders/${tenderId}`);
      setTender(res);
      setDriveFolderUrl(res?.tender_url || '');
    } catch (err: any) {
      setFeedbackMsg({ type: 'error', text: err?.message || 'Failed to load tender specifications' });
    } finally {
      setLoading(false);
    }
  };

  const handleAddLineItem = async () => {
    if (!tenderId) return;
    setActionLoading(true);
    try {
      await api.post(`/tenders/${tenderId}/line-items`, {
        ...newLineItem,
        quantity: Number(newLineItem.quantity),
        quoted_unit_price: newLineItem.quoted_unit_price ? Number(newLineItem.quoted_unit_price) : undefined,
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
      setFeedbackMsg({ type: 'error', text: err?.message || 'Failed to add line item' });
    } finally {
      setActionLoading(false);
    }
  };

  const handleInitChecklist = async () => {
    if (!tenderId) return;
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
    if (!tenderId) return;
    const urlToSave = (overrideUrl !== undefined ? overrideUrl : driveFolderUrl).trim();
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
      setFeedbackMsg({ type: 'error', text: err?.message || 'Failed to update Google Drive folder link' });
    } finally {
      setIsSavingDriveFolder(false);
    }
  };

  const handleAttachFile = async (docId: string) => {
    if (!tenderId) return;
    const finalUrl = attachedDriveUrl.trim();
    const finalName = attachedFileName.trim() || (finalUrl ? 'Google Drive Document' : '');
    if (!finalName && !finalUrl) return;

    try {
      await api.patch(`/tenders/${tenderId}/documents/${docId}`, {
        file_name: finalName || 'Drive Document.pdf',
        file_url: finalUrl || undefined,
        status: 'Ready',
      });
      setAttachingDocId(null);
      setAttachedFileName('');
      setAttachedDriveUrl('');
      await loadTender();
      onTenderUpdated?.();
      setFeedbackMsg({
        type: 'success',
        text: `Document "${finalName}" linked successfully and marked Ready.`,
      });
    } catch (err: any) {
      setFeedbackMsg({ type: 'error', text: err?.message || 'Failed to attach file' });
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

  const handleAddCustomDoc = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenderId || !newCustomDoc.document_type.trim()) return;
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
      setFeedbackMsg({ type: 'error', text: err?.message || 'Failed to add document' });
    }
  };

  const handleAddCorrigendum = async () => {
    if (!tenderId) return;
    setActionLoading(true);
    try {
      await api.post(`/tenders/${tenderId}/corrigenda`, newCorrigendum);
      setIsCorrigendumOpen(false);
      setNewCorrigendum({ corrigendum_number: '', new_deadline: '', summary: '' });
      await loadTender();
      onTenderUpdated?.();
      setFeedbackMsg({ type: 'success', text: 'Corrigendum recorded and deadline updated' });
    } catch (err: any) {
      setFeedbackMsg({ type: 'error', text: err?.message || 'Failed to record corrigendum' });
    } finally {
      setActionLoading(false);
    }
  };

  const handleAddInstrument = async () => {
    if (!tenderId) return;
    setActionLoading(true);
    try {
      await api.post(`/tenders/${tenderId}/financial-instruments`, {
        ...newInstrument,
        amount: Number(newInstrument.amount),
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
      setFeedbackMsg({ type: 'success', text: 'Financial instrument request registered' });
    } catch (err: any) {
      setFeedbackMsg({ type: 'error', text: err?.message || 'Failed to request financial instrument' });
    } finally {
      setActionLoading(false);
    }
  };

  const handlePostComment = async () => {
    if (!tenderId || !commentText.trim()) return;
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

  const handleCreateLinkedTender = async () => {
    if (!tenderId || !tender) return;
    setActionLoading(true);
    try {
      const res = await api.post<any>(`/tenders/${tenderId}/create-linked-tender`, {
        tender_number: `${tender.tender_number || tender.tender_no}-GEN`,
        tender_title: `${tender.tender_title || 'Tender'} (Main General Bid)`,
      });
      setFeedbackMsg({
        type: 'success',
        text: `General Bid created successfully: Ref ${res.internal_ref || res.tender_number}`,
      });
      onTenderUpdated?.();
    } catch (err: any) {
      setFeedbackMsg({ type: 'error', text: err?.message || 'Failed to generate linked General tender' });
    } finally {
      setActionLoading(false);
    }
  };

  const handleCreateSalesOrder = async () => {
    if (!tenderId || !tender) return;
    setActionLoading(true);
    try {
      const res = await api.post<any>(`/tenders/${tenderId}/create-sales-order`, {
        order_number: `SO-${tender.tender_number || tender.tender_no}`,
        delivery_terms: 'F.O.R Destination within 60 days',
      });
      setFeedbackMsg({
        type: 'success',
        text: `Sales Order registered in Deliveries pipeline: Ref ${res.sales_order?.delivery_no || res.order_number}`,
      });
      onTenderUpdated?.();
    } catch (err: any) {
      setFeedbackMsg({ type: 'error', text: err?.message || 'Failed to create sales order' });
    } finally {
      setActionLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={tender?.tender_title || tender?.tender_number || 'Tender Dossier & Lifecycle'}
      description={`Reference: ${tender?.internal_ref || 'TND-2026-00000'} • Portal: ${tender?.portal || 'GeM'} • Buyer: ${tender?.organisation_name || tender?.organisation || 'Direct Government Department'}`}
      maxWidth="4xl"
    >
      {loading ? (
        <div className="py-20 flex flex-col items-center justify-center space-y-3">
          <RefreshCw className="h-8 w-8 text-[#0F5E63] animate-spin" />
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
          <div className="p-4 rounded-xl bg-gradient-to-r from-[#14213D] to-[#1F2E52] text-white flex flex-wrap items-center justify-between gap-4 shadow-sm">
            <div className="space-y-1">
              <div className="flex items-center space-x-2">
                <span className="font-mono text-sm font-bold text-[#F2B872]">
                  {tender.internal_ref || 'TND-2026-00000'}
                </span>
                <span className="text-white/40">•</span>
                <span className="font-semibold text-white/90">{tender.tender_number || tender.tender_no}</span>
                <Badge
                  variant={
                    tender.category === 'pq' ? 'cyber' : tender.category === 'mha' ? 'warning' : 'default'
                  }
                  size="sm"
                >
                  {tender.category ? tender.category.toUpperCase() : 'GENERAL'}
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
              <p className="text-xs text-white/70 line-clamp-1">{tender.tender_title || tender.requirement_text || 'Standard Tender Supply Specification'}</p>
            </div>

            <div className="flex items-center space-x-3">
              {tender.tender_url && (
                <a
                  href={tender.tender_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-[#F2B872] border border-white/20 text-xs font-semibold transition-colors shadow-xs"
                  title={`Open Google Drive Workspace: ${tender.tender_url}`}
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  <span>Drive Workspace ↗</span>
                </a>
              )}
              <div className="text-right">
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

              {tender.days_left !== null && tender.days_left !== undefined && (
                <div className="p-2 rounded-lg bg-white/10 text-center min-w-[70px] border border-white/15">
                  <span className="text-[10px] text-white/70 block uppercase font-bold">Deadline</span>
                  <span
                    className={`font-mono text-xs font-bold ${
                      tender.days_left <= 2 ? 'text-red-300 animate-pulse' : 'text-[#F2B872]'
                    }`}
                  >
                    {tender.days_left < 0 ? 'Overdue' : `${tender.days_left}d left`}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* 11 Dossier Tabs Strip */}
          <div className="flex border-b border-[#DCD8CE] overflow-x-auto gap-1 pb-1 scrollbar-none select-none">
            {[
              { id: 'overview', label: 'Overview', icon: <FileText className="h-3.5 w-3.5" /> },
              {
                id: 'line_items',
                label: `Line Items (${tender.line_items?.length || 0})`,
                icon: <ShoppingBag className="h-3.5 w-3.5" />,
              },
              {
                id: 'approvals',
                label: 'Approvals',
                icon: <CheckCircle2 className="h-3.5 w-3.5" />,
                badge: tender.approvals?.length || null,
              },
              {
                id: 'transitions',
                label: 'Lifecycle & Transitions',
                icon: <ArrowRight className="h-3.5 w-3.5" />,
              },
              {
                id: 'documents',
                label: `Documents (${tender.document_completion_percentage ?? 0}%)`,
                icon: <Paperclip className="h-3.5 w-3.5" />,
              },
              {
                id: 'corrigenda',
                label: `Corrigenda (${tender.corrigenda?.length || 0})`,
                icon: <Clock className="h-3.5 w-3.5" />,
              },
              {
                id: 'finance',
                label: 'EMD / PBG',
                icon: <DollarSign className="h-3.5 w-3.5" />,
              },
              {
                id: 'portal_issues',
                label: `Portal Issues (${tender.portal_issues?.length || 0})`,
                icon: <AlertTriangle className="h-3.5 w-3.5" />,
              },
              {
                id: 'discussion',
                label: `Discussion (${tender.comments?.length || 0})`,
                icon: <MessageSquare className="h-3.5 w-3.5" />,
              },
              { id: 'result', label: 'Win / Loss', icon: <ShieldAlert className="h-3.5 w-3.5" /> },
              { id: 'linked', label: 'Linked Records', icon: <Layers className="h-3.5 w-3.5" /> },
              { id: 'timeline', label: 'Audit Timeline', icon: <Calendar className="h-3.5 w-3.5" /> },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id as any)}
                className={`flex items-center space-x-1.5 px-3 py-2 text-xs font-semibold rounded-t-lg transition-all border-b-2 whitespace-nowrap cursor-pointer ${
                  activeTab === tab.id
                    ? 'border-[#0F5E63] text-[#0F5E63] bg-white shadow-xs'
                    : 'border-transparent text-[#4A5568] hover:text-[#14213D] hover:bg-white/50'
                }`}
              >
                {tab.icon}
                <span>{tab.label}</span>
              </button>
            ))}
          </div>

          {/* TAB 1: OVERVIEW */}
          {activeTab === 'overview' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <Card className="p-3.5 space-y-2 border-[#DCD8CE]">
                  <span className="text-[10px] font-bold text-[#4A5568] uppercase block">Authority & Location</span>
                  <div className="space-y-1">
                    <p className="font-semibold text-xs text-[#14213D]">{tender.organisation_name || tender.organisation}</p>
                    <p className="text-[11px] text-[#4A5568]">{tender.department || 'General Administration'}</p>
                    <p className="text-[11px] text-[#4A5568]">
                      {tender.city || 'Delhi'}, {tender.state || 'Delhi'} • Region: {tender.region_name || 'North'}
                    </p>
                    {tender.tender_url && (
                      <p className="text-[11px] text-[#4A5568] flex items-center gap-1">
                        Drive Workspace:{' '}
                        <a
                          href={tender.tender_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-semibold text-[#0F5E63] hover:underline inline-flex items-center gap-0.5"
                        >
                          <span>Open Folder</span>
                          <ExternalLink className="w-2.5 h-2.5" />
                        </a>
                      </p>
                    )}
                  </div>
                </Card>

                <Card className="p-3.5 space-y-2 border-[#DCD8CE]">
                  <span className="text-[10px] font-bold text-[#4A5568] uppercase block">Key Milestones</span>
                  <div className="space-y-1 font-mono text-[11px]">
                    <p className="text-[#4A5568]">
                      Published: <span className="font-bold text-[#14213D]">{tender.publication_date || 'N/A'}</span>
                    </p>
                    <p className="text-[#4A5568]">
                      Deadline:{' '}
                      <span className="font-bold text-[#9A3412]">
                        {tender.submission_deadline ? new Date(tender.submission_deadline).toLocaleString('en-IN') : 'N/A'}
                      </span>
                    </p>
                    {tender.pre_bid_meeting_date && (
                      <p className="text-[#4A5568]">
                        Pre-Bid: <span className="font-medium text-[#14213D]">{new Date(tender.pre_bid_meeting_date).toLocaleString('en-IN')}</span>
                      </p>
                    )}
                  </div>
                </Card>

                <Card className="p-3.5 space-y-2 border-[#DCD8CE]">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-[#4A5568] uppercase block">Financials & Team</span>
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
                  >
                    {(tender.status || 'IDENTIFIED').replace(/_/g, ' ').toUpperCase()}
                  </Badge>
                </div>

                {decisionError && (
                  <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                    {decisionError}
                  </div>
                )}

                {isMgmtOrAdmin ? (
                  ['identified', 'awaiting_approval', 'awaiting_internal_approval'].includes((tender.status || '').toLowerCase()) ? (
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
                  ) : (
                    <div className="p-3.5 rounded-xl bg-[#FBFAF7] border border-[#ECE9E2] space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <CheckCircle2 className="w-4 h-4 text-[#0F5E63]" />
                          <span className="text-xs font-bold text-[#14213D]">
                            Decision Recorded: {(tender.status || '').replace(/_/g, ' ').toUpperCase()}
                          </span>
                        </div>
                        {tender.internal_approval_at && (
                          <span className="text-[11px] font-mono text-[#4A5568]">
                            {new Date(tender.internal_approval_at).toLocaleString('en-IN')}
                          </span>
                        )}
                      </div>
                      {(tender.approval_conditions || tender.remarks) && (
                        <p className="text-xs text-[#4A5568] bg-white p-2.5 rounded-lg border border-[#DCD8CE]">
                          <strong>Directives / Remarks:</strong> {tender.approval_conditions || tender.remarks}
                        </p>
                      )}
                    </div>
                  )
                ) : (
                  <div className="p-3.5 rounded-lg bg-[#FBFAF7] border border-[#ECE9E2] text-xs text-[#4A5568] flex items-center gap-3">
                    <ShieldAlert className="w-5 h-5 text-[#9A3412] shrink-0" />
                    <div>
                      <span className="font-semibold text-[#14213D] block mb-0.5">
                        Strict Governance: Management Review Required
                      </span>
                      Only Management and Admin roles are authorized to record tender participation decisions during Internal Review.
                    </div>
                  </div>
                )}
              </Card>
            </div>
          )}

          {/* TAB 2: LINE ITEMS */}
          {activeTab === 'line_items' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-serif font-bold text-sm text-[#14213D]">Tender Products & BOQ Specifications</h4>
                  <p className="text-[11px] text-[#4A5568]">Products linked to this tender with catalogue and GeM compliance checks</p>
                </div>
                <Button variant="primary" size="sm" leftIcon={<Plus className="h-3.5 w-3.5" />} onClick={() => setIsAddLineItemOpen(true)}>
                  Add Line Item
                </Button>
              </div>

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
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <EmptyState
                  title="No line items configured"
                  description="Add equipment and specifications to verify GeM catalogue compatibility."
                  action={<Button variant="outline" size="sm" onClick={() => setIsAddLineItemOpen(true)}>Add First Item</Button>}
                />
              )}
            </div>
          )}

          {/* TAB 3: APPROVALS */}
          {activeTab === 'approvals' && (
            <div className="space-y-4">
              <div className="p-3.5 rounded-xl bg-[#E3EFEE] border border-[#0F5E63]/20 flex items-center justify-between">
                <div>
                  <h4 className="font-semibold text-xs text-[#0F5E63]">Central Decision Protocol (Zero WhatsApp Policy)</h4>
                  <p className="text-[11px] text-[#4A5568]">Every tender go/no-go approval is immutably logged with approver identity and timestamp.</p>
                </div>
                {tender.status === 'identified' && (
                  <Button
                    variant="primary"
                    size="sm"
                    leftIcon={<Send className="h-3.5 w-3.5" />}
                    onClick={async () => {
                      setActionLoading(true);
                      try {
                        await api.post(`/tenders/${tender.id}/approval-request`, { remarks: 'Official approval requested' });
                        await loadTender();
                        onTenderUpdated?.();
                        setFeedbackMsg({ type: 'success', text: 'Approval request submitted to designated authorities' });
                      } catch (err: any) {
                        setFeedbackMsg({ type: 'error', text: err?.message || 'Failed to submit for approval' });
                      } finally {
                        setActionLoading(false);
                      }
                    }}
                  >
                    Submit for Approval
                  </Button>
                )}
              </div>

              {tender.approvals && tender.approvals.length > 0 ? (
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
                            app.status === 'APPROVED' ? 'success' : app.status === 'REJECTED' ? 'danger' : 'warning'
                          }
                          size="sm"
                        >
                          {app.status || 'PENDING'}
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
              ) : (
                <EmptyState
                  title="No approval rounds recorded"
                  description="Submit this tender for approval when all mandatory parameters are completed."
                />
              )}
            </div>
          )}

          {/* TAB: LIFECYCLE & STAGE TRANSITIONS */}
          {activeTab === 'transitions' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
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
                  Current: {tender.status?.replace(/_/g, ' ').toUpperCase()}
                </Badge>
              </div>

              {/* Visual 6-Step Tracker */}
              <div className="p-3 rounded-xl bg-[#FBFAF7] border border-[#DCD8CE]">
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-1 text-center text-[10px] font-semibold">
                  <div className={`p-2 rounded ${['identified', 'awaiting_approval', 'under_preparation', 'pq_submitted', 'pq_qualified', 'submitted', 'technical_eval', 'commercial_eval', 'won', 'lost'].includes(tender.status) ? 'bg-[#0F5E63] text-white' : 'bg-slate-200 text-slate-500'}`}>
                    1. Identified
                  </div>
                  <div className={`p-2 rounded ${['awaiting_approval', 'under_preparation', 'pq_submitted', 'pq_qualified', 'submitted', 'technical_eval', 'commercial_eval', 'won', 'lost'].includes(tender.status) ? 'bg-[#0F5E63] text-white' : 'bg-slate-200 text-slate-500'}`}>
                    2. Approval
                  </div>
                  <div className={`p-2 rounded ${['under_preparation', 'pq_submitted', 'pq_qualified', 'submitted', 'technical_eval', 'commercial_eval', 'won', 'lost'].includes(tender.status) ? 'bg-[#0F5E63] text-white' : 'bg-slate-200 text-slate-500'}`}>
                    3. Preparation
                  </div>
                  <div className={`p-2 rounded ${['pq_submitted', 'pq_qualified', 'submitted', 'technical_eval', 'commercial_eval', 'won', 'lost'].includes(tender.status) ? 'bg-[#0F5E63] text-white' : 'bg-slate-200 text-slate-500'}`}>
                    4. PQ Phase
                  </div>
                  <div className={`p-2 rounded ${['submitted', 'technical_eval', 'commercial_eval', 'won', 'lost'].includes(tender.status) ? 'bg-[#0F5E63] text-white' : 'bg-slate-200 text-slate-500'}`}>
                    5. Submitted
                  </div>
                  <div className={`p-2 rounded ${['won', 'lost'].includes(tender.status) ? (tender.status === 'won' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white') : 'bg-slate-200 text-slate-500'}`}>
                    6. Result
                  </div>
                </div>
              </div>

              {/* Status Specific Helper / Actions */}
              {['awaiting_approval', 'under_review'].includes(tender.status) ? (
                <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 space-y-2">
                  <div className="flex items-center gap-2">
                    <ShieldAlert className="h-5 w-5 text-amber-700 shrink-0" />
                    <span className="font-bold text-xs">Awaiting Executive Management Signoff</span>
                  </div>
                  <p className="text-xs text-amber-800 leading-relaxed">
                    This tender is currently undergoing Internal Review. To authorize participation and advance to <strong>Under Preparation</strong>, please switch to the <strong>Approvals</strong> tab above.
                  </p>
                  <Button
                    size="xs"
                    variant="primary"
                    className="bg-amber-600 hover:bg-amber-700 text-white"
                    onClick={() => setActiveTab('approvals')}
                  >
                    Go to Approvals Tab
                  </Button>
                </div>
              ) : getAllowedDossierTransitions(tender.status, tender.category).length === 0 ? (
                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-slate-700 text-xs">
                  This tender is in a terminal state (<strong>{tender.status?.toUpperCase()}</strong>). No further stage advancements are permitted.
                </div>
              ) : (
                <div className="space-y-4">
                  {['under_preparation', 'UNDER_PREPARATION'].includes(tender.status) && (
                    <div className="p-3 rounded-xl bg-white border border-[#DCD8CE] flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <Paperclip className="h-4 w-4 text-[#0F5E63]" />
                        <span className="text-[#4A5568]">Document Compliance Gate:</span>
                        <span className="font-bold text-[#14213D]">
                          {tender.document_completion_percentage || 0}% Ready
                        </span>
                      </div>
                      {tender.document_completion_percentage === 100 ? (
                        <span className="text-emerald-700 font-semibold text-[11px] flex items-center gap-1">
                          <CheckCircle2 className="h-3.5 w-3.5" /> All Mandatory Files Ready for Submission
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setActiveTab('documents')}
                          className="text-[#9A3412] hover:underline font-semibold text-[11px] flex items-center gap-1 cursor-pointer"
                        >
                          Review Incomplete Documents <ArrowRight className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  )}

                  <div className="p-3.5 rounded-xl bg-white border border-[#DCD8CE] space-y-3">
                    <span className="text-xs text-[#14213D] font-bold block uppercase tracking-wide">
                      Permitted Stage Advancements ({getAllowedDossierTransitions(tender.status, tender.category).length})
                    </span>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {getAllowedDossierTransitions(tender.status, tender.category).map((tr) => (
                        <div
                          key={tr.status}
                          className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
                            selectedNextStatus === tr.status
                              ? 'border-[#0F5E63] bg-[#E3EFEE]/40 ring-1 ring-[#0F5E63]'
                              : 'border-[#DCD8CE] hover:border-[#0F5E63]/50 bg-white'
                          }`}
                          onClick={() => {
                            setSelectedNextStatus(tr.status);
                            setTransitionNotes(tr.defaultRemarks || '');
                          }}
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-bold text-xs text-[#14213D]">{tr.label}</span>
                            <Badge variant={tr.variant as any} size="sm">
                              {tr.status.replace(/_/g, ' ').toUpperCase()}
                            </Badge>
                          </div>
                          <p className="text-[11px] text-[#4A5568] leading-relaxed">{tr.description}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  {selectedNextStatus && (
                    <div className="p-4 rounded-xl bg-[#FBFAF7] border border-[#0F5E63]/30 space-y-3 animate-in fade-in duration-200">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-xs text-[#0F5E63]">
                          Advancement Confirmation: {selectedNextStatus.replace(/_/g, ' ').toUpperCase()}
                        </span>
                        <Button
                          size="xs"
                          variant="ghost"
                          onClick={() => setSelectedNextStatus('')}
                        >
                          Cancel
                        </Button>
                      </div>

                      {selectedNextStatus === 'submitted' && (
                        <Input
                          label="Portal Submission Date"
                          type="date"
                          value={portalSubmissionDate}
                          onChange={(e) => setPortalSubmissionDate(e.target.value)}
                          required
                        />
                      )}

                      <Input
                        label="Transition Directives & Remarks"
                        value={transitionNotes}
                        onChange={(e) => setTransitionNotes(e.target.value)}
                        placeholder="e.g. PQ eligibility dossier submitted on government portal."
                        helperText="Mandatory audit log remarks recording this lifecycle transition."
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
                          Confirm & Advance Stage
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* TAB 4: DOCUMENTS CHECKLIST */}
          {activeTab === 'documents' && (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
                <div>
                  <h4 className="font-serif font-bold text-sm text-[#14213D]">Document Compliance Checklist</h4>
                  <p className="text-[11px] text-[#4A5568]">Mandatory submission criteria: each required item must be linked to a responsible member and marked Ready.</p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => setIsAddCustomDocOpen(true)}
                    leftIcon={<Plus className="h-3.5 w-3.5" />}
                  >
                    Add Document
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleInitChecklist}
                    isLoading={actionLoading}
                    leftIcon={<RefreshCw className="h-3.5 w-3.5" />}
                  >
                    Re-initialize Templates
                  </Button>
                </div>
              </div>

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

                <div className="flex items-center gap-2">
                  {driveFolderUrl && !isEditingDriveFolder ? (
                    <div className="flex items-center gap-2 flex-wrap">
                      <a
                        href={driveFolderUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0F5E63] text-white hover:bg-[#0B4A4E] text-xs font-semibold shadow-xs transition-colors"
                        title={driveFolderUrl}
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                        <span>Open Drive Folder ↗</span>
                      </a>
                      <Button
                        variant="outline"
                        size="xs"
                        onClick={() => setIsEditingDriveFolder(true)}
                      >
                        Edit Link
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 w-full md:w-auto">
                      <input
                        type="url"
                        placeholder="https://drive.google.com/drive/folders/..."
                        value={driveFolderUrl}
                        onChange={(e) => setDriveFolderUrl(e.target.value)}
                        className="text-xs px-2.5 py-1.5 rounded-lg border border-[#C9C4B8] focus:border-[#0F5E63] focus:ring-1 focus:ring-[#0F5E63]/20 bg-white min-w-[240px] outline-none"
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
                            setIsEditingDriveFolder(false);
                          }}
                        >
                          Cancel
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Completion Progress Bar */}
              <div className="space-y-1">
                <div className="flex justify-between text-[11px] font-semibold">
                  <span>Readiness Progress</span>
                  <span className="font-mono text-[#0F5E63]">
                    {tender.documents?.filter((d: any) => ['Ready', 'Not Applicable'].includes(d.status)).length || 0} of {tender.documents?.length || 0} Ready ({tender.document_completion_percentage || 0}%)
                  </span>
                </div>
                <div className="w-full h-2 rounded-full bg-slate-200 overflow-hidden">
                  <div
                    className="h-full bg-[#0F5E63] transition-all duration-300"
                    style={{ width: `${tender.document_completion_percentage || 0}%` }}
                  />
                </div>
              </div>

              {/* Status Linkage Banner: Direct Stage Advancement when 100% Ready */}
              {tender.document_completion_percentage === 100 && ['under_preparation', 'UNDER_PREPARATION'].includes(tender.status) && (
                <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-emerald-900 animate-in fade-in duration-200">
                  <div className="flex items-center gap-2.5">
                    <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
                    <div>
                      <div className="font-bold text-xs">All Mandatory Documents Verified & Ready (100%)!</div>
                      <div className="text-[11px] text-emerald-700">Document compliance is fully satisfied. Tender is ready for portal submission.</div>
                    </div>
                  </div>
                  <Button
                    size="xs"
                    variant="success"
                    onClick={() => {
                      setActiveTab('transitions');
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
                        <TableRow key={doc.id} className="hover:bg-[#F8FAFC]">
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
                                className="text-[11px] p-1 rounded border border-[#DCD8CE] bg-white cursor-pointer w-full"
                              >
                                <option value="">-- Unassigned (None) --</option>
                                {users && users.map((u: any) => (
                                  <option key={u.id} value={u.id}>
                                    {u.full_name} ({u.role?.replace(/_/g, ' ')})
                                  </option>
                                ))}
                              </select>
                              {doc.owner_id && doc.owner_id === currentUser?.id && (
                                <span className="inline-block px-1.5 py-0.2 rounded text-[9px] font-bold bg-[#E3EFEE] text-[#0F5E63] border border-[#0F5E63]/20">
                                  🎯 Assigned to You
                                </span>
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
                              <div className="p-2.5 rounded-lg bg-[#FBFAF7] border border-[#0F5E63] space-y-2 min-w-[260px] shadow-sm animate-in fade-in duration-150">
                                <div className="flex items-center justify-between text-[11px] font-bold text-[#0F5E63]">
                                  <span>Link Google Drive / File</span>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setAttachingDocId(null);
                                      setAttachedFileName('');
                                      setAttachedDriveUrl('');
                                    }}
                                    className="text-gray-400 hover:text-gray-600 cursor-pointer p-0.5"
                                  >
                                    <X className="h-3 w-3" />
                                  </button>
                                </div>
                                <div>
                                  <label className="text-[10px] text-[#4A5568] block mb-0.5 font-medium">Google Drive URL (or Document Link)</label>
                                  <input
                                    type="url"
                                    value={attachedDriveUrl}
                                    onChange={(e) => setAttachedDriveUrl(e.target.value)}
                                    placeholder="https://drive.google.com/file/d/..."
                                    className="w-full text-[11px] px-2 py-1 rounded border border-[#C9C4B8] focus:border-[#0F5E63] bg-white outline-none"
                                    autoFocus
                                  />
                                </div>
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
                                    onClick={() => {
                                      setAttachingDocId(null);
                                      setAttachedFileName('');
                                      setAttachedDriveUrl('');
                                    }}
                                    className="px-2 py-1 rounded text-[10px] text-gray-600 hover:bg-gray-100 cursor-pointer"
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleAttachFile(doc.id)}
                                    disabled={!attachedFileName.trim() && !attachedDriveUrl.trim()}
                                    className="px-2.5 py-1 rounded bg-[#0F5E63] text-white text-[10px] font-bold hover:bg-[#0B4A4E] disabled:opacity-50 cursor-pointer transition-colors shadow-xs"
                                  >
                                    Save & Mark Ready
                                  </button>
                                </div>
                              </div>
                            ) : doc.file_url ? (
                              <div className="flex items-center gap-1.5 max-w-[220px]">
                                <a
                                  href={doc.file_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-[#E3EFEE] hover:bg-[#d0e5e3] text-[#0F5E63] font-mono text-[11px] font-semibold border border-[#0F5E63]/25 truncate group transition-colors shadow-2xs"
                                  title={`Open in Drive: ${doc.file_url}`}
                                >
                                  <ExternalLink className="h-3 w-3 shrink-0 text-[#0F5E63]" />
                                  <span className="truncate max-w-[110px]">{doc.file_name || 'Drive Document'}</span>
                                  <span className="text-[10px] text-[#0F5E63]/70 font-normal">↗</span>
                                </a>
                                <button
                                  type="button"
                                  onClick={() => handleRemoveFile(doc.id)}
                                  className="text-red-500 hover:text-red-700 p-0.5 rounded hover:bg-red-50 shrink-0 cursor-pointer transition-colors"
                                  title="Remove attachment"
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              </div>
                            ) : doc.file_name ? (
                              <div className="flex items-center gap-1.5 font-mono text-[11px]">
                                <Paperclip className="h-3.5 w-3.5 text-[#0F5E63] shrink-0" />
                                <span className="text-[#0F5E63] font-semibold truncate max-w-[120px]" title={doc.file_name}>
                                  {doc.file_name}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setAttachingDocId(doc.id);
                                    setAttachedFileName(doc.file_name);
                                    setAttachedDriveUrl('');
                                  }}
                                  className="text-[10px] text-[#0F5E63] hover:underline font-semibold cursor-pointer"
                                  title="Add Drive URL"
                                >
                                  + Link URL
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleRemoveFile(doc.id)}
                                  className="text-red-500 hover:text-red-700 p-0.5 rounded hover:bg-red-50 shrink-0 cursor-pointer"
                                  title="Remove attachment"
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => {
                                  setAttachingDocId(doc.id);
                                  setAttachedFileName(`${doc.document_type.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`);
                                  setAttachedDriveUrl('');
                                }}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] text-[#0F5E63] hover:bg-[#E3EFEE] border border-dashed border-[#0F5E63]/30 font-medium cursor-pointer transition-colors"
                              >
                                <ExternalLink className="h-3 w-3" />
                                <span>Link Drive / File</span>
                              </button>
                            )}
                          </TableCell>
                          <TableCell>
                            <select
                              value={doc.status}
                              onChange={(e) => handleUpdateDocStatus(doc.id, e.target.value)}
                              className="text-[11px] p-1 rounded border border-[#DCD8CE] bg-white cursor-pointer font-medium"
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
                  description="Click 'Initialize Checklist Templates' to populate standard NIT and PQ verification forms."
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
                        label: `${u.full_name} (${u.role?.replace(/_/g, ' ')})`,
                      })),
                    ]}
                  />

                  <Input
                    label="Google Drive / File URL (Optional)"
                    placeholder="https://drive.google.com/file/d/..."
                    value={newCustomDoc.file_url || ''}
                    onChange={(e) => setNewCustomDoc({ ...newCustomDoc, file_url: e.target.value })}
                    helperText="Providing a link will automatically mark this requirement Ready."
                  />

                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="mandatory_chk"
                      checked={newCustomDoc.is_mandatory}
                      onChange={(e) => setNewCustomDoc({ ...newCustomDoc, is_mandatory: e.target.checked })}
                      className="rounded border-[#DCD8CE] text-[#0F5E63] cursor-pointer"
                    />
                    <label htmlFor="mandatory_chk" className="cursor-pointer font-semibold text-[#14213D]">
                      Mandatory Document (Required before submission)
                    </label>
                  </div>

                  <div className="flex justify-end gap-2 pt-2">
                    <Button type="button" variant="ghost" size="sm" onClick={() => setIsAddCustomDocOpen(false)}>
                      Cancel
                    </Button>
                    <Button type="submit" variant="primary" size="sm">
                      Add to Checklist
                    </Button>
                  </div>
                </form>
              </Modal>
            </div>
          )}

          {/* TAB 5: CORRIGENDA */}
          {activeTab === 'corrigenda' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-serif font-bold text-sm text-[#14213D]">Corrigenda & Deadline Extensions</h4>
                  <p className="text-[11px] text-[#4A5568]">Official portal corrigenda history. Modifying deadline preserves original submission date.</p>
                </div>
                <Button variant="primary" size="sm" leftIcon={<Plus className="h-3.5 w-3.5" />} onClick={() => setIsCorrigendumOpen(true)}>
                  Add Corrigendum
                </Button>
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
                        <TableCell className="text-xs">{c.issued_date || 'N/A'}</TableCell>
                        <TableCell className="font-mono text-xs text-[#4A5568]">
                          {c.old_deadline ? new Date(c.old_deadline).toLocaleString('en-IN') : 'N/A'}
                        </TableCell>
                        <TableCell className="font-mono text-xs font-bold text-[#0F5E63]">
                          {c.new_deadline ? new Date(c.new_deadline).toLocaleString('en-IN') : 'N/A'}
                        </TableCell>
                        <TableCell className="text-xs text-[#4A5568]">{c.summary || 'Deadline extended'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <EmptyState
                  title="No corrigenda recorded"
                  description="Log any portal extensions or specification amendments received from the department."
                />
              )}
            </div>
          )}

          {/* TAB 6: FINANCIAL INSTRUMENTS */}
          {activeTab === 'finance' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-serif font-bold text-sm text-[#14213D]">Financial Instruments (EMD, PBG & Fees)</h4>
                  <p className="text-[11px] text-[#4A5568]">Tracked in real time with the Finance department until refund or contract release.</p>
                </div>
                <Button variant="primary" size="sm" leftIcon={<Plus className="h-3.5 w-3.5" />} onClick={() => setIsInstrumentOpen(true)}>
                  Request Instrument
                </Button>
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
          {activeTab === 'portal_issues' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
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
                          variant={pi.resolution_status === 'RESOLVED' ? 'success' : 'warning'}
                          size="sm"
                        >
                          {pi.resolution_status || 'OPEN'}
                        </Badge>
                      </div>
                      <p className="text-[11px] text-[#4A5568] mt-1">
                        Reported on {pi.reported_date} • Responsible: {pi.responsible_name || 'Executive'}
                      </p>
                      {pi.resolution && (
                        <p className="text-[11px] text-emerald-800 font-medium mt-1 bg-emerald-50 p-1.5 rounded">
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
            <div className="space-y-4">
              <div>
                <h4 className="font-serif font-bold text-sm text-[#14213D]">Collaborative Discussion (WhatsApp Replacement)</h4>
                <p className="text-[11px] text-[#4A5568]">Team discussions, technical clarifications, and executive notes are saved permanently.</p>
              </div>

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
                  leftIcon={<Send className="h-3.5 w-3.5" />}
                >
                  Post Note
                </Button>
              </div>

              {tender.comments && tender.comments.length > 0 ? (
                <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                  {tender.comments.map((cm: any) => (
                    <div key={cm.id} className="p-3 rounded-lg bg-[#FBFAF7] border border-[#ECE9E2] space-y-1">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="font-bold text-[#14213D]">{cm.author_name || 'Team Member'}</span>
                        <span className="text-[#4A5568] font-mono">{new Date(cm.created_at).toLocaleString('en-IN')}</span>
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
          {activeTab === 'result' && (
            <div className="space-y-4">
              {['won', 'WON', 'lost', 'LOST', 'partially_won', 'PARTIALLY_WON'].includes(tender.status) ? (
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
                      <span className="font-mono font-semibold">{tender.result_date || 'N/A'}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-[#4A5568] block uppercase font-bold">Awarded Value</span>
                      <span className="font-mono font-bold text-[#0F5E63]">
                        {tender.tender_result?.awarded_value || tender.tender_value
                          ? `₹ ${(Number(tender.tender_result?.awarded_value || tender.tender_value) / 100000).toFixed(2)} Lakh`
                          : '—'}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] text-[#4A5568] block uppercase font-bold">Our Rank</span>
                      <span className="font-mono font-bold">{tender.tender_result?.our_rank || 'L1'}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-[#4A5568] block uppercase font-bold">Winning Competitor</span>
                      <span className="font-semibold">{tender.tender_result?.competitor || 'Arihant Trading'}</span>
                    </div>
                  </div>

                  {tender.tender_result?.loss_reasons && tender.tender_result.loss_reasons.length > 0 && (
                    <div className="p-2.5 rounded bg-red-50 border border-red-200">
                      <span className="text-[10px] text-red-800 font-bold block uppercase mb-1">Loss Reasons</span>
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
                  title="Tender in progress"
                  description="Outcomes (Won, Lost, Partially Won) can be officially recorded once commercial evaluation concludes."
                />
              )}
            </div>
          )}

          {/* TAB 10: LINKED RECORDS */}
          {activeTab === 'linked' && (
            <div className="space-y-4">
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
                  {tender.status === 'pq_qualified' ? (
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={handleCreateLinkedTender}
                      isLoading={actionLoading}
                      leftIcon={<ArrowRight className="h-3.5 w-3.5" />}
                    >
                      Create Linked General Tender
                    </Button>
                  ) : (
                    <p className="text-[11px] text-[#4A5568] italic">Available when tender status is PQ_QUALIFIED.</p>
                  )}
                </Card>

                <Card className="p-4 space-y-2 border-[#DCD8CE]">
                  <h5 className="font-semibold text-xs text-[#0F5E63]">Won Tender to Sales Order Conversion</h5>
                  <p className="text-[11px] text-[#4A5568]">
                    Automatically populates Deliveries & Sales Pipeline with awarded items, customer site, and warranty terms.
                  </p>
                  {['won', 'WON', 'partially_won', 'PARTIALLY_WON'].includes(tender.status) ? (
                    <Button
                      variant="success"
                      size="sm"
                      onClick={handleCreateSalesOrder}
                      isLoading={actionLoading}
                      leftIcon={<ShoppingBag className="h-3.5 w-3.5" />}
                    >
                      Create Sales Order
                    </Button>
                  ) : (
                    <p className="text-[11px] text-[#4A5568] italic">Available when tender status is WON or PARTIALLY_WON.</p>
                  )}
                </Card>
              </div>
            </div>
          )}

          {/* TAB 11: AUDIT TIMELINE */}
          {activeTab === 'timeline' && (
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
                          <span className="font-bold text-[#14213D]">{act.event_type}</span>
                          <span className="font-mono text-[#4A5568]">{new Date(act.created_at).toLocaleString('en-IN')}</span>
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
        <div className="space-y-3 text-xs">
          <Input
            label="Product Description / Name"
            value={newLineItem.product_description}
            onChange={(e) => setNewLineItem({ ...newLineItem, product_description: e.target.value })}
            placeholder="e.g. Thermal Night Vision Sensor Model T-40"
            required
          />
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Quantity"
              type="number"
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
            value={newLineItem.quoted_unit_price}
            onChange={(e) => setNewLineItem({ ...newLineItem, quoted_unit_price: e.target.value })}
            placeholder="e.g. 150000"
          />
          <Textarea
            label="Technical Specifications Summary"
            value={newLineItem.specification_summary}
            onChange={(e) => setNewLineItem({ ...newLineItem, specification_summary: e.target.value })}
            placeholder="Key technical capabilities and MIL-STD compliance..."
          />
          <div className="flex justify-end space-x-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => setIsAddLineItemOpen(false)}>Cancel</Button>
            <Button variant="primary" size="sm" onClick={handleAddLineItem} isLoading={actionLoading}>Save Line Item</Button>
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
            value={newInstrument.amount}
            onChange={(e) => setNewInstrument({ ...newInstrument, amount: e.target.value })}
            placeholder="e.g. 500000"
            required
          />
          <div className="grid grid-cols-2 gap-3">
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
                      {u.full_name} ({u.role?.replace(/_/g, ' ')})
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
                      {u.full_name} ({u.role?.replace(/_/g, ' ')})
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
    </Modal>
  );
}
