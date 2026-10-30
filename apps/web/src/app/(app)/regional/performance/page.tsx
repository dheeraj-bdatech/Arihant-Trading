'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Award, Calendar, Compass, Download, MapPin, Presentation, Target, Users } from 'lucide-react';
import type { PerformanceFigures, SalesPerformanceDto } from '@arihant/shared';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';
import { istToday } from '@/lib/ist-date';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  FilterBar,
  InfoCallout,
  Input,
  PageContainer,
  PageHeader,
  PageLoader,
  Select,
  StatCard,
  StatGrid,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
} from '@/components/ui';

/** Module 9 — Salesperson & Regional Performance (Scope Blueprint §44). */

const monthStart = (today: string) => `${today.slice(0, 7)}-01`;
const pct = (rate: number | null) => (rate === null ? '—' : `${rate}%`);
const ratio = (part: number, whole: number) => (whole > 0 ? `${part} / ${whole}` : '—');
const reasonLabel = (code: string) => {
  const t = code.replace(/_/g, ' ').toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
};
const topReasons = (reasons: Record<string, number>, n = 5) =>
  Object.entries(reasons)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n);

/** Column groups: [group, columns]; each column reads one figure. */
type Col = { label: string; title: string; get: (f: PerformanceFigures) => React.ReactNode };
const GROUPS: { name: string; cols: Col[] }[] = [
  {
    name: 'Leads',
    cols: [
      { label: 'Contacts', title: 'Contacts at organisations worked (not period-bound)', get: (f) => f.lead.contacts },
      { label: 'New', title: 'Fresh leads created in the period', get: (f) => f.lead.new },
      { label: 'Re-appr.', title: 'Re-approached leads created in the period', get: (f) => f.lead.reapproached },
      { label: 'Active', title: 'Open leads right now', get: (f) => f.lead.active },
      { label: 'F/U done', title: 'Lead follow-ups completed in the period', get: (f) => f.lead.followups_done },
      { label: 'F/U pending', title: 'Open follow-ups due by the period end', get: (f) => f.lead.followups_pending },
      { label: 'Conv.', title: 'Leads created in the period that are converted / won', get: (f) => `${pct(f.lead.conversion_rate)}` },
    ],
  },
  {
    name: 'Visits',
    cols: [
      { label: 'Planned', title: 'Visits planned for a date in the period', get: (f) => f.visit.planned },
      { label: 'Done', title: 'Completed', get: (f) => f.visit.completed },
      { label: 'Cancelled', title: 'Cancelled', get: (f) => f.visit.cancelled },
      { label: 'Interactions', title: 'Customer interactions logged in the period', get: (f) => f.visit.interactions },
    ],
  },
  {
    name: 'Demos',
    cols: [
      { label: 'Planned', title: 'Demos scheduled in the period (not cancelled)', get: (f) => f.demo.planned },
      { label: 'Done', title: 'Completed', get: (f) => f.demo.completed },
      { label: 'Success', title: 'Completed with a successful outcome', get: (f) => f.demo.successful },
      {
        label: 'Top failure',
        title: 'Most frequent failure reason',
        get: (f) => {
          const [top] = topReasons(f.demo.failure_reasons, 1);
          return top ? <span className="font-sans whitespace-nowrap">{`${reasonLabel(top[0])} (${top[1]})`}</span> : '—';
        },
      },
    ],
  },
  {
    name: 'Proposals',
    cols: [
      { label: 'Sent', title: 'Proposals sent in the period', get: (f) => f.proposal.sent },
      { label: 'F/U', title: 'Proposal follow-ups logged in the period', get: (f) => f.proposal.followups },
      { label: 'Converted', title: 'Proposals converted in the period', get: (f) => f.proposal.converted },
    ],
  },
  {
    name: 'Tenders',
    cols: [
      { label: 'PQ', title: 'PQ tenders identified in the period', get: (f) => f.tender.pq },
      { label: 'Gen/MHA', title: 'General / MHA tenders identified in the period', get: (f) => f.tender.general_mha },
      { label: 'Submitted', title: 'Bids submitted in the period', get: (f) => f.tender.submitted },
      { label: 'Won', title: 'Won, result in the period', get: (f) => f.tender.won },
      { label: 'Lost', title: 'Lost, result in the period', get: (f) => f.tender.lost },
      { label: 'Win %', title: 'Won ÷ (won + lost)', get: (f) => pct(f.tender.win_rate) },
    ],
  },
];
const GROUP_EDGE = 'border-l border-[#ECE9E2]';

