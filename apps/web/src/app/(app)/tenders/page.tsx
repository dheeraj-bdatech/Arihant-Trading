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
} from 'lucide-react';
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
  FilterBar,
  Modal,
  StatCard,
  StatGrid,
  EmptyState,
  InfoCallout,
  Tabs,
} from '@/components/ui';
import { formatINR } from '@arihant/shared';

// Lifecycle states and display labels
const STAGES = [
  { key: 'identified', label: 'Identified', color: 'default' },
  { key: 'awaiting_approval', label: 'Awaiting Approval', color: 'warning' },
  { key: 'rejected_internally', label: 'Rejected Internally', color: 'danger' },
  { key: 'under_preparation', label: 'Under Preparation', color: 'info' },
  { key: 'pq_submitted', label: 'PQ Submitted', color: 'info' },
  { key: 'pq_qualified', label: 'PQ Qualified', color: 'success' },
  { key: 'submitted', label: 'Tender Submitted', color: 'info' },
  { key: 'technical_eval', label: 'Technical Evaluation', color: 'cyber' },
  { key: 'commercial_eval', label: 'Commercial Evaluation', color: 'cyber' },
  { key: 'won', label: 'Won', color: 'success' },
  { key: 'lost', label: 'Lost', color: 'danger' },
  { key: 'cancelled', label: 'Cancelled', color: 'default' },
  { key: 'on_hold', label: 'On Hold', color: 'warning' },
] as const;

