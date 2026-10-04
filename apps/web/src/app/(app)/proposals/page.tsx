'use client';

import React, { useState, useEffect, useTransition, useCallback } from 'react';
import {
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
  ChevronRight,
  ChevronLeft,
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
  EmptyState,
  StatGrid,
  StatCard,
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
  Tabs,
} from '@/components/ui';
import {
  PROPOSAL_STATUS_LABELS,
  PROPOSAL_LOST_REASONS,
  type ProposalStatus,
  type ProposalLostReason,
} from '@arihant/shared';

export default function ProposalsPage() {
  const { user } = useAuth();

  // Proposals data & pagination
  const [proposals, setProposals] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [limit] = useState(15);
  const [isLoading, setIsLoading] = useState(true);

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
  const [detailsTab, setDetailsTab] = useState<'overview' | 'followups' | 'history'>('overview');
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
  });

  // Action dialogs
  const [isStatusDialogOpen, setIsStatusDialogOpen] = useState(false);
  const [targetStatus, setTargetStatus] = useState<string>('');
  const [statusForm, setStatusForm] = useState({
    sent_date: new Date().toISOString().split('T')[0],
    lost_reason: 'Price' as ProposalLostReason,
    lost_remarks: '',
    converted_to: '',
    converted_reference: '',
    remarks: '',
  });

  const [isFollowupDialogOpen, setIsFollowupDialogOpen] = useState(false);
  const [followupForm, setFollowupForm] = useState({
    followup_date: new Date().toISOString().split('T')[0],
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
    request_date: new Date().toISOString().split('T')[0],
    required_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    version: 'v1.0',
    reference: '',
    followup_owner_id: '',
    next_followup: '',
    remarks: '',
  });

  const [formError, setFormError] = useState<string | null>(null);
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
      request_date: new Date().toISOString().split('T')[0],
      required_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
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

  // Fetch Proposals List with complete multi-column filters, sorting and pagination
  const fetchProposals = useCallback(async () => {
    try {
      setIsLoading(true);
      const params: any = {
        page,
        limit,
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

      const res = await api.get('/proposals', params);
      setProposals(res.data || []);
      setTotal(res.total || 0);
      setTotalPages(res.totalPages || 1);
    } catch (err) {
      console.error('Failed to load proposals:', err);
    } finally {
      setIsLoading(false);
    }
  }, [
    page,
    limit,
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

  // Initial load
  useEffect(() => {
    fetchMasters();
    fetchStats();
  }, []);

  // Reload proposals on filter changes
  useEffect(() => {
    fetchProposals();
  }, [fetchProposals]);

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
      required_date: proposal.required_date ? String(proposal.required_date).split('T')[0] : '',
      version: proposal.version || 'v1.0',
      reference: proposal.reference || '',
      remarks: proposal.remarks || '',
      responsible_id: proposal.responsible_id || '',
      followup_owner_id: proposal.followup_owner_id || '',
    });
    setIsEditOpen(true);
  };

  // Submit Edit Proposal
  const handleEditProposal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProposal) return;
    try {
      setIsSubmitting(true);
      const payload: any = {
        required_date: editForm.required_date,
        version: editForm.version || undefined,
        reference: editForm.reference || undefined,
        remarks: editForm.remarks || undefined,
        responsible_id: editForm.responsible_id || undefined,
        followup_owner_id: editForm.followup_owner_id || undefined,
      };
      const updated = await api.patch(`/proposals/${selectedProposal.id}`, payload);
      setSelectedProposal(updated);
      setIsEditOpen(false);
      await fetchProposals();
      await fetchStats();
      const hRes = await api.get(`/proposals/${selectedProposal.id}/history`).catch(() => []);
      setActivities(hRes);
    } catch (err: any) {
      alert(err.message || 'Failed to update proposal details');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Delete Proposal (Soft Delete)
  const handleDeleteProposal = async () => {
    if (!selectedProposal) return;
    try {
      setIsSubmitting(true);
      await api.delete(`/proposals/${selectedProposal.id}`);
      setIsDeleteConfirmOpen(false);
      setIsDetailsOpen(false);
      setSelectedProposal(null);
      await fetchProposals();
      await fetchStats();
    } catch (err: any) {
      alert(err.message || 'Failed to delete proposal');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle interactive table header sort
  const handleSort = (field: string) => {
    if (sortBy === field) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(field);
      setSortOrder('desc');
    }
    setPage(1);
  };

  // Handle clicking on HUD stat cards to auto-filter
  const handleStatCardClick = (filterType: string, value: string, hudKey: string) => {
    if (activeHudCard === hudKey) {
      // Toggle off
      setActiveHudCard(null);
      setSelectedStatus('all');
      setSelectedFollowupCondition('all');
    } else {
      setActiveHudCard(hudKey);
      if (filterType === 'status') {
        setSelectedStatus(value);
        setSelectedFollowupCondition('all');
      } else if (filterType === 'followup') {
        setSelectedFollowupCondition(value);
        setSelectedStatus('all');
      }
    }
    setPage(1);
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
    setPage(1);
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
    const todayStr = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());

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
      setPage(1);

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
    setStatusForm({
      sent_date: new Date().toISOString().split('T')[0],
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
      alert(err.message || 'Failed to update proposal status');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Add Follow-up
  const handleAddFollowup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProposal) return;

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
        followup_date: new Date().toISOString().split('T')[0],
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
      alert(err.message || 'Failed to log follow-up');
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

  return (
    <PageContainer>
      {/* 1. Page Header */}
      <PageHeader
        title="Commercial Proposal Register"
        description="Centralized tracker and lifecycle management for tender quotations, commercial bids, and customer follow-up actions."
        icon={<FileSpreadsheet className="h-6 w-6 text-[#0F5E63]" />}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                fetchProposals();
                fetchStats();
              }}
              isLoading={isLoading}
              title="Refresh register"
            >
              <RefreshCw className="h-4 w-4 mr-1" />
              <span>Refresh</span>
            </Button>
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
        <div className="p-4 bg-emerald-50 border border-emerald-300 rounded-[14px] text-emerald-900 flex items-center justify-between shadow-xs animate-in fade-in duration-200">
          <div className="flex items-center gap-3">
            <div className="p-1.5 bg-emerald-600 text-white rounded-full shrink-0">
              <Check className="h-4 w-4" />
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-emerald-800">Quotation Registered</p>
              <p className="text-xs font-medium text-emerald-900">{successMessage}</p>
            </div>
          </div>
          <button
            onClick={() => setSuccessMessage(null)}
            className="text-emerald-700 hover:text-emerald-950 p-1.5 rounded-lg hover:bg-emerald-100 transition-colors"
            title="Dismiss confirmation"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* 2. Executive Metric HUD (StatCards with click-to-filter capability) */}
      <StatGrid cols={5} className="gap-3">
        <StatCard
          label="Total Proposals"
          value={stats.total_proposals || 0}
          subtext="Active & historical register"
          icon={<FileSpreadsheet className="h-4 w-4 text-[#0F5E63]" />}
          className={activeHudCard === 'all' ? 'ring-2 ring-[#0F5E63] border-[#0F5E63]' : 'cursor-pointer'}
          onClick={() => handleStatCardClick('status', 'all', 'all')}
        />
        <StatCard
          label="Under Preparation"
          value={stats.pending_preparation || 0}
          valueColor="primary"
          subtext="Technical & price drafting"
          icon={<Clock className="h-4 w-4 text-[#0F5E63]" />}
          className={activeHudCard === 'prep' ? 'ring-2 ring-[#0F5E63] border-[#0F5E63]' : 'cursor-pointer'}
          onClick={() => handleStatCardClick('status', 'UNDER_PREPARATION', 'prep')}
        />
        <StatCard
          label="Ready for Review"
          value={stats.ready_for_review || 0}
          valueColor="amber"
          subtext="Awaiting manager sign-off"
          icon={<AlertCircle className="h-4 w-4 text-amber-600" />}
          className={activeHudCard === 'review' ? 'ring-2 ring-amber-500 border-amber-500' : 'cursor-pointer'}
          onClick={() => handleStatCardClick('status', 'READY_FOR_REVIEW', 'review')}
        />
        <StatCard
          label="Follow-ups Due Today"
          value={stats.due_today || 0}
          valueColor="amber"
          subtext="Scheduled for contact today"
          icon={<Calendar className="h-4 w-4 text-amber-600" />}
          className={activeHudCard === 'due_today' ? 'ring-2 ring-amber-500 border-amber-500 bg-amber-50/30' : 'cursor-pointer hover:bg-amber-50/20'}
          onClick={() => handleStatCardClick('followup', 'due_today', 'due_today')}
        />
        <StatCard
          label="Overdue Follow-ups"
          value={stats.overdue || 0}
          valueColor="rose"
          subtext="Requires immediate contact"
          icon={<AlertTriangle className="h-4 w-4 text-red-600" />}
          className={activeHudCard === 'overdue' ? 'ring-2 ring-red-500 border-red-500 bg-red-50/40' : 'cursor-pointer hover:bg-red-50/20'}
          onClick={() => handleStatCardClick('followup', 'overdue', 'overdue')}
        />
        <StatCard
          label="Sent to Customer"
          value={stats.sent_to_customer || 0}
          valueColor="primary"
          subtext="Delivered offers"
          icon={<Send className="h-4 w-4 text-[#0F5E63]" />}
          className={activeHudCard === 'sent' ? 'ring-2 ring-[#0F5E63] border-[#0F5E63]' : 'cursor-pointer'}
          onClick={() => handleStatCardClick('status', 'SENT_TO_CUSTOMER', 'sent')}
        />
        <StatCard
          label="Without Follow-up"
          value={stats.no_followup || 0}
          subtext="No next follow-up date"
          icon={<AlertCircle className="h-4 w-4 text-[#4A5568]" />}
          className={activeHudCard === 'no_followup' ? 'ring-2 ring-slate-500 border-slate-500' : 'cursor-pointer'}
          onClick={() => handleStatCardClick('followup', 'no_followup', 'no_followup')}
        />
        <StatCard
          label="Old / No Movement"
          value={stats.old_no_movement || 0}
          subtext="Inactive for 7+ days"
          icon={<Clock className="h-4 w-4 text-amber-600" />}
          className={activeHudCard === 'old_inactivity' ? 'ring-2 ring-amber-500 border-amber-500' : 'cursor-pointer'}
          onClick={() => handleStatCardClick('followup', 'old_inactivity', 'old_inactivity')}
        />
        <StatCard
          label="Converted to Orders"
          value={stats.converted || 0}
          valueColor="emerald"
          subtext="Purchase orders secured"
          icon={<CheckCircle2 className="h-4 w-4 text-emerald-600" />}
          className={activeHudCard === 'converted' ? 'ring-2 ring-emerald-500 border-emerald-500' : 'cursor-pointer'}
          onClick={() => handleStatCardClick('status', 'CONVERTED', 'converted')}
        />
        <StatCard
          label="Lost / Closed"
          value={(stats.lost || 0) + (stats.closed || 0)}
          subtext="Recorded lost reasons"
          icon={<X className="h-4 w-4 text-slate-500" />}
          className={activeHudCard === 'lost' ? 'ring-2 ring-slate-500 border-slate-500' : 'cursor-pointer'}
          onClick={() => handleStatCardClick('status', 'LOST', 'lost')}
        />
      </StatGrid>

      {/* 3. Filter & Search Controls */}
      <Card padding="sm" className="bg-white border-[#DCD8CE] shadow-xs space-y-2.5">
        <div className="flex flex-col lg:flex-row gap-3 items-stretch lg:items-center justify-between">
          <div className="flex flex-1 flex-wrap items-center gap-2.5">
            {/* Search Box */}
            <div className="relative min-w-[220px] flex-1 max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#4A5568]" />
              <input
                type="text"
                placeholder="Search proposal #, customer, product, rep..."
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                className="w-full pl-9 pr-3 py-1.5 text-xs bg-[#FBFAF7] border border-[#DCD8CE] rounded-lg focus:border-[#0F5E63] focus:outline-none placeholder-[#4A5568]/70"
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#4A5568] hover:text-[#14213D]"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {/* Status Dropdown */}
            <select
              value={selectedStatus}
              onChange={(e) => {
                setSelectedStatus(e.target.value);
                setActiveHudCard(null);
                setPage(1);
              }}
              className="text-xs py-1.5 px-3 bg-[#FBFAF7] border border-[#DCD8CE] rounded-lg text-[#14213D] focus:border-[#0F5E63] focus:outline-none"
            >
              <option value="all">All Statuses</option>
              <option value="PROPOSAL_REQUESTED">Proposal Requested</option>
              <option value="UNDER_PREPARATION">Under Preparation</option>
              <option value="READY_FOR_REVIEW">Ready for Review</option>
              <option value="APPROVED">Approved</option>
              <option value="SENT_TO_CUSTOMER">Sent to Customer</option>
              <option value="FOLLOW_UP_REQUIRED">Follow-up Required</option>
              <option value="CONVERTED">Converted</option>
              <option value="CLOSED">Closed</option>
              <option value="LOST">Lost</option>
            </select>

            {/* Sector Dropdown */}
            <select
              value={selectedSector}
              onChange={(e) => {
                setSelectedSector(e.target.value);
                setPage(1);
              }}
              className="text-xs py-1.5 px-3 bg-[#FBFAF7] border border-[#DCD8CE] rounded-lg text-[#14213D] focus:border-[#0F5E63] focus:outline-none"
            >
              <option value="all">All Sectors</option>
              {SECTORS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>

            {/* Responsible Person Dropdown */}
            <select
              value={selectedResponsibleId}
              onChange={(e) => {
                setSelectedResponsibleId(e.target.value);
                setPage(1);
              }}
              className="text-xs py-1.5 px-3 bg-[#FBFAF7] border border-[#DCD8CE] rounded-lg text-[#14213D] focus:border-[#0F5E63] focus:outline-none max-w-[160px] truncate"
              title="Filter by Responsible Person"
            >
              <option value="">All Responsible</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.full_name} ({u.role})
                </option>
              ))}
            </select>

            {/* Follow-up Owner Dropdown */}
            <select
              value={selectedFollowupOwnerId}
              onChange={(e) => {
                setSelectedFollowupOwnerId(e.target.value);
                setPage(1);
              }}
              className="text-xs py-1.5 px-3 bg-[#FBFAF7] border border-[#DCD8CE] rounded-lg text-[#14213D] focus:border-[#0F5E63] focus:outline-none max-w-[160px] truncate"
              title="Filter by Follow-up Owner"
            >
              <option value="">All Follow-up Owners</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.full_name} ({u.role})
                </option>
              ))}
            </select>

            {/* Date Filters Toggle */}
            <Button
              variant={fromDate || toDate ? 'secondary' : 'outline'}
              size="xs"
              onClick={() => setIsDateFilterOpen((prev) => !prev)}
              className="text-xs text-[#4A5568] hover:text-[#14213D]"
            >
              <CalendarDays className="h-3.5 w-3.5 mr-1" />
              <span>Dates</span>
              {(fromDate || toDate) && (
                <span className="ml-1 px-1.5 py-0.2 bg-[#0F5E63] text-white rounded-full text-[10px]">
                  Active
                </span>
              )}
            </Button>

            {/* Sorting controls */}
            <div className="flex items-center gap-1 bg-[#FBFAF7] border border-[#DCD8CE] rounded-lg p-0.5">
              <select
                value={sortBy}
                onChange={(e) => {
                  setSortBy(e.target.value);
                  setPage(1);
                }}
                className="text-xs py-1 px-2 bg-transparent text-[#14213D] focus:outline-none"
                title="Sort Proposals By"
              >
                <option value="updated_at">Recently Updated</option>
                <option value="request_date">Request Date</option>
                <option value="required_date">Required Date</option>
                <option value="sent_date">Sent Date</option>
                <option value="next_followup">Next Follow-up</option>
                <option value="proposal_number">Proposal No.</option>
              </select>
              <button
                onClick={() => setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'))}
                className="p-1 text-[#4A5568] hover:text-[#0F5E63] rounded transition-colors"
                title={`Sort Direction: ${sortOrder === 'asc' ? 'Ascending' : 'Descending'}`}
              >
                <ArrowUpDown className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* Follow-up Condition Quick Buttons */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] font-semibold text-[#4A5568] mr-1">Alerts:</span>
            {[
              { key: 'all', label: 'All' },
              { key: 'due_today', label: 'Due Today' },
              { key: 'overdue', label: 'Overdue' },
              { key: 'upcoming', label: 'Upcoming' },
              { key: 'no_followup', label: 'No Follow-up' },
              { key: 'old_inactivity', label: 'Inactive 7d+' },
            ].map((f) => (
              <button
                key={f.key}
                onClick={() => {
                  setSelectedFollowupCondition(f.key);
                  setActiveHudCard(null);
                  setPage(1);
                }}
                className={`text-[11px] font-semibold px-2.5 py-1 rounded-md transition-colors ${
                  selectedFollowupCondition === f.key
                    ? 'bg-[#0F5E63] text-white shadow-xs'
                    : 'bg-[#FBFAF7] border border-[#DCD8CE] text-[#4A5568] hover:text-[#14213D] hover:bg-[#E3EFEE]'
                }`}
              >
                {f.label}
              </button>
            ))}

            {(search ||
              selectedStatus !== 'all' ||
              selectedSector !== 'all' ||
              selectedFollowupCondition !== 'all' ||
              selectedResponsibleId ||
              selectedFollowupOwnerId ||
              fromDate ||
              toDate) && (
              <Button
                variant="ghost"
                size="xs"
                onClick={handleClearFilters}
                className="text-xs text-[#4A5568] hover:text-red-700 ml-1"
              >
                Clear
              </Button>
            )}
          </div>
        </div>

        {/* Collapsible Date Range Filter Bar */}
        {isDateFilterOpen && (
          <div className="pt-2 border-t border-[#F0F5FC] flex flex-wrap items-center gap-3 text-xs">
            <span className="font-semibold text-[#4A5568]">Filter by Date:</span>
            <select
              value={dateField}
              onChange={(e) => {
                setDateField(e.target.value);
                setPage(1);
              }}
              className="py-1 px-2.5 bg-[#FBFAF7] border border-[#DCD8CE] rounded-lg text-[#14213D] focus:border-[#0F5E63] focus:outline-none"
            >
              <option value="request_date">Request Date</option>
              <option value="required_date">Required Completion Date</option>
              <option value="sent_date">Proposal Sent Date</option>
              <option value="next_followup">Next Follow-up Date</option>
            </select>
            <div className="flex items-center gap-1.5">
              <span className="text-[#4A5568]">From:</span>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => {
                  setFromDate(e.target.value);
                  setPage(1);
                }}
                className="py-1 px-2.5 bg-[#FBFAF7] border border-[#DCD8CE] rounded-lg text-[#14213D] focus:border-[#0F5E63] focus:outline-none text-xs"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[#4A5568]">To:</span>
              <input
                type="date"
                value={toDate}
                onChange={(e) => {
                  setToDate(e.target.value);
                  setPage(1);
                }}
                className="py-1 px-2.5 bg-[#FBFAF7] border border-[#DCD8CE] rounded-lg text-[#14213D] focus:border-[#0F5E63] focus:outline-none text-xs"
              />
            </div>
            {(fromDate || toDate) && (
              <Button
                variant="ghost"
                size="xs"
                onClick={() => {
                  setFromDate('');
                  setToDate('');
                  setPage(1);
                }}
                className="text-xs text-[#4A5568] hover:text-red-700"
              >
                Reset Dates
              </Button>
            )}
          </div>
        )}
      </Card>

      {/* 4. Commercial Price Quotes Table */}
      <div className="flex items-center justify-between pt-1 pb-0.5">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-bold text-[#14213D] font-serif">Commercial Price Quotes</h2>
          <span className="text-xs px-2.5 py-0.5 rounded-full bg-[#E3EFEE] text-[#0F5E63] font-mono font-bold">
            {total} {total === 1 ? 'quote' : 'quotes'}
          </span>
        </div>
      </div>
      <Card padding="none" className="bg-white border-[#DCD8CE] overflow-x-auto shadow-xs">
        <Table>
          <TableHeader>
            <TableRow className="bg-[#FBFAF7] border-b border-[#DCD8CE]">
              <TableHead
                className="font-bold text-[#14213D] text-xs py-3 cursor-pointer hover:text-[#0F5E63] whitespace-nowrap"
                onClick={() => handleSort('proposal_number')}
              >
                <span>Proposal No.</span>
                {sortBy === 'proposal_number' && (
                  sortOrder === 'asc' ? <ChevronUp className="h-3 w-3 inline ml-1 text-[#0F5E63]" /> : <ChevronDown className="h-3 w-3 inline ml-1 text-[#0F5E63]" />
                )}
              </TableHead>
              <TableHead className="font-bold text-[#14213D] text-xs py-3 whitespace-nowrap">Customer</TableHead>
              <TableHead className="font-bold text-[#14213D] text-xs py-3 whitespace-nowrap">Sector</TableHead>
              <TableHead className="font-bold text-[#14213D] text-xs py-3 whitespace-nowrap">Product</TableHead>
              <TableHead className="font-bold text-[#14213D] text-xs py-3 whitespace-nowrap">Requested By</TableHead>
              <TableHead className="font-bold text-[#14213D] text-xs py-3 whitespace-nowrap">Responsible</TableHead>
              <TableHead
                className="font-bold text-[#14213D] text-xs py-3 cursor-pointer hover:text-[#0F5E63] whitespace-nowrap"
                onClick={() => handleSort('request_date')}
              >
                <span>Req. Date</span>
                {sortBy === 'request_date' && (
                  sortOrder === 'asc' ? <ChevronUp className="h-3 w-3 inline ml-1 text-[#0F5E63]" /> : <ChevronDown className="h-3 w-3 inline ml-1 text-[#0F5E63]" />
                )}
              </TableHead>
              <TableHead
                className="font-bold text-[#14213D] text-xs py-3 cursor-pointer hover:text-[#0F5E63] whitespace-nowrap"
                onClick={() => handleSort('required_date')}
              >
                <span>Due Date</span>
                {sortBy === 'required_date' && (
                  sortOrder === 'asc' ? <ChevronUp className="h-3 w-3 inline ml-1 text-[#0F5E63]" /> : <ChevronDown className="h-3 w-3 inline ml-1 text-[#0F5E63]" />
                )}
              </TableHead>
              <TableHead
                className="font-bold text-[#14213D] text-xs py-3 cursor-pointer hover:text-[#0F5E63] whitespace-nowrap"
                onClick={() => handleSort('sent_date')}
              >
                <span>Sent Date</span>
                {sortBy === 'sent_date' && (
                  sortOrder === 'asc' ? <ChevronUp className="h-3 w-3 inline ml-1 text-[#0F5E63]" /> : <ChevronDown className="h-3 w-3 inline ml-1 text-[#0F5E63]" />
                )}
              </TableHead>
              <TableHead className="font-bold text-[#14213D] text-xs py-3 whitespace-nowrap">Ver.</TableHead>
              <TableHead
                className="font-bold text-[#14213D] text-xs py-3 cursor-pointer hover:text-[#0F5E63] whitespace-nowrap"
                onClick={() => handleSort('status')}
              >
                <span>Status</span>
                {sortBy === 'status' && (
                  sortOrder === 'asc' ? <ChevronUp className="h-3 w-3 inline ml-1 text-[#0F5E63]" /> : <ChevronDown className="h-3 w-3 inline ml-1 text-[#0F5E63]" />
                )}
              </TableHead>
              <TableHead className="font-bold text-[#14213D] text-xs py-3 whitespace-nowrap">Follow-up Owner</TableHead>
              <TableHead
                className="font-bold text-[#14213D] text-xs py-3 cursor-pointer hover:text-[#0F5E63] whitespace-nowrap"
                onClick={() => handleSort('next_followup')}
              >
                <span>Next Follow-up</span>
                {sortBy === 'next_followup' && (
                  sortOrder === 'asc' ? <ChevronUp className="h-3 w-3 inline ml-1 text-[#0F5E63]" /> : <ChevronDown className="h-3 w-3 inline ml-1 text-[#0F5E63]" />
                )}
              </TableHead>
              <TableHead className="font-bold text-[#14213D] text-xs py-3 whitespace-nowrap">Outcome</TableHead>
              <TableHead className="font-bold text-[#14213D] text-xs py-3 text-right whitespace-nowrap">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={15} className="py-12 text-center text-xs text-[#4A5568]">
                  <RefreshCw className="h-5 w-5 animate-spin mx-auto mb-2 text-[#0F5E63]" />
                  Loading proposal register...
                </TableCell>
              </TableRow>
            ) : proposals.length === 0 ? (
              <TableRow>
                <TableCell colSpan={15} className="py-12">
                  <EmptyState
                    icon={FileSpreadsheet}
                    title="No proposals found"
                    description={
                      search || selectedStatus !== 'all' || selectedFollowupCondition !== 'all' || selectedResponsibleId || selectedFollowupOwnerId || fromDate || toDate
                        ? 'Try clearing active filters to see all proposals.'
                        : 'Create your first proposal request to begin tracking.'
                    }
                    action={
                      <Button variant="primary" size="sm" onClick={() => setIsCreateOpen(true)}>
                        <Plus className="h-4 w-4 mr-1.5" />
                        <span>Create Proposal Request</span>
                      </Button>
                    }
                  />
                </TableCell>
              </TableRow>
            ) : (
              proposals.map((p) => {
                const todayStr = new Date().toISOString().split('T')[0];
                const nextFollowupStr = p.next_followup ? String(p.next_followup).split('T')[0] : null;
                const isOverdue =
                  nextFollowupStr &&
                  nextFollowupStr < todayStr &&
                  !['CONVERTED', 'CLOSED', 'LOST', 'converted', 'closed', 'lost'].includes(p.status);
                const isDueToday =
                  nextFollowupStr === todayStr &&
                  !['CONVERTED', 'CLOSED', 'LOST', 'converted', 'closed', 'lost'].includes(p.status);

                return (
                  <TableRow
                    key={p.id}
                    className="hover:bg-[#F8FAFC] border-b border-[#F0F5FC] transition-colors cursor-pointer group"
                    onClick={() => openProposalDetails(p)}
                  >
                    {/* Proposal Number */}
                    <TableCell className="font-mono text-xs font-bold text-[#0F5E63] whitespace-nowrap">
                      <span>{p.proposal_number}</span>
                      {p.reference && (
                        <div className="text-[10px] text-[#4A5568] font-normal truncate max-w-[120px]" title={p.reference}>
                          ref: {p.reference}
                        </div>
                      )}
                    </TableCell>

                    {/* Customer */}
                    <TableCell className="text-xs font-semibold text-[#14213D]">
                      <div className="line-clamp-1 max-w-[140px]" title={p.organisation_name}>{p.organisation_name}</div>
                      {p.organisation_city && (
                        <div className="text-[10px] text-[#4A5568] font-normal flex items-center gap-1">
                          <Building className="h-2.5 w-2.5" />
                          <span>{p.organisation_city}</span>
                        </div>
                      )}
                    </TableCell>

                    {/* Sector */}
                    <TableCell className="text-xs text-[#4A5568] whitespace-nowrap">
                      <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-[#F0F5FC] text-[#4A5568]">
                        {p.sector || 'General'}
                      </span>
                    </TableCell>

                    {/* Product */}
                    <TableCell className="text-xs text-[#14213D]">
                      <div className="line-clamp-1 max-w-[130px] font-medium" title={p.product_name}>{p.product_name}</div>
                    </TableCell>

                    {/* Requested By */}
                    <TableCell className="text-xs text-[#4A5568] whitespace-nowrap">
                      <div className="truncate max-w-[100px]" title={p.requested_by_name}>{p.requested_by_name || '-'}</div>
                    </TableCell>

                    {/* Responsible Rep */}
                    <TableCell className="text-xs text-[#14213D] whitespace-nowrap">
                      <div className="font-medium truncate max-w-[110px]" title={p.responsible_name}>{p.responsible_name || 'Unassigned'}</div>
                    </TableCell>

                    {/* Request Date */}
                    <TableCell className="text-xs text-[#4A5568] whitespace-nowrap">
                      {p.request_date ? new Date(p.request_date).toLocaleDateString('en-GB') : '-'}
                    </TableCell>

                    {/* Required Date */}
                    <TableCell className="text-xs text-[#4A5568] whitespace-nowrap">
                      {p.required_date ? new Date(p.required_date).toLocaleDateString('en-GB') : '-'}
                    </TableCell>

                    {/* Sent Date */}
                    <TableCell className="text-xs text-[#4A5568] whitespace-nowrap">
                      {p.sent_date ? new Date(p.sent_date).toLocaleDateString('en-GB') : '-'}
                    </TableCell>

                    {/* Version */}
                    <TableCell className="text-xs text-[#4A5568] whitespace-nowrap">
                      <span className="text-[10px] font-mono bg-[#E3EFEE] text-[#0F5E63] px-1.5 py-0.5 rounded">
                        {p.version || 'v1.0'}
                      </span>
                    </TableCell>

                    {/* Workflow Status */}
                    <TableCell className="text-xs whitespace-nowrap">
                      {renderStatusBadge(p.status)}
                    </TableCell>

                    {/* Follow-up Owner */}
                    <TableCell className="text-xs text-[#4A5568] whitespace-nowrap">
                      <div className="truncate max-w-[110px]" title={p.followup_owner_name}>{p.followup_owner_name || '-'}</div>
                    </TableCell>

                    {/* Next Follow-up State */}
                    <TableCell className="text-xs whitespace-nowrap">
                      {isOverdue ? (
                        <div className="flex items-center gap-1 text-red-700 font-bold bg-red-50 px-2 py-0.5 rounded text-[10px] border border-red-200 w-fit">
                          <AlertTriangle className="h-3 w-3" />
                          <span>Overdue ({nextFollowupStr})</span>
                        </div>
                      ) : isDueToday ? (
                        <div className="flex items-center gap-1 text-amber-700 font-bold bg-amber-50 px-2 py-0.5 rounded text-[10px] border border-amber-200 w-fit">
                          <Clock className="h-3 w-3" />
                          <span>Due Today</span>
                        </div>
                      ) : nextFollowupStr ? (
                        <div className="text-[11px] text-[#4A5568] font-medium">
                          {new Date(nextFollowupStr).toLocaleDateString('en-GB')}
                        </div>
                      ) : ['SENT_TO_CUSTOMER', 'sent', 'FOLLOW_UP_REQUIRED', 'followup_required'].includes(p.status) ? (
                        <span className="text-[10px] text-amber-600 italic">No date set</span>
                      ) : (
                        <span className="text-slate-400">-</span>
                      )}
                    </TableCell>

                    {/* Outcome */}
                    <TableCell className="text-xs whitespace-nowrap">
                      {['CONVERTED', 'converted'].includes(p.status) ? (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                          Converted
                        </span>
                      ) : ['LOST', 'lost'].includes(p.status) ? (
                        <span
                          className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-800"
                          title={p.lost_remarks ? `${p.lost_reason}: ${p.lost_remarks}` : p.lost_reason || ''}
                        >
                          Lost {p.lost_reason ? `(${p.lost_reason})` : ''}
                        </span>
                      ) : ['CLOSED', 'closed'].includes(p.status) ? (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700">
                          Closed
                        </span>
                      ) : (
                        <span className="text-slate-400 text-[11px]">-</span>
                      )}
                    </TableCell>

                    {/* Actions */}
                    <TableCell className="text-xs text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="xs"
                          className="text-[#0F5E63] hover:bg-[#E3EFEE] font-semibold"
                          onClick={() => openProposalDetails(p)}
                        >
                          <span>View</span>
                          <ChevronRight className="h-3.5 w-3.5 ml-0.5" />
                        </Button>
                        <button
                          onClick={() => openEditProposal(p)}
                          className="p-1 text-[#4A5568] hover:text-[#0F5E63] hover:bg-[#E3EFEE] rounded transition-colors"
                          title="Edit Proposal"
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>

        {/* Pagination Bar */}
        <div className="px-4 py-3 bg-[#FBFAF7] border-t border-[#DCD8CE] flex items-center justify-between text-xs text-[#4A5568]">
          <div>
            Showing proposals <span className="font-semibold text-[#14213D]">{proposals.length > 0 ? (page - 1) * limit + 1 : 0}</span> to{' '}
            <span className="font-semibold text-[#14213D]">{Math.min(page * limit, total)}</span> of{' '}
            <span className="font-semibold text-[#14213D]">{total}</span> total
          </div>

          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="xs"
              disabled={page <= 1 || isLoading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              <ChevronLeft className="h-3.5 w-3.5 mr-0.5" />
              <span>Previous</span>
            </Button>
            <span className="px-2 font-medium">
              Page {page} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="xs"
              disabled={page >= totalPages || isLoading}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              <span>Next</span>
              <ChevronRight className="h-3.5 w-3.5 ml-0.5" />
            </Button>
          </div>
        </div>
      </Card>

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
        <form onSubmit={handleCreateProposal} className="space-y-4">
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

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Customer (Organisation) */}
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

            {/* Product */}
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

            {/* Sector */}
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

            {/* Responsible Person */}
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

            {/* Request Date */}
            <Input
              type="date"
              label="Request Date"
              required
              value={newProposal.request_date}
              onChange={(e) => setNewProposal({ ...newProposal, request_date: e.target.value })}
            />

            {/* Required Date */}
            <Input
              type="date"
              label="Required Completion Date"
              required
              value={newProposal.required_date}
              onChange={(e) => setNewProposal({ ...newProposal, required_date: e.target.value })}
            />

            {/* Proposal Version */}
            <Input
              label="Proposal Version"
              placeholder="e.g. v1.0"
              value={newProposal.version}
              onChange={(e) => setNewProposal({ ...newProposal, version: e.target.value })}
            />

            {/* Email / Reference */}
            <Input
              label="Email / Tender Reference"
              placeholder="e.g. ATC/BSF/2026/092"
              value={newProposal.reference}
              onChange={(e) => setNewProposal({ ...newProposal, reference: e.target.value })}
            />

            {/* Follow-up Owner */}
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

            {/* Next Follow-up Date */}
            <Input
              type="date"
              label="Initial Follow-up Date (Optional)"
              value={newProposal.next_followup}
              onChange={(e) => setNewProposal({ ...newProposal, next_followup: e.target.value })}
            />
          </div>

          {/* Remarks */}
          <Textarea
            label="Internal Remarks / Tender Specifications"
            rows={3}
            placeholder="Key technical points, warranty expectations, delivery timelines requested by client..."
            value={newProposal.remarks}
            onChange={(e) => setNewProposal({ ...newProposal, remarks: e.target.value })}
          />

          <div className="flex justify-end gap-2 pt-3 border-t border-[#F0F5FC]">
            <Button
              variant="outline"
              size="sm"
              type="button"
              onClick={() => {
                setIsCreateOpen(false);
                resetCreateForm();
              }}
            >
              Cancel
            </Button>
            <Button variant="primary" size="sm" type="submit" isLoading={isSubmitting}>
              {duplicateWarning ? 'Override & Create Quote' : 'Create Proposal Request'}
            </Button>
          </div>
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
            <div className="p-4 bg-[#FBFAF7] border border-[#DCD8CE] rounded-xl flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="font-mono text-base font-black text-[#0F5E63]">
                  {selectedProposal.proposal_number}
                </span>
                <button
                  onClick={() => copyProposalNumber(selectedProposal.proposal_number)}
                  className="text-[#4A5568] hover:text-[#0F5E63] transition-colors p-1"
                  title="Copy Proposal Number"
                >
                  {copiedId === selectedProposal.proposal_number ? (
                    <Check className="h-4 w-4 text-emerald-600" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </button>
                <div className="h-4 w-px bg-[#DCD8CE] mx-1" />
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
                    onClick={() => setIsDeleteConfirmOpen(true)}
                    className="text-xs text-red-600 hover:text-red-800 hover:bg-red-50"
                    title="Soft Delete Proposal"
                  >
                    <Trash2 className="h-3 w-3 mr-1" />
                    <span>Delete</span>
                  </Button>
                )}
              </div>

              {/* Workflow advancement actions */}
              <div className="flex items-center gap-2 flex-wrap">
                {selectedProposal.status === 'PROPOSAL_REQUESTED' && (
                  <Button
                    variant="primary"
                    size="xs"
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
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="xs"
                        className="text-red-700 border-red-200 hover:bg-red-50"
                        onClick={() => initiateStatusChange('UNDER_PREPARATION')}
                      >
                        <X className="h-3.5 w-3.5 mr-1" />
                        <span>Request Changes</span>
                      </Button>
                      <Button
                        variant="success"
                        size="xs"
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
                      onClick={() => {
                        setFollowupForm({
                          followup_date: new Date().toISOString().split('T')[0],
                          owner_id: selectedProposal.followup_owner_id || user?.id || '',
                          remarks: '',
                          outcome: '',
                          next_followup_date: selectedProposal.next_followup
                            ? String(selectedProposal.next_followup).split('T')[0]
                            : '',
                        });
                        setIsFollowupDialogOpen(true);
                      }}
                    >
                      <Plus className="h-3.5 w-3.5 mr-1" />
                      <span>Add Follow-up</span>
                    </Button>
                    <Button
                      variant="success"
                      size="xs"
                      onClick={() => initiateStatusChange('CONVERTED')}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                      <span>Mark Converted</span>
                    </Button>
                    <Button
                      variant="danger"
                      size="xs"
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
            <div className="p-4 bg-white border border-[#DCD8CE] rounded-xl shadow-2xs">
              <h4 className="text-xs font-bold uppercase tracking-wider text-[#4A5568] mb-3">
                Lifecycle Progression
              </h4>
              <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2">
                {STAGES.map((st, i) => {
                  const currentIdx = getStageIndex(selectedProposal.status);
                  const isDone = i < currentIdx;
                  const isCurrent = i === currentIdx;

                  return (
                    <div
                      key={st.key}
                      className={`p-2.5 rounded-lg border text-center relative flex flex-col justify-between transition-all ${
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
              </div>
            </div>

            {/* Tabs for Overview, Follow-ups, and History */}
            <Tabs
              tabs={[
                { id: 'overview', label: 'Overview & Details', icon: <Briefcase className="h-4 w-4" /> },
                { id: 'followups', label: `Follow-ups (${followups.length})`, icon: <MessageSquare className="h-4 w-4" /> },
                { id: 'history', label: `Activity History (${activities.length})`, icon: <History className="h-4 w-4" /> },
              ]}
              activeTab={detailsTab}
              onChange={(id) => setDetailsTab(id as any)}
              variant="segmented"
            />

            {/* Tab 1: Overview */}
            {detailsTab === 'overview' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Customer & Product Card */}
                <Card padding="md" className="border-[#DCD8CE] space-y-3">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-[#4A5568] flex items-center gap-1.5 border-b border-[#F0F5FC] pb-2">
                    <Building className="h-3.5 w-3.5 text-[#0F5E63]" />
                    <span>Customer & Product Specs</span>
                  </h4>
                  <div className="space-y-2 text-xs">
                    <div>
                      <span className="text-[#4A5568] block text-[10px] uppercase font-semibold">Customer Organisation</span>
                      <span className="font-bold text-[#14213D] text-sm">{selectedProposal.organisation_name}</span>
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
                <Card padding="md" className="border-[#DCD8CE] space-y-3">
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
                  <Card padding="md" className="border-[#DCD8CE] md:col-span-2 bg-[#FBFAF7]">
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
                  <Card padding="md" className="border-[#DCD8CE] md:col-span-2">
                    <span className="text-[#4A5568] block text-[10px] uppercase font-semibold mb-1">Remarks & Details</span>
                    <p className="text-xs text-[#14213D] whitespace-pre-wrap leading-relaxed">
                      {selectedProposal.remarks}
                    </p>
                  </Card>
                )}
              </div>
            )}

            {/* Tab 2: Follow-up Tracking */}
            {detailsTab === 'followups' && (
              <div className="space-y-4">
                {/* Active Follow-up Banner */}
                <div className="p-3 bg-[#F8FAFC] border border-[#DCD8CE] rounded-xl flex items-center justify-between">
                  <div className="text-xs">
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
                    onClick={() => {
                      setFollowupForm({
                        followup_date: new Date().toISOString().split('T')[0],
                        owner_id: selectedProposal.followup_owner_id || user?.id || '',
                        remarks: '',
                        outcome: '',
                        next_followup_date: '',
                      });
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
                        <div className="flex items-center justify-between font-semibold text-[#14213D]">
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
                      <div className="flex-1">
                        <div className="flex items-center justify-between">
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
          {targetStatus === 'SENT_TO_CUSTOMER' && (
            <Input
              type="date"
              label="Proposal Sent Date"
              required
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

          <div className="flex justify-end gap-2 pt-3 border-t border-[#F0F5FC]">
            <Button variant="outline" size="sm" type="button" onClick={() => setIsStatusDialogOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" type="submit" isLoading={isSubmitting}>
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
          <div className="grid grid-cols-2 gap-3">
            <Input
              type="date"
              label="Follow-up Date"
              required
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

          <Textarea
            label="Meeting / Call Discussion Remarks"
            required
            rows={3}
            placeholder="Discussed pricing terms, client requested revised delivery timeline..."
            value={followupForm.remarks}
            onChange={(e) => setFollowupForm({ ...followupForm, remarks: e.target.value })}
          />

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

          <div className="flex justify-end gap-2 pt-3 border-t border-[#F0F5FC]">
            <Button variant="outline" size="sm" type="button" onClick={() => setIsFollowupDialogOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" type="submit" isLoading={isSubmitting}>
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
            <div className="grid grid-cols-2 gap-3">
              <Input
                type="date"
                label="Required Completion Date"
                required
                value={editForm.required_date}
                onChange={(e) => setEditForm({ ...editForm, required_date: e.target.value })}
              />
              <Input
                label="Proposal Version"
                placeholder="e.g. v1.1"
                value={editForm.version}
                onChange={(e) => setEditForm({ ...editForm, version: e.target.value })}
              />
            </div>

            <Input
              label="Email / Tender Reference"
              placeholder="e.g. ATC/BSF/2026/092"
              value={editForm.reference}
              onChange={(e) => setEditForm({ ...editForm, reference: e.target.value })}
            />

            <div className="grid grid-cols-2 gap-3">
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

            <div className="flex justify-end gap-2 pt-3 border-t border-[#F0F5FC]">
              <Button variant="outline" size="sm" type="button" onClick={() => setIsEditOpen(false)}>
                Cancel
              </Button>
              <Button variant="primary" size="sm" type="submit" isLoading={isSubmitting}>
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
            <p className="text-xs text-[#4A5568] leading-relaxed">
              This will soft-delete the proposal record from active views. Historical audit events and logged customer follow-ups will be safely preserved in the database.
            </p>
            <div className="flex justify-end gap-2 pt-3 border-t border-[#F0F5FC]">
              <Button variant="outline" size="sm" type="button" onClick={() => setIsDeleteConfirmOpen(false)}>
                Cancel
              </Button>
              <Button variant="danger" size="sm" type="button" onClick={handleDeleteProposal} isLoading={isSubmitting}>
                Delete Proposal
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </PageContainer>
  );
}
