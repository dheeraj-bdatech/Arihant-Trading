'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Target,
  Search,
  Plus,
  Building,
  User,
  Phone,
  Mail,
  Calendar,
  Clock,
  ChevronRight,
  Filter,
  RefreshCw,
  FileText,
  CheckCircle,
  AlertTriangle,
  ArrowRight,
  TrendingUp,
  Award,
  Layers,
  Sparkles,
  ExternalLink,
  MapPin,
  Tag,
  Paperclip,
  Check,
  X,
  Send,
  MessageSquare,
  Users,
  ShieldCheck,
  Briefcase,
  Compass,
  DollarSign,
  AlertCircle,
  Eye,
  Edit,
  History,
  Activity,
  UserCheck,
  CalendarDays,
  CheckCircle2,
  Bell,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';
import {
  Button,
  Badge,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Modal,
  Input,
  Select,
  Textarea,
  Tabs,
  EmptyState,
  PageHeader,
  StatCard,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell, Spinner, ToolbarBox, ToolbarSlot, PageLoader } from '@/components/ui';
import { formatLakh, LeadStatus, LeadCategory, LeadType, LeadLossReason, InteractionType, FollowUpStatus } from '@arihant/shared';

const LEAD_CATEGORY_OPTIONS: { value: LeadCategory; label: string }[] = [
  { value: 'new_lead', label: 'New Lead' },
  { value: 'active', label: 'Active Pipeline' },
  { value: 'expected', label: 'Expected Deal' },
  { value: 'follow_up', label: 'Follow-up' },
];

const SECTOR_OPTIONS = [
  { value: 'Defence', label: 'Defence (Army / Navy / Air Force)' },
  { value: 'Police / Paramilitary', label: 'Police / Paramilitary (CRPF, BSF, CISF, ITBP, SSB)' },
  { value: 'State Police', label: 'State Police & Special Forces' },
  { value: 'Railways', label: 'Railways & Metro Transit' },
  { value: 'Security / Intelligence', label: 'Intelligence & Security Agencies' },
  { value: 'Nuclear & Energy', label: 'Nuclear, Power & Critical Infrastructure' },
  { value: 'Aviation & Airports', label: 'Aviation & Airport Security' },
  { value: 'Prisons & Correctional', label: 'Prisons & Correctional Services' },
  { value: 'PSU / Government', label: 'Public Sector Undertaking (PSU) / Govt' },
  { value: 'Corporate Security', label: 'Corporate & Industrial Security' },
  { value: 'Other', label: 'Other Sector' },
];

const LEAD_SOURCE_OPTIONS = [
  { value: 'field_visit', label: 'Field Visit / On-Site' },
  { value: 'gem_portal', label: 'GeM Portal (Government e-Marketplace)' },
  { value: 'tender', label: 'Tender / E-Procurement Portal' },
  { value: 'referral', label: 'Referral / Recommendation' },
  { value: 'exhibition', label: 'Exhibition / Defense Expo' },
  { value: 'cold_outreach', label: 'Cold Outreach' },
  { value: 'website', label: 'Inbound / Company Website' },
  { value: 'partner', label: 'OEM / Partner Channel' },
];

const LEAD_STATUS_OPTIONS: { value: LeadStatus; label: string }[] = [
  { value: 'new', label: 'New / Inquired' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'qualified', label: 'Qualified' },
  { value: 'follow_up', label: 'Follow-up Active' },
  { value: 'demo', label: 'Demo Scheduled' },
  { value: 'proposal', label: 'Proposal / Quoted' },
  { value: 'tender_discussion', label: 'Tender Discussion' },
  { value: 'negotiation', label: 'Commercial Negotiation' },
  { value: 'converted', label: 'Converted / Won' },
  { value: 'on_hold', label: 'On Hold' },
  { value: 'dropped', label: 'Dropped / Lost' },
];

const INTERACTION_TYPE_OPTIONS = [
  { value: 'call', label: 'Phone Call' },
  { value: 'physical_visit', label: 'Physical Visit' },
  { value: 'meeting', label: 'In-person Meeting' },
  { value: 'email', label: 'Email Correspondence' },
  { value: 'whatsapp', label: 'WhatsApp Message' },
  { value: 'demo', label: 'Demonstration / Trial' },
  { value: 'other', label: 'Other Touchpoint' },
];

// Specific Demo Kit standard accessories mapping
const getStandardKitAccessories = (productName?: string, category?: string) => {
  const p = (productName || '').toLowerCase();
  const c = (category || '').toLowerCase();

  if (p.includes('metal detector') || p.includes('hhmd') || p.includes('dfmd') || c.includes('metal')) {
    return [
      'Rugged flight case with custom high-density EVA foam',
      '2x Rechargeable NiMH battery packs + desktop cradle charger',
      'Standard MHA test calibration piece & test knife sample',
      'Ballistic nylon belt holster & safety wrist lanyard',
      'Factory sensitivity verification & calibration certificate',
    ];
  }
  if (p.includes('thermal') || p.includes('ti-') || p.includes('infrared') || c.includes('thermal')) {
    return [
      'Hermetic waterproof IP67 hard carrying case',
      '2x High-capacity Li-ion batteries + AC/DC field charger',
      'High-speed HDMI / Video-out cable for command viewing',
      'Optical microfiber lens cleaning kit & protective cap',
      'Field survey tripod with quick-release mounting plate',
      'Thermal resolution test target & calibration report',
    ];
  }
  if (p.includes('night vision') || p.includes('monocular') || p.includes('nvm') || c.includes('night vision')) {
    return [
      'Mil-spec Pelican protective case with desiccants',
      'Combat helmet mount shroud & skull crusher harness',
      'Sacrificial protective objective window & demist shield',
      'Dual AA battery adapter cartridge & lens cleaning pen',
      'Infrared (IR) covert test target card',
      'OEM optical resolution test & FOM certification dossier',
    ];
  }
  if (p.includes('breath') || p.includes('alco') || c.includes('analyser')) {
    return [
      'Hard carrying case with molded foam insert',
      '100x Individually wrapped sterile sampling mouthpieces',
      'Wireless Bluetooth mobile receipt printer + 5 paper rolls',
      'Rechargeable battery pack & vehicle 12V auxiliary charger',
      'Gas sensor calibration & verification test certificate',
    ];
  }
  if (p.includes('barrier') || p.includes('boom') || p.includes('bollard') || c.includes('barrier')) {
    return [
      'Skid-mounted live demonstration barrier unit',
      'Electro-hydraulic power unit (HPU) demo control console',
      'Dual optical safety photocell sensor kit',
      'Remote RF transmitter key fob controller (2 units)',
      'Crash rating structural impact dossier & wiring schematic',
    ];
  }
  return [
    'Original ruggedized transit & deployment case',
    'Standard AC power supply adapter (230V / 50Hz)',
    'Full accessory connection wiring & interface harness',
    'Certified demonstration verification sample kit',
    'OEM operational manual and calibration compliance card',
  ];
};

