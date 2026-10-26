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
  MapPin,
  ChevronRight,
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
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
  RecordTable,
  RecordViews,
  formatDateIN,
  daysFromToday,
  rowDetails,
  toneFor,
  type BadgeProps,
  type BoardLane,
  type RecordItem,
  type RecordTone } from '@/components/ui';
import { formatLakh, formatINR, TENDER_STATUSES, isClosedLeadStatus } from '@arihant/shared';
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

const RATING_TONE: Record<string, RecordTone> = { Critical: 'danger', 'Needs Attention': 'warning', Good: 'info', Excellent: 'success', 'No data': 'neutral' };
const TEAM_LANES: BoardLane[] = [
  { key: 'Critical', label: 'Critical', tone: 'danger' },
  { key: 'Needs Attention', label: 'Needs attention', tone: 'warning' },
  { key: 'Good', label: 'Good', tone: 'info' },
  { key: 'Excellent', label: 'Excellent', tone: 'success' },
  { key: 'No data', label: 'No data', tone: 'neutral' },
];
const LEAD_LANES: BoardLane[] = [
  { key: 'new_lead', label: 'New Lead', tone: 'info' },
  { key: 'follow_up', label: 'Follow-up', tone: 'neutral' },
  { key: 'active', label: 'Active', tone: 'success' },
  { key: 'expected', label: 'Expected', tone: 'warning' },
  { key: 'other', label: 'Other', tone: 'neutral' },
];
const VISIT_STATUSES = ['planned', 'modified', 'rescheduled', 'completed', 'not_completed', 'cancelled'];
const VISIT_LANES: BoardLane[] = [...VISIT_STATUSES, 'other'].map((k) => ({ key: k, label: pretty(k), tone: toneFor(k) }));
const VISIT_DONE = ['completed', 'not_completed', 'cancelled'];
const TENDER_LANES: BoardLane[] = [...TENDER_STATUSES, 'other'].map((k) => ({ key: k, label: pretty(k), tone: toneFor(k) }));
/** Bid closing date only drives urgency while the bid is still being prepared. */
const TENDER_PRE_SUBMISSION = ['identified', 'awaiting_approval', 'under_preparation', 'on_hold'];

type BadgeVariant = NonNullable<BadgeProps['variant']>;
const RATING_BADGE: Record<string, BadgeVariant> = { Excellent: 'success', Good: 'default', 'Needs Attention': 'warning', 'No data': 'outline' };
/** Completion % or "No data" when nothing was assigned (the API sends null, never a fake 100%). */
const pctOrNoData = (rate: number | null | undefined) => (rate === null || rate === undefined ? 'No data' : `${rate}%`);
const ratingBadge = (rating: string): BadgeVariant => RATING_BADGE[rating] ?? 'danger';
const categoryBadge = (category?: string): BadgeVariant => {
  const tone = getCategoryTone(category);
  return tone === 'neutral' ? 'default' : tone;
};
const probabilityBadge = (p?: string): BadgeVariant => (p === 'high' ? 'success' : p === 'medium' ? 'warning' : 'default');
const visitBadge = (status?: string): BadgeVariant => (status === 'completed' ? 'success' : status === 'planned' ? 'default' : 'warning');
const tenderBadge = (status?: string): BadgeVariant =>
  status === 'won' ? 'success' : status === 'awaiting_approval' ? 'warning' : status === 'under_preparation' ? 'default' : 'outline';
const upperLabel = (s?: string | null) => String(s || '—').replace(/_/g, ' ');