/** One CSV line per row: every indicator as plain numbers (all failure reasons, not only the top one). */
const CSV_HEAD = [
  'Name', 'Role', 'Region', 'Zone',
  'Contacts', 'New leads', 'Re-approached', 'Active leads', 'Follow-ups done', 'Follow-ups pending', 'Leads converted', 'Lead conversion %',
  'Visits planned', 'Visits completed', 'Visits cancelled', 'Interactions',
  'Demos planned', 'Demos completed', 'Demos successful', 'Demo failure reasons',
  'Proposals sent', 'Proposal follow-ups', 'Proposals converted',
  'PQ tenders', 'General/MHA tenders', 'Bids submitted', 'Tenders won', 'Tenders lost', 'Tender win %',
];
const csvLine = (name: string, role: string, region: string, zone: string, f: PerformanceFigures) =>
  [
    name, role, region, zone,
    f.lead.contacts, f.lead.new, f.lead.reapproached, f.lead.active, f.lead.followups_done, f.lead.followups_pending, f.lead.converted, f.lead.conversion_rate ?? '',
    f.visit.planned, f.visit.completed, f.visit.cancelled, f.visit.interactions,
    f.demo.planned, f.demo.completed, f.demo.successful, Object.entries(f.demo.failure_reasons).map(([k, v]) => `${reasonLabel(k)}: ${v}`).join('; '),
    f.proposal.sent, f.proposal.followups, f.proposal.converted,
    f.tender.pq, f.tender.general_mha, f.tender.submitted, f.tender.won, f.tender.lost, f.tender.win_rate ?? '',
  ]
    .map((v) => {
      const t = String(v);
      return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
    })
    .join(',');