export default function LeadsPage() {
  const { user, hasRole, switchRole } = useAuth();
  const canReassign = hasRole(['management', 'regional_manager', 'admin']);
  const [isSwitchingPersona, setIsSwitchingPersona] = useState(false);

  // Quick switch role handler for modal self-service
  const handleQuickSwitchRole = async (role: 'regional_manager' | 'management') => {
    try {
      setIsSwitchingPersona(true);
      setFormError(null);
      await switchRole(role);
    } catch (err: any) {
      setFormError('Failed to switch persona: ' + (err.message || 'Unknown error'));
    } finally {
      setIsSwitchingPersona(false);
    }
  };

  // Active Workspace Tab: 'leads' | 'customers' | 'followups' | 'reports'
  const [activeTab, setActiveTab] = useState<string>('leads');

  // Master Data
  const [productsList, setProductsList] = useState<any[]>([]);
  const [sectorsList, setSectorsList] = useState<any[]>([]);
  const [usersList, setUsersList] = useState<any[]>([]);
  const [zonesList, setZonesList] = useState<any[]>([]);
  const [regionsList, setRegionsList] = useState<any[]>([]);
  const [demoEquipmentList, setDemoEquipmentList] = useState<any[]>([]);
  const [leadDemoTeamAvailability, setLeadDemoTeamAvailability] = useState<any[]>([]);
  const [isLoadingLeadTeamAvailability, setIsLoadingLeadTeamAvailability] = useState(false);
  const [organisationsList, setOrganisationsList] = useState<any[]>([]);

  // 1. Leads State
  const [leads, setLeads] = useState<any[]>([]);
  const [leadsTotal, setLeadsTotal] = useState(0);
  const [leadsPage, setLeadsPage] = useState(1);
  const [leadsLimit, setLeadsLimit] = useState(50);
  const [leadsTotalPages, setLeadsTotalPages] = useState(1);
  const [leadsLoading, setLeadsLoading] = useState(true);
  const [leadFilters, setLeadFilters] = useState({
    search: '',
    lead_status: '',
    lead_type: '',
    sector: '',
    lead_source: '',
  });

  // 2. Customers / Organisations State
  const [customers, setCustomers] = useState<any[]>([]);
  const [customersTotal, setCustomersTotal] = useState(0);
  const [totalCustomersCount, setTotalCustomersCount] = useState(0);
  const [customersPage, setCustomersPage] = useState(1);
  const [customersTotalPages, setCustomersTotalPages] = useState(1);
  const [customersLoading, setCustomersLoading] = useState(false);
  const [customerSearch, setCustomerSearch] = useState('');

  // 3. Follow-ups Desk State
  const [followups, setFollowups] = useState<any[]>([]);
  const [followupsLoading, setFollowupsLoading] = useState(false);
  const [followupTimeframe, setFollowupTimeframe] = useState<string>('all');

  // 4. Executive Metrics HUD State
  const [leadStats, setLeadStats] = useState<any | null>(null);
  const [followupStats, setFollowupStats] = useState<any | null>(null);

  // 5. Executive Reports State
  const [reportSubTab, setReportSubTab] = useState<string>('salesperson');
  const [salespersonReport, setSalespersonReport] = useState<any[]>([]);
  const [zoneReport, setZoneReport] = useState<any[]>([]);
  const [productReport, setProductReport] = useState<any[]>([]);
  const [interactionReport, setInteractionReport] = useState<any[]>([]);
  const [reportsLoading, setReportsLoading] = useState(false);

  // Modal Dialogs State
  const [isCreateLeadOpen, setIsCreateLeadOpen] = useState(false);
  const [isLeadDetailOpen, setIsLeadDetailOpen] = useState(false);
  const [isLogInteractionOpen, setIsLogInteractionOpen] = useState(false);
  const [isCustomer360Open, setIsCustomer360Open] = useState(false);
  const [isStatusModalOpen, setIsStatusModalOpen] = useState(false);
  const [isReassignModalOpen, setIsReassignModalOpen] = useState(false);
  const [isCompleteFollowupOpen, setIsCompleteFollowupOpen] = useState(false);
  const [isRescheduleFollowupOpen, setIsRescheduleFollowupOpen] = useState(false);

  // Selected Entities
  const [selectedLead, setSelectedLead] = useState<any | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<any | null>(null);
  const [customerTimeline, setCustomerTimeline] = useState<any[]>([]);
  const [customerContacts, setCustomerContacts] = useState<any[]>([]);
  const [customerLeads, setCustomerLeads] = useState<any[]>([]);
  const [customerTimelineLoading, setCustomerTimelineLoading] = useState(false);
  const [customerManagementSummary, setCustomerManagementSummary] = useState<any | null>(null);
  const [c360Tab, setC360Tab] = useState<'management' | 'timeline' | 'contacts' | 'deals'>('management');
  const [selectedFollowup, setSelectedFollowup] = useState<any | null>(null);

  // Form States
  const [actionLoading, setActionLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [createLeadError, setCreateLeadError] = useState<string | null>(null);

  // Create Lead Form (Complete 18 Parameters)
  const [leadForm, setLeadForm] = useState({
    organisation_mode: 'new' as 'new' | 'existing',
    organisation_id: '',
    organisation_name: '',
    department: '',
    city: '',
    state: '',
    zone_id: '',
    region_id: '',
    sector: '',
    contact_name: '',
    contact_designation: '',
    contact_mobile: '',
    contact_email: '',
    product_ids: [] as string[],
    source: 'field_visit',
    category: 'new_lead' as LeadCategory,
    assigned_to: '',
    regional_manager_id: '',
    remarks: '',
    lead_status: 'new' as LeadStatus,
    last_interaction_date: new Date().toISOString().split('T')[0],
    last_interaction_type: 'call',
    next_followup_date: '',
    value_lakh: '',
  });

  // Filter regions based on currently selected zone
  const filteredRegions = useMemo(() => {
    if (!leadForm.zone_id) return regionsList;
    return regionsList.filter((r) => r.zone_id === leadForm.zone_id);
  }, [regionsList, leadForm.zone_id]);

  const handleSalespersonChange = (userId: string) => {
    const selectedUser = usersList.find((u) => u.id === userId);
    setLeadForm((prev) => ({
      ...prev,
      assigned_to: userId,
      regional_manager_id: selectedUser?.reporting_manager_id || prev.regional_manager_id,
    }));
  };

  const handleZoneChange = (zoneId: string) => {
    setLeadForm((prev) => {
      const isRegionInZone = regionsList.some((r) => r.id === prev.region_id && r.zone_id === zoneId);
      return {
        ...prev,
        zone_id: zoneId,
        region_id: isRegionInZone ? prev.region_id : '',
      };
    });
  };

  const handleSelectExistingOrg = async (orgId: string) => {
    const found = organisationsList.find((o) => o.id === orgId) || customers.find((c) => c.id === orgId);
    setLeadForm((prev) => ({
      ...prev,
      organisation_id: orgId,
      organisation_name: found?.name || prev.organisation_name,
      city: found?.city || prev.city,
      state: found?.state || prev.state,
      zone_id: found?.zone_id || prev.zone_id,
      region_id: found?.region_id || prev.region_id,
      sector: found?.sector || prev.sector,
    }));

    if (orgId) {
      try {
        const contacts = await api.get(`/contacts?organisation_id=${orgId}`);
        const cList = Array.isArray(contacts) ? contacts : contacts?.data || [];
        if (cList.length > 0) {
          const primary = cList.find((c: any) => c.is_primary) || cList[0];
          setLeadForm((prev) => ({
            ...prev,
            contact_name: primary.full_name || primary.name || '',
            contact_designation: primary.designation || '',
            contact_mobile: primary.mobile || primary.phone || '',
            contact_email: primary.email || '',
          }));
        }
      } catch (err) {
        // preserve current contact info
      }
    }
  };

  // Live Duplicate Detection Results
  const [duplicateMatches, setDuplicateMatches] = useState<any[]>([]);
  const [duplicateSuggestion, setDuplicateSuggestion] = useState<string | null>(null);
  const [isCheckingDuplicate, setIsCheckingDuplicate] = useState(false);

  // Change Status Form
  const [targetStatus, setTargetStatus] = useState<string>('');
  const [lossReason, setLossReason] = useState<string>('price');
  const [lossRemarks, setLossRemarks] = useState<string>('');

  // Reassign Salesperson Form
  const [newSalespersonId, setNewSalespersonId] = useState<string>('');
  const [reassignReason, setReassignReason] = useState<string>('');

  // Add Interaction Form
  const [interactionForm, setInteractionForm] = useState({
    lead_id: '',
    organisation_id: '',
    contact_id: '',
    type: 'call',
    date: new Date().toISOString().split('T')[0],
    notes: '',
    outcome: '',
    next_action: '',
    next_followup_date: '',
    attachment_title: '',
    attachment_url: '',
  });

  // Follow-up Completion Form
  const [completionOutcome, setCompletionOutcome] = useState('');
  const [completionRemarks, setCompletionRemarks] = useState('');
  const [scheduleNextFollowup, setScheduleNextFollowup] = useState(false);
  const [nextFollowupDueDate, setNextFollowupDueDate] = useState('');

  // Action Success Toast
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Demo Transition Modal State
  const [isDemoModalOpen, setIsDemoModalOpen] = useState(false);
  const [demoForm, setDemoForm] = useState({
    requested_date: new Date(Date.now() + 86400000).toISOString().split('T')[0],
    requested_time: '11:00',
    product_id: '',
    assigned_to: '',
    location: '',
    purpose: 'Live equipment demonstration & spec validation',
    expected_audience: 'Procurement Committee & Technical Officers',
    equipment_required: '',
    custom_accessories: '',
    auto_remind: true,
    reminder_notes: 'Please bring calibrated demonstration unit and client sign-off sheet.',
  });

  // Active selected equipment unit for Leads Demo Modal
  const selectedLeadEquipUnit = useMemo(() => {
    if (!demoForm.equipment_required || demoForm.equipment_required === 'custom') return null;
    return (demoEquipmentList || []).find(
      (item) => `${item.model} | S/N: ${item.serial_no} (${item.current_location} Depot)` === demoForm.equipment_required
        || item.serial_no === demoForm.equipment_required
        || item.id === demoForm.equipment_required
    ) || null;
  }, [demoEquipmentList, demoForm.equipment_required]);

  // Active product fleet availability breakdown for Leads Demo Modal
  const activeLeadDemoFleet = useMemo(() => {
    const pId = demoForm.product_id;
    if (!pId) return null;
    const productUnits = (demoEquipmentList || []).filter((e) => e.product_id === pId);
    const available = productUnits.filter((e) => e.availability_status === 'available');
    const reserved = productUnits.filter((e) => e.availability_status === 'reserved' || e.availability_status === 'in_use');
    const maintenance = productUnits.filter((e) => e.availability_status === 'maintenance');
    const locations = Array.from(new Set(available.map((e) => e.current_location).filter(Boolean)));

    return {
      total: productUnits.length,
      availableCount: available.length,
      reservedCount: reserved.length,
      maintenanceCount: maintenance.length,
      availableUnits: available,
      locations,
      units: productUnits,
    };
  }, [demoEquipmentList, demoForm.product_id]);

  // Options for registered demo equipment models for Leads Demo Modal
  const leadRegisteredEquipmentOptions = useMemo(() => {
    const list = demoEquipmentList || [];
    const activeProductId = demoForm.product_id;

    const matched = activeProductId ? list.filter((e) => e.product_id === activeProductId) : [];
    const others = activeProductId ? list.filter((e) => e.product_id !== activeProductId) : list;

    const opts: { value: string; label: string }[] = [
      { value: '', label: '-- Choose Registered Demo Model & Serial --' },
    ];

    const formatOptLabel = (e: any, isStar = false) => {
      const isAvail = e.availability_status === 'available';
      const isReserved = e.availability_status === 'reserved' || e.availability_status === 'in_use';
      const isMaint = e.availability_status === 'maintenance';

      const statusTag = isAvail
        ? '🟢 [AVAILABLE]'
        : isReserved
        ? `🟡 [RESERVED${e.reserved_until ? ` to ${new Date(e.reserved_until).toLocaleDateString()}` : ''}]`
        : isMaint
        ? '🔴 [MAINTENANCE]'
        : `⚪ [${(e.availability_status || 'UNKNOWN').toUpperCase()}]`;

      const cond = e.condition ? ` • ${e.condition}` : '';
      return `${isStar ? '★ ' : ''}${statusTag} S/N: ${e.serial_no} — ${e.model} (${e.current_location} Depot${cond})`;
    };

    if (matched.length > 0) {
      opts.push(
        ...matched.map((e) => ({
          value: `${e.model} | S/N: ${e.serial_no} (${e.current_location} Depot)`,
          label: formatOptLabel(e, true),
        }))
      );
    }

    if (others.length > 0) {
      opts.push(
        ...others.map((e) => ({
          value: `${e.model} | S/N: ${e.serial_no} (${e.current_location} Depot)`,
          label: formatOptLabel(e, false),
        }))
      );
    }

    opts.push({
      value: 'custom',
      label: '✎ Other / Custom Demo Model or Equipment Kit',
    });

    return opts;
  }, [demoEquipmentList, demoForm.product_id]);

  // Helper to fetch demo team availability for specified date
  const fetchLeadDemoTeamAvailability = async (dateStr: string) => {
    if (!dateStr) return;
    try {
      setIsLoadingLeadTeamAvailability(true);
      const res = await api.get('/demos/team/availability', { date: dateStr });
      if (Array.isArray(res)) {
        setLeadDemoTeamAvailability(res);
      }
    } catch (err) {
      console.warn('Could not fetch lead demo team availability:', err);
    } finally {
      setIsLoadingLeadTeamAvailability(false);
    }
  };

  useEffect(() => {
    if (isDemoModalOpen && demoForm.requested_date) {
      fetchLeadDemoTeamAvailability(demoForm.requested_date);
    }
  }, [isDemoModalOpen, demoForm.requested_date]);

  // Selected demo team member object for leads demo modal
  const selectedLeadDemoMember = useMemo(() => {
    if (!demoForm.assigned_to) return null;
    return (
      (leadDemoTeamAvailability.length > 0 ? leadDemoTeamAvailability : usersList).find(
        (u) => u.id === demoForm.assigned_to
      ) || null
    );
  }, [leadDemoTeamAvailability, usersList, demoForm.assigned_to]);

  // Demo team options with availability status tags for leads demo modal
  const leadDemoTeamOptions = useMemo(() => {
    const roster = leadDemoTeamAvailability.length > 0
      ? leadDemoTeamAvailability
      : usersList.filter((u) => ['demo_team', 'service_team', 'sales'].includes(u.role));

    return roster.map((m) => {
      const isAvail = m.is_available ?? true;
      const tag = isAvail
        ? '🟢 [AVAILABLE]'
        : `🟡 [BOOKED: ${m.active_demo?.demo_no || 'Another Trial'}]`;
      const roleTitle = m.role === 'demo_team' ? 'Demo Team Specialist' : m.role.replace(/_/g, ' ');
      return {
        value: m.id,
        label: `${tag} ${m.full_name} (${roleTitle})`,
      };
    });
  }, [leadDemoTeamAvailability, usersList]);

  // Proposal Transition Modal State
  const [isProposalModalOpen, setIsProposalModalOpen] = useState(false);
  const [proposalForm, setProposalForm] = useState({
    required_date: new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0],
    responsible_person_id: '',
    deal_value: '' as string | number,
    reference: '',
    remarks: 'Commercial and technical proposal formulation as per buyer specifications.',
    auto_remind: true,
  });

  // Discussion / Follow-Up Transition Modal State ("if discuss then when , all this")
  const [isDiscussionModalOpen, setIsDiscussionModalOpen] = useState(false);
  const [discussionStage, setDiscussionStage] = useState<'tender_discussion' | 'follow_up'>('tender_discussion');
  const [discussionForm, setDiscussionForm] = useState({
    discussion_date: new Date(Date.now() + 86400000).toISOString().split('T')[0],
    discussion_time: '14:30',
    mode: 'in_person',
    venue: '',
    assigned_to: '',
    agenda: 'Clause-by-clause tender specification compliance, pricing schedule, and delivery milestones.',
    auto_remind: true,
  });

  // Follow-up Reschedule Form
  const [rescheduleDate, setRescheduleDate] = useState('');
  const [rescheduleRemarks, setRescheduleRemarks] = useState('');

  // Load Master Data on Mount
  useEffect(() => {
    const loadMasters = async () => {
      try {
        const [prodRes, secRes, usrRes, znRes, regRes, orgRes, deRes] = await Promise.allSettled([
          api.get('/masters/products'),
          api.get('/masters/sectors'),
          api.get('/users'),
          api.get('/masters/zones'),
          api.get('/masters/regions'),
          api.get('/organisations', { limit: 200 }),
          api.get('/demos/equipment'),
        ]);

        if (prodRes.status === 'fulfilled') setProductsList(prodRes.value.data || prodRes.value || []);
        if (secRes.status === 'fulfilled') setSectorsList(secRes.value.data || secRes.value || []);
        if (usrRes.status === 'fulfilled') setUsersList(usrRes.value.data || usrRes.value || []);
        if (znRes.status === 'fulfilled') setZonesList(znRes.value.data || znRes.value || []);
        if (regRes.status === 'fulfilled') setRegionsList(regRes.value.data || regRes.value || []);
        if (deRes.status === 'fulfilled') setDemoEquipmentList(Array.isArray(deRes.value) ? deRes.value : (deRes.value?.data || []));
        if (orgRes.status === 'fulfilled') {
          const orgList = orgRes.value.data || orgRes.value || [];
          setOrganisationsList(orgList);
          const totalOrgs = orgRes.value.total ?? (Array.isArray(orgRes.value) ? orgRes.value.length : orgList.length);
          setTotalCustomersCount(totalOrgs);
          setCustomersTotal((prev) => (prev > 0 ? prev : totalOrgs));
        }
      } catch (err) {
        console.error('Failed to load masters:', err);
      }
    };
    loadMasters();
  }, []);

  // Fetch Dashboard Stats
  const fetchDashboardStats = useCallback(async () => {
    try {
      const [lDash, fDash] = await Promise.allSettled([
        api.get('/leads/dashboard'),
        api.get('/follow-ups/metrics'),
      ]);
      if (lDash.status === 'fulfilled') {
        const val = lDash.value?.data || lDash.value || {};
        const m = val.metrics || val;
        const totalCust = val.total_customers ?? val.totalCustomers ?? m.totalCustomers;
        if (typeof totalCust === 'number' && totalCust > 0) {
          setTotalCustomersCount(totalCust);
          setCustomersTotal((prev) => (prev > 0 && customerSearch ? prev : totalCust));
        }
        setLeadStats({
          ...val,
          ...m,
          total_leads: val.total_leads ?? val.totalLeads ?? m.totalLeads ?? m.total_leads ?? 0,
          fresh_leads: val.fresh_leads ?? val.freshLeads ?? m.freshLeads ?? m.fresh_leads ?? 0,
          reapproached_leads: val.reapproached_leads ?? val.re_approached_leads ?? val.reApproachedLeads ?? m.reApproachedLeads ?? m.reapproached_leads ?? 0,
          active_leads: val.active_leads ?? val.activeLeads ?? m.activeLeads ?? m.active_leads ?? 0,
          converted_leads: val.converted_leads ?? val.convertedLeads ?? m.convertedLeads ?? m.converted_leads ?? m.byStatus?.converted ?? 0,
          lost_leads: val.lost_leads ?? val.lostLeads ?? m.lostLeads ?? m.lost_leads ?? m.byStatus?.lost ?? 0,
        });
      }
      if (fDash.status === 'fulfilled') {
        const val = fDash.value?.data || fDash.value || {};
        setFollowupStats({
          ...val,
          dueToday: val.dueToday ?? val.due_today ?? 0,
          due_today: val.due_today ?? val.dueToday ?? 0,
          overdue: val.overdue ?? 0,
          upcoming: val.upcoming ?? 0,
          completed: val.completed ?? 0,
          total: val.total ?? 0,
        });
      }
    } catch (err) {
      console.error('Failed to load dashboard metrics:', err);
    }
  }, []);

  // Fetch Leads Register
  const fetchLeads = useCallback(async () => {
    try {
      setLeadsLoading(true);
      const res = await api.get('/leads', {
        page: leadsPage,
        limit: leadsLimit,
        search: leadFilters.search || undefined,
        lead_status: leadFilters.lead_status || undefined,
        lead_type: leadFilters.lead_type || undefined,
        sector: leadFilters.sector || undefined,
        source: leadFilters.lead_source || undefined,
      });

      const list = Array.isArray(res) ? res : (res?.data || []);
      setLeads(list);
      setLeadsTotal(res?.total ?? list.length);
      setLeadsTotalPages(res?.totalPages ?? 1);
    } catch (err) {
      console.error('Failed to load leads:', err);
      setLeads([]);
    } finally {
      setLeadsLoading(false);
    }
  }, [leadsPage, leadsLimit, leadFilters]);

  // Fetch Customers Register
  const fetchCustomers = useCallback(async () => {
    try {
      setCustomersLoading(true);
      const res = await api.get('/organisations', {
        page: customersPage,
        limit: 15,
        search: customerSearch || undefined,
      });

      const list = Array.isArray(res) ? res : (res?.data || []);
      setCustomers(list);
      const total = typeof res?.total === 'number' ? res.total : list.length;
      setCustomersTotal(total);
      if (!customerSearch) {
        setTotalCustomersCount(total);
      }
      setCustomersTotalPages(res?.totalPages ?? Math.max(1, Math.ceil(total / 15)));
    } catch (err) {
      console.error('Failed to load customers:', err);
      setCustomers([]);
    } finally {
      setCustomersLoading(false);
    }
  }, [customersPage, customerSearch]);

  // Fetch Follow-ups Desk
  const fetchFollowups = useCallback(async () => {
    try {
      setFollowupsLoading(true);
      const tf =
        followupTimeframe === 'today'
          ? 'due_today'
          : followupTimeframe !== 'all' && followupTimeframe !== 'completed'
          ? followupTimeframe
          : undefined;

      const res = await api.get('/follow-ups', {
        timeframe: tf,
        status: followupTimeframe === 'completed' ? 'completed' : undefined,
        limit: 50,
      });
      const list = Array.isArray(res) ? res : (res?.data || []);
      setFollowups(list);
    } catch (err) {
      console.error('Failed to load follow-ups:', err);
      setFollowups([]);
    } finally {
      setFollowupsLoading(false);
    }
  }, [followupTimeframe]);

  // Fetch Executive Reports
  const fetchReports = useCallback(async () => {
    try {
      setReportsLoading(true);
      const [spRes, znRes, prRes, inRes] = await Promise.allSettled([
        api.get('/leads/reports/salesperson'),
        api.get('/leads/reports/zones'),
        api.get('/leads/reports/products'),
        api.get('/leads/reports/interactions'),
      ]);

      if (spRes.status === 'fulfilled') {
        const val = spRes.value;
        setSalespersonReport(Array.isArray(val) ? val : (val?.data || []));
      }
      if (znRes.status === 'fulfilled') {
        const val = znRes.value;
        setZoneReport(Array.isArray(val) ? val : (val?.data || []));
      }
      if (prRes.status === 'fulfilled') {
        const val = prRes.value;
        setProductReport(Array.isArray(val) ? val : (val?.data || []));
      }
      if (inRes.status === 'fulfilled') {
        const val = inRes.value;
        setInteractionReport(Array.isArray(val) ? val : (val?.data || []));
      }
    } catch (err) {
      console.error('Failed to load reports:', err);
    } finally {
      setReportsLoading(false);
    }
  }, []);

  // Reset pages when filters change to prevent 0-record offset mismatches
  useEffect(() => {
    setLeadsPage(1);
  }, [leadFilters]);

  useEffect(() => {
    setCustomersPage(1);
  }, [customerSearch]);

  // Initial and reactive data fetching
  useEffect(() => {
    fetchDashboardStats();
    fetchCustomers();
  }, [fetchDashboardStats, fetchCustomers]);

  useEffect(() => {
    if (activeTab === 'leads') fetchLeads();
    else if (activeTab === 'customers') fetchCustomers();
    else if (activeTab === 'followups') fetchFollowups();
    else if (activeTab === 'reports') fetchReports();
  }, [activeTab, fetchLeads, fetchCustomers, fetchFollowups, fetchReports]);

  // Debounced Duplicate Detection during Lead Creation
  useEffect(() => {
    if (!isCreateLeadOpen || leadForm.organisation_mode === 'existing') {
      setDuplicateMatches([]);
      setDuplicateSuggestion(null);
      return;
    }

    const queryOrg = leadForm.organisation_name.trim();
    const queryEmail = leadForm.contact_email.trim();
    const queryPhone = leadForm.contact_mobile.trim();

    if (queryOrg.length < 3 && queryEmail.length < 5 && queryPhone.length < 6) {
      setDuplicateMatches([]);
      setDuplicateSuggestion(null);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        setIsCheckingDuplicate(true);
        const res = await api.get('/organisations/check-duplicate', {
          name: queryOrg || undefined,
          email: queryEmail || undefined,
          phone: queryPhone || undefined,
        });
        if (res?.isDuplicate && res.matches?.length > 0) {
          setDuplicateMatches(res.matches);
          setDuplicateSuggestion(res.suggestion);
        } else {
          setDuplicateMatches([]);
          setDuplicateSuggestion(null);
        }
      } catch (err) {
        // Silently handle
      } finally {
        setIsCheckingDuplicate(false);
      }
    }, 450);

    return () => clearTimeout(timer);
  }, [leadForm.organisation_name, leadForm.contact_email, leadForm.contact_mobile, isCreateLeadOpen, leadForm.organisation_mode]);

  // Automatically clear create lead errors and transient states whenever the modal is closed
  useEffect(() => {
    if (!isCreateLeadOpen) {
      setCreateLeadError(null);
      setFormError(null);
      setIsCheckingDuplicate(false);
    }
  }, [isCreateLeadOpen]);

  // Open Lead Details Modal
  const handleOpenLead = async (leadId: string) => {
    try {
      const fullLead = await api.get(`/leads/${leadId}`);
      setSelectedLead(fullLead);
      setIsLeadDetailOpen(true);
    } catch (err: any) {
      console.error('Failed to inspect lead:', err);
    }
  };

  // Open Customer 360 Account Drawer
  const handleOpenCustomer360 = async (orgId: string) => {
    try {
      setCustomerTimelineLoading(true);
      setIsCustomer360Open(true);
      setC360Tab('management');
      const [orgRes, timelineRes, contactsRes, leadsRes] = await Promise.allSettled([
        api.get(`/organisations/${orgId}`),
        api.get(`/organisations/${orgId}/timeline`),
        api.get(`/contacts?organisation_id=${orgId}`),
        api.get(`/leads?organisation_id=${orgId}&limit=50`),
      ]);

      if (orgRes.status === 'fulfilled') setSelectedCustomer(orgRes.value);
      if (timelineRes.status === 'fulfilled') {
        const val = timelineRes.value;
        setCustomerTimeline(val.timeline || val.interactions || []);
        setCustomerManagementSummary(val.management_summary || null);
        if (val.organisation && (!orgRes || orgRes.status !== 'fulfilled')) {
          setSelectedCustomer(val.organisation);
        }
      }
      if (contactsRes.status === 'fulfilled') setCustomerContacts(contactsRes.value || []);
      if (leadsRes.status === 'fulfilled') setCustomerLeads(leadsRes.value.data || []);
    } catch (err) {
      console.error('Failed to load customer 360:', err);
    } finally {
      setCustomerTimelineLoading(false);
    }
  };

  // Handle Create Lead Submission (Atomic Sync of all 18 Parameters)
  const handleCreateLead = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setCreateLeadError(null);
    setActionLoading(true);

    try {
      if (leadForm.organisation_mode === 'new' && !leadForm.organisation_name.trim()) {
        throw new Error('Organisation name is required.');
      }
      if (leadForm.organisation_mode === 'existing' && !leadForm.organisation_id) {
        throw new Error('Please select an existing organisation.');
      }
      if (leadForm.product_ids.length === 0) {
        throw new Error('Please select at least one Product Interest.');
      }

      await api.post('/leads', {
        organisation_id: leadForm.organisation_mode === 'existing' ? leadForm.organisation_id : undefined,
        organisation_name: leadForm.organisation_mode === 'new' ? leadForm.organisation_name.trim() : undefined,
        contact_name: leadForm.contact_name.trim() || undefined,
        contact_designation: leadForm.contact_designation.trim() || undefined,
        contact_mobile: leadForm.contact_mobile.trim() || undefined,
        contact_email: leadForm.contact_email.trim() || undefined,
        city: leadForm.city.trim() || undefined,
        state: leadForm.state.trim() || undefined,
        zone_id: leadForm.zone_id || undefined,
        region_id: leadForm.region_id || undefined,
        sector: leadForm.sector || undefined,
        department: leadForm.department.trim() || undefined,
        product_id: leadForm.product_ids[0] || undefined,
        product_ids: leadForm.product_ids.length > 0 ? leadForm.product_ids : undefined,
        source: leadForm.source || 'field_visit',
        category: leadForm.category || 'new_lead',
        assigned_to: leadForm.assigned_to || user?.id,
        regional_manager_id: leadForm.regional_manager_id || undefined,
        remarks: leadForm.remarks.trim() || undefined,
        lead_status: leadForm.lead_status || 'new',
        status: leadForm.lead_status || 'new',
        last_interaction_date: leadForm.last_interaction_date || new Date().toISOString().split('T')[0],
        last_interaction_type: leadForm.last_interaction_type || 'call',
        next_followup_date: leadForm.next_followup_date ? leadForm.next_followup_date : undefined,
        value_lakh: leadForm.value_lakh ? Number(leadForm.value_lakh) : undefined,
        estimated_value_lakh: leadForm.value_lakh ? Number(leadForm.value_lakh) : undefined,
      });

      setIsCreateLeadOpen(false);
      resetLeadForm();
      fetchLeads();
      fetchDashboardStats();
      fetchCustomers();
      if (activeTab === 'followups') fetchFollowups();
    } catch (err: any) {
      const msg = err.message || 'Failed to register lead.';
      setCreateLeadError(msg);
      setFormError(msg);
    } finally {
      setActionLoading(false);
    }
  };

  const resetLeadForm = () => {
    setFormError(null);
    setCreateLeadError(null);
    setActionLoading(false);
    setIsCheckingDuplicate(false);
    setLeadForm({
      organisation_mode: 'new',
      organisation_id: '',
      organisation_name: '',
      department: '',
      city: '',
      state: '',
      zone_id: '',
      region_id: '',
      sector: '',
      contact_name: '',
      contact_designation: '',
      contact_mobile: '',
      contact_email: '',
      product_ids: [],
      source: 'field_visit',
      category: 'new_lead',
      assigned_to: user?.id || '',
      regional_manager_id: '',
      remarks: '',
      lead_status: 'new',
      last_interaction_date: new Date().toISOString().split('T')[0],
      last_interaction_type: 'call',
      next_followup_date: '',
      value_lakh: '',
    });
    setDuplicateMatches([]);
    setDuplicateSuggestion(null);
  };

  const handleOpenCreateLead = () => {
    resetLeadForm();
    setFormError(null);
    setCreateLeadError(null);
    setIsCreateLeadOpen(true);
  };

  const handleCloseCreateLead = () => {
    setIsCreateLeadOpen(false);
    resetLeadForm();
    setFormError(null);
    setCreateLeadError(null);
  };

  // Status Change Submission
  const handleStatusChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedLead) return;
    setFormError(null);
    setActionLoading(true);

    try {
      await api.patch(`/leads/${selectedLead.id}/status`, {
        status: targetStatus,
        loss_reason: targetStatus === 'lost' ? lossReason : undefined,
        loss_remarks: targetStatus === 'lost' ? lossRemarks : undefined,
      });

      setIsStatusModalOpen(false);
      const updated = await api.get(`/leads/${selectedLead.id}`);
      setSelectedLead(updated);
      fetchLeads();
      fetchDashboardStats();
    } catch (err: any) {
      setFormError(err.message || 'Failed to update lead status.');
    } finally {
      setActionLoading(false);
    }
  };

  // Reassign Salesperson Submission
  const handleReassign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedLead) return;
    if (!canReassign) {
      setFormError('Access restricted: Only Regional Managers, Management, or Admins can transfer lead ownership.');
      return;
    }
    setFormError(null);
    setActionLoading(true);

    try {
      await api.patch(`/leads/${selectedLead.id}/assign`, {
        assigned_to: newSalespersonId,
        reason: reassignReason || undefined,
      });

      setIsReassignModalOpen(false);
      const updated = await api.get(`/leads/${selectedLead.id}`);
      setSelectedLead(updated);
      fetchLeads();
      fetchDashboardStats();
    } catch (err: any) {
      setFormError(err.message || 'Failed to reassign salesperson.');
    } finally {
      setActionLoading(false);
    }
  };

  // Add Product Interest to Selected Lead
  const handleAddProductInterest = async (productId: string) => {
    if (!selectedLead) return;
    setFormError(null);
    try {
      await api.post(`/leads/${selectedLead.id}/products`, { product_id: productId });
      const updated = await api.get(`/leads/${selectedLead.id}`);
      setSelectedLead(updated);
      fetchLeads();
      fetchDashboardStats();
    } catch (err: any) {
      setFormError(err.message || 'Failed to attach product.');
    }
  };

  // Remove Product Interest from Selected Lead
  const handleRemoveProductInterest = async (productId: string) => {
    if (!selectedLead) return;
    setFormError(null);
    try {
      await api.delete(`/leads/${selectedLead.id}/products/${productId}`);
      const updated = await api.get(`/leads/${selectedLead.id}`);
      setSelectedLead(updated);
      fetchLeads();
      fetchDashboardStats();
    } catch (err: any) {
      setFormError(err.message || 'Failed to remove product.');
    }
  };

  // Open Demo Modal with prepopulated values
  const handleOpenDemoModal = () => {
    if (!selectedLead) return;
    const defaultProdId = selectedLead.product_id || selectedLead.product_interests?.[0]?.product_id || (productsList[0]?.id || '');
    const defaultDemoUser = usersList.find((u) => u.role === 'demo_team')?.id || selectedLead.assigned_to || user?.id || '';
    const loc = `${selectedLead.city || ''}${selectedLead.city && selectedLead.state ? ', ' : ''}${selectedLead.state || ''}`.trim() || selectedLead.organisation_name || 'Client Site / Field';
    const prodName = selectedLead.product_name || selectedLead.product_interests?.[0]?.product_name || 'Equipment';

    setDemoForm({
      requested_date: new Date(Date.now() + 86400000).toISOString().split('T')[0],
      requested_time: '11:00',
      product_id: defaultProdId,
      assigned_to: defaultDemoUser,
      location: loc,
      purpose: `Live demonstration & specification validation for ${selectedLead.organisation_name}`,
      expected_audience: 'Procurement Committee & Commanding Officers',
      equipment_required: `${prodName} Demo Unit, test accessories, and calibration certificate`,
      custom_accessories: '',
      auto_remind: true,
      reminder_notes: 'Verify kit packing and transport permits before field deployment.',
    });
    setFormError(null);
    setIsDemoModalOpen(true);
  };

  // Open Proposal Modal with prepopulated values
  const handleOpenProposalModal = () => {
    if (!selectedLead) return;
    const defaultTenderUser = usersList.find((u) => u.role === 'tender_team')?.id || selectedLead.assigned_to || user?.id || '';
    const cleanOrg = (selectedLead.organisation_name || 'LEAD').replace(/[^a-zA-Z0-9]/g, '').slice(0, 8).toUpperCase();
    const ref = `PROP-${cleanOrg}-${new Date().getFullYear()}-${Date.now().toString().slice(-4)}`;

    setProposalForm({
      required_date: new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0],
      responsible_person_id: defaultTenderUser,
      deal_value: selectedLead.estimated_value_lakh || selectedLead.value_lakh || '',
      reference: ref,
      remarks: `Commercial proposal & technical bid preparation for ${selectedLead.organisation_name}. Include delivery SLA and 3-year warranty terms.`,
      auto_remind: true,
    });
    setFormError(null);
    setIsProposalModalOpen(true);
  };

  // Open Discussion Modal with prepopulated values ("when")
  const handleOpenDiscussionModal = (stage: 'tender_discussion' | 'follow_up') => {
    if (!selectedLead) return;
    setDiscussionStage(stage);
    const defaultUser = selectedLead.assigned_to || usersList.find((u) => u.role === (stage === 'tender_discussion' ? 'tender_team' : 'sales'))?.id || user?.id || '';
    const venue = selectedLead.city ? `${selectedLead.organisation_name}, ${selectedLead.city}` : 'Client HQ / Virtual Conference';

    setDiscussionForm({
      discussion_date: new Date(Date.now() + 86400000).toISOString().split('T')[0],
      discussion_time: '14:30',
      mode: stage === 'tender_discussion' ? 'tender_committee' : 'in_person',
      venue: venue,
      assigned_to: defaultUser,
      agenda: stage === 'tender_discussion'
        ? 'Clause-by-clause tender terms review, RFP alignment, commercial pricing schedule, and earnest money deposit.'
        : 'Comprehensive follow-up on technical evaluation, buyer timeline, and next procurement stage.',
      auto_remind: true,
    });
    setFormError(null);
    setIsDiscussionModalOpen(true);
  };

  // Lifecycle Stage Advance Router
  const handleDirectAdvanceStatus = async (nextSt: string) => {
    if (!selectedLead) return;
    if (nextSt === 'lost') {
      setTargetStatus('lost');
      setIsStatusModalOpen(true);
      return;
    }
    if (nextSt === 'demo') {
      handleOpenDemoModal();
      return;
    }
    if (nextSt === 'proposal') {
      handleOpenProposalModal();
      return;
    }
    if (nextSt === 'tender_discussion' || nextSt === 'follow_up') {
      handleOpenDiscussionModal(nextSt as any);
      return;
    }

    setActionLoading(true);
    setFormError(null);
    try {
      await api.patch(`/leads/${selectedLead.id}/status`, { status: nextSt });
      const updated = await api.get(`/leads/${selectedLead.id}`);
      setSelectedLead(updated);
      setActionSuccess(`Lifecycle stage advanced to ${nextSt.toUpperCase()} successfully!`);
      fetchLeads();
      fetchDashboardStats();
    } catch (err: any) {
      setFormError(err.message || `Failed to advance status to ${nextSt}.`);
    } finally {
      setActionLoading(false);
    }
  };

  // Submit Demo Transition
  const handleSubmitDemoTransition = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedLead) return;
    setActionLoading(true);
    setFormError(null);

    try {
      // 1. Create official Demo record
      await api.post('/demos', {
        organisation_id: selectedLead.organisation_id,
        lead_id: selectedLead.id,
        product_id: demoForm.product_id || undefined,
        requested_date: demoForm.requested_date,
        location: demoForm.location,
        purpose: demoForm.purpose,
        expected_audience: demoForm.expected_audience,
        equipment_required: demoForm.equipment_required,
        assigned_to: demoForm.assigned_to || undefined,
        remarks: demoForm.reminder_notes,
      });

      // 2. Advance Lead Lifecycle to DEMO
      await api.patch(`/leads/${selectedLead.id}/status`, {
        status: 'demo',
        remarks: `Demonstration scheduled for ${demoForm.requested_date} at ${demoForm.requested_time} (${demoForm.location}). Assigned specialist: ${usersList.find((u) => u.id === demoForm.assigned_to)?.full_name || 'Demo Team'}.`,
      });

      // 3. Auto-remind: Create high-priority task for assigned member
      if (demoForm.auto_remind && demoForm.assigned_to) {
        const prodName = productsList.find((p) => p.id === demoForm.product_id)?.name || selectedLead.product_name || 'Equipment';

        await api.post('/tasks', {
          title: `Conduct Demo: ${prodName} (${selectedLead.organisation_name})`,
          description: `Demo scheduled on ${demoForm.requested_date} at ${demoForm.requested_time}.\nLocation: ${demoForm.location}\nAudience: ${demoForm.expected_audience}\nEquipment: ${demoForm.equipment_required}\nNotes: ${demoForm.reminder_notes}`,
          assigned_to: demoForm.assigned_to,
          department: 'Demo Team',
          priority: 'urgent',
          task_type: 'one_time',
          deadline: demoForm.requested_date,
          start_date: new Date().toISOString().split('T')[0],
          related_entity_type: 'lead',
          related_entity_id: selectedLead.id,
          expected_outcome: 'Field trial executed and signed demo trial certificate obtained',
        });

        await api.post('/notifications', {
          userId: demoForm.assigned_to,
          type: 'demo_assigned',
          title: `🎯 Demo Assigned: ${selectedLead.organisation_name}`,
          body: `You are assigned for product demonstration on ${demoForm.requested_date} at ${demoForm.requested_time} (${demoForm.location}).`,
          entityType: 'lead',
          entityId: selectedLead.id,
        });
      }

      const updated = await api.get(`/leads/${selectedLead.id}`);
      setSelectedLead(updated);
      setIsDemoModalOpen(false);
      setActionSuccess(`Demo scheduled successfully! Demo Team coordinators and assigned specialist have been notified.`);
      fetchLeads();
      fetchDashboardStats();
    } catch (err: any) {
      setFormError(err.message || 'Failed to schedule demo and update status.');
    } finally {
      setActionLoading(false);
    }
  };

  // Submit Proposal Transition
  const handleSubmitProposalTransition = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedLead) return;
    setActionLoading(true);
    setFormError(null);

    try {
      // 1. Create Proposal record
      await api.post('/proposals', {
        customer_id: selectedLead.organisation_id,
        organisation_id: selectedLead.organisation_id,
        lead_id: selectedLead.id,
        product_id: selectedLead.product_id || (selectedLead.product_interests?.[0]?.product_id) || undefined,
        required_date: proposalForm.required_date,
        reference: proposalForm.reference,
        responsible_person_id: proposalForm.responsible_person_id || undefined,
        remarks: proposalForm.remarks,
      });

      // 2. Advance Lead Lifecycle to PROPOSAL
      await api.patch(`/leads/${selectedLead.id}/status`, {
        status: 'proposal',
        remarks: `Proposal initiated (Ref: ${proposalForm.reference}). Submission deadline: ${proposalForm.required_date}. Lead specialist: ${usersList.find((u) => u.id === proposalForm.responsible_person_id)?.full_name || 'Tender Team'}.`,
      });

      // 3. Auto-remind: Create high-priority task for assigned proposal specialist
      if (proposalForm.auto_remind && proposalForm.responsible_person_id) {
        await api.post('/tasks', {
          title: `Draft Proposal: ${proposalForm.reference} (${selectedLead.organisation_name})`,
          description: `Formulate technical bid and commercial quotation.\nSubmission Deadline: ${proposalForm.required_date}\nScope: ${proposalForm.remarks}`,
          assigned_to: proposalForm.responsible_person_id,
          department: 'Tender Team',
          priority: 'high',
          task_type: 'one_time',
          deadline: proposalForm.required_date,
          start_date: new Date().toISOString().split('T')[0],
          related_entity_type: 'lead',
          related_entity_id: selectedLead.id,
          expected_outcome: 'Proposal formulated and ready for managerial pricing review',
        });

        await api.post('/notifications', {
          userId: proposalForm.responsible_person_id,
          type: 'proposal_assigned',
          title: `📄 Proposal Assigned: ${proposalForm.reference}`,
          body: `You are responsible for proposal drafting for ${selectedLead.organisation_name} due by ${proposalForm.required_date}.`,
          entityType: 'lead',
          entityId: selectedLead.id,
        });
      }

      const updated = await api.get(`/leads/${selectedLead.id}`);
      setSelectedLead(updated);
      setIsProposalModalOpen(false);
      setActionSuccess(`Proposal registered and delegated! Tender Team and assigned specialist notified.`);
      fetchLeads();
      fetchDashboardStats();
    } catch (err: any) {
      setFormError(err.message || 'Failed to create proposal and update status.');
    } finally {
      setActionLoading(false);
    }
  };

  // Submit Discussion Transition ("when")
  const handleSubmitDiscussionTransition = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedLead) return;
    setActionLoading(true);
    setFormError(null);

    const stageLabel = discussionStage === 'tender_discussion' ? 'TENDER DISCUSSION' : 'FOLLOW UP';
    const assignedMember = usersList.find((u) => u.id === discussionForm.assigned_to);

    try {
      // 1. Advance Lead Lifecycle
      await api.patch(`/leads/${selectedLead.id}/status`, {
        status: discussionStage,
        remarks: `${stageLabel} scheduled for ${discussionForm.discussion_date} at ${discussionForm.discussion_time} (${discussionForm.mode}). Venue: ${discussionForm.venue}. Assigned: ${assignedMember?.full_name || 'Team'}.`,
      });

      // 2. Log Interaction / Touchpoint
      await api.post('/interactions', {
        lead_id: selectedLead.id,
        organisation_id: selectedLead.organisation_id,
        contact_id: selectedLead.primary_contact_id || undefined,
        type: 'meeting',
        occurred_on: discussionForm.discussion_date,
        remarks: `[${stageLabel}] Scheduled at ${discussionForm.discussion_time} (${discussionForm.mode}). Venue: ${discussionForm.venue}. Agenda: ${discussionForm.agenda}`,
        outcome: `${stageLabel} Touchpoint Scheduled`,
        next_followup_date: discussionForm.discussion_date,
      });

      // 3. Auto-remind: Create calendar task for assigned member
      if (discussionForm.auto_remind && discussionForm.assigned_to) {
        await api.post('/tasks', {
          title: `${stageLabel}: ${selectedLead.organisation_name} (${discussionForm.mode.toUpperCase()})`,
          description: `When: ${discussionForm.discussion_date} at ${discussionForm.discussion_time}\nVenue / Link: ${discussionForm.venue}\nAgenda: ${discussionForm.agenda}`,
          assigned_to: discussionForm.assigned_to,
          department: discussionStage === 'tender_discussion' ? 'Tender Team' : 'Sales',
          priority: 'urgent',
          task_type: 'meeting',
          deadline: discussionForm.discussion_date,
          start_date: new Date().toISOString().split('T')[0],
          related_entity_type: 'lead',
          related_entity_id: selectedLead.id,
          expected_outcome: 'Discussion minutes documented and buyer commitments captured',
        });

        await api.post('/notifications', {
          userId: discussionForm.assigned_to,
          type: 'meeting_scheduled',
          title: `🤝 Discussion Scheduled: ${selectedLead.organisation_name}`,
          body: `You are scheduled for a discussion on ${discussionForm.discussion_date} at ${discussionForm.discussion_time} (${discussionForm.venue}).`,
          entityType: 'lead',
          entityId: selectedLead.id,
        });
      }

      const updated = await api.get(`/leads/${selectedLead.id}`);
      setSelectedLead(updated);
      setIsDiscussionModalOpen(false);
      setActionSuccess(`${stageLabel} scheduled on ${discussionForm.discussion_date}! Auto-reminder and task dispatched to ${assignedMember?.full_name || 'assigned member'}.`);
      fetchLeads();
      fetchDashboardStats();
    } catch (err: any) {
      setFormError(err.message || 'Failed to schedule discussion.');
    } finally {
      setActionLoading(false);
    }
  };

  // Log Interaction Submission
  const handleLogInteraction = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setActionLoading(true);

    try {
      await api.post('/interactions', {
        lead_id: interactionForm.lead_id || undefined,
        organisation_id: interactionForm.organisation_id,
        contact_id: interactionForm.contact_id || undefined,
        type: interactionForm.type,
        occurred_on: interactionForm.date,
        interaction_date: interactionForm.date,
        remarks: interactionForm.notes,
        notes: interactionForm.notes,
        outcome: interactionForm.outcome || undefined,
        next_action: interactionForm.next_action || undefined,
        followup_date: interactionForm.next_followup_date || undefined,
        next_followup_date: interactionForm.next_followup_date || undefined,
        attachments:
          interactionForm.attachment_title && interactionForm.attachment_url
            ? [
                {
                  file_name: interactionForm.attachment_title,
                  file_url: interactionForm.attachment_url,
                },
              ]
            : undefined,
      });

      setIsLogInteractionOpen(false);
      setInteractionForm({
        lead_id: '',
        organisation_id: '',
        contact_id: '',
        type: 'call',
        date: new Date().toISOString().split('T')[0],
        notes: '',
        outcome: '',
        next_action: '',
        next_followup_date: '',
        attachment_title: '',
        attachment_url: '',
      });

      if (selectedLead) {
        const updated = await api.get(`/leads/${selectedLead.id}`);
        setSelectedLead(updated);
      }
      if (selectedCustomer) {
        handleOpenCustomer360(selectedCustomer.id);
      }
      fetchLeads();
      fetchFollowups();
      fetchDashboardStats();
    } catch (err: any) {
      setFormError(err.message || 'Failed to log interaction.');
    } finally {
      setActionLoading(false);
    }
  };

  // Follow-up Completion Submission
  const handleCompleteFollowup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFollowup) return;
    setFormError(null);
    setActionLoading(true);

    try {
      await api.patch(`/follow-ups/${selectedFollowup.id}/complete`, {
        outcome: completionOutcome || undefined,
        remarks: completionRemarks || undefined,
        next_followup_date: scheduleNextFollowup && nextFollowupDueDate ? nextFollowupDueDate : undefined,
      });

      setIsCompleteFollowupOpen(false);
      setSelectedFollowup(null);
      setCompletionOutcome('');
      setCompletionRemarks('');
      setScheduleNextFollowup(false);
      setNextFollowupDueDate('');
      fetchFollowups();
      fetchDashboardStats();
    } catch (err: any) {
      setFormError(err.message || 'Failed to complete follow-up.');
    } finally {
      setActionLoading(false);
    }
  };

  // Follow-up Reschedule Submission
  const handleRescheduleFollowup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFollowup) return;
    setFormError(null);
    setActionLoading(true);

    try {
      await api.patch(`/follow-ups/${selectedFollowup.id}/reschedule`, {
        new_due_date: rescheduleDate,
        remarks: rescheduleRemarks || undefined,
      });

      setIsRescheduleFollowupOpen(false);
      setSelectedFollowup(null);
      setRescheduleDate('');
      setRescheduleRemarks('');
      fetchFollowups();
      fetchDashboardStats();
    } catch (err: any) {
      setFormError(err.message || 'Failed to reschedule follow-up.');
    } finally {
      setActionLoading(false);
    }
  };

  // Status badge styling helper
  const getStatusBadge = (status: string) => {
    const s = (status || '').toLowerCase();
    switch (s) {
      case 'new':
        return <Badge variant="info" size="sm">NEW</Badge>;
      case 'contacted':
        return <Badge variant="outline" size="sm">CONTACTED</Badge>;
      case 'qualified':
        return <Badge variant="success" size="sm">QUALIFIED</Badge>;
      case 'follow_up':
        return <Badge variant="warning" size="sm">FOLLOW-UP</Badge>;
      case 'demo':
        return <Badge variant="cyber" size="sm">DEMO SCHEDULED</Badge>;
      case 'proposal':
        return <Badge variant="info" size="sm">PROPOSAL</Badge>;
      case 'tender_discussion':
        return <Badge variant="outline" size="sm">TENDER DISCUSSION</Badge>;
      case 'negotiation':
        return <Badge variant="warning" size="sm">NEGOTIATION</Badge>;
      case 'converted':
        return <Badge variant="success" size="sm">CONVERTED (WON)</Badge>;
      case 'lost':
        return <Badge variant="danger" size="sm">LOST</Badge>;
      case 'on_hold':
        return <Badge variant="default" size="sm">ON HOLD</Badge>;
      default:
        return <Badge variant="default" size="sm">{status?.toUpperCase()}</Badge>;
    }
  };

  // Computed HUD counts with fallback to loaded dataset
  const activePipelineCount =
    leadStats?.active_leads ??
    leadStats?.activeLeads ??
    leadStats?.metrics?.activeLeads ??
    (leads.length > 0
      ? leads.filter((l) => !['converted', 'won', 'lost', 'dropped'].includes(String(l.lead_status || l.status).toLowerCase())).length
      : 0);

  const totalLeadsCount =
    leadStats?.total_leads ??
    leadStats?.totalLeads ??
    leadStats?.metrics?.totalLeads ??
    leadsTotal ??
    leads.length;

  const freshLeadsCount =
    leadStats?.fresh_leads ??
    leadStats?.freshLeads ??
    leadStats?.metrics?.freshLeads ??
    (leads.length > 0 ? leads.filter((l) => (l.lead_type || 'fresh') === 'fresh').length : 0);

  const reapproachedLeadsCount =
    leadStats?.reapproached_leads ??
    leadStats?.re_approached_leads ??
    leadStats?.reApproachedLeads ??
    leadStats?.metrics?.reApproachedLeads ??
    (leads.length > 0 ? leads.filter((l) => l.lead_type === 're_approached').length : 0);

  const convertedDealsCount =
    leadStats?.converted_leads ??
    leadStats?.convertedLeads ??
    leadStats?.metrics?.convertedLeads ??
    leadStats?.metrics?.byStatus?.converted ??
    (leads.length > 0 ? leads.filter((l) => ['converted', 'won'].includes(String(l.lead_status || l.status).toLowerCase())).length : 0);

  const lostLeadsCount =
    leadStats?.lost_leads ??
    leadStats?.lostLeads ??
    leadStats?.metrics?.lostLeads ??
    leadStats?.metrics?.byStatus?.lost ??
    (leads.length > 0 ? leads.filter((l) => ['lost', 'dropped'].includes(String(l.lead_status || l.status).toLowerCase())).length : 0);

  const followupsDueTodayCount =
    followupStats?.dueToday ??
    followupStats?.due_today ??
    0;

  const followupsOverdueCount =
    followupStats?.overdue ??
    0;

  return (
    <div className="space-y-6 pb-12 animate-in fade-in duration-200">
      {/* 1. Page Header */}
      <PageHeader
        title="Lead & Customer Management"
        icon={<Target className="h-7 w-7 text-[#0F5E63]" />}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                fetchDashboardStats();
                fetchLeads();
                fetchCustomers();
                if (activeTab === 'followups') fetchFollowups();
                else if (activeTab === 'reports') fetchReports();
              }}
              leftIcon={<RefreshCw className="h-4 w-4" />}
            >
              Sync
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleOpenCreateLead}
              leftIcon={<Plus className="h-4 w-4" />}
            >
              New Opportunity / Lead
            </Button>
          </div>
        }
      />

      {/* 2. Executive Metric Cards HUD */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
        <StatCard
          label="Active Pipeline"
          value={activePipelineCount}
          subtext={`Total Leads: ${totalLeadsCount}`}
          variant="primary"
          icon={<Compass className="h-4 w-4 text-[#0F5E63]" />}
        />
        <StatCard
          label="Fresh Prospects"
          value={freshLeadsCount}
          subtext="First-time Accounts"
          variant="emerald"
          icon={<Sparkles className="h-4 w-4 text-emerald-600" />}
        />
        <StatCard
          label="Re-Approached"
          value={reapproachedLeadsCount}
          subtext="Repeat Engagements"
          variant="amber"
          icon={<Layers className="h-4 w-4 text-amber-600" />}
        />
        <StatCard
          label="Follow-ups Due Today"
          value={followupsDueTodayCount}
          subtext={`Overdue: ${followupsOverdueCount}`}
          variant={Number(followupsOverdueCount) > 0 ? 'rose' : 'amber'}
          icon={<Clock className="h-4 w-4 text-amber-600" />}
        />
        <StatCard
          label="Converted Deals"
          value={convertedDealsCount}
          subtext={`Lost: ${lostLeadsCount}`}
          variant="emerald"
          icon={<Award className="h-4 w-4 text-emerald-600" />}
        />
      </div>

      {/* 3. Primary Workspace Tabs */}
      <ToolbarBox>
        <Tabs
          variant="segmented"
          activeTab={activeTab}
          onChange={setActiveTab}
          tabs={[
            { id: 'leads', label: 'Lead Register & Pipeline', icon: <Target className="h-4 w-4" />, count: leadsTotal },
            {
              id: 'customers',
              label: 'Customer Register (360°)',
              icon: <Building className="h-4 w-4" />,
              count: (activeTab === 'customers' && customerSearch)
                ? customersTotal
                : (totalCustomersCount || customersTotal),
            },
            { id: 'followups', label: 'Follow-ups Desk', icon: <Clock className="h-4 w-4" />, count: (followupStats?.dueToday ?? followupStats?.due_today) ? `${followupStats?.dueToday ?? followupStats?.due_today} today` : undefined },
            { id: 'reports', label: 'Executive Intelligence Reports', icon: <TrendingUp className="h-4 w-4" /> },
          ]}
        />
      </ToolbarBox>

      {/* ========================================================================= */}
      {/* TAB 1: LEAD REGISTER & PIPELINE                                           */}
      {/* ========================================================================= */}
      {activeTab === 'leads' && (
        <div className="space-y-4">
          {/* Filters Strip */}
          <ToolbarSlot><div className="p-3 bg-white border border-[#DCD8CE] rounded-xl shadow-2xs flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2.5 flex-1 min-w-[280px]">
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-[#4A5568]" />
                <input
                  type="text"
                  placeholder="Search lead, client, salesperson..."
                  value={leadFilters.search}
                  onChange={(e) => setLeadFilters({ ...leadFilters, search: e.target.value })}
                  className="w-full pl-9 pr-3 py-1.5 text-xs bg-[#FBFAF7] border border-[#DCD8CE] rounded-lg text-[#14213D] placeholder-[#4A5568] focus:outline-none focus:border-[#0F5E63]"
                />
              </div>

              <select
                value={leadFilters.lead_status}
                onChange={(e) => setLeadFilters({ ...leadFilters, lead_status: e.target.value })}
                className="px-2.5 py-1.5 text-xs bg-[#FBFAF7] border border-[#DCD8CE] rounded-lg text-[#14213D] focus:outline-none focus:border-[#0F5E63]"
              >
                <option value="">All Lifecycle Stages</option>
                <option value="new">New</option>
                <option value="contacted">Contacted</option>
                <option value="qualified">Qualified</option>
                <option value="follow_up">Follow-Up Stage</option>
                <option value="demo">Demo Scheduled</option>
                <option value="proposal">Proposal Sent</option>
                <option value="tender_discussion">Tender Discussion</option>
                <option value="negotiation">Negotiation</option>
                <option value="converted">Converted (Won)</option>
                <option value="lost">Lost</option>
                <option value="on_hold">On Hold</option>
              </select>

              <select
                value={leadFilters.lead_type}
                onChange={(e) => setLeadFilters({ ...leadFilters, lead_type: e.target.value })}
                className="px-2.5 py-1.5 text-xs bg-[#FBFAF7] border border-[#DCD8CE] rounded-lg text-[#14213D] focus:outline-none focus:border-[#0F5E63]"
              >
                <option value="">All Lead Types</option>
                <option value="fresh">Fresh Accounts</option>
                <option value="re_approached">Re-Approached Accounts</option>
              </select>

              <select
                value={leadFilters.lead_source}
                onChange={(e) => setLeadFilters({ ...leadFilters, lead_source: e.target.value })}
                className="px-2.5 py-1.5 text-xs bg-[#FBFAF7] border border-[#DCD8CE] rounded-lg text-[#14213D] focus:outline-none focus:border-[#0F5E63]"
              >
                <option value="">All Sources</option>
                <option value="field_visit">Field Visit</option>
                <option value="referral">Referral</option>
                <option value="tender">Tender</option>
                <option value="exhibition">Exhibition</option>
                <option value="website">Website</option>
                <option value="cold_outreach">Cold Outreach</option>
              </select>
            </div>

            <div className="flex flex-wrap items-center justify-between sm:justify-start gap-3 text-xs text-[#4A5568]">
              <span>
                Showing <strong className="text-[#14213D]">{leads.length}</strong> of{' '}
                <strong className="text-[#14213D]">{leadsTotal}</strong> opportunities
              </span>
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-[#4A5568]">Rows:</span>
                <select
                  value={leadsLimit}
                  onChange={(e) => {
                    setLeadsLimit(Number(e.target.value));
                    setLeadsPage(1);
                  }}
                  className="px-2 py-1 text-xs bg-[#FBFAF7] border border-[#DCD8CE] rounded-lg text-[#14213D] focus:outline-none focus:border-[#0F5E63]"
                >
                  <option value={15}>15</option>
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </div>
            </div>
          </div></ToolbarSlot>

          {/* Leads Table */}
          {leadsLoading ? (
            <PageLoader label="Loading pipeline" />
          ) : leads.length === 0 ? (
            <EmptyState
              icon={Target}
              title="No opportunities match your filter"
              description="Try adjusting your stage, type, or search filters, or register a new lead."
              action={
                <Button
                  size="sm"
                  variant="primary"
                  onClick={handleOpenCreateLead}
                >
                  Create Opportunity
                </Button>
              }
            />
          ) : (
            <Table className="min-w-[1240px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Opportunity / Title</TableHead>
                  <TableHead>Organisation & Sector</TableHead>
                  <TableHead>Primary Contact</TableHead>
                  <TableHead>Classification</TableHead>
                  <TableHead>Salesperson / RM</TableHead>
                  <TableHead>Products</TableHead>
                  <TableHead>Stage / Status</TableHead>
                  <TableHead>Est. Value</TableHead>
                  <TableHead>Next Follow-Up</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {leads.map((lead) => (
                  <TableRow key={lead.id} className="group cursor-pointer" onClick={() => handleOpenLead(lead.id)}>
                    <TableCell>
                      <div className="font-bold text-[#14213D] group-hover:text-[#0F5E63] transition-colors line-clamp-1">
                        {lead.product_name || (lead.product_interests && lead.product_interests[0]?.name) || lead.organisation_name || 'Procurement Opportunity'}
                      </div>
                      <div className="text-[10px] text-[#4A5568]">
                        <span className="font-mono">#{lead.id.slice(0, 8)}</span> • Source: {lead.source || 'Direct'}
                      </div>
                    </TableCell>

                    <TableCell>
                      <div className="font-semibold text-[#14213D] flex items-center gap-1.5">
                        <Building className="h-3.5 w-3.5 text-[#4A5568] shrink-0" />
                        <span className="truncate">{lead.organisation_name || '—'}</span>
                      </div>
                      <div className="text-[10px] text-[#4A5568] flex items-center gap-1">
                        <span>{lead.sector || 'Defence / Security'}</span>
                        {(lead.city || lead.state) && (
                          <span>• {lead.city ? `${lead.city}, ` : ''}{lead.state || ''}</span>
                        )}
                      </div>
                    </TableCell>

                    <TableCell>
                      {lead.contact_name ? (
                        <div>
                          <div className="font-medium text-[#14213D] flex items-center gap-1">
                            <User className="h-3 w-3 text-[#4A5568]" />
                            <span>{lead.contact_name}</span>
                          </div>
                          <div className="text-[10px] text-[#4A5568]">
                            {lead.contact_designation || lead.contact_mobile || lead.contact_phone || '—'}
                          </div>
                        </div>
                      ) : (
                        <span className="text-[#4A5568] italic text-[11px]">Unspecified</span>
                      )}
                    </TableCell>

                    <TableCell>
                      {lead.lead_type === 're_approached' ? (
                        <Badge variant="warning" size="sm" className="font-bold text-[10px]">
                          RE-APPROACHED
                        </Badge>
                      ) : (
                        <Badge variant="info" size="sm" className="font-bold text-[10px]">
                          FRESH
                        </Badge>
                      )}
                    </TableCell>

                    <TableCell>
                      <div className="text-xs font-semibold text-gray-800">
                        {lead.assignee_name || lead.assigned_salesperson_name || 'Unassigned'}
                      </div>
                      {lead.regional_manager_name && (
                        <div className="text-[10px] text-[#4A5568]">
                          RM: {lead.regional_manager_name}
                        </div>
                      )}
                    </TableCell>

                    <TableCell>
                      {lead.product_interests && lead.product_interests.length > 0 ? (
                        <div className="flex flex-wrap gap-1 max-w-[180px]">
                          {lead.product_interests.slice(0, 2).map((p: any) => (
                            <span
                              key={p.product_id || p.id}
                              className="px-1.5 py-0.5 rounded bg-[#E3EFEE] text-[#0F5E63] text-[10px] font-medium truncate"
                            >
                              {p.name || p.product_name}
                            </span>
                          ))}
                          {lead.product_interests.length > 2 && (
                            <span className="text-[10px] text-[#4A5568]">
                              +{lead.product_interests.length - 2}
                            </span>
                          )}
                        </div>
                      ) : lead.product_name ? (
                        <span className="px-1.5 py-0.5 rounded bg-[#E3EFEE] text-[#0F5E63] text-[10px] font-medium truncate">
                          {lead.product_name}
                        </span>
                      ) : (
                        <span className="text-[#4A5568] italic text-[10px]">None tagged</span>
                      )}
                    </TableCell>

                    <TableCell>
                      {getStatusBadge(lead.lead_status || lead.status)}
                    </TableCell>

                    <TableCell>
                      <span className="font-extrabold text-[#0F5E63]">
                        {formatLakh(lead.value_lakh || lead.estimated_value_lakh || 0)}
                      </span>
                    </TableCell>

                    <TableCell>
                      {lead.next_followup_at || lead.next_followup_date ? (
                        <div className="flex items-center gap-1 text-[11px] font-mono text-gray-700">
                          <Calendar className="h-3 w-3 text-[#4A5568]" />
                          <span>
                            {new Date(lead.next_followup_at || lead.next_followup_date).toLocaleDateString('en-IN')}
                          </span>
                        </div>
                      ) : (
                        <span className="text-[#4A5568] italic text-[10px]">None set</span>
                      )}
                    </TableCell>

                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
                        <Button
                          size="xs"
                          variant="secondary"
                          onClick={() => {
                            setInteractionForm({
                              ...interactionForm,
                              lead_id: lead.id,
                              organisation_id: lead.organisation_id,
                              contact_id: lead.primary_contact_id || '',
                            });
                            setIsLogInteractionOpen(true);
                          }}
                          leftIcon={<MessageSquare className="h-3 w-3" />}
                        >
                          Log Touch
                        </Button>
                        <Button
                          size="xs"
                          variant="outline"
                          onClick={() => handleOpenLead(lead.id)}
                          leftIcon={<Eye className="h-3 w-3" />}
                        >
                          Inspect
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {/* Pagination */}
          {leadsTotalPages > 1 && (
            <div className="flex items-center justify-between pt-2">
              <span className="text-xs text-[#4A5568]">
                Page {leadsPage} of {leadsTotalPages}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={leadsPage <= 1}
                  onClick={() => setLeadsPage((p) => Math.max(1, p - 1))}
                >
                  Previous
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={leadsPage >= leadsTotalPages}
                  onClick={() => setLeadsPage((p) => Math.min(leadsTotalPages, p + 1))}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: CUSTOMER REGISTER & 360° ACCOUNT VIEW                             */}
      {/* ========================================================================= */}
      {activeTab === 'customers' && (
        <div className="space-y-4">
          <ToolbarSlot><div className="p-3 bg-white border border-[#DCD8CE] rounded-xl shadow-2xs flex flex-wrap items-center justify-between gap-3">
            <div className="relative w-full sm:w-80">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-[#4A5568]" />
              <input
                type="text"
                placeholder="Search organisations by name, city, sector..."
                value={customerSearch}
                onChange={(e) => setCustomerSearch(e.target.value)}
                className="w-full pl-9 pr-8 py-1.5 text-xs bg-[#FBFAF7] border border-[#DCD8CE] rounded-lg text-[#14213D] placeholder-[#4A5568] focus:outline-none focus:border-[#0F5E63]"
              />
              {customerSearch && (
                <button
                  type="button"
                  onClick={() => setCustomerSearch('')}
                  className="absolute right-2.5 top-2 text-[#4A5568] hover:text-[#14213D] text-xs font-bold"
                  title="Clear search"
                >
                  ✕
                </button>
              )}
            </div>
            <div className="text-xs text-[#4A5568] font-medium">
              {customerSearch ? (
                <span>
                  Showing <strong className="text-[#14213D]">{customers.length}</strong> of{' '}
                  <strong className="text-[#14213D]">{customersTotal}</strong> matching accounts{' '}
                  <span className="text-[#4A5568]/80">({totalCustomersCount || customersTotal} total in system)</span>
                </span>
              ) : (
                <span>
                  Showing <strong className="text-[#14213D]">{customers.length}</strong> of{' '}
                  <strong className="text-[#14213D]">{customersTotal}</strong> accounts in system
                </span>
              )}
            </div>
          </div></ToolbarSlot>

          {customersLoading ? (
            <PageLoader label="Loading customer accounts" />
          ) : customers.length === 0 ? (
            <EmptyState
              icon={Building}
              title="No customer accounts found"
              description="No organisations match your search. Create an opportunity to auto-register an account."
            />
          ) : (
            <Table className="min-w-[1050px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Organisation Name</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Sector / Category</TableHead>
                  <TableHead>Primary Contact</TableHead>
                  <TableHead>Current Sales Owner</TableHead>
                  <TableHead>Pipeline Status</TableHead>
                  <TableHead>Latest Touchpoint</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {customers.map((org) => (
                  <TableRow
                    key={org.id}
                    className="group cursor-pointer"
                    onClick={() => handleOpenCustomer360(org.id)}
                  >
                    <TableCell>
                      <div className="font-bold text-[#14213D] group-hover:text-[#0F5E63] transition-colors flex items-center gap-1.5">
                        <Building className="h-4 w-4 text-[#0F5E63] shrink-0" />
                        <span>{org.name}</span>
                      </div>
                      {org.department && (
                        <div className="text-[10px] text-[#4A5568]">{org.department}</div>
                      )}
                    </TableCell>

                    <TableCell>
                      <div className="text-xs text-gray-800 flex items-center gap-1">
                        <MapPin className="h-3 w-3 text-[#4A5568]" />
                        <span>{org.city || '—'}, {org.state || '—'}</span>
                      </div>
                      {org.zone_name && (
                        <div className="text-[10px] text-[#4A5568]">{org.zone_name} Zone</div>
                      )}
                    </TableCell>

                    <TableCell>
                      <span className="px-2 py-0.5 rounded bg-[#F8FAFC] border border-[#DCD8CE] text-[11px] font-medium text-gray-700">
                        {org.sector || 'Government / PSU'}
                      </span>
                    </TableCell>

                    <TableCell>
                      {org.primary_contact ? (
                        <div>
                          <div className="font-medium text-[#14213D]">
                            {org.primary_contact.name}
                          </div>
                          <div className="text-[10px] text-[#4A5568]">
                            {org.primary_contact.phone || org.primary_contact.email || org.primary_contact.designation || '—'}
                          </div>
                        </div>
                      ) : (
                        <span className="text-[#4A5568] italic text-[11px]">No contact set</span>
                      )}
                    </TableCell>

                    <TableCell>
                      <span className="font-semibold text-gray-800">
                        {org.current_salesperson || 'Unassigned'}
                      </span>
                    </TableCell>

                    <TableCell>
                      {org.lead_status ? getStatusBadge(org.lead_status) : (
                        <span className="text-[#4A5568] text-[10px] italic">No active lead</span>
                      )}
                    </TableCell>

                    <TableCell>
                      {org.last_interaction_at ? (
                        <div className="text-[11px] font-mono text-gray-700">
                          {new Date(org.last_interaction_at).toLocaleDateString('en-IN')}
                        </div>
                      ) : (
                        <span className="text-[#4A5568] italic text-[10px]">No interactions</span>
                      )}
                    </TableCell>

                    <TableCell className="text-right">
                      <Button
                        size="xs"
                        variant="secondary"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenCustomer360(org.id);
                        }}
                        rightIcon={<ChevronRight className="h-3.5 w-3.5" />}
                      >
                        360° View
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {customersTotalPages > 1 && (
            <div className="flex items-center justify-between pt-2">
              <span className="text-xs text-[#4A5568]">
                Showing {customers.length > 0 ? (customersPage - 1) * 15 + 1 : 0}–{Math.min(customersPage * 15, customersTotal)} of {customersTotal} accounts • Page {customersPage} of {customersTotalPages}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={customersPage <= 1}
                  onClick={() => setCustomersPage((p) => Math.max(1, p - 1))}
                >
                  Previous
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={customersPage >= customersTotalPages}
                  onClick={() => setCustomersPage((p) => Math.min(customersTotalPages, p + 1))}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 3: FOLLOW-UPS DESK                                                    */}
      {/* ========================================================================= */}
      {activeTab === 'followups' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-white border border-[#DCD8CE] rounded-xl shadow-2xs">
            <div className="flex items-center gap-1.5">
              {[
                { id: 'all', label: 'All Follow-ups' },
                { id: 'today', label: `Due Today (${followupStats?.dueToday ?? followupStats?.due_today ?? 0})` },
                { id: 'overdue', label: `Overdue (${followupStats?.overdue ?? 0})` },
                { id: 'upcoming', label: `Upcoming (${followupStats?.upcoming ?? 0})` },
                { id: 'completed', label: `Completed (${followupStats?.completed ?? 0})` },
              ].map((chip) => (
                <button
                  key={chip.id}
                  onClick={() => setFollowupTimeframe(chip.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                    followupTimeframe === chip.id
                      ? 'bg-[#0F5E63] text-white shadow-xs'
                      : 'bg-[#FBFAF7] text-[#4A5568] hover:bg-[#E3EFEE] hover:text-[#0F5E63] border border-[#DCD8CE]'
                  }`}
                >
                  {chip.label}
                </button>
              ))}
            </div>

            <span className="text-xs text-[#4A5568]">
              Total {followups.length} follow-ups displayed
            </span>
          </div>

          {followupsLoading ? (
            <PageLoader label="Loading follow-ups" />
          ) : followups.length === 0 ? (
            <EmptyState
              icon={Clock}
              title="No follow-ups in this queue"
              description="You have no pending follow-up touchpoints matching this timeframe."
            />
          ) : (
            <Table className="min-w-[950px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Due Date</TableHead>
                  <TableHead>Client & Opportunity</TableHead>
                  <TableHead>Contact Officer</TableHead>
                  <TableHead>Assigned Salesperson</TableHead>
                  <TableHead>Follow-up Objective / Remarks</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {followups.map((fu) => {
                  const isOverdue =
                    fu.status === 'pending' &&
                    new Date(fu.due_date).getTime() < new Date().setHours(0, 0, 0, 0);
                  const isToday =
                    fu.status === 'pending' &&
                    new Date(fu.due_date).toDateString() === new Date().toDateString();

                  return (
                    <TableRow key={fu.id}>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <Clock className={`h-4 w-4 ${isOverdue ? 'text-red-600' : isToday ? 'text-amber-600' : 'text-[#0F5E63]'}`} />
                          <span className="font-mono font-bold text-xs text-[#14213D]">
                            {new Date(fu.due_date).toLocaleDateString('en-IN')}
                          </span>
                        </div>
                        {isOverdue && (
                          <Badge variant="danger" size="sm" className="mt-1 text-[10px]">
                            OVERDUE
                          </Badge>
                        )}
                        {isToday && (
                          <Badge variant="warning" size="sm" className="mt-1 text-[10px]">
                            DUE TODAY
                          </Badge>
                        )}
                      </TableCell>

                      <TableCell>
                        <div className="font-bold text-[#14213D] line-clamp-1">
                          {fu.organisation_name || 'Organisation'}
                        </div>
                        {fu.lead_title && (
                          <div className="text-[10px] text-[#0F5E63] font-medium line-clamp-1">
                            Deal: {fu.lead_title}
                          </div>
                        )}
                      </TableCell>

                      <TableCell>
                        {fu.contact_name ? (
                          <div>
                            <div className="font-medium text-[#14213D]">{fu.contact_name}</div>
                            <div className="text-[10px] text-[#4A5568]">{fu.contact_phone || '—'}</div>
                          </div>
                        ) : (
                          <span className="text-[#4A5568] italic text-[11px]">—</span>
                        )}
                      </TableCell>

                      <TableCell>
                        <span className="font-semibold text-gray-800 text-xs">
                          {fu.assigned_salesperson_name || 'Sales Officer'}
                        </span>
                      </TableCell>

                      <TableCell>
                        <p className="text-xs text-gray-700 leading-snug max-w-sm line-clamp-2">
                          {fu.remarks || 'Standard pipeline follow-up'}
                        </p>
                        {fu.outcome && (
                          <div className="text-[10px] text-emerald-700 mt-0.5">
                            Outcome: {fu.outcome}
                          </div>
                        )}
                      </TableCell>

                      <TableCell>
                        {fu.status === 'completed' ? (
                          <Badge variant="success" size="sm">COMPLETED</Badge>
                        ) : fu.status === 'cancelled' ? (
                          <Badge variant="default" size="sm">CANCELLED</Badge>
                        ) : (
                          <Badge variant="outline" size="sm">PENDING</Badge>
                        )}
                      </TableCell>

                      <TableCell className="text-right">
                        {fu.status === 'pending' && (
                          <div className="flex items-center justify-end gap-1.5">
                            <Button
                              size="xs"
                              variant="success"
                              onClick={() => {
                                setSelectedFollowup(fu);
                                setCompletionOutcome('');
                                setCompletionRemarks('');
                                setScheduleNextFollowup(false);
                                setNextFollowupDueDate('');
                                setIsCompleteFollowupOpen(true);
                              }}
                              leftIcon={<Check className="h-3 w-3" />}
                            >
                              Complete
                            </Button>
                            <Button
                              size="xs"
                              variant="outline"
                              onClick={() => {
                                setSelectedFollowup(fu);
                                setRescheduleDate(fu.due_date);
                                setRescheduleRemarks('');
                                setIsRescheduleFollowupOpen(true);
                              }}
                            >
                              Reschedule
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 4: EXECUTIVE INTELLIGENCE REPORTS                                     */}
      {/* ========================================================================= */}
      {activeTab === 'reports' && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 p-1.5 bg-[#E3EFEE] border border-[#DCD8CE] rounded-xl w-fit">
            {[
              { id: 'salesperson', label: 'Salesperson Performance', icon: <Users className="h-3.5 w-3.5" /> },
              { id: 'zones', label: 'Territorial Zone Breakdown', icon: <Compass className="h-3.5 w-3.5" /> },
              { id: 'products', label: 'Product Demand Intelligence', icon: <Briefcase className="h-3.5 w-3.5" /> },
              { id: 'interactions', label: 'Field Activity Breakdown', icon: <MessageSquare className="h-3.5 w-3.5" /> },
            ].map((sub) => (
              <button
                key={sub.id}
                onClick={() => setReportSubTab(sub.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  reportSubTab === sub.id
                    ? 'bg-white text-[#0F5E63] shadow-xs border border-[#DCD8CE]'
                    : 'text-[#4A5568] hover:text-[#14213D]'
                }`}
              >
                {sub.icon}
                <span>{sub.label}</span>
              </button>
            ))}
          </div>

          {/* Sub-report 1: Salesperson Performance */}
          {reportSubTab === 'salesperson' && (
            <Card>
              <CardHeader>
                <CardTitle>Salesperson Conversion & Pipeline Ownership</CardTitle>
              </CardHeader>
              <CardContent>
                <Table className="min-w-[950px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Salesperson Name</TableHead>
                      <TableHead>Total Assigned Leads</TableHead>
                      <TableHead>Fresh Leads</TableHead>
                      <TableHead>Re-Approached</TableHead>
                      <TableHead>Active Deals</TableHead>
                      <TableHead>Converted (Won)</TableHead>
                      <TableHead>Lost Deals</TableHead>
                      <TableHead>Pending Follow-ups</TableHead>
                      <TableHead>Overdue Follow-ups</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {salespersonReport.map((sp) => (
                      <TableRow key={sp.salesperson_id}>
                        <TableCell className="font-bold text-[#14213D]">
                          {sp.salesperson_name}
                        </TableCell>
                        <TableCell className="font-semibold text-center">{sp.total_leads}</TableCell>
                        <TableCell className="text-center font-medium text-emerald-700">{sp.fresh_leads}</TableCell>
                        <TableCell className="text-center font-medium text-amber-700">{sp.reapproached_leads}</TableCell>
                        <TableCell className="text-center font-bold text-[#0F5E63]">{sp.active_leads}</TableCell>
                        <TableCell className="text-center font-extrabold text-emerald-700">{sp.converted_leads}</TableCell>
                        <TableCell className="text-center text-red-700 font-medium">{sp.lost_leads}</TableCell>
                        <TableCell className="text-center font-mono">{sp.pending_followups}</TableCell>
                        <TableCell className="text-center">
                          {Number(sp.overdue_followups) > 0 ? (
                            <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-bold text-xs">
                              {sp.overdue_followups}
                            </span>
                          ) : (
                            <span className="text-[#4A5568] font-mono">0</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {/* Sub-report 2: Territorial Zone Breakdown */}
          {reportSubTab === 'zones' && (
            <Card>
              <CardHeader>
                <CardTitle>Territorial Zone & Regional Pipeline Analysis</CardTitle>
              </CardHeader>
              <CardContent>
                <Table className="min-w-[800px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Zone</TableHead>
                      <TableHead>Region</TableHead>
                      <TableHead className="text-center">Total Leads</TableHead>
                      <TableHead className="text-center">Fresh Leads</TableHead>
                      <TableHead className="text-center">Re-Approached</TableHead>
                      <TableHead className="text-center">Converted (Won)</TableHead>
                      <TableHead className="text-center">Lost Deals</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {zoneReport.map((z, idx) => (
                      <TableRow key={idx}>
                        <TableCell className="font-bold text-[#14213D]">{z.zone_name}</TableCell>
                        <TableCell className="font-medium text-gray-700">{z.region_name}</TableCell>
                        <TableCell className="text-center font-bold text-[#0F5E63]">{z.total_leads}</TableCell>
                        <TableCell className="text-center font-semibold text-emerald-700">{z.fresh_leads}</TableCell>
                        <TableCell className="text-center font-semibold text-amber-700">{z.reapproached_leads}</TableCell>
                        <TableCell className="text-center font-bold text-emerald-700">{z.converted_leads}</TableCell>
                        <TableCell className="text-center font-medium text-red-700">{z.lost_leads}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {/* Sub-report 3: Product Demand Intelligence */}
          {reportSubTab === 'products' && (
            <Card>
              <CardHeader>
                <CardTitle>Product Demand & Inquiry Heatmap</CardTitle>
              </CardHeader>
              <CardContent>
                <Table className="min-w-[750px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product Name</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead className="text-center">Total Lead Inquiries</TableHead>
                      <TableHead className="text-center">Active Pipeline Deals</TableHead>
                      <TableHead className="text-center">Converted Deals</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {productReport.map((p) => (
                      <TableRow key={p.product_id}>
                        <TableCell className="font-bold text-[#14213D]">{p.product_name}</TableCell>
                        <TableCell>
                          <Badge variant="outline" size="sm">{p.category?.toUpperCase() || 'DEFENCE'}</Badge>
                        </TableCell>
                        <TableCell className="text-center font-bold text-[#0F5E63]">{p.total_leads}</TableCell>
                        <TableCell className="text-center font-semibold text-amber-700">{p.active_leads}</TableCell>
                        <TableCell className="text-center font-extrabold text-emerald-700">{p.converted_leads}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {/* Sub-report 4: Field Activity Breakdown */}
          {reportSubTab === 'interactions' && (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
              {interactionReport.map((ir, idx) => (
                <div
                  key={idx}
                  className="p-4 bg-white border border-[#DCD8CE] rounded-xl shadow-2xs hover:border-[#0F5E63] transition-all flex flex-col justify-between"
                >
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-[#4A5568] block mb-1">
                      Channel
                    </span>
                    <Badge variant="outline" size="sm" className="font-bold uppercase">
                      {ir.interaction_type}
                    </Badge>
                  </div>
                  <div className="mt-4 pt-2 border-t border-[#DCD8CE] flex items-baseline justify-between">
                    <span className="text-[10px] text-[#4A5568] font-semibold">Total Logged</span>
                    <span className="text-xl font-extrabold text-[#0F5E63]">
                      {ir.total_interactions}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 1: CREATE LEAD / OPPORTUNITY (WITH LIVE DUPLICATE DETECTION)        */}
      {/* ========================================================================= */}
      <Modal
        isOpen={isCreateLeadOpen}
        onClose={handleCloseCreateLead}
        title="Register New Lead Opportunity"
        description="Capture comprehensive opportunity intelligence, contact person, jurisdiction, and initial interaction."
        maxWidth="4xl"
      >
        <form onSubmit={handleCreateLead} className="space-y-4 text-xs">
          {(createLeadError || formError) && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span className="font-medium">{createLeadError || formError}</span>
            </div>
          )}

          {/* 1. Organisation & Geography */}
          <div className="p-4 rounded-xl bg-[#FBFAF7] border border-[#DCD8CE] space-y-3">
            <div className="flex items-center justify-between border-b border-[#DCD8CE] pb-2">
              <div className="flex items-center gap-2">
                <Building className="h-4 w-4 text-[#0F5E63]" />
                <span className="text-xs font-bold text-[#14213D] uppercase tracking-wider">
                  1. Organisation & Jurisdiction
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setLeadForm({ ...leadForm, organisation_mode: 'new' })}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                    leadForm.organisation_mode === 'new'
                      ? 'bg-[#0F5E63] text-white shadow-sm'
                      : 'bg-white text-[#4A5568] border border-[#DCD8CE] hover:border-[#0F5E63]'
                  }`}
                >
                  Create New Account
                </button>
                <button
                  type="button"
                  onClick={() => setLeadForm({ ...leadForm, organisation_mode: 'existing' })}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                    leadForm.organisation_mode === 'existing'
                      ? 'bg-[#0F5E63] text-white shadow-sm'
                      : 'bg-white text-[#4A5568] border border-[#DCD8CE] hover:border-[#0F5E63]'
                  }`}
                >
                  Select Existing Account
                </button>
              </div>
            </div>

            {leadForm.organisation_mode === 'new' ? (
              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Input
                    label="Organisation / Agency Name *"
                    required
                    value={leadForm.organisation_name}
                    onChange={(e) => setLeadForm({ ...leadForm, organisation_name: e.target.value })}
                    placeholder="e.g. Central Reserve Police Force or Western Naval Command"
                  />
                  <Input
                    label="Department / Unit / Wing"
                    value={leadForm.department}
                    onChange={(e) => setLeadForm({ ...leadForm, department: e.target.value })}
                    placeholder="e.g. Procurement & Ordnance Branch"
                  />
                </div>

                {/* Duplicate Detection Alert Banner */}
                {isCheckingDuplicate && (
                  <div className="text-[11px] text-[#4A5568] italic flex items-center gap-1.5">
                    <Spinner size="xs" />
                    <span>Checking account database for duplicate records...</span>
                  </div>
                )}
                {duplicateMatches.length > 0 && (
                  <div className="p-3 rounded-xl bg-amber-50 border border-amber-300 text-amber-900 space-y-2">
                    <div className="flex items-center gap-2 font-bold text-xs">
                      <AlertTriangle className="h-4 w-4 text-amber-700 shrink-0" />
                      <span>Possible Duplicate Organisation Detected!</span>
                    </div>
                    <p className="text-[11px] text-amber-800 leading-snug">
                      {duplicateSuggestion}
                    </p>
                    <div className="space-y-1.5 pt-1">
                      {duplicateMatches.map((m) => (
                        <div
                          key={m.id}
                          className="flex items-center justify-between p-2 rounded-lg bg-white border border-amber-200"
                        >
                          <div>
                            <span className="font-bold text-[#14213D] block">{m.name}</span>
                            <span className="text-[10px] text-[#4A5568]">
                              {m.city || ''}, {m.state || ''} • Match: {m.matchReason}
                            </span>
                          </div>
                          <Button
                            type="button"
                            size="xs"
                            variant="secondary"
                            onClick={() => {
                              setLeadForm({
                                ...leadForm,
                                organisation_mode: 'existing',
                                organisation_id: m.id,
                              });
                              handleSelectExistingOrg(m.id);
                            }}
                          >
                            Link This Account
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <Select
                  label="Select Existing Organisation Account *"
                  required
                  value={leadForm.organisation_id}
                  onChange={(e) => handleSelectExistingOrg(e.target.value)}
                  options={[
                    { value: '', label: 'Select Organisation...' },
                    ...(organisationsList.length > 0 ? organisationsList : customers).map((c) => ({
                      value: c.id,
                      label: `${c.name} (${c.city || c.state || 'India'})`,
                    })),
                  ]}
                />
              </div>
            )}

            {/* City, State, Zone, Region, Sector */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
              <Input
                label="City *"
                required
                value={leadForm.city}
                onChange={(e) => setLeadForm({ ...leadForm, city: e.target.value })}
                placeholder="e.g. New Delhi"
              />
              <Input
                label="State *"
                required
                value={leadForm.state}
                onChange={(e) => setLeadForm({ ...leadForm, state: e.target.value })}
                placeholder="e.g. Delhi or Maharashtra"
              />
              <Select
                label="Sector / Department *"
                required
                value={leadForm.sector}
                onChange={(e) => setLeadForm({ ...leadForm, sector: e.target.value })}
                options={[
                  { value: '', label: 'Select Sector...' },
                  ...SECTOR_OPTIONS,
                ]}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Select
                label="Zone *"
                required
                value={leadForm.zone_id}
                onChange={(e) => handleZoneChange(e.target.value)}
                options={[
                  { value: '', label: 'Select Zone...' },
                  ...zonesList.map((z) => ({ value: z.id, label: `${z.name} (${z.code})` })),
                ]}
              />
              <Select
                label="Region *"
                required
                value={leadForm.region_id}
                onChange={(e) => setLeadForm({ ...leadForm, region_id: e.target.value })}
                options={[
                  { value: '', label: leadForm.zone_id ? 'Select Region in Zone...' : 'Select Region...' },
                  ...filteredRegions.map((r) => ({ value: r.id, label: r.name })),
                ]}
              />
            </div>
          </div>

          {/* 2. Key Contact Person */}
          <div className="p-4 rounded-xl bg-[#FBFAF7] border border-[#DCD8CE] space-y-3">
            <div className="flex items-center gap-2 border-b border-[#DCD8CE] pb-2">
              <User className="h-4 w-4 text-[#0F5E63]" />
              <span className="text-xs font-bold text-[#14213D] uppercase tracking-wider">
                2. Contact Person Details
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input
                label="Contact Person Name *"
                required
                value={leadForm.contact_name}
                onChange={(e) => setLeadForm({ ...leadForm, contact_name: e.target.value })}
                placeholder="e.g. Col. Alok Mathur or Shri R.K. Sharma"
              />
              <Input
                label="Designation / Rank *"
                required
                value={leadForm.contact_designation}
                onChange={(e) => setLeadForm({ ...leadForm, contact_designation: e.target.value })}
                placeholder="e.g. DIG Procurement, Director, ADG"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input
                label="Mobile / Direct Phone *"
                required
                value={leadForm.contact_mobile}
                onChange={(e) => setLeadForm({ ...leadForm, contact_mobile: e.target.value })}
                placeholder="+91 98110 00000"
              />
              <Input
                label="Email Address"
                type="email"
                value={leadForm.contact_email}
                onChange={(e) => setLeadForm({ ...leadForm, contact_email: e.target.value })}
                placeholder="officer@crpf.gov.in"
              />
            </div>
          </div>

          {/* 3. Product Interest, Source & Lead Status */}
          <div className="p-4 rounded-xl bg-[#FBFAF7] border border-[#DCD8CE] space-y-3">
            <div className="flex items-center gap-2 border-b border-[#DCD8CE] pb-2">
              <Target className="h-4 w-4 text-[#0F5E63]" />
              <span className="text-xs font-bold text-[#14213D] uppercase tracking-wider">
                3. Product Interest, Category, Source & Status
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="space-y-1.5 sm:col-span-2 lg:col-span-1">
                <Select
                  label="Product Interests *"
                  required={leadForm.product_ids.length === 0}
                  value=""
                  onChange={(e) => {
                    const pid = e.target.value;
                    if (pid && !leadForm.product_ids.includes(pid)) {
                      setLeadForm({
                        ...leadForm,
                        product_ids: [...leadForm.product_ids, pid],
                      });
                    }
                  }}
                  options={[
                    {
                      value: '',
                      label:
                        leadForm.product_ids.length === 0
                          ? 'Select Product Interest...'
                          : '+ Add another product interest...',
                    },
                    ...productsList
                      .filter((p) => !leadForm.product_ids.includes(p.id))
                      .map((p) => ({
                        value: p.id,
                        label: `${p.name} (${p.category || 'Security'})`,
                      })),
                  ]}
                />
              </div>
              <Select
                label="Lead Category *"
                required
                value={leadForm.category}
                onChange={(e) => setLeadForm({ ...leadForm, category: e.target.value as LeadCategory })}
                options={LEAD_CATEGORY_OPTIONS}
              />
              <Select
                label="Lead Source *"
                required
                value={leadForm.source}
                onChange={(e) => setLeadForm({ ...leadForm, source: e.target.value })}
                options={LEAD_SOURCE_OPTIONS}
              />
              <Select
                label="Lead Status *"
                required
                value={leadForm.lead_status}
                onChange={(e) => setLeadForm({ ...leadForm, lead_status: e.target.value as LeadStatus })}
                options={LEAD_STATUS_OPTIONS}
              />
            </div>
            {leadForm.product_ids.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {leadForm.product_ids.map((pid) => {
                  const prod = productsList.find((p) => p.id === pid);
                  return (
                    <span
                      key={pid}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#E3EFEE] text-[#0F5E63] text-xs font-semibold border border-[#0F5E63]/20"
                    >
                      <span className="truncate max-w-[200px]">{prod ? prod.name : pid}</span>
                      <button
                        type="button"
                        onClick={() =>
                          setLeadForm({
                            ...leadForm,
                            product_ids: leadForm.product_ids.filter((id) => id !== pid),
                          })
                        }
                        className="text-[#0F5E63] hover:text-red-700 transition-colors"
                        title="Remove product"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  );
                })}
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Input
                label="Estimated Deal Value (₹ Lakh)"
                type="number"
                step="0.1"
                value={leadForm.value_lakh}
                onChange={(e) => setLeadForm({ ...leadForm, value_lakh: e.target.value })}
                placeholder="e.g. 45.0"
              />
              <div className="sm:col-span-2 flex items-center pt-5">
                <span className="text-[11px] text-[#4A5568] italic">
                  💡 Arihant Lead Engine automatically dedupes against account history and tags Fresh vs Re-Approached pipeline cycle.
                </span>
              </div>
            </div>
          </div>

          {/* 4. Salesperson & Regional Manager */}
          <div className="p-4 rounded-xl bg-[#FBFAF7] border border-[#DCD8CE] space-y-3">
            <div className="flex items-center gap-2 border-b border-[#DCD8CE] pb-2">
              <Users className="h-4 w-4 text-[#0F5E63]" />
              <span className="text-xs font-bold text-[#14213D] uppercase tracking-wider">
                4. Ownership & Jurisdiction
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Select
                label="Assigned Salesperson *"
                required
                value={leadForm.assigned_to}
                onChange={(e) => handleSalespersonChange(e.target.value)}
                options={[
                  { value: '', label: 'Select Salesperson...' },
                  ...usersList.map((u) => ({ value: u.id, label: `${u.full_name} (${u.role})` })),
                ]}
              />
              <Select
                label="Regional Manager"
                value={leadForm.regional_manager_id}
                onChange={(e) => setLeadForm({ ...leadForm, regional_manager_id: e.target.value })}
                options={[
                  { value: '', label: 'Auto-assigned from reporting manager' },
                  ...usersList.filter((u) => u.role === 'regional_manager' || u.role === 'management' || u.role === 'admin').map((u) => ({ value: u.id, label: `${u.full_name} (${u.role})` })),
                ]}
              />
            </div>
          </div>

          {/* 5. Last Interaction, Next Follow-Up & Remarks */}
          <div className="p-4 rounded-xl bg-[#FBFAF7] border border-[#DCD8CE] space-y-3">
            <div className="flex items-center gap-2 border-b border-[#DCD8CE] pb-2">
              <Clock className="h-4 w-4 text-[#0F5E63]" />
              <span className="text-xs font-bold text-[#14213D] uppercase tracking-wider">
                5. Interactions, Follow-Up & Remarks
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Input
                label="Last Interaction Date *"
                type="date"
                required
                value={leadForm.last_interaction_date}
                onChange={(e) => setLeadForm({ ...leadForm, last_interaction_date: e.target.value })}
              />
              <Select
                label="Last Interaction Type"
                value={leadForm.last_interaction_type}
                onChange={(e) => setLeadForm({ ...leadForm, last_interaction_type: e.target.value })}
                options={INTERACTION_TYPE_OPTIONS}
              />
              <Input
                label="Next Follow-up Date (Optional)"
                type="date"
                value={leadForm.next_followup_date}
                onChange={(e) => setLeadForm({ ...leadForm, next_followup_date: e.target.value })}
              />
            </div>
            <Textarea
              label="Remarks & Discussion Summary"
              value={leadForm.remarks}
              onChange={(e) => setLeadForm({ ...leadForm, remarks: e.target.value })}
              placeholder="Record procurement timeline, budget sanction details, trial requirements, or interaction feedback..."
              rows={3}
            />
          </div>

          <div className="flex items-center justify-between pt-3 border-t border-[#DCD8CE]">
            <span className="text-[11px] text-[#4A5568]">
              * Required fields. All 18 parameters will be synced into the live pipeline.
            </span>
            <div className="flex items-center gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={handleCloseCreateLead}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" size="sm" isLoading={actionLoading}>
                Register Lead Opportunity
              </Button>
            </div>
          </div>
        </form>
      </Modal>

      {/* ========================================================================= */}
      {/* MODAL 2: LEAD DETAILS & LIFECYCLE PROGRESSION STEPPER                      */}
      {/* ========================================================================= */}
      <Modal
        isOpen={isLeadDetailOpen}
        onClose={() => setIsLeadDetailOpen(false)}
        title={selectedLead?.title || (selectedLead?.organisation_name ? `${selectedLead.organisation_name} — Opportunity Intelligence` : 'Opportunity Intelligence')}
        description={`Account: ${selectedLead?.organisation_name || 'Government Body'}${selectedLead?.department ? ` • ${selectedLead.department}` : ''}${selectedLead?.city ? ` (${selectedLead.city}, ${selectedLead.state || ''})` : ''}`}
        maxWidth="4xl"
      >
        {selectedLead && (
          <div className="space-y-5 text-xs">
            {/* Meta Executive Metrics Strip */}
            <div className="grid grid-cols-2 sm:grid-cols-6 gap-3 p-4 rounded-xl bg-[#FBFAF7] border border-[#DCD8CE]">
              <div>
                <span className="text-[10px] uppercase text-[#4A5568] font-bold block">Current Stage</span>
                <div className="mt-1">{getStatusBadge(selectedLead.lead_status || selectedLead.status)}</div>
              </div>
              <div>
                <span className="text-[10px] uppercase text-[#4A5568] font-bold block">Lead Category</span>
                <div className="mt-1">
                  <Badge variant="info" size="sm" className="font-bold">
                    {selectedLead.category === 'new_lead'
                      ? 'NEW LEAD'
                      : selectedLead.category === 'active'
                      ? 'ACTIVE'
                      : selectedLead.category === 'expected'
                      ? 'EXPECTED'
                      : selectedLead.category === 'follow_up'
                      ? 'FOLLOW-UP'
                      : (selectedLead.category || 'NEW LEAD').toUpperCase()}
                  </Badge>
                </div>
              </div>
              <div>
                <span className="text-[10px] uppercase text-[#4A5568] font-bold block">Classification</span>
                <div className="mt-1">
                  {selectedLead.lead_type === 're_approached' ? (
                    <Badge variant="warning" size="sm">RE-APPROACHED</Badge>
                  ) : (
                    <Badge variant="info" size="sm">FRESH ACCOUNT</Badge>
                  )}
                </div>
              </div>
              <div>
                <span className="text-[10px] uppercase text-[#4A5568] font-bold block">Estimated Deal</span>
                <span className="font-extrabold text-[#0F5E63] mt-1 block text-sm font-mono">
                  {formatLakh(selectedLead.value_lakh || selectedLead.estimated_value_lakh || 0)}
                </span>
              </div>
              <div>
                <span className="text-[10px] uppercase text-[#4A5568] font-bold block">Probability</span>
                <div className="mt-1">
                  <Badge
                    variant={
                      selectedLead.probability === 'high'
                        ? 'success'
                        : selectedLead.probability === 'medium'
                        ? 'warning'
                        : 'default'
                    }
                    size="sm"
                    className="font-bold uppercase text-[10px]"
                  >
                    {selectedLead.probability || 'MEDIUM'}
                  </Badge>
                </div>
              </div>
              <div>
                <span className="text-[10px] uppercase text-[#4A5568] font-bold block">Lead Source</span>
                <span className="font-bold text-[#14213D] mt-1 block capitalize truncate">
                  {LEAD_SOURCE_OPTIONS.find((s) => s.value === selectedLead.source)?.label || selectedLead.source || 'Direct Field Visit'}
                </span>
              </div>
            </div>

            {/* Two-Column Grid: 1. Organisation & Jurisdiction | 2. Key Contact Person */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* 1. Organisation & Jurisdiction Intelligence */}
              <div className="p-4 rounded-xl bg-white border border-[#DCD8CE] space-y-3">
                <div className="flex items-center gap-2 border-b border-[#ECE9E2] pb-2">
                  <Building className="h-4 w-4 text-[#0F5E63]" />
                  <span className="text-xs font-bold text-[#14213D] uppercase tracking-wider">
                    Organisation & Jurisdiction
                  </span>
                </div>
                <div className="space-y-2 text-xs">
                  <div>
                    <span className="text-[10px] font-semibold text-[#4A5568] uppercase block">Organisation / Agency Name</span>
                    <span className="font-bold text-[#14213D] text-sm block">
                      {selectedLead.organisation_name || '—'}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] font-semibold text-[#4A5568] uppercase block">Department / Unit / Wing</span>
                    <span className="font-medium text-[#14213D]">
                      {selectedLead.department || '—'}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 pt-1 border-t border-[#ECE9E2]">
                    <div>
                      <span className="text-[10px] font-semibold text-[#4A5568] uppercase block">Sector / Domain</span>
                      <span className="font-medium text-[#14213D]">
                        {SECTOR_OPTIONS.find((s) => s.value === selectedLead.sector)?.label || selectedLead.sector || 'Defence / Security'}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] font-semibold text-[#4A5568] uppercase block">Location (City, State)</span>
                      <span className="font-medium text-[#14213D] flex items-center gap-1">
                        <MapPin className="h-3 w-3 text-[#4A5568] shrink-0" />
                        <span>
                          {selectedLead.city ? `${selectedLead.city}, ` : ''}{selectedLead.state || 'India'}
                        </span>
                      </span>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 pt-1 border-t border-[#ECE9E2]">
                    <div>
                      <span className="text-[10px] font-semibold text-[#4A5568] uppercase block">Territory / Zone</span>
                      <span className="font-medium text-[#14213D]">
                        {selectedLead.zone_name
                          ? (selectedLead.zone_name.toLowerCase().includes('zone') ? selectedLead.zone_name : `${selectedLead.zone_name} Zone`)
                          : (zonesList.find((z) => z.id === selectedLead.zone_id)?.name
                              ? (zonesList.find((z) => z.id === selectedLead.zone_id)!.name.toLowerCase().includes('zone')
                                  ? zonesList.find((z) => z.id === selectedLead.zone_id)!.name
                                  : `${zonesList.find((z) => z.id === selectedLead.zone_id)!.name} Zone`)
                              : 'North Zone')}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] font-semibold text-[#4A5568] uppercase block">Region Office</span>
                      <span className="font-medium text-[#14213D]">
                        {selectedLead.region_name || regionsList.find((r) => r.id === selectedLead.region_id)?.name || 'Delhi NCR'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* 2. Key Contact Person Details */}
              <div className="p-4 rounded-xl bg-white border border-[#DCD8CE] space-y-3">
                <div className="flex items-center gap-2 border-b border-[#ECE9E2] pb-2">
                  <User className="h-4 w-4 text-[#0F5E63]" />
                  <span className="text-xs font-bold text-[#14213D] uppercase tracking-wider">
                    Key Contact Person
                  </span>
                </div>
                <div className="space-y-2 text-xs">
                  <div>
                    <span className="text-[10px] font-semibold text-[#4A5568] uppercase block">Contact Person Name</span>
                    <span className="font-bold text-[#14213D] text-sm block">
                      {selectedLead.contact_name || 'No Contact Specified'}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] font-semibold text-[#4A5568] uppercase block">Designation / Rank</span>
                    <span className="font-medium text-[#14213D]">
                      {selectedLead.contact_designation || 'Officer / Authority'}
                    </span>
                  </div>
                  <div className="pt-1 border-t border-[#ECE9E2] space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-semibold text-[#4A5568] uppercase">Mobile / Phone</span>
                      {selectedLead.contact_mobile ? (
                        <a
                          href={`tel:${selectedLead.contact_mobile}`}
                          className="font-mono text-xs font-semibold text-[#0F5E63] hover:underline flex items-center gap-1.5"
                        >
                          <Phone className="h-3 w-3" />
                          <span>{selectedLead.contact_mobile}</span>
                        </a>
                      ) : (
                        <span className="text-[#4A5568] italic text-[11px]">—</span>
                      )}
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-semibold text-[#4A5568] uppercase">Email Address</span>
                      {selectedLead.contact_email ? (
                        <a
                          href={`mailto:${selectedLead.contact_email}`}
                          className="font-mono text-xs font-semibold text-[#0F5E63] hover:underline flex items-center gap-1.5 truncate max-w-[200px]"
                          title={selectedLead.contact_email}
                        >
                          <Mail className="h-3 w-3 shrink-0" />
                          <span className="truncate">{selectedLead.contact_email}</span>
                        </a>
                      ) : (
                        <span className="text-[#4A5568] italic text-[11px]">—</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Ownership & Territorial Jurisdiction Strip */}
            <div className="p-4 rounded-xl bg-[#FBFAF7] border border-[#DCD8CE]">
              <div className="flex items-center gap-2 border-b border-[#DCD8CE] pb-2 mb-3">
                <Users className="h-4 w-4 text-[#0F5E63]" />
                <span className="text-xs font-bold text-[#14213D] uppercase tracking-wider">
                  Sales Ownership & Managerial Governance
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <div>
                  <span className="text-[10px] font-semibold text-[#4A5568] uppercase block">Assigned Sales Owner</span>
                  <span className="font-bold text-[#14213D] block mt-0.5">
                    {selectedLead.assigned_salesperson_name || selectedLead.assignee_name || 'Unassigned'}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] font-semibold text-[#4A5568] uppercase block">Regional Manager / Escalation</span>
                  <span className="font-bold text-[#14213D] block mt-0.5">
                    {selectedLead.regional_manager_name || 'Reporting Head'}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] font-semibold text-[#4A5568] uppercase block">Channel Route</span>
                  <span className="font-bold text-[#14213D] block mt-0.5 uppercase font-mono">
                    {selectedLead.channel || 'DIRECT'}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] font-semibold text-[#4A5568] uppercase block">Lead Created / Registered</span>
                  <span className="font-mono text-xs text-[#14213D] block mt-0.5">
                    {selectedLead.created_at ? new Date(selectedLead.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                  </span>
                </div>
              </div>
            </div>

            {/* Interactions, Scheduled Follow-Up & Remarks */}
            <div className="p-4 rounded-xl bg-white border border-[#DCD8CE] space-y-3">
              <div className="flex items-center gap-2 border-b border-[#ECE9E2] pb-2">
                <Clock className="h-4 w-4 text-[#0F5E63]" />
                <span className="text-xs font-bold text-[#14213D] uppercase tracking-wider">
                  Interactions, Follow-Up Schedule & Notes
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="p-3 rounded-lg bg-[#FBFAF7] border border-[#ECE9E2]">
                  <span className="text-[10px] font-bold text-[#4A5568] uppercase block mb-1">Last Interaction Touchpoint</span>
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-semibold text-[#14213D]">
                      {selectedLead.last_contact_date
                        ? new Date(selectedLead.last_contact_date).toLocaleDateString('en-IN')
                        : selectedLead.last_interaction_at
                        ? new Date(selectedLead.last_interaction_at).toLocaleDateString('en-IN')
                        : selectedLead.interactions?.[0]?.occurred_on
                        ? new Date(selectedLead.interactions[0].occurred_on).toLocaleDateString('en-IN')
                        : 'None logged'}
                    </span>
                    <Badge variant="outline" size="sm" className="font-bold text-[10px]">
                      {INTERACTION_TYPE_OPTIONS.find(t => t.value === (selectedLead.last_interaction_type || selectedLead.interactions?.[0]?.type))?.label ||
                        (selectedLead.last_interaction_type || selectedLead.interactions?.[0]?.type || 'CALL').toUpperCase()}
                    </Badge>
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-[#FBFAF7] border border-[#ECE9E2]">
                  <span className="text-[10px] font-bold text-[#4A5568] uppercase block mb-1">Next Follow-Up Commitment</span>
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-semibold text-[#14213D]">
                      {selectedLead.next_followup_date
                        ? new Date(selectedLead.next_followup_date).toLocaleDateString('en-IN')
                        : selectedLead.next_followup_at
                        ? new Date(selectedLead.next_followup_at).toLocaleDateString('en-IN')
                        : selectedLead.follow_ups?.[0]?.due_date
                        ? new Date(selectedLead.follow_ups[0].due_date).toLocaleDateString('en-IN')
                        : 'None scheduled'}
                    </span>
                    {(selectedLead.next_followup_date || selectedLead.next_followup_at || selectedLead.follow_ups?.[0]?.due_date) && (
                      <Badge variant="warning" size="sm" className="uppercase font-bold text-[10px]">
                        {selectedLead.next_followup_status || selectedLead.follow_ups?.[0]?.status || 'PENDING'}
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
              <div>
                <span className="text-[10px] font-bold text-[#4A5568] uppercase block mb-1">Remarks & Discussion Summary</span>
                <div className="p-3 rounded-lg bg-[#FBFAF7] border border-[#ECE9E2] text-xs text-[#14213D] leading-relaxed">
                  {selectedLead.remarks || selectedLead.last_interaction_notes || selectedLead.interactions?.[0]?.remarks || (
                    <span className="text-[#4A5568] italic">No remarks provided during opportunity registration.</span>
                  )}
                </div>
              </div>
            </div>

            {/* Allowed Lifecycle Transitions Stepper */}
            <div className="p-4 rounded-xl bg-white border border-[#DCD8CE] space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-[#14213D] uppercase tracking-wider flex items-center gap-1.5">
                  <ArrowRight className="h-4 w-4 text-[#0F5E63]" />
                  <span>Lifecycle Stage Transitions</span>
                </span>
                <span className="text-[10px] text-[#4A5568]">
                  Validated by LeadWorkflowService state machine
                </span>
              </div>

              {actionSuccess && (
                <div className="p-2.5 rounded-lg bg-[#E3EFEE] border border-[#0F5E63]/30 text-[#0F5E63] text-xs font-semibold flex items-center justify-between animate-in fade-in">
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 className="h-4 w-4 text-[#0F5E63]" />
                    <span>{actionSuccess}</span>
                  </div>
                  <button type="button" onClick={() => setActionSuccess(null)} className="text-[#0F5E63] hover:opacity-70 font-bold ml-2">×</button>
                </div>
              )}

              {formError && (
                <div className="p-2.5 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs font-medium">
                  {formError}
                </div>
              )}

              {selectedLead.allowed_transitions && selectedLead.allowed_transitions.length > 0 ? (
                <div className="flex flex-wrap items-center gap-2">
                  {selectedLead.allowed_transitions.map((nextSt: string) => (
                    <Button
                      key={nextSt}
                      size="xs"
                      variant={nextSt === 'converted' ? 'success' : nextSt === 'lost' ? 'danger' : 'outline'}
                      isLoading={actionLoading && targetStatus === nextSt}
                      onClick={() => handleDirectAdvanceStatus(nextSt)}
                    >
                      Advance to: {nextSt.toUpperCase()}
                    </Button>
                  ))}
                </div>
              ) : (
                <div className="text-[11px] text-[#4A5568] italic">
                  This lead is in terminal stage ({selectedLead.lead_status?.toUpperCase()}). No further transitions allowed.
                </div>
              )}
            </div>

            {/* Product Interests Section */}
            <div className="p-4 rounded-xl bg-[#FBFAF7] border border-[#DCD8CE] space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-[#14213D] uppercase tracking-wider flex items-center gap-1.5">
                  <Briefcase className="h-4 w-4 text-[#0F5E63]" />
                  <span>Product Interests</span>
                </span>
                {productsList.length > 0 && (
                  <select
                    onChange={(e) => {
                      if (e.target.value) handleAddProductInterest(e.target.value);
                      e.target.value = '';
                    }}
                    className="px-2 py-1 text-[11px] bg-white border border-[#DCD8CE] rounded-lg text-[#14213D]"
                  >
                    <option value="">+ Add Product Interest</option>
                    {productsList.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                )}
              </div>

              {selectedLead.product_interests && selectedLead.product_interests.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {selectedLead.product_interests.map((p: any) => (
                    <span
                      key={p.product_id || p.id}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white border border-[#DCD8CE] text-xs font-medium text-[#14213D]"
                    >
                      <span>{p.name || p.product_name || productsList.find((x) => x.id === (p.product_id || p.id))?.name || 'Product Interest'}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveProductInterest(p.product_id || p.id)}
                        className="text-gray-400 hover:text-red-600 transition-colors"
                        title="Remove product"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  ))}
                </div>
              ) : selectedLead.product_name ? (
                <div className="flex flex-wrap gap-2">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white border border-[#DCD8CE] text-xs font-medium text-[#14213D]">
                    <span>{selectedLead.product_name}</span>
                  </span>
                </div>
              ) : (
                <span className="text-[11px] text-[#4A5568] italic">No products attached yet.</span>
              )}
            </div>

            {/* Salesperson Assignment History Audit */}
            <div className="p-4 rounded-xl bg-white border border-[#DCD8CE] space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-[#14213D] uppercase tracking-wider flex items-center gap-1.5">
                  <ShieldCheck className="h-4 w-4 text-[#0F5E63]" />
                  <span>Salesperson Ownership Audit History</span>
                </span>
                <div className="flex items-center gap-2">
                  {!canReassign && (
                    <span className="text-[10px] font-medium text-[#4A5568] bg-[#E3EFEE] px-2 py-0.5 rounded-full border border-[#DCD8CE]">
                      Managerial Action
                    </span>
                  )}
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => {
                      setNewSalespersonId(selectedLead.assigned_to || '');
                      setReassignReason('');
                      setFormError(null);
                      setIsReassignModalOpen(true);
                    }}
                  >
                    Reassign Lead
                  </Button>
                </div>
              </div>

              {selectedLead.assignment_history && selectedLead.assignment_history.length > 0 ? (
                <div className="space-y-2">
                  {selectedLead.assignment_history.map((h: any) => (
                    <div
                      key={h.id}
                      className="p-2.5 rounded-lg bg-[#F8FAFC] border border-[#DCD8CE] flex items-center justify-between text-[11px]"
                    >
                      <div>
                        <span className="font-semibold text-[#14213D]">
                          {h.previous_salesperson_name || 'Unassigned'} → {h.new_salesperson_name}
                        </span>
                        {h.reason && (
                          <span className="text-[#4A5568] block mt-0.5">Reason: {h.reason}</span>
                        )}
                      </div>
                      <div className="text-right text-[#4A5568] font-mono text-[10px]">
                        By {h.changed_by_name || 'Admin'} • {new Date(h.changed_at).toLocaleDateString('en-IN')}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <span className="text-[11px] text-[#4A5568] italic">
                  Initial assignment active. No salesperson reassignments recorded.
                </span>
              )}
            </div>

            {/* Action Bar */}
            <div className="flex items-center justify-between pt-2 border-t border-[#DCD8CE]">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setIsLeadDetailOpen(false);
                  handleOpenCustomer360(selectedLead.organisation_id);
                }}
                leftIcon={<Building className="h-4 w-4" />}
              >
                Open 360° Account View
              </Button>
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setInteractionForm({
                      ...interactionForm,
                      lead_id: selectedLead.id,
                      organisation_id: selectedLead.organisation_id,
                      contact_id: selectedLead.primary_contact_id || '',
                    });
                    setIsLogInteractionOpen(true);
                  }}
                  leftIcon={<MessageSquare className="h-4 w-4" />}
                >
                  Log Touchpoint
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setIsLeadDetailOpen(false)}>
                  Close
                </Button>
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* ========================================================================= */}
      {/* MODAL 3: ADVANCE STATUS & LOSS REASON CAPTURE                             */}
      {/* ========================================================================= */}
      <Modal
        isOpen={isStatusModalOpen}
        onClose={() => setIsStatusModalOpen(false)}
        title={`Advance Opportunity Status: ${targetStatus.toUpperCase()}`}
        description="Transitions are verified against Arihant BOS state machine rules."
        maxWidth="md"
        zIndex={60}
      >
        <form onSubmit={handleStatusChange} className="space-y-4 text-xs">
          {formError && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700">
              {formError}
            </div>
          )}

          {targetStatus === 'lost' && (
            <div className="space-y-3 p-3 rounded-xl bg-red-50 border border-red-200">
              <span className="font-bold text-red-900 block text-xs">
                Mandatory Win/Loss Analysis Reason:
              </span>
              <Select
                label="Loss Reason *"
                required
                value={lossReason}
                onChange={(e) => setLossReason(e.target.value)}
                options={[
                  { value: 'price', label: 'Price / Commercial Disadvantage' },
                  { value: 'competitor', label: 'Competitor Selected (L1 / GeM preference)' },
                  { value: 'no_response', label: 'No Response / Client Silent' },
                  { value: 'not_interested', label: 'Client Not Interested' },
                  { value: 'eligibility', label: 'Technical Eligibility / Spec Mismatch' },
                  { value: 'timing', label: 'Budget Deferred / Timing Cancelled' },
                  { value: 'other', label: 'Other' },
                ]}
              />
              <Textarea
                label="Loss Remarks & Debrief Notes"
                value={lossRemarks}
                onChange={(e) => setLossRemarks(e.target.value)}
                placeholder="Details of competitor bid, price difference, or specification requirements..."
              />
            </div>
          )}

          <p className="text-gray-600">
            Confirm advancing this opportunity from{' '}
            <strong className="text-[#14213D]">{selectedLead?.lead_status?.toUpperCase()}</strong> to{' '}
            <strong className="text-[#0F5E63]">{targetStatus.toUpperCase()}</strong>.
          </p>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#DCD8CE]">
            <Button type="button" variant="ghost" size="sm" onClick={() => setIsStatusModalOpen(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              variant={targetStatus === 'lost' ? 'danger' : 'primary'}
              isLoading={actionLoading}
            >
              Confirm Transition
            </Button>
          </div>
        </form>
      </Modal>

      {/* ========================================================================= */}
      {/* MODAL 4: REASSIGN SALESPERSON & LOG REASON                                */}
      {/* ========================================================================= */}
      <Modal
        isOpen={isReassignModalOpen}
        onClose={() => setIsReassignModalOpen(false)}
        title="Reassign Opportunity Ownership"
        description="Transfers the lead to a new salesperson and immutably records the reassignment in audit history."
        maxWidth="md"
        zIndex={60}
      >
        <form onSubmit={handleReassign} className="space-y-4 text-xs">
          {!canReassign && (
            <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 space-y-2.5">
              <div className="flex items-center gap-2 font-semibold text-xs text-amber-800">
                <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                <span>Managerial Authorization Required</span>
              </div>
              <p className="text-[11px] text-amber-700 leading-relaxed">
                Under Arihant BOS territorial governance, lead ownership reassignment is restricted to <strong>Regional Manager</strong>, <strong>Management</strong>, or <strong>Admin</strong> roles to ensure account integrity. Your current active role is <span className="font-mono font-medium px-1.5 py-0.5 rounded bg-amber-100/70 border border-amber-300 text-amber-900">{user?.role}</span>.
              </p>
              <div className="pt-1 flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  size="xs"
                  variant="primary"
                  isLoading={isSwitchingPersona}
                  onClick={() => handleQuickSwitchRole('regional_manager')}
                >
                  <UserCheck className="h-3.5 w-3.5 mr-1" />
                  Switch to Regional Manager (Vikram Sharma)
                </Button>
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  isLoading={isSwitchingPersona}
                  onClick={() => handleQuickSwitchRole('management')}
                >
                  Switch to Management (Rajiv Arihant)
                </Button>
              </div>
            </div>
          )}

          {formError && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700">
              {formError}
            </div>
          )}

          <Select
            label="New Salesperson *"
            required
            value={newSalespersonId}
            onChange={(e) => setNewSalespersonId(e.target.value)}
            options={[
              { value: '', label: 'Select Salesperson' },
              ...usersList.map((u) => ({ value: u.id, label: `${u.full_name} (${u.role})` })),
            ]}
          />

          <Input
            label="Reassignment Reason"
            value={reassignReason}
            onChange={(e) => setReassignReason(e.target.value)}
            placeholder="e.g. Territory reorganization / officer transferred to Delhi HQ"
          />

          <div className="flex items-center justify-between pt-2 border-t border-[#DCD8CE]">
            {!canReassign ? (
              <span className="text-[11px] text-amber-700 font-medium">
                Switch role above to enable transfer.
              </span>
            ) : (
              <span className="text-[11px] text-[#4A5568]">
                Authorized as {user?.role.replace('_', ' ')}
              </span>
            )}
            <div className="flex items-center gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setIsReassignModalOpen(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="sm"
                isLoading={actionLoading}
                disabled={!canReassign}
              >
                Reassign & Dispatch Event
              </Button>
            </div>
          </div>
        </form>
      </Modal>

      {/* ========================================================================= */}
      {/* MODAL 5A: DEMO REQUEST & FIELD TEAM COORDINATION                          */}
      {/* ========================================================================= */}
      <Modal
        isOpen={isDemoModalOpen}
        onClose={() => setIsDemoModalOpen(false)}
        title="🎯 Schedule Product Demonstration"
        description={`Coordinates field demonstration for ${selectedLead?.organisation_name || 'Client'}. Dispatches auto-reminders and tasks to the assigned demo specialist.`}
        maxWidth="4xl"
        zIndex={60}
      >
        <form onSubmit={handleSubmitDemoTransition} className="space-y-4 text-xs">
          {formError && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700">
              {formError}
            </div>
          )}

          {/* Context Strip: Customer, Location, Requested Date, Salesperson */}
          <div className="p-3 rounded-xl bg-[#FBFAF7] border border-[#DCD8CE] grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div>
              <span className="text-[10px] uppercase font-bold text-[#4A5568] block">Customer:</span>
              <span className="font-semibold text-[#14213D] truncate block">
                🏢 {selectedLead?.organisation_name}
              </span>
            </div>
            <div>
              <span className="text-[10px] uppercase font-bold text-[#4A5568] block">Location:</span>
              <span className="font-semibold text-[#14213D] truncate block">
                📍 {demoForm.location || selectedLead?.city || 'Client Site / Field'}
              </span>
            </div>
            <div>
              <span className="text-[10px] uppercase font-bold text-[#4A5568] block">Requested Date:</span>
              <span className="font-semibold text-[#14213D] block font-mono">
                📅 {demoForm.requested_date ? new Date(demoForm.requested_date).toLocaleDateString() : 'Pending'}
              </span>
            </div>
            <div>
              <span className="text-[10px] uppercase font-bold text-[#4A5568] block">Lead Salesperson:</span>
              <span className="font-semibold text-[#14213D] truncate block">
                👤 {usersList.find((u) => u.id === selectedLead?.assigned_to)?.full_name || selectedLead?.assigned_to_user?.full_name || user?.full_name || 'Assigned Officer'}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              type="date"
              label="Demo Date *"
              required
              value={demoForm.requested_date}
              onChange={(e) => setDemoForm((prev) => ({ ...prev, requested_date: e.target.value }))}
            />
            <Input
              type="time"
              label="Scheduled Time"
              value={demoForm.requested_time}
              onChange={(e) => setDemoForm((prev) => ({ ...prev, requested_time: e.target.value }))}
            />
          </div>

          {/* Equipment & Specific Kit Selection (Row 1: Two Selects, Below: Full-width Details) */}
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
              <Select
                label="Equipment / Product for Demo *"
                required
                value={demoForm.product_id}
                onChange={(e) => {
                  const pId = e.target.value;
                  setDemoForm((prev) => ({ ...prev, product_id: pId }));
                }}
                options={[
                  { value: '', label: 'Select Product / Equipment' },
                  ...productsList.map((p) => {
                    const pUnits = (demoEquipmentList || []).filter((e) => e.product_id === p.id);
                    const avail = pUnits.filter((e) => e.availability_status === 'available');
                    let statusTag = '';
                    if (avail.length > 0) {
                      const locs = Array.from(new Set(avail.map((u) => u.current_location).filter(Boolean)));
                      statusTag = `[AVAILABLE: ${avail.length} of ${pUnits.length} in ${locs.join(', ')}]`;
                    } else if (pUnits.length > 0) {
                      statusTag = `[RESERVED / IN USE: ${pUnits.length} Units]`;
                    } else {
                      statusTag = `[NO DEMO FLEET UNIT]`;
                    }
                    return {
                      value: p.id,
                      label: `${statusTag} ${p.name}`,
                    };
                  }),
                ]}
              />

              <Select
                label="Specific Demo Kit / Serial / Accessories Needed"
                value={
                  leadRegisteredEquipmentOptions.some((o) => o.value === demoForm.equipment_required)
                    ? demoForm.equipment_required
                    : demoForm.equipment_required
                    ? 'custom'
                    : ''
                }
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === 'custom') {
                    setDemoForm((prev) => ({ ...prev, equipment_required: 'custom' }));
                  } else {
                    const matchedEquip = (demoEquipmentList || []).find(
                      (item) => `${item.model} | S/N: ${item.serial_no} (${item.current_location} Depot)` === val
                        || item.serial_no === val
                        || item.id === val
                    );
                    setDemoForm((prev) => ({
                      ...prev,
                      equipment_required: val,
                      product_id: matchedEquip?.product_id || prev.product_id,
                    }));
                  }
                }}
                options={leadRegisteredEquipmentOptions}
              />
            </div>

            {/* Fleet Availability Overview by Product (when no product is selected yet) - Full Width */}
            {!activeLeadDemoFleet && (
              <div className="p-3 rounded-xl bg-[#FBFAF7] border border-[#DCD8CE] space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-[#4A5568] uppercase tracking-wider">
                    Demo Equipment Fleet Availability & Status:
                  </span>
                  <span className="text-[10px] text-[#0F5E63] font-medium">Click to select equipment</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                  {productsList.slice(0, 9).map((p) => {
                    const pUnits = (demoEquipmentList || []).filter((e) => e.product_id === p.id);
                    const availCount = pUnits.filter((e) => e.availability_status === 'available').length;
                    const total = pUnits.length;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => {
                          setDemoForm((prev) => ({ ...prev, product_id: p.id }));
                        }}
                        className="flex items-center justify-between p-2 rounded-lg bg-white border border-[#ECE9E2] hover:border-[#0F5E63] text-left transition-colors group"
                      >
                        <span className="font-semibold text-[#14213D] truncate text-[11px] group-hover:text-[#0F5E63]">
                          {p.name}
                        </span>
                        <span
                          className={`text-[10px] font-mono font-bold shrink-0 ml-1.5 px-1.5 py-0.5 rounded ${
                            availCount > 0
                              ? 'bg-emerald-100 text-emerald-800'
                              : total > 0
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-gray-100 text-gray-600'
                          }`}
                        >
                          {availCount > 0 ? `🟢 ${availCount}/${total} Ready` : total > 0 ? '🟡 In-Trial' : 'Requisition'}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Live Product Fleet Availability & Status HUD - Full Width */}
            {activeLeadDemoFleet && (
              <div className="p-3 rounded-xl bg-[#FBFAF7] border border-[#DCD8CE] space-y-2 text-xs animate-in fade-in">
                <div className="flex flex-wrap items-center justify-between gap-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold text-[#4A5568] uppercase tracking-wider">
                      Live Product Fleet Availability:
                    </span>
                    <span className="font-bold text-xs text-[#14213D]">
                      {productsList.find((p) => p.id === demoForm.product_id)?.name || 'Selected Equipment'}
                    </span>
                  </div>
                  {activeLeadDemoFleet.availableCount > 0 ? (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 animate-pulse" />
                      AVAILABLE ({activeLeadDemoFleet.availableCount} Ready)
                    </span>
                  ) : activeLeadDemoFleet.total > 0 ? (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-600" />
                      RESERVED ({activeLeadDemoFleet.total} in Fleet)
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-gray-100 text-gray-700 border border-gray-300">
                      No Fleet Unit
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] pt-1 border-t border-[#ECE9E2]">
                  <span className="text-[#4A5568]">
                    {activeLeadDemoFleet.availableCount > 0
                      ? `Stationed at: ${activeLeadDemoFleet.locations.join(', ')} Depot`
                      : activeLeadDemoFleet.total > 0
                      ? `All units currently deployed or reserved.`
                      : `Custom requisition required.`}
                  </span>
                  <div className="flex items-center gap-2 font-mono text-[10px]">
                    <span>Fleet: <b>{activeLeadDemoFleet.total}</b></span>
                    <span className="text-emerald-700">Ready: <b>{activeLeadDemoFleet.availableCount}</b></span>
                    <span className="text-amber-700">In-Trial: <b>{activeLeadDemoFleet.reservedCount}</b></span>
                    {activeLeadDemoFleet.maintenanceCount > 0 && (
                      <span className="text-red-700">Maint: <b>{activeLeadDemoFleet.maintenanceCount}</b></span>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Available Demo Kits & Serials Roster (when product is selected but specific unit not yet chosen) - Full Width */}
            {!selectedLeadEquipUnit && activeLeadDemoFleet && activeLeadDemoFleet.units.length > 0 && (
              <div className="p-3 rounded-xl bg-[#FBFAF7] border border-[#DCD8CE] space-y-2.5 text-xs animate-in fade-in">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-[#4A5568] uppercase tracking-wider">
                    Available Demo Kits in Fleet ({activeLeadDemoFleet.units.length}):
                  </span>
                  <span className="text-[10px] text-[#0F5E63] font-medium">Click any kit below to assign</span>
                </div>
                <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                  {activeLeadDemoFleet.units.map((u) => {
                    const isReady = u.availability_status === 'available';
                    const isReserved = u.availability_status === 'reserved' || u.availability_status === 'in_use';
                    return (
                      <div
                        key={u.id}
                        onClick={() => {
                          const val = `${u.model} | S/N: ${u.serial_no} (${u.current_location} Depot)`;
                          setDemoForm((prev) => ({
                            ...prev,
                            equipment_required: val,
                            product_id: u.product_id || prev.product_id,
                          }));
                        }}
                        className="flex flex-col sm:flex-row sm:items-center justify-between p-2.5 rounded-lg bg-white border border-[#ECE9E2] hover:border-[#0F5E63] cursor-pointer transition-all hover:shadow-xs group gap-2"
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-[#14213D] text-[11px] group-hover:text-[#0F5E63]">{u.model}</span>
                            <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-[#FBFAF7] border border-[#DCD8CE] font-bold text-[#14213D]">
                              S/N: {u.serial_no}
                            </span>
                            <span className="text-[10px] text-[#4A5568]">📍 {u.current_location} Depot</span>
                            {isReady ? (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                                🟢 Ready
                              </span>
                            ) : isReserved ? (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
                                🟡 Reserved
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-800 border border-red-200">
                                🔴 Maint
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-[#4A5568]">
                            📦 Kit includes: Flight case, dual Li-ion batteries, charger & calibration block
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-xs text-[#0F5E63] font-bold group-hover:underline">Select Kit →</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Specific Demo Kit / Serial / Accessories Detail Card - FULL WIDTH, NOT SPLIT IN HALF */}
            {selectedLeadEquipUnit && (
              <div className="p-3.5 rounded-xl bg-[#FBFAF7] border border-[#DCD8CE] space-y-2.5 text-xs animate-in fade-in">
                <div className="flex flex-wrap items-center justify-between gap-1 pb-2 border-b border-[#ECE9E2]">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-sm text-[#14213D]">{selectedLeadEquipUnit.model}</span>
                    <span className="font-mono text-xs px-2 py-0.5 rounded bg-white border border-[#DCD8CE] text-[#14213D] font-bold">
                      S/N: {selectedLeadEquipUnit.serial_no}
                    </span>
                    <span className="text-xs text-[#4A5568]">📍 {selectedLeadEquipUnit.current_location} Depot</span>
                  </div>
                  <div>
                    {selectedLeadEquipUnit.availability_status === 'available' ? (
                      <Badge variant="success">● READY & AVAILABLE</Badge>
                    ) : selectedLeadEquipUnit.availability_status === 'reserved' || selectedLeadEquipUnit.availability_status === 'in_use' ? (
                      <Badge variant="warning">
                        ○ RESERVED {selectedLeadEquipUnit.reserved_until ? `UNTIL ${new Date(selectedLeadEquipUnit.reserved_until).toLocaleDateString()}` : ''}
                      </Badge>
                    ) : (
                      <Badge variant="danger">▲ MAINTENANCE: {selectedLeadEquipUnit.condition || 'Service Needed'}</Badge>
                    )}
                  </div>
                </div>

                {/* 4-Column Metadata Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                  <div>
                    <span className="text-[10px] text-[#4A5568] block">Operational Condition:</span>
                    <span className="font-semibold text-[#14213D]">{selectedLeadEquipUnit.condition || 'Operational'}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-[#4A5568] block">Fleet Custodian:</span>
                    <span className="font-semibold text-[#14213D]">{selectedLeadEquipUnit.responsible_person_name || 'Demo Team Coordinator'}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-[#4A5568] block">Depot Base:</span>
                    <span className="font-semibold text-[#14213D]">{selectedLeadEquipUnit.current_location} Depot</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-[#4A5568] block">Unit Serial:</span>
                    <span className="font-mono font-bold text-[#14213D]">{selectedLeadEquipUnit.serial_no}</span>
                  </div>
                </div>

                {/* Included Standard Demo Kit Accessories - Full Width Grid */}
                <div className="pt-2 border-t border-[#ECE9E2]">
                  <span className="text-[10px] font-bold text-[#4A5568] uppercase tracking-wider block mb-1.5">
                    📦 Specific Demo Kit / Included Accessories & Calibration Items:
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-1.5 text-xs text-[#14213D]">
                    {getStandardKitAccessories(selectedLeadEquipUnit.product_name, selectedLeadEquipUnit.product_category).map((item, idx) => (
                      <div key={idx} className="flex items-center gap-1.5 p-1.5 rounded-lg bg-white border border-[#ECE9E2]">
                        <CheckCircle className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                        <span className="truncate text-[11px]">{item}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Status Note Callout */}
                {selectedLeadEquipUnit.availability_status === 'available' ? (
                  <div className="p-2 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-[11px] flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-700 shrink-0" />
                    <span>Kit verified and calibrated for client field demonstration. Immediate dispatch supported from {selectedLeadEquipUnit.current_location} Depot.</span>
                  </div>
                ) : selectedLeadEquipUnit.availability_status === 'reserved' || selectedLeadEquipUnit.availability_status === 'in_use' ? (
                  <div className="p-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-[11px] flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-amber-700 shrink-0" />
                    <span>This serial is currently scheduled for another trial. Submitting will flag a scheduling overlap notice to the Demo Coordinator.</span>
                  </div>
                ) : (
                  <div className="p-2 rounded-lg bg-red-50 border border-red-200 text-red-800 text-[11px] flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 text-red-700 shrink-0" />
                    <span>Unit marked under maintenance ({selectedLeadEquipUnit.condition}). You may select another serial or custom kit.</span>
                  </div>
                )}
              </div>
            )}
          </div>

          <Input
            label="Location (Demo Venue / Department / Base) *"
            required
            value={demoForm.location}
            onChange={(e) => setDemoForm((prev) => ({ ...prev, location: e.target.value }))}
            placeholder="e.g. Tactical Range, Ordnance Factory Jodhpur"
            helperText="Auto-populated from account/trip location. Edit if field site differs."
          />

          {/* Assigned Demo Team Specialist Allocation & Live Availability */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-[#14213D]">
                Assigned Demo Team Specialist *
              </label>
              {isLoadingLeadTeamAvailability ? (
                <span className="text-[10px] text-[#0F5E63] flex items-center gap-1">
                  <Spinner size="xs" /> Checking Team Availability...
                </span>
              ) : (
                <span className="text-[10px] text-[#4A5568]">
                  Availability for {new Date(demoForm.requested_date).toLocaleDateString()}
                </span>
              )}
            </div>

            <Select
              value={demoForm.assigned_to}
              onChange={(e) => setDemoForm((prev) => ({ ...prev, assigned_to: e.target.value }))}
              options={[
                { value: '', label: '-- Select Demo Team Member / Specialist --' },
                ...leadDemoTeamOptions,
              ]}
            />

            {/* Pre-selection Demo Team Member Roster (when none selected yet) */}
            {!selectedLeadDemoMember && (
              <div className="p-2.5 rounded-lg bg-[#FBFAF7] border border-[#DCD8CE] space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-[#4A5568] uppercase tracking-wider">
                    Demo Team Availability on {new Date(demoForm.requested_date).toLocaleDateString()}:
                  </span>
                  <span className="text-[10px] text-[#0F5E63] font-medium">Click specialist to book</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {(leadDemoTeamAvailability.length > 0 ? leadDemoTeamAvailability : usersList.filter((u) => ['demo_team', 'service_team', 'sales'].includes(u.role))).map((m) => {
                    const isAvail = m.is_available ?? true;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setDemoForm((prev) => ({ ...prev, assigned_to: m.id }))}
                        className="flex items-center justify-between p-2 rounded bg-white border border-[#ECE9E2] hover:border-[#0F5E63] text-left transition-colors group"
                      >
                        <div className="space-y-0.5 truncate pr-1">
                          <span className="font-semibold text-[#14213D] text-[11px] block truncate group-hover:text-[#0F5E63]">
                            {m.full_name}
                          </span>
                          <span className="text-[10px] text-[#4A5568] block truncate">
                            {m.role === 'demo_team' ? 'Demo Specialist' : m.role.replace(/_/g, ' ')} {m.phone ? `• ${m.phone}` : ''}
                          </span>
                        </div>
                        <span
                          className={`text-[10px] font-bold shrink-0 ml-1 px-1.5 py-0.5 rounded ${
                            isAvail ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {isAvail ? '🟢 Available' : '🟡 Booked'}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Selected Demo Team Member Live Availability & Notification Card */}
            {selectedLeadDemoMember && (
              <div className="p-3 rounded-xl bg-[#FBFAF7] border border-[#DCD8CE] space-y-2 text-xs animate-in fade-in">
                <div className="flex flex-wrap items-center justify-between gap-1 pb-1.5 border-b border-[#ECE9E2]">
                  <div className="flex items-center gap-1.5">
                    <span className="font-bold text-xs text-[#14213D]">{selectedLeadDemoMember.full_name}</span>
                    <Badge variant="cyber" className="text-[10px] py-0">
                      {selectedLeadDemoMember.role === 'demo_team' ? 'DEMO SPECIALIST' : selectedLeadDemoMember.role.replace(/_/g, ' ').toUpperCase()}
                    </Badge>
                    {selectedLeadDemoMember.phone && (
                      <span className="text-[10px] text-[#4A5568]">📞 {selectedLeadDemoMember.phone}</span>
                    )}
                  </div>
                  <div>
                    {selectedLeadDemoMember.is_available ?? true ? (
                      <Badge variant="success">● AVAILABLE ON {new Date(demoForm.requested_date).toLocaleDateString()}</Badge>
                    ) : (
                      <Badge variant="warning">
                        ▲ BUSY ON {selectedLeadDemoMember.active_demo?.demo_no || 'ANOTHER TRIAL'}
                      </Badge>
                    )}
                  </div>
                </div>

                <div className="text-[11px] text-[#4A5568]">
                  {selectedLeadDemoMember.is_available ?? true ? (
                    <div className="flex items-center gap-1.5 text-emerald-800">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                      <span>Specialist has zero trial schedule conflicts on this date and is cleared for field demonstration.</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 text-amber-800">
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                      <span>Specialist has active trial booking for <strong>{selectedLeadDemoMember.active_demo?.organisation_name || 'Client'}</strong>. Booking will flag a schedule overlap notice.</span>
                    </div>
                  )}
                </div>

                {/* Auto-Notification Callout */}
                <div className="p-2 rounded-lg bg-[#E3EFEE]/70 border border-[#0F5E63]/20 text-[#0F5E63] text-[11px] flex items-center gap-2">
                  <Bell className="h-3.5 w-3.5 shrink-0 text-[#0F5E63]" />
                  <span>
                    <strong>Auto-Notification & Calendar Sync:</strong> Submitting this demo will instantly alert <strong>{selectedLeadDemoMember.full_name}</strong> and list this trial under their <strong>"My Demos"</strong> dashboard.
                  </span>
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              label="Purpose / Demonstration Objective *"
              required
              value={demoForm.purpose}
              onChange={(e) => setDemoForm((prev) => ({ ...prev, purpose: e.target.value }))}
              placeholder="e.g. Live range trials & ballistic validation"
            />
            <Input
              label="Expected Audience / Evaluation Committee *"
              required
              value={demoForm.expected_audience}
              onChange={(e) => setDemoForm((prev) => ({ ...prev, expected_audience: e.target.value }))}
              placeholder="e.g. Technical Evaluation Committee & Board Officers"
            />
          </div>

          <Input
            label="Additional Custom Accessories / Test Samples Needed (Optional)"
            value={demoForm.custom_accessories}
            onChange={(e) => setDemoForm((prev) => ({ ...prev, custom_accessories: e.target.value }))}
            placeholder={
              demoForm.equipment_required === 'custom'
                ? "Enter custom model name, serial number and accessories..."
                : "e.g. Test calibration pieces, knife sample, spare batteries, vehicle gate pass"
            }
          />

          <Textarea
            label="Special Requirements & Field Deployment Instructions"
            value={demoForm.reminder_notes}
            onChange={(e) => setDemoForm((prev) => ({ ...prev, reminder_notes: e.target.value }))}
            rows={2}
            placeholder="e.g. Gate pass required at security entry. 230V power needed. Carry identity documentation."
          />

          {/* Auto Remind Card */}
          <label className="flex items-start gap-2.5 p-3 rounded-xl bg-[#E3EFEE]/50 border border-[#0F5E63]/30 cursor-pointer">
            <input
              type="checkbox"
              checked={demoForm.auto_remind}
              onChange={(e) => setDemoForm((prev) => ({ ...prev, auto_remind: e.target.checked }))}
              className="mt-0.5 rounded text-[#0F5E63] focus:ring-[#0F5E63]"
            />
            <div>
              <span className="text-xs font-bold text-[#0F5E63] block">
                Auto-remind assigned member & register task on their dashboard
              </span>
              <span className="text-[11px] text-[#4A5568]">
                Dispatches an instant notification to their notification center and assigns a high-priority action task on their dashboard.
              </span>
            </div>
          </label>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#DCD8CE]">
            <Button type="button" variant="ghost" size="sm" onClick={() => setIsDemoModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" size="sm" isLoading={actionLoading}>
              Schedule Demo & Advance Lifecycle
            </Button>
          </div>
        </form>
      </Modal>

      {/* ========================================================================= */}
      {/* MODAL 5B: COMMERCIAL & TECHNICAL PROPOSAL DRAFTING                        */}
      {/* ========================================================================= */}
      <Modal
        isOpen={isProposalModalOpen}
        onClose={() => setIsProposalModalOpen(false)}
        title="📄 Prepare Commercial & Technical Proposal"
        description={`Transitions opportunity to PROPOSAL, notifies the Tender Team, and delegates proposal drafting to the responsible specialist.`}
        maxWidth="2xl"
        zIndex={60}
      >
        <form onSubmit={handleSubmitProposalTransition} className="space-y-4 text-xs">
          {formError && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700">
              {formError}
            </div>
          )}

          {/* Account context strip */}
          <div className="p-3 rounded-xl bg-[#FBFAF7] border border-[#DCD8CE] flex items-center justify-between">
            <div>
              <span className="text-[10px] uppercase font-bold text-[#4A5568] block">Opportunity Account</span>
              <span className="text-xs font-bold text-[#14213D]">{selectedLead?.organisation_name}</span>
            </div>
            <div className="text-right">
              <span className="text-[10px] uppercase font-bold text-[#4A5568] block">Current Stage</span>
              <span className="text-xs font-bold text-[#0F5E63]">{selectedLead?.lead_status?.toUpperCase()}</span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              label="Proposal Reference / RFP No. *"
              required
              value={proposalForm.reference}
              onChange={(e) => setProposalForm((prev) => ({ ...prev, reference: e.target.value }))}
              placeholder="e.g. RFP-ORD-2026-0042"
            />
            <Input
              type="date"
              label="Submission Deadline Date *"
              required
              value={proposalForm.required_date}
              onChange={(e) => setProposalForm((prev) => ({ ...prev, required_date: e.target.value }))}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              type="number"
              label="Estimated Deal Value (₹ Lakh)"
              value={proposalForm.deal_value}
              onChange={(e) => setProposalForm((prev) => ({ ...prev, deal_value: e.target.value }))}
              placeholder="e.g. 78.00"
            />
            <Select
              label="Responsible Bid / Proposal Specialist *"
              required
              value={proposalForm.responsible_person_id}
              onChange={(e) => setProposalForm((prev) => ({ ...prev, responsible_person_id: e.target.value }))}
              options={[
                { value: '', label: 'Select Specialist' },
                ...usersList.map((u) => ({
                  value: u.id,
                  label: `${u.full_name} (${u.role.replace('_', ' ').toUpperCase()})`,
                })),
              ]}
            />
          </div>

          <Textarea
            label="Proposal Scope, Technical Specs & Clauses"
            value={proposalForm.remarks}
            onChange={(e) => setProposalForm((prev) => ({ ...prev, remarks: e.target.value }))}
            rows={3}
            placeholder="e.g. Supply of tactical communication units with 3-year OEM warranty, on-site commissioning, and compliance certification."
          />

          {/* Auto Remind Card */}
          <label className="flex items-start gap-2.5 p-3 rounded-xl bg-[#E3EFEE]/50 border border-[#0F5E63]/30 cursor-pointer">
            <input
              type="checkbox"
              checked={proposalForm.auto_remind}
              onChange={(e) => setProposalForm((prev) => ({ ...prev, auto_remind: e.target.checked }))}
              className="mt-0.5 rounded text-[#0F5E63] focus:ring-[#0F5E63]"
            />
            <div>
              <span className="text-xs font-bold text-[#0F5E63] block">
                Auto-remind proposal specialist & register deadline task on their dashboard
              </span>
              <span className="text-[11px] text-[#4A5568]">
                Dispatches a notification to the assigned specialist and creates a high-priority deadline task in their accountability queue.
              </span>
            </div>
          </label>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#DCD8CE]">
            <Button type="button" variant="ghost" size="sm" onClick={() => setIsProposalModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" size="sm" isLoading={actionLoading}>
              Generate Proposal Task & Advance Lifecycle
            </Button>
          </div>
        </form>
      </Modal>

      {/* ========================================================================= */}
      {/* MODAL 5C: TENDER DISCUSSION & TOUCHPOINT SCHEDULING ("WHEN")               */}
      {/* ========================================================================= */}
      <Modal
        isOpen={isDiscussionModalOpen}
        onClose={() => setIsDiscussionModalOpen(false)}
        title={discussionStage === 'tender_discussion' ? "🤝 Schedule Tender Discussion" : "📅 Schedule Strategic Follow-Up"}
        description="Coordinates meeting timing, sets calendar touchpoint, and auto-reminds the designated team member."
        maxWidth="2xl"
        zIndex={60}
      >
        <form onSubmit={handleSubmitDiscussionTransition} className="space-y-4 text-xs">
          {formError && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700">
              {formError}
            </div>
          )}

          {/* Account context strip */}
          <div className="p-3 rounded-xl bg-[#FBFAF7] border border-[#DCD8CE] flex items-center justify-between">
            <div>
              <span className="text-[10px] uppercase font-bold text-[#4A5568] block">Opportunity Account</span>
              <span className="text-xs font-bold text-[#14213D]">{selectedLead?.organisation_name}</span>
            </div>
            <div className="text-right">
              <span className="text-[10px] uppercase font-bold text-[#4A5568] block">Touchpoint Type</span>
              <span className="text-xs font-bold text-[#0F5E63]">{discussionStage === 'tender_discussion' ? 'TENDER DISCUSSION' : 'FOLLOW UP'}</span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              type="date"
              label="Discussion Date (When) *"
              required
              value={discussionForm.discussion_date}
              onChange={(e) => setDiscussionForm((prev) => ({ ...prev, discussion_date: e.target.value }))}
            />
            <Input
              type="time"
              label="Discussion Time (When) *"
              required
              value={discussionForm.discussion_time}
              onChange={(e) => setDiscussionForm((prev) => ({ ...prev, discussion_time: e.target.value }))}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Select
              label="Meeting Format / Mode *"
              required
              value={discussionForm.mode}
              onChange={(e) => setDiscussionForm((prev) => ({ ...prev, mode: e.target.value }))}
              options={[
                { value: 'in_person', label: 'In-Person Executive Meeting' },
                { value: 'tender_committee', label: 'Tender Committee Session' },
                { value: 'video_call', label: 'Video Conference (VC / Teams / Meet)' },
                { value: 'telephonic', label: 'Telephonic Briefing' },
                { value: 'site_visit', label: 'Site / Facility Inspection' },
              ]}
            />
            <Select
              label="Assigned Discussion Lead / Member *"
              required
              value={discussionForm.assigned_to}
              onChange={(e) => setDiscussionForm((prev) => ({ ...prev, assigned_to: e.target.value }))}
              options={[
                { value: '', label: 'Select Team Member' },
                ...usersList.map((u) => ({
                  value: u.id,
                  label: `${u.full_name} (${u.role.replace('_', ' ').toUpperCase()})`,
                })),
              ]}
            />
          </div>

          {(() => {
            const isLink = discussionForm.mode === 'video_call';
            const isPhone = discussionForm.mode === 'telephonic';
            return (
              <Input
                label={isLink ? 'Meeting Link *' : isPhone ? 'Dial-in Number / Bridge *' : 'Meeting Venue *'}
                required
                type={isLink ? 'url' : 'text'}
                value={discussionForm.venue}
                onChange={(e) => setDiscussionForm((prev) => ({ ...prev, venue: e.target.value }))}
                placeholder={
                  isLink
                    ? 'e.g. https://meet.google.com/xyz'
                    : isPhone
                    ? 'e.g. +91 98765 43210 or conference bridge ID'
                    : 'e.g. Conference Room B, HQ Jodhpur'
                }
              />
            );
          })()}

          <Textarea
            label="Meeting Agenda & Tender Discussion Topics"
            value={discussionForm.agenda}
            onChange={(e) => setDiscussionForm((prev) => ({ ...prev, agenda: e.target.value }))}
            rows={3}
            placeholder="e.g. Review specification compliance, tender clauses, earnest money deposit terms, and delivery milestones."
          />

          {/* Auto Remind Card */}
          <label className="flex items-start gap-2.5 p-3 rounded-xl bg-[#E3EFEE]/50 border border-[#0F5E63]/30 cursor-pointer">
            <input
              type="checkbox"
              checked={discussionForm.auto_remind}
              onChange={(e) => setDiscussionForm((prev) => ({ ...prev, auto_remind: e.target.checked }))}
              className="mt-0.5 rounded text-[#0F5E63] focus:ring-[#0F5E63]"
            />
            <div>
              <span className="text-xs font-bold text-[#0F5E63] block">
                Auto-remind team member & register calendar task on their side
              </span>
              <span className="text-[11px] text-[#4A5568]">
                Sends an instant reminder and logs an urgent meeting task on the designated team member's personal dashboard.
              </span>
            </div>
          </label>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#DCD8CE]">
            <Button type="button" variant="ghost" size="sm" onClick={() => setIsDiscussionModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" size="sm" isLoading={actionLoading}>
              Schedule Touchpoint & Advance Lifecycle
            </Button>
          </div>
        </form>
      </Modal>


      {/* ========================================================================= */}
      {/* MODAL 6: CUSTOMER 360° ACCOUNT INTELLIGENCE DRAWER                        */}
      {/* ========================================================================= */}
      <Modal
        isOpen={isCustomer360Open}
        onClose={() => setIsCustomer360Open(false)}
        title={selectedCustomer?.name || 'Customer 360° Account View'}
        description={`${selectedCustomer?.city || 'Delhi'}, ${selectedCustomer?.state || 'Delhi'} • Sector: ${selectedCustomer?.sector || 'Defence'} • Zone: ${selectedCustomer?.zone_name || 'North'}`}
        maxWidth="4xl"
      >
        {selectedCustomer && (
          <div className="space-y-5 text-xs">
            {/* Account Quick Intelligence Bar */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3.5 rounded-xl bg-[#FBFAF7] border border-[#DCD8CE]">
              <div>
                <span className="text-[10px] uppercase text-[#4A5568] font-bold block">Account Sector</span>
                <span className="font-semibold text-[#14213D] mt-0.5 block">
                  {selectedCustomer.sector || 'Government / PSU'}
                </span>
                {selectedCustomer.department && (
                  <span className="text-[10px] text-[#4A5568] block truncate">{selectedCustomer.department}</span>
                )}
              </div>
              <div>
                <span className="text-[10px] uppercase text-[#4A5568] font-bold block">Territory & Zone</span>
                <span className="font-semibold text-[#14213D] mt-0.5 block">
                  {selectedCustomer.zone_name || 'North'} ({selectedCustomer.region_name || selectedCustomer.city || 'HQ'})
                </span>
                <span className="text-[10px] text-[#4A5568] block">
                  {selectedCustomer.city || '—'}, {selectedCustomer.state || '—'}
                </span>
              </div>
              <div>
                <span className="text-[10px] uppercase text-[#4A5568] font-bold block">Current Sales Lead</span>
                <span className="font-bold text-[#0F5E63] mt-0.5 block">
                  {customerManagementSummary?.current_salesperson || selectedCustomer.current_salesperson || 'Assigned Rep'}
                </span>
                <span className="text-[10px] text-emerald-600 font-semibold block">Active Territory Owner</span>
              </div>
              <div>
                <span className="text-[10px] uppercase text-[#4A5568] font-bold block">Pipeline Volume</span>
                <span className="font-extrabold text-[#14213D] mt-0.5 block">
                  {customerLeads.length} Leads • {customerTimeline.length} Touchpoints
                </span>
                <span className="text-[10px] text-[#4A5568] block">
                  {customerContacts.length} Registered Contacts
                </span>
              </div>
            </div>

            {/* Sub-Navigation Tabs */}
            <div className="flex items-center gap-1.5 border-b border-[#DCD8CE] pb-2">
              <button
                type="button"
                onClick={() => setC360Tab('management')}
                className={`px-3 py-1.5 rounded-lg font-semibold text-xs transition-all flex items-center gap-1.5 ${
                  c360Tab === 'management'
                    ? 'bg-[#0F5E63] text-white shadow-xs'
                    : 'bg-[#F8FAFC] text-[#4A5568] hover:bg-[#E3EFEE] hover:text-[#0F5E63] border border-[#DCD8CE]'
                }`}
              >
                <ShieldCheck className="h-3.5 w-3.5" />
                <span>Executive Management HUD</span>
              </button>

              <button
                type="button"
                onClick={() => setC360Tab('timeline')}
                className={`px-3 py-1.5 rounded-lg font-semibold text-xs transition-all flex items-center gap-1.5 ${
                  c360Tab === 'timeline'
                    ? 'bg-[#0F5E63] text-white shadow-xs'
                    : 'bg-[#F8FAFC] text-[#4A5568] hover:bg-[#E3EFEE] hover:text-[#0F5E63] border border-[#DCD8CE]'
                }`}
              >
                <History className="h-3.5 w-3.5" />
                <span>Chronological Timeline</span>
                <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${c360Tab === 'timeline' ? 'bg-white/20 text-white' : 'bg-gray-200 text-gray-700'}`}>
                  {customerTimeline.length}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setC360Tab('contacts')}
                className={`px-3 py-1.5 rounded-lg font-semibold text-xs transition-all flex items-center gap-1.5 ${
                  c360Tab === 'contacts'
                    ? 'bg-[#0F5E63] text-white shadow-xs'
                    : 'bg-[#F8FAFC] text-[#4A5568] hover:bg-[#E3EFEE] hover:text-[#0F5E63] border border-[#DCD8CE]'
                }`}
              >
                <Users className="h-3.5 w-3.5" />
                <span>Contacts Roster</span>
                <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${c360Tab === 'contacts' ? 'bg-white/20 text-white' : 'bg-gray-200 text-gray-700'}`}>
                  {customerContacts.length}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setC360Tab('deals')}
                className={`px-3 py-1.5 rounded-lg font-semibold text-xs transition-all flex items-center gap-1.5 ${
                  c360Tab === 'deals'
                    ? 'bg-[#0F5E63] text-white shadow-xs'
                    : 'bg-[#F8FAFC] text-[#4A5568] hover:bg-[#E3EFEE] hover:text-[#0F5E63] border border-[#DCD8CE]'
                }`}
              >
                <Briefcase className="h-3.5 w-3.5" />
                <span>Opportunities</span>
                <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${c360Tab === 'deals' ? 'bg-white/20 text-white' : 'bg-gray-200 text-gray-700'}`}>
                  {customerLeads.length}
                </span>
              </button>
            </div>

            {/* TAB 1: EXECUTIVE MANAGEMENT INTELLIGENCE HUD */}
            {c360Tab === 'management' && (
              <div className="space-y-4">
                {/* 1. Touchpoint Horizons: First vs Latest Interaction */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {/* First Interaction Card */}
                  <div className="p-3.5 rounded-xl bg-white border border-[#DCD8CE] space-y-2 shadow-2xs">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-[#14213D] text-xs uppercase tracking-wide flex items-center gap-1.5">
                        <Activity className="h-3.5 w-3.5 text-[#0F5E63]" />
                        <span>First Interaction (Prospect Onboarding)</span>
                      </span>
                      {customerManagementSummary?.first_interaction?.occurred_on && (
                        <Badge variant="info" size="sm" className="font-mono text-[10px]">
                          {new Date(customerManagementSummary.first_interaction.occurred_on).toLocaleDateString('en-IN')}
                        </Badge>
                      )}
                    </div>
                    {customerManagementSummary?.first_interaction ? (
                      <div className="space-y-1.5 pt-1 text-[11px]">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" size="sm" className="uppercase font-bold text-[9px]">
                            {customerManagementSummary.first_interaction.type}
                          </Badge>
                          <span className="text-[#4A5568]">
                            Conducted by: <strong className="text-[#14213D]">{customerManagementSummary.first_interaction.employee_name || 'Executive'}</strong>
                          </span>
                        </div>
                        {customerManagementSummary.first_interaction.contact_name && (
                          <div className="text-[#4A5568]">
                            Client Contact: <span className="font-medium text-[#14213D]">{customerManagementSummary.first_interaction.contact_name}</span>
                          </div>
                        )}
                        <p className="text-gray-700 italic bg-[#F8FAFC] p-2 rounded-lg border border-[#DCD8CE]">
                          "{customerManagementSummary.first_interaction.remarks || customerManagementSummary.first_interaction.notes || 'Initial prospect connection established.'}"
                        </p>
                        {customerManagementSummary.first_interaction.outcome && (
                          <div className="text-[10px] text-emerald-700 font-semibold">
                            Outcome: {customerManagementSummary.first_interaction.outcome}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="p-3 text-center text-[#4A5568] italic">No first interaction on record.</div>
                    )}
                  </div>

                  {/* Latest Interaction Card */}
                  <div className="p-3.5 rounded-xl bg-white border border-[#DCD8CE] space-y-2 shadow-2xs">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-[#14213D] text-xs uppercase tracking-wide flex items-center gap-1.5">
                        <Clock className="h-3.5 w-3.5 text-[#0F5E63]" />
                        <span>Latest Interaction (Recent Touchpoint)</span>
                      </span>
                      {customerManagementSummary?.latest_interaction?.occurred_on && (
                        <Badge variant="success" size="sm" className="font-mono text-[10px]">
                          {new Date(customerManagementSummary.latest_interaction.occurred_on).toLocaleDateString('en-IN')}
                        </Badge>
                      )}
                    </div>
                    {customerManagementSummary?.latest_interaction ? (
                      <div className="space-y-1.5 pt-1 text-[11px]">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" size="sm" className="uppercase font-bold text-[9px]">
                            {customerManagementSummary.latest_interaction.type}
                          </Badge>
                          <span className="text-[#4A5568]">
                            Conducted by: <strong className="text-[#14213D]">{customerManagementSummary.latest_interaction.employee_name || 'Executive'}</strong>
                          </span>
                        </div>
                        {customerManagementSummary.latest_interaction.contact_name && (
                          <div className="text-[#4A5568]">
                            Client Contact: <span className="font-medium text-[#14213D]">{customerManagementSummary.latest_interaction.contact_name}</span>
                          </div>
                        )}
                        <p className="text-gray-700 italic bg-[#F8FAFC] p-2 rounded-lg border border-[#DCD8CE]">
                          "{customerManagementSummary.latest_interaction.remarks || customerManagementSummary.latest_interaction.notes || 'Interaction discussion recorded.'}"
                        </p>
                        {customerManagementSummary.latest_interaction.outcome && (
                          <div className="text-[10px] text-emerald-700 font-semibold">
                            Outcome: {customerManagementSummary.latest_interaction.outcome}
                          </div>
                        )}
                        {customerManagementSummary.latest_interaction.next_action && (
                          <div className="text-[10px] text-[#0F5E63] font-semibold flex items-center gap-1">
                            <ArrowRight className="h-3 w-3" />
                            <span>Next Action: {customerManagementSummary.latest_interaction.next_action}</span>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="p-3 text-center text-[#4A5568] italic">No touchpoints recorded yet.</div>
                    )}
                  </div>
                </div>

                {/* 2. Salesperson Continuity & Product Interests */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {/* Salesperson Continuity Audit */}
                  <div className="p-3.5 rounded-xl bg-white border border-[#DCD8CE] space-y-2 shadow-2xs">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-[#14213D] text-xs uppercase tracking-wide flex items-center gap-1.5">
                        <UserCheck className="h-3.5 w-3.5 text-[#0F5E63]" />
                        <span>Salesperson Ownership Continuity</span>
                      </span>
                    </div>

                    <div className="p-2.5 rounded-lg bg-[#E3EFEE]/50 border border-[#DCD8CE] flex items-center justify-between">
                      <div>
                        <span className="text-[10px] uppercase text-[#4A5568] font-bold block">Current Active Salesperson</span>
                        <span className="font-bold text-[#0F5E63] text-xs">
                          {customerManagementSummary?.current_salesperson || 'Unassigned'}
                        </span>
                      </div>
                      <Badge variant="info" size="sm">CURRENT OWNER</Badge>
                    </div>

                    {customerManagementSummary?.previous_salespersons && customerManagementSummary.previous_salespersons.length > 0 ? (
                      <div className="space-y-1.5 pt-1">
                        <span className="text-[10px] uppercase font-bold text-[#4A5568] block">Previous Reassignment History:</span>
                        {customerManagementSummary.previous_salespersons.map((h: any, idx: number) => (
                          <div
                            key={idx}
                            className="p-2 rounded-lg bg-[#F8FAFC] border border-[#DCD8CE] flex items-center justify-between text-[10px]"
                          >
                            <div>
                              <span className="font-semibold text-gray-800">
                                {h.previous_salesperson_name || 'Unassigned'} → {h.new_salesperson_name}
                              </span>
                              {h.reason && <span className="text-[#4A5568] block">Reason: {h.reason}</span>}
                            </div>
                            <span className="text-[#4A5568] font-mono text-[9px]">
                              {new Date(h.changed_at).toLocaleDateString('en-IN')}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-[10px] text-[#4A5568] italic pt-1">
                        Initial salesperson assignment active. No previous transfers on record.
                      </div>
                    )}
                  </div>

                  {/* Product Interest Landscape */}
                  <div className="p-3.5 rounded-xl bg-white border border-[#DCD8CE] space-y-2 shadow-2xs">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-[#14213D] text-xs uppercase tracking-wide flex items-center gap-1.5">
                        <Tag className="h-3.5 w-3.5 text-[#0F5E63]" />
                        <span>Product Interest Landscape</span>
                      </span>
                      <Badge variant="outline" size="sm">
                        {customerManagementSummary?.product_interests?.length || 0} Products
                      </Badge>
                    </div>

                    {customerManagementSummary?.product_interests && customerManagementSummary.product_interests.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {customerManagementSummary.product_interests.map((pName: string, idx: number) => (
                          <span
                            key={idx}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#FBFAF7] border border-[#DCD8CE] text-[11px] font-semibold text-[#0F5E63]"
                          >
                            <Check className="h-3 w-3 text-[#0F5E63]" />
                            <span>{pName}</span>
                          </span>
                        ))}
                      </div>
                    ) : (
                      <div className="text-[10px] text-[#4A5568] italic pt-2">
                        No product interests linked to opportunities yet.
                      </div>
                    )}
                  </div>
                </div>

                {/* 3. Previous Meetings & Field Demonstrations */}
                <div className="p-3.5 rounded-xl bg-white border border-[#DCD8CE] space-y-2 shadow-2xs">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-[#14213D] text-xs uppercase tracking-wide flex items-center gap-1.5">
                      <Building className="h-3.5 w-3.5 text-[#0F5E63]" />
                      <span>Previous In-Person Meetings & Demonstrations (Face-to-Face Field Touchpoints)</span>
                    </span>
                    <Badge variant="info" size="sm">
                      {customerManagementSummary?.previous_meetings?.length || 0} Meetings Held
                    </Badge>
                  </div>

                  {customerManagementSummary?.previous_meetings && customerManagementSummary.previous_meetings.length > 0 ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                      {customerManagementSummary.previous_meetings.map((m: any) => (
                        <div
                          key={m.id}
                          className="p-2.5 rounded-lg bg-[#F8FAFC] border border-[#DCD8CE] space-y-1 text-[11px]"
                        >
                          <div className="flex items-center justify-between">
                            <Badge variant="outline" size="sm" className="uppercase font-bold text-[9px]">
                              {m.type === 'physical_visit' ? 'Face-to-Face Visit' : m.type === 'demo' ? 'Demonstration' : m.type}
                            </Badge>
                            <span className="text-[#4A5568] font-mono text-[10px]">
                              {new Date(m.occurred_on || m.interaction_date).toLocaleDateString('en-IN')}
                            </span>
                          </div>
                          <div className="text-[#4A5568] text-[10px]">
                            Conducted by: <strong className="text-[#14213D]">{m.employee_name || 'Executive'}</strong>
                            {m.contact_name && <span> • Contact: <strong className="text-[#14213D]">{m.contact_name}</strong></span>}
                          </div>
                          <p className="text-gray-700 line-clamp-2">
                            {m.remarks || m.notes || 'Meeting concluded.'}
                          </p>
                          {m.outcome && (
                            <div className="text-[10px] text-emerald-700 font-semibold">
                              Outcome: {m.outcome}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-[11px] text-[#4A5568] italic p-2 bg-[#F8FAFC] rounded-lg border border-[#DCD8CE] text-center">
                      No physical visits or product demonstrations recorded yet.
                    </div>
                  )}
                </div>

                {/* 4. Follow-Up History & Compliance */}
                <div className="p-3.5 rounded-xl bg-white border border-[#DCD8CE] space-y-3 shadow-2xs">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-[#14213D] text-xs uppercase tracking-wide flex items-center gap-1.5">
                      <CalendarDays className="h-3.5 w-3.5 text-[#0F5E63]" />
                      <span>Follow-up History & Compliance Status</span>
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <div className="p-2.5 rounded-lg bg-[#F8FAFC] border border-[#DCD8CE] text-center">
                      <span className="text-[10px] text-[#4A5568] uppercase font-bold block">Total Scheduled</span>
                      <span className="text-sm font-extrabold text-[#14213D] mt-0.5 block">
                        {customerManagementSummary?.follow_up_history?.total || 0}
                      </span>
                    </div>
                    <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-center">
                      <span className="text-[10px] text-amber-800 uppercase font-bold block">Pending</span>
                      <span className="text-sm font-extrabold text-amber-800 mt-0.5 block">
                        {customerManagementSummary?.follow_up_history?.pending || 0}
                      </span>
                    </div>
                    <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-center">
                      <span className="text-[10px] text-emerald-800 uppercase font-bold block">Completed</span>
                      <span className="text-sm font-extrabold text-emerald-800 mt-0.5 block">
                        {customerManagementSummary?.follow_up_history?.completed || 0}
                      </span>
                    </div>
                    <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-center">
                      <span className="text-[10px] text-rose-800 uppercase font-bold block">Overdue</span>
                      <span className="text-sm font-extrabold text-rose-800 mt-0.5 block">
                        {customerManagementSummary?.follow_up_history?.overdue || 0}
                      </span>
                    </div>
                  </div>
                </div>

                {/* 5. Current Opportunity Status */}
                <div className="p-3.5 rounded-xl bg-white border border-[#DCD8CE] space-y-2 shadow-2xs">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-[#14213D] text-xs uppercase tracking-wide flex items-center gap-1.5">
                      <Target className="h-3.5 w-3.5 text-[#0F5E63]" />
                      <span>Current Opportunity Status Across Account</span>
                    </span>
                    <Badge variant="info" size="sm">
                      {customerManagementSummary?.current_opportunity_status?.length || 0} Active Leads
                    </Badge>
                  </div>

                  {customerManagementSummary?.current_opportunity_status && customerManagementSummary.current_opportunity_status.length > 0 ? (
                    <div className="divide-y divide-[#DCD8CE] border border-[#DCD8CE] rounded-lg overflow-hidden">
                      {customerManagementSummary.current_opportunity_status.map((opp: any) => (
                        <div key={opp.id} className="p-2.5 bg-white flex items-center justify-between text-[11px] hover:bg-[#F8FAFC]">
                          <div>
                            <div className="font-bold text-[#14213D] flex items-center gap-2">
                              <span>{opp.product_name}</span>
                              {opp.lead_type === 're_approached' ? (
                                <Badge variant="warning" size="sm" className="font-bold text-[9px]">
                                  RE-APPROACHED
                                </Badge>
                              ) : (
                                <Badge variant="info" size="sm" className="font-bold text-[9px]">
                                  FRESH
                                </Badge>
                              )}
                            </div>
                            <div className="text-[10px] text-[#4A5568] mt-0.5">
                              Assigned: <strong className="text-[#14213D]">{opp.assigned_salesperson || 'Unassigned'}</strong>
                              {opp.next_followup_date && (
                                <span> • Next Due: <strong className="text-[#0F5E63]">{new Date(opp.next_followup_date).toLocaleDateString('en-IN')}</strong></span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="font-mono font-bold text-gray-800">
                              {formatLakh(opp.value_lakh || 0)}
                            </span>
                            {getStatusBadge(opp.status)}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-[11px] text-[#4A5568] italic p-3 text-center bg-[#F8FAFC] rounded-lg border border-[#DCD8CE]">
                      No opportunities registered for this organization.
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB 2: CHRONOLOGICAL CUSTOMER INTERACTION TIMELINE */}
            {c360Tab === 'timeline' && (
              <div className="p-4 rounded-xl bg-[#FBFAF7] border border-[#DCD8CE] space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-xs font-bold text-[#14213D] uppercase tracking-wider flex items-center gap-1.5">
                      <History className="h-4 w-4 text-[#0F5E63]" />
                      <span>Chronological Customer Interaction Timeline</span>
                    </span>
                    <span className="text-[10px] text-[#4A5568] block mt-0.5">
                      Tracks all calls, visits, demos, WhatsApp, emails, tenders, proposals, and service discussions in one continuous customer record.
                    </span>
                  </div>
                  <Button
                    size="xs"
                    variant="primary"
                    onClick={() => {
                      setInteractionForm({
                        ...interactionForm,
                        lead_id: customerLeads[0]?.id || '',
                        organisation_id: selectedCustomer.id,
                        contact_id: customerContacts[0]?.id || '',
                      });
                      setIsLogInteractionOpen(true);
                    }}
                    leftIcon={<Plus className="h-3 w-3" />}
                  >
                    Log Discussion
                  </Button>
                </div>

                {customerTimelineLoading ? (
                  <div className="p-8 text-center text-[#4A5568]">Loading chronological customer history...</div>
                ) : customerTimeline.length === 0 ? (
                  <div className="p-8 rounded-lg bg-white border border-[#DCD8CE] text-center text-[#4A5568] space-y-2">
                    <p>No interactions recorded yet for this organisation.</p>
                    <Button
                      size="xs"
                      variant="secondary"
                      onClick={() => {
                        setInteractionForm({
                          ...interactionForm,
                          lead_id: customerLeads[0]?.id || '',
                          organisation_id: selectedCustomer.id,
                          contact_id: customerContacts[0]?.id || '',
                        });
                        setIsLogInteractionOpen(true);
                      }}
                      leftIcon={<Plus className="h-3 w-3" />}
                    >
                      Record First Touchpoint
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {customerTimeline.map((it) => {
                      const channelIcons: Record<string, string> = {
                        call: '📞',
                        physical_visit: '🏢',
                        demo: '🎯',
                        proposal: '📄',
                        whatsapp: '💬',
                        email: '✉️',
                        tender_discussion: '⚖️',
                        follow_up: '⏰',
                        service_discussion: '🔧',
                      };
                      const icon = channelIcons[it.type] || '💬';

                      return (
                        <div
                          key={it.id}
                          className="p-3.5 rounded-xl bg-white border border-[#DCD8CE] space-y-2 shadow-2xs hover:border-[#0F5E63] transition-colors"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="text-base">{icon}</span>
                              <Badge variant="outline" size="sm" className="uppercase font-bold text-[10px]">
                                {it.type?.replace('_', ' ')}
                              </Badge>
                              <span className="text-[11px] text-[#4A5568] font-medium font-mono">
                                {new Date(it.occurred_on || it.interaction_date || it.created_at).toLocaleDateString('en-IN')}
                              </span>
                            </div>
                            <div className="text-right text-[10px] text-[#4A5568]">
                              Employee: <strong className="text-[#14213D]">{it.employee_name || it.created_by_name || 'Executive'}</strong>
                            </div>
                          </div>

                          {it.contact_name && (
                            <div className="text-[10px] text-[#4A5568] flex items-center gap-1">
                              <User className="h-3 w-3 text-[#4A5568]" />
                              <span>Contact Person: <strong className="text-[#14213D]">{it.contact_name}</strong></span>
                              {it.contact_mobile && <span className="font-mono">({it.contact_mobile})</span>}
                            </div>
                          )}

                          <p className="text-gray-800 text-xs leading-relaxed font-sans bg-[#F8FAFC] p-2.5 rounded-lg border border-[#DCD8CE]">
                            {it.remarks || it.notes || 'No discussion notes provided.'}
                          </p>

                          {it.outcome && (
                            <div className="text-[11px] text-emerald-800 bg-emerald-50 px-2.5 py-1 rounded-md border border-emerald-200 font-medium">
                              Outcome: {it.outcome}
                            </div>
                          )}

                          {(it.next_action || it.followup_date || it.next_action_date) && (
                            <div className="flex flex-wrap items-center gap-3 text-[11px] text-[#0F5E63] font-medium pt-0.5">
                              {it.next_action && (
                                <div className="flex items-center gap-1.5">
                                  <ArrowRight className="h-3.5 w-3.5" />
                                  <span>Next Action: {it.next_action}</span>
                                </div>
                              )}
                              {(it.followup_date || it.next_action_date) && (
                                <div className="flex items-center gap-1 text-[#4A5568] font-mono text-[10px]">
                                  <Clock className="h-3 w-3" />
                                  <span>Target Due: {new Date(it.followup_date || it.next_action_date).toLocaleDateString('en-IN')}</span>
                                </div>
                              )}
                            </div>
                          )}

                          {it.attachments && it.attachments.length > 0 && (
                            <div className="pt-1 flex flex-wrap gap-1.5">
                              {it.attachments.map((att: any) => (
                                <a
                                  key={att.id}
                                  href={att.file_url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#F8FAFC] border border-[#DCD8CE] text-[10px] text-[#0F5E63] hover:underline"
                                >
                                  <Paperclip className="h-3 w-3" />
                                  <span>{att.file_name}</span>
                                </a>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* TAB 3: CONTACTS ROSTER */}
            {c360Tab === 'contacts' && (
              <div className="p-4 rounded-xl bg-white border border-[#DCD8CE] space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[#14213D] uppercase tracking-wider flex items-center gap-1.5">
                    <Users className="h-4 w-4 text-[#0F5E63]" />
                    <span>Account Contacts Roster</span>
                  </span>
                </div>

                {customerContacts.length === 0 ? (
                  <span className="text-[11px] text-[#4A5568] italic">No contacts registered for this organization.</span>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {customerContacts.map((c) => (
                      <div
                        key={c.id}
                        className="p-3 rounded-lg bg-[#F8FAFC] border border-[#DCD8CE] space-y-1.5"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-[#14213D]">{c.name || c.full_name}</span>
                          {c.is_primary && (
                            <Badge variant="info" size="sm" className="text-[9px]">PRIMARY</Badge>
                          )}
                        </div>
                        <div className="text-[11px] text-[#4A5568]">{c.designation || 'Officer'}</div>
                        <div className="flex flex-col gap-1 text-[10px] text-gray-600 font-mono">
                          {(c.phone || c.mobile) && <span>📞 {c.phone || c.mobile}</span>}
                          {c.email && <span>✉️ {c.email}</span>}
                        </div>
                        <div className="pt-1 border-t border-[#DCD8CE]">
                          <Button
                            size="xs"
                            variant="secondary"
                            onClick={() => {
                              setInteractionForm({
                                ...interactionForm,
                                organisation_id: selectedCustomer.id,
                                contact_id: c.id,
                              });
                              setIsLogInteractionOpen(true);
                            }}
                            leftIcon={<Plus className="h-3 w-3" />}
                          >
                            Log Touchpoint with Contact
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* TAB 4: ACTIVE OPPORTUNITIES */}
            {c360Tab === 'deals' && (
              <div className="p-4 rounded-xl bg-white border border-[#DCD8CE] space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[#14213D] uppercase tracking-wider flex items-center gap-1.5">
                    <Briefcase className="h-4 w-4 text-[#0F5E63]" />
                    <span>Active Pipeline & Opportunities</span>
                  </span>
                </div>

                {customerLeads.length === 0 ? (
                  <div className="p-6 text-center text-[#4A5568] italic bg-[#F8FAFC] rounded-lg border border-[#DCD8CE]">
                    No deals or opportunities registered under this organisation.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {customerLeads.map((ld) => (
                      <div
                        key={ld.id}
                        className="p-3 rounded-xl bg-[#F8FAFC] border border-[#DCD8CE] flex items-center justify-between hover:border-[#0F5E63] transition-colors cursor-pointer"
                        onClick={() => {
                          setIsCustomer360Open(false);
                          handleOpenLead(ld.id);
                        }}
                      >
                        <div className="space-y-1">
                          <div className="font-bold text-[#14213D] flex items-center gap-2">
                            <span>{ld.title || ld.product_name || 'Procurement Opportunity'}</span>
                            {ld.lead_type === 're_approached' ? (
                              <Badge variant="warning" size="sm" className="font-bold text-[9px]">
                                RE-APPROACHED
                              </Badge>
                            ) : (
                              <Badge variant="info" size="sm" className="font-bold text-[9px]">
                                FRESH
                              </Badge>
                            )}
                          </div>
                          <div className="text-[10px] text-[#4A5568]">
                            Assigned to: <strong className="text-[#14213D]">{ld.assignee_name || ld.assigned_salesperson_name || 'Unassigned'}</strong>
                            {ld.next_followup_date && (
                              <span> • Follow-up Due: <strong className="text-[#0F5E63]">{new Date(ld.next_followup_date).toLocaleDateString('en-IN')}</strong></span>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-3">
                          <span className="font-mono font-bold text-gray-800">
                            {formatLakh(ld.value_lakh || ld.estimated_value_lakh || 0)}
                          </span>
                          {getStatusBadge(ld.lead_status || ld.status)}
                          <Button size="xs" variant="secondary" rightIcon={<ChevronRight className="h-3 w-3" />}>
                            Details
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Modal Footer */}
            <div className="flex items-center justify-between pt-3 border-t border-[#DCD8CE]">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setInteractionForm({
                    ...interactionForm,
                    lead_id: customerLeads[0]?.id || '',
                    organisation_id: selectedCustomer.id,
                    contact_id: customerContacts[0]?.id || '',
                  });
                  setIsLogInteractionOpen(true);
                }}
                leftIcon={<Plus className="h-4 w-4" />}
              >
                Log New Interaction
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setIsCustomer360Open(false)}>
                Close View
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* ========================================================================= */}
      {/* MODAL 5: LOG FIELD INTERACTION & AUTO FOLLOW-UP SCHEDULER                 */}
      {/* Layered foreground action dialog with zIndex={70}                         */}
      {/* ========================================================================= */}
      <Modal
        isOpen={isLogInteractionOpen}
        onClose={() => setIsLogInteractionOpen(false)}
        title="Log Client Interaction & Field Minutes"
        description="Record phone calls, in-person meetings, discussions, and technical presentations."
        maxWidth="lg"
        zIndex={70}
      >
        <form onSubmit={handleLogInteraction} className="space-y-4 text-xs">
          {formError && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700">
              {formError}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Select
              label="Interaction Channel *"
              value={interactionForm.type}
              onChange={(e) => setInteractionForm({ ...interactionForm, type: e.target.value })}
              options={[
                { value: 'call', label: '📞 Phone Call' },
                { value: 'physical_visit', label: '🏢 Physical Visit (In-Person)' },
                { value: 'demo', label: '🎯 Product Demonstration / Trial' },
                { value: 'proposal', label: '📄 Proposal Submission' },
                { value: 'whatsapp', label: '💬 WhatsApp Message' },
                { value: 'email', label: '✉️ Email Correspondence' },
                { value: 'tender_discussion', label: '⚖️ Pre-Tender Discussion' },
                { value: 'follow_up', label: '⏰ Routine Follow-up' },
                { value: 'service_discussion', label: '🔧 Service / Warranty Review' },
              ]}
            />
            <Input
              label="Interaction Date *"
              type="date"
              required
              value={interactionForm.date}
              onChange={(e) => setInteractionForm({ ...interactionForm, date: e.target.value })}
            />
          </div>

          {customerContacts.length > 0 && (
            <Select
              label="Contact Person (Optional)"
              value={interactionForm.contact_id}
              onChange={(e) => setInteractionForm({ ...interactionForm, contact_id: e.target.value })}
              options={[
                { value: '', label: 'General / Primary Contact' },
                ...customerContacts.map((c) => ({
                  value: c.id,
                  label: `${c.name || c.full_name || 'Contact'}${c.designation ? ` (${c.designation})` : ''}`,
                })),
              ]}
            />
          )}

          <Textarea
            label="Minutes / Discussion Notes *"
            required
            value={interactionForm.notes}
            onChange={(e) => setInteractionForm({ ...interactionForm, notes: e.target.value })}
            placeholder="Key discussion points, specifications requested, procurement timing, decision maker feedback..."
          />

          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Client Outcome / Feedback"
              value={interactionForm.outcome}
              onChange={(e) => setInteractionForm({ ...interactionForm, outcome: e.target.value })}
              placeholder="e.g. Approved technical trial"
            />
            <Input
              label="Next Action Step"
              value={interactionForm.next_action}
              onChange={(e) => setInteractionForm({ ...interactionForm, next_action: e.target.value })}
              placeholder="e.g. Send formal quote & compliance"
            />
          </div>

          {/* Follow-up scheduler */}
          <div className="p-3 rounded-xl bg-[#FBFAF7] border border-[#DCD8CE]">
            <Input
              label="Schedule Next Touchpoint Due Date (Auto-creates Follow-up)"
              type="date"
              value={interactionForm.next_followup_date}
              onChange={(e) => setInteractionForm({ ...interactionForm, next_followup_date: e.target.value })}
            />
          </div>

          {/* Supporting Document Attachment */}
          <div className="p-3 rounded-xl bg-[#FBFAF7] border border-[#DCD8CE] space-y-2">
            <span className="font-bold text-[#14213D] block text-[11px] flex items-center gap-1.5">
              <Paperclip className="h-3.5 w-3.5 text-[#4A5568]" />
              <span>Attach Supporting Document (Proposal / MOM)</span>
            </span>
            <div className="grid grid-cols-2 gap-2">
              <Input
                label="Document Name"
                value={interactionForm.attachment_title}
                onChange={(e) => setInteractionForm({ ...interactionForm, attachment_title: e.target.value })}
                placeholder="e.g. RAF_MOM_Signed.pdf"
              />
              <Input
                label="File URL / Storage Link"
                value={interactionForm.attachment_url}
                onChange={(e) => setInteractionForm({ ...interactionForm, attachment_url: e.target.value })}
                placeholder="https://storage.arihant.com/docs/..."
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#DCD8CE]">
            <Button type="button" variant="ghost" size="sm" onClick={() => setIsLogInteractionOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" size="sm" isLoading={actionLoading}>
              Save Touchpoint
            </Button>
          </div>
        </form>
      </Modal>

      {/* ========================================================================= */}
      {/* MODAL 7: COMPLETE FOLLOW-UP & OPTIONAL CONTINUATION SCHEDULER             */}
      {/* ========================================================================= */}
      <Modal
        isOpen={isCompleteFollowupOpen}
        onClose={() => setIsCompleteFollowupOpen(false)}
        title="Complete Follow-up Touchpoint"
        description="Records outcome remarks and optionally schedules the subsequent pipeline reminder."
        maxWidth="md"
        zIndex={60}
      >
        <form onSubmit={handleCompleteFollowup} className="space-y-4 text-xs">
          {formError && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700">
              {formError}
            </div>
          )}

          <Input
            label="Touchpoint Outcome"
            value={completionOutcome}
            onChange={(e) => setCompletionOutcome(e.target.value)}
            placeholder="e.g. Officer agreed to physical demonstration on 28th"
          />

          <Textarea
            label="Remarks / Minutes"
            value={completionRemarks}
            onChange={(e) => setCompletionRemarks(e.target.value)}
            placeholder="Details of client discussion..."
          />

          <div className="p-3 rounded-xl bg-[#FBFAF7] border border-[#DCD8CE] space-y-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={scheduleNextFollowup}
                onChange={(e) => setScheduleNextFollowup(e.target.checked)}
                className="rounded border-[#DCD8CE] text-[#0F5E63] focus:ring-[#0F5E63]"
              />
              <span className="font-semibold text-gray-800 text-xs">
                Schedule next follow-up touchpoint
              </span>
            </label>

            {scheduleNextFollowup && (
              <Input
                label="Next Follow-up Due Date *"
                type="date"
                required={scheduleNextFollowup}
                value={nextFollowupDueDate}
                onChange={(e) => setNextFollowupDueDate(e.target.value)}
              />
            )}
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#DCD8CE]">
            <Button type="button" variant="ghost" size="sm" onClick={() => setIsCompleteFollowupOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="success" size="sm" isLoading={actionLoading}>
              Mark Completed
            </Button>
          </div>
        </form>
      </Modal>

      {/* ========================================================================= */}
      {/* MODAL 8: RESCHEDULE FOLLOW-UP                                             */}
      {/* ========================================================================= */}
      <Modal
        isOpen={isRescheduleFollowupOpen}
        onClose={() => setIsRescheduleFollowupOpen(false)}
        title="Reschedule Follow-up Touchpoint"
        description="Updates the reminder due date for this sales activity."
        maxWidth="sm"
        zIndex={60}
      >
        <form onSubmit={handleRescheduleFollowup} className="space-y-4 text-xs">
          {formError && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700">
              {formError}
            </div>
          )}

          <Input
            label="New Due Date *"
            type="date"
            required
            value={rescheduleDate}
            onChange={(e) => setRescheduleDate(e.target.value)}
          />

          <Input
            label="Reschedule Remarks"
            value={rescheduleRemarks}
            onChange={(e) => setRescheduleRemarks(e.target.value)}
            placeholder="e.g. Officer on leave until next Monday"
          />

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#DCD8CE]">
            <Button type="button" variant="ghost" size="sm" onClick={() => setIsRescheduleFollowupOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" size="sm" isLoading={actionLoading}>
              Reschedule
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
