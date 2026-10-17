'use client';

import Link from 'next/link';
import React, { useState, useEffect, useTransition, useCallback } from 'react';
import {
  Bell,
  FileSpreadsheet,
  Plus,
  Search,
  Filter,
  RefreshCw,
  Clock,
  CheckCircle2,
  Calendar,
  AlertCircle,
  AlertTriangle,
  User,
  ArrowRight,
  ExternalLink,
  Building,
  Package,
  Layers,
  FileCheck,
  Send,
  MessageSquare,
  History,
  X,
  Briefcase,
  Copy,
  Check,
  ArrowUpDown,
  ChevronUp,
  ChevronDown,
  Edit2,
  Trash2,
  CalendarDays,
  SlidersHorizontal,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';
import { useOpenParam } from '@/lib/use-open-param';
import { useInfiniteList } from '@/lib/use-infinite-list';
import { canOpen } from '@/lib/route-access';
import { RelatedRecords } from '@/components/links/RelatedRecords';
import { getSocket } from '@/lib/socket';
import {
  Button,
  Badge,
  Card,
  Modal,
  Input,
  Select,
  Textarea,
  PageContainer,
  PageHeader,
  StatGrid,
  StatCard,
  RecordViews,
  toneFor,
  type RecordItem,
  type BoardLane,
  Tabs, Spinner, FilterMenu, InfoCallout, FormSteps, FormSection, ScrollStrip } from '@/components/ui';
import { addIsoDays, istToday } from '@/lib/ist-date';
import { calendarDay } from '@/lib/calendar-day';
import {
  PROPOSAL_STATUS_LABELS,
  PROPOSAL_LOST_REASONS,
  type ProposalStatus,
  type ProposalLostReason,
} from '@arihant/shared';

/** A proposal DATE value from the API ('YYYY-MM-DD' or a serialized instant) as its IST calendar day. */
const proposalDay = calendarDay;

/**
 * Dialog action rows. Phones (bottom sheet): a sticky footer docked to the sheet's bottom edge, the
 * buttons sharing the full width as 40px thumb targets. From `sm` up: the plain right-aligned row.
 */
const DIALOG_FOOTER =
  'sticky -bottom-4 z-10 -mx-4 -mb-4 flex gap-2 border-t border-[#DCD8CE] bg-white px-4 py-3 [&>*]:min-w-0 [&>*]:flex-1 sm:static sm:z-auto sm:mx-0 sm:mb-0 sm:justify-end sm:border-[#F0F5FC] sm:bg-transparent sm:px-0 sm:pb-0 sm:pt-3 sm:[&>*]:flex-none';
const DIALOG_BTN = 'h-10 sm:h-8';
/** Workflow buttons in the proposal sheet: phones share the row as 40px targets; `sm` up keeps the compact xs button. */
const FLOW_BTN = 'h-10 grow basis-[8rem] text-xs sm:h-7 sm:grow-0 sm:basis-auto sm:text-[11px]';
/**
 * Filter-row dropdowns on phones: the menus wrap over several lines, so a panel anchored to its button
 * runs off the left or right screen edge. Below `sm` each panel opens full-width under the menu group
 * (the group is the positioning box); from `sm` up it stays anchored to its button.
 */
const PHONE_MENU = 'max-sm:static max-sm:[&_.filter-menu-panel]:inset-x-0 max-sm:[&_.filter-menu-panel]:max-w-none';

const PROPOSAL_STATUS_FILTERS = [
  { key: 'PROPOSAL_REQUESTED', label: 'Proposal requested' },
  { key: 'UNDER_PREPARATION', label: 'Under preparation' },
  { key: 'READY_FOR_REVIEW', label: 'Ready for review' },
  { key: 'APPROVED', label: 'Approved' },
  { key: 'SENT_TO_CUSTOMER', label: 'Sent to customer' },
  { key: 'FOLLOW_UP_REQUIRED', label: 'Follow-up required' },
  { key: 'CONVERTED', label: 'Converted' },
  { key: 'CLOSED', label: 'Closed' },
  { key: 'LOST', label: 'Lost' },
];
/** Stage-board lanes in workflow order (same statuses as the Status filter). */
const PROPOSAL_LANES: BoardLane[] = PROPOSAL_STATUS_FILTERS.map((s) => ({ key: s.key, label: s.label, tone: toneFor(s.label) }));
/** Legacy lowercase / short status values fold into the canonical upper-case lanes. */
const LEGACY_PROPOSAL_LANE: Record<string, string> = { REQUESTED: 'PROPOSAL_REQUESTED', SENT: 'SENT_TO_CUSTOMER', FOLLOWUP_REQUIRED: 'FOLLOW_UP_REQUIRED' };
const proposalLaneOf = (status?: string | null) => {
  const s = String(status || '').toUpperCase();
  return LEGACY_PROPOSAL_LANE[s] || s || 'PROPOSAL_REQUESTED';
};
const SORT_FIELDS = [
  { key: 'updated_at', label: 'Recently updated' },
  { key: 'request_date', label: 'Request date' },
  { key: 'required_date', label: 'Due date' },
  { key: 'sent_date', label: 'Sent date' },
  { key: 'next_followup', label: 'Next follow-up' },
  { key: 'proposal_number', label: 'Proposal no.' },
];


/** Proposals fetched per request while the register scrolls. */
const PROPOSALS_PAGE_SIZE = 25;

export default function ProposalsPage() {
  const { user } = useAuth();

  // (the proposals register itself is useInfiniteList below, paged as the reader scrolls)

  // Dashboard Stats
  const [stats, setStats] = useState<any>({
    total_proposals: 0,
    proposal_requested: 0,
    pending_preparation: 0,
    ready_for_review: 0,
    approved: 0,
    sent_to_customer: 0,
    followup_required: 0,
    converted: 0,
    closed: 0,
    lost: 0,
    due_today: 0,
    overdue: 0,
    no_followup: 0,
    old_no_movement: 0,
  });

  // Reference data
  const [organisations, setOrganisations] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);

  // Filter & Sort States
  const [search, setSearch] = useState('');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [selectedSector, setSelectedSector] = useState<string>('all');
  const [selectedFollowupCondition, setSelectedFollowupCondition] = useState<string>('all');
  const [selectedResponsibleId, setSelectedResponsibleId] = useState<string>('');
  const [selectedFollowupOwnerId, setSelectedFollowupOwnerId] = useState<string>('');
  const [sortBy, setSortBy] = useState<string>('updated_at');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [dateField, setDateField] = useState<string>('request_date');
  const [fromDate, setFromDate] = useState<string>('');
  const [toDate, setToDate] = useState<string>('');
  const [isDateFilterOpen, setIsDateFilterOpen] = useState(false);
  const [activeHudCard, setActiveHudCard] = useState<string | null>(null);

  // Modals & Active Proposal state
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedProposal, setSelectedProposal] = useState<any | null>(null);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [detailsTab, setDetailsTab] = useState<'overview' | 'followups' | 'history' | 'linked'>('overview');
  const [followups, setFollowups] = useState<any[]>([]);
  const [activities, setActivities] = useState<any[]>([]);

  // Edit & Delete Dialogs
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [editForm, setEditForm] = useState({
    required_date: '',
    version: '',
    reference: '',
    remarks: '',
    responsible_id: '',
    followup_owner_id: '',
    required_date_change_reason: '',
  });

  // Action dialogs
  const [isStatusDialogOpen, setIsStatusDialogOpen] = useState(false);
  const [targetStatus, setTargetStatus] = useState<string>('');
  const [statusForm, setStatusForm] = useState({
    sent_date: istToday(),
    lost_reason: 'Price' as ProposalLostReason,
    lost_remarks: '',
    converted_to: '',
    converted_reference: '',
    remarks: '',
  });

  const [isFollowupDialogOpen, setIsFollowupDialogOpen] = useState(false);
  const [followupForm, setFollowupForm] = useState({
    followup_date: istToday(),
    owner_id: '',
    remarks: '',
    outcome: '',
    next_followup_date: '',
  });

  // Form Submission
  const [newProposal, setNewProposal] = useState({
    organisation_id: '',
    product_id: '',
    sector: 'Defence',
    responsible_id: '',
    request_date: istToday(),
    required_date: addIsoDays(istToday(), 7),
    version: 'v1.0',
    reference: '',
    followup_owner_id: '',
    next_followup: '',
    remarks: '',
  });

  const [formError, setFormError] = useState<string | null>(null);
  // Server refusals are shown inside the open dialog (never alert() / silent failure).
  const [statusError, setStatusError] = useState<string | null>(null);
  const [followupError, setFollowupError] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [duplicateWarning, setDuplicateWarning] = useState<{ detected: boolean; message: string; proposalNo?: string } | null>(null);
  const [duplicateOverrideReason, setDuplicateOverrideReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const resetCreateForm = () => {
    setNewProposal({
      organisation_id: '',
      product_id: '',
      sector: 'Defence',
      responsible_id: '',
      request_date: istToday(),
      required_date: addIsoDays(istToday(), 7),
      version: 'v1.0',
      reference: '',
      followup_owner_id: '',
      next_followup: '',
      remarks: '',
    });
    setFormError(null);
    setDuplicateWarning(null);
    setDuplicateOverrideReason('');
  };

  // Auto-dismiss success message
  useEffect(() => {
    if (successMessage) {
      const timer = setTimeout(() => {
        setSuccessMessage(null);
      }, 7000);
      return () => clearTimeout(timer);
    }
  }, [successMessage]);

  // Fetch Reference Masters (Organisations, Products, Users)
  const fetchMasters = async () => {
    try {
      const [orgsRes, prodsRes, usersRes] = await Promise.all([
        api.get('/organisations', { limit: 100 }).catch(() => ({ data: [] })),
        api.get('/products').catch(() => []),
        api.get('/users', { limit: 100 }).catch(() => ({ data: [] })),
      ]);

      setOrganisations(orgsRes.data || []);
      setProducts(Array.isArray(prodsRes) ? prodsRes : prodsRes.data || []);
      setUsers(usersRes.data || []);
    } catch (err) {
      console.error('Failed to load masters:', err);
    }
  };

  // Fetch Dashboard Stats
  const fetchStats = async () => {
    try {
      const res = await api.get('/proposals/dashboard');
      if (res) setStats(res);
    } catch (err) {
      console.error('Failed to load proposal stats:', err);
    }
  };

  // Proposals register with complete multi-column filters and sorting, one page per request,
  // appended as the register scrolls. `fetchProposals` re-reads the pages already loaded, in place.
  const fetchProposalsPage = useCallback((page: number) => {
    const params: any = {
      page,
      limit: PROPOSALS_PAGE_SIZE,
      sort_by: sortBy,
      sort_order: sortOrder,
    };

    if (search.trim()) params.search = search.trim();
    if (selectedStatus && selectedStatus !== 'all') params.status = selectedStatus;
    if (selectedSector && selectedSector !== 'all') params.sector = selectedSector;
    if (selectedFollowupCondition && selectedFollowupCondition !== 'all') {
      params.followup = selectedFollowupCondition;
    }
    if (selectedResponsibleId) params.responsible_id = selectedResponsibleId;
    if (selectedFollowupOwnerId) params.followup_owner_id = selectedFollowupOwnerId;
    if (fromDate) params.from_date = fromDate;
    if (toDate) params.to_date = toDate;
    if (fromDate || toDate) params.date_field = dateField;

    return api.get('/proposals', params);
  }, [
    search,
    selectedStatus,
    selectedSector,
    selectedFollowupCondition,
    selectedResponsibleId,
    selectedFollowupOwnerId,
    sortBy,
    sortOrder,
    dateField,
    fromDate,
    toDate,
  ]);
  const proposalsList = useInfiniteList<any>(fetchProposalsPage);
  const { rows: proposals, total, loading: isLoading, refresh: fetchProposals } = proposalsList;

  // Initial load
  useEffect(() => {
    fetchMasters();
    fetchStats();
  }, []);

  // Real-time Event-Driven Architecture (EDA) live synchronization via Socket.IO
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const handleRealtimeProposalEvent = (payload: any) => {
      console.log('⚡ Realtime proposal event received:', payload);
      fetchProposals();
      fetchStats();
    };

    socket.on('proposal:created', handleRealtimeProposalEvent);
    socket.on('proposal:updated', handleRealtimeProposalEvent);
    socket.on('proposal:approved', handleRealtimeProposalEvent);
    socket.on('proposal:sent', handleRealtimeProposalEvent);
    socket.on('proposal:followup_added', handleRealtimeProposalEvent);
    socket.on('proposal:outcome', handleRealtimeProposalEvent);
    socket.on('proposal:overdue_alert', handleRealtimeProposalEvent);

    return () => {
      socket.off('proposal:created', handleRealtimeProposalEvent);
      socket.off('proposal:updated', handleRealtimeProposalEvent);
      socket.off('proposal:approved', handleRealtimeProposalEvent);
      socket.off('proposal:sent', handleRealtimeProposalEvent);
      socket.off('proposal:followup_added', handleRealtimeProposalEvent);
      socket.off('proposal:outcome', handleRealtimeProposalEvent);
      socket.off('proposal:overdue_alert', handleRealtimeProposalEvent);
    };
  }, [fetchProposals]);

  // Deep link from notifications: /proposals?open=<proposal id>
  useOpenParam(async (id) => {
    const proposal = await api.get(`/proposals/${id}`).catch(() => null);
    if (proposal) openProposalDetails(proposal);
  });

  // Fetch proposal details, follow-ups, and history
  const openProposalDetails = async (proposal: any) => {
    setSelectedProposal(proposal);
    setIsDetailsOpen(true);
    setDetailsTab('overview');

    try {
      const [fullProp, fRes, hRes] = await Promise.all([
        api.get(`/proposals/${proposal.id}`).catch(() => proposal),
        api.get(`/proposals/${proposal.id}/follow-ups`).catch(() => []),
        api.get(`/proposals/${proposal.id}/history`).catch(() => []),
      ]);
      setSelectedProposal(fullProp);
      setFollowups(Array.isArray(fRes) ? fRes : []);
      setActivities(Array.isArray(hRes) ? hRes : []);
    } catch (err) {
      console.error('Failed to load proposal details:', err);
    }
  };

  // Open Edit Proposal Dialog
  const openEditProposal = (proposal: any) => {
    setSelectedProposal(proposal);
    setEditForm({
      required_date: proposal.required_date ? proposalDay(proposal.required_date) : '',
      version: proposal.version || 'v1.0',
      reference: proposal.reference || '',
      remarks: proposal.remarks || '',
      responsible_id: proposal.responsible_id || '',
      followup_owner_id: proposal.followup_owner_id || '',
      required_date_change_reason: '',
    });
    setEditError(null);
    setIsEditOpen(true);
  };

  // Submit Edit Proposal
  const handleEditProposal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProposal) return;
    setEditError(null);
    try {
      setIsSubmitting(true);
      const payload: any = {
        required_date: editForm.required_date,
        version: editForm.version || undefined,
        reference: editForm.reference || undefined,
        remarks: editForm.remarks || undefined,
        responsible_id: editForm.responsible_id || undefined,
        followup_owner_id: editForm.followup_owner_id || undefined,
        required_date_change_reason: editForm.required_date_change_reason.trim() || undefined,
      };
      const updated = await api.patch(`/proposals/${selectedProposal.id}`, payload);
      setSelectedProposal(updated);
      setIsEditOpen(false);
      await fetchProposals();
      await fetchStats();
      const hRes = await api.get(`/proposals/${selectedProposal.id}/history`).catch(() => []);
      setActivities(hRes);
    } catch (err: any) {
      setEditError(err?.message || 'Failed to update proposal details');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Delete Proposal (Soft Delete)
  const handleDeleteProposal = async () => {
    if (!selectedProposal) return;
    setDeleteError(null);
    try {
      setIsSubmitting(true);
      await api.delete(`/proposals/${selectedProposal.id}`);
      setIsDeleteConfirmOpen(false);
      setIsDetailsOpen(false);
      setSelectedProposal(null);
      await fetchProposals();
      await fetchStats();
    } catch (err: any) {
      setDeleteError(err?.message || 'Failed to delete proposal');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Reset Filters
  const handleClearFilters = () => {
    setSearch('');
    setSelectedStatus('all');
    setSelectedSector('all');
    setSelectedFollowupCondition('all');
    setSelectedResponsibleId('');
    setSelectedFollowupOwnerId('');
    setSortBy('updated_at');
    setSortOrder('desc');
    setFromDate('');
    setToDate('');
    setActiveHudCard(null);
  };

  // Create Proposal Submission
  const handleCreateProposal = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    // 1. Comprehensive Field Validations
    if (!newProposal.organisation_id?.trim()) {
      setFormError('Please select a customer organisation');
      return;
    }
    if (!newProposal.product_id?.trim()) {
      setFormError('Please select a product');
      return;
    }
    if (!newProposal.sector?.trim()) {
      setFormError('Please select a sector / department');
      return;
    }
    if (!newProposal.responsible_id?.trim()) {
      setFormError('Please assign a responsible proposal person');
      return;
    }
    if (!newProposal.request_date) {
      setFormError('Request date is required');
      return;
    }
    const todayStr = istToday();

    if (newProposal.request_date > todayStr) {
      setFormError('Request date cannot be in the future');
      return;
    }
    if (!newProposal.required_date) {
      setFormError('Required completion date is required');
      return;
    }
    if (newProposal.required_date < newProposal.request_date) {
      setFormError('Required completion date cannot be before request date');
      return;
    }
    if (newProposal.next_followup && isNaN(Date.parse(newProposal.next_followup))) {
      setFormError('Initial follow-up date must be a valid date');
      return;
    }
    if (duplicateWarning && !duplicateOverrideReason?.trim()) {
      setFormError('Please provide a reason to override the duplicate proposal detection.');
      return;
    }

    try {
      setIsSubmitting(true);
      const payload: any = {
        organisation_id: newProposal.organisation_id.trim(),
        product_id: newProposal.product_id.trim(),
        sector: newProposal.sector.trim(),
        responsible_id: newProposal.responsible_id.trim(),
        followup_owner_id: (newProposal.followup_owner_id || newProposal.responsible_id).trim(),
        request_date: newProposal.request_date,
        required_date: newProposal.required_date,
        version: (newProposal.version || 'v1.0').trim(),
      };

      if (newProposal.reference?.trim()) payload.reference = newProposal.reference.trim();
      if (newProposal.next_followup?.trim()) payload.next_followup = newProposal.next_followup.trim();
      if (newProposal.remarks?.trim()) payload.remarks = newProposal.remarks.trim();
      if (duplicateOverrideReason?.trim()) payload.duplicate_override_reason = duplicateOverrideReason.trim();

      const created = await api.post('/proposals', payload);
      const quoteNo = created?.proposal_no || created?.proposal_number || 'New Quote';

      setIsCreateOpen(false);
      resetCreateForm();
      setSuccessMessage(`Proposal ${quoteNo} has been successfully registered and listed under Commercial Price Quotes.`);

      // Reset filters so the newly created proposal is immediately listed
      setSelectedStatus('all');
      setSelectedFollowupCondition('all');
      setSearch('');

      await fetchProposals();
      await fetchStats();
    } catch (err: any) {
      const isDuplicate =
        err?.data?.duplicate_detected ||
        err?.status === 409 ||
        (typeof err?.message === 'string' && err.message.toLowerCase().includes('duplicate'));

      if (isDuplicate) {
        setDuplicateWarning({
          detected: true,
          message: err?.message || 'A similar proposal was already registered for this customer and product within the duplicate detection window.',
          proposalNo: err?.data?.existing_proposal_no,
        });
        setFormError(err?.message || 'Duplicate proposal detected. Provide an override reason below to proceed.');
      } else {
        setFormError(err.message || 'Failed to create proposal request');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // Trigger Status Transition Dialog
  const initiateStatusChange = (nextStatus: string) => {
    setTargetStatus(nextStatus);
    setStatusError(null);
    setStatusForm({
      sent_date: istToday(),
      lost_reason: 'Price',
      lost_remarks: '',
      converted_to: '',
      converted_reference: '',
      remarks: '',
    });
    setIsStatusDialogOpen(true);
  };

  // Execute Status Transition
  const handleStatusSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProposal) return;
    setStatusError(null);

    if (targetStatus === 'SENT_TO_CUSTOMER') {
      // Mirror the server guard on IST calendar days: today (IST) is always allowed, even just after midnight.
      const today = istToday();
      const requestDay = proposalDay(selectedProposal.request_date);
      if (!statusForm.sent_date) {
        setStatusError('Sent date is required');
        return;
      }
      if (statusForm.sent_date > today) {
        setStatusError(`Sent date cannot be in the future (today is ${today} IST)`);
        return;
      }
      if (requestDay && statusForm.sent_date < requestDay) {
        setStatusError(`Sent date cannot be earlier than the proposal request date (${requestDay})`);
        return;
      }
    }

    try {
      setIsSubmitting(true);
      const payload: any = { status: targetStatus };

      if (targetStatus === 'SENT_TO_CUSTOMER') {
        payload.sent_date = statusForm.sent_date;
      } else if (targetStatus === 'LOST') {
        payload.lost_reason = statusForm.lost_reason;
        payload.lost_remarks = statusForm.lost_remarks;
      } else if (targetStatus === 'CONVERTED') {
        payload.converted_to = statusForm.converted_to;
        payload.converted_reference = statusForm.converted_reference;
      }
      if (statusForm.remarks) payload.remarks = statusForm.remarks;

      const updated = await api.patch(`/proposals/${selectedProposal.id}/status`, payload);
      setSelectedProposal(updated);
      setIsStatusDialogOpen(false);

      // Refresh listings & details
      await fetchProposals();
      await fetchStats();
      const hRes = await api.get(`/proposals/${selectedProposal.id}/history`).catch(() => []);
      setActivities(hRes);
    } catch (err: any) {
      setStatusError(err?.message || 'Failed to update proposal status');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Add Follow-up
  const handleAddFollowup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProposal) return;
    setFollowupError(null);

    try {
      setIsSubmitting(true);
      const res = await api.post(`/proposals/${selectedProposal.id}/follow-ups`, {
        followup_date: followupForm.followup_date,
        owner_id: followupForm.owner_id || user?.id,
        remarks: followupForm.remarks,
        outcome: followupForm.outcome || undefined,
        next_followup_date: followupForm.next_followup_date || undefined,
      });

      setSelectedProposal(res.proposal);
      setIsFollowupDialogOpen(false);
      setFollowupForm({
        followup_date: istToday(),
        owner_id: user?.id || '',
        remarks: '',
        outcome: '',
        next_followup_date: '',
      });

      // Reload followups & history
      const [fRes, hRes] = await Promise.all([
        api.get(`/proposals/${selectedProposal.id}/follow-ups`),
        api.get(`/proposals/${selectedProposal.id}/history`),
      ]);
      setFollowups(fRes);
      setActivities(hRes);
      await fetchProposals();
      await fetchStats();
    } catch (err: any) {
      setFollowupError(err?.message || 'Failed to log follow-up');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Copy Proposal Number
  const copyProposalNumber = (num: string) => {
    navigator.clipboard.writeText(num);
    setCopiedId(num);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Status Badge Helper
  const renderStatusBadge = (status: string) => {
    const s = status?.toUpperCase();
    const label = PROPOSAL_STATUS_LABELS[status] || status;

    switch (s) {
      case 'PROPOSAL_REQUESTED':
        return <Badge variant="default" hasDot>{label}</Badge>;
      case 'UNDER_PREPARATION':
        return <Badge variant="info" hasDot>{label}</Badge>;
      case 'READY_FOR_REVIEW':
        return <Badge variant="warning" hasDot>{label}</Badge>;
      case 'APPROVED':
        return <Badge variant="success" hasDot>{label}</Badge>;
      case 'SENT_TO_CUSTOMER':
        return <Badge variant="cyber" hasDot>{label}</Badge>;
      case 'FOLLOW_UP_REQUIRED':
        return <Badge variant="warning" hasDot>{label}</Badge>;
      case 'CONVERTED':
        return <Badge variant="success" hasDot>{label}</Badge>;
      case 'CLOSED':
        return <Badge variant="outline">{label}</Badge>;
      case 'LOST':
        return <Badge variant="danger" hasDot>{label}</Badge>;
      default:
        return <Badge variant="default">{label}</Badge>;
    }
  };

  // Lifecycle Stages definition for the visual stepper
  const STAGES = [
    { key: 'PROPOSAL_REQUESTED', label: 'Requested', desc: 'New request logged' },
    { key: 'UNDER_PREPARATION', label: 'Preparation', desc: 'Drafting specs & quotation' },
    { key: 'READY_FOR_REVIEW', label: 'Review', desc: 'Submitted for manager approval' },
    { key: 'APPROVED', label: 'Approved', desc: 'Pricing & terms cleared' },
    { key: 'SENT_TO_CUSTOMER', label: 'Sent', desc: 'Delivered to client' },
    { key: 'FOLLOW_UP_REQUIRED', label: 'Follow-up', desc: 'Active pipeline coordination' },
    { key: 'CONVERTED', label: 'Outcome', desc: 'Converted / Closed / Lost' },
  ];

  const getStageIndex = (status: string) => {
    const s = status?.toUpperCase();
    if (s === 'PROPOSAL_REQUESTED') return 0;
    if (s === 'UNDER_PREPARATION') return 1;
    if (s === 'READY_FOR_REVIEW') return 2;
    if (s === 'APPROVED') return 3;
    if (s === 'SENT_TO_CUSTOMER') return 4;
    if (s === 'FOLLOW_UP_REQUIRED') return 5;
    if (['CONVERTED', 'CLOSED', 'LOST'].includes(s)) return 6;
    return 0;
  };

  // Sectors list
  const SECTORS = [
    'Defence',
    'Police / Paramilitary',
    'Healthcare',
    'Infrastructure',
    'Private Security',
    'Government',
    'Aviation',
    'Corporate',
  ];

  // Pipeline strip + filter row helpers
  const headlineCards: { key: string; label: string; count: number; subtext: string; icon: React.ReactNode; kind: 'status' | 'followup'; value: string; color?: 'primary' | 'amber' | 'rose' | 'emerald' }[] = [
    { key: 'all', label: 'Total Proposals', count: stats.total_proposals || 0, subtext: 'Active & historical register', icon: <FileSpreadsheet className="h-4 w-4 text-[#0F5E63]" />, kind: 'status', value: 'all' },
    { key: 'prep', label: 'Under Preparation', count: stats.pending_preparation || 0, subtext: 'Technical & price drafting', icon: <Clock className="h-4 w-4 text-[#0F5E63]" />, kind: 'status', value: 'UNDER_PREPARATION', color: 'primary' },
    { key: 'review', label: 'Ready for Review', count: stats.ready_for_review || 0, subtext: 'Awaiting manager sign-off', icon: <AlertCircle className="h-4 w-4 text-amber-600" />, kind: 'status', value: 'READY_FOR_REVIEW', color: 'amber' },
    { key: 'overdue', label: 'Overdue Follow-ups', count: stats.overdue || 0, subtext: 'Requires immediate contact', icon: <AlertTriangle className="h-4 w-4 text-red-600" />, kind: 'followup', value: 'overdue', color: 'rose' },
    { key: 'converted', label: 'Converted to Orders', count: stats.converted || 0, subtext: 'Purchase orders secured', icon: <CheckCircle2 className="h-4 w-4 text-emerald-600" />, kind: 'status', value: 'CONVERTED', color: 'emerald' },
  ];
  const pickStatus = (status: string) => {
    setSelectedStatus(status);
    setActiveHudCard(null);
  };
  const pickFollowup = (key: string) => {
    setSelectedFollowupCondition((cur: string) => (cur === key ? 'all' : key));
    setActiveHudCard(null);
  };
  const hasActiveFilters = Boolean(
    search || selectedStatus !== 'all' || selectedSector !== 'all' || selectedFollowupCondition !== 'all' || selectedResponsibleId || selectedFollowupOwnerId || fromDate || toDate,
  );

  // Register rows → RecordItems (cards / stage board). Actions mirror the detail modal's workflow buttons.
  const openFollowupFor = (p: any) => {
    setSelectedProposal(p);
    setFollowupForm({
      followup_date: istToday(),
      owner_id: p.followup_owner_id || user?.id || '',
      remarks: '',
      outcome: '',
      next_followup_date: p.next_followup ? proposalDay(p.next_followup) : '',
    });
    setFollowupError(null);
    setIsFollowupDialogOpen(true);
  };
  const statusActionFor = (p: any, nextStatus: string) => () => {
    setSelectedProposal(p);
    initiateStatusChange(nextStatus);
  };
  const primaryFor = (p: any): RecordItem['primary'] => {
    switch (p.status) {
      case 'PROPOSAL_REQUESTED':
        return { label: 'Start preparation', onClick: statusActionFor(p, 'UNDER_PREPARATION') };
      case 'UNDER_PREPARATION':
        return { label: 'Submit for review', onClick: statusActionFor(p, 'READY_FOR_REVIEW') };
      case 'READY_FOR_REVIEW': {
        if (!['management', 'admin'].includes(user?.role || '')) return { label: 'Awaiting approval', disabled: true };
        const isCreator = Boolean(
          user &&
            [p.created_by_id, p.created_by, p.requested_by_id, p.requested_by, p.responsible_person_id, p.responsible_id].includes(user.id),
        );
        if (isCreator) return { label: 'Self-approval not allowed', disabled: true };
        return { label: 'Approve proposal', onClick: statusActionFor(p, 'APPROVED') };
      }
      case 'APPROVED':
        return { label: 'Mark sent', onClick: statusActionFor(p, 'SENT_TO_CUSTOMER') };
      case 'SENT_TO_CUSTOMER':
      case 'FOLLOW_UP_REQUIRED':
        return { label: 'Log follow-up', onClick: () => openFollowupFor(p) };
      default:
        return undefined;
    }
  };
  const todayIst = istToday();
  const laneByKey = new Map<string, string>();
  const recordItems: RecordItem[] = proposals.map((p) => {
    const upper = String(p.status || '').toUpperCase();
    const lane = proposalLaneOf(p.status);
    laneByKey.set(String(p.id), lane);
    const closed = ['CONVERTED', 'CLOSED', 'LOST'].includes(lane);
    const nextFollowupStr = p.next_followup ? proposalDay(p.next_followup) || null : null;
    const requiredStr = p.required_date ? proposalDay(p.required_date) || null : null;
    const isOverdue = Boolean(nextFollowupStr && nextFollowupStr < todayIst && !closed);
    const fmt = (d?: string | null) => (d ? new Date(d).toLocaleDateString('en-GB') : '—');
    const badges: RecordItem['badges'] = [];
    if (p.is_urgent && !closed) badges.push({ label: 'Urgent', tone: 'danger' });
    if (isOverdue) badges.push({ label: 'Follow-up overdue', tone: 'danger' });
    if (!nextFollowupStr && ['SENT_TO_CUSTOMER', 'FOLLOW_UP_REQUIRED'].includes(lane)) badges.push({ label: 'Follow-up not scheduled', tone: 'warning' });
    if (p.sent_late) badges.push({ label: 'Sent late', tone: 'warning' });
    const primary = primaryFor(p);
    const quick: RecordItem['quick'] = [{ label: `Edit ${p.proposal_number || 'proposal'}`, icon: <Edit2 />, onClick: () => openEditProposal(p) }];
    if (!closed && primary?.label !== 'Log follow-up') quick.unshift({ label: 'Log follow-up', icon: <MessageSquare />, onClick: () => openFollowupFor(p) });
    return {
      key: String(p.id),
      code: p.proposal_number,
      title: p.organisation_name || 'Unknown customer',
      subtitle: [p.product_name, p.sector || 'General'].filter(Boolean).join(' · '),
      status: { label: PROPOSAL_STATUS_LABELS[p.status] || p.status, tone: toneFor(PROPOSAL_STATUS_LABELS[p.status] || p.status) },
      badges,
      due: nextFollowupStr ? { date: nextFollowupStr, label: 'Follow-up', done: closed } : { date: requiredStr, label: 'Needed by', done: closed },
      owner: p.responsible_name || 'Unassigned',
      facts: [
        { label: 'Needed by', value: <span className="font-mono">{fmt(p.required_date)}</span> },
        upper === 'LOST' && p.lost_reason
          ? { label: 'Lost reason', value: p.lost_reason }
          : p.sent_date
            ? { label: 'Sent', value: <span className="font-mono">{fmt(p.sent_date)}</span> }
            : { label: 'Version', value: <span className="font-mono">{p.version || 'v1.0'}</span> },
        { label: 'Follow-up by', value: p.followup_owner_name || p.responsible_name || '—' },
        ...(p.reference ? [{ label: 'Email ref.', value: p.reference }] : []),
      ],
      primary,
      quick,
      onOpen: () => openProposalDetails(p),
    };
  });

  return (
    <PageContainer>
      {/* 1. Page Header */}
      <PageHeader
        title="Commercial Proposals"
        icon={<FileSpreadsheet className="h-6 w-6 text-[#0F5E63]" />}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                resetCreateForm();
                setNewProposal((prev) => ({
                  ...prev,
                  responsible_id: user?.id || prev.responsible_id,
                  followup_owner_id: user?.id || prev.followup_owner_id,
                }));
                setIsCreateOpen(true);
              }}
            >
              <Plus className="h-4 w-4 mr-1.5" />
              <span>New Proposal Request</span>
            </Button>
          </div>
        }
      />

      {/* Success Confirmation Banner */}
      {successMessage && (
        <div className="p-3 sm:p-4 bg-emerald-50 border border-emerald-300 rounded-[14px] text-emerald-900 flex items-center justify-between gap-3 shadow-xs animate-in fade-in duration-200">
          <div className="flex min-w-0 items-center gap-3">
            <div className="p-1.5 bg-emerald-600 text-white rounded-full shrink-0">
              <Check className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-wider text-emerald-800">Quotation Registered</p>
              <p className="text-xs font-medium text-emerald-900 [overflow-wrap:anywhere]">{successMessage}</p>
            </div>
          </div>
          <button
            onClick={() => setSuccessMessage(null)}
            className="shrink-0 text-emerald-700 hover:text-emerald-950 p-2.5 sm:p-1.5 rounded-lg hover:bg-emerald-100 transition-colors"
            title="Dismiss confirmation"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* 2. Key metrics — five cards, each filters the register (click again to clear). */}
      <StatGrid cols={5} className="gap-3">
        {headlineCards.map((c) => {
          const active = c.kind === 'status' ? selectedStatus === c.value && c.value !== 'all' : selectedFollowupCondition === c.value;
          return (
            <StatCard
              key={c.key}
              label={c.label}
              value={c.count}
              valueColor={c.color}
              subtext={c.subtext}
              icon={c.icon}
              className={active ? 'ring-2 ring-[#0F5E63] border-[#0F5E63]' : 'cursor-pointer'}
              onClick={() => (c.kind === 'status' ? pickStatus(active ? 'all' : c.value) : pickFollowup(c.value))}
            />
          );
        })}
      </StatGrid>

      {/* 3. One filter row: search, then compact dropdowns. */}
      <Card padding="sm" className="relative z-20 space-y-2.5 overflow-visible border-[#DCD8CE]">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
          <div className="relative w-full min-w-[200px] lg:w-auto lg:flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8A8578]" aria-hidden />
            <input
              type="search"
              aria-label="Search proposals"
              placeholder="Search proposal no., customer, product…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
              }}
              className="h-9 w-full rounded-lg border border-[#C9C4B8] bg-white pl-9 pr-3 text-xs text-[#14213D] placeholder:text-[#8A8578] focus:border-[#0F5E63] focus:outline-none focus:ring-2 focus:ring-[#0F5E63]/15"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2 max-sm:relative lg:flex-nowrap">
            <FilterMenu
              label="Status"
              className={PHONE_MENU}
              icon={<Layers />}
              options={[{ key: 'all', label: 'All statuses' }, ...PROPOSAL_STATUS_FILTERS].map((o) => ({
                ...o,
                active: selectedStatus === o.key,
                onSelect: () => pickStatus(o.key),
              }))}
            />
            <FilterMenu
              label="Sector"
              className={PHONE_MENU}
              icon={<Building />}
              options={['all', ...SECTORS].map((s) => ({
                key: s,
                label: s === 'all' ? 'All sectors' : s,
                active: selectedSector === s,
                onSelect: () => {
                  setSelectedSector(s);
                },
              }))}
            />
            <FilterMenu
              label="Follow-ups"
              className={PHONE_MENU}
              icon={<Clock />}
              options={[
                { key: 'all', label: 'All proposals', count: undefined },
                { key: 'overdue', label: 'Overdue', count: stats.overdue || 0 },
                { key: 'due_today', label: 'Due today', count: stats.due_today || 0 },
                { key: 'upcoming', label: 'Upcoming', count: undefined },
                { key: 'no_followup', label: 'Not scheduled', count: stats.no_followup || 0 },
                { key: 'old_inactivity', label: 'Inactive 7d+', count: stats.old_no_movement || 0 },
              ].map((f) => ({
                ...f,
                urgent: f.key === 'overdue',
                active: selectedFollowupCondition === f.key,
                onSelect: () => {
                  setSelectedFollowupCondition(f.key);
                },
              }))}
            />
            <FilterMenu
              label="Owner"
              icon={<User />}
              className={`${PHONE_MENU} [&_.filter-menu-panel]:max-h-[320px] [&_.filter-menu-panel]:overflow-y-auto`}
              options={[{ id: 'all', full_name: 'Anyone' }, ...users].map((u: any) => ({
                key: u.id,
                label: u.full_name,
                active: (selectedResponsibleId || 'all') === u.id,
                onSelect: () => {
                  setSelectedResponsibleId(u.id === 'all' ? '' : u.id);
                },
              }))}
            />
            <FilterMenu
              label="Follow-up by"
              icon={<Bell />}
              className={`${PHONE_MENU} [&_.filter-menu-panel]:max-h-[320px] [&_.filter-menu-panel]:overflow-y-auto`}
              options={[{ id: 'all', full_name: 'Anyone' }, ...users].map((u: any) => ({
                key: u.id,
                label: u.full_name,
                active: (selectedFollowupOwnerId || 'all') === u.id,
                onSelect: () => {
                  setSelectedFollowupOwnerId(u.id === 'all' ? '' : u.id);
                },
              }))}
            />
            <button
              type="button"
              onClick={() => setIsDateFilterOpen((prev) => !prev)}
              aria-expanded={isDateFilterOpen}
              className={`filter-menu-btn ${isDateFilterOpen || fromDate || toDate ? 'filter-menu-btn--on' : ''}`}
            >
              <CalendarDays className="h-3.5 w-3.5" />
              <span>Dates</span>
              {(fromDate || toDate) && <span className="filter-menu-chip">On</span>}
            </button>
            <FilterMenu
              label="Sort"
              className={PHONE_MENU}
              icon={<ArrowUpDown />}
              neutralKeys={[...SORT_FIELDS.map((f) => f.key), 'dir_desc', 'dir_asc']}
              align="right"
              options={[
                ...SORT_FIELDS.map((f) => ({
                  key: f.key,
                  label: f.label,
                  active: sortBy === f.key,
                  onSelect: () => {
                    setSortBy(f.key);
                  },
                })),
                { key: 'dir_desc', label: 'Descending', icon: <ChevronDown />, active: sortOrder === 'desc', onSelect: () => setSortOrder('desc') },
                { key: 'dir_asc', label: 'Ascending', icon: <ChevronUp />, active: sortOrder === 'asc', onSelect: () => setSortOrder('asc') },
              ]}
            />
            {hasActiveFilters && (
              <Button variant="ghost" size="xs" onClick={handleClearFilters} className="text-xs text-[#4A5568] hover:text-[#881337]">
                Clear
              </Button>
            )}
          </div>
        </div>

        {isDateFilterOpen && (
          // phones: the date field on its own row, From / To side by side under it; from `sm` up: one row
          <div className="grid grid-cols-2 gap-2 border-t border-[#ECE9E2] pt-2.5 text-xs sm:flex sm:flex-wrap sm:items-center sm:gap-3">
            <div className="col-span-2 flex min-w-0 items-center gap-3">
              <span className="font-semibold text-[#4A5568]">Date</span>
              <select
                value={dateField}
                onChange={(e) => {
                  setDateField(e.target.value);
                }}
                className="h-9 min-w-0 flex-1 rounded-lg border border-[#C9C4B8] bg-white px-2.5 text-[#14213D] focus:border-[#0F5E63] focus:outline-none sm:h-8 sm:flex-none"
              >
                <option value="request_date">Request date</option>
                <option value="required_date">Required completion date</option>
                <option value="sent_date">Sent date</option>
                <option value="next_followup">Next follow-up</option>
              </select>
            </div>
            <label className="flex min-w-0 flex-col gap-1 text-[#4A5568] sm:flex-row sm:items-center sm:gap-1.5">
              From
              <input
                type="date"
                value={fromDate}
                onChange={(e) => {
                  setFromDate(e.target.value);
                }}
                className="h-9 w-full min-w-0 rounded-lg border border-[#C9C4B8] bg-white px-2.5 text-xs text-[#14213D] focus:border-[#0F5E63] focus:outline-none sm:h-8 sm:w-auto"
              />
            </label>
            <label className="flex min-w-0 flex-col gap-1 text-[#4A5568] sm:flex-row sm:items-center sm:gap-1.5">
              To
              <input
                type="date"
                value={toDate}
                onChange={(e) => {
                  setToDate(e.target.value);
                }}
                className="h-9 w-full min-w-0 rounded-lg border border-[#C9C4B8] bg-white px-2.5 text-xs text-[#14213D] focus:border-[#0F5E63] focus:outline-none sm:h-8 sm:w-auto"
              />
            </label>
            {(fromDate || toDate) && (
              <Button
                variant="ghost"
                size="xs"
                onClick={() => {
                  setFromDate('');
                  setToDate('');
                }}
                className="col-span-2 justify-self-start text-xs text-[#4A5568] hover:text-[#881337]"
              >
                Reset dates
              </Button>
            )}
          </div>
        )}
      </Card>

      {/* 4. Register — priority cards or a stage board (Cards | Board toggle), one scrolling card */}
      {isLoading ? (
        <Card padding="none" className="border-[#DCD8CE] py-12 text-center text-xs text-[#4A5568]">
          <Spinner size="md" className="mx-auto mb-2" />
          Loading proposals…
        </Card>
      ) : (
        <RecordViews
          title="Proposal register"
          items={recordItems}
          lanes={PROPOSAL_LANES}
          laneOf={(i) => laneByKey.get(i.key) ?? 'PROPOSAL_REQUESTED'}
          storageKey="proposals"
          defaultView="board"
          hideEmptyLanes={selectedStatus !== 'all'}
          summary={
            <span className="font-mono text-xs">
              {proposals.length === total ? `${total} ${total === 1 ? 'proposal' : 'proposals'}` : `${proposals.length} of ${total} proposals`}
            </span>
          }
          empty={
            <div className="space-y-3">
              <p className="font-semibold text-[#14213D]">No proposals found</p>
              <p>{hasActiveFilters ? 'Try clearing the filters to see every proposal.' : 'Create your first proposal request to begin tracking.'}</p>
              {hasActiveFilters ? (
                <Button variant="secondary" size="sm" onClick={handleClearFilters}>
                  Clear filters
                </Button>
              ) : (
                <Button variant="primary" size="sm" onClick={() => setIsCreateOpen(true)}>
                  <Plus className="mr-1.5 h-4 w-4" />
                  <span>New proposal request</span>
                </Button>
              )}
            </div>
          }
          onLoadMore={proposalsList.loadMore}
          hasMore={proposalsList.hasMore}
          loadingMore={proposalsList.loadingMore}
        />
      )}

      {/* 5. Create Proposal Request Modal */}
      <Modal
        isOpen={isCreateOpen}
        onClose={() => {
          setIsCreateOpen(false);
          resetCreateForm();
        }}
        title="Create Proposal Request"
        description="Register a new commercial price quote inquiry with customer, sector, product, and responsibility tracking."
        maxWidth="2xl"
      >
        <form onSubmit={handleCreateProposal}>
          <FormSteps
            onCancel={() => {
              setIsCreateOpen(false);
              resetCreateForm();
            }}
            banner={
              (formError || duplicateWarning) && (
                <>
                  {formError && (
                    <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 flex items-center gap-2">
                      <AlertCircle className="h-4 w-4 shrink-0 text-red-600" />
                      <span>{formError}</span>
                    </div>
                  )}

                  {duplicateWarning && (
                    <div className="p-3.5 bg-amber-50 border border-amber-300 rounded-lg text-xs space-y-2">
                      <div className="flex items-start gap-2 text-amber-900">
                        <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-600" />
                        <div>
                          <span className="font-bold">Duplicate Proposal Detected: </span>
                          <span>{duplicateWarning.message}</span>
                        </div>
                      </div>
                      <div className="pt-1">
                        <label className="text-[11px] font-semibold text-amber-950 block mb-1">
                          Duplicate Override Reason <span className="text-red-600">*</span>
                        </label>
                        <input
                          type="text"
                          required
                          placeholder="e.g. New fiscal budget inquiry or distinct delivery scope"
                          value={duplicateOverrideReason}
                          onChange={(e) => setDuplicateOverrideReason(e.target.value)}
                          className="w-full text-xs py-1.5 px-3 bg-white border border-amber-300 rounded-lg text-[#14213D] focus:border-[#0F5E63] focus:outline-none"
                        />
                      </div>
                    </div>
                  )}
                </>
              )
            }
            submit={
              <Button variant="primary" type="submit" isLoading={isSubmitting}>
                {/* phones: the footer buttons share the width, so the full label would wrap onto two lines */}
                <span className="sm:hidden">{duplicateWarning ? 'Create anyway' : 'Create request'}</span>
                <span className="hidden sm:inline">{duplicateWarning ? 'Override & Create Quote' : 'Create Proposal Request'}</span>
              </Button>
            }
            steps={[
              {
                title: 'Customer',
                icon: <Building />,
                description: 'Which customer is asking for this quote, and how did the request reach us?',
                content: (
                  <div className="space-y-4">
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-[#14213D]">
                        Customer / Organisation <span className="text-red-500">*</span>
                      </label>
                      <select
                        required
                        value={newProposal.organisation_id}
                        onChange={(e) => {
                          setNewProposal({ ...newProposal, organisation_id: e.target.value });
                          setDuplicateWarning(null);
                        }}
                        className="w-full text-xs py-2 px-3 bg-[#FBFAF7] border border-[#DCD8CE] rounded-lg text-[#14213D] focus:border-[#0F5E63] focus:outline-none"
                      >
                        <option value="">Select customer organisation...</option>
                        {organisations.map((org) => (
                          <option key={org.id} value={org.id}>
                            {org.name} {org.city ? `(${org.city})` : ''}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-[#14213D]">
                          Sector / Department <span className="text-red-500">*</span>
                        </label>
                        <select
                          required
                          value={newProposal.sector}
                          onChange={(e) => setNewProposal({ ...newProposal, sector: e.target.value })}
                          className="w-full text-xs py-2 px-3 bg-[#FBFAF7] border border-[#DCD8CE] rounded-lg text-[#14213D] focus:border-[#0F5E63] focus:outline-none"
                        >
                          {SECTORS.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                      </div>

                      <Input
                        label="Email / Tender Reference"
                        placeholder="e.g. ATC/BSF/2026/092"
                        value={newProposal.reference}
                        onChange={(e) => setNewProposal({ ...newProposal, reference: e.target.value })}
                      />
                    </div>
                  </div>
                ),
              },
              {
                title: 'Requirement',
                icon: <Package />,
                description: 'What product is being quoted, and any specifications to keep in mind.',
                content: (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-[#14213D]">
                          Product Required <span className="text-red-500">*</span>
                        </label>
                        <select
                          required
                          value={newProposal.product_id}
                          onChange={(e) => {
                            setNewProposal({ ...newProposal, product_id: e.target.value });
                            setDuplicateWarning(null);
                          }}
                          className="w-full text-xs py-2 px-3 bg-[#FBFAF7] border border-[#DCD8CE] rounded-lg text-[#14213D] focus:border-[#0F5E63] focus:outline-none"
                        >
                          <option value="">Select product...</option>
                          {products.map((prod) => (
                            <option key={prod.id} value={prod.id}>
                              {prod.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <Input
                        label="Proposal Version"
                        placeholder="e.g. v1.0"
                        value={newProposal.version}
                        onChange={(e) => setNewProposal({ ...newProposal, version: e.target.value })}
                      />
                    </div>

                    <Textarea
                      label="Internal Remarks / Tender Specifications"
                      rows={3}
                      placeholder="Key technical points, warranty expectations, delivery timelines requested by client..."
                      value={newProposal.remarks}
                      onChange={(e) => setNewProposal({ ...newProposal, remarks: e.target.value })}
                    />
                  </div>
                ),
              },
              {
                title: 'Owner',
                icon: <User />,
                description: 'Who prepares this quote, and by when it is needed.',
                content: (
                  <div className="space-y-4">
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-[#14213D]">
                        Responsible Person (Owner) <span className="text-red-500">*</span>
                      </label>
                      <select
                        required
                        value={newProposal.responsible_id}
                        onChange={(e) =>
                          setNewProposal({
                            ...newProposal,
                            responsible_id: e.target.value,
                            followup_owner_id: newProposal.followup_owner_id || e.target.value,
                          })
                        }
                        className="w-full text-xs py-2 px-3 bg-[#FBFAF7] border border-[#DCD8CE] rounded-lg text-[#14213D] focus:border-[#0F5E63] focus:outline-none"
                      >
                        <option value="">Select responsible proposal owner...</option>
                        {users.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.full_name} ({u.role})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <Input
                        type="date"
                        label="Request Date"
                        required
                        value={newProposal.request_date}
                        onChange={(e) => setNewProposal({ ...newProposal, request_date: e.target.value })}
                      />

                      <Input
                        type="date"
                        label="Required Completion Date"
                        required
                        value={newProposal.required_date}
                        onChange={(e) => setNewProposal({ ...newProposal, required_date: e.target.value })}
                      />
                    </div>
                  </div>
                ),
              },
              {
                title: 'Follow-up',
                icon: <CalendarDays />,
                description: 'Who chases the customer after the quote goes out, and when to start.',
                content: (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-[#14213D]">Follow-up Owner</label>
                      <select
                        value={newProposal.followup_owner_id}
                        onChange={(e) => setNewProposal({ ...newProposal, followup_owner_id: e.target.value })}
                        className="w-full text-xs py-2 px-3 bg-[#FBFAF7] border border-[#DCD8CE] rounded-lg text-[#14213D] focus:border-[#0F5E63] focus:outline-none"
                      >
                        <option value="">Same as Responsible Person</option>
                        {users.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.full_name} ({u.role})
                          </option>
                        ))}
                      </select>
                    </div>

                    <Input
                      type="date"
                      label="Initial Follow-up Date (Optional)"
                      value={newProposal.next_followup}
                      onChange={(e) => setNewProposal({ ...newProposal, next_followup: e.target.value })}
                    />
                  </div>
                ),
              },
            ]}
          />
        </form>
      </Modal>

      {/* 6. Proposal Details Modal */}
      {selectedProposal && (
        <Modal
          isOpen={isDetailsOpen}
          onClose={() => setIsDetailsOpen(false)}
          title={`Proposal ${selectedProposal.proposal_number}`}
          description={`Registered on ${new Date(selectedProposal.created_at).toLocaleDateString('en-GB')} by ${selectedProposal.requested_by_name || 'System'}`}
          maxWidth="4xl"
        >
          <div className="space-y-6">
            {/* Top Bar with Number, Badges, and Quick Actions */}
            <div className="p-3 sm:p-4 bg-[#FBFAF7] border border-[#DCD8CE] rounded-xl flex flex-wrap items-center justify-between gap-3">
              {/* wraps on phones: the number stays on one line and Edit/Delete drop below instead of off the card */}
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="whitespace-nowrap font-mono text-base font-black text-[#0F5E63]">
                  {selectedProposal.proposal_number}
                </span>
                <button
                  onClick={() => copyProposalNumber(selectedProposal.proposal_number)}
                  className="-m-1 p-2 text-[#4A5568] hover:text-[#0F5E63] transition-colors sm:m-0 sm:p-1"
                  title="Copy Proposal Number"
                >
                  {copiedId === selectedProposal.proposal_number ? (
                    <Check className="h-4 w-4 text-emerald-600" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </button>
                <div className="mx-1 hidden h-4 w-px bg-[#DCD8CE] sm:block" />
                {renderStatusBadge(selectedProposal.status)}
                <span className="text-xs font-semibold px-2 py-0.5 bg-white border border-[#DCD8CE] rounded-md text-[#4A5568]">
                  Ver: {selectedProposal.version || 'v1.0'}
                </span>
                <Button
                  variant="outline"
                  size="xs"
                  onClick={() => openEditProposal(selectedProposal)}
                  className="text-xs text-[#4A5568] hover:text-[#0F5E63]"
                  title="Edit Proposal Metadata"
                >
                  <Edit2 className="h-3 w-3 mr-1" />
                  <span>Edit</span>
                </Button>
                {['admin', 'management'].includes(user?.role || '') && (
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => {
                      setDeleteError(null);
                      setIsDeleteConfirmOpen(true);
                    }}
                    className="text-xs text-red-600 hover:text-red-800 hover:bg-red-50"
                    title="Soft Delete Proposal"
                  >
                    <Trash2 className="h-3 w-3 mr-1" />
                    <span>Delete</span>
                  </Button>
                )}
              </div>

              {/* Workflow advancement actions — phones: their own full-width row of 40px buttons */}
              <div className="flex w-full flex-wrap items-center gap-2 empty:hidden sm:w-auto">
                {selectedProposal.status === 'PROPOSAL_REQUESTED' && (
                  <Button
                    variant="primary"
                    size="xs"
                    className={FLOW_BTN}
                    onClick={() => initiateStatusChange('UNDER_PREPARATION')}
                  >
                    <span>Start Preparation</span>
                    <ArrowRight className="h-3.5 w-3.5 ml-1" />
                  </Button>
                )}

                {selectedProposal.status === 'UNDER_PREPARATION' && (
                  <Button
                    variant="primary"
                    size="xs"
                    className={FLOW_BTN}
                    onClick={() => initiateStatusChange('READY_FOR_REVIEW')}
                  >
                    <span>Submit for Review</span>
                    <ArrowRight className="h-3.5 w-3.5 ml-1" />
                  </Button>
                )}

                {selectedProposal.status === 'READY_FOR_REVIEW' && (() => {
                  const isManagementOrAdmin = ['management', 'admin'].includes(user?.role || '');
                  const isCreator = Boolean(
                    user && (
                      selectedProposal.created_by_id === user.id ||
                      selectedProposal.created_by === user.id ||
                      selectedProposal.requested_by_id === user.id ||
                      selectedProposal.requested_by === user.id ||
                      selectedProposal.responsible_person_id === user.id ||
                      selectedProposal.responsible_id === user.id
                    )
                  );

                  if (!isManagementOrAdmin) {
                    return (
                      <span className="text-[11px] text-[#4A5568] bg-[#FBFAF7] px-2.5 py-1 rounded border border-[#DCD8CE] italic">
                        Awaiting Management / Admin Approval
                      </span>
                    );
                  }

                  if (isCreator) {
                    return (
                      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-amber-50 border border-amber-200 text-amber-800 text-[10px] font-medium" title="Dual-control policy: You created/authored this proposal and cannot approve your own quotation.">
                        <AlertTriangle className="h-3 w-3 text-amber-600 shrink-0" />
                        <span>Self-Approval Prohibited (Created by you)</span>
                      </div>
                    );
                  }

                  return (
                    <div className="flex w-full items-center gap-2 sm:w-auto">
                      <Button
                        variant="outline"
                        size="xs"
                        className={`${FLOW_BTN} text-red-700 border-red-200 hover:bg-red-50`}
                        onClick={() => initiateStatusChange('UNDER_PREPARATION')}
                      >
                        <X className="h-3.5 w-3.5 mr-1" />
                        <span>Request Changes</span>
                      </Button>
                      <Button
                        variant="success"
                        size="xs"
                        className={FLOW_BTN}
                        onClick={() => initiateStatusChange('APPROVED')}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                        <span>Approve Proposal</span>
                      </Button>
                    </div>
                  );
                })()}

                {selectedProposal.status === 'APPROVED' && (
                  <Button
                    variant="primary"
                    size="xs"
                    className={FLOW_BTN}
                    onClick={() => initiateStatusChange('SENT_TO_CUSTOMER')}
                  >
                    <Send className="h-3.5 w-3.5 mr-1" />
                    <span>Mark Sent to Customer</span>
                  </Button>
                )}

                {['SENT_TO_CUSTOMER', 'FOLLOW_UP_REQUIRED'].includes(selectedProposal.status) && (
                  <>
                    <Button
                      variant="primary"
                      size="xs"
                      className={`${FLOW_BTN} basis-full sm:basis-auto`}
                      onClick={() => {
                        setFollowupForm({
                          followup_date: istToday(),
                          owner_id: selectedProposal.followup_owner_id || user?.id || '',
                          remarks: '',
                          outcome: '',
                          next_followup_date: selectedProposal.next_followup
                            ? proposalDay(selectedProposal.next_followup)
                            : '',
                        });
                        setFollowupError(null);
                        setIsFollowupDialogOpen(true);
                      }}
                    >
                      <Plus className="h-3.5 w-3.5 mr-1" />
                      <span>Add Follow-up</span>
                    </Button>
                    <Button
                      variant="success"
                      size="xs"
                      className={FLOW_BTN}
                      onClick={() => initiateStatusChange('CONVERTED')}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                      <span>Mark Converted</span>
                    </Button>
                    <Button
                      variant="danger"
                      size="xs"
                      className={FLOW_BTN}
                      onClick={() => initiateStatusChange('LOST')}
                    >
                      <X className="h-3.5 w-3.5 mr-1" />
                      <span>Mark Lost</span>
                    </Button>
                  </>
                )}
              </div>
            </div>

            {/* Visual Lifecycle Stepper */}
            <div className="p-3 sm:p-4 bg-white border border-[#DCD8CE] rounded-xl shadow-2xs">
              <h4 className="text-xs font-bold uppercase tracking-wider text-[#4A5568] mb-3">
                Lifecycle Progression
              </h4>
              {/* phones: one sideways row of stage tiles that keeps the current stage in view; `sm` up: the grid.
                  The 2px pad (cancelled by the wrapper's -2px margin) keeps the current tile's ring unclipped. */}
              <ScrollStrip
                activeKey={getStageIndex(selectedProposal.status)}
                wrapperClassName="-m-0.5"
                className="gap-2 p-0.5 sm:grid sm:grid-cols-4 md:grid-cols-7"
              >
                {STAGES.map((st, i) => {
                  const currentIdx = getStageIndex(selectedProposal.status);
                  const isDone = i < currentIdx;
                  const isCurrent = i === currentIdx;

                  return (
                    <div
                      key={st.key}
                      data-active={isCurrent ? 'true' : undefined}
                      className={`w-[7.25rem] shrink-0 sm:w-auto p-2.5 rounded-lg border text-center relative flex flex-col justify-between transition-all ${
                        isCurrent
                          ? 'bg-[#E3EFEE] border-[#0F5E63] text-[#0F5E63] ring-2 ring-[#0F5E63]/20 shadow-xs'
                          : isDone
                          ? 'bg-emerald-50/60 border-emerald-200 text-emerald-800'
                          : 'bg-[#F8FAFC] border-[#DCD8CE] text-slate-400'
                      }`}
                    >
                      <div>
                        <div className="flex items-center justify-center mb-1">
                          {isDone ? (
                            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                          ) : (
                            <span
                              className={`h-4 w-4 rounded-full text-[10px] font-bold flex items-center justify-center ${
                                isCurrent
                                  ? 'bg-[#0F5E63] text-white'
                                  : 'bg-slate-200 text-slate-500'
                              }`}
                            >
                              {i + 1}
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] font-bold tracking-tight line-clamp-1">
                          {st.label}
                        </div>
                      </div>
                      <div className="text-[9px] text-[#4A5568] mt-1 line-clamp-1">
                        {st.desc}
                      </div>
                    </div>
                  );
                })}
              </ScrollStrip>
            </div>

            {/* Tabs for Overview, Follow-ups, and History */}
            <Tabs
              tabs={[
                { id: 'overview', label: 'Overview & Details', icon: <Briefcase className="h-4 w-4" /> },
                { id: 'followups', label: `Follow-ups (${followups.length})`, icon: <MessageSquare className="h-4 w-4" /> },
                { id: 'history', label: `Activity History (${activities.length})`, icon: <History className="h-4 w-4" /> },
                { id: 'linked', label: 'Linked Records', icon: <Layers className="h-4 w-4" /> },
              ]}
              activeTab={detailsTab}
              onChange={(id) => setDetailsTab(id as any)}
              variant="segmented"
            />

            {/* Tab 1: Overview */}
            {detailsTab === 'overview' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Customer & Product Card */}
                <Card padding="md" className="p-3 sm:p-5 border-[#DCD8CE] space-y-3">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-[#4A5568] flex items-center gap-1.5 border-b border-[#F0F5FC] pb-2">
                    <Building className="h-3.5 w-3.5 text-[#0F5E63]" />
                    <span>Customer & Product Specs</span>
                  </h4>
                  <div className="space-y-2 text-xs">
                    <div>
                      <span className="text-[#4A5568] block text-[10px] uppercase font-semibold">Customer Organisation</span>
                      {canOpen(user?.role, '/leads') && (selectedProposal.customer_id || selectedProposal.organisation_id) ? (
                        <Link
                          href={`/leads?customer=${selectedProposal.customer_id || selectedProposal.organisation_id}`}
                          className="font-bold text-[#0F5E63] text-sm hover:underline"
                          title="Open Customer 360"
                        >
                          {selectedProposal.organisation_name}
                        </Link>
                      ) : (
                        <span className="font-bold text-[#14213D] text-sm">{selectedProposal.organisation_name}</span>
                      )}
                      {selectedProposal.lead_id && canOpen(user?.role, '/leads') && (
                        <Link href={`/leads?open=${selectedProposal.lead_id}`} className="ml-2 text-[11px] font-semibold text-[#0F5E63] hover:underline">
                          Source lead
                        </Link>
                      )}
                      {selectedProposal.organisation_city && (
                        <span className="text-[#4A5568] ml-2">({selectedProposal.organisation_city}, {selectedProposal.organisation_state})</span>
                      )}
                    </div>
                    <div>
                      <span className="text-[#4A5568] block text-[10px] uppercase font-semibold">Product Inquired</span>
                      <span className="font-semibold text-[#14213D]">{selectedProposal.product_name}</span>
                      {selectedProposal.product_category && (
                        <span className="text-[#4A5568] ml-2">[{selectedProposal.product_category}]</span>
                      )}
                    </div>
                    <div>
                      <span className="text-[#4A5568] block text-[10px] uppercase font-semibold">Sector / Department</span>
                      <span className="font-medium text-[#14213D]">{selectedProposal.sector}</span>
                    </div>
                    {selectedProposal.reference && (
                      <div>
                        <span className="text-[#4A5568] block text-[10px] uppercase font-semibold">Email / Tender Reference</span>
                        <span className="font-mono text-[#0F5E63]">{selectedProposal.reference}</span>
                      </div>
                    )}
                  </div>
                </Card>

                {/* Timeline Card */}
                <Card padding="md" className="p-3 sm:p-5 border-[#DCD8CE] space-y-3">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-[#4A5568] flex items-center gap-1.5 border-b border-[#F0F5FC] pb-2">
                    <Calendar className="h-3.5 w-3.5 text-[#0F5E63]" />
                    <span>Milestones & Timeline</span>
                  </h4>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <span className="text-[#4A5568] block text-[10px] uppercase font-semibold">Request Date</span>
                      <span className="font-medium text-[#14213D]">
                        {selectedProposal.request_date ? new Date(selectedProposal.request_date).toLocaleDateString('en-GB') : '-'}
                      </span>
                    </div>
                    <div>
                      <span className="text-[#4A5568] block text-[10px] uppercase font-semibold">Required Completion</span>
                      <span className="font-medium text-[#14213D]">
                        {selectedProposal.required_date ? new Date(selectedProposal.required_date).toLocaleDateString('en-GB') : '-'}
                      </span>
                    </div>
                    <div>
                      <span className="text-[#4A5568] block text-[10px] uppercase font-semibold">Approval Date</span>
                      <span className="font-medium text-[#14213D]">
                        {selectedProposal.approved_at ? new Date(selectedProposal.approved_at).toLocaleDateString('en-GB') : '-'}
                      </span>
                      {selectedProposal.approved_by_name && (
                        <span className="block text-[10px] text-[#4A5568]">by {selectedProposal.approved_by_name}</span>
                      )}
                    </div>
                    <div>
                      <span className="text-[#4A5568] block text-[10px] uppercase font-semibold">Sent to Customer</span>
                      <span className="font-medium text-[#14213D]">
                        {selectedProposal.sent_date ? new Date(selectedProposal.sent_date).toLocaleDateString('en-GB') : '-'}
                      </span>
                    </div>
                    <div>
                      <span className="text-[#4A5568] block text-[10px] uppercase font-semibold">Responsible Rep</span>
                      <span className="font-medium text-[#14213D]">{selectedProposal.responsible_name || '-'}</span>
                    </div>
                    <div>
                      <span className="text-[#4A5568] block text-[10px] uppercase font-semibold">Follow-up Owner</span>
                      <span className="font-medium text-[#14213D]">{selectedProposal.followup_owner_name || '-'}</span>
                    </div>
                  </div>
                </Card>

                {/* Outcome card if completed */}
                {['CONVERTED', 'LOST', 'CLOSED'].includes(selectedProposal.status) && (
                  <Card padding="md" className="p-3 sm:p-5 border-[#DCD8CE] md:col-span-2 bg-[#FBFAF7]">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-[#4A5568] mb-2">
                      Proposal Outcome Record
                    </h4>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                      <div>
                        <span className="text-[#4A5568] block text-[10px] uppercase font-semibold">Final Status</span>
                        <span className="font-black text-sm">{selectedProposal.status}</span>
                      </div>
                      {selectedProposal.lost_reason && (
                        <div>
                          <span className="text-[#4A5568] block text-[10px] uppercase font-semibold">Lost Reason</span>
                          <span className="font-bold text-red-700">{selectedProposal.lost_reason}</span>
                          {selectedProposal.lost_remarks && (
                            <p className="text-[11px] text-[#4A5568] mt-1">{selectedProposal.lost_remarks}</p>
                          )}
                        </div>
                      )}
                      {selectedProposal.converted_to && (
                        <div>
                          <span className="text-[#4A5568] block text-[10px] uppercase font-semibold">Converted To</span>
                          <span className="font-bold text-emerald-700">{selectedProposal.converted_to}</span>
                          {selectedProposal.converted_reference && (
                            <p className="text-[11px] text-[#4A5568] mt-1">{selectedProposal.converted_reference}</p>
                          )}
                        </div>
                      )}
                    </div>
                  </Card>
                )}

                {/* Remarks Card */}
                {selectedProposal.remarks && (
                  <Card padding="md" className="p-3 sm:p-5 border-[#DCD8CE] md:col-span-2">
                    <span className="text-[#4A5568] block text-[10px] uppercase font-semibold mb-1">Remarks & Details</span>
                    <p className="text-xs text-[#14213D] whitespace-pre-wrap leading-relaxed">
                      {selectedProposal.remarks}
                    </p>
                  </Card>
                )}
              </div>
            )}

            {/* Tab 4: everything linked to this proposal across modules */}
            {detailsTab === 'linked' && (
              <RelatedRecords
                to={{ kind: 'proposal', id: selectedProposal.id, organisationId: selectedProposal.customer_id || selectedProposal.organisation_id }}
                sections={['tasks', 'demos', 'tenders', 'service']}
                description="Follow-up tasks created from this proposal, and the customer's demos, tenders and service tickets."
                addTask={{ title: `Proposal follow-up: ${selectedProposal.proposal_no || selectedProposal.proposal_number || ''}`.trim() }}
              />
            )}

            {/* Tab 2: Follow-up Tracking */}
            {detailsTab === 'followups' && (
              <div className="space-y-4">
                {/* Active Follow-up Banner */}
                <div className="p-3 bg-[#F8FAFC] border border-[#DCD8CE] rounded-xl flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0 text-xs">
                    <span className="text-[#4A5568] block text-[10px] uppercase font-semibold">Current Follow-up Status</span>
                    <div className="font-semibold text-[#14213D] mt-0.5">
                      Next Contact: {selectedProposal.next_followup ? new Date(selectedProposal.next_followup).toLocaleDateString('en-GB') : 'No date scheduled'}
                      {selectedProposal.followup_owner_name && (
                        <span className="text-[#4A5568] font-normal ml-2">(Owner: {selectedProposal.followup_owner_name})</span>
                      )}
                    </div>
                  </div>
                  <Button
                    variant="primary"
                    size="xs"
                    className="h-10 w-full text-xs sm:h-7 sm:w-auto sm:text-[11px]"
                    onClick={() => {
                      setFollowupForm({
                        followup_date: istToday(),
                        owner_id: selectedProposal.followup_owner_id || user?.id || '',
                        remarks: '',
                        outcome: '',
                        next_followup_date: '',
                      });
                      setFollowupError(null);
                        setIsFollowupDialogOpen(true);
                    }}
                  >
                    <Plus className="h-3.5 w-3.5 mr-1" />
                    <span>Log New Follow-up</span>
                  </Button>
                </div>

                {/* Follow-up Timeline Entries */}
                {followups.length === 0 ? (
                  <div className="p-8 text-center text-xs text-[#4A5568] bg-white border border-[#DCD8CE] rounded-xl">
                    No follow-ups logged yet for this proposal.
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {followups.map((f) => (
                      <div
                        key={f.id}
                        className="p-3 bg-white border border-[#DCD8CE] rounded-xl text-xs space-y-1 hover:border-[#0F5E63] transition-colors"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 font-semibold text-[#14213D]">
                          <span className="flex items-center gap-1.5 text-[#0F5E63]">
                            <Calendar className="h-3.5 w-3.5" />
                            {new Date(f.followup_date).toLocaleDateString('en-GB')}
                          </span>
                          <span className="text-[11px] font-normal text-[#4A5568]">
                            Logged by {f.owner_name}
                          </span>
                        </div>
                        <p className="text-[#14213D] mt-1">{f.remarks}</p>
                        {f.outcome && (
                          <div className="text-[11px] text-emerald-700 font-medium">
                            Result / Outcome: {f.outcome}
                          </div>
                        )}
                        {f.next_followup_date && (
                          <div className="text-[10px] text-[#4A5568]">
                            Next Action Scheduled: {new Date(f.next_followup_date).toLocaleDateString('en-GB')}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Tab 3: Activity History */}
            {detailsTab === 'history' && (
              <div className="space-y-3">
                {activities.length === 0 ? (
                  <div className="p-8 text-center text-xs text-[#4A5568] bg-white border border-[#DCD8CE] rounded-xl">
                    No historical events recorded yet.
                  </div>
                ) : (
                  activities.map((act) => (
                    <div
                      key={act.id}
                      className="p-3 bg-white border border-[#DCD8CE] rounded-xl text-xs flex items-start gap-3"
                    >
                      <div className="p-1.5 rounded-lg bg-[#FBFAF7] border border-[#DCD8CE] text-[#0F5E63] shrink-0 mt-0.5">
                        <History className="h-3.5 w-3.5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5">
                          <span className="font-bold text-[#14213D]">{act.action}</span>
                          <span className="text-[10px] text-[#4A5568]">
                            {new Date(act.created_at).toLocaleString('en-GB')}
                          </span>
                        </div>
                        <div className="text-[#4A5568] mt-0.5">
                          {act.new_value || act.old_value}
                        </div>
                        {act.performed_by_name && (
                          <div className="text-[10px] text-[#4A5568] mt-0.5 font-medium">
                            by {act.performed_by_name}
                          </div>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* 7. Status Transition Dialog */}
      <Modal
        isOpen={isStatusDialogOpen}
        onClose={() => setIsStatusDialogOpen(false)}
        title={`Advance Status: ${PROPOSAL_STATUS_LABELS[targetStatus] || targetStatus}`}
        description="Verify milestone transition requirements."
        maxWidth="md"
      >
        <form onSubmit={handleStatusSubmit} className="space-y-4">
          {statusError && (
            <InfoCallout variant="danger" title="Could not save" onClose={() => setStatusError(null)}>
              {statusError}
            </InfoCallout>
          )}
          {targetStatus === 'SENT_TO_CUSTOMER' && (
            <Input
              type="date"
              label="Proposal Sent Date"
              required
              max={istToday()}
              helperText="Defaults to today (IST). Cannot be in the future or before the request date."
              value={statusForm.sent_date}
              onChange={(e) => setStatusForm({ ...statusForm, sent_date: e.target.value })}
            />
          )}

          {targetStatus === 'LOST' && (
            <>
              <div className="space-y-1">
                <label className="text-xs font-semibold text-[#14213D]">
                  Lost Reason <span className="text-red-500">*</span>
                </label>
                <select
                  required
                  value={statusForm.lost_reason}
                  onChange={(e) => setStatusForm({ ...statusForm, lost_reason: e.target.value as any })}
                  className="w-full text-xs py-2 px-3 bg-[#FBFAF7] border border-[#DCD8CE] rounded-lg text-[#14213D] focus:border-[#0F5E63] focus:outline-none"
                >
                  {PROPOSAL_LOST_REASONS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>
              <Textarea
                label="Lost Remarks / Competitor Details"
                placeholder="Competitor price, client cancellation reasons..."
                value={statusForm.lost_remarks}
                onChange={(e) => setStatusForm({ ...statusForm, lost_remarks: e.target.value })}
              />
            </>
          )}

          {targetStatus === 'CONVERTED' && (
            <>
              <Input
                label="Converted To / Order Reference"
                placeholder="e.g. Purchase Order #PO-2026-881"
                required
                value={statusForm.converted_to}
                onChange={(e) => setStatusForm({ ...statusForm, converted_to: e.target.value })}
              />
              <Input
                label="Contract / GeM Number"
                placeholder="e.g. GeM Contract GEMC-5116877"
                value={statusForm.converted_reference}
                onChange={(e) => setStatusForm({ ...statusForm, converted_reference: e.target.value })}
              />
            </>
          )}

          <Textarea
            label="Transition Remarks"
            placeholder="Add optional notes for this status update..."
            value={statusForm.remarks}
            onChange={(e) => setStatusForm({ ...statusForm, remarks: e.target.value })}
          />

          <div className={DIALOG_FOOTER}>
            <Button variant="outline" size="sm" className={DIALOG_BTN} type="button" onClick={() => setIsStatusDialogOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" className={DIALOG_BTN} type="submit" isLoading={isSubmitting}>
              Confirm Transition
            </Button>
          </div>
        </form>
      </Modal>

      {/* 8. Add Follow-up Dialog */}
      <Modal
        isOpen={isFollowupDialogOpen}
        onClose={() => setIsFollowupDialogOpen(false)}
        title="Log Proposal Follow-up"
        description="Record customer interaction, discussions, and update pipeline schedules."
        maxWidth="md"
      >
        <form onSubmit={handleAddFollowup} className="space-y-4">
          {followupError && (
            <InfoCallout variant="danger" title="Could not save" onClose={() => setFollowupError(null)}>
              {followupError}
            </InfoCallout>
          )}
          <FormSection title="Interaction" icon={<Calendar />} description="When the customer was contacted, and by whom.">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input
                type="date"
                label="Follow-up Date"
                required
                max={istToday()}
                value={followupForm.followup_date}
                onChange={(e) => setFollowupForm({ ...followupForm, followup_date: e.target.value })}
              />
              <div className="space-y-1">
                <label className="text-xs font-semibold text-[#14213D]">
                  Follow-up Owner <span className="text-red-500">*</span>
                </label>
                <select
                  required
                  value={followupForm.owner_id}
                  onChange={(e) => setFollowupForm({ ...followupForm, owner_id: e.target.value })}
                  className="w-full text-xs py-2 px-3 bg-[#FBFAF7] border border-[#DCD8CE] rounded-lg text-[#14213D] focus:border-[#0F5E63] focus:outline-none"
                >
                  <option value="">Select owner...</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.full_name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </FormSection>

          <FormSection title="Discussion" icon={<MessageSquare />} description="What was discussed, where it stands, and when to check in next.">
            <div className="space-y-3">
              <Textarea
                label="Meeting / Call Discussion Remarks"
                required
                rows={3}
                placeholder="Discussed pricing terms, client requested revised delivery timeline..."
                value={followupForm.remarks}
                onChange={(e) => setFollowupForm({ ...followupForm, remarks: e.target.value })}
              />

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Input
                  label="Outcome / Current Result"
                  placeholder="e.g. Positive acknowledge, sample demo requested"
                  value={followupForm.outcome}
                  onChange={(e) => setFollowupForm({ ...followupForm, outcome: e.target.value })}
                />

                <Input
                  type="date"
                  label="Next Follow-up Date (Optional)"
                  value={followupForm.next_followup_date}
                  onChange={(e) => setFollowupForm({ ...followupForm, next_followup_date: e.target.value })}
                />
              </div>
            </div>
          </FormSection>

          <div className={DIALOG_FOOTER}>
            <Button variant="outline" size="sm" className={DIALOG_BTN} type="button" onClick={() => setIsFollowupDialogOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" className={DIALOG_BTN} type="submit" isLoading={isSubmitting}>
              Log Follow-up
            </Button>
          </div>
        </form>
      </Modal>

      {/* 9. Edit Proposal Details Modal */}
      {selectedProposal && (
        <Modal
          isOpen={isEditOpen}
          onClose={() => setIsEditOpen(false)}
          title={`Edit Proposal: ${selectedProposal.proposal_number}`}
          description="Update tracking metadata, assigned owners, delivery requirements, or remarks."
          maxWidth="md"
        >
          <form onSubmit={handleEditProposal} className="space-y-4">
            {editError && (
              <InfoCallout variant="danger" title="Could not save" onClose={() => setEditError(null)}>
                {editError}
              </InfoCallout>
            )}
            <FormSection title="Schedule & Reference" icon={<CalendarDays />} description="Due date, version and the customer's reference for this quote.">
              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Input
                    type="date"
                    label="Required Completion Date"
                    required
                    value={editForm.required_date}
                    min={proposalDay(selectedProposal.request_date) || undefined}
                    onChange={(e) => setEditForm({ ...editForm, required_date: e.target.value })}
                  />
                  <Input
                    label="Proposal Version"
                    placeholder="e.g. v1.1"
                    value={editForm.version}
                    onChange={(e) => setEditForm({ ...editForm, version: e.target.value })}
                  />
                </div>

                {editForm.required_date !== proposalDay(selectedProposal.required_date) && (
                  <Input
                    label="Reason for changing the required date"
                    required
                    placeholder="e.g. Customer extended the submission window"
                    value={editForm.required_date_change_reason}
                    onChange={(e) => setEditForm({ ...editForm, required_date_change_reason: e.target.value })}
                  />
                )}

                <Input
                  label="Email / Tender Reference"
                  placeholder="e.g. ATC/BSF/2026/092"
                  value={editForm.reference}
                  onChange={(e) => setEditForm({ ...editForm, reference: e.target.value })}
                />
              </div>
            </FormSection>

            <FormSection title="Owners & Notes" icon={<User />} description="Who prepares the quote, who follows up, and internal notes.">
              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-[#14213D]">Responsible Person</label>
                    <select
                      value={editForm.responsible_id}
                      onChange={(e) => setEditForm({ ...editForm, responsible_id: e.target.value })}
                      className="w-full text-xs py-2 px-3 bg-[#FBFAF7] border border-[#DCD8CE] rounded-lg text-[#14213D] focus:border-[#0F5E63] focus:outline-none"
                    >
                      {users.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.full_name} ({u.role})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-[#14213D]">Follow-up Owner</label>
                    <select
                      value={editForm.followup_owner_id}
                      onChange={(e) => setEditForm({ ...editForm, followup_owner_id: e.target.value })}
                      className="w-full text-xs py-2 px-3 bg-[#FBFAF7] border border-[#DCD8CE] rounded-lg text-[#14213D] focus:border-[#0F5E63] focus:outline-none"
                    >
                      {users.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.full_name} ({u.role})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <Textarea
                  label="Internal Remarks / Notes"
                  rows={3}
                  placeholder="Add or update notes..."
                  value={editForm.remarks}
                  onChange={(e) => setEditForm({ ...editForm, remarks: e.target.value })}
                />
              </div>
            </FormSection>

            <div className={DIALOG_FOOTER}>
              <Button variant="outline" size="sm" className={DIALOG_BTN} type="button" onClick={() => setIsEditOpen(false)}>
                Cancel
              </Button>
              <Button variant="primary" size="sm" className={DIALOG_BTN} type="submit" isLoading={isSubmitting}>
                Save Changes
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* 10. Delete Confirmation Modal */}
      {selectedProposal && (
        <Modal
          isOpen={isDeleteConfirmOpen}
          onClose={() => setIsDeleteConfirmOpen(false)}
          title="Delete Proposal"
          description={`Are you sure you want to delete proposal ${selectedProposal.proposal_number}?`}
          maxWidth="sm"
        >
          <div className="space-y-4">
            {deleteError && (
              <InfoCallout variant="danger" title="Could not delete" onClose={() => setDeleteError(null)}>
                {deleteError}
              </InfoCallout>
            )}
            <p className="text-xs text-[#4A5568] leading-relaxed">
              This will soft-delete the proposal record from active views. Historical audit events and logged customer follow-ups will be safely preserved in the database.
            </p>
            <div className={DIALOG_FOOTER}>
              <Button variant="outline" size="sm" className={DIALOG_BTN} type="button" onClick={() => setIsDeleteConfirmOpen(false)}>
                Cancel
              </Button>
              <Button variant="danger" size="sm" className={DIALOG_BTN} type="button" onClick={handleDeleteProposal} isLoading={isSubmitting}>
                Delete Proposal
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </PageContainer>
  );
}
