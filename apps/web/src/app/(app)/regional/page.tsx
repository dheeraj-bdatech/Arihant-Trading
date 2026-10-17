'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
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
  Building,
  UserCheck,
  Shield,
  ShieldAlert,
  Search,
  Filter,
  Plus,
  Send,
  Sparkles,
  Award,
  LayoutList,
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
  FilterMenu,
  Modal,
  Input,
  Select,
  PageContainer,
  PageHeader,
  StatCard,
  StatGrid, PageLoader,
  RecordViews,
  rowDetails,
  toneFor,
  type BoardLane,
  type RecordItem,
  type RecordTone } from '@/components/ui';
import { formatLakh, formatINR, TENDER_STATUSES } from '@arihant/shared';
import { NewTaskButton } from '../tasks/_lib/NewTaskModal';

const formatLeadCategory = (category?: string) => {
  if (!category) return 'New Lead';
  const c = category.toLowerCase().trim();
  if (c === 'new_lead' || c === 'new') return 'New Lead';
  if (c === 'follow_up' || c === 'follow-up') return 'Follow-up';
  if (c === 'active') return 'Active';
  if (c === 'expected') return 'Expected';
  return category.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
};

/** Lead category → lane key (the funnel buckets this view already shows). */
const leadCategoryKey = (category?: string): string => {
  const c = category?.toLowerCase().trim();
  if (!c || c === 'new_lead' || c === 'new') return 'new_lead';
  if (c === 'follow_up' || c === 'follow-up') return 'follow_up';
  return c;
};

const getCategoryTone = (category?: string): RecordTone => {
  const c = leadCategoryKey(category);
  if (c === 'new_lead') return 'info';
  if (c === 'active') return 'success';
  if (c === 'expected') return 'warning';
  return 'neutral';
};

const pretty = (s?: string | null) => {
  const t = String(s || '').replace(/_/g, ' ').trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : '—';
};

/** Maps rows to RecordItems and remembers each record's lane. */
function register<T>(list: T[], toItem: (row: T) => RecordItem, laneKey: (row: T) => string) {
  const lanes = new Map<string, string>();
  const items = list.map((row) => {
    const item = toItem(row);
    lanes.set(item.key, laneKey(row));
    return item;
  });
  return { items, laneOf: (item: RecordItem) => lanes.get(item.key) ?? 'other' };
}

const RATING_TONE: Record<string, RecordTone> = { Critical: 'danger', 'Needs Attention': 'warning', Good: 'info', Excellent: 'success' };
const TEAM_LANES: BoardLane[] = [
  { key: 'Critical', label: 'Critical', tone: 'danger' },
  { key: 'Needs Attention', label: 'Needs attention', tone: 'warning' },
  { key: 'Good', label: 'Good', tone: 'info' },
  { key: 'Excellent', label: 'Excellent', tone: 'success' },
];
const LEAD_LANES: BoardLane[] = [
  { key: 'new_lead', label: 'New Lead', tone: 'info' },
  { key: 'follow_up', label: 'Follow-up', tone: 'neutral' },
  { key: 'active', label: 'Active', tone: 'success' },
  { key: 'expected', label: 'Expected', tone: 'warning' },
  { key: 'other', label: 'Other', tone: 'neutral' },
];
const LEAD_CLOSED = ['converted', 'won', 'lost', 'dropped'];
const VISIT_STATUSES = ['planned', 'modified', 'rescheduled', 'completed', 'not_completed', 'cancelled'];
const VISIT_LANES: BoardLane[] = [...VISIT_STATUSES, 'other'].map((k) => ({ key: k, label: pretty(k), tone: toneFor(k) }));
const VISIT_DONE = ['completed', 'not_completed', 'cancelled'];
const TENDER_LANES: BoardLane[] = [...TENDER_STATUSES, 'other'].map((k) => ({ key: k, label: pretty(k), tone: toneFor(k) }));
/** Bid closing date only drives urgency while the bid is still being prepared. */
const TENDER_PRE_SUBMISSION = ['identified', 'awaiting_approval', 'under_preparation', 'on_hold'];

