'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Compass,
  Target,
  Calendar,
  FileText,
  Users,
  Clock,
  CheckCircle2,
  AlertTriangle,
  ArrowUpRight,
  TrendingUp,
  MapPin,
  Building,
  UserCheck,
  ChevronRight,
  Shield,
  ShieldAlert,
  Search,
  Filter,
  Plus,
  Send,
  Sparkles,
  Award,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';
import {
  Button,
  Badge,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  Tabs,
  Modal,
  Input,
  Select,
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
  PageContainer,
  PageHeader,
  StatCard,
  StatGrid, ToolbarBox, ToolbarSlot, PageLoader } from '@/components/ui';
import { formatLakh, formatINR } from '@arihant/shared';

const formatLeadCategory = (category?: string) => {
  if (!category) return 'New Lead';
  const c = category.toLowerCase().trim();
  if (c === 'new_lead' || c === 'new') return 'New Lead';
  if (c === 'follow_up' || c === 'follow-up') return 'Follow-up';
  if (c === 'active') return 'Active';
  if (c === 'expected') return 'Expected';
  return category.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
};

const getCategoryBadgeVariant = (category?: string): 'info' | 'success' | 'warning' | 'default' => {
  const c = category?.toLowerCase().trim();
  if (c === 'new_lead' || c === 'new') return 'info';
  if (c === 'active') return 'success';
  if (c === 'expected') return 'warning';
  return 'default';
};

