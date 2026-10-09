'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  FileText,
  Search,
  Plus,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Building,
  MapPin,
  Calendar,
  IndianRupee,
  Filter,
  Eye,
  ShieldCheck,
  Award,
  AlertCircle,
  ArrowRight,
  History,
  User,
  Users,
  ExternalLink,
  ChevronRight,
  Sparkles,
  TrendingUp,
  BarChart3,
  Layers,
  RefreshCw,
  Send,
  Flag,
  FileCheck,
  Check,
  X,
  HelpCircle,
  Briefcase,
  Compass,
  FileBarChart,
  AlertOctagon,
  Upload,
  Settings,
  UserCheck,
  ShieldAlert,
  SlidersHorizontal,
  Flame,
  Zap,
} from 'lucide-react';
import { TenderDossierModal } from './components/TenderDossierModal';
import { ApprovalsInboxView } from './components/ApprovalsInboxView';
import { TenderCalendarView } from './components/TenderCalendarView';
import { FinanceEmdView } from './components/FinanceEmdView';
import { TenderSettingsModal } from './components/TenderSettingsModal';
import { BulkImportWizardModal } from './components/BulkImportWizardModal';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';
import { getSocket } from '@/lib/socket';
import {
  PageContainer,
  PageHeader,
  SectionHeader,
  Card,
  Badge,
  Button,
  Input,
  Select,
  Textarea,
  Modal,
  StatCard,
  StatGrid,
  EmptyState,
  InfoCallout,
  Tabs, Spinner, ToolbarBox, ToolbarSlot, FilterMenu } from '@/components/ui';
import { formatINR } from '@arihant/shared';

// Lifecycle states and display labels
const STAGES = [
  { key: 'identified', label: 'Identified', color: 'default' as const },
  { key: 'awaiting_approval', label: 'Awaiting Approval', color: 'warning' as const },
  { key: 'rejected_internally', label: 'Rejected Internally', color: 'danger' as const },
  { key: 'under_preparation', label: 'Under Preparation', color: 'info' as const },
  { key: 'pq_submitted', label: 'PQ Submitted', color: 'info' as const },
  { key: 'pq_qualified', label: 'PQ Qualified', color: 'success' as const },
  { key: 'submitted', label: 'Tender Submitted', color: 'info' as const },
  { key: 'technical_eval', label: 'Technical Evaluation', color: 'cyber' as const },
  { key: 'commercial_eval', label: 'Commercial Evaluation', color: 'cyber' as const },
  { key: 'won', label: 'Won', color: 'success' as const },
  { key: 'lost', label: 'Lost', color: 'danger' as const },
  { key: 'cancelled', label: 'Cancelled', color: 'default' as const },
  { key: 'on_hold', label: 'On Hold', color: 'warning' as const },
] as const;