export default function TendersPage() {
  const { user, hasRole } = useAuth();
  const searchParams = useSearchParams();
  const highlightId = searchParams.get('highlight');

  // Top-Level Navigation Tabs
  const [activeTab, setActiveTab] = useState<'pipeline' | 'analytics' | 'deadlines' | 'portal_issues'>('pipeline');

  // Master lists
  const [tenders, setTenders] = useState<any[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(25);
  const [isLoading, setIsLoading] = useState(true);

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
  const [sortBy, setSortBy] = useState('created_at');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [activeHudFilter, setActiveHudFilter] = useState<string | null>(null);

  // Detail Modal & Sub-panels
  const [selectedTender, setSelectedTender] = useState<any | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [detailTab, setDetailTab] = useState<'overview' | 'approval' | 'transitions' | 'portal_issues' | 'outcome' | 'timeline'>('overview');
  const [activities, setActivities] = useState<any[]>([]);
  const [portalIssues, setPortalIssues] = useState<any[]>([]);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);

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

  // 4. Fetch Tenders List (Server-side Search & Pagination)
  const fetchTenders = useCallback(async () => {
    try {
      setIsLoading(true);
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
    }
  }, [page, limit, search, statusFilter, categoryFilter, zoneFilter, deadlineFilter, sortBy, sortOrder, highlightId]);

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
      fetchTenders();
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
  const openTenderDetails = async (
    tender: any,
    initialTab: 'overview' | 'approval' | 'transitions' | 'portal_issues' | 'outcome' | 'timeline' = 'overview'
  ) => {
    setSelectedTender(tender);
    setIsDetailOpen(true);
    setDetailTab(initialTab);
    setIsLoadingDetails(true);
    try {
      const [fullTender, actRes, issuesRes] = await Promise.all([
        api.get(`/tenders/${tender.id}`).catch(() => tender),
        api.get(`/tenders/${tender.id}/activities`).catch(() => []),
        api.get(`/tenders/${tender.id}/portal-issues`).catch(() => []),
      ]);
      setSelectedTender(fullTender);
      setActivities(Array.isArray(actRes) ? actRes : []);
      setPortalIssues(Array.isArray(issuesRes) ? issuesRes : []);
    } catch (err) {
      console.error('Failed to load tender details:', err);
    } finally {
      setIsLoadingDetails(false);
    }
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

    // Validate deadline >= pubDate
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
      await Promise.all([fetchTenders(), fetchDashboardStats()]);
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
      await openTenderDetails(selectedTender);
      await Promise.all([fetchTenders(), fetchDashboardStats(), fetchReports()]);
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
      await openTenderDetails(selectedTender);
      await Promise.all([fetchTenders(), fetchDashboardStats(), fetchReports()]);
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
      await openTenderDetails(selectedTender);
      await Promise.all([fetchTenders(), fetchDashboardStats(), fetchReports()]);
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
      if (selectedTender) {
        await openTenderDetails(selectedTender);
      }
      await Promise.all([fetchTenders(), fetchDashboardStats(), fetchReports()]);
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
      if (selectedTender && selectedTender.id === tenderId) {
        await openTenderDetails(selectedTender);
      }
      await Promise.all([fetchDashboardStats(), fetchReports()]);
    } catch (err: any) {
      console.error('Failed to update portal issue:', err);
    }
  };

  // Allowed transitions helper based on current stage
  const getAllowedTransitions = (status: string, category: string) => {
    const isPq = category?.toLowerCase().includes('pq');
    switch (status) {
      case 'identified':
        return [{ status: 'awaiting_approval', label: 'Submit for Internal Approval' }];
      case 'awaiting_approval':
        return [
          { status: 'under_preparation', label: 'Approve & Start Preparation' },
          { status: 'rejected_internally', label: 'Reject Participation' },
        ];
      case 'under_preparation':
        if (isPq) {
          return [
            { status: 'pq_submitted', label: 'Submit Pre-Qualification (PQ)' },
            { status: 'submitted', label: 'Submit Bid Directly' },
            { status: 'on_hold', label: 'Put On Hold' },
            { status: 'cancelled', label: 'Cancel Tender' },
          ];
        }
        return [
          { status: 'submitted', label: 'Submit Tender Bid' },
          { status: 'on_hold', label: 'Put On Hold' },
          { status: 'cancelled', label: 'Cancel Tender' },
        ];
      case 'pq_submitted':
        return [
          { status: 'pq_qualified', label: 'Mark PQ Qualified' },
          { status: 'lost', label: 'Mark PQ Disqualified / Lost' },
        ];
      case 'pq_qualified':
        return [
          { status: 'submitted', label: 'Submit Commercial & Technical Envelopes' },
          { status: 'under_preparation', label: 'Back to Preparation' },
        ];
      case 'submitted':
        return [
          { status: 'technical_eval', label: 'Enter Technical Evaluation' },
          { status: 'commercial_eval', label: 'Enter Commercial Evaluation' },
          { status: 'won', label: 'Mark Bid as Won' },
          { status: 'lost', label: 'Mark Bid as Lost' },
        ];
      case 'technical_eval':
        return [
          { status: 'commercial_eval', label: 'Advance to Commercial Evaluation' },
          { status: 'lost', label: 'Disqualified in Technical Evaluation' },
        ];
      case 'commercial_eval':
        return [
          { status: 'won', label: 'Declare L1 & Won' },
          { status: 'lost', label: 'Declare L2/Lost' },
        ];
      case 'on_hold':
        return [
          { status: 'under_preparation', label: 'Resume Preparation' },
          { status: 'cancelled', label: 'Cancel Tender' },
        ];
      default:
        return [];
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

  return (
    <PageContainer>
      {/* 1. Page Header */}
      <PageHeader
        title="Tender Pipeline & Bids Command"
        description="Comprehensive defence bidding pipeline, GeM/CPPP portal issue tracking, dual-control signoffs, and executive win/loss analytics."
        icon={<FileText className="h-6 w-6 text-[#0F5E63]" />}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                fetchTenders();
                fetchDashboardStats();
                fetchReports();
              }}
              leftIcon={<RefreshCw className="h-3.5 w-3.5 text-[#4A5568]" />}
            >
              <span>Refresh</span>
            </Button>
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
      <Tabs
        activeTab={activeTab}
        onChange={(tabId) => {
          setActiveTab(tabId as any);
          if (tabId !== 'pipeline') {
            fetchReports();
          }
        }}
        tabs={[
          {
            id: 'pipeline',
            label: 'Tender Pipeline & Bids',
            icon: <FileText className="h-4 w-4" />,
            count: totalCount || dashboardStats.total,
          },
          {
            id: 'analytics',
            label: 'Executive Reporting & Analytics (§27)',
            icon: <BarChart3 className="h-4 w-4" />,
            count: `${dashboardStats.win_rate !== undefined ? dashboardStats.win_rate : (dashboardStats.win_rate_percentage || 0)}% Win`,
          },
          {
            id: 'deadlines',
            label: 'Deadline & Urgency Command (§24)',
            icon: <Clock className="h-4 w-4" />,
            count: (dashboardStats.urgent_deadlines || 0) + (dashboardStats.upcoming_deadlines || 0),
            badgeVariant: (dashboardStats.urgent_deadlines || 0) > 0 ? 'urgent' : 'info',
          },
          {
            id: 'portal_issues',
            label: 'GeM & Portal Issues Hub (§25)',
            icon: <AlertTriangle className="h-4 w-4" />,
            count: dashboardStats.open_portal_issues || globalPortalIssues.length,
            badgeVariant: (dashboardStats.open_portal_issues || 0) > 0 ? 'warning' : 'default',
          },
        ]}
      />

      {/* ========================================================================= */}
      {/* TAB 1: OPERATIONAL PIPELINE & BIDS */}
      {/* ========================================================================= */}
      {activeTab === 'pipeline' && (
        <div className="space-y-6">
          {/* Executive Metrics HUD (14 Metrics + Win Rate %) */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <SectionHeader
                title="Executive Pipeline Metrics"
                description="Real-time multi-dimensional aggregation across all procurement stages"
              />
              {dashboardStats.win_rate !== undefined && (
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white border border-[#DCD8CE] shadow-2xs">
                  <TrendingUp className="h-4 w-4 text-emerald-600" />
                  <span className="text-xs font-bold text-[#4A5568]">Overall Win Rate:</span>
                  <span className="text-sm font-black text-emerald-700">
                    {Number(dashboardStats.win_rate || dashboardStats.win_rate_percentage || 0).toFixed(1)}%
                  </span>
                </div>
              )}
            </div>

            {/* Primary Row: 5 Core Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              <StatCard
                label="Total Tenders"
                value={dashboardStats.total || dashboardStats.total_tenders || 0}
                subtext="All tracked opportunities"
                icon={<FileText className="h-4 w-4 text-[#0F5E63]" />}
                className="cursor-pointer hover:border-[#0F5E63]"
                onClick={() => handleHudClick('total', '')}
              />

              <StatCard
                label="PQ Tenders (§20)"
                value={dashboardStats.pq_count || dashboardStats.pq_tenders || 0}
                subtext="Pre-qualification bids"
                icon={<Layers className="h-4 w-4 text-[#0F5E63]" />}
                valueColor="primary"
                className={`cursor-pointer ${categoryFilter === 'pq' ? 'ring-2 ring-[#0F5E63]' : ''}`}
                onClick={() => handleHudClick('pq', 'pq')}
              />

              <StatCard
                label="General / MHA (§20)"
                value={dashboardStats.general_mha_count || dashboardStats.general_mha_tenders || 0}
                subtext="Defence & Ministry bids"
                icon={<Building className="h-4 w-4 text-[#0F5E63]" />}
                className={`cursor-pointer ${categoryFilter === 'general_mha' ? 'ring-2 ring-[#0F5E63]' : ''}`}
                onClick={() => handleHudClick('general_mha', 'general_mha')}
              />

              <StatCard
                label="Under Preparation"
                value={dashboardStats.under_preparation || 0}
                subtext="In active bid drafting"
                icon={<Clock className="h-4 w-4 text-[#4A5568]" />}
                className={`cursor-pointer ${statusFilter === 'under_preparation' ? 'ring-2 ring-[#0F5E63]' : ''}`}
                onClick={() => handleHudClick('under_preparation', 'under_preparation')}
              />

              <StatCard
                label="Pending Approvals"
                value={dashboardStats.pending_approvals || 0}
                subtext="Awaiting executive signoff"
                icon={<ShieldCheck className="h-4 w-4 text-amber-600" />}
                valueColor="amber"
                badge={
                  dashboardStats.pending_approvals > 0 ? (
                    <span className="flex h-2 w-2 relative">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
                    </span>
                  ) : null
                }
                className={`cursor-pointer ${statusFilter === 'awaiting_approval' ? 'ring-2 ring-amber-500' : ''}`}
                onClick={() => handleHudClick('awaiting_approval', 'awaiting_approval')}
              />
            </div>

            {/* Secondary Row: Submissions, Results & Deadlines */}
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
              <StatCard
                label="Submitted Bids"
                value={dashboardStats.submitted || dashboardStats.tenders_submitted || 0}
                subtext="Awaiting eval/results"
                icon={<Send className="h-4 w-4 text-[#0F5E63]" />}
                className={`cursor-pointer ${statusFilter === 'submitted' ? 'ring-2 ring-[#0F5E63]' : ''}`}
                onClick={() => handleHudClick('submitted', 'submitted')}
              />

              <StatCard
                label="Won Tenders"
                value={dashboardStats.won || dashboardStats.tenders_won || 0}
                subtext="L1 awards achieved"
                icon={<Award className="h-4 w-4 text-emerald-600" />}
                valueColor="emerald"
                className={`cursor-pointer ${statusFilter === 'won' ? 'ring-2 ring-emerald-600' : ''}`}
                onClick={() => handleHudClick('won', 'won')}
              />

              <StatCard
                label="Lost Tenders"
                value={dashboardStats.lost || dashboardStats.tenders_lost || 0}
                subtext="Competitor / QR loss"
                icon={<XCircle className="h-4 w-4 text-red-600" />}
                valueColor="rose"
                className={`cursor-pointer ${statusFilter === 'lost' ? 'ring-2 ring-red-600' : ''}`}
                onClick={() => handleHudClick('lost', 'lost')}
              />

              <StatCard
                label="Urgent (≤ 48h)"
                value={dashboardStats.urgent_deadlines || 0}
                subtext="Imminent closing date"
                icon={<AlertTriangle className="h-4 w-4 text-amber-600" />}
                valueColor="amber"
                className={`cursor-pointer ${deadlineFilter === 'urgent_48h' ? 'ring-2 ring-amber-500' : ''}`}
                onClick={() => handleHudClick('urgent_deadlines', 'urgent_48h')}
              />

              <StatCard
                label="Upcoming (≤ 7d)"
                value={dashboardStats.upcoming_deadlines || 0}
                subtext="Due within one week"
                icon={<Calendar className="h-4 w-4 text-blue-600" />}
                className={`cursor-pointer ${deadlineFilter === 'upcoming_7d' ? 'ring-2 ring-blue-500' : ''}`}
                onClick={() => handleHudClick('upcoming_deadlines', 'upcoming_7d')}
              />

              <StatCard
                label="Portal Issues (§25)"
                value={dashboardStats.open_portal_issues || 0}
                subtext="GeM/CPPP portal bugs"
                icon={<AlertCircle className="h-4 w-4 text-rose-600" />}
                valueColor="rose"
                className="cursor-pointer"
                onClick={() => setActiveTab('portal_issues')}
              />
            </div>
          </div>

          {/* ========================================================================= */}
          {/* Arihant Tender Lifecycle Pipeline Stepper (§19-§26) */}
          {/* ========================================================================= */}
          <div className="bg-white rounded-xl border border-[#DCD8CE] p-3.5 shadow-2xs space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="p-1 rounded-md bg-[#E3EFEE] text-[#0F5E63]">
                  <Sparkles className="h-4 w-4" />
                </span>
                <div>
                  <h3 className="text-xs font-bold text-[#14213D]">Arihant Operational Tender Lifecycle</h3>
                  <p className="text-[11px] text-[#4A5568]">
                    Governed 6-stage workflow: Identified → Internal Review → Authorisation → Preparation → Submitted → Result Tracking
                  </p>
                </div>
              </div>
              {statusFilter && (
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => {
                    setStatusFilter('');
                    setPage(1);
                  }}
                  leftIcon={<X className="h-3 w-3" />}
                >
                  Clear Stage Filter ({statusFilter.replace(/_/g, ' ')})
                </Button>
              )}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 pt-0.5">
              {[
                {
                  key: 'identified',
                  stageNum: '1',
                  name: 'Tender Identified',
                  desc: 'New requirement logged',
                  active: statusFilter === 'identified',
                  count: dashboardStats.identified ?? dashboardStats.stage_1_identified ?? 0,
                },
                {
                  key: 'awaiting_approval',
                  stageNum: '2',
                  name: 'Submitted for Review',
                  desc: 'Awaiting RM signoff',
                  active: statusFilter === 'awaiting_approval',
                  count: dashboardStats.pending_approvals ?? dashboardStats.awaiting_approval ?? 0,
                },
                {
                  key: 'rejected_internally',
                  stageNum: '3',
                  name: 'Authorised Decision',
                  desc: 'Approved / rejected by RM',
                  active: statusFilter === 'rejected_internally',
                  count: dashboardStats.rejected_internally ?? dashboardStats.stage_3_decision ?? 0,
                },
                {
                  key: 'under_preparation',
                  stageNum: '4',
                  name: 'Tender Preparation',
                  desc: 'Bidding & PQ packets',
                  active: statusFilter === 'under_preparation',
                  count: dashboardStats.under_preparation ?? dashboardStats.stage_4_prep ?? 0,
                },
                {
                  key: 'submitted',
                  stageNum: '5',
                  name: 'Tender Submitted',
                  desc: 'Bids filed on GeM/portal',
                  active: statusFilter === 'submitted',
                  count: dashboardStats.submitted ?? dashboardStats.tenders_submitted ?? 0,
                },
                {
                  key: 'results',
                  stageNum: '6',
                  name: 'Result Tracking',
                  desc: 'Technical & outcome',
                  active: ['won', 'lost', 'technical_eval', 'commercial_eval', 'results'].includes(statusFilter),
                  count: dashboardStats.result_tracking ?? ((dashboardStats.won || 0) + (dashboardStats.lost || 0)),
                },
              ].map((st) => (
                <div
                  key={st.key}
                  onClick={() => {
                    setStatusFilter(statusFilter === st.key ? '' : st.key);
                    setActiveHudFilter(null);
                    setPage(1);
                  }}
                  className={`p-2.5 rounded-lg border cursor-pointer transition-all ${st.active
                      ? 'bg-[#E3EFEE] border-[#0F5E63] shadow-xs ring-1 ring-[#0F5E63]'
                      : 'bg-[#FBFAF7] border-[#DCD8CE] hover:border-[#0F5E63] hover:bg-white'
                    }`}
                >
                  <div className="flex items-center justify-between text-[10px] text-[#4A5568] font-semibold mb-1">
                    <span className="font-bold text-[#0F5E63]">Step {st.stageNum}</span>
                    <span className="font-bold text-[#14213D] bg-white px-1.5 py-0.5 rounded border border-[#DCD8CE]">
                      {st.count}
                    </span>
                  </div>
                  <div className="text-xs font-bold text-[#14213D] leading-tight truncate">
                    {st.name}
                  </div>
                  <div className="text-[10px] text-[#4A5568] truncate mt-0.5">
                    {st.desc}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Filter Bar */}
          <FilterBar>
            <div className="flex-1 min-w-[200px]">
              <Input
                placeholder="Search by tender no, department, product..."
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
              />
            </div>

            <Select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setActiveHudFilter(null);
                setPage(1);
              }}
              options={[
                { value: '', label: 'All Lifecycle Stages' },
                ...STAGES.map((s) => ({ value: s.key, label: s.label })),
              ]}
              className="w-48"
            />

            <Select
              value={categoryFilter}
              onChange={(e) => {
                setCategoryFilter(e.target.value);
                setActiveHudFilter(null);
                setPage(1);
              }}
              options={[
                { value: '', label: 'All Classifications' },
                { value: 'pq', label: 'PQ (Pre-Qualification)' },
                { value: 'general_mha', label: 'General / MHA' },
                { value: 'other', label: 'Other Defence / Govt' },
              ]}
              className="w-44"
            />

            <Select
              value={zoneFilter}
              onChange={(e) => {
                setZoneFilter(e.target.value);
                setPage(1);
              }}
              options={[
                { value: '', label: 'All Zones' },
                { value: 'North', label: 'North Zone' },
                { value: 'South', label: 'South Zone' },
                { value: 'East', label: 'East Zone' },
                { value: 'West', label: 'West Zone' },
                { value: 'Central', label: 'Central Zone' },
              ]}
              className="w-36"
            />

            <Select
              value={deadlineFilter}
              onChange={(e) => {
                setDeadlineFilter(e.target.value);
                setActiveHudFilter(null);
                setPage(1);
              }}
              options={[
                { value: '', label: 'All Deadlines' },
                { value: 'urgent_48h', label: 'Urgent (≤ 48 Hours)' },
                { value: 'upcoming_7d', label: 'Upcoming (≤ 7 Days)' },
                { value: 'overdue', label: 'Overdue Submissions' },
              ]}
              className="w-44"
            />

            <Select
              value={`${sortBy}:${sortOrder}`}
              onChange={(e) => {
                const parts = e.target.value.split(':');
                setSortBy(parts[0]);
                setSortOrder(parts[1] as 'asc' | 'desc');
                setPage(1);
              }}
              options={[
                { value: 'created_at:desc', label: 'Recent First (Newest)' },
                { value: 'created_at:asc', label: 'Oldest First' },
                { value: 'submission_deadline:asc', label: 'Deadline: Nearest First' },
                { value: 'submission_deadline:desc', label: 'Deadline: Furthest First' },
                { value: 'estimated_value:desc', label: 'Value: High to Low' },
                { value: 'estimated_value:asc', label: 'Value: Low to High' },
                { value: 'publication_date:desc', label: 'Publish Date (Recent)' },
              ]}
              className="w-52"
            />

            {(search || statusFilter || categoryFilter || zoneFilter || deadlineFilter || activeHudFilter || sortBy !== 'created_at' || sortOrder !== 'desc') && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSearch('');
                  setStatusFilter('');
                  setCategoryFilter('');
                  setZoneFilter('');
                  setDeadlineFilter('');
                  setActiveHudFilter(null);
                  setSortBy('created_at');
                  setSortOrder('desc');
                  setPage(1);
                }}
              >
                Reset Filters
              </Button>
            )}
          </FilterBar>

          {/* Tenders Table */}
          <div className="bg-white rounded-xl border border-[#DCD8CE] overflow-hidden shadow-2xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-[#FBFAF7] border-b border-[#DCD8CE] text-[#4A5568] font-semibold">
                    <th className="p-3.5 whitespace-nowrap">Tender / Bid No.</th>
                    <th className="p-3.5 whitespace-nowrap">Buyer & Location</th>
                    <th className="p-3.5 whitespace-nowrap">Category</th>
                    <th className="p-3.5">Requirement & Owner</th>
                    <th className="p-3.5 whitespace-nowrap">Qty & Value</th>
                    <th className="p-3.5 whitespace-nowrap">Submission Deadline</th>
                    <th className="p-3.5 whitespace-nowrap">Stage</th>
                    <th className="p-3.5 text-right whitespace-nowrap">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#DCD8CE]">
                  {isLoading ? (
                    <tr>
                      <td colSpan={8} className="p-8 text-center text-xs text-[#4A5568]">
                        <RefreshCw className="h-5 w-5 animate-spin mx-auto mb-2 text-[#0F5E63]" />
                        Loading tender opportunities...
                      </td>
                    </tr>
                  ) : tenders.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="p-8">
                        <EmptyState
                          icon={<FileText className="h-8 w-8 text-[#4A5568]" />}
                          title="No tenders found"
                          description="No procurement tenders match your selected filters. Adjust your criteria or register a new tender."
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
                          className="hover:bg-[#F8FAFC] transition-colors border-b border-[#DCD8CE]"
                        >
                          {/* Tender Number & Portal */}
                          <td className="p-3.5 whitespace-nowrap">
                            <div className="font-bold text-[#14213D] flex items-center gap-1.5">
                              <span>{tender.tender_number || tender.tender_no}</span>
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
                            <div className="font-medium text-[#14213D] truncate" title={tender.department || tender.organisation_name}>
                              {tender.department || tender.organisation_name || 'Government Buyer'}
                            </div>
                            <div className="text-[10px] text-[#4A5568] flex items-center gap-1 mt-0.5 truncate">
                              <MapPin className="h-2.5 w-2.5 shrink-0" />
                              <span>
                                {tender.city ? `${tender.city}, ` : ''}
                                {tender.state ? `${tender.state} ` : ''}
                                {tender.zone ? `(${tender.zone} Zone)` : ''}
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
                          <td className="p-3.5 max-w-[240px] truncate">
                            <div className="truncate font-medium text-[#14213D]" title={tender.requirement_text}>
                              {tender.requirement_text || tender.product_name || 'Defence Procurement Item'}
                            </div>
                            <div className="text-[10px] text-[#4A5568] truncate mt-0.5 flex items-center gap-1">
                              <User className="h-2.5 w-2.5 shrink-0" />
                              <span>Owner: {tender.owner_name || tender.assigned_person_name || 'Unassigned'}</span>
                            </div>
                          </td>

                          {/* Qty & Value */}
                          <td className="p-3.5 whitespace-nowrap">
                            <div className="font-semibold text-[#14213D]">
                              Qty: {tender.quantity || 1}
                            </div>
                            <div className="text-[10px] text-[#4A5568] font-mono mt-0.5">
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
                            <div className="font-mono text-[#14213D] font-semibold">
                              {closingDate ? closingDate.toLocaleDateString('en-IN') : 'TBA'}
                            </div>
                            {isOverdue ? (
                              <Badge variant="danger" size="sm" className="mt-1">
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
                              <span className="text-[10px] text-[#4A5568]">Standard</span>
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
                                  {hasRole(['management', 'regional_manager', 'admin']) ? (
                                    <Button
                                      size="xs"
                                      variant="primary"
                                      className="bg-[#0F5E63] hover:bg-[#0B4A4E] text-white"
                                      onClick={() => {
                                        setSelectedTender(tender);
                                        setApprovalDecision('approved');
                                        setIsApproveOpen(true);
                                      }}
                                      title="Review as Management & Authorise"
                                    >
                                      <ShieldCheck className="h-3 w-3 mr-1" />
                                      <span>Review as Management</span>
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
                                <Button
                                  size="xs"
                                  variant="primary"
                                  className="bg-amber-600 hover:bg-amber-700 text-white"
                                  onClick={() => {
                                    setSelectedTender(tender);
                                    setApprovalDecision('approved');
                                    setIsApproveOpen(true);
                                  }}
                                  title="Review Decision & Endorse as Management"
                                >
                                  <ShieldCheck className="h-3 w-3 mr-1" />
                                  <span>Review as Management</span>
                                </Button>
                              )}

                              {tender.status === 'under_preparation' && (
                                <Button
                                  size="xs"
                                  variant="primary"
                                  onClick={() => {
                                    setSelectedTender(tender);
                                    setTargetTransitionStatus(tender.category === 'pq' ? 'pq_submitted' : 'submitted');
                                    setTransitionRemarks(tender.category === 'pq' ? 'Submitting PQ Application' : 'Submitting Bid');
                                    setIsTransitionOpen(true);
                                  }}
                                  title="Advance to Submission"
                                >
                                  <CheckCircle2 className="h-3 w-3 mr-1" />
                                  <span>{tender.category === 'pq' ? 'Submit PQ' : 'Submit Bid'}</span>
                                </Button>
                              )}

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
            <div className="p-3 bg-[#FBFAF7] border-t border-[#DCD8CE] flex items-center justify-between text-xs text-[#4A5568]">
              <div>
                Showing <strong className="text-[#14213D]">{tenders.length}</strong> of{' '}
                <strong className="text-[#14213D]">{totalCount}</strong> tender opportunities
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
                <span className="font-medium text-[#14213D]">
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
      {/* TAB 2: EXECUTIVE REPORTING & ANALYTICS (§21, §26, §27) */}
      {/* ========================================================================= */}
      {activeTab === 'analytics' && (
        <div className="space-y-6">
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
                  <Clock className="h-4 w-4 text-blue-600" />
                </div>
                <div className="text-2xl font-black text-blue-700 mt-1.5">
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
                  <XCircle className="h-4 w-4 text-red-600" />
                </div>
                <div className="text-2xl font-black text-red-600 mt-1.5">
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
                <tbody className="divide-y divide-[#DCD8CE]">
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
                          <td className="p-2.5 text-[#4A5568]">{org.sector || 'Defence / Security'}</td>
                          <td className="p-2.5 text-[#4A5568]">
                            {org.city ? `${org.city}, ` : ''}{org.state || ''}
                          </td>
                          <td className="p-2.5 text-center font-bold text-[#0F5E63]">{org.total || org.total_tenders || 0}</td>
                          <td className="p-2.5 text-center font-semibold text-[#0F5E63]">{org.pq_count || 0}</td>
                          <td className="p-2.5 text-center font-semibold text-gray-700">{org.general_mha_count || 0}</td>
                          <td className="p-2.5 text-center text-amber-700 font-semibold">{org.pending || org.pending_tenders || 0}</td>
                          <td className="p-2.5 text-center text-blue-700 font-semibold">{org.submitted || org.submitted_tenders || 0}</td>
                          <td className="p-2.5 text-center text-emerald-700 font-bold">{org.won || org.won_tenders || 0}</td>
                          <td className="p-2.5 text-center text-red-600 font-semibold">{org.lost || org.lost_tenders || 0}</td>
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

          {/* Section 3: Zone-wise Pipeline Report (§21 & §27) */}
          <div className="bg-white rounded-xl border border-[#DCD8CE] p-4 shadow-2xs space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-sm font-bold text-[#14213D] flex items-center gap-1.5">
                  <Compass className="h-4 w-4 text-[#0F5E63]" />
                  <span>Zone-wise Pipeline & Win Rates (§21, §27)</span>
                </h4>
                <p className="text-xs text-[#4A5568]">Territorial command breakdown across North, South, East, West, Central with Vikas PQ matrix</p>
              </div>
              <Badge variant="info" size="sm">{zoneReport.length} Operating Zones</Badge>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-[#FBFAF7] border-b border-[#DCD8CE] text-[#4A5568] font-semibold">
                    <th className="p-2.5">Zone Name</th>
                    <th className="p-2.5 text-center">Total Opportunities</th>
                    <th className="p-2.5 text-center">PQ Bids</th>
                    <th className="p-2.5 text-center">General / MHA</th>
                    <th className="p-2.5 text-center">In Prep / Approval</th>
                    <th className="p-2.5 text-center">Submitted</th>
                    <th className="p-2.5 text-center">Won</th>
                    <th className="p-2.5 text-center">Lost</th>
                    <th className="p-2.5 text-right">Zone Win Rate</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#DCD8CE]">
                  {zoneReport.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="p-4 text-center text-xs text-[#4A5568]">
                        No zone-level data available.
                      </td>
                    </tr>
                  ) : (
                    zoneReport.map((z) => {
                      const decided = (z.won || 0) + (z.lost || 0);
                      const rate = decided > 0 ? Math.round(((z.won || 0) / decided) * 100) : 0;
                      return (
                        <tr key={z.zone_id} className="hover:bg-[#F8FAFC]">
                          <td className="p-2.5 font-bold text-[#14213D]">{z.zone_name} Zone</td>
                          <td className="p-2.5 text-center font-bold text-[#0F5E63]">{z.total || z.total_tenders || 0}</td>
                          <td className="p-2.5 text-center font-semibold text-[#0F5E63]">{z.pq_count || 0}</td>
                          <td className="p-2.5 text-center font-semibold text-gray-700">{z.general_mha_count || 0}</td>
                          <td className="p-2.5 text-center text-amber-700 font-semibold">{z.pending || z.pending_tenders || 0}</td>
                          <td className="p-2.5 text-center text-blue-700 font-semibold">{z.submitted || z.submitted_tenders || 0}</td>
                          <td className="p-2.5 text-center text-emerald-700 font-bold">{z.won || z.won_tenders || 0}</td>
                          <td className="p-2.5 text-center text-red-600 font-semibold">{z.lost || z.lost_tenders || 0}</td>
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

          {/* Section 4: Region-wise Pipeline Breakdown (§21 & §27) */}
          <div className="bg-white rounded-xl border border-[#DCD8CE] p-4 shadow-2xs space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-sm font-bold text-[#14213D] flex items-center gap-1.5">
                  <MapPin className="h-4 w-4 text-[#0F5E63]" />
                  <span>Region-wise Pipeline Distribution (§21, §27)</span>
                </h4>
                <p className="text-xs text-[#4A5568]">State and regional police sector distribution with classification breakdown</p>
              </div>
              <Badge variant="outline" size="sm">{regionReport.length} Regions Tracked</Badge>
            </div>

            <div className="overflow-x-auto max-h-[320px] overflow-y-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="sticky top-0 bg-[#FBFAF7]">
                  <tr className="border-b border-[#DCD8CE] text-[#4A5568] font-semibold">
                    <th className="p-2.5">Region</th>
                    <th className="p-2.5">Parent Zone</th>
                    <th className="p-2.5 text-center">Total</th>
                    <th className="p-2.5 text-center">PQ Bids</th>
                    <th className="p-2.5 text-center">General / MHA</th>
                    <th className="p-2.5 text-center">In Prep</th>
                    <th className="p-2.5 text-center">Submitted</th>
                    <th className="p-2.5 text-center">Won</th>
                    <th className="p-2.5 text-center">Lost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#DCD8CE]">
                  {regionReport.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="p-4 text-center text-xs text-[#4A5568]">
                        No regional data available.
                      </td>
                    </tr>
                  ) : (
                    regionReport.map((r) => (
                      <tr key={r.region_id} className="hover:bg-[#F8FAFC]">
                        <td className="p-2.5 font-semibold text-[#14213D]">{r.region_name}</td>
                        <td className="p-2.5 text-[#4A5568]">{r.zone_name || 'North'}</td>
                        <td className="p-2.5 text-center font-bold text-[#0F5E63]">{r.total || r.total_tenders || 0}</td>
                        <td className="p-2.5 text-center font-semibold text-[#0F5E63]">{r.pq_count || 0}</td>
                        <td className="p-2.5 text-center font-semibold text-gray-700">{r.general_mha_count || 0}</td>
                        <td className="p-2.5 text-center text-amber-700">{r.pending || r.pending_tenders || 0}</td>
                        <td className="p-2.5 text-center text-blue-700">{r.submitted || r.submitted_tenders || 0}</td>
                        <td className="p-2.5 text-center text-emerald-700 font-bold">{r.won || r.won_tenders || 0}</td>
                        <td className="p-2.5 text-center text-red-600">{r.lost || r.lost_tenders || 0}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Section 5: Salesperson / Tender Owner Performance Ledger (§21 & §27) */}
          <div className="bg-white rounded-xl border border-[#DCD8CE] p-4 shadow-2xs space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-sm font-bold text-[#14213D] flex items-center gap-1.5">
                  <Users className="h-4 w-4 text-[#0F5E63]" />
                  <span>Salesperson & Tender Owner Performance Ledger (§21, §27)</span>
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
                <tbody className="divide-y divide-[#DCD8CE]">
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
                          <td className="p-2.5 text-center text-red-600 font-semibold">{s.lost || s.lost_tenders || 0}</td>
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

          {/* Section 6: Structured Win / Loss Post-Mortem Intelligence HUD (§26) */}
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
                <div className="p-3 rounded-lg bg-[#F8FAFC] border border-[#DCD8CE] space-y-2">
                  <span className="text-[11px] font-bold text-[#0F5E63] uppercase tracking-wider block">
                    Won by Product
                  </span>
                  {Object.keys(winLossReport.won_by_product || {}).length === 0 ? (
                    <p className="text-xs text-[#4A5568]">No product award breakdown yet.</p>
                  ) : (
                    Object.entries(winLossReport.won_by_product || {}).map(([prod, data]: [string, any]) => (
                      <div key={prod} className="flex items-center justify-between text-xs py-1 border-b border-gray-100 last:border-none">
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
                <div className="p-3 rounded-lg bg-[#F8FAFC] border border-[#DCD8CE] space-y-2">
                  <span className="text-[11px] font-bold text-[#0F5E63] uppercase tracking-wider block">
                    Won by Region
                  </span>
                  {Object.keys(winLossReport.won_by_region || {}).length === 0 ? (
                    <p className="text-xs text-[#4A5568]">No regional awards logged yet.</p>
                  ) : (
                    Object.entries(winLossReport.won_by_region || {}).map(([reg, data]: [string, any]) => (
                      <div key={reg} className="flex items-center justify-between text-xs py-1 border-b border-gray-100 last:border-none">
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
                <div className="p-3 rounded-lg bg-[#F8FAFC] border border-[#DCD8CE] space-y-2">
                  <span className="text-[11px] font-bold text-[#0F5E63] uppercase tracking-wider block">
                    Top Winning Executives
                  </span>
                  {Object.keys(winLossReport.won_by_person || {}).length === 0 ? (
                    <p className="text-xs text-[#4A5568]">No salesperson award ledger yet.</p>
                  ) : (
                    Object.entries(winLossReport.won_by_person || {}).map(([person, data]: [string, any]) => (
                      <div key={person} className="flex items-center justify-between text-xs py-1 border-b border-gray-100 last:border-none">
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
                  <XCircle className="h-4 w-4 text-red-600" />
                  <span>Primary Loss Cause Breakdown (§26 Post-Mortem)</span>
                </h4>
                <p className="text-xs text-[#4A5568]">Structured primary loss categories on lost bids</p>

                <div className="space-y-2 pt-1">
                  {Object.keys(winLossReport.loss_reasons || {}).length === 0 ? (
                    <div className="p-4 rounded-lg bg-slate-50 text-center text-xs text-[#4A5568]">
                      No lost tender post-mortems logged yet.
                    </div>
                  ) : (
                    Object.entries(winLossReport.loss_reasons || {}).map(([reason, count]) => {
                      const totalLost = winLossReport.lost || 1;
                      const pct = Math.round(((count as number) / totalLost) * 100);
                      return (
                        <div key={reason} className="p-2.5 rounded-lg bg-[#F8FAFC] border border-[#DCD8CE] flex items-center justify-between">
                          <div>
                            <span className="font-semibold text-xs text-[#14213D] uppercase tracking-wide">
                              {reason.replace(/_/g, ' ')}
                            </span>
                            <span className="text-[10px] text-[#4A5568] block">
                              {reason === 'pricing' || reason === 'price' ? 'Competitor lower quoted L1 / margin limitation' : reason === 'technical' ? 'QR deviation or proving ground performance gap' : reason === 'eligibility' ? 'Turnover or prior tender experience shortfall' : reason === 'documentation' ? 'OEM Authorization or technical annexure omission' : 'Commercial / procurement board decision'}
                            </span>
                          </div>
                          <div className="text-right">
                            <span className="text-sm font-black text-red-700">{count as number}</span>
                            <span className="text-[10px] text-[#4A5568] block">{pct}% of losses</span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                {/* Deficiency Factors HUD (§26 Breakdown) */}
                {winLossReport.loss_factors && (
                  <div className="pt-2 border-t border-[#DCD8CE]">
                    <span className="text-[11px] font-bold text-[#4A5568] uppercase tracking-wider block mb-2">
                      Factor Defect Occurrences
                    </span>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      <div className="p-2 rounded bg-red-50/50 border border-red-200">
                        <span className="text-[10px] text-red-700 font-medium block">Technical Issue</span>
                        <span className="text-xs font-bold text-red-900">{winLossReport.loss_factors.technical_issues || 0} bids</span>
                      </div>
                      <div className="p-2 rounded bg-amber-50/50 border border-amber-200">
                        <span className="text-[10px] text-amber-700 font-medium block">Pricing Issue</span>
                        <span className="text-xs font-bold text-amber-900">{winLossReport.loss_factors.pricing_issues || 0} bids</span>
                      </div>
                      <div className="p-2 rounded bg-blue-50/50 border border-blue-200">
                        <span className="text-[10px] text-blue-700 font-medium block">Eligibility Gap</span>
                        <span className="text-xs font-bold text-blue-900">{winLossReport.loss_factors.eligibility_issues || 0} bids</span>
                      </div>
                      <div className="p-2 rounded bg-slate-50 border border-slate-200">
                        <span className="text-[10px] text-gray-700 font-medium block">Documentation</span>
                        <span className="text-xs font-bold text-gray-900">{winLossReport.loss_factors.documentation_issues || 0} bids</span>
                      </div>
                      <div className="p-2 rounded bg-purple-50/50 border border-purple-200">
                        <span className="text-[10px] text-purple-700 font-medium block">Other Reason</span>
                        <span className="text-xs font-bold text-purple-900">{winLossReport.loss_factors.other_reasons || 0} bids</span>
                      </div>
                    </div>
                  </div>
                )}
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
                    <div className="p-4 rounded-lg bg-slate-50 text-center text-xs text-[#4A5568]">
                      No competitor awards recorded in system yet.
                    </div>
                  ) : (
                    Object.entries(winLossReport.competitors || {}).map(([comp, count]) => (
                      <div key={comp} className="p-2.5 rounded-lg bg-[#F8FAFC] border border-[#DCD8CE] flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Building className="h-4 w-4 text-[#0F5E63]" />
                          <span className="font-bold text-xs text-[#14213D]">{comp}</span>
                        </div>
                        <Badge variant="danger" size="sm">{count as number} Tender Awards</Badge>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* Completed Tenders Intelligence Register */}
            {winLossReport.recent_completed && winLossReport.recent_completed.length > 0 && (
              <div className="bg-white rounded-xl border border-[#DCD8CE] p-4 shadow-2xs space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-bold text-[#14213D] flex items-center gap-1.5">
                    <History className="h-4 w-4 text-[#0F5E63]" />
                    <span>Completed Tenders Post-Mortem Register (§26)</span>
                  </h4>
                  <Badge variant="default" size="sm">{winLossReport.recent_completed.length} Completed Bids</Badge>
                </div>

                <div className="overflow-x-auto max-h-[300px] overflow-y-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="sticky top-0 bg-[#FBFAF7]">
                      <tr className="border-b border-[#DCD8CE] text-[#4A5568] font-semibold">
                        <th className="p-2.5">Tender / Buyer</th>
                        <th className="p-2.5">Verdict</th>
                        <th className="p-2.5">Product & Region</th>
                        <th className="p-2.5">Responsible Executive</th>
                        <th className="p-2.5">Result Date & Value</th>
                        <th className="p-2.5">Outcome Reason / Competitor</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#DCD8CE]">
                      {winLossReport.recent_completed.map((o: any) => (
                        <tr key={o.outcome_id || o.tender_id} className="hover:bg-[#F8FAFC]">
                          <td className="p-2.5">
                            <span className="font-bold text-xs text-[#14213D] block">{o.tender_no || 'Tender'}</span>
                            <span className="text-[10px] text-[#4A5568] truncate block max-w-[180px]">{o.organisation_name || o.tender_department}</span>
                          </td>
                          <td className="p-2.5">
                            <Badge variant={o.result === 'won' ? 'success' : 'danger'} size="sm">
                              {o.result?.toUpperCase()}
                            </Badge>
                          </td>
                          <td className="p-2.5">
                            <span className="font-medium text-[#14213D] block">{o.product_name || 'Standard Equipment'}</span>
                            <span className="text-[10px] text-[#4A5568] block">{o.region_name || 'NCR'}</span>
                          </td>
                          <td className="p-2.5 text-[#4A5568]">
                            {o.tender_owner_name || o.assigned_person_name || 'Unassigned'}
                          </td>
                          <td className="p-2.5">
                            <span className="text-[#14213D] block">{o.result_date ? new Date(o.result_date).toLocaleDateString('en-IN') : 'N/A'}</span>
                            {o.value_lakh ? (
                              <span className="text-[10px] font-bold text-emerald-700">₹{o.value_lakh} Lakh</span>
                            ) : null}
                          </td>
                          <td className="p-2.5 max-w-[240px]">
                            {o.result === 'won' ? (
                              <span className="text-[#14213D]">{o.notes || o.reason || 'Won L1 Award'}</span>
                            ) : (
                              <div>
                                <span className="font-semibold text-red-700 block">{o.reason || 'Lost'}</span>
                                {o.competitor && (
                                  <span className="text-[10px] text-gray-700 block">Awarded to: {o.competitor}</span>
                                )}
                                {o.technical_issue && (
                                  <span className="text-[10px] text-amber-800 block">Tech: {o.technical_issue}</span>
                                )}
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 3: DEADLINE & ESCALATIONS COMMAND (§24) */}
      {/* ========================================================================= */}
      {activeTab === 'deadlines' && (
        <div className="space-y-6">
          <SectionHeader
            title="Tender Deadline & Urgency Command Center (§24)"
            description="Active countdown alerts, pending internal signoffs, incomplete preparations, and post-submission result follow-ups"
          />

          {/* Group 1: Urgent (≤ 48 Hours) */}
          <div className="bg-white rounded-[10px] border border-[#E3E7ED] border-l-4 border-l-[#B42318] p-4 shadow-2xs space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-[#B42318]" />
                <h4 className="text-sm font-bold text-[#B42318]">
                  Imminent Closing Deadlines (≤ 48 Hours)
                </h4>
              </div>
              <Badge variant="urgent" size="sm">
                {categorizedDeadlines.urgent.length} Critical Tenders
              </Badge>
            </div>

            {categorizedDeadlines.urgent.length === 0 ? (
              <div className="p-4 rounded-[8px] bg-[#F9FAFB] border border-dashed border-[#E3E7ED] text-xs text-[#5E6A7C] text-center">
                Zero tenders closing within the next 48 hours.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {categorizedDeadlines.urgent.map((t) => (
                  <div key={t.id} className="p-3.5 rounded-[10px] border border-[#F6CFC9] bg-[#FEF1EF]/40 flex items-start justify-between">
                    <div>
                      <div className="font-bold text-xs text-[#152235] flex items-center gap-1.5">
                        <span>{t.tender_number || t.tender_no}</span>
                        <Badge variant="urgent" size="sm">CLOSING SOON</Badge>
                      </div>
                      <p className="text-[11px] text-[#5E6A7C] mt-1 font-medium">{t.department}</p>
                      <p className="text-[10px] text-[#5E6A7C] mt-0.5">Deadline: {new Date(t.submission_deadline || t.bid_closing_date).toLocaleString('en-IN')}</p>
                      <p className="text-[10px] text-[#0F5E4E] font-semibold mt-1">Owner: {t.owner_name || t.assigned_person_name || 'Unassigned'}</p>
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
          <div className="bg-white rounded-[10px] border border-[#E3E7ED] p-4 shadow-2xs space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Calendar className="h-5 w-5 text-[#0F5E4E]" />
                <h4 className="text-sm font-bold text-[#152235]">
                  Upcoming Submissions (Next 3 to 7 Days)
                </h4>
              </div>
              <Badge variant="outline" size="sm">
                {categorizedDeadlines.upcoming.length} Upcoming
              </Badge>
            </div>

            {categorizedDeadlines.upcoming.length === 0 ? (
              <div className="p-4 rounded-[8px] bg-[#F9FAFB] border border-dashed border-[#E3E7ED] text-xs text-[#5E6A7C] text-center">
                Zero submissions scheduled between 3 to 7 days.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {categorizedDeadlines.upcoming.map((t) => (
                  <div key={t.id} className="p-3.5 rounded-[10px] border border-[#E3E7ED] bg-white flex flex-col justify-between hover:border-[#16917A] transition-all">
                    <div>
                      <div className="font-bold text-xs text-[#152235] flex items-center justify-between">
                        <span className="truncate">{t.tender_number || t.tender_no}</span>
                        <Badge variant="outline" size="sm">{t.tender_category || t.category || 'Tender'}</Badge>
                      </div>
                      <p className="text-[11px] text-[#5E6A7C] mt-1 font-medium truncate">{t.department}</p>
                      <p className="text-[10px] text-[#5E6A7C] mt-0.5">
                        Closing: {new Date(t.submission_deadline || t.bid_closing_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </p>
                      <p className="text-[10px] text-[#0F5E4E] font-semibold mt-0.5">
                        Owner: {t.owner_name || t.assigned_person_name || 'Assigned Team'}
                      </p>
                    </div>
                    <div className="pt-2 flex items-center justify-end gap-1.5 border-t border-[#E3E7ED] mt-2">
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
          <div className="bg-white rounded-[10px] border border-[#E3E7ED] p-4 shadow-2xs space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-[#0F5E4E]" />
                <h4 className="text-sm font-bold text-[#152235]">
                  Pending Internal Approvals Awaiting Dual-Control Signoff
                </h4>
              </div>
              <Badge variant="warning" size="sm">
                {categorizedDeadlines.awaitingSignoff.length} Pending
              </Badge>
            </div>

            {categorizedDeadlines.awaitingSignoff.length === 0 ? (
              <div className="p-4 rounded-[8px] bg-[#F9FAFB] border border-dashed border-[#E3E7ED] text-xs text-[#5E6A7C] text-center">
                All participation requests have been reviewed and approved.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {categorizedDeadlines.awaitingSignoff.map((t) => (
                  <div key={t.id} className="p-3.5 rounded-[10px] border border-[#E3E7ED] bg-white flex items-start justify-between">
                    <div>
                      <span className="font-bold text-xs text-[#152235] block">{t.tender_number || t.tender_no}</span>
                      <p className="text-[11px] text-[#5E6A7C] mt-0.5">{t.department}</p>
                      <p className="text-[10px] text-[#A15C07] font-semibold mt-1">Status: Awaiting Management Decision</p>
                    </div>
                    <Button
                      size="xs"
                      variant="cyber"
                      onClick={() => {
                        setSelectedTender(t);
                        setApprovalDecision('approved');
                        setIsApproveOpen(true);
                      }}
                    >
                      Review as Management
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Group 4: Incomplete Tender Preparation (§24) */}
          <div className="bg-white rounded-[10px] border border-[#E3E7ED] p-4 shadow-2xs space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock className="h-5 w-5 text-[#0F5E4E]" />
                <h4 className="text-sm font-bold text-[#152235]">
                  Incomplete Tender Preparation (Under Active Drafting)
                </h4>
              </div>
              <Badge variant="info" size="sm">
                {categorizedDeadlines.incompletePrep.length} In Flight
              </Badge>
            </div>

            {categorizedDeadlines.incompletePrep.length === 0 ? (
              <div className="p-4 rounded-[8px] bg-[#F9FAFB] border border-dashed border-[#E3E7ED] text-center text-xs text-[#5E6A7C]">
                No imminent drafting deadlines.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {categorizedDeadlines.incompletePrep.map((t) => (
                  <div key={t.id} className="p-3 rounded-[8px] border border-[#E3E7ED] bg-[#F9FAFB] space-y-2">
                    <span className="font-bold text-xs text-[#152235] block truncate">{t.tender_number || t.tender_no}</span>
                    <p className="text-[10px] text-[#5E6A7C] truncate">{t.department}</p>
                    <div className="flex items-center justify-between pt-1">
                      <span className="text-[10px] text-[#0F5E4E] font-semibold">{t.owner_name || 'Assigned Team'}</span>
                      <Button size="xs" variant="outline" onClick={() => openTenderDetails(t)}>Open</Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Group 5: Tender Result Follow-Ups (§24) */}
          <div className="bg-white rounded-[10px] border border-[#E3E7ED] p-4 shadow-2xs space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Send className="h-5 w-5 text-[#0F5E4E]" />
                <h4 className="text-sm font-bold text-[#152235]">
                  Post-Submission Result Follow-Ups (Awaiting Commercial Evaluation / Award)
                </h4>
              </div>
              <Badge variant="cyber" size="sm">
                {categorizedDeadlines.resultFollowups.length} Submitted Bids
              </Badge>
            </div>

            {categorizedDeadlines.resultFollowups.length === 0 ? (
              <div className="p-4 rounded-[8px] bg-[#F9FAFB] border border-dashed border-[#E3E7ED] text-center text-xs text-[#5E6A7C]">
                No pending result follow-ups. All submitted bids have outcomes recorded.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {categorizedDeadlines.resultFollowups.map((t) => (
                  <div key={t.id} className="p-3.5 rounded-[10px] border border-[#E3E7ED] bg-white space-y-2 hover:border-[#16917A] transition-all flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-xs text-[#152235] truncate">{t.tender_number || t.tender_no}</span>
                        <Badge variant="cyber" size="sm">{t.status.replace(/_/g, ' ').toUpperCase()}</Badge>
                      </div>
                      <p className="text-[11px] text-[#5E6A7C] font-medium truncate mt-0.5">{t.department}</p>
                      <p className="text-[10px] text-[#5E6A7C] mt-0.5">
                        Closing: {t.submission_deadline || t.bid_closing_date ? new Date(t.submission_deadline || t.bid_closing_date).toLocaleDateString('en-IN') : 'Completed'}
                      </p>
                    </div>
                    <div className="pt-2 flex items-center gap-1.5 border-t border-[#E3E7ED]">
                      <Button size="xs" variant="outline" className="flex-1" onClick={() => openTenderDetails(t)}>
                        Inspect
                      </Button>
                      <Button size="xs" variant="primary" className="flex-1" onClick={() => openOutcomeModal(t)}>
                        Record Verdict
                      </Button>
                    </div>
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
        <div className="space-y-6">
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
                <tbody className="divide-y divide-[#DCD8CE]">
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
                          <span className="font-semibold text-xs text-[#14213D] block">{issue.tender_no || 'Tender'}</span>
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
      {/* 5. Comprehensive Tender Detail Drawer / Modal */}
      {/* ========================================================================= */}
      <Modal
        isOpen={isDetailOpen}
        onClose={() => setIsDetailOpen(false)}
        title={selectedTender?.tender_number || selectedTender?.tender_no || 'Tender Specifications'}
        description={`Portal: ${selectedTender?.portal || 'GeM'} • Buyer: ${selectedTender?.department || selectedTender?.organisation_name || 'Government Department'}`}
        maxWidth="4xl"
      >
        {selectedTender && (
          <div className="space-y-6 text-xs">
            {/* Stage Progress Stepper */}
            <div className="p-3 rounded-xl bg-[#FBFAF7] border border-[#DCD8CE]">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-bold text-[#4A5568] uppercase tracking-wider">
                  Lifecycle Progress
                </span>
                <Badge
                  variant={
                    selectedTender.status === 'won'
                      ? 'success'
                      : selectedTender.status === 'lost' || selectedTender.status === 'rejected_internally'
                        ? 'danger'
                        : 'info'
                  }
                  size="sm"
                >
                  {selectedTender.status.replace(/_/g, ' ').toUpperCase()}
                </Badge>
              </div>

              {/* Visual State Tracker */}
              <div className="grid grid-cols-6 gap-1 text-center text-[10px] font-semibold">
                <div className={`p-1.5 rounded ${['identified', 'awaiting_approval', 'under_preparation', 'pq_submitted', 'pq_qualified', 'submitted', 'technical_eval', 'commercial_eval', 'won', 'lost'].includes(selectedTender.status) ? 'bg-[#0F5E63] text-white' : 'bg-slate-200 text-slate-500'}`}>
                  1. Identified
                </div>
                <div className={`p-1.5 rounded ${['awaiting_approval', 'under_preparation', 'pq_submitted', 'pq_qualified', 'submitted', 'technical_eval', 'commercial_eval', 'won', 'lost'].includes(selectedTender.status) ? 'bg-[#0F5E63] text-white' : 'bg-slate-200 text-slate-500'}`}>
                  2. Approval
                </div>
                <div className={`p-1.5 rounded ${['under_preparation', 'pq_submitted', 'pq_qualified', 'submitted', 'technical_eval', 'commercial_eval', 'won', 'lost'].includes(selectedTender.status) ? 'bg-[#0F5E63] text-white' : 'bg-slate-200 text-slate-500'}`}>
                  3. Preparation
                </div>
                <div className={`p-1.5 rounded ${['pq_submitted', 'pq_qualified', 'submitted', 'technical_eval', 'commercial_eval', 'won', 'lost'].includes(selectedTender.status) ? 'bg-[#0F5E63] text-white' : 'bg-slate-200 text-slate-500'}`}>
                  4. PQ Phase
                </div>
                <div className={`p-1.5 rounded ${['submitted', 'technical_eval', 'commercial_eval', 'won', 'lost'].includes(selectedTender.status) ? 'bg-[#0F5E63] text-white' : 'bg-slate-200 text-slate-500'}`}>
                  5. Submitted
                </div>
                <div className={`p-1.5 rounded ${['won', 'lost'].includes(selectedTender.status) ? (selectedTender.status === 'won' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white') : 'bg-slate-200 text-slate-500'}`}>
                  6. Result
                </div>
              </div>
            </div>

            {/* Modal Subtabs (Fixed Uniform Grid - Zero Shifting) */}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-1.5 p-1 bg-[#E3EFEE] border border-[#DCD8CE] rounded-xl select-none">
              <button
                type="button"
                onClick={() => setDetailTab('overview')}
                className={`flex items-center justify-center text-center py-2 px-2.5 rounded-lg font-semibold text-xs transition-all cursor-pointer ${detailTab === 'overview'
                    ? 'bg-white text-[#0F5E63] shadow-xs border border-[#DCD8CE]/80'
                    : 'text-[#4A5568] hover:text-[#14213D] hover:bg-white/60'
                  }`}
              >
                <span>Overview</span>
              </button>
              <button
                type="button"
                onClick={() => setDetailTab('approval')}
                className={`flex items-center justify-center text-center py-2 px-2.5 rounded-lg font-semibold text-xs transition-all cursor-pointer ${detailTab === 'approval'
                    ? 'bg-white text-[#0F5E63] shadow-xs border border-[#DCD8CE]/80'
                    : 'text-[#4A5568] hover:text-[#14213D] hover:bg-white/60'
                  }`}
              >
                <span>Approval</span>
              </button>
              <button
                type="button"
                onClick={() => setDetailTab('transitions')}
                className={`flex items-center justify-center text-center py-2 px-2.5 rounded-lg font-semibold text-xs transition-all cursor-pointer ${detailTab === 'transitions'
                    ? 'bg-white text-[#0F5E63] shadow-xs border border-[#DCD8CE]/80'
                    : 'text-[#4A5568] hover:text-[#14213D] hover:bg-white/60'
                  }`}
              >
                <span>Transitions</span>
              </button>
              <button
                type="button"
                onClick={() => setDetailTab('portal_issues')}
                className={`flex items-center justify-center text-center py-2 px-2.5 rounded-lg font-semibold text-xs transition-all cursor-pointer ${detailTab === 'portal_issues'
                    ? 'bg-white text-[#0F5E63] shadow-xs border border-[#DCD8CE]/80'
                    : 'text-[#4A5568] hover:text-[#14213D] hover:bg-white/60'
                  }`}
              >
                <span>Portal Issues</span>
                {portalIssues.length > 0 && (
                  <span className="ml-1.5 px-1.5 py-0.2 text-[10px] font-bold rounded-full bg-amber-100 text-amber-800">
                    {portalIssues.length}
                  </span>
                )}
              </button>
              <button
                type="button"
                onClick={() => setDetailTab('outcome')}
                className={`flex items-center justify-center text-center py-2 px-2.5 rounded-lg font-semibold text-xs transition-all cursor-pointer ${detailTab === 'outcome'
                    ? 'bg-white text-[#0F5E63] shadow-xs border border-[#DCD8CE]/80'
                    : 'text-[#4A5568] hover:text-[#14213D] hover:bg-white/60'
                  }`}
              >
                <span>Win / Loss</span>
              </button>
              <button
                type="button"
                onClick={() => setDetailTab('timeline')}
                className={`flex items-center justify-center text-center py-2 px-2.5 rounded-lg font-semibold text-xs transition-all cursor-pointer ${detailTab === 'timeline'
                    ? 'bg-white text-[#0F5E63] shadow-xs border border-[#DCD8CE]/80'
                    : 'text-[#4A5568] hover:text-[#14213D] hover:bg-white/60'
                  }`}
              >
                <span>Audit Trail</span>
                {activities.length > 0 && (
                  <span className="ml-1.5 px-1.5 py-0.2 text-[10px] font-bold rounded-full bg-[#E3EFEE] text-[#0F5E63]">
                    {activities.length}
                  </span>
                )}
              </button>
            </div>

            {/* Consistent Content Container: Prevents Modal Resizing / Jumping Across Tabs */}
            <div className="min-h-[400px] max-h-[460px] overflow-y-auto pr-1 custom-scrollbar space-y-4">
              {/* TAB 1: Overview Specifications (15+ Fields) */}
              {detailTab === 'overview' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3.5 rounded-xl bg-white border border-[#DCD8CE]">
                    <div>
                      <span className="text-[10px] text-[#4A5568] uppercase font-bold block">Tender Number</span>
                      <span className="font-bold text-xs text-[#14213D]">{selectedTender.tender_number || selectedTender.tender_no}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-[#4A5568] uppercase font-bold block">Portal</span>
                      <span className="font-semibold text-xs text-[#14213D]">{selectedTender.portal || 'GeM'}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-[#4A5568] uppercase font-bold block">Category</span>
                      <span className="font-semibold text-xs text-[#0F5E63]">
                        {selectedTender.category === 'pq' ? 'PQ' : selectedTender.category === 'general_mha' ? 'General / MHA' : selectedTender.category || 'Standard'}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] text-[#4A5568] uppercase font-bold block">Estimated Value</span>
                      <span className="font-bold text-xs text-emerald-700">
                        {selectedTender.estimated_value_lakh ? `₹ ${selectedTender.estimated_value_lakh} Lakh` : selectedTender.tender_value ? `₹ ${(selectedTender.tender_value / 100000).toFixed(2)} Lakh` : 'Not Specified'}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3.5 rounded-xl bg-white border border-[#DCD8CE]">
                    <div>
                      <span className="text-[10px] text-[#4A5568] uppercase font-bold block">Buyer Department</span>
                      <span className="font-semibold text-xs text-[#14213D]">{selectedTender.department || 'N/A'}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-[#4A5568] uppercase font-bold block">Mapped Organisation</span>
                      <span className="font-semibold text-xs text-[#14213D]">{selectedTender.organisation_name || 'Direct Buyer'}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-[#4A5568] uppercase font-bold block">Territory Zone</span>
                      <span className="font-semibold text-xs text-[#14213D]">{selectedTender.zone || selectedTender.zone_name || 'North'}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-[#4A5568] uppercase font-bold block">Territory Region</span>
                      <span className="font-semibold text-xs text-[#14213D]">{selectedTender.region || selectedTender.region_name || 'Delhi NCR'}</span>
                    </div>
                  </div>

                  <div className="p-3.5 rounded-xl bg-white border border-[#DCD8CE] space-y-2">
                    <span className="text-[10px] text-[#4A5568] uppercase font-bold block">Product Requirement & Technical Scope</span>
                    <p className="text-xs text-[#14213D] leading-relaxed">{selectedTender.requirement_text || 'No technical specifications logged.'}</p>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3.5 rounded-xl bg-white border border-[#DCD8CE]">
                    <div>
                      <span className="text-[10px] text-[#4A5568] uppercase font-bold block">Publication Date</span>
                      <span className="font-semibold text-xs text-[#14213D]">
                        {selectedTender.publication_date ? new Date(selectedTender.publication_date).toLocaleDateString('en-IN') : 'N/A'}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] text-[#4A5568] uppercase font-bold block">Submission Deadline</span>
                      <span className="font-bold text-xs text-red-700">
                        {selectedTender.submission_deadline || selectedTender.bid_closing_date ? new Date(selectedTender.submission_deadline || selectedTender.bid_closing_date).toLocaleDateString('en-IN') : 'N/A'}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] text-[#4A5568] uppercase font-bold block">Assigned Salesperson</span>
                      <span className="font-semibold text-xs text-[#14213D]">{selectedTender.assigned_person_name || 'Unassigned'}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-[#4A5568] uppercase font-bold block">Tender Owner</span>
                      <span className="font-semibold text-xs text-[#14213D]">{selectedTender.owner_name || selectedTender.assigned_person_name || 'Unassigned'}</span>
                    </div>
                  </div>

                  {selectedTender.remarks && (
                    <div className="p-3 rounded-lg bg-slate-50 border border-[#DCD8CE] text-xs text-[#4A5568]">
                      <strong>Remarks:</strong> {selectedTender.remarks}
                    </div>
                  )}
                </div>
              )}

              {/* TAB 2: Approval & Dual-Control Signoff */}
              {detailTab === 'approval' && (
                <div className="space-y-4">
                  <SectionHeader
                    title="Dual-Control Management Approval"
                    description="Pre-participation qualification signoff required before preparing commercial documents"
                  />

                  {/* Commercial Context Card */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3.5 rounded-xl bg-[#FBFAF7] border border-[#DCD8CE]">
                    <div>
                      <span className="text-[10px] text-[#4A5568] uppercase font-bold block">Tender Number</span>
                      <span className="font-bold text-xs text-[#14213D]">{selectedTender.tender_number || selectedTender.tender_no}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-[#4A5568] uppercase font-bold block">Buyer Organisation</span>
                      <span className="font-semibold text-xs text-[#14213D]">{selectedTender.organisation_name || selectedTender.department || 'Direct Buyer'}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-[#4A5568] uppercase font-bold block">Opportunity Type</span>
                      <span className="font-semibold text-xs text-[#0F5E63]">
                        {selectedTender.category === 'pq' ? 'PQ Tender' : selectedTender.category === 'general_mha' ? 'General / MHA' : selectedTender.category || 'Standard'}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] text-[#4A5568] uppercase font-bold block">Estimated Value</span>
                      <span className="font-bold text-xs text-emerald-700">
                        {selectedTender.estimated_value_lakh ? `₹ ${selectedTender.estimated_value_lakh} Lakh` : 'Not Specified'}
                      </span>
                    </div>
                  </div>

                  {selectedTender.status === 'awaiting_approval' || selectedTender.status === 'identified' ? (
                    <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 space-y-3">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="h-5 w-5 text-amber-600" />
                        <span className="font-bold text-xs text-amber-900">
                          {selectedTender.status === 'identified'
                            ? 'This tender is in Identified stage. Executive management can directly review, endorse participation, and mobilize bid preparation.'
                            : 'This tender requires formal management endorsement before bid preparation can begin.'}
                        </span>
                      </div>

                      <div className="flex items-center gap-2 pt-2">
                        <Button
                          size="sm"
                          variant="primary"
                          onClick={() => {
                            setApprovalDecision('approved');
                            setIsApproveOpen(true);
                          }}
                          leftIcon={<Check className="h-4 w-4" />}
                        >
                          Approve & Start Preparation
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={() => {
                            setApprovalDecision('rejected');
                            setIsApproveOpen(true);
                          }}
                          leftIcon={<X className="h-4 w-4" />}
                        >
                          Reject Participation
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="p-4 rounded-xl bg-white border border-[#DCD8CE] space-y-2">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                        <span className="font-bold text-xs text-[#14213D]">
                          Current Stage: {selectedTender.status.replace(/_/g, ' ').toUpperCase()}
                        </span>
                      </div>
                      {selectedTender.internal_approval_at && (
                        <p className="text-[11px] text-[#4A5568]">
                          Decision recorded on {new Date(selectedTender.internal_approval_at).toLocaleString('en-IN')}.
                        </p>
                      )}
                    </div>
                  )}

                  <div className="p-3.5 rounded-xl bg-white border border-[#DCD8CE] space-y-1.5">
                    <span className="text-[10px] text-[#4A5568] uppercase font-bold block">Dual-Control Governance Standard</span>
                    <p className="text-xs text-[#4A5568] leading-relaxed">
                      Participation in government and defence tenders must receive dual-control signoff from authorized Regional Managers or executive leadership before commercial packet preparation, financial earnest money deposits (EMD), and technical compliance drafting begin.
                    </p>
                  </div>
                </div>
              )}

              {/* TAB 3: Workflow Transitions */}
              {detailTab === 'transitions' && (
                <div className="space-y-4">
                  <SectionHeader
                    title="Available Stage Transitions"
                    description="Strict stage progression governed by tender state machine"
                  />

                  {/* Lifecycle Status Summary */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3.5 rounded-xl bg-[#FBFAF7] border border-[#DCD8CE]">
                    <div>
                      <span className="text-[10px] text-[#4A5568] uppercase font-bold block">Current Stage</span>
                      <Badge variant="cyber" size="sm">{selectedTender.status.replace(/_/g, ' ').toUpperCase()}</Badge>
                    </div>
                    <div>
                      <span className="text-[10px] text-[#4A5568] uppercase font-bold block">Opportunity Type</span>
                      <span className="font-semibold text-xs text-[#14213D]">{selectedTender.category?.toUpperCase() || 'STANDARD'}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-[#4A5568] uppercase font-bold block">Submission Deadline</span>
                      <span className="font-bold text-xs text-red-700">
                        {selectedTender.submission_deadline || selectedTender.bid_closing_date ? new Date(selectedTender.submission_deadline || selectedTender.bid_closing_date).toLocaleDateString('en-IN') : 'N/A'}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] text-[#4A5568] uppercase font-bold block">Assigned Lead</span>
                      <span className="font-semibold text-xs text-[#0F5E63]">{selectedTender.assigned_person_name || selectedTender.owner_name || 'Assigned Team'}</span>
                    </div>
                  </div>

                  <div className="p-4 rounded-xl bg-white border border-[#DCD8CE] space-y-3">
                    <span className="text-xs text-[#4A5568] font-semibold block">
                      Permitted Stage Advancements:
                    </span>
                    <div className="flex flex-wrap gap-2">
                      {getAllowedTransitions(selectedTender.status, selectedTender.category).length === 0 ? (
                        <p className="text-xs text-[#4A5568]">
                          Terminal state reached. No further transitions permitted for this opportunity.
                        </p>
                      ) : (
                        getAllowedTransitions(selectedTender.status, selectedTender.category).map((tr) => (
                          <Button
                            key={tr.status}
                            size="sm"
                            variant="secondary"
                            onClick={() => {
                              setTargetTransitionStatus(tr.status);
                              setTransitionRemarks(`Transitioned to ${tr.label}`);
                              setIsTransitionOpen(true);
                            }}
                            leftIcon={<ArrowRight className="h-3.5 w-3.5" />}
                          >
                            {tr.label}
                          </Button>
                        ))
                      )}
                    </div>
                  </div>

                  <div className="p-3.5 rounded-xl bg-white border border-[#DCD8CE] space-y-1.5">
                    <span className="text-[10px] text-[#4A5568] uppercase font-bold block">Lifecycle Governance & Procedural Flow</span>
                    <p className="text-xs text-[#4A5568] leading-relaxed">
                      Stage advancements strictly follow Arihant BOS state machine constraints. Illegal skipping of quality gates (such as moving from Under Preparation directly to Won without bid submission) is programmatically prohibited.
                    </p>
                  </div>
                </div>
              )}

              {/* TAB 4: External Portal Issues Tracker (§25) */}
              {detailTab === 'portal_issues' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <SectionHeader
                      title="GeM / External Portal Issues Tracker (§25)"
                      description="Internal tracker for portal glitches. Note: BOS records the issue only; portal functionality is outside BOS scope."
                    />
                    <Button
                      size="xs"
                      variant="primary"
                      onClick={() => openNewIssueModal(selectedTender)}
                      leftIcon={<Plus className="h-3.5 w-3.5" />}
                    >
                      Log Portal Issue
                    </Button>
                  </div>

                  {portalIssues.length === 0 ? (
                    <div className="p-8 rounded-xl bg-slate-50 border border-[#DCD8CE] text-center text-xs text-[#4A5568] space-y-2">
                      <CheckCircle2 className="h-8 w-8 text-emerald-600 mx-auto" />
                      <p className="font-semibold text-xs text-[#14213D]">No External Portal Glitches Logged</p>
                      <p className="text-[11px] text-[#4A5568]">
                        Document uploads, DSC token authentication, and BoQ requirements are functioning normally.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {portalIssues.map((issue) => (
                        <div
                          key={issue.id}
                          className="p-3.5 rounded-xl bg-white border border-[#DCD8CE] space-y-2 hover:border-[#0F5E63] transition-all"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <span className="font-semibold text-xs text-[#14213D] block">
                                {issue.issue}
                              </span>
                              <span className="text-[10px] text-[#4A5568]">
                                Reported on {new Date(issue.reported_date || issue.created_at).toLocaleDateString('en-IN')} by {issue.reporter_name || 'Tender Team'}
                              </span>
                            </div>
                            <Badge
                              variant={
                                issue.resolution_status?.toLowerCase() === 'resolved' || issue.resolution_status?.toLowerCase() === 'closed'
                                  ? 'success'
                                  : issue.resolution_status?.toLowerCase() === 'escalated'
                                    ? 'danger'
                                    : 'warning'
                              }
                              size="sm"
                            >
                              {issue.resolution_status?.toUpperCase()}
                            </Badge>
                          </div>

                          {issue.escalated_to && (
                            <div className="text-[11px] text-amber-800 bg-amber-50 p-2 rounded border border-amber-200">
                              <strong>Escalated to:</strong> {issue.escalated_to}
                            </div>
                          )}

                          {issue.resolution && (
                            <div className="text-[11px] text-emerald-800 bg-emerald-50 p-2 rounded border border-emerald-200">
                              <strong>Resolution:</strong> {issue.resolution}
                            </div>
                          )}

                          {!['resolved', 'closed'].includes(issue.resolution_status?.toLowerCase()) && (
                            <div className="flex items-center gap-2 pt-1">
                              {!['escalated'].includes(issue.resolution_status?.toLowerCase()) && (
                                <Button
                                  size="xs"
                                  variant="outline"
                                  onClick={() => handleUpdateIssueStatus(selectedTender.id, issue.id, 'escalated')}
                                >
                                  Escalate to Desk
                                </Button>
                              )}
                              <Button
                                size="xs"
                                variant="secondary"
                                onClick={() => {
                                  const res = prompt('Enter resolution description:');
                                  if (res) handleUpdateIssueStatus(selectedTender.id, issue.id, 'resolved', res);
                                }}
                              >
                                Mark Resolved
                              </Button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* TAB 5: Win / Loss Outcome Verdict (§26) */}
              {detailTab === 'outcome' && (
                <div className="space-y-4">
                  <SectionHeader
                    title="Final Commercial Outcome Analysis (§26)"
                    description="Structured post-bid intelligence for win rate calculation and loss pattern tracking"
                  />

                  {selectedTender.result ? (
                    <div className="p-4 rounded-xl bg-white border border-[#DCD8CE] space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {selectedTender.result === 'won' ? (
                            <Award className="h-6 w-6 text-emerald-600" />
                          ) : (
                            <XCircle className="h-6 w-6 text-red-600" />
                          )}
                          <div>
                            <span className="text-sm font-black uppercase text-[#14213D]">
                              Final Result: {selectedTender.result}
                            </span>
                            <span className="text-[10px] text-[#4A5568] block">
                              Declared on {selectedTender.result_date ? new Date(selectedTender.result_date).toLocaleDateString('en-IN') : 'N/A'}
                            </span>
                          </div>
                        </div>
                        <Badge
                          variant={selectedTender.result === 'won' ? 'success' : 'danger'}
                          size="sm"
                        >
                          {selectedTender.result.toUpperCase()}
                        </Badge>
                      </div>

                      <div className="grid grid-cols-2 gap-3 p-3 rounded-lg bg-[#FBFAF7] border border-[#DCD8CE]">
                        <div>
                          <span className="text-[10px] text-[#4A5568] uppercase font-bold block">
                            Contract Award Value
                          </span>
                          <span className="font-semibold text-xs text-[#14213D]">
                            {selectedTender.value_lakh ? `₹ ${selectedTender.value_lakh} Lakh` : selectedTender.tender_value ? `₹ ${(selectedTender.tender_value / 100000).toFixed(2)} Lakh` : 'Not recorded'}
                          </span>
                        </div>
                        <div>
                          <span className="text-[10px] text-[#4A5568] uppercase font-bold block">
                            Winning Competitor
                          </span>
                          <span className="font-semibold text-xs text-[#14213D]">
                            {selectedTender.competitor || 'Arihant (Direct Award)'}
                          </span>
                        </div>
                      </div>

                      {selectedTender.outcome_reason && (
                        <div className="p-2.5 rounded-lg bg-slate-50 border border-[#DCD8CE] text-xs text-gray-800">
                          <strong>Structured Post-Mortem Intelligence:</strong> {selectedTender.outcome_reason}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3.5 rounded-xl bg-[#FBFAF7] border border-[#DCD8CE]">
                        <div>
                          <span className="text-[10px] text-[#4A5568] uppercase font-bold block">Tender Number</span>
                          <span className="font-bold text-xs text-[#14213D]">{selectedTender.tender_number || selectedTender.tender_no}</span>
                        </div>
                        <div>
                          <span className="text-[10px] text-[#4A5568] uppercase font-bold block">Current Stage</span>
                          <Badge variant="cyber" size="sm">{selectedTender.status.replace(/_/g, ' ').toUpperCase()}</Badge>
                        </div>
                        <div>
                          <span className="text-[10px] text-[#4A5568] uppercase font-bold block">Estimated Value</span>
                          <span className="font-bold text-xs text-emerald-700">
                            {selectedTender.estimated_value_lakh ? `₹ ${selectedTender.estimated_value_lakh} Lakh` : 'Not Specified'}
                          </span>
                        </div>
                        <div>
                          <span className="text-[10px] text-[#4A5568] uppercase font-bold block">Verdict Status</span>
                          <span className="font-semibold text-xs text-amber-700">Pending Declaration</span>
                        </div>
                      </div>

                      <div className="p-6 rounded-xl bg-white border border-[#DCD8CE] space-y-3 text-center">
                        <p className="text-xs text-[#4A5568]">
                          Commercial verdict has not been recorded yet. You can mark this tender as Won or Lost once the buyer declares final evaluation.
                        </p>
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => setIsOutcomeOpen(true)}
                          leftIcon={<Award className="h-4 w-4" />}
                        >
                          Record Commercial Verdict (Won / Lost)
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* TAB 6: Audit History & Activity Timeline */}
              {detailTab === 'timeline' && (
                <div className="space-y-3">
                  <SectionHeader
                    title="Activity Audit Trail"
                    description="Complete audit trail of all state transitions and management interventions"
                  />

                  {activities.length === 0 ? (
                    <div className="p-6 rounded-xl bg-slate-50 border border-[#DCD8CE] text-center text-xs text-[#4A5568]">
                      No activity records found for this tender.
                    </div>
                  ) : (
                    <div className="relative pl-4 border-l-2 border-[#DCD8CE] space-y-4 my-2">
                      {activities.map((act) => (
                        <div key={act.id} className="relative">
                          <div className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-[#0F5E63] border-2 border-white ring-2 ring-[#DCD8CE]" />
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="font-bold text-[#14213D]">{act.description}</span>
                            <span className="text-[10px] text-[#4A5568]">
                              {new Date(act.created_at).toLocaleString('en-IN')}
                            </span>
                          </div>
                          <span className="text-[10px] text-[#4A5568]">By {act.performed_by_name || 'System Operator'}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* ========================================================================= */}
      {/* 6. Register New Tender Modal (All 15+ North Tender Sheet Fields) */}
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
              value={newTender.assigned_person_id}
              onChange={(e) => setNewTender({ ...newTender, assigned_person_id: e.target.value })}
            >
              <option value="">-- Assign Salesperson --</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.full_name} ({u.role?.replace(/_/g, ' ')})
                </option>
              ))}
            </Select>

            <Select
              label="Tender Owner (Responsible Executive)"
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
      {/* 7. Dual-Control Approval Modal */}
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
      {/* 8. Stage Transition Modal */}
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
      {/* 9. Final Structured Outcome (Won / Lost) Modal (§26) */}
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

              <div className="p-3 bg-[#F8FAFC] rounded-lg border border-[#DCD8CE] space-y-2">
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
      {/* 10. Log External Portal Issue Modal (§25) */}
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
    </PageContainer>
  );
}