export default function SalesPerformancePage() {
  const { hasRole } = useAuth();
  const today = istToday();
  const [groupBy, setGroupBy] = useState<'rep' | 'region'>('rep');
  const [from, setFrom] = useState(monthStart(today));
  const [to, setTo] = useState(today);
  const [zoneId, setZoneId] = useState('');
  const [regionId, setRegionId] = useState('');
  const [data, setData] = useState<SalesPerformanceDto | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // a link from the command dashboard opens the same period and grouping (?from=&to=&group_by=region)
  const [urlRead, setUrlRead] = useState(false);

  const allowed = hasRole(['sales', 'regional_manager', 'management', 'admin']);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const day = /^\d{4}-\d{2}-\d{2}$/;
    if (day.test(q.get('from') || '')) setFrom(q.get('from')!);
    if (day.test(q.get('to') || '')) setTo(q.get('to')!);
    if (q.get('group_by') === 'region') setGroupBy('region');
    setUrlRead(true);
  }, []);

  useEffect(() => {
    if (!allowed || !urlRead) return;
    if (!from || !to || from > to) {
      // no request for a broken range; one this change cancelled would otherwise leave the page "loading" for good
      setIsLoading(false);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    api
      .get<SalesPerformanceDto>('/dashboard/sales-performance', { from, to, group_by: groupBy, zone_id: zoneId, region_id: regionId })
      .then((res) => !cancelled && setData(res))
      .catch((err: any) => !cancelled && setError(err?.message || 'Failed to load performance figures.'))
      .finally(() => !cancelled && setIsLoading(false));
    return () => {
      cancelled = true;
    };
  }, [allowed, urlRead, from, to, groupBy, zoneId, regionId]);

  const filters = data?.filters;
  const regionOptions = useMemo(
    () => (filters?.regions ?? []).filter((r) => !zoneId || r.zone_id === zoneId),
    [filters?.regions, zoneId],
  );

  if (!allowed) {
    return (
      <PageContainer>
        <EmptyState title="Access restricted" description="Performance figures are available to sales, regional managers and management." />
      </PageContainer>
    );
  }

  const totals = data?.totals;
  const rows = data?.rows ?? [];
  const byRegion = data?.group_by === 'region';
  // the inputs no longer describe a period: the figures on screen are still the last valid one's, so say so
  const stale = !!data && (!from || !to || from > to);
  const totalReasons = totals ? topReasons(totals.demo.failure_reasons) : [];

  const exportCsv = () => {
    if (!data || !totals) return;
    const lines = [
      CSV_HEAD.join(','),
      ...rows.map((r) =>
        csvLine(`${r.label}${r.inactive ? ' (inactive)' : ''}`, byRegion ? '' : (r.role || '').replace(/_/g, ' '), r.region_name || '', r.zone_name || '', r),
      ),
      csvLine('Total (distinct records)', '', '', '', totals),
    ];
    // byte-order mark: Excel then reads the file as UTF-8 (names in Hindi or with accents stay intact)
    const url = URL.createObjectURL(new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: `performance-${data.group_by}-${data.period.from}-to-${data.period.to}.csv` });
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <PageContainer>
      <PageHeader
        title="Salesperson & Regional Performance"
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" leftIcon={<Download className="h-4 w-4 text-[#0F5E63]" />} onClick={exportCsv} disabled={!totals || isLoading || stale}>
              Export CSV
            </Button>
            {hasRole(['regional_manager', 'management', 'admin']) && (
              <Link href="/regional">
                <Button variant="secondary" size="sm" leftIcon={<Compass className="h-4 w-4 text-[#0F5E63]" />}>
                  Territory Command
                </Button>
              </Link>
            )}
          </div>
        }
      />

      <FilterBar>
        <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end">
          {(filters?.can_group_by_region ?? hasRole(['regional_manager', 'management', 'admin'])) && (
            <Tabs
              activeTab={groupBy}
              onChange={(id) => setGroupBy(id as 'rep' | 'region')}
              tabs={[
                { id: 'rep', label: 'By salesperson', icon: <Users className="h-3.5 w-3.5" /> },
                { id: 'region', label: 'By region', icon: <MapPin className="h-3.5 w-3.5" /> },
              ]}
            />
          )}
          <div className="grid grid-cols-2 gap-2 lg:w-[320px]">
            <Input label="From" type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
            <Input label="To" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
          </div>
          {filters?.can_pick_zone && (
            <div className="lg:w-[220px]">
              <Select
                label="Zone"
                value={zoneId}
                onChange={(e) => {
                  setZoneId(e.target.value);
                  setRegionId('');
                }}
              >
                <option value="">All zones</option>
                {filters.zones.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.name}
                  </option>
                ))}
              </Select>
            </div>
          )}
          {filters?.can_pick_region && regionOptions.length > 0 && (
            <div className="lg:w-[220px]">
              <Select label="Region" value={regionId} onChange={(e) => setRegionId(e.target.value)}>
                <option value="">All regions</option>
                {regionOptions.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </Select>
            </div>
          )}
        </div>
        {from > to && <p className="text-xs text-[#881337]">“From” must be on or before “To”.</p>}
        {(!from || !to) && <p className="text-xs text-[#881337]">Pick both dates to see the figures for a period.</p>}
        {stale && data && (
          <p className="text-xs text-[#4A5568]">
            Still showing {data.period.from} → {data.period.to} until the dates are fixed.
          </p>
        )}
      </FilterBar>

      {error && (
        <InfoCallout variant="danger" title="Could not load performance" onClose={() => setError(null)}>
          {error}
        </InfoCallout>
      )}

      {isLoading && !data ? (
        <PageLoader label="Loading performance" rows={4} />
      ) : totals ? (
        <div className={`space-y-6 transition-opacity ${stale ? 'opacity-50' : ''}`} aria-live="polite">
          <StatGrid cols={4} className="gap-3">
            <StatCard
              title="Lead conversion"
              value={pct(totals.lead.conversion_rate)}
              icon={<Target size={16} />}
              variant="primary"
              subtext={`${totals.lead.converted} of ${totals.lead.new + totals.lead.reapproached} leads created`}
            />
            <StatCard
              title="Visits completed"
              value={ratio(totals.visit.completed, totals.visit.planned)}
              icon={<Calendar size={16} />}
              variant="emerald"
              subtext={`${totals.visit.cancelled} cancelled • ${totals.visit.interactions} interactions`}
            />
            <StatCard
              title="Successful demos"
              value={ratio(totals.demo.successful, totals.demo.completed)}
              icon={<Presentation size={16} />}
              variant="amber"
              subtext={`${totals.demo.planned} planned • ${totals.demo.completed} completed`}
            />
            <StatCard
              title="Tender win rate"
              value={pct(totals.tender.win_rate)}
              icon={<Award size={16} />}
              variant="rose"
              subtext={`${totals.tender.won} won • ${totals.tender.lost} lost • ${totals.tender.submitted} submitted`}
            />
          </StatGrid>

          {rows.length === 0 ? (
            <EmptyState
              icon={Users}
              title={byRegion ? 'No regions in this scope' : 'No salespeople in this scope'}
              description="Change the zone or region filter to see figures."
            />
          ) : (
            <Table aria-busy={isLoading}>
              <TableHeader>
                <TableRow>
                  <TableHead rowSpan={2} className="sticky left-0 z-10 bg-[#FBFAF7] min-w-[180px]">
                    {byRegion ? 'Region' : 'Salesperson'}
                  </TableHead>
                  {GROUPS.map((g) => (
                    <TableHead key={g.name} colSpan={g.cols.length} className={`text-center text-[#14213D] ${GROUP_EDGE}`}>
                      {g.name}
                    </TableHead>
                  ))}
                </TableRow>
                <TableRow>
                  {GROUPS.flatMap((g) =>
                    g.cols.map((c, i) => (
                      <TableHead
                        key={`${g.name}-${c.label}`}
                        title={c.title}
                        className={`px-2 text-right normal-case tracking-normal whitespace-nowrap ${i === 0 ? GROUP_EDGE : ''}`}
                      >
                        {c.label}
                      </TableHead>
                    )),
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.key}>
                    <TableCell className="sticky left-0 z-[1] bg-white whitespace-nowrap">
                      <div className="font-semibold text-[#14213D]">
                        {r.label}
                        {r.inactive && <span className="ml-1.5 rounded-full bg-[#ECE9E2] px-1.5 py-0.5 text-[10px] font-semibold text-[#4A5568]">Inactive</span>}
                      </div>
                      <div className="text-[10px] text-[#4A5568]">
                        {byRegion ? r.zone_name || '—' : [r.role?.replace(/_/g, ' '), r.region_name || '—'].filter(Boolean).join(' · ')}
                      </div>
                    </TableCell>
                    {GROUPS.flatMap((g) =>
                      g.cols.map((c, i) => (
                        <TableCell key={`${g.name}-${c.label}`} className={`px-2 text-right font-mono ${i === 0 ? GROUP_EDGE : ''}`}>
                          {c.get(r)}
                        </TableCell>
                      )),
                    )}
                  </TableRow>
                ))}
                {/* a single row (a rep's own view) is its own total */}
                {rows.length > 1 && (
                <TableRow className="bg-[#FBFAF7] hover:bg-[#FBFAF7] border-t-2 border-[#DCD8CE]">
                  <TableCell className="sticky left-0 z-[1] bg-[#FBFAF7] font-bold text-[#14213D]">
                    Total
                    <div className="text-[10px] font-normal text-[#4A5568]">distinct records</div>
                  </TableCell>
                  {GROUPS.flatMap((g) =>
                    g.cols.map((c, i) => (
                      <TableCell key={`${g.name}-${c.label}`} className={`px-2 text-right font-mono font-bold ${i === 0 ? GROUP_EDGE : ''}`}>
                        {c.get(totals)}
                      </TableCell>
                    )),
                  )}
                </TableRow>
                )}
              </TableBody>
            </Table>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Demo failure reasons</CardTitle>
            </CardHeader>
            <CardContent>
              {totalReasons.length === 0 ? (
                <p className="text-xs text-[#4A5568]">No failed or partial demo outcomes in this period.</p>
              ) : (
                <ul className="divide-y divide-[#ECE9E2] text-xs">
                  {totalReasons.map(([code, count]) => (
                    <li key={code} className="flex items-center justify-between py-2">
                      <span className="text-[#14213D]">{reasonLabel(code)}</span>
                      <span className="font-mono font-semibold text-[#9A3412]">{count}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <p className="text-[11px] text-[#6B7280]">
            Period {data?.period.from} → {data?.period.to} (IST). Contacts and active leads are current snapshots. Proposals count
            under the responsible person; tenders under everyone involved (salesperson, owner, assignee, creator), so the total counts
            each tender once. A deactivated rep is listed only when they have figures in the period. Rates show “—” when there is
            nothing to divide by.
          </p>
        </div>
      ) : null}
    </PageContainer>
  );
}
