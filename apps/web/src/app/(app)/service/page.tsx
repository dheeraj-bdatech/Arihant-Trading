'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Wrench,
  Plus,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Building,
  User,
  ShieldAlert,
  FileCheck,
  Search,
  Filter,
  RefreshCw,
  ExternalLink,
  Calendar,
  Layers,
  ChevronRight,
  UserCheck,
  AlertCircle,
  FileText,
  Package,
  History,
  Activity,
  Check,
  X,
  Phone,
  MapPin,
  Flame,
  Users,
  Repeat,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';
import {
  Button,
  Badge,
  Card,
  Modal,
  Input,
  Select,
  Textarea,
  Tabs,
  PageContainer,
  PageHeader,
  EmptyState,
  StatCard,
  StatGrid,
} from '@/components/ui';
import type { ServicePriority, WarrantyStatus, ServiceTicketStatus } from '@arihant/shared';

export default function ServicePage() {
  const { user, hasRole } = useAuth();

  // Data states
  const [tickets, setTickets] = useState<any[]>([]);
  const [stats, setStats] = useState<any | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<string>('all');

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('all');

  // Reference data
  const [organisations, setOrganisations] = useState<any[]>([]);
  const [serviceEngineers, setServiceEngineers] = useState<any[]>([]);

  // Modals
  const [isLogTicketOpen, setIsLogTicketOpen] = useState(false);
  const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);
  const [isResolveModalOpen, setIsResolveModalOpen] = useState(false);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [isWorkloadModalOpen, setIsWorkloadModalOpen] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState<any | null>(null);

  // New ticket form (§31)
  const [newTicket, setNewTicket] = useState({
    organisation_id: '',
    organisation_name: '',
    city: '',
    ticket_no: `SRV/26-27/${Math.floor(1000 + Math.random() * 9000)}`,
    equipment_type: 'XBIS (X-Ray Baggage Inspection System)',
    serial_no: '',
    location: '',
    complaint: '',
    received_date: new Date().toISOString().split('T')[0],
    priority: 'high' as ServicePriority,
    warranty_status: 'in_warranty' as WarrantyStatus,
    assigned_to: '',
    planned_visit_date: '',
  });

  // Assign Engineer form
  const [assignForm, setAssignForm] = useState({
    assigned_to: '',
    planned_visit_date: '',
    status: 'assigned' as ServiceTicketStatus,
  });

  // Service report form (§33)
  const [reportForm, setReportForm] = useState({
    problem_identified: '',
    action_taken: '',
    parts_replaced: '',
    warranty_status: 'in_warranty',
    customer_signoff_by: '',
    customer_remarks: '',
    further_work_required: false,
    next_visit_date: '',
    report_url: '',
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Enterprise Detail Modal States
  const [detailTab, setDetailTab] = useState<'overview' | 'visits' | 'reports' | 'parts' | 'comments' | 'history'>('overview');
  const [commentInput, setCommentInput] = useState('');
  const [partNameInput, setPartNameInput] = useState('');
  const [partQtyInput, setPartQtyInput] = useState(1);
  const [partRemarksInput, setPartRemarksInput] = useState('');
  const [visitScheduleDate, setVisitScheduleDate] = useState('');
  const [visitNotesInput, setVisitNotesInput] = useState('');
  const [reportReturnReason, setReportReturnReason] = useState('');
  const [isReturningReport, setIsReturningReport] = useState<string | null>(null);

  // Fetch Tickets & Stats
  const fetchData = useCallback(async () => {
    try {
      setIsLoading(true);
      const [ticketsRes, statsRes] = await Promise.all([
        api.get('/service/tickets', {
          status: activeTab !== 'all' ? activeTab : undefined,
          priority: priorityFilter !== 'all' ? priorityFilter : undefined,
          search: searchQuery || undefined,
          limit: 50,
        }),
        api.get('/service/stats').catch(() => null),
      ]);

      setTickets(ticketsRes.data || []);
      if (statsRes) setStats(statsRes);
    } catch (err) {
      console.error('Failed to load service tickets:', err);
    } finally {
      setIsLoading(false);
    }
  }, [activeTab, priorityFilter, searchQuery]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Load auxiliary reference data
  useEffect(() => {
    api
      .get('/organisations', { limit: 100 })
      .then((res) => setOrganisations(res.data || []))
      .catch(() => {});

    api
      .get('/users', { limit: 100 })
      .then((res) => {
        const users = res.data || [];
        const engineers = users.filter((u: any) =>
          ['service_team', 'demo_team', 'admin'].includes(u.role),
        );
        setServiceEngineers(engineers.length > 0 ? engineers : users);
      })
      .catch(() => {});
  }, []);

  // Filtered tickets client-side for pipeline tabs (§32)
  const displayedTickets = useMemo(() => {
    return tickets.filter((t) => {
      if (activeTab === 'all') return true;
      if (activeTab === 'open') return ['received', 'created'].includes(t.status);
      if (activeTab === 'assigned') return ['assigned', 'visit_scheduled'].includes(t.status);
      if (activeTab === 'in_progress') return t.status === 'in_progress';
      if (activeTab === 'awaiting') return ['awaiting_part', 'awaiting_customer'].includes(t.status);
      if (activeTab === 'escalated') return ['escalated', 'revisit', 'revisit_required'].includes(t.status);
      if (activeTab === 'reports') return ['report_submitted', 'resolved'].includes(t.status);
      if (activeTab === 'closed') return t.status === 'closed';
      return t.status === activeTab;
    });
  }, [tickets, activeTab]);

  // 1. Log New Incident (§31)
  const handleLogTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionError(null);
    setIsSubmitting(true);

    try {
      let orgId = newTicket.organisation_id;
      if (!orgId) {
        if (!newTicket.organisation_name.trim()) {
          throw new Error('Please enter or select a customer organisation.');
        }
        const orgRes = await api.post('/organisations', {
          name: newTicket.organisation_name.trim(),
          city: newTicket.city.trim() || 'New Delhi',
          state: 'North Zone',
        });
        orgId = orgRes.id;
      }

      await api.post('/service/tickets', {
        organisation_id: orgId,
        ticket_no: newTicket.ticket_no,
        equipment_serial: newTicket.serial_no || undefined,
        location: newTicket.location || newTicket.city || undefined,
        complaint: `[${newTicket.equipment_type}] ${newTicket.complaint}`,
        received_date: newTicket.received_date || undefined,
        priority: newTicket.priority,
        warranty_status: newTicket.warranty_status,
        assigned_to: newTicket.assigned_to || undefined,
        planned_visit_date: newTicket.planned_visit_date || undefined,
      });

      setIsLogTicketOpen(false);
      setNewTicket({
        organisation_id: '',
        organisation_name: '',
        city: '',
        ticket_no: `SRV/26-27/${Math.floor(1000 + Math.random() * 9000)}`,
        equipment_type: 'XBIS (X-Ray Baggage Inspection System)',
        serial_no: '',
        location: '',
        complaint: '',
        received_date: new Date().toISOString().split('T')[0],
        priority: 'high',
        warranty_status: 'in_warranty',
        assigned_to: '',
        planned_visit_date: '',
      });
      await fetchData();
    } catch (err: any) {
      setActionError(err.message || 'Failed to register breakdown incident.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Close ticket (§32 workflow)
  const handleCloseTicket = async (ticketId: string) => {
    try {
      await api.post(`/service/tickets/${ticketId}/close`);
      await fetchData();
    } catch (err: any) {
      alert(err.message || 'Failed to close ticket.');
    }
  };

  // 2. Assign Engineer & Schedule Visit
  const handleAssignSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTicket) return;
    setActionError(null);
    setIsSubmitting(true);

    try {
      await api.patch(`/service/tickets/${selectedTicket.id}/status`, {
        status: assignForm.planned_visit_date ? 'visit_scheduled' : 'assigned',
        assigned_to: assignForm.assigned_to || undefined,
        planned_visit_date: assignForm.planned_visit_date || undefined,
      });

      setIsAssignModalOpen(false);
      setSelectedTicket(null);
      await fetchData();
    } catch (err: any) {
      setActionError(err.message || 'Failed to dispatch engineer.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // 3. Quick Status Change (Exception States: Awaiting Part, Customer, Escalated)
  const handleQuickStatusChange = async (ticket: any, newStatus: ServiceTicketStatus) => {
    try {
      await api.patch(`/service/tickets/${ticket.id}/status`, {
        status: newStatus,
      });
      await fetchData();
    } catch (err: any) {
      alert(err.message || 'Status transition failed.');
    }
  };

  // 4. Submit Service Report & Spares Vouchers (§33)
  const handleResolveSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTicket) return;
    setActionError(null);
    setIsSubmitting(true);

    try {
      await api.post(`/service/tickets/${selectedTicket.id}/report`, {
        problem_identified: reportForm.problem_identified || selectedTicket.complaint,
        action_taken: reportForm.action_taken,
        parts_replaced: reportForm.parts_replaced || undefined,
        warranty_status: reportForm.warranty_status || selectedTicket.warranty_status || 'in_warranty',
        customer_confirmation: true,
        further_work_required: reportForm.further_work_required,
        next_visit_date: reportForm.further_work_required && reportForm.next_visit_date ? reportForm.next_visit_date : undefined,
        report_url: reportForm.report_url || undefined,
      });

      setIsResolveModalOpen(false);
      setSelectedTicket(null);
      setReportForm({
        problem_identified: '',
        action_taken: '',
        parts_replaced: '',
        warranty_status: 'in_warranty',
        customer_signoff_by: '',
        customer_remarks: '',
        further_work_required: false,
        next_visit_date: '',
        report_url: '',
      });
      await fetchData();
    } catch (err: any) {
      setActionError(err.message || 'Failed to file service report.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // 5. Open Ticket Detail Drawer / History
  const handleOpenDetail = async (ticket: any) => {
    try {
      setDetailTab('overview');
      const fullTicket = await api.get(`/service/tickets/${ticket.id}`);
      setSelectedTicket(fullTicket);
      setIsDetailModalOpen(true);
    } catch (err) {
      setSelectedTicket(ticket);
      setIsDetailModalOpen(true);
    }
  };

  const handleAddComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTicket || !commentInput.trim()) return;
    try {
      await api.post(`/service/tickets/${selectedTicket.id}/comments`, {
        body: commentInput,
        is_internal: true,
      });
      setCommentInput('');
      const updated = await api.get(`/service/tickets/${selectedTicket.id}`);
      setSelectedTicket(updated);
    } catch (err: any) {
      alert(err.message || 'Failed to post comment');
    }
  };

  const handleAddPartRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTicket || !partNameInput.trim()) return;
    try {
      await api.post(`/service/tickets/${selectedTicket.id}/part-requests`, {
        part_name: partNameInput,
        quantity: Number(partQtyInput) || 1,
        store_remarks: partRemarksInput || undefined,
      });
      setPartNameInput('');
      setPartRemarksInput('');
      const updated = await api.get(`/service/tickets/${selectedTicket.id}`);
      setSelectedTicket(updated);
    } catch (err: any) {
      alert(err.message || 'Failed to request part');
    }
  };

  const handleCreateVisit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTicket || !visitScheduleDate) return;
    try {
      await api.post(`/service/tickets/${selectedTicket.id}/visits`, {
        scheduled_start: new Date(visitScheduleDate).toISOString(),
        notes: visitNotesInput || undefined,
      });
      setVisitScheduleDate('');
      setVisitNotesInput('');
      const updated = await api.get(`/service/tickets/${selectedTicket.id}`);
      setSelectedTicket(updated);
    } catch (err: any) {
      alert(err.message || 'Failed to schedule visit');
    }
  };

  const handleCheckInVisit = async (visitId: string) => {
    if (!selectedTicket) return;
    try {
      let lat = 28.5562;
      let lng = 77.1000;
      if (typeof window !== 'undefined' && navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          async (pos) => {
            lat = pos.coords.latitude;
            lng = pos.coords.longitude;
            await api.patch(`/service/tickets/${selectedTicket.id}/visits/${visitId}/check-in`, {
              check_in_lat: lat,
              check_in_lng: lng,
            });
            const updated = await api.get(`/service/tickets/${selectedTicket.id}`);
            setSelectedTicket(updated);
            await fetchData();
          },
          async () => {
            await api.patch(`/service/tickets/${selectedTicket.id}/visits/${visitId}/check-in`, {
              check_in_lat: lat,
              check_in_lng: lng,
            });
            const updated = await api.get(`/service/tickets/${selectedTicket.id}`);
            setSelectedTicket(updated);
            await fetchData();
          },
        );
      } else {
        await api.patch(`/service/tickets/${selectedTicket.id}/visits/${visitId}/check-in`, {
          check_in_lat: lat,
          check_in_lng: lng,
        });
        const updated = await api.get(`/service/tickets/${selectedTicket.id}`);
        setSelectedTicket(updated);
        await fetchData();
      }
    } catch (err: any) {
      alert(err.message || 'Check-in failed');
    }
  };

  const handleCheckOutVisit = async (visitId: string, outcome: string) => {
    if (!selectedTicket) return;
    try {
      await api.patch(`/service/tickets/${selectedTicket.id}/visits/${visitId}/check-out`, {
        visit_outcome: outcome,
      });
      const updated = await api.get(`/service/tickets/${selectedTicket.id}`);
      setSelectedTicket(updated);
      await fetchData();
    } catch (err: any) {
      alert(err.message || 'Check-out failed');
    }
  };

  const handleReviewReport = async (reportId: string, approved: boolean, reason?: string) => {
    if (!selectedTicket) return;
    try {
      await api.post(`/service/tickets/${selectedTicket.id}/reports/${reportId}/review`, {
        approved,
        return_reason: reason,
      });
      setIsReturningReport(null);
      setReportReturnReason('');
      const updated = await api.get(`/service/tickets/${selectedTicket.id}`);
      setSelectedTicket(updated);
      await fetchData();
    } catch (err: any) {
      alert(err.message || 'Report review action failed');
    }
  };

  return (
    <PageContainer>
      {/* Page Header */}
      <PageHeader
        badge="Module 06 • Service & After-Sales"
        title="Service Desk & Installed Base Maintenance"
        subtitle="Breakdown ticketing, SLA adherence, spare parts tracking, on-site engineer deployment, and customer sign-off."
        icon={<Wrench className="h-5 w-5 text-[#0F5E63]" />}
        actions={
          <div className="flex items-center gap-2.5">
            <Button
              onClick={() => fetchData()}
              variant="outline"
              size="sm"
              className="border-[#DCD8CE] text-[#14213D] shadow-xs"
            >
              <RefreshCw className="h-3.5 w-3.5 mr-1 text-[#0F5E63]" />
              <span>Refresh</span>
            </Button>
            <Button
              onClick={() => setIsWorkloadModalOpen(true)}
              variant="outline"
              size="sm"
              className="border-[#DCD8CE] text-[#14213D] shadow-xs"
            >
              <Users className="h-3.5 w-3.5 mr-1 text-[#0F5E63]" />
              <span>Engineer Workload ({stats?.employeeWorkload?.length || serviceEngineers.length})</span>
            </Button>
            <Button
              onClick={() => setIsLogTicketOpen(true)}
              variant="primary"
              className="shadow-xs"
            >
              <Plus className="h-4 w-4 mr-1.5" />
              <span>Log Breakdown Incident</span>
            </Button>
          </div>
        }
      />

      {/* KPI Metrics HUD (§34: New, Pending, Assigned, Overdue, Awaiting Parts, Completed, Repeat Complaints, Avg Closure Time) */}
      <StatGrid cols={4}>
        <StatCard
          label="New Tickets"
          value={stats?.newTickets ?? tickets.filter((t) => ['received', 'created'].includes(t.status)).length}
          subtext="Fresh intake awaiting action"
          icon={<Clock className="h-5 w-5 text-[#0F5E63]" />}
        />
        <StatCard
          label="Pending Queue"
          value={stats?.pendingTickets ?? tickets.filter((t) => !['resolved', 'closed', 'report_submitted'].includes(t.status)).length}
          subtext="Active in diagnosis & field trials"
          icon={<Wrench className="h-5 w-5 text-[#0F5E63]" />}
        />
        <StatCard
          label="Assigned Tickets"
          value={stats?.assignedTickets ?? tickets.filter((t) => t.assigned_to && !['resolved', 'closed', 'report_submitted'].includes(t.status)).length}
          subtext="Engineers mobilized & on-site"
          icon={<UserCheck className="h-5 w-5 text-[#0F5E63]" />}
        />
        <StatCard
          label="Overdue SLA Tickets"
          value={stats?.overdueTickets ?? tickets.filter((t) => t.planned_visit_date && new Date(t.planned_visit_date) < new Date() && !['resolved', 'closed', 'report_submitted'].includes(t.status)).length}
          subtext="Past scheduled visit target"
          icon={<Flame className="h-5 w-5 text-[#9A3412]" />}
          variant="amber"
        />
        <StatCard
          label="Awaiting Parts / Spares"
          value={stats?.awaitingParts ?? tickets.filter((t) => t.status === 'awaiting_part').length}
          subtext="Depot spares logistics pending"
          icon={<Package className="h-5 w-5 text-[#9A3412]" />}
          variant="amber"
        />
        <StatCard
          label="Completed & Signed"
          value={stats?.completedTickets ?? tickets.filter((t) => ['resolved', 'closed', 'report_submitted'].includes(t.status)).length}
          subtext="Customer sign-off certificate on file"
          icon={<CheckCircle2 className="h-5 w-5 text-[#0F5E63]" />}
          variant="emerald"
        />
        <StatCard
          label="Repeat Complaints"
          value={stats?.repeatComplaints ?? 0}
          subtext="Recurring machine / station issues"
          icon={<Repeat className="h-5 w-5 text-[#9A3412]" />}
          variant="amber"
        />
        <StatCard
          label="Avg Closure Time"
          value={`${stats?.avgClosureDays ?? '2.4'}d`}
          subtext="Turnaround from intake to closure"
          icon={<History className="h-5 w-5 text-[#0F5E63]" />}
        />
      </StatGrid>

      {/* Filter Bar */}
      <div className="flex flex-col sm:flex-row gap-3 items-center justify-between p-3.5 bg-white border border-[#DCD8CE] rounded-[14px]">
        <div className="flex-1 w-full sm:w-auto relative">
          <Input
            placeholder="Search by ticket ref, customer, complaint, or machine serial number..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') fetchData();
            }}
            className="w-full"
          />
        </div>
        <div className="flex items-center gap-2.5 w-full sm:w-auto">
          <Select
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value)}
            className="w-full sm:w-44 text-xs font-semibold"
          >
            <option value="all">All Priorities</option>
            <option value="critical">Critical (LD Risk)</option>
            <option value="high">High Priority</option>
            <option value="medium">Medium Priority</option>
            <option value="low">Routine / Preventative</option>
          </Select>
          <Button
            onClick={() => fetchData()}
            variant="secondary"
            size="sm"
            className="whitespace-nowrap"
          >
            <Filter className="h-3.5 w-3.5 mr-1 text-[#0F5E63]" />
            Apply Filter
          </Button>
        </div>
      </div>

      {/* Pipeline Navigation Tabs (§32) */}
      <Tabs
        tabs={[
          { id: 'all', label: 'All Incidents', count: tickets.length },
          { id: 'open', label: '1. New Intake', count: tickets.filter((t) => ['received', 'created'].includes(t.status)).length },
          { id: 'assigned', label: '2. Assigned & Scheduled', count: tickets.filter((t) => ['assigned', 'visit_scheduled'].includes(t.status)).length },
          { id: 'in_progress', label: '3. In Progress', count: tickets.filter((t) => t.status === 'in_progress').length },
          { id: 'awaiting', label: '4. Awaiting Parts / Customer', count: tickets.filter((t) => ['awaiting_part', 'awaiting_customer'].includes(t.status)).length },
          { id: 'escalated', label: '5. Escalated / Revisit', count: tickets.filter((t) => ['escalated', 'revisit', 'revisit_required'].includes(t.status)).length },
          { id: 'reports', label: '6. Reports Filed', count: tickets.filter((t) => ['report_submitted', 'resolved'].includes(t.status)).length },
          { id: 'closed', label: '7. Closed', count: tickets.filter((t) => t.status === 'closed').length },
        ]}
        activeTab={activeTab}
        onChange={setActiveTab}
      />

      {/* Incidents Card Feed */}
      <div className="space-y-3">
        {isLoading ? (
          <div className="p-8 text-center text-xs text-[#4A5568] bg-white border border-[#DCD8CE] rounded-xl">
            Loading service queue...
          </div>
        ) : displayedTickets.length === 0 ? (
          <EmptyState
            icon={Wrench}
            title="No service tickets in this pipeline view"
            description="All client equipment and defense units in this filter are currently operating normally."
          />
        ) : (
          displayedTickets.map((t) => {
            const isCritical = t.priority === 'critical';
            const isResolved = ['resolved', 'closed'].includes(t.status);

            return (
              <Card
                key={t.id}
                padding="md"
                className={`transition-all hover:border-[#0F5E63] ${
                  isCritical && !isResolved ? 'border-l-4 border-l-[#9A3412]' : ''
                }`}
              >
                <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                  {/* Left Content */}
                  <div className="space-y-2 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-bold text-[#0F5E63] bg-[#E3EFEE] px-2 py-0.5 rounded">
                        {t.ticket_no}
                      </span>

                      {/* SLA Priority Pill */}
                      <Badge
                        variant={
                          t.priority === 'critical'
                            ? 'urgent'
                            : t.priority === 'high'
                            ? 'danger'
                            : t.priority === 'medium'
                            ? 'warning'
                            : 'default'
                        }
                        size="sm"
                        className="font-bold uppercase tracking-wider"
                      >
                        {t.priority === 'critical' ? 'CRITICAL • LD RISK' : t.priority}
                      </Badge>

                      {/* Warranty Status Pill */}
                      <Badge variant="outline" size="sm" className="font-mono text-[10px] uppercase">
                        {t.warranty_status === 'in_warranty'
                          ? 'In Warranty'
                          : t.warranty_status === 'amc'
                          ? 'Under AMC'
                          : 'Billable / Out of Warranty'}
                      </Badge>

                      {/* Operational Status Pill */}
                      <Badge
                        variant={
                          isResolved
                            ? 'success'
                            : t.status === 'in_progress' || t.status === 'visit_scheduled'
                            ? 'info'
                            : t.status === 'awaiting_part' || t.status === 'awaiting_customer'
                            ? 'warning'
                            : t.status === 'escalated'
                            ? 'urgent'
                            : 'default'
                        }
                        size="sm"
                      >
                        {t.status.replace(/_/g, ' ').toUpperCase()}
                      </Badge>
                    </div>

                    <div>
                      <h3 className="font-serif text-base font-bold text-[#14213D]">
                        {t.organisation_name || 'Client Agency / Command Station'}
                      </h3>
                      <p className="text-xs text-[#14213D] mt-0.5 leading-relaxed font-medium">
                        {t.complaint}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[11px] text-[#4A5568] pt-1">
                      {t.equipment_serial && (
                        <span className="font-mono bg-[#FBFAF7] px-1.5 py-0.5 rounded border border-[#DCD8CE]">
                          S/N: <strong className="text-[#14213D]">{t.equipment_serial}</strong>
                        </span>
                      )}
                      {(t.city || t.location) && (
                        <span className="flex items-center gap-1">
                          <MapPin className="h-3 w-3 text-[#0F5E63]" />
                          <span>{t.location || t.city}</span>
                        </span>
                      )}
                      <span className="flex items-center gap-1">
                        <User className="h-3 w-3 text-[#0F5E63]" />
                        <span>
                          Assigned: <strong className="text-[#14213D]">{t.assignee_name || t.assigned_name || 'Unassigned (Dispatch Pending)'}</strong>
                        </span>
                      </span>
                      {t.planned_visit_date && (
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3 text-[#0F5E63]" />
                          <span>Visit: <strong className="text-[#14213D]">{new Date(t.planned_visit_date).toLocaleDateString('en-IN')}</strong></span>
                        </span>
                      )}
                      <span>Logged: {new Date(t.created_at || t.received_date).toLocaleDateString('en-IN')}</span>
                    </div>
                  </div>

                  {/* Right Actions */}
                  <div className="flex flex-wrap sm:flex-col items-end gap-2 shrink-0">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleOpenDetail(t)}
                      className="border-[#DCD8CE] text-[#14213D]"
                    >
                      <History className="h-3.5 w-3.5 mr-1 text-[#0F5E63]" />
                      <span>Ticket Dossier</span>
                    </Button>

                    {/* Regional Manager / Admin: Assign Engineer */}
                    {hasRole(['management', 'regional_manager', 'admin']) && !isResolved && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          setSelectedTicket(t);
                          setAssignForm({
                            assigned_to: t.assigned_to || '',
                            planned_visit_date: t.planned_visit_date ? t.planned_visit_date.split('T')[0] : '',
                            status: t.status,
                          });
                          setIsAssignModalOpen(true);
                        }}
                      >
                        <UserCheck className="h-3.5 w-3.5 mr-1 text-[#0F5E63]" />
                        <span>{t.assigned_to ? 'Reassign / Reschedule' : 'Dispatch Engineer'}</span>
                      </Button>
                    )}

                    {/* Quick Move to In Progress if visit is scheduled or assigned */}
                    {['assigned', 'visit_scheduled'].includes(t.status) && hasRole(['service_team', 'regional_manager', 'admin']) && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleQuickStatusChange(t, 'in_progress')}
                        className="text-[#0F5E63] border-[#0F5E63]"
                      >
                        <Wrench className="h-3.5 w-3.5 mr-1" />
                        <span>Begin Work (In Progress)</span>
                      </Button>
                    )}

                    {/* Schedule Revisit if parts were pending */}
                    {['revisit', 'revisit_required'].includes(t.status) && hasRole(['management', 'regional_manager', 'service_team', 'admin']) && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          setSelectedTicket(t);
                          setAssignForm({
                            assigned_to: t.assigned_to || '',
                            planned_visit_date: t.planned_visit_date ? t.planned_visit_date.split('T')[0] : '',
                            status: 'visit_scheduled',
                          });
                          setIsAssignModalOpen(true);
                        }}
                      >
                        <Calendar className="h-3.5 w-3.5 mr-1 text-[#0F5E63]" />
                        <span>Schedule Revisit</span>
                      </Button>
                    )}

                    {/* Service Engineer / Admin: Submit Report */}
                    {hasRole(['service_team', 'admin']) && !isResolved && (
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={() => {
                          setSelectedTicket(t);
                          setReportForm({
                            problem_identified: t.complaint || '',
                            action_taken: '',
                            parts_replaced: '',
                            warranty_status: t.warranty_status || 'in_warranty',
                            customer_signoff_by: '',
                            customer_remarks: '',
                            further_work_required: false,
                            next_visit_date: '',
                            report_url: '',
                          });
                          setIsResolveModalOpen(true);
                        }}
                      >
                        <FileCheck className="h-3.5 w-3.5 mr-1" />
                        <span>Submit Service Report</span>
                      </Button>
                    )}

                    {/* Final Sign-off: Close Ticket */}
                    {['resolved', 'report_submitted'].includes(t.status) && hasRole(['management', 'regional_manager', 'service_team', 'admin']) && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => handleCloseTicket(t.id)}
                        className="text-emerald-800 border-emerald-300 hover:bg-emerald-50 font-medium"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5 mr-1 text-emerald-600" />
                        <span>Close Ticket (Sign-off)</span>
                      </Button>
                    )}

                    {/* Quick status transition dropdown for exception handling */}
                    {!isResolved && hasRole(['service_team', 'regional_manager', 'admin']) && (
                      <div className="flex items-center gap-1 mt-1">
                        <span className="text-[10px] text-[#4A5568]">Move to:</span>
                        <select
                          value={t.status}
                          onChange={(e) => handleQuickStatusChange(t, e.target.value as any)}
                          className="text-[11px] font-semibold bg-[#FBFAF7] border border-[#DCD8CE] rounded px-1.5 py-0.5 text-[#14213D] focus:outline-none"
                        >
                          <option value="received">1. Complaint Received</option>
                          <option value="created">2. Ticket Created</option>
                          <option value="assigned">3. Assigned</option>
                          <option value="visit_scheduled">4. Visit Scheduled</option>
                          <option value="in_progress">5. Work in Progress</option>
                          <option value="awaiting_part">Awaiting Part</option>
                          <option value="awaiting_customer">Awaiting Customer</option>
                          <option value="escalated">Escalated</option>
                          <option value="revisit_required">Revisit Required</option>
                          <option value="report_submitted">6. Report Submitted</option>
                          <option value="resolved">Resolved</option>
                          <option value="closed">7. Ticket Closed</option>
                        </select>
                      </div>
                    )}
                  </div>
                </div>
              </Card>
            );
          })
        )}
      </div>

      {/* 1. Log Breakdown Ticket Modal */}
      <Modal
        isOpen={isLogTicketOpen}
        onClose={() => setIsLogTicketOpen(false)}
        title="Log Equipment Breakdown Incident"
        description="Register a defense/PSU customer maintenance incident under warranty or AMC contract."
        maxWidth="lg"
      >
        <form onSubmit={handleLogTicket} className="space-y-4">
          {actionError && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
              {actionError}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Input
              label="Ticket Ref"
              required
              value={newTicket.ticket_no}
              onChange={(e) => setNewTicket({ ...newTicket, ticket_no: e.target.value })}
            />
            <Input
              label="Date Received"
              type="date"
              required
              value={newTicket.received_date}
              onChange={(e) => setNewTicket({ ...newTicket, received_date: e.target.value })}
            />
            <Select
              label="SLA Priority Level"
              value={newTicket.priority}
              onChange={(e) => setNewTicket({ ...newTicket, priority: e.target.value as ServicePriority })}
              options={[
                { value: 'critical', label: 'CRITICAL — Liquidated Damages (LD) Risk' },
                { value: 'high', label: 'HIGH — Station Interruption' },
                { value: 'medium', label: 'MEDIUM — Partial Functionality' },
                { value: 'low', label: 'LOW — Routine Preventative' },
              ]}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-[#14213D] mb-1">
                Client Agency / Organisation <span className="text-red-500">*</span>
              </label>
              <input
                list="org-list"
                value={newTicket.organisation_name}
                onChange={(e) => {
                  const val = e.target.value;
                  const match = organisations.find((o) => o.name === val);
                  setNewTicket({
                    ...newTicket,
                    organisation_name: val,
                    organisation_id: match ? match.id : '',
                    city: match?.city || newTicket.city,
                  });
                }}
                placeholder="e.g. Delhi Police Traffic HQ / BSF Sector"
                className="w-full text-xs rounded-lg border border-[#C9C4B8] p-2 bg-white text-[#14213D] focus:border-[#0F5E63] focus:outline-none"
                required
              />
              <datalist id="org-list">
                {organisations.map((org) => (
                  <option key={org.id} value={org.name}>
                    {org.city ? `${org.name} (${org.city})` : org.name}
                  </option>
                ))}
              </datalist>
            </div>

            <Input
              label="Deployment Station / City"
              value={newTicket.city}
              onChange={(e) => setNewTicket({ ...newTicket, city: e.target.value })}
              placeholder="e.g. New Delhi / Patna / Kolkata"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Select
              label="Equipment Category"
              value={newTicket.equipment_type}
              onChange={(e) => setNewTicket({ ...newTicket, equipment_type: e.target.value })}
              options={[
                { value: 'XBIS (X-Ray Baggage Inspection System)', label: 'XBIS (Dual Energy X-Ray)' },
                { value: 'DFMD (Door Frame Metal Detector)', label: 'DFMD (Multi-Zone Walk-through)' },
                { value: 'HHMD (Hand Held Metal Detector)', label: 'HHMD (MHA QR Compliant)' },
                { value: 'UVSS (Under Vehicle Surveillance System)', label: 'UVSS Embedded Array' },
                { value: 'Thermal Imaging Monocular', label: 'Thermal / Night Vision' },
                { value: 'Other Homeland Security Device', label: 'Other Security Hardware' },
              ]}
            />
            <Input
              label="Machine Serial Number"
              value={newTicket.serial_no}
              onChange={(e) => setNewTicket({ ...newTicket, serial_no: e.target.value })}
              placeholder="e.g. SN-XBIS-2025-081"
            />
            <Select
              label="Warranty / AMC Status"
              value={newTicket.warranty_status}
              onChange={(e) => setNewTicket({ ...newTicket, warranty_status: e.target.value as WarrantyStatus })}
              options={[
                { value: 'in_warranty', label: 'Under OEM Warranty' },
                { value: 'amc', label: 'Comprehensive AMC Active' },
                { value: 'out_of_warranty', label: 'Out of Warranty (Billable)' },
              ]}
            />
          </div>

          <Textarea
            label="Breakdown Complaint / Symptom"
            required
            rows={3}
            value={newTicket.complaint}
            onChange={(e) => setNewTicket({ ...newTicket, complaint: e.target.value })}
            placeholder="Describe the failure, error codes on display, or physical damage observed..."
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            <Select
              label="Initial Field Engineer Dispatch (Optional)"
              value={newTicket.assigned_to}
              onChange={(e) => setNewTicket({ ...newTicket, assigned_to: e.target.value })}
              options={[
                { value: '', label: '-- Unassigned (Assign Later) --' },
                ...serviceEngineers.map((eng) => ({
                  value: eng.id,
                  label: `${eng.full_name} (${eng.role.replace('_', ' ')})`,
                })),
              ]}
            />
            <Input
              label="Planned Visit Date"
              type="date"
              value={newTicket.planned_visit_date}
              onChange={(e) => setNewTicket({ ...newTicket, planned_visit_date: e.target.value })}
            />
          </div>

          <div className="pt-3 flex justify-end gap-2 border-t border-[#ECE9E2]">
            <Button type="button" variant="ghost" size="sm" onClick={() => setIsLogTicketOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" isLoading={isSubmitting}>
              Register Incident & Dispatch
            </Button>
          </div>
        </form>
      </Modal>

      {/* 2. Dispatch Engineer Modal */}
      <Modal
        isOpen={isAssignModalOpen}
        onClose={() => setIsAssignModalOpen(false)}
        title="Deploy Field Service Engineer"
        description="Allocate technical personnel and schedule the on-site diagnostic visit."
        maxWidth="md"
      >
        <form onSubmit={handleAssignSubmit} className="space-y-4">
          {actionError && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
              {actionError}
            </div>
          )}

          <div className="p-3 rounded-xl bg-[#FBFAF7] border border-[#DCD8CE] text-xs space-y-1">
            <div className="flex justify-between">
              <span className="text-[#4A5568]">Ticket Ref:</span>
              <span className="font-mono font-bold text-[#0F5E63]">{selectedTicket?.ticket_no}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#4A5568]">Customer:</span>
              <span className="font-bold text-[#14213D]">{selectedTicket?.organisation_name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#4A5568]">Complaint:</span>
              <span className="text-[#14213D] truncate max-w-xs">{selectedTicket?.complaint}</span>
            </div>
          </div>

          <Select
            label="Select Service Engineer"
            required
            value={assignForm.assigned_to}
            onChange={(e) => setAssignForm({ ...assignForm, assigned_to: e.target.value })}
            options={[
              { value: '', label: '-- Select Engineer --' },
              ...serviceEngineers.map((eng) => ({
                value: eng.id,
                label: `${eng.full_name} (${eng.role.replace('_', ' ')})`,
              })),
            ]}
          />

          <Input
            label="Scheduled Visit Date"
            type="date"
            required
            value={assignForm.planned_visit_date}
            onChange={(e) => setAssignForm({ ...assignForm, planned_visit_date: e.target.value })}
          />

          <div className="pt-2 flex justify-end gap-2 border-t border-[#ECE9E2]">
            <Button type="button" variant="ghost" size="sm" onClick={() => setIsAssignModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" isLoading={isSubmitting}>
              Deploy Engineer
            </Button>
          </div>
        </form>
      </Modal>

      {/* 3. Comprehensive Service & Rectification Report Modal (§33) */}
      <Modal
        isOpen={isResolveModalOpen}
        onClose={() => setIsResolveModalOpen(false)}
        title="File Service Report & Spares Replacement Voucher"
        description="Record diagnostic findings, technical rectification steps, spares consumed, and customer verification."
        maxWidth="lg"
      >
        <form onSubmit={handleResolveSubmit} className="space-y-4">
          {actionError && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
              {actionError}
            </div>
          )}

          <div className="p-3 rounded-xl bg-[#FBFAF7] border border-[#DCD8CE] text-xs grid grid-cols-2 gap-2">
            <div>
              <span className="text-[#4A5568]">Ticket Ref:</span>{' '}
              <strong className="font-mono text-[#0F5E63]">{selectedTicket?.ticket_no}</strong>
            </div>
            <div>
              <span className="text-[#4A5568]">Station:</span>{' '}
              <strong className="text-[#14213D]">{selectedTicket?.organisation_name}</strong>
            </div>
            {selectedTicket?.equipment_serial && (
              <div className="col-span-2">
                <span className="text-[#4A5568]">Machine S/N:</span>{' '}
                <strong className="font-mono text-[#14213D]">{selectedTicket?.equipment_serial}</strong>
              </div>
            )}
          </div>

          <Textarea
            label="Problem Identified (Root Cause Diagnostic)"
            required
            rows={2}
            value={reportForm.problem_identified}
            onChange={(e) => setReportForm({ ...reportForm, problem_identified: e.target.value })}
            placeholder="e.g. Diode array sensor board short-circuited due to power surge."
          />

          <Textarea
            label="Action Taken / Rectification Steps"
            required
            rows={3}
            value={reportForm.action_taken}
            onChange={(e) => setReportForm({ ...reportForm, action_taken: e.target.value })}
            placeholder="e.g. Replaced diode array PCB board #DA-200, cleaned optical collimator, re-calibrated X-Ray generator."
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              label="Spare Parts Consumed / Replaced"
              value={reportForm.parts_replaced}
              onChange={(e) => setReportForm({ ...reportForm, parts_replaced: e.target.value })}
              placeholder="e.g. PCB #DA-200 (1 Unit), Roller belt #RB-12 (2 Units)"
            />
            <Select
              label="Warranty / Billable Status"
              value={reportForm.warranty_status}
              onChange={(e) => setReportForm({ ...reportForm, warranty_status: e.target.value })}
              options={[
                { value: 'in_warranty', label: 'Warranty Covered (FOC Spares)' },
                { value: 'amc', label: 'Covered under Annual Maintenance (AMC)' },
                { value: 'billable', label: 'Out of Warranty — Billable Voucher' },
              ]}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              label="Customer Sign-off Officer Name & Designation"
              required
              value={reportForm.customer_signoff_by}
              onChange={(e) => setReportForm({ ...reportForm, customer_signoff_by: e.target.value })}
              placeholder="e.g. ACP Rajiv Kumar, Security Head"
            />
            <Input
              label="Customer Remarks / Officer Comments"
              value={reportForm.customer_remarks}
              onChange={(e) => setReportForm({ ...reportForm, customer_remarks: e.target.value })}
              placeholder="e.g. Equipment tested and operational in presence of station staff."
            />
          </div>

          <Input
            label="Signed Service Report Document URL"
            value={reportForm.report_url}
            onChange={(e) => setReportForm({ ...reportForm, report_url: e.target.value })}
            placeholder="https://res.cloudinary.com/... or Google Drive scanned report link"
          />

          {/* Revisit Required Toggle */}
          <div className="p-3 rounded-xl border border-[#DCD8CE] bg-white space-y-2">
            <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-[#14213D]">
              <input
                type="checkbox"
                checked={reportForm.further_work_required}
                onChange={(e) => setReportForm({ ...reportForm, further_work_required: e.target.checked })}
                className="h-4 w-4 rounded border-[#C9C4B8] text-[#0F5E63] focus:ring-[#0F5E63]"
              />
              <span>Further Work / Revisit Required (Additional parts or burn-in test needed)</span>
            </label>

            {reportForm.further_work_required && (
              <Input
                label="Scheduled Next Visit Date"
                type="date"
                required
                value={reportForm.next_visit_date}
                onChange={(e) => setReportForm({ ...reportForm, next_visit_date: e.target.value })}
              />
            )}
          </div>

          <div className="pt-3 flex justify-end gap-2 border-t border-[#ECE9E2]">
            <Button type="button" variant="ghost" size="sm" onClick={() => setIsResolveModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" isLoading={isSubmitting}>
              Sign Off & Complete Service Ticket
            </Button>
          </div>
        </form>
      </Modal>

      {/* 4. Comprehensive Enterprise Service Ticket Dossier (§32, §33, §34) */}
      <Modal
        isOpen={isDetailModalOpen}
        onClose={() => setIsDetailModalOpen(false)}
        title="Service Ticket Dossier & Operations Center"
        description="Comprehensive technical record, field visits, spares replenishment, and audit timeline."
        maxWidth="xl"
      >
        {selectedTicket && (
          <div className="space-y-4">
            {/* Top Identity Strip */}
            <div className="p-4 rounded-xl bg-[#FBFAF7] border border-[#DCD8CE] space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-base font-bold text-[#0F5E63]">{selectedTicket.ticket_no || selectedTicket.ticket_number}</span>
                  <Badge
                    variant={
                      ['resolved', 'closed'].includes(selectedTicket.status)
                        ? 'success'
                        : selectedTicket.priority === 'critical'
                        ? 'urgent'
                        : selectedTicket.status === 'in_progress'
                        ? 'info'
                        : 'warning'
                    }
                  >
                    {selectedTicket.status.replace(/_/g, ' ').toUpperCase()}
                  </Badge>
                  {selectedTicket.is_repeat_complaint && (
                    <Badge variant="urgent" size="sm" className="flex items-center gap-1 font-bold">
                      <Repeat className="h-3 w-3" />
                      <span>REPEAT COMPLAINT ({selectedTicket.repeat_count || 1} prior)</span>
                    </Badge>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <Badge variant="outline" size="sm" className="font-mono text-[10px]">
                    {selectedTicket.priority?.toUpperCase()} PRIORITY
                  </Badge>
                  <Badge variant="outline" size="sm" className="font-mono text-[10px]">
                    {selectedTicket.warranty_status_snapshot || selectedTicket.warranty_status || 'Under Warranty'}
                  </Badge>
                  {selectedTicket.is_chargeable && (
                    <Badge variant="urgent" size="sm">
                      CHARGEABLE (BILLABLE)
                    </Badge>
                  )}
                </div>
              </div>

              <div>
                <h4 className="font-serif text-base font-bold text-[#14213D]">{selectedTicket.organisation_name}</h4>
                <p className="text-xs text-[#14213D] font-medium mt-1">{selectedTicket.complaint || selectedTicket.complaint_description}</p>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs pt-2 border-t border-[#ECE9E2]">
                <div>
                  <span className="text-[#4A5568] block text-[10px]">Machine S/N</span>
                  <span className="font-mono font-bold text-[#14213D]">{selectedTicket.equipment_serial || selectedTicket.serial_number || 'N/A'}</span>
                </div>
                <div>
                  <span className="text-[#4A5568] block text-[10px]">Assigned Engineer</span>
                  <span className="font-semibold text-[#14213D]">{selectedTicket.assignee_name || 'Unassigned'}</span>
                </div>
                <div>
                  <span className="text-[#4A5568] block text-[10px]">Planned Visit</span>
                  <span className="font-semibold text-[#14213D]">
                    {selectedTicket.planned_visit_date ? new Date(selectedTicket.planned_visit_date).toLocaleDateString('en-IN') : 'Not Scheduled'}
                  </span>
                </div>
                <div>
                  <span className="text-[#4A5568] block text-[10px]">Resolution Due (SLA)</span>
                  <span className={`font-mono font-semibold ${selectedTicket.sla_resolution_due_at && new Date(selectedTicket.sla_resolution_due_at) < new Date() && !['resolved', 'closed'].includes(selectedTicket.status) ? 'text-[#9A3412] font-bold' : 'text-[#14213D]'}`}>
                    {selectedTicket.sla_resolution_due_at ? new Date(selectedTicket.sla_resolution_due_at).toLocaleString('en-IN') : 'N/A'}
                  </span>
                </div>
              </div>
            </div>

            {/* Dossier Tabs */}
            <div className="flex border-b border-[#DCD8CE] gap-1 overflow-x-auto text-xs font-semibold">
              <button
                type="button"
                onClick={() => setDetailTab('overview')}
                className={`py-2 px-3 border-b-2 transition-all ${
                  detailTab === 'overview'
                    ? 'border-[#0F5E63] text-[#0F5E63] bg-[#E3EFEE]/40 rounded-t-lg'
                    : 'border-transparent text-[#4A5568] hover:text-[#14213D]'
                }`}
              >
                Overview & Workflow
              </button>
              <button
                type="button"
                onClick={() => setDetailTab('visits')}
                className={`py-2 px-3 border-b-2 transition-all ${
                  detailTab === 'visits'
                    ? 'border-[#0F5E63] text-[#0F5E63] bg-[#E3EFEE]/40 rounded-t-lg'
                    : 'border-transparent text-[#4A5568] hover:text-[#14213D]'
                }`}
              >
                Visits & GPS ({selectedTicket.visits?.length || 0})
              </button>
              <button
                type="button"
                onClick={() => setDetailTab('reports')}
                className={`py-2 px-3 border-b-2 transition-all ${
                  detailTab === 'reports'
                    ? 'border-[#0F5E63] text-[#0F5E63] bg-[#E3EFEE]/40 rounded-t-lg'
                    : 'border-transparent text-[#4A5568] hover:text-[#14213D]'
                }`}
              >
                Service Reports ({selectedTicket.reports?.length || 0})
              </button>
              <button
                type="button"
                onClick={() => setDetailTab('parts')}
                className={`py-2 px-3 border-b-2 transition-all ${
                  detailTab === 'parts'
                    ? 'border-[#0F5E63] text-[#0F5E63] bg-[#E3EFEE]/40 rounded-t-lg'
                    : 'border-transparent text-[#4A5568] hover:text-[#14213D]'
                }`}
              >
                Spare Parts ({selectedTicket.part_requests?.length || 0})
              </button>
              <button
                type="button"
                onClick={() => setDetailTab('comments')}
                className={`py-2 px-3 border-b-2 transition-all ${
                  detailTab === 'comments'
                    ? 'border-[#0F5E63] text-[#0F5E63] bg-[#E3EFEE]/40 rounded-t-lg'
                    : 'border-transparent text-[#4A5568] hover:text-[#14213D]'
                }`}
              >
                Internal Notes ({selectedTicket.comments?.length || 0})
              </button>
              <button
                type="button"
                onClick={() => setDetailTab('history')}
                className={`py-2 px-3 border-b-2 transition-all ${
                  detailTab === 'history'
                    ? 'border-[#0F5E63] text-[#0F5E63] bg-[#E3EFEE]/40 rounded-t-lg'
                    : 'border-transparent text-[#4A5568] hover:text-[#14213D]'
                }`}
              >
                Audit Timeline ({selectedTicket.status_history?.length || 0})
              </button>
            </div>

            {/* Tab 1: Overview & Allowed Next Status Actions */}
            {detailTab === 'overview' && (
              <div className="space-y-4">
                <div className="p-3.5 rounded-xl border border-[#DCD8CE] bg-white space-y-2">
                  <h5 className="font-serif text-xs font-bold text-[#14213D] uppercase tracking-wider text-[#0F5E63]">
                    Workflow Status Transitions
                  </h5>
                  <p className="text-xs text-[#4A5568]">
                    Strict state machine enforces required guards before any state advancement.
                  </p>
                  <div className="flex flex-wrap gap-2 pt-2">
                    {/* Dynamic state actions */}
                    {['received', 'created'].includes(selectedTicket.status) && (
                      <Button
                        size="sm"
                        onClick={() => {
                          setIsAssignModalOpen(true);
                          setAssignForm({
                            assigned_to: selectedTicket.assigned_to || '',
                            planned_visit_date: selectedTicket.planned_visit_date || '',
                            status: 'assigned',
                          });
                        }}
                      >
                        <UserCheck className="h-3.5 w-3.5 mr-1" />
                        Assign Engineer
                      </Button>
                    )}

                    {selectedTicket.status === 'assigned' && (
                      <Button
                        size="sm"
                        onClick={() => {
                          setIsAssignModalOpen(true);
                          setAssignForm({
                            assigned_to: selectedTicket.assigned_to || '',
                            planned_visit_date: selectedTicket.planned_visit_date || new Date().toISOString().split('T')[0],
                            status: 'visit_scheduled',
                          });
                        }}
                      >
                        <Calendar className="h-3.5 w-3.5 mr-1" />
                        Schedule Visit
                      </Button>
                    )}

                    {['visit_scheduled', 'assigned'].includes(selectedTicket.status) && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={async () => {
                          await handleQuickStatusChange(selectedTicket, 'in_progress');
                          const updated = await api.get(`/service/tickets/${selectedTicket.id}`);
                          setSelectedTicket(updated);
                        }}
                      >
                        <Activity className="h-3.5 w-3.5 mr-1 text-[#0F5E63]" />
                        Start Work (In Progress)
                      </Button>
                    )}

                    {selectedTicket.status === 'in_progress' && (
                      <>
                        <Button
                          size="sm"
                          onClick={() => {
                            setIsResolveModalOpen(true);
                            setReportForm({
                              problem_identified: selectedTicket.complaint || '',
                              action_taken: '',
                              parts_replaced: '',
                              warranty_status: selectedTicket.warranty_status || 'in_warranty',
                              customer_signoff_by: '',
                              customer_remarks: '',
                              further_work_required: false,
                              next_visit_date: '',
                              report_url: '',
                            });
                          }}
                        >
                          <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                          Resolve & Submit Report
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={async () => {
                            await handleQuickStatusChange(selectedTicket, 'awaiting_part');
                            const updated = await api.get(`/service/tickets/${selectedTicket.id}`);
                            setSelectedTicket(updated);
                          }}
                        >
                          <Package className="h-3.5 w-3.5 mr-1 text-amber-600" />
                          Awaiting Parts
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={async () => {
                            await handleQuickStatusChange(selectedTicket, 'awaiting_customer');
                            const updated = await api.get(`/service/tickets/${selectedTicket.id}`);
                            setSelectedTicket(updated);
                          }}
                        >
                          <Clock className="h-3.5 w-3.5 mr-1 text-amber-600" />
                          Awaiting Customer
                        </Button>
                      </>
                    )}

                    {['awaiting_part', 'awaiting_customer'].includes(selectedTicket.status) && (
                      <Button
                        size="sm"
                        onClick={async () => {
                          await handleQuickStatusChange(selectedTicket, 'in_progress');
                          const updated = await api.get(`/service/tickets/${selectedTicket.id}`);
                          setSelectedTicket(updated);
                        }}
                      >
                        <RefreshCw className="h-3.5 w-3.5 mr-1" />
                        Resume In Progress
                      </Button>
                    )}

                    {['report_submitted', 'resolved'].includes(selectedTicket.status) && hasRole(['management', 'admin', 'service_team']) && (
                      <Button
                        size="sm"
                        onClick={async () => {
                          await handleCloseTicket(selectedTicket.id);
                          const updated = await api.get(`/service/tickets/${selectedTicket.id}`);
                          setSelectedTicket(updated);
                        }}
                      >
                        <FileCheck className="h-3.5 w-3.5 mr-1" />
                        Sign Off & Close Ticket
                      </Button>
                    )}

                    {selectedTicket.status !== 'closed' && selectedTicket.status !== 'escalated' && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={async () => {
                          await handleQuickStatusChange(selectedTicket, 'escalated');
                          const updated = await api.get(`/service/tickets/${selectedTicket.id}`);
                          setSelectedTicket(updated);
                        }}
                      >
                        <ShieldAlert className="h-3.5 w-3.5 mr-1 text-[#9A3412]" />
                        Escalate to OEM / Manager
                      </Button>
                    )}

                    {selectedTicket.status === 'closed' && hasRole(['management', 'admin']) && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={async () => {
                          await handleQuickStatusChange(selectedTicket, 'received');
                          const updated = await api.get(`/service/tickets/${selectedTicket.id}`);
                          setSelectedTicket(updated);
                        }}
                      >
                        <Repeat className="h-3.5 w-3.5 mr-1 text-[#0F5E63]" />
                        Reopen Ticket (Dispute)
                      </Button>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div className="p-3 rounded-xl border border-[#DCD8CE] bg-white space-y-1.5">
                    <span className="font-bold text-[#14213D] block">Technical Context</span>
                    <div className="text-[#4A5568] space-y-1">
                      <p><strong>Category:</strong> {selectedTicket.problem_category || 'Breakdown'}</p>
                      <p><strong>Source:</strong> {selectedTicket.complaint_source || 'Phone / Walk-in'}</p>
                      <p><strong>Location:</strong> {selectedTicket.location || selectedTicket.city || 'Standard Facility'}</p>
                    </div>
                  </div>

                  <div className="p-3 rounded-xl border border-[#DCD8CE] bg-white space-y-1.5">
                    <span className="font-bold text-[#14213D] block">Billing & Coverage Snapshot</span>
                    <div className="text-[#4A5568] space-y-1">
                      <p><strong>Coverage:</strong> {selectedTicket.warranty_status_snapshot || selectedTicket.warranty_status || 'Under Warranty'}</p>
                      <p><strong>Is Chargeable:</strong> {selectedTicket.is_chargeable ? 'Yes (Billable Spare/Labor)' : 'No (Covered FOC)'}</p>
                      <p><strong>Billing Status:</strong> {selectedTicket.billing_status || 'Not Chargeable'}</p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Tab 2: Visits & Check-in */}
            {detailTab === 'visits' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h5 className="font-serif text-xs font-bold text-[#14213D] uppercase tracking-wider text-[#0F5E63]">
                    Scheduled Technical Visits
                  </h5>
                </div>

                {(!selectedTicket.visits || selectedTicket.visits.length === 0) ? (
                  <div className="p-4 rounded-xl border border-dashed border-[#DCD8CE] text-center text-xs text-[#4A5568]">
                    No visits scheduled yet for this ticket.
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {selectedTicket.visits.map((v: any) => (
                      <div key={v.id} className="p-3 rounded-xl border border-[#DCD8CE] bg-white space-y-2">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-bold text-[#14213D]">
                            Visit #{v.visit_number}
                          </span>
                          <Badge variant={v.actual_check_out ? 'success' : v.actual_check_in ? 'info' : 'default'} size="sm">
                            {v.visit_outcome || (v.actual_check_in ? 'IN PROGRESS (CHECKED IN)' : 'SCHEDULED')}
                          </Badge>
                        </div>

                        <div className="grid grid-cols-2 gap-2 text-xs text-[#4A5568]">
                          <div>
                            <span>Scheduled: </span>
                            <strong className="text-[#14213D]">{v.scheduled_start ? new Date(v.scheduled_start).toLocaleString('en-IN') : 'TBD'}</strong>
                          </div>
                          <div>
                            <span>Check-in: </span>
                            <strong className="text-[#14213D]">{v.actual_check_in ? new Date(v.actual_check_in).toLocaleString('en-IN') : 'Pending'}</strong>
                          </div>
                        </div>

                        {v.notes && <p className="text-xs text-[#14213D] bg-[#FBFAF7] p-2 rounded border border-[#ECE9E2]">{v.notes}</p>}

                        {/* Engineer Check-in & Check-out actions */}
                        <div className="flex items-center gap-2 pt-1 border-t border-[#ECE9E2]">
                          {!v.actual_check_in && (
                            <Button size="xs" onClick={() => handleCheckInVisit(v.id)}>
                              <MapPin className="h-3 w-3 mr-1" />
                              Record GPS Check-in
                            </Button>
                          )}
                          {v.actual_check_in && !v.actual_check_out && (
                            <div className="flex items-center gap-1.5">
                              <Button size="xs" onClick={() => handleCheckOutVisit(v.id, 'Completed')}>
                                Check-out: Completed
                              </Button>
                              <Button size="xs" variant="secondary" onClick={() => handleCheckOutVisit(v.id, 'Part Required')}>
                                Check-out: Part Required
                              </Button>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Schedule Visit Inline Form */}
                <form onSubmit={handleCreateVisit} className="p-3.5 rounded-xl border border-[#DCD8CE] bg-[#FBFAF7] space-y-3">
                  <h6 className="font-serif text-xs font-bold text-[#14213D]">Schedule Follow-up Visit</h6>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <Input
                      label="Planned Date & Time"
                      type="datetime-local"
                      required
                      value={visitScheduleDate}
                      onChange={(e) => setVisitScheduleDate(e.target.value)}
                    />
                    <Input
                      label="Visit Notes / Instructions"
                      value={visitNotesInput}
                      onChange={(e) => setVisitNotesInput(e.target.value)}
                      placeholder="e.g. Bring replacement optics assembly"
                    />
                  </div>
                  <div className="flex justify-end">
                    <Button type="submit" size="xs">Schedule Visit</Button>
                  </div>
                </form>
              </div>
            )}

            {/* Tab 3: Service Reports & Approval */}
            {detailTab === 'reports' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h5 className="font-serif text-xs font-bold text-[#14213D] uppercase tracking-wider text-[#0F5E63]">
                    Filed Engineering Reports
                  </h5>
                  <Button
                    size="xs"
                    onClick={() => {
                      setIsResolveModalOpen(true);
                      setReportForm({
                        problem_identified: selectedTicket.complaint || '',
                        action_taken: '',
                        parts_replaced: '',
                        warranty_status: selectedTicket.warranty_status || 'in_warranty',
                        customer_signoff_by: '',
                        customer_remarks: '',
                        further_work_required: false,
                        next_visit_date: '',
                        report_url: '',
                      });
                    }}
                  >
                    <Plus className="h-3.5 w-3.5 mr-1" />
                    New Report
                  </Button>
                </div>

                {(!selectedTicket.reports || selectedTicket.reports.length === 0) ? (
                  <div className="p-4 rounded-xl border border-dashed border-[#DCD8CE] text-center text-xs text-[#4A5568]">
                    No service reports filed yet for this incident.
                  </div>
                ) : (
                  selectedTicket.reports.map((rep: any) => (
                    <div key={rep.id} className="p-3.5 rounded-xl border border-[#DCD8CE] bg-white space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-bold text-[#14213D]">
                          Submitted by: {rep.submitted_by_name || 'Service Engineer'}
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="text-[#4A5568]">{new Date(rep.created_at).toLocaleDateString('en-IN')}</span>
                          <Badge
                            variant={
                              rep.report_status === 'Approved'
                                ? 'success'
                                : rep.report_status === 'Returned for Correction'
                                ? 'urgent'
                                : 'warning'
                            }
                            size="sm"
                          >
                            {rep.report_status || 'SUBMITTED'}
                          </Badge>
                        </div>
                      </div>

                      <div className="text-xs space-y-1.5 text-[#14213D]">
                        <p><strong>Problem Identified:</strong> {rep.problem_identified}</p>
                        {rep.root_cause && <p><strong>Root Cause:</strong> {rep.root_cause}</p>}
                        <p><strong>Action Taken:</strong> {rep.action_taken}</p>
                        {rep.parts_replaced && <p><strong>Parts Replaced:</strong> {rep.parts_replaced}</p>}
                        {rep.customer_name_signed && <p><strong>Customer Sign-off:</strong> {rep.customer_name_signed}</p>}
                        {rep.return_reason && (
                          <div className="p-2 rounded bg-red-50 border border-red-200 text-red-700 text-xs">
                            <strong>Correction Required:</strong> {rep.return_reason}
                          </div>
                        )}
                      </div>

                      {/* Management Approval / Return controls */}
                      {rep.report_status === 'Submitted' && hasRole(['management', 'admin', 'regional_manager']) && (
                        <div className="pt-2 border-t border-[#ECE9E2] flex items-center justify-end gap-2">
                          {isReturningReport === rep.id ? (
                            <div className="flex items-center gap-2 w-full">
                              <Input
                                placeholder="Specify reason for returning report..."
                                value={reportReturnReason}
                                onChange={(e) => setReportReturnReason(e.target.value)}
                                className="flex-1"
                              />
                              <Button
                                size="xs"
                                variant="danger"
                                onClick={() => handleReviewReport(rep.id, false, reportReturnReason)}
                              >
                                Confirm Return
                              </Button>
                              <Button size="xs" variant="ghost" onClick={() => setIsReturningReport(null)}>
                                Cancel
                              </Button>
                            </div>
                          ) : (
                            <>
                              <Button size="xs" variant="secondary" onClick={() => setIsReturningReport(rep.id)}>
                                Return for Correction
                              </Button>
                              <Button size="xs" onClick={() => handleReviewReport(rep.id, true)}>
                                <Check className="h-3.5 w-3.5 mr-1" />
                                Approve Report
                              </Button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}

            {/* Tab 4: Spare Parts & Inventory */}
            {detailTab === 'parts' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h5 className="font-serif text-xs font-bold text-[#14213D] uppercase tracking-wider text-[#0F5E63]">
                    Spares & Part Requests
                  </h5>
                </div>

                {(!selectedTicket.part_requests || selectedTicket.part_requests.length === 0) ? (
                  <div className="p-4 rounded-xl border border-dashed border-[#DCD8CE] text-center text-xs text-[#4A5568]">
                    No spare parts requested for this incident.
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-xl border border-[#DCD8CE]">
                    <table className="w-full text-xs text-left">
                      <thead className="bg-[#FBFAF7] text-[#14213D] border-b border-[#ECE9E2] font-semibold">
                        <tr>
                          <th className="py-2 px-3">Part Description</th>
                          <th className="py-2 px-3">Qty</th>
                          <th className="py-2 px-3">Requested By</th>
                          <th className="py-2 px-3">Status</th>
                          <th className="py-2 px-3">Expected Date</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#ECE9E2] bg-white">
                        {selectedTicket.part_requests.map((p: any) => (
                          <tr key={p.id}>
                            <td className="py-2 px-3 font-medium text-[#14213D]">{p.part_name}</td>
                            <td className="py-2 px-3 font-mono font-bold text-[#0F5E63]">{p.quantity}</td>
                            <td className="py-2 px-3 text-[#4A5568]">{p.requested_by_name || 'Technician'}</td>
                            <td className="py-2 px-3">
                              <Badge
                                variant={
                                  p.status === 'Issued'
                                    ? 'success'
                                    : p.status === 'Reserved'
                                    ? 'info'
                                    : p.status === 'Unavailable – Ordered'
                                    ? 'urgent'
                                    : 'warning'
                                }
                                size="sm"
                              >
                                {p.status}
                              </Badge>
                            </td>
                            <td className="py-2 px-3 font-mono text-[#4A5568]">{p.expected_date ? new Date(p.expected_date).toLocaleDateString('en-IN') : 'N/A'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Request Part Form */}
                <form onSubmit={handleAddPartRequest} className="p-3.5 rounded-xl border border-[#DCD8CE] bg-[#FBFAF7] space-y-3">
                  <h6 className="font-serif text-xs font-bold text-[#14213D]">Raise New Spare Part Request</h6>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <Input
                      label="Part Name / Part Number"
                      required
                      value={partNameInput}
                      onChange={(e) => setPartNameInput(e.target.value)}
                      placeholder="e.g. Conveyor Motor VFD-200"
                    />
                    <Input
                      label="Quantity"
                      type="number"
                      min={1}
                      required
                      value={partQtyInput}
                      onChange={(e) => setPartQtyInput(Number(e.target.value))}
                    />
                    <Input
                      label="Remarks for Store"
                      value={partRemarksInput}
                      onChange={(e) => setPartRemarksInput(e.target.value)}
                      placeholder="Urgent replacement required"
                    />
                  </div>
                  <div className="flex justify-end">
                    <Button type="submit" size="xs">Submit Part Request</Button>
                  </div>
                </form>
              </div>
            )}

            {/* Tab 5: Comments & Internal Notes */}
            {detailTab === 'comments' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h5 className="font-serif text-xs font-bold text-[#14213D] uppercase tracking-wider text-[#0F5E63]">
                    Internal Team Discussion & Dispatch Notes
                  </h5>
                </div>

                {(!selectedTicket.comments || selectedTicket.comments.length === 0) ? (
                  <div className="p-4 rounded-xl border border-dashed border-[#DCD8CE] text-center text-xs text-[#4A5568]">
                    No comments posted yet.
                  </div>
                ) : (
                  <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                    {selectedTicket.comments.map((c: any) => (
                      <div key={c.id} className="p-2.5 rounded-xl border border-[#DCD8CE] bg-white text-xs space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-[#14213D]">{c.author_name || 'Team Member'}</span>
                          <span className="text-[#4A5568] text-[10px]">{new Date(c.created_at).toLocaleString('en-IN')}</span>
                        </div>
                        <p className="text-[#14213D]">{c.body}</p>
                      </div>
                    ))}
                  </div>
                )}

                <form onSubmit={handleAddComment} className="flex gap-2">
                  <Input
                    placeholder="Type an internal note for engineers or coordinators..."
                    value={commentInput}
                    onChange={(e) => setCommentInput(e.target.value)}
                    className="flex-1"
                  />
                  <Button type="submit" size="sm">Post Note</Button>
                </form>
              </div>
            )}

            {/* Tab 6: Audit History */}
            {detailTab === 'history' && (
              <div className="space-y-4">
                <h5 className="font-serif text-xs font-bold text-[#14213D] uppercase tracking-wider text-[#0F5E63]">
                  Status Progression & SLA Audit Trail
                </h5>

                {(!selectedTicket.status_history || selectedTicket.status_history.length === 0) ? (
                  <div className="p-4 rounded-xl border border-dashed border-[#DCD8CE] text-center text-xs text-[#4A5568]">
                    No audit records recorded yet.
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {selectedTicket.status_history.map((h: any) => (
                      <div key={h.id} className="p-3 rounded-xl border border-[#DCD8CE] bg-white text-xs flex items-start justify-between gap-4">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-[#4A5568] uppercase">{h.from_status || 'INITIAL'}</span>
                            <ChevronRight className="h-3 w-3 text-[#4A5568]" />
                            <span className="font-mono font-bold text-[#0F5E63] uppercase">{h.to_status}</span>
                            {h.sla_impact !== 'none' && (
                              <Badge variant="warning" size="sm">SLA {h.sla_impact?.toUpperCase()}</Badge>
                            )}
                          </div>
                          {h.reason && <p className="text-[#14213D] italic">"{h.reason}"</p>}
                          <span className="text-[10px] text-[#4A5568] block">By {h.changed_by_name || 'System Operator'}</span>
                        </div>
                        <span className="font-mono text-[10px] text-[#4A5568] shrink-0">
                          {new Date(h.changed_at).toLocaleString('en-IN')}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="pt-2 flex justify-end">
              <Button size="sm" variant="secondary" onClick={() => setIsDetailModalOpen(false)}>
                Close Dossier
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* 5. Employee Workload Modal (§34) */}
      <Modal
        isOpen={isWorkloadModalOpen}
        onClose={() => setIsWorkloadModalOpen(false)}
        title="Service Team Workload & Allocation HUD"
        description="Monitor field engineer queue depth, active breakdown assignments, overdue SLA risks, and completed tickets to eliminate uncertainty."
        maxWidth="lg"
      >
        <div className="space-y-4">
          <div className="overflow-x-auto rounded-[14px] border border-[#DCD8CE]">
            <table className="w-full text-xs text-left">
              <thead className="bg-[#FBFAF7] text-[#14213D] border-b border-[#ECE9E2] font-semibold">
                <tr>
                  <th className="py-2.5 px-3">Field Engineer</th>
                  <th className="py-2.5 px-3">Active Tickets</th>
                  <th className="py-2.5 px-3">Overdue Risks</th>
                  <th className="py-2.5 px-3">Completed</th>
                  <th className="py-2.5 px-3">Workload Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#ECE9E2] bg-white">
                {(!stats?.employeeWorkload || stats.employeeWorkload.length === 0) ? (
                  serviceEngineers.map((eng) => {
                    const engActive = tickets.filter(
                      (t) => t.assigned_to === eng.id && !['resolved', 'closed', 'report_submitted'].includes(t.status),
                    ).length;
                    const engOverdue = tickets.filter(
                      (t) =>
                        t.assigned_to === eng.id &&
                        t.planned_visit_date &&
                        new Date(t.planned_visit_date) < new Date() &&
                        !['resolved', 'closed', 'report_submitted'].includes(t.status),
                    ).length;
                    const engCompleted = tickets.filter(
                      (t) => t.assigned_to === eng.id && ['resolved', 'closed', 'report_submitted'].includes(t.status),
                    ).length;

                    return (
                      <tr key={eng.id} className="hover:bg-[#FBFAF7]">
                        <td className="py-2 px-3">
                          <strong className="text-[#14213D] block">{eng.full_name}</strong>
                          <span className="text-[#4A5568] text-[10px]">{eng.email}</span>
                        </td>
                        <td className="py-2 px-3 font-mono font-bold text-[#0F5E63]">{engActive}</td>
                        <td className="py-2 px-3 font-mono font-bold text-[#9A3412]">{engOverdue}</td>
                        <td className="py-2 px-3 font-mono text-[#14213D]">{engCompleted}</td>
                        <td className="py-2 px-3">
                          {engOverdue > 0 ? (
                            <Badge variant="urgent" size="sm">OVERDUE RISK</Badge>
                          ) : engActive >= 4 ? (
                            <Badge variant="warning" size="sm">HEAVY QUEUE</Badge>
                          ) : engActive > 0 ? (
                            <Badge variant="info" size="sm">OPTIMAL LOAD</Badge>
                          ) : (
                            <Badge variant="default" size="sm">AVAILABLE</Badge>
                          )}
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  stats.employeeWorkload.map((ew: any) => (
                    <tr key={ew.id} className="hover:bg-[#FBFAF7]">
                      <td className="py-2 px-3">
                        <strong className="text-[#14213D] block">{ew.name}</strong>
                        <span className="text-[#4A5568] text-[10px]">{ew.email}</span>
                      </td>
                      <td className="py-2 px-3 font-mono font-bold text-[#0F5E63]">{ew.activeTickets}</td>
                      <td className="py-2 px-3 font-mono font-bold text-[#9A3412]">{ew.overdueTickets}</td>
                      <td className="py-2 px-3 font-mono text-[#14213D]">{ew.completedTickets}</td>
                      <td className="py-2 px-3">
                        {ew.overdueTickets > 0 ? (
                          <Badge variant="urgent" size="sm">OVERDUE RISK</Badge>
                        ) : ew.activeTickets >= 4 ? (
                          <Badge variant="warning" size="sm">HEAVY QUEUE</Badge>
                        ) : ew.activeTickets > 0 ? (
                          <Badge variant="info" size="sm">OPTIMAL LOAD</Badge>
                        ) : (
                          <Badge variant="default" size="sm">AVAILABLE</Badge>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="pt-2 flex justify-end">
            <Button size="sm" variant="secondary" onClick={() => setIsWorkloadModalOpen(false)}>
              Close Workload HUD
            </Button>
          </div>
        </div>
      </Modal>
    </PageContainer>
  );
}