export default function RegionalPage() {
  const { user, hasRole } = useAuth();
  const router = useRouter();
  const [data, setData] = useState<any | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('team');
  const [tenderPage, setTenderPage] = useState(1);
  const TENDER_PAGE_SIZE = 15;
  const [selectedZoneId, setSelectedZoneId] = useState<string>('');
  const [selectedRegionId, setSelectedRegionId] = useState<string>('');
  const [searchEmployee, setSearchEmployee] = useState('');

  // Modals
  const [selectedEmployee, setSelectedEmployee] = useState<any | null>(null);
  const [isEvidenceModalOpen, setIsEvidenceModalOpen] = useState(false);
  const [selectedVisit, setSelectedVisit] = useState<any | null>(null);
  const [isInterventionModalOpen, setIsInterventionModalOpen] = useState(false);
  const [interventionInstructions, setInterventionInstructions] = useState('');
  const [isSubmittingIntervention, setIsSubmittingIntervention] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const fetchRegionalData = async (zoneId?: string, regionId?: string) => {
    try {
      setIsLoading(true);
      const params: any = {};
      if (zoneId) {
        params.zone_id = zoneId;
      }
      if (regionId) {
        params.region_id = regionId;
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
      fetchRegionalData(selectedZoneId || undefined, selectedRegionId || undefined);
    }
  }, [selectedZoneId, selectedRegionId]);

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
      await fetchRegionalData(selectedZoneId || undefined, selectedRegionId || undefined);
    } catch (err: any) {
      setActionError(err.message || 'Failed to submit manager intervention.');
    } finally {
      setIsSubmittingIntervention(false);
    }
  };

  if (!hasRole(['regional_manager', 'management', 'admin'])) {
    return (
      <div className="p-12 text-center text-[#4A5568] bg-white border border-[#DCD8CE] rounded-xl space-y-3 shadow-xs">
        <ShieldAlert className="h-12 w-12 text-[#881337] mx-auto" />
        <h2 className="text-lg font-bold text-[#14213D]">Access Restricted</h2>
        <p className="text-xs">
          Only Regional Managers, Executive Management, and System Administrators have permission to access the Regional Command Hub.
        </p>
      </div>
    );
  }

  const zoneName = data?.zone?.name || '—';
  const employeeQuery = searchEmployee.toLowerCase();
  const filteredTeam: any[] = (data?.teamPerformance ?? []).filter(
    (emp: any) =>
      !employeeQuery ||
      emp.full_name.toLowerCase().includes(employeeQuery) ||
      emp.email.toLowerCase().includes(employeeQuery) ||
      emp.region_name.toLowerCase().includes(employeeQuery),
  );
  const zoneCode = data?.zone?.code || '—';
  const tendersDecided = (data?.tenders?.won ?? 0) + (data?.tenders?.lost ?? 0);
  // won ÷ (won + lost); "—" while nothing has been decided
  const winRate: number | null = tendersDecided > 0 ? Math.round(((data?.tenders?.won ?? 0) / tendersDecided) * 100) : null;

  const openEvidence = (emp: any) => {
    setSelectedEmployee(emp);
    setIsEvidenceModalOpen(true);
  };

  // Rep scorecard: worst compliance first, so the list leads with who needs attention.
  const team = [...filteredTeam].sort(
    (a, b) => TEAM_LANES.findIndex((l) => l.key === a.complianceRating) - TEAM_LANES.findIndex((l) => l.key === b.complianceRating),
  );
  const teamRegister = register(
    team,
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
        { label: 'Milestones', value: `${emp.tasks.completed} / ${emp.tasks.total} · ${pctOrNoData(emp.tasks.completionRate)}` },
        { label: 'Visits', value: `${emp.visits.completed} / ${emp.visits.total}` },
        { label: 'Overdue', value: emp.tasks.overdue },
        { label: 'Blockers', value: emp.activeBlockers.length || 'None' },
      ],
      primary: { label: 'Inspect', onClick: () => openEvidence(emp) },
      onOpen: () => openEvidence(emp),
    }),
    (emp: any) => emp.complianceRating,
  );

  const teamList = team.length ? (
    <RecordTable items={teamRegister.items}>
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
          {team.map((emp: any) => (
            <TableRow key={emp.id}>
              <TableCell className="font-bold text-[#14213D] whitespace-nowrap">
                {emp.full_name}
                <div className="text-[10px] text-[#4A5568] font-mono font-normal">{emp.email}</div>
              </TableCell>
              <TableCell className="whitespace-nowrap">
                <span className="font-semibold text-[#14213D] text-xs">{emp.role.replace('_', ' ').toUpperCase()}</span>
                <div className="text-[10px] text-[#4A5568]">{emp.region_name}</div>
              </TableCell>
              <TableCell className="text-center whitespace-nowrap">
                <span className="font-mono font-bold text-[#14213D]">
                  {emp.tasks.completed} / {emp.tasks.total}
                </span>
                <div className="text-[10px] text-[#4A5568]">{pctOrNoData(emp.tasks.completionRate)}</div>
              </TableCell>
              <TableCell className="text-center whitespace-nowrap">
                {emp.tasks.overdue > 0 ? (
                  <span className="text-[11px] font-bold text-[#881337] bg-[#FCE8EC] px-2 py-0.5 rounded">{emp.tasks.overdue}</span>
                ) : (
                  <span className="text-[11px] text-[#0B4A4E] font-medium">0</span>
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
                  <span className="px-2 py-0.5 rounded-full bg-[#FBEBDD] text-[#7C2D12] font-bold text-[10px]">
                    {emp.activeBlockers.length} BLOCKED
                  </span>
                ) : (
                  <span className="text-[11px] text-[#4A5568]">None</span>
                )}
              </TableCell>
              <TableCell className="text-center whitespace-nowrap">
                <Badge variant={ratingBadge(emp.complianceRating)} size="sm">
                  {emp.complianceRating.toUpperCase()}
                </Badge>
              </TableCell>
              <TableCell className="text-right whitespace-nowrap">
                <Button size="sm" variant="secondary" onClick={() => openEvidence(emp)} className="shadow-xs text-xs text-[#0F5E63]">
                  <span>Inspect</span>
                  <ChevronRight className="ml-1 h-3.5 w-3.5" />
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </RecordTable>
  ) : undefined;

  const leadRegister = register(
    data?.sales?.recentLeads ?? [],
    (ld: any): RecordItem => ({
      key: ld.id,
      title: ld.organisation_name,
      subtitle: [ld.city || '—', ld.product_name || '—'].join(' · '),
      status: { label: formatLeadCategory(ld.category), tone: getCategoryTone(ld.category) },
      badges: ld.probability
        ? [{ label: `${ld.probability} probability`, tone: ld.probability === 'high' ? 'success' : ld.probability === 'medium' ? 'warning' : 'neutral' }]
        : [],
      due: { date: ld.next_followup_date, label: 'Follow-up', done: isClosedLeadStatus(ld.status) },
      value: formatLakh(ld.value_lakh || 0),
      owner: ld.assigned_rep_name || '—',
      facts: [
        { label: 'Product', value: ld.product_name || '—' },
        { label: 'Lead status', value: pretty(ld.status) },
      ],
      details: rowDetails(ld),
    }),
    (ld: any) => {
      const k = leadCategoryKey(ld.category);
      return LEAD_LANES.some((l) => l.key === k) ? k : 'other';
    },
  );

  const leads: any[] = data?.sales?.recentLeads ?? [];
  const leadList = leads.length ? (
    <RecordTable items={leadRegister.items}>
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
          {leads.map((ld: any) => (
            <TableRow key={ld.id}>
              <TableCell className="font-bold text-[#14213D]">
                {ld.organisation_name}
                <div className="text-[10px] text-[#4A5568] font-normal">{ld.city || '—'}</div>
              </TableCell>
              <TableCell className="text-[#14213D]">{ld.product_name || '—'}</TableCell>
              <TableCell>
                <Badge variant={categoryBadge(ld.category)} size="sm" className="font-semibold">
                  {formatLeadCategory(ld.category)}
                </Badge>
              </TableCell>
              <TableCell>
                {ld.probability ? (
                  <Badge variant={probabilityBadge(ld.probability)} size="sm" className="uppercase font-bold">
                    {ld.probability}
                  </Badge>
                ) : (
                  <span className="text-[#4A5568]">-</span>
                )}
              </TableCell>
              <TableCell className="text-right font-mono font-bold text-[#0F5E63]">{formatLakh(ld.value_lakh || 0)}</TableCell>
              <TableCell className="text-[#4A5568]">{ld.assigned_rep_name || '—'}</TableCell>
              <TableCell className="font-mono text-[#4A5568]">{formatDateIN(ld.next_followup_date)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </RecordTable>
  ) : undefined;

  const visitRegister = register(
    data?.visits?.recentVisits ?? [],
    (v: any): RecordItem => ({
      key: v.id,
      title: v.organisation_name,
      subtitle: v.location || '—',
      status: { label: pretty(v.status), tone: toneFor(v.status) },
      due: { date: v.planned_date, label: 'Planned', done: VISIT_DONE.includes(v.status) },
      owner: v.assigned_rep_name || '—',
      facts: [
        { label: 'Purpose', value: v.purpose || '—' },
        { label: 'Manager directive', value: v.remarks || 'None attached' },
      ],
      primary: { label: 'Add Stop / Also Meet', onClick: () => handleOpenIntervention(v) },
      details: rowDetails(v),
    }),
    (v: any) => (VISIT_STATUSES.includes(v.status) ? v.status : 'other'),
  );

  const visits: any[] = data?.visits?.recentVisits ?? [];
  const visitList = visits.length ? (
    <RecordTable items={visitRegister.items}>
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
          {visits.map((v: any) => (
            <TableRow key={v.id}>
              <TableCell className="font-mono font-bold text-[#14213D] whitespace-nowrap">{formatDateIN(v.planned_date)}</TableCell>
              <TableCell className="font-bold text-[#14213D]">
                {v.organisation_name}
                <div className="text-[10px] text-[#4A5568] font-normal flex items-center gap-1">
                  <MapPin className="h-3 w-3 text-[#0F5E63]" />
                  <span>{v.location || '—'}</span>
                </div>
              </TableCell>
              <TableCell className="text-[#14213D] max-w-[200px] truncate" title={v.purpose || undefined}>
                {v.purpose || '—'}
              </TableCell>
              <TableCell className="text-[#4A5568] whitespace-nowrap">{v.assigned_rep_name || '—'}</TableCell>
              <TableCell className="whitespace-nowrap">
                <Badge variant={visitBadge(v.status)} size="sm" className="uppercase font-bold">
                  {upperLabel(v.status)}
                </Badge>
              </TableCell>
              <TableCell className="text-[#4A5568] max-w-[180px] truncate" title={v.remarks || undefined}>
                {v.remarks ? <span className="text-[#14213D] font-medium">{v.remarks}</span> : <span className="text-[#7D92B5]">None attached</span>}
              </TableCell>
              <TableCell className="text-right whitespace-nowrap">
                <Button size="sm" variant="ghost" onClick={() => handleOpenIntervention(v)} className="text-xs text-[#0F5E63] hover:bg-[#E3EFEE]">
                  + Add Stop / Also Meet
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </RecordTable>
  ) : undefined;

  // grows by TENDER_PAGE_SIZE as the register scrolls (infinite scroll over the loaded list)
  const tenders: any[] = (data?.tenders?.regionalTendersList ?? []).slice(0, tenderPage * TENDER_PAGE_SIZE);
  const tenderRegister = register(
    tenders,
    (t: any): RecordItem => ({
      key: t.id,
      code: t.tender_no,
      title: t.department || '—',
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

  const tenderList = tenders.length ? (
    <RecordTable items={tenderRegister.items}>
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
          {tenders.map((t: any) => {
            const daysLeft = TENDER_PRE_SUBMISSION.includes(t.status) ? daysFromToday(t.bid_closing_date) : null;
            return (
              <TableRow key={t.id}>
                <TableCell className="font-bold text-[#14213D] whitespace-nowrap">
                  <span className="font-mono text-[#0F5E63]">{t.tender_no}</span>
                </TableCell>
                <TableCell className="text-[#14213D]">
                  <div className="font-semibold text-[#14213D]">{t.department || '—'}</div>
                  <div className="text-[10px] text-[#4A5568]">{[t.city, t.state].filter(Boolean).join(', ')}</div>
                </TableCell>
                <TableCell className="text-[#4A5568] max-w-[240px] truncate" title={t.requirement_text || undefined}>
                  {t.requirement_text || '-'}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {t.category ? (
                    <Badge variant="outline" size="sm" className="uppercase font-bold">
                      {upperLabel(t.category)}
                    </Badge>
                  ) : (
                    <span className="text-[#4A5568]">-</span>
                  )}
                </TableCell>
                <TableCell className="font-mono whitespace-nowrap">
                  {formatDateIN(t.bid_closing_date)}
                  {daysLeft !== null && daysLeft >= 0 && daysLeft <= 7 && (
                    <div className="text-[10px] font-bold text-[#881337]">{daysLeft === 0 ? 'CLOSING TODAY' : `${daysLeft} DAYS LEFT`}</div>
                  )}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  <Badge variant={tenderBadge(t.status)} size="sm" className="uppercase font-bold">
                    {upperLabel(t.status)}
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
    </RecordTable>
  ) : undefined;

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
                  onChange={(e) => { setSelectedZoneId(e.target.value); setSelectedRegionId(''); setTenderPage(1); }}
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

            {/* Region filter: narrows every figure on this page to one region of the zone in view */}
            {(data?.regionsInZone?.length ?? 0) > 0 && (
              <div className="flex items-center space-x-2 bg-[#FBFAF7] border border-[#DCD8CE] px-3 py-1 rounded-lg text-xs">
                <span className="text-[10px] font-bold uppercase text-[#4A5568]">Region:</span>
                <Select
                  value={selectedRegionId}
                  onChange={(e) => { setSelectedRegionId(e.target.value); setTenderPage(1); }}
                  className="h-8 border-0 bg-transparent text-xs font-bold text-[#0F5E63] focus:ring-0 p-0"
                >
                  <option value="">All regions</option>
                  {data.regionsInZone.map((r: any) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </Select>
              </div>
            )}

            <Link href="/regional/performance">
              <Button variant="secondary" size="sm">
                <TrendingUp className="mr-2 h-4 w-4 text-[#0F5E63]" />
                <span>Performance</span>
              </Button>
            </Link>

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
          subtext={`${data?.tenders?.closingSoon ?? 0} Closing ≤ 7 Days • ${data?.tenders?.awaitingApproval ?? 0} Signoff • ${data?.tenders?.won ?? 0} Won / ${data?.tenders?.lost ?? 0} Lost (${winRate === null ? '—' : `${winRate}%`} Win)`}
        />
        <StatCard
          title="Field Client Visits"
          value={`${data?.visits?.completed ?? 0} / ${data?.visits?.total ?? 0}`}
          icon={<Calendar size={16} />}
          variant="emerald"
          subtext={`${data?.visits?.completionRate == null ? '—' : `${data.visits.completionRate}%`} Delivery Rate • ${data?.visits?.planned ?? 0} Upcoming • ${data?.visits?.cancelled ?? 0} Cancelled`}
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
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6B7280]" aria-hidden />
                <input
                  type="search"
                  aria-label="Search representatives"
                  placeholder="Search rep by name, territory, email…"
                  value={searchEmployee}
                  onChange={(e) => setSearchEmployee(e.target.value)}
                  className="h-9 w-full rounded-lg border border-[#C9C4B8] bg-white pl-9 pr-3 text-xs text-[#14213D] placeholder:text-[#6B7280] focus:border-[#0F5E63] focus:outline-none focus:ring-2 focus:ring-[#0F5E63]/15"
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
            defaultView="list"
            list={teamList}
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
              <span className="text-xl font-extrabold text-[#0B4A4E]">
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
              <span className="text-xl font-extrabold text-[#7C2D12]">
                {formatLakh(data?.sales?.lowProbValueLakh || 0)}
              </span>
              <span className="text-[11px] text-[#4A5568] block mt-1">Initial Engagement & Calls</span>
            </div>
          </div>

          <Card>
            <div className="p-4 bg-[#FBFAF7] flex items-center justify-between">
              <div>
                <span className="text-xs font-bold text-[#14213D]">
                  Active Territory Opportunities in {zoneName} Zone ({data?.sales?.totalLeads || 0})
                </span>
                <p className="text-[11px] text-[#4A5568]">
                  Live sales pipeline value: <strong>{formatLakh(data?.sales?.totalPipelineValueLakh || 0)}</strong> across key security accounts.
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
            defaultView="list"
            list={leadList}
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
            defaultView="list"
            list={visitList}
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
                defaultView="list"
                list={tenderList}
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
                variant={ratingBadge(selectedEmployee.complianceRating)}
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
                <span className="text-base font-extrabold text-[#881337]">{selectedEmployee.tasks.overdue}</span>
              </div>
              <div className="p-3 rounded-lg bg-white border border-[#DCD8CE] text-center">
                <span className="text-[10px] text-[#4A5568] uppercase font-bold block">Visits Completed</span>
                <span className="text-base font-extrabold text-[#0B4A4E]">{selectedEmployee.visits.completed}</span>
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
                    <div key={b.id} className="p-2.5 rounded-lg bg-[#FFF8EB] border border-[#E9C9B4] text-xs text-[#7C2D12]">
                      <div className="font-bold flex items-center justify-between">
                        <span>{b.task_title || 'Assigned Task'}</span>
                        <Badge variant="warning" size="sm">{b.blocker_type}</Badge>
                      </div>
                      <p className="text-[11px] text-[#7C2D12] mt-1">{b.description}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="p-3 rounded-lg bg-[#FBFAF7] border border-[#DCD8CE] text-[11px] text-[#14213D]">
              <strong>Evidence Summary:</strong> {selectedEmployee.evidenceNote}
              <div className="mt-1 text-[10px] text-[#4A5568]">
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
            <div className="p-3 rounded-lg bg-[#FCE8EC] border border-[#F3C7CF] text-xs text-[#700F2D]">
              {actionError}
            </div>
          )}

          {selectedVisit && (
            <div className="p-3 rounded-lg bg-[#FBFAF7] border border-[#DCD8CE] space-y-1">
              <div className="font-bold text-[#14213D]">{selectedVisit.organisation_name}</div>
              <div className="text-[11px] text-[#4A5568]">
                Planned Date: {formatDateIN(selectedVisit.planned_date)} &bull; Rep: {selectedVisit.assigned_rep_name}
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
              className="w-full rounded-lg border border-[#DCD8CE] bg-white p-2.5 text-xs text-[#14213D] focus:border-[#0F5E63] focus:outline-none shadow-xs"
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