export default function RegionalPage() {
  const { user, hasRole } = useAuth();
  const router = useRouter();
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
  const employeeQuery = searchEmployee.toLowerCase();
  const filteredTeam: any[] = (data?.teamPerformance ?? []).filter(
    (emp: any) =>
      !employeeQuery ||
      emp.full_name.toLowerCase().includes(employeeQuery) ||
      emp.email.toLowerCase().includes(employeeQuery) ||
      emp.region_name.toLowerCase().includes(employeeQuery),
  );
  const zoneCode = data?.zone?.code || 'N';

  const openEvidence = (emp: any) => {
    setSelectedEmployee(emp);
    setIsEvidenceModalOpen(true);
  };

  // Rep scorecard: worst compliance first, so the cards lead with who needs attention.
  const teamRegister = register(
    [...filteredTeam].sort((a, b) => TEAM_LANES.findIndex((l) => l.key === a.complianceRating) - TEAM_LANES.findIndex((l) => l.key === b.complianceRating)),
    (emp: any): RecordItem => ({
      key: emp.id,
      code: emp.role.replace('_', ' ').toUpperCase(),
      title: emp.full_name,
      subtitle: emp.region_name,
      status: { label: emp.complianceRating, tone: RATING_TONE[emp.complianceRating] ?? toneFor(emp.complianceRating) },
      badges: [
        ...(emp.tasks.overdue > 0 ? [{ label: `${emp.tasks.overdue} overdue`, tone: 'danger' as const }] : []),
        ...(emp.activeBlockers.length > 0 ? [{ label: `${emp.activeBlockers.length} blocked`, tone: 'warning' as const }] : []),
      ],
      value: formatLakh(emp.leads.valueLakh || 0),
      facts: [
        { label: 'Milestones', value: `${emp.tasks.completed} / ${emp.tasks.total} · ${emp.tasks.completionRate}%` },
        { label: 'Visits', value: `${emp.visits.completed} / ${emp.visits.total}` },
        { label: 'Overdue', value: emp.tasks.overdue },
        { label: 'Blockers', value: emp.activeBlockers.length || 'None' },
      ],
      primary: { label: 'Inspect', onClick: () => openEvidence(emp) },
      onOpen: () => openEvidence(emp),
    }),
    (emp: any) => emp.complianceRating,
  );

  const leadRegister = register(
    data?.sales?.recentLeads ?? [],
    (ld: any): RecordItem => ({
      key: ld.id,
      title: ld.organisation_name,
      subtitle: [ld.city || 'North Zone', ld.product_name || 'Security Scanning Hardware'].join(' · '),
      status: { label: formatLeadCategory(ld.category), tone: getCategoryTone(ld.category) },
      badges: ld.probability
        ? [{ label: `${ld.probability} probability`, tone: ld.probability === 'high' ? 'success' : ld.probability === 'medium' ? 'warning' : 'neutral' }]
        : [],
      due: { date: ld.next_followup_date, label: 'Follow-up', done: LEAD_CLOSED.includes(String(ld.status || '').toLowerCase()) },
      value: formatLakh(ld.value_lakh || 0),
      owner: ld.assigned_rep_name || 'Territory Rep',
      facts: [
        { label: 'Product', value: ld.product_name || 'Security Scanning Hardware' },
        { label: 'Lead status', value: pretty(ld.status) },
      ],
      details: rowDetails(ld),
    }),
    (ld: any) => {
      const k = leadCategoryKey(ld.category);
      return LEAD_LANES.some((l) => l.key === k) ? k : 'other';
    },
  );

  const visitRegister = register(
    data?.visits?.recentVisits ?? [],
    (v: any): RecordItem => ({
      key: v.id,
      title: v.organisation_name,
      subtitle: v.location || 'Client HQ',
      status: { label: pretty(v.status), tone: toneFor(v.status) },
      due: { date: v.planned_date, label: 'Planned', done: VISIT_DONE.includes(v.status) },
      owner: v.assigned_rep_name || 'Territory Rep',
      facts: [
        { label: 'Purpose', value: v.purpose || 'Technical brief' },
        { label: 'Manager directive', value: v.remarks || 'None attached' },
      ],
      primary: { label: 'Add Stop / Also Meet', onClick: () => handleOpenIntervention(v) },
      details: rowDetails(v),
    }),
    (v: any) => (VISIT_STATUSES.includes(v.status) ? v.status : 'other'),
  );

  const tenderRegister = register(
    // grows by TENDER_PAGE_SIZE as the register scrolls (infinite scroll over the loaded list)
    (data?.tenders?.regionalTendersList ?? []).slice(0, tenderPage * TENDER_PAGE_SIZE),
    (t: any): RecordItem => ({
      key: t.id,
      code: t.tender_no,
      title: t.department || 'Government Buyer',
      subtitle: [t.city, t.state].filter(Boolean).join(', ') || undefined,
      status: { label: pretty(t.status), tone: toneFor(t.status) },
      badges: t.category ? [{ label: String(t.category).replace(/_/g, ' ').toUpperCase(), tone: 'neutral' }] : [],
      due: { date: t.bid_closing_date, label: 'Closes', done: !TENDER_PRE_SUBMISSION.includes(t.status) },
      facts: [
        { label: 'Requirement', value: t.requirement_text || '—' },
        { label: 'Category', value: String(t.category || '—').replace(/_/g, ' ').toUpperCase() },
      ],
      primary: { label: 'Open in Tenders', onClick: () => router.push(`/tenders?highlight=${t.id}`) },
      details: rowDetails(t),
    }),
    (t: any) => ((TENDER_STATUSES as string[]).includes(t.status) ? t.status : 'other'),
  );

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

            <NewTaskButton variant="primary" size="sm" leftIcon={<Plus className="h-4 w-4" />}>
              Assign Task
            </NewTaskButton>
          </>
        }
      />

      {/* ── 4 KEY ACCENT METRIC HUD CARDS ── */}
      <StatGrid cols={4} className="gap-3">
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

      {/* ── One filter row: View switcher first, then the search for views that have one. ── */}
      <Card padding="sm" className="relative z-20 overflow-visible border-[#DCD8CE]">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
          <FilterMenu
            label="View"
            icon={<LayoutList />}
            neutralKeys={[]}
            className="shrink-0"
            options={[
              { key: 'team', label: 'Team Accountability', icon: <Users />, count: data?.teamPerformance?.length || 0 },
              { key: 'leads', label: 'Sales Leads & Funnel', icon: <Target />, count: data?.sales?.totalLeads || 0 },
              { key: 'visits', label: 'Tours & Visits', icon: <Calendar />, count: data?.visits?.total || 0 },
              { key: 'tenders', label: 'GeM Tenders', icon: <FileText />, count: data?.tenders?.total || 0 },
            ].map((v) => ({ ...v, active: activeTab === v.key, onSelect: () => setActiveTab(v.key) }))}
          />
          {activeTab === 'team' && (
            <>
              <div className="relative w-full min-w-[200px] lg:w-auto lg:flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8A8578]" aria-hidden />
                <input
                  type="search"
                  aria-label="Search representatives"
                  placeholder="Search rep by name, territory, email…"
                  value={searchEmployee}
                  onChange={(e) => setSearchEmployee(e.target.value)}
                  className="h-9 w-full rounded-lg border border-[#C9C4B8] bg-white pl-9 pr-3 text-xs text-[#14213D] placeholder:text-[#8A8578] focus:border-[#0F5E63] focus:outline-none focus:ring-2 focus:ring-[#0F5E63]/15"
                />
              </div>
              {searchEmployee && (
                <div className="flex flex-wrap items-center gap-2 lg:flex-nowrap">
                  <Button variant="ghost" size="xs" onClick={() => setSearchEmployee('')} className="text-xs text-[#4A5568] hover:text-[#881337]">
                    Clear
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </Card>

      {/* ── TAB 1: EMPLOYEE ACCOUNTABILITY & PERFORMANCE ── */}
      {activeTab === 'team' && (
        <div className="space-y-4">
          <h2 className="flex items-center gap-2 font-serif text-sm font-bold text-[#14213D]">
            <Users className="h-4 w-4 text-[#0F5E63]" />
            Direct Reports &amp; Regional Staff Scorecard
          </h2>
          <RecordViews
            storageKey="regional-team"
            items={teamRegister.items}
            lanes={TEAM_LANES}
            laneOf={teamRegister.laneOf}
            summary={
              <span className="font-mono text-xs">
                {filteredTeam.length} {filteredTeam.length === 1 ? 'rep' : 'reps'}
              </span>
            }
            empty={searchEmployee ? 'No representatives match this search.' : 'No representatives in this territory yet.'}
          />

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
            <div className="p-4 bg-[#FBFAF7] flex items-center justify-between">
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
          </Card>

          <RecordViews
            storageKey="regional-leads"
            items={leadRegister.items}
            lanes={LEAD_LANES}
            laneOf={leadRegister.laneOf}
            summary={`${leadRegister.items.length} recent ${leadRegister.items.length === 1 ? 'opportunity' : 'opportunities'}`}
            empty="No opportunities logged in this territory yet."
          />
        </div>
      )}

      {/* ── TAB 3: FIELD VISITS & TOUR PLANNING ── */}
      {activeTab === 'visits' && (
        <div className="space-y-4">
          <Card>
            <div className="p-4 bg-[#FBFAF7] flex items-center justify-between">
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
          </Card>

          <RecordViews
            storageKey="regional-visits"
            items={visitRegister.items}
            lanes={VISIT_LANES}
            laneOf={visitRegister.laneOf}
            hideEmptyLanes
            summary={`${visitRegister.items.length} recent ${visitRegister.items.length === 1 ? 'visit' : 'visits'}`}
            empty="No field visits logged in this territory yet."
          />
        </div>
      )}

      {/* ── TAB 4: TERRITORY GeM TENDERS ── */}
      {activeTab === 'tenders' && (
        <div className="space-y-4">
          <Card>
            <div className="p-4 bg-[#FBFAF7] flex items-center justify-between">
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
          </Card>

          {(() => {
            const list = data?.tenders?.regionalTendersList ?? [];
            return (
              <RecordViews
                storageKey="regional-tenders"
                items={tenderRegister.items}
                lanes={TENDER_LANES}
                laneOf={tenderRegister.laneOf}
                hideEmptyLanes
                summary={
                  <span>
                    {tenderRegister.items.length} of {data?.tenders?.total ?? list.length}
                    {(data?.tenders?.total ?? 0) > list.length ? ` (first ${list.length} loaded)` : ''}
                  </span>
                }
                empty="No GeM bids tagged to this territory."
                onLoadMore={() => setTenderPage((p) => p + 1)}
                hasMore={tenderRegister.items.length < list.length}
              />
            );
          })()}
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
            <div className="p-3.5 rounded-xl bg-[#FBFAF7] border border-[#DCD8CE] flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <span className="text-sm font-bold text-[#14213D] block">{selectedEmployee.full_name}</span>
                <span className="text-[11px] text-[#4A5568] font-mono break-all">{selectedEmployee.email} &bull; {selectedEmployee.role}</span>
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