export default function TendersPage() {
  const { user, hasRole } = useAuth();
  const searchParams = useSearchParams();
  const highlightId = searchParams.get('highlight');

  // Top-Level Navigation Tabs
  const [activeTab, setActiveTab] = useState<
    | 'pipeline'
    | 'approvals_inbox'
    | 'calendar'
    | 'finance_emd'
    | 'deadlines'
    | 'portal_issues'
    | 'analytics'
  >('pipeline');

  // Master lists
  const [tenders, setTenders] = useState<any[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(25);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Master Lookups
  const [categories, setCategories] = useState<any[]>([]);
  const [organisations, setOrganisations] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);

  // Executive Dashboard Stats (14 Metrics + Win Rate %)
  const [dashboardStats, setDashboardStats] = useState<any>({
    total: 0,
    pq_count: 0,
    general_mha_count: 0,
    other_count: 0,
    under_preparation: 0,
    submitted: 0,
    won: 0,
    lost: 0,
    pending: 0,
    pending_approvals: 0,
    upcoming_deadlines: 0,
    urgent_deadlines: 0,
    overdue: 0,
    result_followups: 0,
    open_portal_issues: 0,
    win_rate: 0,
    win_rate_percentage: 0,
  });

  // Executive Reports State (§21, §26, §27)
  const [organisationReport, setOrganisationReport] = useState<any[]>([]);
  const [zoneReport, setZoneReport] = useState<any[]>([]);
  const [regionReport, setRegionReport] = useState<any[]>([]);
  const [salespersonReport, setSalespersonReport] = useState<any[]>([]);
  const [pipelineReport, setPipelineReport] = useState<any>({ total: 0, stages: [], categories: [] });
  const [winLossReport, setWinLossReport] = useState<any>({ won: 0, lost: 0, win_rate: 0, loss_reasons: {}, competitors: {} });
  const [globalPortalIssues, setGlobalPortalIssues] = useState<any[]>([]);
  const [isLoadingReports, setIsLoadingReports] = useState(false);

  // Geographic Masters (§21 Zone & Region Structure)
  const [zonesMaster, setZonesMaster] = useState<any[]>([]);
  const [regionsMaster, setRegionsMaster] = useState<any[]>([]);

  // Filter Bar state
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [zoneFilter, setZoneFilter] = useState('');
  const [deadlineFilter, setDeadlineFilter] = useState('');
  const [assignedFilter, setAssignedFilter] = useState<string>('');
  const [sortBy, setSortBy] = useState('created_at');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [activeHudFilter, setActiveHudFilter] = useState<string | null>(null);

  // Detail Modal & Sub-panels
  const [selectedTender, setSelectedTender] = useState<any | null>(null);

  // Enterprise Blueprint Modals
  const [isDossierOpen, setIsDossierOpen] = useState(false);
  const [dossierTenderId, setDossierTenderId] = useState<string | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);

  // Action Modals
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isApproveOpen, setIsApproveOpen] = useState(false);
  const [isOutcomeOpen, setIsOutcomeOpen] = useState(false);
  const [isNewIssueOpen, setIsNewIssueOpen] = useState(false);
  const [isTransitionOpen, setIsTransitionOpen] = useState(false);

  // 15+ North Tender Sheet Create Form State (§19-§21)
  const [newTender, setNewTender] = useState({
    tender_no: '',
    portal: 'GeM',
    organisation_id: '',
    department: '',
    product_id: '',
    city: '',
    state: '',
    zone_id: '',
    region_id: '',
    zone: 'North',
    region: 'Delhi NCR',
    category: 'general_mha',
    current_stage: 'identified',
    requirement_text: '',
    quantity: 1,
    emd_fee: 0,
    estimated_value_lakh: '',
    publication_date: new Date().toISOString().split('T')[0],
    submission_deadline: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    assigned_person_id: '',
    tender_owner_id: '',
    remarks: '',
  });

  // Approval Form State
  const [approvalDecision, setApprovalDecision] = useState<'approved' | 'rejected'>('approved');
  const [approvalRemarks, setApprovalRemarks] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');

  // Structured Win / Loss Outcome Form State (§26)
  const [outcomeResult, setOutcomeResult] = useState<'won' | 'lost'>('won');
  const [outcomeValueLakh, setOutcomeValueLakh] = useState('');
  const [outcomeProductId, setOutcomeProductId] = useState('');
  const [outcomeRegionId, setOutcomeRegionId] = useState('');
  const [outcomeResponsiblePersonId, setOutcomeResponsiblePersonId] = useState('');
  const [outcomeCategory, setOutcomeCategory] = useState('general_mha');
  const [outcomeLossReason, setOutcomeLossReason] = useState('price');
  const [outcomeCompetitor, setOutcomeCompetitor] = useState('');
  const [outcomeTechnicalIssue, setOutcomeTechnicalIssue] = useState('');
  const [outcomePricingIssue, setOutcomePricingIssue] = useState('');
  const [outcomeEligibilityIssue, setOutcomeEligibilityIssue] = useState('');
  const [outcomeDocumentationIssue, setOutcomeDocumentationIssue] = useState('');
  const [outcomeOtherReason, setOutcomeOtherReason] = useState('');
  const [outcomeRemarks, setOutcomeRemarks] = useState('');
  const [outcomeResultDate, setOutcomeResultDate] = useState(new Date().toISOString().split('T')[0]);

  // Transition Form State
  const [targetTransitionStatus, setTargetTransitionStatus] = useState('');
  const [transitionRemarks, setTransitionRemarks] = useState('');
  const [transitionSubmissionDate, setTransitionSubmissionDate] = useState(new Date().toISOString().split('T')[0]);

  // Portal Issue Form State (§25)
  const [issueTenderId, setIssueTenderId] = useState('');
  const [issueReportedDate, setIssueReportedDate] = useState(new Date().toISOString().split('T')[0]);
  const [newIssueText, setNewIssueText] = useState('');
  const [issueResponsiblePerson, setIssueResponsiblePerson] = useState('');
  const [issueEscalatedTo, setIssueEscalatedTo] = useState('');
  const [issueResolutionStatus, setIssueResolutionStatus] = useState('OPEN');

  const [actionError, setActionError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 1. Fetch Lookups (§21 Zone & Region Structure)
  const fetchMasters = async () => {
    try {
      const [catsRes, orgsRes, prodsRes, usersRes, zonesRes, regionsRes] = await Promise.all([
        api.get('/tenders/categories').catch(() => []),
        api.get('/organisations', { limit: 100 }).catch(() => ({ data: [] })),
        api.get('/products').catch(() => []),
        api.get('/users', { limit: 100 }).catch(() => ({ data: [] })),
        api.get('/masters/zones').catch(() => []),
        api.get('/masters/regions').catch(() => []),
      ]);

      setCategories(Array.isArray(catsRes) ? catsRes : []);
      setOrganisations(orgsRes.data || []);
      setProducts(Array.isArray(prodsRes) ? prodsRes : prodsRes.data || []);
      setUsers(usersRes.data || []);
      setZonesMaster(Array.isArray(zonesRes) ? zonesRes : []);
      setRegionsMaster(Array.isArray(regionsRes) ? regionsRes : []);
    } catch (err) {
      console.error('Failed to load masters:', err);
    }
  };

  // 2. Fetch Executive Dashboard Metrics
  const fetchDashboardStats = async () => {
    try {
      const res = await api.get('/tenders/dashboard');
      if (res) {
        setDashboardStats(res);
      }
    } catch (err) {
      console.error('Failed to load dashboard stats:', err);
    }
  };

  // 3. Fetch Executive Reports (§21 Organisation, Zone, Region, Salesperson)
  const fetchReports = async () => {
    setIsLoadingReports(true);
    try {
      if (user?.role === 'sales') {
        const portalIssuesRes = await api.get('/tenders/portal-issues').catch(() => []);
        setGlobalPortalIssues(Array.isArray(portalIssuesRes) ? portalIssuesRes : []);
        return;
      }

      const [zonesRes, regionsRes, salesRes, orgsReportRes, pipelineRes, winLossRes, portalIssuesRes] = await Promise.all([
        api.get('/tenders/reports/by-zone').catch(() => []),
        api.get('/tenders/reports/by-region').catch(() => []),
        api.get('/tenders/reports/by-salesperson').catch(() => []),
        api.get('/tenders/reports/by-organisation').catch(() => []),
        api.get('/tenders/reports/pipeline').catch(() => ({ total: 0, stages: [], categories: [] })),
        api.get('/tenders/reports/win-loss').catch(() => ({ won: 0, lost: 0, win_rate: 0, loss_reasons: {}, competitors: {} })),
        api.get('/tenders/portal-issues').catch(() => []),
      ]);

      setZoneReport(Array.isArray(zonesRes) ? zonesRes : []);
      setRegionReport(Array.isArray(regionsRes) ? regionsRes : []);
      setSalespersonReport(Array.isArray(salesRes) ? salesRes : []);
      setOrganisationReport(Array.isArray(orgsReportRes) ? orgsReportRes : []);
      setPipelineReport(pipelineRes || { total: 0, stages: [], categories: [] });
      setWinLossReport(winLossRes || { won: 0, lost: 0, win_rate: 0, loss_reasons: {}, competitors: {} });
      setGlobalPortalIssues(Array.isArray(portalIssuesRes) ? portalIssuesRes : []);
    } catch (err) {
      console.error('Failed to load reports:', err);
    } finally {
      setIsLoadingReports(false);
    }
  };

  // Tab Safety Guard for Sales Role (Prevent deep-linking or tab selection into management-only views)
  useEffect(() => {
    if (user?.role === 'sales' && ['approvals_inbox', 'finance_emd', 'analytics'].includes(activeTab)) {
      setActiveTab('pipeline');
    }
  }, [user?.role, activeTab]);

  // Sync searchParams with assignedFilter & enforce role scoping
  useEffect(() => {
    if (user?.role === 'sales' && user?.id) {
      setAssignedFilter(user.id);
      return;
    }
    const scopeParam = searchParams.get('scope');
    const assignedParam = searchParams.get('assigned_to');
    if (scopeParam === 'my_tenders' && user?.id) {
      setAssignedFilter(user.id);
    } else if (assignedParam) {
      setAssignedFilter(assignedParam);
    }
  }, [searchParams, user]);

  // 4. Fetch Tenders List (Server-side Search & Pagination)
  const fetchTenders = useCallback(async (quiet = false) => {
    try {
      if (!quiet) setIsLoading(true);
      else setIsRefreshing(true);

      const params: any = {
        page,
        limit,
        sortBy,
        sortOrder,
      };

      if (search.trim()) params.search = search.trim();
      if (statusFilter) params.status = statusFilter;
      if (categoryFilter) params.category = categoryFilter;
      if (zoneFilter) params.zone = zoneFilter;
      if (deadlineFilter) params.deadline = deadlineFilter;
      if (user?.role === 'sales' && user?.id) {
        params.assigned_to = user.id;
      } else if (assignedFilter) {
        params.assigned_to = assignedFilter;
      }

      const res = await api.get('/tenders', params);
      setTenders(res.data || []);
      setTotalCount(res.total || 0);

      // Auto-open highlight if specified in URL query
      if (highlightId && res.data) {
        const found = res.data.find((t: any) => t.id === highlightId);
        if (found) {
          openTenderDetails(found);
        }
      }
    } catch (err) {
      console.error('Failed to fetch tenders:', err);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [page, limit, search, statusFilter, categoryFilter, zoneFilter, deadlineFilter, assignedFilter, sortBy, sortOrder, highlightId]);

  // Initial load
  useEffect(() => {
    fetchMasters();
    fetchDashboardStats();
    fetchReports();
  }, []);

  useEffect(() => {
    fetchTenders();
  }, [fetchTenders]);

  // Real-time Event-Driven Synchronization via Socket.IO
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const handleTenderRealtimeEvent = () => {
      fetchTenders(true);
      fetchDashboardStats();
      fetchReports();
    };

    socket.on('tender:created', handleTenderRealtimeEvent);
    socket.on('tender:updated', handleTenderRealtimeEvent);
    socket.on('tender:status_changed', handleTenderRealtimeEvent);
    socket.on('tender:approved', handleTenderRealtimeEvent);
    socket.on('tender:won', handleTenderRealtimeEvent);
    socket.on('tender:lost', handleTenderRealtimeEvent);
    socket.on('tender:portal_issue_created', handleTenderRealtimeEvent);
    socket.on('tender:portal_issue_resolved', handleTenderRealtimeEvent);

    return () => {
      socket.off('tender:created', handleTenderRealtimeEvent);
      socket.off('tender:updated', handleTenderRealtimeEvent);
      socket.off('tender:status_changed', handleTenderRealtimeEvent);
      socket.off('tender:approved', handleTenderRealtimeEvent);
      socket.off('tender:won', handleTenderRealtimeEvent);
      socket.off('tender:lost', handleTenderRealtimeEvent);
      socket.off('tender:portal_issue_created', handleTenderRealtimeEvent);
      socket.off('tender:portal_issue_resolved', handleTenderRealtimeEvent);
    };
  }, [fetchTenders]);

  // Open Tender Detail & Fetch History & Portal Issues
  const openTenderDetails = (tender: any) => {
    setSelectedTender(tender);
    setDossierTenderId(tender.id);
    setIsDossierOpen(true);
  };

  // Quick HUD card filter handler
  const handleHudClick = (filterType: string, val: string) => {
    setActiveTab('pipeline');
    if (activeHudFilter === filterType) {
      // Clear filter
      setActiveHudFilter(null);
      setStatusFilter('');
      setCategoryFilter('');
      setDeadlineFilter('');
    } else {
      setActiveHudFilter(filterType);
      if (filterType === 'pq') {
        setCategoryFilter('pq');
        setStatusFilter('');
        setDeadlineFilter('');
      } else if (filterType === 'general_mha') {
        setCategoryFilter('general_mha');
        setStatusFilter('');
        setDeadlineFilter('');
      } else if (filterType === 'awaiting_approval') {
        setStatusFilter('awaiting_approval');
        setCategoryFilter('');
        setDeadlineFilter('');
      } else if (filterType === 'under_preparation') {
        setStatusFilter('under_preparation');
        setCategoryFilter('');
        setDeadlineFilter('');
      } else if (filterType === 'submitted') {
        setStatusFilter('submitted');
        setCategoryFilter('');
        setDeadlineFilter('');
      } else if (filterType === 'won') {
        setStatusFilter('won');
        setCategoryFilter('');
        setDeadlineFilter('');
      } else if (filterType === 'lost') {
        setStatusFilter('lost');
        setCategoryFilter('');
        setDeadlineFilter('');
      } else if (filterType === 'urgent_deadlines') {
        setDeadlineFilter('urgent_48h');
        setStatusFilter('');
        setCategoryFilter('');
      } else if (filterType === 'upcoming_deadlines') {
        setDeadlineFilter('upcoming_7d');
        setStatusFilter('');
        setCategoryFilter('');
      } else if (filterType === 'overdue') {
        setDeadlineFilter('overdue');
        setStatusFilter('');
        setCategoryFilter('');
      } else {
        setStatusFilter('');
        setCategoryFilter('');
        setDeadlineFilter('');
      }
    }
    setPage(1);
  };

  // Cascading Region helper based on selected Zone (§21)
  const availableRegions = useMemo(() => {
    if (!newTender.zone_id && !newTender.zone) return regionsMaster;
    const selectedZone = zonesMaster.find(
      (z) => z.id === newTender.zone_id || z.name?.toLowerCase() === newTender.zone?.toLowerCase(),
    );
    if (!selectedZone) return regionsMaster;
    return regionsMaster.filter((r) => r.zone_id === selectedZone.id);
  }, [newTender.zone_id, newTender.zone, zonesMaster, regionsMaster]);

  // Handle Organisation change with auto-population of geo mapping
  const handleOrgChange = (orgId: string) => {
    const selectedOrg = organisations.find((o) => o.id === orgId);
    if (!selectedOrg) {
      setNewTender((prev) => ({ ...prev, organisation_id: orgId }));
      return;
    }

    const matchedZone = zonesMaster.find((z) => z.id === selectedOrg.zone_id);
    const matchedRegion = regionsMaster.find((r) => r.id === selectedOrg.region_id);

    setNewTender((prev) => ({
      ...prev,
      organisation_id: orgId,
      department: prev.department || selectedOrg.name,
      city: prev.city || selectedOrg.city || '',
      state: prev.state || selectedOrg.state || '',
      zone_id: selectedOrg.zone_id || prev.zone_id,
      zone: matchedZone ? matchedZone.name : prev.zone,
      region_id: selectedOrg.region_id || prev.region_id,
      region: matchedRegion ? matchedRegion.name : prev.region,
    }));
  };

  // Handle Zone change with cascading Region update
  const handleZoneChange = (zoneVal: string) => {
    const matchedZone = zonesMaster.find((z) => z.id === zoneVal || z.name === zoneVal);
    const zId = matchedZone ? matchedZone.id : zoneVal;
    const zName = matchedZone ? matchedZone.name : zoneVal;
    const validRegions = regionsMaster.filter((r) => r.zone_id === zId);
    const firstRegion = validRegions[0];

    setNewTender((prev) => ({
      ...prev,
      zone_id: zId,
      zone: zName,
      region_id: firstRegion ? firstRegion.id : '',
      region: firstRegion ? firstRegion.name : '',
    }));
  };

  // Handle Region change
  const handleRegionChange = (regVal: string) => {
    const matchedRegion = regionsMaster.find((r) => r.id === regVal || r.name === regVal);
    setNewTender((prev) => ({
      ...prev,
      region_id: matchedRegion ? matchedRegion.id : regVal,
      region: matchedRegion ? matchedRegion.name : regVal,
    }));
  };

  // 4. Handle Create Tender (All 15+ Indicative Sheet Fields)
  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionError(null);

    if (!newTender.tender_no.trim()) {
      setActionError('Tender number is mandatory.');
      return;
    }

    if (!newTender.organisation_id) {
      setActionError('Please select a mapped organisation for tender registration.');
      return;
    }

    if (newTender.publication_date && newTender.submission_deadline) {
      if (new Date(newTender.submission_deadline) < new Date(newTender.publication_date)) {
        setActionError('Submission deadline cannot be earlier than publication date.');
        return;
      }
    }

    setIsSubmitting(true);
    try {
      await api.post('/tenders', {
        tender_no: newTender.tender_no.trim(),
        tender_number: newTender.tender_no.trim(),
        portal: newTender.portal,
        organisation_id: newTender.organisation_id || undefined,
        department: newTender.department.trim(),
        product_id: newTender.product_id || undefined,
        city: newTender.city.trim(),
        state: newTender.state.trim(),
        zone_id: newTender.zone_id || undefined,
        zone: newTender.zone,
        region_id: newTender.region_id || undefined,
        region: newTender.region,
        category: newTender.category,
        tender_category: newTender.category,
        status: newTender.current_stage || 'identified',
        current_stage: newTender.current_stage || 'identified',
        requirement_text: newTender.requirement_text.trim(),
        quantity: Number(newTender.quantity) || 1,
        emd_fee: Number(newTender.emd_fee) || 0,
        estimated_value_lakh: newTender.estimated_value_lakh ? Number(newTender.estimated_value_lakh) : undefined,
        publication_date: newTender.publication_date,
        submission_deadline: newTender.submission_deadline,
        assigned_person_id: newTender.assigned_person_id || undefined,
        tender_owner_id: newTender.tender_owner_id || undefined,
        remarks: newTender.remarks.trim() || undefined,
      });

      setIsCreateOpen(false);
      setNewTender({
        tender_no: '',
        portal: 'GeM',
        organisation_id: '',
        department: '',
        product_id: '',
        city: '',
        state: '',
        zone_id: '',
        region_id: '',
        zone: 'North',
        region: 'Delhi NCR',
        category: 'general_mha',
        current_stage: 'identified',
        requirement_text: '',
        quantity: 1,
        emd_fee: 0,
        estimated_value_lakh: '',
        publication_date: new Date().toISOString().split('T')[0],
        submission_deadline: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        assigned_person_id: '',
        tender_owner_id: '',
        remarks: '',
      });

      await Promise.all([fetchTenders(), fetchDashboardStats(), fetchReports()]);
    } catch (err: any) {
      setActionError(err.message || 'Failed to register tender.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Quick Action: Submit for Internal Review (§24)
  const handleQuickRequestApproval = async (tender: any) => {
    try {
      await api.post(`/tenders/${tender.id}/request-approval`, {
        remarks: 'Submitted for internal review by sales/tender team',
      });
      await Promise.all([fetchTenders(true), fetchDashboardStats()]);
    } catch (err: any) {
      alert(err.message || 'Failed to submit tender for internal review.');
    }
  };

  // 5. Handle Approval Submit (Independent Dual-Control Signoff)
  const handleApproveSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTender) return;
    setActionError(null);

    if (approvalDecision === 'rejected' && !rejectionReason.trim()) {
      setActionError('A valid rejection reason is mandatory when declining participation.');
      return;
    }

    setIsSubmitting(true);
    try {
      await api.post(`/tenders/${selectedTender.id}/approve`, {
        decision: approvalDecision,
        remarks: approvalRemarks.trim() || undefined,
        rejection_reason: approvalDecision === 'rejected' ? rejectionReason : undefined,
      });

      setIsApproveOpen(false);
      setApprovalRemarks('');
      setRejectionReason('');
      await Promise.all([fetchTenders(true), fetchDashboardStats(), fetchReports()]);
    } catch (err: any) {
      setActionError(err.message || 'Failed to submit approval decision.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // 6. Handle Workflow Transitions
  const handleTransitionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTender || !targetTransitionStatus) return;
    setActionError(null);
    setIsSubmitting(true);

    try {
      await api.post(`/tenders/${selectedTender.id}/transitions`, {
        target_status: targetTransitionStatus,
        remarks: transitionRemarks,
        submission_date: targetTransitionStatus === 'submitted' ? transitionSubmissionDate : undefined,
      });

      setIsTransitionOpen(false);
      setTargetTransitionStatus('');
      setTransitionRemarks('');
      await Promise.all([fetchTenders(true), fetchDashboardStats(), fetchReports()]);
    } catch (err: any) {
      setActionError(err.message || 'Failed to transition tender stage.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Helper to open Win/Loss Outcome Modal with prefilled tender data (§26)
  const openOutcomeModal = (tender: any) => {
    setSelectedTender(tender);
    setOutcomeResult('won');
    setOutcomeValueLakh(
      tender.estimated_value_lakh || tender.estimated_value
        ? String(tender.estimated_value_lakh || tender.estimated_value / 100000)
        : ''
    );
    setOutcomeProductId(tender.product_id || '');
    setOutcomeRegionId(tender.region_id || '');
    setOutcomeResponsiblePersonId(tender.assigned_to || tender.assigned_person_id || tender.tender_owner_id || '');
    setOutcomeCategory(tender.category || 'general_mha');
    setOutcomeLossReason('price');
    setOutcomeCompetitor('');
    setOutcomeTechnicalIssue('');
    setOutcomePricingIssue('');
    setOutcomeEligibilityIssue('');
    setOutcomeDocumentationIssue('');
    setOutcomeOtherReason('');
    setOutcomeRemarks('');
    setOutcomeResultDate(new Date().toISOString().split('T')[0]);
    setActionError(null);
    setIsOutcomeOpen(true);
  };

  // Helper to open GeM / Portal Issue Modal (§25)
  const openNewIssueModal = (tender?: any) => {
    setActionError(null);
    if (tender) {
      setSelectedTender(tender);
      setIssueTenderId(tender.id);
      setIssueResponsiblePerson(tender.assigned_to || tender.assigned_person_id || '');
    } else {
      setIssueTenderId(tenders[0]?.id || '');
      setIssueResponsiblePerson('');
    }
    setNewIssueText('');
    setIssueEscalatedTo('');
    setIssueReportedDate(new Date().toISOString().split('T')[0]);
    setIssueResolutionStatus('OPEN');
    setIsNewIssueOpen(true);
  };

  // 7. Handle Structured Win / Loss Outcome Submit (§26)
  const handleOutcomeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTender) return;
    setActionError(null);

    if (outcomeResult === 'lost' && !outcomeLossReason) {
      setActionError('Structured loss reason is mandatory for post-mortem loss analysis.');
      return;
    }

    setIsSubmitting(true);
    try {
      const fullReasonNote = [
        outcomeLossReason ? `Category: ${outcomeLossReason.toUpperCase()}` : null,
        outcomeTechnicalIssue ? `Technical: ${outcomeTechnicalIssue}` : null,
        outcomePricingIssue ? `Pricing: ${outcomePricingIssue}` : null,
        outcomeEligibilityIssue ? `Eligibility: ${outcomeEligibilityIssue}` : null,
        outcomeDocumentationIssue ? `Docs: ${outcomeDocumentationIssue}` : null,
        outcomeOtherReason ? `Other: ${outcomeOtherReason}` : null,
        outcomeRemarks ? `Remarks: ${outcomeRemarks}` : null,
      ].filter(Boolean).join(' | ');

      await api.post(`/tenders/${selectedTender.id}/outcome`, {
        result: outcomeResult,
        value_lakh: outcomeResult === 'won' && outcomeValueLakh ? Number(outcomeValueLakh) : undefined,
        product_id: outcomeProductId || undefined,
        region_id: outcomeRegionId || undefined,
        responsible_person_id: outcomeResponsiblePersonId || undefined,
        category: outcomeCategory || undefined,
        tender_category: outcomeCategory || undefined,
        reason: outcomeResult === 'lost' ? (fullReasonNote || outcomeLossReason) : (outcomeRemarks || 'Won commercial evaluation'),
        loss_reason: outcomeResult === 'lost' ? outcomeLossReason : undefined,
        competitor: outcomeCompetitor.trim() || undefined,
        technical_issue: outcomeTechnicalIssue.trim() || undefined,
        pricing_issue: outcomePricingIssue.trim() || undefined,
        eligibility_issue: outcomeEligibilityIssue.trim() || undefined,
        documentation_issue: outcomeDocumentationIssue.trim() || undefined,
        other_reason: outcomeOtherReason.trim() || undefined,
        remarks: outcomeRemarks.trim() || undefined,
        result_date: outcomeResultDate,
      });

      setIsOutcomeOpen(false);
      setOutcomeRemarks('');
      setOutcomeCompetitor('');
      setOutcomeTechnicalIssue('');
      setOutcomePricingIssue('');
      setOutcomeEligibilityIssue('');
      setOutcomeDocumentationIssue('');
      setOutcomeOtherReason('');
      setOutcomeValueLakh('');
      await Promise.all([fetchTenders(true), fetchDashboardStats(), fetchReports()]);
    } catch (err: any) {
      setActionError(err.message || 'Failed to record tender outcome.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // 8. Handle Create Portal Issue (§25)
  const handleCreateIssue = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetTenderId = selectedTender?.id || issueTenderId;
    if (!targetTenderId) {
      setActionError('Please select the affected tender.');
      return;
    }
    if (!newIssueText.trim()) {
      setActionError('Issue description is required.');
      return;
    }
    setActionError(null);
    setIsSubmitting(true);

    try {
      await api.post(`/tenders/${targetTenderId}/portal-issues`, {
        issue: newIssueText.trim(),
        reported_date: issueReportedDate || new Date().toISOString().split('T')[0],
        responsible_person_id: issueResponsiblePerson || undefined,
        escalated_to: issueEscalatedTo.trim() || undefined,
        resolution_status: issueResolutionStatus || 'OPEN',
      });

      setIsNewIssueOpen(false);
      setNewIssueText('');
      setIssueResponsiblePerson('');
      setIssueEscalatedTo('');
      await Promise.all([fetchTenders(true), fetchDashboardStats(), fetchReports()]);
    } catch (err: any) {
      setActionError(err.message || 'Failed to log portal issue.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // 9. Handle Escalate / Resolve Portal Issue (§25)
  const handleUpdateIssueStatus = async (tenderId: string, issueId: string, status: string, resolution?: string) => {
    try {
      await api.patch(`/tenders/${tenderId}/portal-issues/${issueId}`, {
        resolution_status: status,
        resolution: resolution || undefined,
        escalated_to: status === 'escalated' ? 'Executive Management & GeM Desk' : undefined,
      });
      await Promise.all([fetchDashboardStats(), fetchReports()]);
    } catch (err: any) {
      console.error('Failed to update portal issue:', err);
    }
  };

  // Helper for deadline groupings
  const categorizedDeadlines = useMemo(() => {
    const now = new Date().getTime();
    const urgent: any[] = [];
    const upcoming: any[] = [];
    const overdue: any[] = [];
    const incompletePrep: any[] = [];
    const awaitingSignoff: any[] = [];
    const resultFollowups: any[] = [];

    tenders.forEach((t) => {
      const closing = t.submission_deadline || t.bid_closing_date ? new Date(t.submission_deadline || t.bid_closing_date).getTime() : null;
      const diffHours = closing ? (closing - now) / (1000 * 60 * 60) : null;

      if (t.status === 'awaiting_approval') {
        awaitingSignoff.push(t);
      }
      if (['submitted', 'technical_eval', 'commercial_eval'].includes(t.status)) {
        resultFollowups.push(t);
      }
      if (t.status === 'under_preparation' && diffHours !== null && diffHours <= 168 && diffHours > 0) {
        incompletePrep.push(t);
      }
      if (diffHours !== null && !['won', 'lost', 'cancelled'].includes(t.status)) {
        if (diffHours < 0) overdue.push(t);
        else if (diffHours <= 48) urgent.push(t);
        else if (diffHours <= 168) upcoming.push(t);
      }
    });

    return { urgent, upcoming, overdue, incompletePrep, awaitingSignoff, resultFollowups };
  }, [tenders]);

  // Check if any filter is active
  const hasActiveFilters = Boolean(
    search ||
    statusFilter ||
    categoryFilter ||
    zoneFilter ||
    deadlineFilter ||
    (user?.role !== 'sales' && assignedFilter) ||
    activeHudFilter ||
    sortBy !== 'created_at' ||
    sortOrder !== 'desc'
  );

  const resetAllFilters = () => {
    setSearch('');
    setStatusFilter('');
    setCategoryFilter('');
    setZoneFilter('');
    setDeadlineFilter('');
    setAssignedFilter(user?.role === 'sales' ? (user?.id || '') : '');
    setActiveHudFilter(null);
    setSortBy('created_at');
    setSortOrder('desc');
    setPage(1);
  };

  // KPI cards lead the pipeline view; every other tab keeps the toolbar on top
  const toolbarNode = (
      <ToolbarBox>
        <Tabs
          activeTab={activeTab}
          onChange={(tabId) => {
            setActiveTab(tabId as any);
            if (tabId === 'analytics') {
              fetchReports();
            }
          }}
          tabs={[
            {
              id: 'pipeline',
              label: user?.role === 'sales' ? 'My Assigned Bids' : 'Tender Pipeline & Bids',
              icon: <FileText className="h-4 w-4" />,
              count: totalCount || dashboardStats.total,
            },
            ...(user?.role !== 'sales'
              ? [
                  {
                    id: 'approvals_inbox',
                    label: 'Approvals Inbox & SLA',
                    icon: <UserCheck className="h-4 w-4" />,
                    count: dashboardStats.pending_approvals,
                    badgeVariant: ((dashboardStats.pending_approvals || 0) > 0 ? 'urgent' : 'default') as any,
                  },
                ]
              : []),
            {
              id: 'calendar',
              label: user?.role === 'sales' ? 'My Tender Calendar' : 'Tender Calendar',
              icon: <Calendar className="h-4 w-4" />,
            },
            ...(user?.role !== 'sales'
              ? [
                  {
                    id: 'finance_emd',
                    label: 'Finance & EMD / PBG',
                    icon: <IndianRupee className="h-4 w-4" />,
                  },
                ]
              : []),
            {
              id: 'deadlines',
              label: user?.role === 'sales' ? 'My Deadlines & Urgency' : 'Deadline & Urgency Command',
              icon: <Clock className="h-4 w-4" />,
              count: (dashboardStats.urgent_deadlines || 0) + (dashboardStats.upcoming_deadlines || 0),
              badgeVariant: ((dashboardStats.urgent_deadlines || 0) > 0 ? 'urgent' : 'info') as any,
            },
            {
              id: 'portal_issues',
              label: user?.role === 'sales' ? 'My GeM & Portal Issues' : 'GeM & Portal Issues',
              icon: <AlertTriangle className="h-4 w-4" />,
              count: dashboardStats.open_portal_issues || globalPortalIssues.length,
              badgeVariant: ((dashboardStats.open_portal_issues || 0) > 0 ? 'warning' : 'default') as any,
            },
            ...(user?.role !== 'sales'
              ? [
                  {
                    id: 'analytics',
                    label: 'Win/Loss Analytics',
                    icon: <BarChart3 className="h-4 w-4" />,
                    count: `${Number(dashboardStats.win_rate !== undefined ? dashboardStats.win_rate : (dashboardStats.win_rate_percentage || 0)).toFixed(1)}% Win`,
                  },
                ]
              : []),
          ]}
        />
      </ToolbarBox>
  );

  return (
    <PageContainer>
      {/* 1. Page Header */}
      <PageHeader
        title={user?.role === 'sales' ? 'My Assigned Tenders & Bids' : 'Tender Pipeline & Bids Command'}
        icon={
          <div className="p-2.5 rounded-xl bg-[#E3EFEE] text-[#0F5E63] border border-[#0F5E63]/20 shadow-2xs">
            <FileText className="h-6 w-6 text-[#0F5E63]" />
          </div>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                fetchTenders(true);
                fetchDashboardStats();
                if (user?.role !== 'sales') fetchReports();
              }}
              leftIcon={<RefreshCw className={`h-3.5 w-3.5 text-[#4A5568] ${isRefreshing ? 'animate-spin text-[#0F5E63]' : ''}`} />}
            >
              <span>Sync</span>
            </Button>
            {hasRole(['management', 'tender_team', 'admin']) && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsImportOpen(true)}
                  leftIcon={<Upload className="h-3.5 w-3.5 text-[#4A5568]" />}
                >
                  <span>Bulk Import</span>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsSettingsOpen(true)}
                  leftIcon={<Settings className="h-3.5 w-3.5 text-[#4A5568]" />}
                >
                  <span>SLAs & Settings</span>
                </Button>
              </>
            )}
            {hasRole(['management', 'regional_manager', 'tender_team', 'admin']) && (
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  setActionError(null);
                  setIsCreateOpen(true);
                }}
                leftIcon={<Plus className="h-4 w-4" />}
              >
                <span>Register New Tender</span>
              </Button>
            )}
          </div>
        }
      />


      {/* 2. Top-Level Executive Navigation Tabs */}
      {activeTab !== 'pipeline' && toolbarNode}

      {/* ========================================================================= */}
      {/* TAB 1: OPERATIONAL PIPELINE & BIDS */}
      {/* ========================================================================= */}
      {activeTab === 'pipeline' && (
        <div className="space-y-5 animate-in fade-in duration-150">
          {/* Executive Metrics HUD (Top 5 Core KPI Command HUD) */}
          <div className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
              <StatCard
                label="Total Tracked Bids"
                value={dashboardStats.total || dashboardStats.total_tenders || 0}
                subtext="All-India bidding opportunities"
                icon={<Briefcase className="h-4 w-4 text-[#0F5E63]" />}
                className={`cursor-pointer transition-all hover:shadow-xs ${
                  !activeHudFilter && !statusFilter && !categoryFilter && !deadlineFilter ? 'ring-2 ring-[#0F5E63] border-[#0F5E63]' : ''
                }`}
                onClick={() => handleHudClick('total', '')}
              />

              <StatCard
                label="PQ Tenders (§20)"
                value={dashboardStats.pq_count || dashboardStats.pq_tenders || 0}
                subtext="Pre-qualification criteria"
                icon={<Layers className="h-4 w-4 text-[#0F5E63]" />}
                badge={<Badge variant="cyber" size="sm">Pre-Qual</Badge>}
                valueColor="primary"
                className={`cursor-pointer transition-all hover:shadow-xs ${
                  categoryFilter === 'pq' ? 'ring-2 ring-[#0F5E63] border-[#0F5E63] bg-[#E3EFEE]/30' : ''
                }`}
                onClick={() => handleHudClick('pq', 'pq')}
              />

              <StatCard
                label="General / MHA (§20)"
                value={dashboardStats.general_mha_count || dashboardStats.general_mha_tenders || 0}
                subtext="Ministry & paramilitary RFPs"
                icon={<Building className="h-4 w-4 text-[#0F5E63]" />}
                badge={<Badge variant="info" size="sm">MHA QRs</Badge>}
                className={`cursor-pointer transition-all hover:shadow-xs ${
                  categoryFilter === 'general_mha' ? 'ring-2 ring-[#0F5E63] border-[#0F5E63] bg-[#E3EFEE]/30' : ''
                }`}
                onClick={() => handleHudClick('general_mha', 'general_mha')}
              />

              <StatCard
                label="Pending Approvals"
                value={dashboardStats.pending_approvals || 0}
                subtext="Awaiting executive signoff"
                icon={<ShieldCheck className="h-4 w-4 text-[#9A3412]" />}
                valueColor="amber"
                badge={
                  dashboardStats.pending_approvals > 0 ? (
                    <span className="flex h-2.5 w-2.5 relative">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-600"></span>
                    </span>
                  ) : (
                    <Badge variant="outline" size="sm">Dual-Control</Badge>
                  )
                }
                className={`cursor-pointer transition-all hover:shadow-xs ${
                  statusFilter === 'awaiting_approval' ? 'ring-2 ring-[#9A3412] border-[#9A3412] bg-[#FBEBDD]/40' : ''
                }`}
                onClick={() => handleHudClick('awaiting_approval', 'awaiting_approval')}
              />

              <StatCard
                label="Won Awards & Rate"
                value={dashboardStats.won || dashboardStats.tenders_won || 0}
                subtext={`Conversion: ${Number(dashboardStats.win_rate !== undefined ? dashboardStats.win_rate : (dashboardStats.win_rate_percentage || 0)).toFixed(1)}%`}
                icon={<Award className="h-4 w-4 text-[#0F5E63]" />}
                valueColor="emerald"
                badge={<Badge variant="success" size="sm">L1 Won</Badge>}
                className={`cursor-pointer transition-all hover:shadow-xs ${
                  statusFilter === 'won' ? 'ring-2 ring-[#0F5E63] border-[#0F5E63] bg-[#E3EFEE]/30' : ''
                }`}
                onClick={() => handleHudClick('won', 'won')}
              />
            </div>

            {toolbarNode}

            {/* Operational Urgency & Stage Quick-Filter Strip */}
            <ToolbarSlot><div className="bg-white rounded-xl border border-[#DCD8CE] p-2.5 shadow-2xs flex flex-wrap items-center justify-between gap-2 text-xs">
              <FilterMenu
                label="Alerts & stages"
                icon={<Flame className="h-3.5 w-3.5" />}
                neutralKeys={['portal']}
                options={[
                  { key: 'urgent', label: 'Closing ≤ 48h', icon: <Zap />, count: dashboardStats.urgent_deadlines || 0, urgent: true, active: deadlineFilter === 'urgent_48h', onSelect: () => handleHudClick('urgent_deadlines', 'urgent_48h') },
                  { key: 'upcoming', label: 'Due ≤ 7 days', icon: <Clock />, count: dashboardStats.upcoming_deadlines || 0, active: deadlineFilter === 'upcoming_7d', onSelect: () => handleHudClick('upcoming_deadlines', 'upcoming_7d') },
                  { key: 'prep', label: 'In preparation', icon: <FileCheck />, count: dashboardStats.under_preparation || 0, active: statusFilter === 'under_preparation', onSelect: () => handleHudClick('under_preparation', 'under_preparation') },
                  { key: 'submitted', label: 'Submitted', icon: <Send />, count: dashboardStats.submitted || dashboardStats.tenders_submitted || 0, active: statusFilter === 'submitted', onSelect: () => handleHudClick('submitted', 'submitted') },
                  { key: 'lost', label: 'Lost bids', icon: <XCircle />, count: dashboardStats.lost || dashboardStats.tenders_lost || 0, active: statusFilter === 'lost', onSelect: () => handleHudClick('lost', 'lost') },
                  { key: 'portal', label: 'Portal issues (open tab)', icon: <AlertCircle />, count: dashboardStats.open_portal_issues || globalPortalIssues.length, active: false, onSelect: () => setActiveTab('portal_issues') },
                ]}
              />

              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={resetAllFilters}
                  className="text-xs font-semibold text-[#0F5E63] hover:text-[#0B4A4E] hover:underline flex items-center gap-1 px-2 py-1"
                >
                  <X className="h-3.5 w-3.5" />
                  <span>Reset All Filters</span>
                </button>
              )}
            </div></ToolbarSlot>
          </div>

          {/* ========================================================================= */}
          {/* Search, Filter & Scope Command Bar (Compact Aligned Layout) */}
          {/* ========================================================================= */}
          <ToolbarSlot><div className="bg-white rounded-[14px] border border-[#DCD8CE] p-3 shadow-2xs space-y-3">
            {/* Row 1: Scope Switcher + Search Input + Sort Dropdown */}
            <div className="flex flex-col md:flex-row items-stretch md:items-center gap-3">
              {/* Scope Segmented Pill Switcher */}
              {user?.role === 'sales' ? (
                <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-[#E3EFEE] rounded-lg border border-[#0F5E63]/25 shrink-0">
                  <UserCheck className="w-3.5 h-3.5 text-[#0F5E63]" />
                  <span className="text-xs font-bold text-[#0F5E63]">
                    Assigned to You
                  </span>
                  <span className="text-[10px] font-semibold text-[#14213D] bg-white px-2 py-0.5 rounded-full border border-[#0F5E63]/20 font-mono">
                    {totalCount} {totalCount === 1 ? 'tender' : 'tenders'}
                  </span>
                </div>
              ) : (
                <div className="inline-flex items-center gap-1 p-1 bg-[#FBFAF7] rounded-lg border border-[#DCD8CE] shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      setAssignedFilter('');
                      setPage(1);
                    }}
                    className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer ${
                      !assignedFilter
                        ? 'bg-[#0F5E63] text-white shadow-xs'
                        : 'text-[#4A5568] hover:text-[#14213D] hover:bg-white'
                    }`}
                  >
                    All Opportunities
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAssignedFilter(user?.id || '');
                      setPage(1);
                    }}
                    className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 ${
                      assignedFilter === user?.id
                        ? 'bg-[#0F5E63] text-white shadow-xs'
                        : 'text-[#4A5568] hover:text-[#14213D] hover:bg-white'
                    }`}
                  >
                    <UserCheck className="w-3.5 h-3.5" />
                    <span>Assigned to Me</span>
                    {user?.id && (
                      <span
                        className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                          assignedFilter === user?.id ? 'bg-white/20 text-white' : 'bg-[#E3EFEE] text-[#0F5E63]'
                        }`}
                      >
                        {tenders.filter((t) => t.assigned_to === user?.id || t.assigned_person_id === user?.id).length}
                      </span>
                    )}
                  </button>
                </div>
              )}

              {/* Search Input */}
              <div className="relative flex-1 min-w-[240px]">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-[#4A5568]" />
                <input
                  type="text"
                  placeholder="Search by tender no, portal, buyer organisation, product, or state..."
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(1);
                  }}
                  className="w-full pl-9 pr-8 py-2 text-xs bg-[#FBFAF7] border border-[#DCD8CE] rounded-lg text-[#14213D] placeholder-[#4A5568] focus:outline-none focus:border-[#0F5E63] focus:bg-white transition-colors"
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearch('');
                      setPage(1);
                    }}
                    className="absolute right-2.5 top-2.5 text-[#4A5568] hover:text-[#14213D]"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              {/* Sort Dropdown */}
              <div className="w-full md:w-56 shrink-0">
                <select
                  value={`${sortBy}:${sortOrder}`}
                  onChange={(e) => {
                    const parts = e.target.value.split(':');
                    setSortBy(parts[0]);
                    setSortOrder(parts[1] as 'asc' | 'desc');
                    setPage(1);
                  }}
                  className="w-full px-2.5 py-2 text-xs bg-[#FBFAF7] border border-[#DCD8CE] rounded-lg text-[#14213D] focus:outline-none focus:border-[#0F5E63] focus:bg-white"
                >
                  <option value="created_at:desc">Sort: Recent First (Newest)</option>
                  <option value="created_at:asc">Sort: Oldest First</option>
                  <option value="submission_deadline:asc">Deadline: Nearest First</option>
                  <option value="submission_deadline:desc">Deadline: Furthest First</option>
                  <option value="estimated_value:desc">Value: High to Low</option>
                  <option value="estimated_value:asc">Value: Low to High</option>
                  <option value="publication_date:desc">Publication Date (Recent)</option>
                </select>
              </div>
            </div>

            {/* Row 2: Secondary Filters Strip (Horizontal Aligned Grid) */}
            <div className={`grid grid-cols-2 sm:grid-cols-3 ${user?.role === 'sales' ? 'md:grid-cols-4' : 'md:grid-cols-5'} gap-2 pt-1 border-t border-[#ECE9E2]`}>
              {/* Lifecycle Stage */}
              <select
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value);
                  setActiveHudFilter(null);
                  setPage(1);
                }}
                className="w-full px-2.5 py-1.5 text-xs bg-[#FBFAF7] border border-[#DCD8CE] rounded-lg text-[#14213D] focus:outline-none focus:border-[#0F5E63] focus:bg-white"
              >
                <option value="">All Lifecycle Stages</option>
                {STAGES.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </select>

              {/* Classification */}
              <select
                value={categoryFilter}
                onChange={(e) => {
                  setCategoryFilter(e.target.value);
                  setActiveHudFilter(null);
                  setPage(1);
                }}
                className="w-full px-2.5 py-1.5 text-xs bg-[#FBFAF7] border border-[#DCD8CE] rounded-lg text-[#14213D] focus:outline-none focus:border-[#0F5E63] focus:bg-white"
              >
                <option value="">All Classifications</option>
                <option value="pq">PQ (Pre-Qualification)</option>
                <option value="general_mha">General / MHA</option>
                <option value="other">Other Defence / Govt</option>
              </select>

              {/* Territory Zone */}
              <select
                value={zoneFilter}
                onChange={(e) => {
                  setZoneFilter(e.target.value);
                  setPage(1);
                }}
                className="w-full px-2.5 py-1.5 text-xs bg-[#FBFAF7] border border-[#DCD8CE] rounded-lg text-[#14213D] focus:outline-none focus:border-[#0F5E63] focus:bg-white"
              >
                <option value="">All Territory Zones</option>
                <option value="North">North Zone</option>
                <option value="South">South Zone</option>
                <option value="East">East Zone</option>
                <option value="West">West Zone</option>
                <option value="Central">Central Zone</option>
              </select>

              {/* Assignee / Salesperson (Hidden for sales since they only see their own) */}
              {user?.role !== 'sales' ? (
                <select
                  value={assignedFilter}
                  onChange={(e) => {
                    setAssignedFilter(e.target.value);
                    setActiveHudFilter(null);
                    setPage(1);
                  }}
                  className="w-full px-2.5 py-1.5 text-xs bg-[#FBFAF7] border border-[#DCD8CE] rounded-lg text-[#14213D] focus:outline-none focus:border-[#0F5E63] focus:bg-white"
                >
                  <option value="">All Assignees</option>
                  {user?.id && <option value={user.id}>★ Assigned to Me ({user.full_name})</option>}
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.full_name} ({u.role?.replace(/_/g, ' ')})
                    </option>
                  ))}
                </select>
              ) : null}

              {/* Deadlines */}
              <select
                value={deadlineFilter}
                onChange={(e) => {
                  setDeadlineFilter(e.target.value);
                  setActiveHudFilter(null);
                  setPage(1);
                }}
                className="w-full px-2.5 py-1.5 text-xs bg-[#FBFAF7] border border-[#DCD8CE] rounded-lg text-[#14213D] focus:outline-none focus:border-[#0F5E63] focus:bg-white"
              >
                <option value="">All Deadlines</option>
                <option value="urgent_48h">Urgent (≤ 48 Hours)</option>
                <option value="upcoming_7d">Upcoming (≤ 7 Days)</option>
                <option value="overdue">Overdue Submissions</option>
              </select>
            </div>
          </div></ToolbarSlot>

          {/* ========================================================================= */}
          {/* Tenders Data Table & List View */}
          {/* ========================================================================= */}
          <div className="bg-white rounded-[14px] border border-[#DCD8CE] overflow-hidden shadow-2xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-[#FBFAF7] border-b border-[#DCD8CE] text-[#4A5568] font-semibold">
                    <th className="p-3.5 whitespace-nowrap">Tender / Bid No.</th>
                    <th className="p-3.5 whitespace-nowrap">Buyer & Location</th>
                    <th className="p-3.5 whitespace-nowrap">Category</th>
                    <th className="p-3.5">Requirement & Ownership</th>
                    <th className="p-3.5 whitespace-nowrap">Qty & Value</th>
                    <th className="p-3.5 whitespace-nowrap">Submission Deadline</th>
                    <th className="p-3.5 whitespace-nowrap">Stage</th>
                    <th className="p-3.5 text-right whitespace-nowrap">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#ECE9E2]">
                  {isLoading ? (
                    <tr>
                      <td colSpan={8} className="p-12 text-center text-xs text-[#4A5568]">
                        <Spinner size="md" className="mx-auto mb-2" />
                        <span className="font-medium text-[#14213D]">Loading bidding opportunities...</span>
                      </td>
                    </tr>
                  ) : tenders.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="p-12">
                        <EmptyState
                          icon={<FileText className="h-10 w-10 text-[#4A5568]" />}
                          title="No tenders match selected criteria"
                          description="Adjust your search filters, clear active stage criteria, or register a new tender opportunity."
                          action={
                            hasActiveFilters ? (
                              <Button variant="outline" size="sm" onClick={resetAllFilters}>
                                Reset Filters
                              </Button>
                            ) : undefined
                          }
                        />
                      </td>
                    </tr>
                  ) : (
                    tenders.map((tender) => {
                      const stageObj = STAGES.find((s) => s.key === tender.status) || {
                        key: tender.status,
                        label: tender.status,
                        color: 'default' as const,
                      };

                      const closingDate = tender.submission_deadline || tender.bid_closing_date
                        ? new Date(tender.submission_deadline || tender.bid_closing_date)
                        : null;
                      const now = new Date();
                      const diffHours = closingDate
                        ? (closingDate.getTime() - now.getTime()) / (1000 * 60 * 60)
                        : null;
                      const diffDays = diffHours !== null ? Math.ceil(diffHours / 24) : null;
                      const isUrgent = diffHours !== null && diffHours <= 48 && diffHours > 0;
                      const isUpcoming = diffHours !== null && diffHours > 48 && diffHours <= 168;
                      const isOverdue = diffHours !== null && diffHours < 0 && !['won', 'lost', 'cancelled'].includes(tender.status);

                      return (
                        <tr
                          key={tender.id}
                          className="hover:bg-[#F8FAFC] transition-colors border-b border-[#ECE9E2] group"
                        >
                          {/* Tender Number & Portal */}
                          <td className="p-3.5 whitespace-nowrap">
                            <div className="font-mono font-bold text-[#14213D] flex items-center gap-1.5">
                              <span
                                className="cursor-pointer hover:text-[#0F5E63] hover:underline"
                                onClick={() => openTenderDetails(tender)}
                              >
                                {tender.tender_number || tender.tender_no}
                              </span>
                              {tender.portal && (
                                <Badge variant="outline" size="sm">
                                  {tender.portal}
                                </Badge>
                              )}
                            </div>
                            <div className="text-[10px] text-[#4A5568] font-mono mt-0.5">
                              ID: {tender.id.slice(0, 8)}
                            </div>
                          </td>

                          {/* Buyer & Location */}
                          <td className="p-3.5 max-w-[220px]">
                            <div className="font-semibold text-[#14213D] truncate" title={tender.department || tender.organisation_name}>
                              {tender.department || tender.organisation_name || 'Government Buyer'}
                            </div>
                            <div className="text-[10px] text-[#4A5568] flex items-center gap-1 mt-0.5 truncate">
                              <MapPin className="h-3 w-3 shrink-0 text-[#0F5E63]" />
                              <span>
                                {tender.city ? `${tender.city}, ` : ''}
                                {tender.state ? `${tender.state} ` : ''}
                                {tender.zone ? `(${tender.zone})` : ''}
                              </span>
                            </div>
                          </td>

                          {/* Category */}
                          <td className="p-3.5 whitespace-nowrap">
                            <Badge
                              variant={
                                tender.category?.toLowerCase() === 'pq'
                                  ? 'cyber'
                                  : tender.category?.toLowerCase() === 'general_mha'
                                    ? 'info'
                                    : 'default'
                              }
                              size="sm"
                            >
                              {tender.category === 'pq'
                                ? 'PQ'
                                : tender.category === 'general_mha'
                                  ? 'General / MHA'
                                  : tender.category || 'Standard'}
                            </Badge>
                          </td>

                          {/* Requirement Excerpt & Ownership */}
                          <td className="p-3.5 max-w-[260px]">
                            <div className="truncate font-medium text-[#14213D]" title={tender.requirement_text}>
                              {tender.requirement_text || tender.product_name || 'Defence Procurement Item'}
                            </div>
                            <div className="mt-1 flex flex-col gap-0.5 text-[10px]">
                              <div className="text-[#4A5568] truncate flex items-center gap-1">
                                <span className="text-[#718096] font-semibold uppercase tracking-wider text-[9px]">Owner:</span>
                                <span className="font-medium text-[#14213D] truncate">{tender.tender_owner_name || tender.owner_name || 'Unassigned'}</span>
                              </div>
                              <div className="truncate flex items-center gap-1">
                                <span className="text-[#718096] font-semibold uppercase tracking-wider text-[9px]">Sales:</span>
                                <span className="font-medium text-[#14213D] truncate">
                                  {tender.assigned_to_name || tender.assigned_person_name || 'Unassigned'}
                                </span>
                                {(tender.assigned_to === user?.id || tender.assigned_person_id === user?.id) && (
                                  <span className="inline-flex items-center px-1.5 py-0.2 rounded text-[9px] font-bold bg-[#E3EFEE] text-[#0F5E63] border border-[#0F5E63]/30 shrink-0">
                                    🎯 You
                                  </span>
                                )}
                              </div>
                            </div>
                          </td>

                          {/* Qty & Value */}
                          <td className="p-3.5 whitespace-nowrap">
                            <div className="font-semibold text-[#14213D]">
                              Qty: {tender.quantity || 1}
                            </div>
                            <div className="text-[11px] font-mono font-bold text-[#0F5E63] mt-0.5">
                              {tender.estimated_value_lakh
                                ? `₹ ${tender.estimated_value_lakh} Lakh`
                                : tender.tender_value
                                  ? `₹ ${(tender.tender_value / 100000).toFixed(2)} Lakh`
                                  : tender.emd_fee
                                    ? `EMD: ${formatINR(tender.emd_fee)}`
                                    : 'EMD: Exempt'}
                            </div>
                          </td>

                          {/* Submission Deadline */}
                          <td className="p-3.5 whitespace-nowrap">
                            <div className="font-mono text-[#14213D] font-semibold text-xs">
                              {closingDate ? closingDate.toLocaleDateString('en-IN') : 'TBA'}
                            </div>
                            {isOverdue ? (
                              <Badge variant="danger" size="sm" className="mt-1" hasDot>
                                OVERDUE
                              </Badge>
                            ) : isUrgent ? (
                              <Badge variant="urgent" size="sm" className="mt-1">
                                {diffHours <= 24 ? 'CLOSING TODAY' : `${Math.ceil(diffHours)}H LEFT`}
                              </Badge>
                            ) : isUpcoming ? (
                              <Badge variant="info" size="sm" className="mt-1">
                                {diffDays} DAYS LEFT
                              </Badge>
                            ) : (
                              <span className="text-[10px] text-[#4A5568] block mt-0.5">Standard</span>
                            )}
                          </td>

                          {/* Current Stage */}
                          <td className="p-3.5 whitespace-nowrap">
                            <Badge variant={stageObj.color} size="sm">
                              {stageObj.label}
                            </Badge>
                          </td>

                          {/* Actions (§19-§26 Quick Progression) */}
                          <td className="p-3.5 text-right whitespace-nowrap">
                            <div className="flex items-center justify-end gap-1.5">
                              {tender.status === 'identified' && (
                                <div className="flex items-center gap-1">
                                  {hasRole(['management', 'admin']) ? (
                                    <Button
                                      size="xs"
                                      variant="primary"
                                      onClick={() => openTenderDetails(tender)}
                                      title="Review as Management & Authorise"
                                    >
                                      <ShieldCheck className="h-3 w-3 mr-1" />
                                      <span>Review (Mgmt)</span>
                                    </Button>
                                  ) : (
                                    <Button
                                      size="xs"
                                      variant="primary"
                                      onClick={() => handleQuickRequestApproval(tender)}
                                      title="Submit for Internal Review"
                                    >
                                      <Send className="h-3 w-3 mr-1" />
                                      <span>Submit for Review</span>
                                    </Button>
                                  )}
                                </div>
                              )}

                              {tender.status === 'awaiting_approval' && (
                                hasRole(['management', 'admin']) ? (
                                  <Button
                                    size="xs"
                                    variant="primary"
                                    className="bg-amber-600 hover:bg-amber-700 text-white"
                                    onClick={() => openTenderDetails(tender)}
                                    title="Review Decision & Endorse as Management"
                                  >
                                    <ShieldCheck className="h-3 w-3 mr-1" />
                                    <span>Review (Mgmt)</span>
                                  </Button>
                                ) : (
                                  <Badge variant="warning" size="sm">
                                    In Review
                                  </Badge>
                                )
                              )}

                              {tender.status === 'under_preparation' && (() => {
                                const isPqTender = (tender.category || '').toLowerCase().includes('pq');
                                return (
                                  <Button
                                    size="xs"
                                    variant="primary"
                                    onClick={() => {
                                      setSelectedTender(tender);
                                      setTargetTransitionStatus(isPqTender ? 'pq_submitted' : 'submitted');
                                      setTransitionRemarks(isPqTender ? 'Pre-qualification dossier submitted on government portal.' : 'Technical and financial bids submitted on GeM portal.');
                                      setActionError(null);
                                      setIsTransitionOpen(true);
                                    }}
                                    title="Advance to Submission"
                                  >
                                    <CheckCircle2 className="h-3 w-3 mr-1" />
                                    <span>{isPqTender ? 'Submit PQ' : 'Submit Bid'}</span>
                                  </Button>
                                );
                              })()}

                              {['submitted', 'technical_eval', 'commercial_eval'].includes(tender.status) && (
                                <Button
                                  size="xs"
                                  variant="outline"
                                  className="text-emerald-700 border-emerald-300 hover:bg-emerald-50"
                                  onClick={() => {
                                    setSelectedTender(tender);
                                    setOutcomeResult('won');
                                    setIsOutcomeOpen(true);
                                  }}
                                  title="Record Won/Lost Outcome"
                                >
                                  <Award className="h-3 w-3 mr-1" />
                                  <span>Outcome</span>
                                </Button>
                              )}

                              <Button
                                size="xs"
                                variant="secondary"
                                onClick={() => openTenderDetails(tender)}
                                title="Open full 11-tab tender dossier"
                              >
                                <Eye className="h-3 w-3 mr-1 text-[#0F5E63]" />
                                <span>Inspect</span>
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination Bar */}
            <div className="p-3 bg-[#FBFAF7] border-t border-[#DCD8CE] flex flex-wrap items-center justify-between gap-3 text-xs text-[#4A5568]">
              <div>
                Showing <strong className="text-[#14213D]">{tenders.length}</strong> of{' '}
                <strong className="text-[#14213D]">{totalCount}</strong> opportunities
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="xs"
                  disabled={page <= 1}
                  onClick={() => setPage(page - 1)}
                >
                  Previous
                </Button>
                <span className="font-semibold text-[#14213D] px-2">
                  Page {page} of {Math.max(1, Math.ceil(totalCount / limit))}
                </span>
                <Button
                  variant="outline"
                  size="xs"
                  disabled={page >= Math.ceil(totalCount / limit)}
                  onClick={() => setPage(page + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB: APPROVALS INBOX & GOVERNANCE */}
      {/* ========================================================================= */}
      {activeTab === 'approvals_inbox' && user?.role !== 'sales' && (
        <ApprovalsInboxView
          currentUser={user}
          onOpenDossier={(id) => {
            setDossierTenderId(id);
            setIsDossierOpen(true);
          }}
        />
      )}

      {/* ========================================================================= */}
      {/* TAB: SHARED TENDER CALENDAR & MILESTONES */}
      {/* ========================================================================= */}
      {activeTab === 'calendar' && (
        <TenderCalendarView
          currentUser={user}
          onOpenDossier={(id) => {
            setDossierTenderId(id);
            setIsDossierOpen(true);
          }}
        />
      )}

      {/* ========================================================================= */}
      {/* TAB: FINANCE & EMD / PBG REPOSITORY */}
      {/* ========================================================================= */}
      {activeTab === 'finance_emd' && user?.role !== 'sales' && (
        <FinanceEmdView
          currentUser={user}
          onOpenDossier={(id) => {
            setDossierTenderId(id);
            setIsDossierOpen(true);
          }}
        />
      )}

      {/* ========================================================================= */}
      {/* TAB 2: EXECUTIVE REPORTING & ANALYTICS (§21, §26, §27) */}
      {/* ========================================================================= */}
      {activeTab === 'analytics' && user?.role !== 'sales' && (
        <div className="space-y-6 animate-in fade-in duration-150">
          <SectionHeader
            title="Executive Management Reporting & Analytics Suite (§27)"
            description="Multi-tier pipeline intelligence across Classifications (Vikas's PQ vs General/MHA Matrix), Territories, Salespeople, and Post-Mortem Win/Loss Analysis"
          />

          {/* Section 1: Executive KPI Command HUD (§27 Monitoring Requirements) */}
          <div className="space-y-3">
            <h3 className="text-xs font-bold text-[#4A5568] uppercase tracking-wider flex items-center gap-1.5">
              <Layers className="h-4 w-4 text-[#0F5E63]" />
              <span>Executive Tender Pipeline HUD (§27 Management Metrics)</span>
            </h3>

            {/* Row 1: Pipeline & Classification Counts */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              <Card className="p-3.5 border-[#DCD8CE] bg-white">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[#4A5568]">Total Identified</span>
                  <FileText className="h-4 w-4 text-[#0F5E63]" />
                </div>
                <div className="text-2xl font-black text-[#14213D] mt-1.5">
                  {dashboardStats.total_tenders || 0}
                </div>
                <p className="text-[10px] text-[#4A5568] mt-0.5">All registered opportunities</p>
              </Card>

              <Card className="p-3.5 border-[#DCD8CE] bg-white">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[#4A5568]">PQ Tenders</span>
                  <Badge variant="cyber" size="sm">Pre-Qual</Badge>
                </div>
                <div className="text-2xl font-black text-[#0F5E63] mt-1.5">
                  {dashboardStats.pq_tenders || dashboardStats.pq_count || 0}
                </div>
                <p className="text-[10px] text-[#4A5568] mt-0.5">Vikas PQ classification</p>
              </Card>

              <Card className="p-3.5 border-[#DCD8CE] bg-white">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[#4A5568]">General / MHA</span>
                  <Badge variant="info" size="sm">MHA QR</Badge>
                </div>
                <div className="text-2xl font-black text-[#14213D] mt-1.5">
                  {dashboardStats.general_mha_tenders || dashboardStats.general_mha_count || 0}
                </div>
                <p className="text-[10px] text-[#4A5568] mt-0.5">Paramilitary & central bids</p>
              </Card>

              <Card className="p-3.5 border-[#DCD8CE] bg-white">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[#4A5568]">Other Tenders</span>
                  <Badge variant="default" size="sm">Institutional</Badge>
                </div>
                <div className="text-2xl font-black text-[#14213D] mt-1.5">
                  {dashboardStats.other_tenders || dashboardStats.other_count || 0}
                </div>
                <p className="text-[10px] text-[#4A5568] mt-0.5">State Police & PSUs</p>
              </Card>

              <Card className="p-3.5 border-[#DCD8CE] bg-white">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[#4A5568]">Worked Upon</span>
                  <Clock className="h-4 w-4 text-[#0F5E63]" />
                </div>
                <div className="text-2xl font-black text-[#0F5E63] mt-1.5">
                  {dashboardStats.worked_upon || 0}
                </div>
                <p className="text-[10px] text-[#4A5568] mt-0.5">In prep, eval, or bid stage</p>
              </Card>
            </div>

            {/* Row 2: Submissions, Outcomes & Win Rate */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              <Card className="p-3.5 border-[#DCD8CE] bg-white">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[#4A5568]">Tenders Submitted</span>
                  <Send className="h-4 w-4 text-[#0F5E63]" />
                </div>
                <div className="text-2xl font-black text-[#0F5E63] mt-1.5">
                  {dashboardStats.tenders_submitted || 0}
                </div>
                <p className="text-[10px] text-[#4A5568] mt-0.5">Bids filed on GeM/CPPP</p>
              </Card>

              <Card className="p-3.5 border-[#DCD8CE] bg-white">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[#4A5568]">Tenders Won</span>
                  <Award className="h-4 w-4 text-emerald-600" />
                </div>
                <div className="text-2xl font-black text-emerald-700 mt-1.5">
                  {dashboardStats.tenders_won || 0}
                </div>
                <p className="text-[10px] text-[#4A5568] mt-0.5">L1 contracts secured</p>
              </Card>

              <Card className="p-3.5 border-[#DCD8CE] bg-white">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[#4A5568]">Tenders Lost</span>
                  <XCircle className="h-4 w-4 text-rose-600" />
                </div>
                <div className="text-2xl font-black text-rose-600 mt-1.5">
                  {dashboardStats.tenders_lost || 0}
                </div>
                <p className="text-[10px] text-[#4A5568] mt-0.5">Lost to competitor/disqualified</p>
              </Card>

              <Card className="p-3.5 border-[#DCD8CE] bg-white">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[#4A5568]">Pending Tenders</span>
                  <Clock className="h-4 w-4 text-amber-600" />
                </div>
                <div className="text-2xl font-black text-amber-700 mt-1.5">
                  {dashboardStats.pending_tenders || 0}
                </div>
                <p className="text-[10px] text-[#4A5568] mt-0.5">In flight across all stages</p>
              </Card>

              <Card className="p-3.5 border-[#DCD8CE] bg-white">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[#4A5568]">Conversion Win Rate</span>
                  <TrendingUp className="h-4 w-4 text-emerald-600" />
                </div>
                <div className="text-2xl font-black text-emerald-700 mt-1.5">
                  {winLossReport.win_rate !== undefined ? `${winLossReport.win_rate}%` : `${dashboardStats.win_rate || 0}%`}
                </div>
                <p className="text-[10px] text-[#4A5568] mt-0.5">Won / Decided bids</p>
              </Card>
            </div>
          </div>

          {/* Section 2: Organisation-Level Pipeline Report (§21 & §27) */}
          <div className="bg-white rounded-xl border border-[#DCD8CE] p-4 shadow-2xs space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-sm font-bold text-[#14213D] flex items-center gap-1.5">
                  <Building className="h-4 w-4 text-[#0F5E63]" />
                  <span>Organisation-Level Pipeline & Conversion (§21, §27)</span>
                </h4>
                <p className="text-xs text-[#4A5568]">Performance breakdown grouped by buyer organisation, sector, and classification</p>
              </div>
              <Badge variant="info" size="sm">{organisationReport.length} Buyer Organisations</Badge>
            </div>

            <div className="overflow-x-auto max-h-[360px] overflow-y-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="sticky top-0 bg-[#FBFAF7]">
                  <tr className="border-b border-[#DCD8CE] text-[#4A5568] font-semibold">
                    <th className="p-2.5">Buyer Organisation</th>
                    <th className="p-2.5">Sector</th>
                    <th className="p-2.5">Location</th>
                    <th className="p-2.5 text-center">Total</th>
                    <th className="p-2.5 text-center">PQ Bids</th>
                    <th className="p-2.5 text-center">General / MHA</th>
                    <th className="p-2.5 text-center">In Prep / Review</th>
                    <th className="p-2.5 text-center">Submitted</th>
                    <th className="p-2.5 text-center">Won</th>
                    <th className="p-2.5 text-center">Lost</th>
                    <th className="p-2.5 text-right">Org Win Rate</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#ECE9E2]">
                  {organisationReport.length === 0 ? (
                    <tr>
                      <td colSpan={11} className="p-4 text-center text-xs text-[#4A5568]">
                        No organisation-level tender data available.
                      </td>
                    </tr>
                  ) : (
                    organisationReport.map((org) => {
                      const decided = (org.won || 0) + (org.lost || 0);
                      const rate = decided > 0 ? Math.round(((org.won || 0) / decided) * 100) : 0;
                      return (
                        <tr key={org.organisation_id} className="hover:bg-[#F8FAFC]">
                          <td className="p-2.5 font-bold text-[#14213D]">{org.organisation_name}</td>
                          <td className="p-2.5 text-[#4A5568]">{org.sector || 'Defence'}</td>
                          <td className="p-2.5 text-[#4A5568]">{org.state ? `${org.city ? `${org.city}, ` : ''}${org.state}` : 'National'}</td>
                          <td className="p-2.5 text-center font-bold text-[#0F5E63]">{org.total}</td>
                          <td className="p-2.5 text-center font-semibold text-[#0F5E63]">{org.pq_count || 0}</td>
                          <td className="p-2.5 text-center font-semibold text-gray-700">{org.general_mha_count || 0}</td>
                          <td className="p-2.5 text-center text-amber-700 font-semibold">{org.in_preparation || 0}</td>
                          <td className="p-2.5 text-center text-blue-700 font-semibold">{org.submitted || 0}</td>
                          <td className="p-2.5 text-center text-emerald-700 font-bold">{org.won || 0}</td>
                          <td className="p-2.5 text-center text-rose-600 font-semibold">{org.lost || 0}</td>
                          <td className="p-2.5 text-right font-black text-emerald-700">
                            {decided > 0 ? `${rate}%` : 'N/A'}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Section 3: Salesperson Performance Report */}
          <div className="bg-white rounded-xl border border-[#DCD8CE] p-4 shadow-2xs space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-sm font-bold text-[#14213D] flex items-center gap-1.5">
                  <UserCheck className="h-4 w-4 text-[#0F5E63]" />
                  <span>Salesperson Bid Handling & Conversion Scorecard (§21, §27)</span>
                </h4>
                <p className="text-xs text-[#4A5568]">Individual bid handling, throughput, PQ count, and conversion metrics</p>
              </div>
              <Badge variant="info" size="sm">{salespersonReport.length} Executives</Badge>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-[#FBFAF7] border-b border-[#DCD8CE] text-[#4A5568] font-semibold">
                    <th className="p-2.5">Executive</th>
                    <th className="p-2.5">Role</th>
                    <th className="p-2.5 text-center">Assigned Tenders</th>
                    <th className="p-2.5 text-center">PQ Bids</th>
                    <th className="p-2.5 text-center">General / MHA</th>
                    <th className="p-2.5 text-center">In Preparation</th>
                    <th className="p-2.5 text-center">Bids Submitted</th>
                    <th className="p-2.5 text-center">Won Awards</th>
                    <th className="p-2.5 text-center">Lost</th>
                    <th className="p-2.5 text-right">Personal Win Rate</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#ECE9E2]">
                  {salespersonReport.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="p-4 text-center text-xs text-[#4A5568]">
                        No salesperson metrics recorded yet.
                      </td>
                    </tr>
                  ) : (
                    salespersonReport.map((s) => {
                      const dec = (s.won || 0) + (s.lost || 0);
                      const rate = dec > 0 ? Math.round(((s.won || 0) / dec) * 100) : 0;
                      return (
                        <tr key={s.user_id} className="hover:bg-[#F8FAFC]">
                          <td className="p-2.5 font-bold text-[#14213D]">{s.salesperson_name}</td>
                          <td className="p-2.5 text-[#4A5568] capitalize">{s.role?.replace(/_/g, ' ')}</td>
                          <td className="p-2.5 text-center font-bold text-[#0F5E63]">{s.total || s.total_tenders || 0}</td>
                          <td className="p-2.5 text-center font-semibold text-[#0F5E63]">{s.pq_count || 0}</td>
                          <td className="p-2.5 text-center font-semibold text-gray-700">{s.general_mha_count || 0}</td>
                          <td className="p-2.5 text-center text-amber-700 font-semibold">{s.pending || s.pending_tenders || 0}</td>
                          <td className="p-2.5 text-center text-blue-700 font-semibold">{s.submitted || s.submitted_tenders || 0}</td>
                          <td className="p-2.5 text-center text-emerald-700 font-bold">{s.won || s.won_tenders || 0}</td>
                          <td className="p-2.5 text-center text-rose-600 font-semibold">{s.lost || s.lost_tenders || 0}</td>
                          <td className="p-2.5 text-right font-black text-emerald-700">
                            {dec > 0 ? `${rate}%` : 'N/A'}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Section 4: Structured Win / Loss Post-Mortem Intelligence HUD (§26) */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-sm font-bold text-[#14213D] flex items-center gap-1.5">
                  <Award className="h-4 w-4 text-[#0F5E63]" />
                  <span>Tender Win / Loss Post-Mortem Intelligence (§26)</span>
                </h4>
                <p className="text-xs text-[#4A5568]">
                  Comprehensive analysis of won orders (product, region, responsible person, value) and lost bids (root-cause factors, competitor advantages)
                </p>
              </div>
              <Badge variant="cyber" size="sm">
                Decided: {(winLossReport.won || 0) + (winLossReport.lost || 0)} Bids
              </Badge>
            </div>

            {/* Won Tenders Intelligence Grid */}
            <div className="bg-white rounded-xl border border-emerald-200 p-4 shadow-2xs space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                  <h4 className="text-sm font-bold text-emerald-950">
                    Won Contracts Intelligence (§26 Product, Region, Person, Value Breakdown)
                  </h4>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="success" size="sm">
                    {winLossReport.won || 0} Tenders Won
                  </Badge>
                  {winLossReport.total_won_value_lakh ? (
                    <Badge variant="cyber" size="sm">
                      ₹{winLossReport.total_won_value_lakh} Lakh Total Won
                    </Badge>
                  ) : null}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
                {/* Won By Product */}
                <div className="p-3 rounded-lg bg-[#FBFAF7] border border-[#DCD8CE] space-y-2">
                  <span className="text-[11px] font-bold text-[#0F5E63] uppercase tracking-wider block">
                    Won by Product
                  </span>
                  {Object.keys(winLossReport.won_by_product || {}).length === 0 ? (
                    <p className="text-xs text-[#4A5568]">No product award breakdown yet.</p>
                  ) : (
                    Object.entries(winLossReport.won_by_product || {}).map(([prod, data]: [string, any]) => (
                      <div key={prod} className="flex items-center justify-between text-xs py-1 border-b border-[#ECE9E2] last:border-none">
                        <span className="font-medium text-[#14213D] truncate max-w-[150px]">{prod}</span>
                        <div className="text-right">
                          <span className="font-bold text-emerald-700">{data.count} Won</span>
                          {data.value_lakh > 0 && (
                            <span className="text-[10px] text-[#4A5568] block">₹{data.value_lakh}L</span>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>

                {/* Won By Region */}
                <div className="p-3 rounded-lg bg-[#FBFAF7] border border-[#DCD8CE] space-y-2">
                  <span className="text-[11px] font-bold text-[#0F5E63] uppercase tracking-wider block">
                    Won by Region
                  </span>
                  {Object.keys(winLossReport.won_by_region || {}).length === 0 ? (
                    <p className="text-xs text-[#4A5568]">No regional awards logged yet.</p>
                  ) : (
                    Object.entries(winLossReport.won_by_region || {}).map(([reg, data]: [string, any]) => (
                      <div key={reg} className="flex items-center justify-between text-xs py-1 border-b border-[#ECE9E2] last:border-none">
                        <span className="font-medium text-[#14213D]">{reg}</span>
                        <div className="text-right">
                          <span className="font-bold text-emerald-700">{data.count} Won</span>
                          {data.value_lakh > 0 && (
                            <span className="text-[10px] text-[#4A5568] block">₹{data.value_lakh}L</span>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>

                {/* Won By Salesperson / Tender Owner */}
                <div className="p-3 rounded-lg bg-[#FBFAF7] border border-[#DCD8CE] space-y-2">
                  <span className="text-[11px] font-bold text-[#0F5E63] uppercase tracking-wider block">
                    Top Winning Executives
                  </span>
                  {Object.keys(winLossReport.won_by_person || {}).length === 0 ? (
                    <p className="text-xs text-[#4A5568]">No salesperson award ledger yet.</p>
                  ) : (
                    Object.entries(winLossReport.won_by_person || {}).map(([person, data]: [string, any]) => (
                      <div key={person} className="flex items-center justify-between text-xs py-1 border-b border-[#ECE9E2] last:border-none">
                        <span className="font-medium text-[#14213D] truncate max-w-[140px]">{person}</span>
                        <div className="text-right">
                          <span className="font-bold text-emerald-700">{data.count} Won</span>
                          {data.value_lakh > 0 && (
                            <span className="text-[10px] text-[#4A5568] block">₹{data.value_lakh}L</span>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* Lost Tenders & Root-Cause Factors Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Primary Loss Cause Breakdown */}
              <div className="bg-white rounded-xl border border-[#DCD8CE] p-4 shadow-2xs space-y-3">
                <h4 className="text-sm font-bold text-[#14213D] flex items-center gap-1.5">
                  <XCircle className="h-4 w-4 text-rose-600" />
                  <span>Primary Loss Cause Breakdown (§26 Post-Mortem)</span>
                </h4>
                <p className="text-xs text-[#4A5568]">Structured primary loss categories on lost bids</p>

                <div className="space-y-2 pt-1">
                  {Object.keys(winLossReport.loss_reasons || {}).length === 0 ? (
                    <div className="p-4 rounded-lg bg-[#FBFAF7] text-center text-xs text-[#4A5568]">
                      No lost tender post-mortems logged yet.
                    </div>
                  ) : (
                    Object.entries(winLossReport.loss_reasons || {}).map(([reason, count]) => {
                      const totalLost = winLossReport.lost || 1;
                      const pct = Math.round(((count as number) / totalLost) * 100);
                      return (
                        <div key={reason} className="p-2.5 rounded-lg bg-[#FBFAF7] border border-[#DCD8CE] flex items-center justify-between">
                          <div>
                            <span className="font-semibold text-xs text-[#14213D] uppercase tracking-wide">
                              {reason.replace(/_/g, ' ')}
                            </span>
                            <span className="text-[10px] text-[#4A5568] block">
                              {reason === 'pricing' || reason === 'price' ? 'Competitor lower quoted L1 / margin limitation' : reason === 'technical' ? 'QR deviation or proving ground performance gap' : reason === 'eligibility' ? 'Turnover or prior tender experience shortfall' : reason === 'documentation' ? 'OEM Authorization or technical annexure omission' : 'Commercial / procurement board decision'}
                            </span>
                          </div>
                          <div className="text-right">
                            <span className="text-sm font-black text-rose-600">{count as number}</span>
                            <span className="text-[10px] text-[#4A5568] block">{pct}% of losses</span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Winning Competitor Leaderboard */}
              <div className="bg-white rounded-xl border border-[#DCD8CE] p-4 shadow-2xs space-y-3">
                <h4 className="text-sm font-bold text-[#14213D] flex items-center gap-1.5">
                  <Briefcase className="h-4 w-4 text-[#0F5E63]" />
                  <span>Competitor Win Intelligence (§26)</span>
                </h4>
                <p className="text-xs text-[#4A5568]">Winning competitors recorded during commercial bid evaluations</p>

                <div className="space-y-2 pt-1">
                  {Object.keys(winLossReport.competitors || {}).length === 0 ? (
                    <div className="p-4 rounded-lg bg-[#FBFAF7] text-center text-xs text-[#4A5568]">
                      No competitor awards recorded in system yet.
                    </div>
                  ) : (
                    Object.entries(winLossReport.competitors || {}).map(([comp, count]) => (
                      <div key={comp} className="p-2.5 rounded-lg bg-[#FBFAF7] border border-[#DCD8CE] flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Building className="h-4 w-4 text-[#0F5E63]" />
                          <span className="font-bold text-xs text-[#14213D]">{comp}</span>
                        </div>
                        <Badge variant="danger" size="sm">{count as number} Awards</Badge>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 3: DEADLINE & ESCALATIONS COMMAND (§24) */}
      {/* ========================================================================= */}
      {activeTab === 'deadlines' && (
        <div className="space-y-6 animate-in fade-in duration-150">
          <SectionHeader
            title="Tender Deadline & Urgency Command Center (§24)"
            description="Active countdown alerts, pending internal signoffs, incomplete preparations, and post-submission result follow-ups"
          />

          {/* Group 1: Urgent (≤ 48 Hours) */}
          <div className="bg-white rounded-[14px] border border-[#DCD8CE] border-l-4 border-l-[#9A3412] p-4 shadow-2xs space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-[#9A3412]" />
                <h4 className="text-sm font-bold text-[#9A3412]">
                  Imminent Closing Deadlines (≤ 48 Hours)
                </h4>
              </div>
              <Badge variant="urgent" size="sm">
                {categorizedDeadlines.urgent.length} Critical Tenders
              </Badge>
            </div>

            {categorizedDeadlines.urgent.length === 0 ? (
              <div className="p-4 rounded-lg bg-[#FBFAF7] border border-dashed border-[#DCD8CE] text-xs text-[#4A5568] text-center">
                Zero tenders closing within the next 48 hours.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {categorizedDeadlines.urgent.map((t) => (
                  <div key={t.id} className="p-3.5 rounded-xl border border-amber-300 bg-[#FBEBDD]/40 flex items-start justify-between">
                    <div>
                      <div className="font-bold text-xs text-[#14213D] flex items-center gap-1.5 font-mono">
                        <span>{t.tender_number || t.tender_no}</span>
                        <Badge variant="urgent" size="sm">CLOSING SOON</Badge>
                      </div>
                      <p className="text-[11px] text-[#4A5568] mt-1 font-medium">{t.department}</p>
                      <p className="text-[10px] text-[#4A5568] mt-0.5">Deadline: {new Date(t.submission_deadline || t.bid_closing_date).toLocaleString('en-IN')}</p>
                      <p className="text-[10px] text-[#0F5E63] font-semibold mt-1">Owner: {t.owner_name || t.assigned_person_name || 'Unassigned'}</p>
                    </div>
                    <Button size="xs" variant="primary" onClick={() => openTenderDetails(t)}>
                      Inspect & Act
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Group 2: Upcoming Submissions (Next 3 to 7 Days) (§24) */}
          <div className="bg-white rounded-[14px] border border-[#DCD8CE] p-4 shadow-2xs space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Calendar className="h-5 w-5 text-[#0F5E63]" />
                <h4 className="text-sm font-bold text-[#14213D]">
                  Upcoming Submissions (Next 3 to 7 Days)
                </h4>
              </div>
              <Badge variant="outline" size="sm">
                {categorizedDeadlines.upcoming.length} Upcoming
              </Badge>
            </div>

            {categorizedDeadlines.upcoming.length === 0 ? (
              <div className="p-4 rounded-lg bg-[#FBFAF7] border border-dashed border-[#DCD8CE] text-xs text-[#4A5568] text-center">
                Zero submissions scheduled between 3 to 7 days.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {categorizedDeadlines.upcoming.map((t) => (
                  <div key={t.id} className="p-3.5 rounded-xl border border-[#DCD8CE] bg-white flex flex-col justify-between hover:border-[#0F5E63] transition-all">
                    <div>
                      <div className="font-bold text-xs text-[#14213D] flex items-center justify-between font-mono">
                        <span className="truncate">{t.tender_number || t.tender_no}</span>
                        <Badge variant="outline" size="sm">{t.tender_category || t.category || 'Tender'}</Badge>
                      </div>
                      <p className="text-[11px] text-[#4A5568] mt-1 font-medium truncate">{t.department}</p>
                      <p className="text-[10px] text-[#4A5568] mt-0.5">
                        Closing: {new Date(t.submission_deadline || t.bid_closing_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </p>
                      <p className="text-[10px] text-[#0F5E63] font-semibold mt-0.5">
                        Owner: {t.owner_name || t.assigned_person_name || 'Assigned Team'}
                      </p>
                    </div>
                    <div className="pt-2 flex items-center justify-end gap-1.5 border-t border-[#ECE9E2] mt-2">
                      <Button size="xs" variant="secondary" onClick={() => openTenderDetails(t)}>
                        Inspect & Draft
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Group 3: Pending Internal Approvals (§24) */}
          <div className="bg-white rounded-[14px] border border-[#DCD8CE] p-4 shadow-2xs space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-[#0F5E63]" />
                <h4 className="text-sm font-bold text-[#14213D]">
                  Pending Internal Approvals Awaiting Dual-Control Signoff
                </h4>
              </div>
              <Badge variant="warning" size="sm">
                {categorizedDeadlines.awaitingSignoff.length} Pending
              </Badge>
            </div>

            {categorizedDeadlines.awaitingSignoff.length === 0 ? (
              <div className="p-4 rounded-lg bg-[#FBFAF7] border border-dashed border-[#DCD8CE] text-xs text-[#4A5568] text-center">
                All participation requests have been reviewed and approved.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {categorizedDeadlines.awaitingSignoff.map((t) => (
                  <div key={t.id} className="p-3.5 rounded-xl border border-[#DCD8CE] bg-white flex items-start justify-between">
                    <div>
                      <span className="font-bold text-xs text-[#14213D] block font-mono">{t.tender_number || t.tender_no}</span>
                      <p className="text-[11px] text-[#4A5568] mt-0.5">{t.department}</p>
                      <p className="text-[10px] text-[#9A3412] font-semibold mt-1">Status: Awaiting Management Decision</p>
                    </div>
                    {hasRole(['management', 'admin']) ? (
                      <Button
                        size="xs"
                        variant="primary"
                        onClick={() => openTenderDetails(t)}
                      >
                        Review as Management
                      </Button>
                    ) : (
                      <Badge variant="warning" size="sm">
                        Awaiting Mgmt Review
                      </Badge>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 4: EXTERNAL PORTAL ISSUES HUB (§25) */}
      {/* ========================================================================= */}
      {activeTab === 'portal_issues' && (
        <div className="space-y-6 animate-in fade-in duration-150">
          <SectionHeader
            title="GeM & External Portal Issues Hub (§25)"
            description="Tracking external portal glitches with escalation and resolution governance. Note: BOS records the issue only; portal functionality is outside BOS scope."
            actions={
              <Button
                size="sm"
                variant="primary"
                onClick={() => openNewIssueModal()}
                leftIcon={<Plus className="h-4 w-4" />}
              >
                Log Portal Issue
              </Button>
            }
          />

          {/* Status Metrics */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <StatCard
              label="Total Portal Issues"
              value={globalPortalIssues.length}
              subtext="Logged on GeM & CPPP"
              icon={<AlertCircle className="h-4 w-4 text-[#0F5E63]" />}
            />
            <StatCard
              label="Open Issues"
              value={globalPortalIssues.filter((i) => ['OPEN', 'open'].includes(i.resolution_status)).length}
              subtext="Unresolved technical glitches"
              icon={<AlertTriangle className="h-4 w-4 text-amber-600" />}
              valueColor="amber"
            />
            <StatCard
              label="Escalated"
              value={globalPortalIssues.filter((i) => ['ESCALATED', 'escalated'].includes(i.resolution_status)).length}
              subtext="Awaiting GeM Desk / Mgmt"
              icon={<AlertOctagon className="h-4 w-4 text-rose-600" />}
              valueColor="rose"
            />
            <StatCard
              label="Resolved / Closed"
              value={globalPortalIssues.filter((i) => ['RESOLVED', 'resolved', 'CLOSED', 'closed'].includes(i.resolution_status)).length}
              subtext="Workaround or fix applied"
              icon={<CheckCircle2 className="h-4 w-4 text-emerald-600" />}
              valueColor="emerald"
            />
          </div>

          {/* Global Portal Issues Table */}
          <div className="bg-white rounded-xl border border-[#DCD8CE] overflow-hidden shadow-2xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-[#FBFAF7] border-b border-[#DCD8CE] text-[#4A5568] font-semibold">
                    <th className="p-3.5">Issue Details</th>
                    <th className="p-3.5">Affected Tender & Buyer</th>
                    <th className="p-3.5">Portal</th>
                    <th className="p-3.5">Reported Date & Person</th>
                    <th className="p-3.5">Status</th>
                    <th className="p-3.5">Resolution Notes</th>
                    <th className="p-3.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#ECE9E2]">
                  {globalPortalIssues.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-8 text-center text-xs text-[#4A5568]">
                        <CheckCircle2 className="h-8 w-8 text-emerald-600 mx-auto mb-2" />
                        Zero external portal issues recorded. GeM & CPPP submissions operating normally.
                      </td>
                    </tr>
                  ) : (
                    globalPortalIssues.map((issue) => (
                      <tr key={issue.id} className="hover:bg-[#F8FAFC]">
                        <td className="p-3.5 max-w-[280px]">
                          <span className="font-bold text-xs text-[#14213D] block">{issue.issue}</span>
                          {issue.escalated_to && (
                            <span className="text-[10px] text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200 mt-1 inline-block">
                              Escalated to: {issue.escalated_to}
                            </span>
                          )}
                        </td>

                        <td className="p-3.5 whitespace-nowrap">
                          <span className="font-semibold text-xs text-[#14213D] block font-mono">{issue.tender_no || 'Tender'}</span>
                          <span className="text-[10px] text-[#4A5568] truncate block max-w-[180px]">{issue.tender_department || 'Department'}</span>
                        </td>

                        <td className="p-3.5 whitespace-nowrap">
                          <Badge variant="outline" size="sm">{issue.tender_portal || 'GeM'}</Badge>
                        </td>

                        <td className="p-3.5 whitespace-nowrap">
                          <span className="text-[#14213D] block">
                            {issue.reported_date ? new Date(issue.reported_date).toLocaleDateString('en-IN') : 'N/A'}
                          </span>
                          <span className="text-[10px] text-[#4A5568] block">
                            By {issue.reported_by_name || 'Tender Team'}
                          </span>
                        </td>

                        <td className="p-3.5 whitespace-nowrap">
                          <Badge
                            variant={
                              ['resolved', 'closed'].includes(issue.resolution_status?.toLowerCase())
                                ? 'success'
                                : ['escalated'].includes(issue.resolution_status?.toLowerCase())
                                  ? 'danger'
                                  : 'warning'
                            }
                            size="sm"
                          >
                            {issue.resolution_status?.toUpperCase()}
                          </Badge>
                        </td>

                        <td className="p-3.5 max-w-[240px]">
                          <span className="text-xs text-[#14213D] block truncate" title={issue.resolution}>
                            {issue.resolution || 'Pending resolution from portal desk.'}
                          </span>
                        </td>

                        <td className="p-3.5 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-1.5">
                            {!['resolved', 'closed'].includes(issue.resolution_status?.toLowerCase()) && (
                              <>
                                {!['escalated'].includes(issue.resolution_status?.toLowerCase()) && (
                                  <Button
                                    size="xs"
                                    variant="outline"
                                    onClick={() => handleUpdateIssueStatus(issue.tender_id, issue.id, 'escalated')}
                                  >
                                    Escalate
                                  </Button>
                                )}
                                <Button
                                  size="xs"
                                  variant="secondary"
                                  onClick={() => {
                                    const res = prompt('Enter resolution description:');
                                    if (res) handleUpdateIssueStatus(issue.tender_id, issue.id, 'resolved', res);
                                  }}
                                >
                                  Resolve
                                </Button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 5. Register New Tender Modal (All 15+ North Tender Sheet Fields) */}
      {/* ========================================================================= */}
      <Modal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        title="Register New Tender Opportunity"
        description="Add a tender requirement to the centralized operational pipeline with transactional event publishing."
        maxWidth="2xl"
      >
        <form onSubmit={handleCreateSubmit} className="space-y-4">
          {actionError && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
              {actionError}
            </div>
          )}

          {/* Section 1: Identification & Classification (§19, §20) */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <Input
              label="Tender / GeM Bid No."
              required
              value={newTender.tender_no}
              onChange={(e) => setNewTender({ ...newTender, tender_no: e.target.value })}
              placeholder="e.g. GEM/2026/B/88219"
            />
            <Select
              label="Tender Portal"
              value={newTender.portal}
              onChange={(e) => setNewTender({ ...newTender, portal: e.target.value })}
              options={[
                { value: 'GeM', label: 'Government e-Marketplace (GeM)' },
                { value: 'CPPP', label: 'Central Public Procurement Portal (CPPP)' },
                { value: 'State Portal', label: 'State Procurement Portal' },
                { value: 'Direct / Manual', label: 'Direct Ministry RFP' },
              ]}
            />
            <Select
              label="Classification (§20)"
              value={newTender.category}
              onChange={(e) => setNewTender({ ...newTender, category: e.target.value })}
              options={[
                { value: 'general_mha', label: 'General / MHA Tender' },
                { value: 'pq', label: 'Pre-Qualification (PQ)' },
                { value: 'other', label: 'Other Configured Tender' },
              ]}
            />
            <Select
              label="Current Stage (§19)"
              value={newTender.current_stage}
              onChange={(e) => setNewTender({ ...newTender, current_stage: e.target.value })}
              options={[
                { value: 'identified', label: '1. Tender Identified' },
                { value: 'awaiting_approval', label: '2. Submitted for Review' },
                { value: 'under_preparation', label: '4. Tender Preparation' },
              ]}
            />
          </div>

          {/* Section 2: Buyer & Organisation */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Select
              label="Mapped Organisation"
              required
              value={newTender.organisation_id}
              onChange={(e) => handleOrgChange(e.target.value)}
            >
              <option value="">-- Select Organisation --</option>
              {organisations.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name}
                </option>
              ))}
            </Select>
            <Input
              label="Buyer Department / Ministry"
              required
              value={newTender.department}
              onChange={(e) => setNewTender({ ...newTender, department: e.target.value })}
              placeholder="e.g. Directorate General Border Security Force (BSF)"
            />
          </div>

          {/* Section 3: Geographic Coordinates (§21 Zone & Region Structure) */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <Select
              label="Territory Zone (§21)"
              value={newTender.zone}
              onChange={(e) => handleZoneChange(e.target.value)}
              options={
                zonesMaster.length > 0
                  ? zonesMaster.map((z) => ({ value: z.name, label: `${z.name} Zone (${z.code})` }))
                  : [
                    { value: 'North', label: 'North Zone (N)' },
                    { value: 'North East', label: 'North East Zone (NE)' },
                    { value: 'South', label: 'South Zone (S)' },
                    { value: 'East', label: 'East Zone (E)' },
                    { value: 'West', label: 'West Zone (W)' },
                  ]
              }
            />
            <Select
              label="Territory Region (§21)"
              value={newTender.region}
              onChange={(e) => handleRegionChange(e.target.value)}
              options={
                availableRegions.length > 0
                  ? availableRegions.map((r) => ({ value: r.name, label: r.name }))
                  : [
                    { value: 'Delhi NCR', label: 'Delhi NCR' },
                    { value: 'Punjab & Chandigarh', label: 'Punjab & Chandigarh' },
                    { value: 'Haryana', label: 'Haryana' },
                    { value: 'Rajasthan', label: 'Rajasthan' },
                    { value: 'Uttar Pradesh', label: 'Uttar Pradesh' },
                    { value: 'Jammu & Kashmir', label: 'Jammu & Kashmir' },
                  ]
              }
            />
            <Input
              label="City"
              required
              value={newTender.city}
              onChange={(e) => setNewTender({ ...newTender, city: e.target.value })}
              placeholder="e.g. New Delhi"
            />
            <Input
              label="State"
              required
              value={newTender.state}
              onChange={(e) => setNewTender({ ...newTender, state: e.target.value })}
              placeholder="e.g. Delhi"
            />
          </div>

          {/* Section 4: Product & Requirement Details */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Select
              label="Product / Equipment Suite"
              value={newTender.product_id}
              onChange={(e) => setNewTender({ ...newTender, product_id: e.target.value })}
            >
              <option value="">-- Select Product / System --</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.category || 'Security/Defence'})
                </option>
              ))}
            </Select>

            <Input
              label="Est. Value (₹ Lakh)"
              type="number"
              step="0.01"
              value={newTender.estimated_value_lakh}
              onChange={(e) => setNewTender({ ...newTender, estimated_value_lakh: e.target.value })}
              placeholder="e.g. 150.00"
            />
          </div>

          <Textarea
            label="Product Requirement & Scope"
            required
            rows={2}
            value={newTender.requirement_text}
            onChange={(e) => setNewTender({ ...newTender, requirement_text: e.target.value })}
            placeholder="e.g. Passive Night Vision Monoculars as per MHA Qualitative Requirements with Belgian Photonis Tubes"
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              label="Quantity"
              type="number"
              min="1"
              value={newTender.quantity}
              onChange={(e) => setNewTender({ ...newTender, quantity: Number(e.target.value) })}
            />
            <Input
              label="EMD Fee (₹)"
              type="number"
              min="0"
              value={newTender.emd_fee}
              onChange={(e) => setNewTender({ ...newTender, emd_fee: Number(e.target.value) })}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              label="Publication Date"
              type="date"
              required
              value={newTender.publication_date}
              onChange={(e) => setNewTender({ ...newTender, publication_date: e.target.value })}
            />
            <Input
              label="Submission Deadline"
              type="date"
              required
              value={newTender.submission_deadline}
              onChange={(e) => setNewTender({ ...newTender, submission_deadline: e.target.value })}
            />
          </div>

          {/* Section 5: Team Ownership */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Select
              label="Assigned Salesperson"
              placeholder="-- Select Assigned Salesperson --"
              helperText="Ground executive managing client meetings, QRs, trials & depot demos."
              value={newTender.assigned_person_id}
              onChange={(e) => setNewTender({ ...newTender, assigned_person_id: e.target.value })}
            >
              <option value="">-- Unassigned (None) --</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.full_name} ({u.role?.replace(/_/g, ' ')})
                </option>
              ))}
            </Select>

            <Select
              label="Tender Owner (Responsible Executive)"
              placeholder="-- Default (Same as Assigned) --"
              helperText="Accountable executive for bid review, approvals & GeM submission."
              value={newTender.tender_owner_id}
              onChange={(e) => setNewTender({ ...newTender, tender_owner_id: e.target.value })}
            >
              <option value="">-- Same as Assigned Person --</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.full_name} ({u.role?.replace(/_/g, ' ')})
                </option>
              ))}
            </Select>
          </div>

          <Input
            label="Internal Notes / Remarks"
            value={newTender.remarks}
            onChange={(e) => setNewTender({ ...newTender, remarks: e.target.value })}
            placeholder="e.g. Requires Belgian OEM authorization. Ensure 2% margin threshold."
          />

          <div className="pt-2 flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setIsCreateOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" isLoading={isSubmitting}>
              Register Tender
            </Button>
          </div>
        </form>
      </Modal>

      {/* ========================================================================= */}
      {/* 6. Dual-Control Approval Modal */}
      {/* ========================================================================= */}
      <Modal
        isOpen={isApproveOpen}
        onClose={() => setIsApproveOpen(false)}
        title="Commit Executive Endorsement"
        description={`Decision for ${selectedTender?.tender_number || selectedTender?.tender_no}`}
        maxWidth="md"
      >
        <form onSubmit={handleApproveSubmit} className="space-y-4">
          {actionError && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
              {actionError}
            </div>
          )}

          <Select
            label="Decision"
            value={approvalDecision}
            onChange={(e) => setApprovalDecision(e.target.value as any)}
            options={[
              { value: 'approved', label: 'Approve Participation & Mobilize Preparation' },
              { value: 'rejected', label: 'Decline / Reject Opportunity Internally' },
            ]}
          />

          {approvalDecision === 'rejected' && (
            <Select
              label="Rejection Justification"
              required
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
          )}

          <Input
            label="Directives / Remarks"
            value={approvalRemarks}
            onChange={(e) => setApprovalRemarks(e.target.value)}
            placeholder="e.g. Approved with Belgian OEM authorization. Ensure 2% margin."
            required
          />

          <div className="pt-2 flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setIsApproveOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" isLoading={isSubmitting}>
              Commit Endorsement
            </Button>
          </div>
        </form>
      </Modal>

      {/* ========================================================================= */}
      {/* 7. Stage Transition Modal */}
      {/* ========================================================================= */}
      <Modal
        isOpen={isTransitionOpen}
        onClose={() => setIsTransitionOpen(false)}
        title="Advance Tender Lifecycle Stage"
        description={`Transition from ${selectedTender?.status} to ${targetTransitionStatus}`}
        maxWidth="md"
      >
        <form onSubmit={handleTransitionSubmit} className="space-y-4">
          {actionError && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
              {actionError}
            </div>
          )}

          {targetTransitionStatus === 'submitted' && (
            <Input
              label="Portal Submission Date"
              type="date"
              required
              value={transitionSubmissionDate}
              onChange={(e) => setTransitionSubmissionDate(e.target.value)}
            />
          )}

          <Input
            label="Transition Notes / Remarks"
            value={transitionRemarks}
            onChange={(e) => setTransitionRemarks(e.target.value)}
            placeholder="e.g. Technical documents successfully submitted on GeM portal."
            required
          />

          <div className="pt-2 flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setIsTransitionOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" isLoading={isSubmitting}>
              Confirm Stage Advancement
            </Button>
          </div>
        </form>
      </Modal>

      {/* ========================================================================= */}
      {/* 8. Final Structured Outcome (Won / Lost) Modal (§26) */}
      {/* ========================================================================= */}
      <Modal
        isOpen={isOutcomeOpen}
        onClose={() => setIsOutcomeOpen(false)}
        title="Record Final Commercial Verdict (§26 Win/Loss Post-Mortem)"
        description="Capture deep post-bid intelligence for win rate calculation and loss pattern root cause analysis."
        maxWidth="lg"
      >
        <form onSubmit={handleOutcomeSubmit} className="space-y-4">
          {actionError && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
              {actionError}
            </div>
          )}

          <Select
            label="Final Result"
            value={outcomeResult}
            onChange={(e) => setOutcomeResult(e.target.value as any)}
            options={[
              { value: 'won', label: 'WON - Order Awarded to Arihant (Ranked L1)' },
              { value: 'lost', label: 'LOST - Awarded to Competitor or Disqualified' },
            ]}
          />

          <Input
            label="Result Declaration Date"
            type="date"
            required
            value={outcomeResultDate}
            onChange={(e) => setOutcomeResultDate(e.target.value)}
          />

          {outcomeResult === 'won' ? (
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Select
                  label="Awarded Product (§26)"
                  value={outcomeProductId}
                  onChange={(e) => setOutcomeProductId(e.target.value)}
                  options={[
                    { value: '', label: 'Select or retain assigned product...' },
                    ...products.map((p) => ({ value: p.id, label: p.name })),
                  ]}
                />

                <Select
                  label="Tender Category (§26)"
                  value={outcomeCategory}
                  onChange={(e) => setOutcomeCategory(e.target.value)}
                  options={[
                    { value: 'pq', label: 'PQ - Pre-Qualification' },
                    { value: 'general_mha', label: 'General / MHA' },
                    { value: 'other', label: 'Other Opportunity' },
                  ]}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Select
                  label="Award Region (§26)"
                  value={outcomeRegionId}
                  onChange={(e) => setOutcomeRegionId(e.target.value)}
                  options={[
                    { value: '', label: 'Select region...' },
                    ...regionsMaster.map((r) => ({ value: r.id, label: `${r.name} (${r.zone_name || 'Zone'})` })),
                  ]}
                />

                <Select
                  label="Responsible Executive (§26)"
                  value={outcomeResponsiblePersonId}
                  onChange={(e) => setOutcomeResponsiblePersonId(e.target.value)}
                  options={[
                    { value: '', label: 'Select responsible person...' },
                    ...users.map((u) => ({ value: u.id, label: `${u.full_name} (${u.role})` })),
                  ]}
                />
              </div>

              <Input
                label="Final Contract Award Value (₹ Lakh)"
                type="number"
                step="0.01"
                value={outcomeValueLakh}
                onChange={(e) => setOutcomeValueLakh(e.target.value)}
                placeholder="e.g. 145.50"
              />
            </div>
          ) : (
            <div className="space-y-3">
              <Select
                label="Primary Structured Loss Reason (§26)"
                required
                value={outcomeLossReason}
                onChange={(e) => setOutcomeLossReason(e.target.value)}
                options={[
                  { value: 'price', label: 'Price (Competitor underquoted L1)' },
                  { value: 'competitor', label: 'Competitor advantage / preference' },
                  { value: 'technical', label: 'Technical rejection / QR non-compliance' },
                  { value: 'eligibility', label: 'Eligibility / Past experience shortfall' },
                  { value: 'documentation', label: 'Documentation / Tender error / missed certificate' },
                  { value: 'customer_decision', label: 'Customer cancellation / retender' },
                  { value: 'other', label: 'Other reason' },
                ]}
              />

              <Input
                label="Winning Competitor Name (if known)"
                value={outcomeCompetitor}
                onChange={(e) => setOutcomeCompetitor(e.target.value)}
                placeholder="e.g. Falcon Security / BEL / MKU / Zicom"
              />

              <div className="p-3 bg-[#FBFAF7] rounded-lg border border-[#DCD8CE] space-y-2">
                <span className="text-[11px] font-bold text-[#0F5E63] uppercase tracking-wider block">
                  Root Cause Factors (§26 Detailed Post-Mortem)
                </span>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <Input
                    label="Technical Issue (if applicable)"
                    value={outcomeTechnicalIssue}
                    onChange={(e) => setOutcomeTechnicalIssue(e.target.value)}
                    placeholder="e.g. Lab trial QR shortfall"
                  />

                  <Input
                    label="Pricing Issue / L1 Gap (if applicable)"
                    value={outcomePricingIssue}
                    onChange={(e) => setOutcomePricingIssue(e.target.value)}
                    placeholder="e.g. Quoted ₹14.2L vs L1 ₹13.8L"
                  />

                  <Input
                    label="Eligibility Shortfall (if applicable)"
                    value={outcomeEligibilityIssue}
                    onChange={(e) => setOutcomeEligibilityIssue(e.target.value)}
                    placeholder="e.g. 3-yr turnover criteria"
                  />

                  <Input
                    label="Documentation Issue (if applicable)"
                    value={outcomeDocumentationIssue}
                    onChange={(e) => setOutcomeDocumentationIssue(e.target.value)}
                    placeholder="e.g. Missing OEM authorization"
                  />
                </div>

                <Input
                  label="Other Reason Notes (if applicable)"
                  value={outcomeOtherReason}
                  onChange={(e) => setOutcomeOtherReason(e.target.value)}
                  placeholder="e.g. Buyer canceled tender due to budget re-allocation"
                />
              </div>
            </div>
          )}

          <Input
            label="Outcome Intelligence Remarks"
            value={outcomeRemarks}
            onChange={(e) => setOutcomeRemarks(e.target.value)}
            placeholder="e.g. Debrief completed with DIG communication officer."
            required
          />

          <div className="pt-2 flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setIsOutcomeOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" isLoading={isSubmitting}>
              Save Commercial Verdict
            </Button>
          </div>
        </form>
      </Modal>

      {/* ========================================================================= */}
      {/* 9. Log External Portal Issue Modal (§25) */}
      {/* ========================================================================= */}
      <Modal
        isOpen={isNewIssueOpen}
        onClose={() => setIsNewIssueOpen(false)}
        title="Report GeM / External Portal Issue (§25)"
        description="Document an internal issue with the external tender portal for escalation and resolution tracking."
        maxWidth="md"
      >
        <form onSubmit={handleCreateIssue} className="space-y-4">
          <div className="p-3 rounded-xl bg-[#FBFAF7] border border-[#DCD8CE] text-xs text-[#4A5568] flex items-start gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 text-[#9A3412] mt-0.5" />
            <span><strong>Notice:</strong> BOS records the issue only; portal functionality is outside BOS scope.</span>
          </div>
          {actionError && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
              {actionError}
            </div>
          )}

          {!selectedTender && (
            <Select
              label="Affected Tender (§25)"
              required
              value={issueTenderId}
              onChange={(e) => setIssueTenderId(e.target.value)}
              options={tenders.map((t) => ({
                value: t.id,
                label: `${t.tender_number || t.tender_no} - ${t.department || t.organisation_name || 'Tender'}`,
              }))}
            />
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              label="Date of Incident / Report (§25)"
              type="date"
              required
              value={issueReportedDate}
              onChange={(e) => setIssueReportedDate(e.target.value)}
            />

            <Select
              label="Initial Status (§25)"
              value={issueResolutionStatus}
              onChange={(e) => setIssueResolutionStatus(e.target.value)}
              options={[
                { value: 'OPEN', label: 'OPEN - Under investigation' },
                { value: 'IN_PROGRESS', label: 'IN_PROGRESS - Workaround in flight' },
                { value: 'ESCALATED', label: 'ESCALATED - Raised to GeM Desk' },
              ]}
            />
          </div>

          <Textarea
            label="Issue Description (§25)"
            required
            rows={3}
            value={newIssueText}
            onChange={(e) => setNewIssueText(e.target.value)}
            placeholder="e.g. Required equipment category does not appear on GeM portal dropdown."
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Select
              label="Responsible Person (§25)"
              value={issueResponsiblePerson}
              onChange={(e) => setIssueResponsiblePerson(e.target.value)}
              options={[
                { value: '', label: 'Select responsible person...' },
                ...users.map((u) => ({ value: u.id, label: `${u.full_name} (${u.role})` })),
              ]}
            />

            <Input
              label="Escalation Target (§25)"
              value={issueEscalatedTo}
              onChange={(e) => setIssueEscalatedTo(e.target.value)}
              placeholder="e.g. Executive Management & GeM Desk Ticket #88412"
            />
          </div>

          <div className="pt-2 flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setIsNewIssueOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" isLoading={isSubmitting}>
              Log Issue
            </Button>
          </div>
        </form>
      </Modal>

      {/* ========================================================================= */}
      {/* 10. Enterprise 11-Tab Tender Dossier Modal (Operational Blueprint) */}
      {/* ========================================================================= */}
      <TenderDossierModal
        isOpen={isDossierOpen}
        onClose={() => {
          setIsDossierOpen(false);
          setDossierTenderId(null);
        }}
        tenderId={dossierTenderId}
        currentUser={user}
        users={users}
        onTenderUpdated={() => {
          fetchTenders(true);
          fetchDashboardStats();
          fetchReports();
        }}
      />

      {/* ========================================================================= */}
      {/* 11. Master Configuration & Governance Modal */}
      {/* ========================================================================= */}
      <TenderSettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        currentUser={user}
      />

      {/* ========================================================================= */}
      {/* 12. Arihant Tender Sheet Bulk Import Wizard Modal */}
      {/* ========================================================================= */}
      <BulkImportWizardModal
        isOpen={isImportOpen}
        onClose={() => setIsImportOpen(false)}
        onImportComplete={() => {
          fetchTenders(true);
          fetchDashboardStats();
          fetchReports();
        }}
      />
    </PageContainer>
  );
}