export default function RegionalPage() {
  const { user, hasRole } = useAuth();
  const [data, setData] = useState<any | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('team');
  const [tenderPage, setTenderPage] = useState(1);
  const TENDER_PAGE_SIZE = 15;
  const [selectedZoneId, setSelectedZoneId] = useState<string>('');
  const [searchEmployee, setSearchEmployee] = useState('');

  // Modals
  const [selectedEmployee, setSelectedEmployee] = useState<any | null>(null);
  const [isEvidenceModalOpen, setIsEvidenceModalOpen] = useState(false);
  const [selectedVisit, setSelectedVisit] = useState<any | null>(null);
  const [isInterventionModalOpen, setIsInterventionModalOpen] = useState(false);
  const [interventionInstructions, setInterventionInstructions] = useState('');
  const [isSubmittingIntervention, setIsSubmittingIntervention] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const fetchRegionalData = async (zoneId?: string) => {
    try {
      setIsLoading(true);
      const params: any = {};
      if (zoneId) {
        params.zone_id = zoneId;
      }
      const res = await api.get('/dashboard/regional-performance', params);
      setData(res);
      if (res.zone && !selectedZoneId) {
        setSelectedZoneId(res.zone.id);
      }
    } catch (err) {
      console.error('Failed to load regional performance data:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (hasRole(['regional_manager', 'management', 'admin'])) {
      fetchRegionalData(selectedZoneId || undefined);
    }
  }, [selectedZoneId]);

  const handleOpenIntervention = (visit: any) => {
    setSelectedVisit(visit);
    setInterventionInstructions('');
    setActionError(null);
    setIsInterventionModalOpen(true);
  };

  const handleSaveIntervention = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedVisit) return;
    setIsSubmittingIntervention(true);
    setActionError(null);

    try {
      await api.post(`/visits/${selectedVisit.id}/intervention`, {
        instructions: interventionInstructions,
      });
      setIsInterventionModalOpen(false);
      await fetchRegionalData(selectedZoneId || undefined);
    } catch (err: any) {
      setActionError(err.message || 'Failed to submit manager intervention.');
    } finally {
      setIsSubmittingIntervention(false);
    }
  };

  if (!hasRole(['regional_manager', 'management', 'admin'])) {
    return (
      <div className="p-12 text-center text-[#4A5568] bg-white border border-[#DCD8CE] rounded-xl space-y-3 shadow-xs">
        <ShieldAlert className="h-12 w-12 text-red-500 mx-auto" />
        <h2 className="text-lg font-bold text-[#14213D]">Access Restricted</h2>
        <p className="text-xs">
          Only Regional Managers, Executive Management, and System Administrators have permission to access the Regional Command Hub.
        </p>
      </div>
    );
  }

  const zoneName = data?.zone?.name || 'North';
  const zoneCode = data?.zone?.code || 'N';

  if (isLoading && !data) {
    return (
      <PageContainer>
        <PageLoader label="Loading territory command" rows={4} />
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        title={`${zoneName} Zone`}
        actions={
          <>
            {/* Zone Switcher for Management / Admin */}
            {hasRole(['management', 'admin']) && data?.availableZones && (
              <div className="flex items-center space-x-2 bg-[#FBFAF7] border border-[#DCD8CE] px-3 py-1 rounded-lg text-xs">
                <span className="text-[10px] font-bold uppercase text-[#4A5568]">Territory:</span>
                <Select
                  value={selectedZoneId}
                  onChange={(e) => { setSelectedZoneId(e.target.value); setTenderPage(1); }}
                  className="h-8 border-0 bg-transparent text-xs font-bold text-[#0F5E63] focus:ring-0 p-0"
                >
                  {data.availableZones.map((z: any) => (
                    <option key={z.id} value={z.id}>
                      {z.name} Zone ({z.code})
                    </option>
                  ))}
                </Select>
              </div>
            )}

            <Link href="/visits">
              <Button variant="secondary" size="sm">
                <Calendar className="mr-2 h-4 w-4 text-[#0F5E63]" />
                <span>Tour Planner</span>
              </Button>
            </Link>

            <Link href="/tasks">
              <Button variant="primary" size="sm">
                <Plus className="mr-2 h-4 w-4" />
                <span>Assign Task</span>
              </Button>
            </Link>
          </>
        }
      />

      {/* ── 4 KEY ACCENT METRIC HUD CARDS ── */}
      <StatGrid cols={4}>
        <StatCard
          title="Regional Pipeline"
          value={formatLakh(data?.sales?.totalPipelineValueLakh ?? 0)}
          icon={<Target size={16} />}
          variant="primary"
          subtext={`${data?.sales?.totalLeads ?? 0} Opportunities • ${data?.sales?.activeCount ?? 0} Active`}
        />
        <StatCard
          title="Territory GeM Bids"
          value={`${data?.tenders?.total ?? 0} Bids`}
          icon={<FileText size={16} />}
          variant="rose"
          subtext={`${data?.tenders?.closingSoon ?? 0} Closing ≤ 7 Days • ${data?.tenders?.awaitingApproval ?? 0} Signoff`}
        />
        <StatCard
          title="Field Client Visits"
          value={`${data?.visits?.completed ?? 0} / ${data?.visits?.total ?? 0}`}
          icon={<Calendar size={16} />}
          variant="emerald"
          subtext={`${data?.visits?.completionRate ?? 0}% Delivery Rate • ${data?.visits?.planned ?? 0} Upcoming`}
        />
        <StatCard
          title="Territory Personnel"
          value={`${data?.teamPerformance?.length ?? 0} Reps`}
          icon={<Users size={16} />}
          variant="amber"
          subtext={`${data?.teamPerformance?.filter((e: any) => e.complianceRating === 'Excellent' || e.complianceRating === 'Good').length ?? 0} In Good Standing`}
        />
      </StatGrid>

      {/* ── 4 TABS NAVIGATION ── */}
      <ToolbarBox>
      <Tabs
        tabs={[
          { id: 'team', label: `Team Accountability (${data?.teamPerformance?.length || 0})` },
          { id: 'leads', label: `Sales Leads & Funnel (${data?.sales?.totalLeads || 0})` },
          { id: 'visits', label: `Territory Tours & Visits (${data?.visits?.total || 0})` },
          { id: 'tenders', label: `Territory GeM Tenders (${data?.tenders?.total || 0})` },
        ]}
        activeTab={activeTab}
        onChange={setActiveTab}
      />
      </ToolbarBox>

      {/* ── TAB 1: EMPLOYEE ACCOUNTABILITY & PERFORMANCE ── */}
      {activeTab === 'team' && (
        <div className="space-y-4">
          <ToolbarSlot><div className="p-4 rounded-xl bg-white border border-[#DCD8CE] flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
            <div className="flex items-center space-x-2">
              <Users className="h-4 w-4 text-[#0F5E63]" />
              <span className="text-xs font-bold text-[#14213D]">
                Direct Reports & Regional Staff Scorecard
              </span>
            </div>
            <div className="flex items-center space-x-2">
              <Input
                type="text"
                placeholder="Filter rep by name, territory, email..."
                value={searchEmployee}
                onChange={(e) => setSearchEmployee(e.target.value)}
                className="w-64 h-9"
              />
            </div>
          </div></ToolbarSlot>

          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Representative</TableHead>
                  <TableHead>Role & Region</TableHead>
                  <TableHead className="text-center">Milestones (Done/Total)</TableHead>
                  <TableHead className="text-center">Overdue</TableHead>
                  <TableHead className="text-center">Visits Done</TableHead>
                  <TableHead className="text-right">Pipeline (₹ L)</TableHead>
                  <TableHead className="text-center">Active Blockers</TableHead>
                  <TableHead className="text-center">Compliance</TableHead>
                  <TableHead className="text-right">Evidence</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.teamPerformance
                  ?.filter(
                    (emp: any) =>
                      !searchEmployee ||
                      emp.full_name.toLowerCase().includes(searchEmployee.toLowerCase()) ||
                      emp.email.toLowerCase().includes(searchEmployee.toLowerCase()) ||
                      emp.region_name.toLowerCase().includes(searchEmployee.toLowerCase()),
                  )
                  .map((emp: any) => (
                    <TableRow key={emp.id}>
                      <TableCell className="font-bold text-[#14213D] whitespace-nowrap">
                        {emp.full_name}
                        <div className="text-[10px] text-[#4A5568] font-mono font-normal">
                          {emp.email}
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <span className="font-semibold text-[#14213D] text-xs">
                          {emp.role.replace('_', ' ').toUpperCase()}
                        </span>
                        <div className="text-[10px] text-[#4A5568]">
                          {emp.region_name}
                        </div>
                      </TableCell>
                      <TableCell className="text-center whitespace-nowrap">
                        <span className="font-mono font-bold text-[#14213D]">
                          {emp.tasks.completed} / {emp.tasks.total}
                        </span>
                        <div className="text-[10px] text-[#4A5568]">
                          {emp.tasks.completionRate}%
                        </div>
                      </TableCell>
                      <TableCell className="text-center whitespace-nowrap">
                        {emp.tasks.overdue > 0 ? (
                          <span className="text-[11px] font-bold text-red-600 bg-red-50 px-2 py-0.5 rounded">
                            {emp.tasks.overdue}
                          </span>
                        ) : (
                          <span className="text-[11px] text-emerald-700 font-medium">0</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center font-mono font-bold text-[#14213D] whitespace-nowrap">
                        {emp.visits.completed} / {emp.visits.total}
                      </TableCell>
                      <TableCell className="text-right font-mono font-bold text-[#0F5E63] whitespace-nowrap">
                        {formatLakh(emp.leads.valueLakh || 0)}
                      </TableCell>
                      <TableCell className="text-center whitespace-nowrap">
                        {emp.activeBlockers.length > 0 ? (
                          <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 font-bold text-[10px]">
                            {emp.activeBlockers.length} BLOCKED
                          </span>
                        ) : (
                          <span className="text-[11px] text-[#4A5568]">None</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center whitespace-nowrap">
                        <Badge
                          variant={
                            emp.complianceRating === 'Excellent'
                              ? 'success'
                              : emp.complianceRating === 'Good'
                              ? 'default'
                              : emp.complianceRating === 'Needs Attention'
                              ? 'warning'
                              : 'danger'
                          }
                          size="sm"
                        >
                          {emp.complianceRating.toUpperCase()}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            setSelectedEmployee(emp);
                            setIsEvidenceModalOpen(true);
                          }}
                          className="shadow-xs text-xs text-[#0F5E63]"
                        >
                          <span>Inspect</span>
                          <ChevronRight className="ml-1 h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </Card>

          <div className="p-3 rounded-lg bg-[#FBFAF7] border border-[#DCD8CE] text-[11px] text-[#4A5568] flex items-center justify-between">
            <span>
              <strong>Policy Notice:</strong> Performance reviews surface verified empirical metrics (task completion, deadline compliance, blocker resolution) for managerial review.
            </span>
            <span className="text-[#0F5E63] font-semibold text-xs">Audit Compliant</span>
          </div>
        </div>
      )}

      {/* ── TAB 2: REGIONAL LEADS & SALES FUNNEL ── */}
      {activeTab === 'leads' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
            <div className="p-4 rounded-xl bg-white border border-[#DCD8CE] shadow-xs">
              <span className="text-[10px] text-[#4A5568] font-bold uppercase block">
                High Probability Value
              </span>
              <span className="text-xl font-extrabold text-emerald-700">
                {formatLakh(data?.sales?.highProbValueLakh || 0)}
              </span>
              <span className="text-[11px] text-[#4A5568] block mt-1">Confirmed Procurement Stage</span>
            </div>

            <div className="p-4 rounded-xl bg-white border border-[#DCD8CE] shadow-xs">
              <span className="text-[10px] text-[#4A5568] font-bold uppercase block">
                Medium Probability Value
              </span>
              <span className="text-xl font-extrabold text-[#0F5E63]">
                {formatLakh(data?.sales?.medProbValueLakh || 0)}
              </span>
              <span className="text-[11px] text-[#4A5568] block mt-1">Technical Spec / QR Stage</span>
            </div>

            <div className="p-4 rounded-xl bg-white border border-[#DCD8CE] shadow-xs">
              <span className="text-[10px] text-[#4A5568] font-bold uppercase block">
                Expected / Follow-Up Pipeline
              </span>
              <span className="text-xl font-extrabold text-amber-700">
                {formatLakh(data?.sales?.lowProbValueLakh || 0)}
              </span>
              <span className="text-[11px] text-[#4A5568] block mt-1">Initial Engagement & Calls</span>
            </div>
          </div>

          <Card>
            <div className="p-4 border-b border-[#DCD8CE] bg-[#FBFAF7] flex items-center justify-between">
              <div>
                <span className="text-xs font-bold text-[#14213D]">
                  Active Territory Opportunities in {zoneName} Zone ({data?.sales?.total || 0})
                </span>
                <p className="text-[11px] text-[#4A5568]">
                  Live sales pipeline value: <strong>{formatLakh(data?.sales?.pipelineValueLakh || 0)}</strong> across key security accounts.
                </p>
              </div>
              <Link href="/leads">
                <Button size="sm" variant="outline" className="text-xs text-[#0F5E63]">
                  View All in CRM <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
                </Button>
              </Link>
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Organisation & City</TableHead>
                  <TableHead>Product Category</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Probability</TableHead>
                  <TableHead className="text-right">Value (₹ Lakh)</TableHead>
                  <TableHead>Territory Rep</TableHead>
                  <TableHead>Follow-Up Due</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.sales?.recentLeads?.map((ld: any) => (
                  <TableRow key={ld.id}>
                    <TableCell className="font-bold text-[#14213D]">
                      {ld.organisation_name}
                      <div className="text-[10px] text-[#4A5568] font-normal">{ld.city || 'North Zone'}</div>
                    </TableCell>
                    <TableCell className="text-[#14213D]">{ld.product_name || 'Security Scanning Hardware'}</TableCell>
                    <TableCell>
                      <Badge
                        variant={getCategoryBadgeVariant(ld.category)}
                        size="sm"
                        className="font-semibold"
                      >
                        {formatLeadCategory(ld.category)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          ld.probability === 'high'
                            ? 'success'
                            : ld.probability === 'medium'
                            ? 'warning'
                            : 'default'
                        }
                        size="sm"
                        className="uppercase font-bold"
                      >
                        {ld.probability}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono font-bold text-[#0F5E63]">
                      {formatLakh(ld.value_lakh || 0)}
                    </TableCell>
                    <TableCell className="text-[#4A5568]">{ld.assigned_rep_name || 'Territory Rep'}</TableCell>
                    <TableCell className="font-mono text-[#4A5568]">
                      {ld.next_followup_date ? new Date(ld.next_followup_date).toLocaleDateString('en-IN') : '-'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </div>
      )}

      {/* ── TAB 3: FIELD VISITS & TOUR PLANNING ── */}
      {activeTab === 'visits' && (
        <div className="space-y-4">
          <Card>
            <div className="p-4 border-b border-[#DCD8CE] bg-[#FBFAF7] flex items-center justify-between">
              <div>
                <span className="text-xs font-bold text-[#14213D]">
                  Field Visit Logs & Customer Encounters ({data?.visits?.total || 0})
                </span>
                <p className="text-[11px] text-[#4A5568]">
                  Field representatives deploying across state police lines, high-security prisons, and defence outposts.
                </p>
              </div>
              <Link href="/visits">
                <Button size="sm" variant="outline" className="text-xs text-[#0F5E63]">
                  Full Tour Planner <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
                </Button>
              </Link>
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Planned Date</TableHead>
                  <TableHead>Organisation & Location</TableHead>
                  <TableHead>Purpose</TableHead>
                  <TableHead>Field Rep</TableHead>
                  <TableHead>Tour Status</TableHead>
                  <TableHead>Manager Directive</TableHead>
                  <TableHead className="text-right">Intervention</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.visits?.recentVisits?.map((v: any) => (
                  <TableRow key={v.id}>
                    <TableCell className="font-mono font-bold text-[#14213D] whitespace-nowrap">
                      {new Date(v.planned_date).toLocaleDateString('en-IN')}
                    </TableCell>
                    <TableCell className="font-bold text-[#14213D]">
                      {v.organisation_name}
                      <div className="text-[10px] text-[#4A5568] font-normal flex items-center gap-1">
                        <MapPin className="h-3 w-3 text-[#0F5E63]" />
                        <span>{v.location || 'Client HQ'}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-[#14213D] max-w-[200px] truncate">{v.purpose || 'Technical brief'}</TableCell>
                    <TableCell className="text-[#4A5568] whitespace-nowrap">{v.assigned_rep_name || 'Territory Rep'}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      <Badge
                        variant={v.status === 'completed' ? 'success' : v.status === 'planned' ? 'default' : 'warning'}
                        size="sm"
                        className="uppercase font-bold"
                      >
                        {v.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-[#4A5568] max-w-[180px] truncate font-italic">
                      {v.remarks ? (
                        <span className="text-purple-800 font-medium">{v.remarks}</span>
                      ) : (
                        <span className="text-[#7D92B5]">None attached</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleOpenIntervention(v)}
                        className="text-xs text-[#0F5E63] hover:bg-[#E3EFEE]"
                      >
                        + Add Stop / Also Meet
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </div>
      )}

      {/* ── TAB 4: TERRITORY GeM TENDERS ── */}
      {activeTab === 'tenders' && (
        <div className="space-y-4">
          <Card>
            <div className="p-4 border-b border-[#DCD8CE] bg-[#FBFAF7] flex items-center justify-between">
              <div>
                <span className="text-xs font-bold text-[#14213D]">
                  GeM Defense & Security Tenders in {zoneName} Zone ({data?.tenders?.total || 0})
                </span>
                <p className="text-[11px] text-[#4A5568]">
                  Tender cell procurement opportunities tagged to defence bases, police HQs, and public security in your territory.
                </p>
              </div>
              <Link href="/tenders">
                <Button size="sm" variant="outline" className="text-xs text-[#0F5E63]">
                  All GeM Bids <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
                </Button>
              </Link>
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tender Reference No.</TableHead>
                  <TableHead>Department / Buyer</TableHead>
                  <TableHead>Requirement Details</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Bid Closing Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Inspect</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data?.tenders?.regionalTendersList ?? []).slice((tenderPage - 1) * TENDER_PAGE_SIZE, tenderPage * TENDER_PAGE_SIZE).map((t: any) => {
                  const closing = t.bid_closing_date ? new Date(t.bid_closing_date) : null;
                  const diffDays = closing
                    ? Math.ceil((closing.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24))
                    : 0;

                  return (
                    <TableRow key={t.id}>
                      <TableCell className="font-bold text-[#14213D] whitespace-nowrap">
                        <span className="font-mono text-[#0F5E63]">{t.tender_no}</span>
                      </TableCell>
                      <TableCell className="text-[#14213D]">
                        <div className="font-semibold text-[#14213D]">{t.department || 'Government Buyer'}</div>
                        <div className="text-[10px] text-[#4A5568]">{t.city}, {t.state}</div>
                      </TableCell>
                      <TableCell className="text-[#4A5568] max-w-[240px] truncate">{t.requirement_text}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        <Badge variant="outline" size="sm" className="uppercase font-bold">
                          {t.category}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono whitespace-nowrap">
                        {closing ? closing.toLocaleDateString('en-IN') : '-'}
                        {diffDays <= 7 && diffDays >= 0 && (
                          <div className="text-[10px] font-bold text-red-600">
                            {diffDays === 0 ? 'CLOSING TODAY' : `${diffDays} DAYS LEFT`}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <Badge
                          variant={
                            t.status === 'won'
                              ? 'success'
                              : t.status === 'awaiting_approval'
                              ? 'warning'
                              : t.status === 'under_preparation'
                              ? 'default'
                              : 'outline'
                          }
                          size="sm"
                          className="uppercase font-bold"
                        >
                          {t.status.replace('_', ' ')}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        <Link href={`/tenders?highlight=${t.id}`}>
                          <Button size="sm" variant="secondary" className="shadow-xs text-xs">
                            Inspect <ChevronRight className="ml-1 h-3.5 w-3.5" />
                          </Button>
                        </Link>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {(() => {
              const list = data?.tenders?.regionalTendersList ?? [];
              const pages = Math.max(1, Math.ceil(list.length / TENDER_PAGE_SIZE));
              return (
                <div className="flex items-center justify-between gap-3 border-t border-[#ECE9E2] px-4 py-3 text-xs text-[#4A5568]">
                  <span>
                    Showing {list.length === 0 ? 0 : (tenderPage - 1) * TENDER_PAGE_SIZE + 1}–
                    {Math.min(tenderPage * TENDER_PAGE_SIZE, list.length)} of {data?.tenders?.total ?? list.length}
                    {(data?.tenders?.total ?? 0) > list.length ? ` (first ${list.length} loaded)` : ''}
                  </span>
                  <div className="flex items-center gap-2">
                    <Button size="xs" variant="secondary" disabled={tenderPage <= 1} onClick={() => setTenderPage((p) => p - 1)}>Prev</Button>
                    <span className="font-mono">{tenderPage} / {pages}</span>
                    <Button size="xs" variant="secondary" disabled={tenderPage >= pages} onClick={() => setTenderPage((p) => p + 1)}>Next</Button>
                  </div>
                </div>
              );
            })()}
          </Card>
        </div>
      )}

      {/* ── MODAL: EMPLOYEE EVIDENCE & BLOCKER INSPECTION ── */}
      <Modal
        isOpen={isEvidenceModalOpen}
        onClose={() => setIsEvidenceModalOpen(false)}
        title={selectedEmployee ? `${selectedEmployee.full_name} — Accountability Dossier` : 'Employee Evidence'}
        description="Delivery compliance, deadline performance, and active blockers for management review."
        maxWidth="lg"
      >
        {selectedEmployee && (
          <div className="space-y-4 text-xs">
            <div className="p-3.5 rounded-xl bg-[#FBFAF7] border border-[#DCD8CE] flex items-center justify-between">
              <div>
                <span className="text-sm font-bold text-[#14213D] block">{selectedEmployee.full_name}</span>
                <span className="text-[11px] text-[#4A5568] font-mono">{selectedEmployee.email} &bull; {selectedEmployee.role}</span>
              </div>
              <Badge
                variant={
                  selectedEmployee.complianceRating === 'Excellent'
                    ? 'success'
                    : selectedEmployee.complianceRating === 'Good'
                    ? 'default'
                    : selectedEmployee.complianceRating === 'Needs Attention'
                    ? 'warning'
                    : 'danger'
                }
                size="md"
              >
                {selectedEmployee.complianceRating.toUpperCase()}
              </Badge>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <div className="p-3 rounded-lg bg-white border border-[#DCD8CE] text-center">
                <span className="text-[10px] text-[#4A5568] uppercase font-bold block">Tasks Done</span>
                <span className="text-base font-extrabold text-[#14213D]">
                  {selectedEmployee.tasks.completed}/{selectedEmployee.tasks.total}
                </span>
              </div>
              <div className="p-3 rounded-lg bg-white border border-[#DCD8CE] text-center">
                <span className="text-[10px] text-[#4A5568] uppercase font-bold block">Overdue</span>
                <span className="text-base font-extrabold text-red-600">{selectedEmployee.tasks.overdue}</span>
              </div>
              <div className="p-3 rounded-lg bg-white border border-[#DCD8CE] text-center">
                <span className="text-[10px] text-[#4A5568] uppercase font-bold block">Visits Completed</span>
                <span className="text-base font-extrabold text-emerald-700">{selectedEmployee.visits.completed}</span>
              </div>
              <div className="p-3 rounded-lg bg-white border border-[#DCD8CE] text-center">
                <span className="text-[10px] text-[#4A5568] uppercase font-bold block">Pipeline (₹ L)</span>
                <span className="text-base font-extrabold text-[#0F5E63]">{formatLakh(selectedEmployee.leads.valueLakh || 0)}</span>
              </div>
            </div>

            <div className="space-y-2">
              <span className="font-bold text-[#14213D] block">Active Blockers & Escalations</span>
              {selectedEmployee.activeBlockers.length === 0 ? (
                <div className="p-3 text-center text-[#4A5568] bg-[#FBFAF7] rounded-lg border border-[#DCD8CE]">
                  No active blockers currently logged for this employee.
                </div>
              ) : (
                <div className="space-y-2 max-h-40 overflow-y-auto">
                  {selectedEmployee.activeBlockers.map((b: any) => (
                    <div key={b.id} className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-950">
                      <div className="font-bold flex items-center justify-between">
                        <span>{b.task_title || 'Assigned Task'}</span>
                        <Badge variant="warning" size="sm">{b.blocker_type}</Badge>
                      </div>
                      <p className="text-[11px] text-amber-800 mt-1">{b.description}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="p-3 rounded-lg bg-gray-50 border border-gray-200 text-[11px] text-gray-700">
              <strong>Evidence Summary:</strong> {selectedEmployee.evidenceNote}
              <div className="mt-1 text-[10px] text-gray-500">
                Notice: In accordance with corporate governance rules, performance evaluations and compensation adjustments remain the sole prerogative of Executive Management.
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <Button size="sm" variant="outline" onClick={() => setIsEvidenceModalOpen(false)}>
                Close Dossier
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* ── MODAL: MANAGER INTERVENTION ("ALSO MEET / ADD STOP") ── */}
      <Modal
        isOpen={isInterventionModalOpen}
        onClose={() => setIsInterventionModalOpen(false)}
        title="Regional Manager Trip Intervention"
        description="Attach an imperative stop or stakeholder meeting to the salesperson's field visit itinerary."
        maxWidth="md"
      >
        <form onSubmit={handleSaveIntervention} className="space-y-4 text-xs">
          {actionError && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
              {actionError}
            </div>
          )}

          {selectedVisit && (
            <div className="p-3 rounded-lg bg-[#FBFAF7] border border-[#DCD8CE] space-y-1">
              <div className="font-bold text-[#14213D]">{selectedVisit.organisation_name}</div>
              <div className="text-[11px] text-[#4A5568]">
                Planned Date: {new Date(selectedVisit.planned_date).toLocaleDateString('en-IN')} &bull; Rep: {selectedVisit.assigned_rep_name}
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-[#14213D] mb-1">
              Manager Directive Instructions (e.g. &quot;Also meet Col. Bhatia in Procurement&quot;)
            </label>
            <textarea
              required
              rows={3}
              value={interventionInstructions}
              onChange={(e) => setInterventionInstructions(e.target.value)}
              placeholder="Specify the person to meet, additional enquiry, or critical quotation discussion..."
              className="w-full rounded-lg border border-[#DCD8CE] bg-white p-2.5 text-xs text-[#14213D] focus:border-[#3770E3] focus:outline-none shadow-xs"
            />
          </div>

          <div className="pt-2 flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setIsInterventionModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" isLoading={isSubmittingIntervention}>
              <Send className="mr-1.5 h-3.5 w-3.5" />
              <span>Dispatch Intervention Directive</span>
            </Button>
          </div>
        </form>
      </Modal>
    </PageContainer>
  );
}
