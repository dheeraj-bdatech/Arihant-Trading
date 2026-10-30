'use client';

/**
 * Report 1 — Sales pipeline & conversion (GET /reports/sales-pipeline): conversion and win rates across leads, visits,
 * demos, proposals and tenders; the lead journey; each module's stages; tender reporting (Blueprint §36); a zone /
 * region / salesperson breakdown and loss reasons. Filters live in the URL.
 */
import React, { Suspense, useState } from 'react';
import { Award, Download, Map as MapIcon, MapPin, Presentation, RefreshCw, Target, Users, Calendar, FileSpreadsheet } from 'lucide-react';
import type { PipelineBreakdownRow, PipelineGroupBy, PipelineModuleKey, ReportCount, SalesPipelineReportDto } from '@arihant/shared';
import { useAuth } from '@/lib/auth-context';
import {
  BarList,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  InfoCallout,
  PageContainer,
  PageHeader,
  PageLoader,
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
import { ReportFilterBar, ReportsDenied, ReportsNav, canOpen, downloadCsv, fmtDay, money, pctText, rateSub, useReport, useReportFilters } from '../_lib/report-ui';

const GROUP_LABEL: Record<PipelineGroupBy, string> = { zone: 'Zone', region: 'Region', salesperson: 'Salesperson' };

type Col = { label: string; title: string; get: (r: PipelineBreakdownRow) => string | number; csv?: (r: PipelineBreakdownRow) => string | number | null };
const COLUMNS: { name: string; cols: Col[] }[] = [
  {
    name: 'Leads',
    cols: [
      { label: 'Created', title: 'Leads created in the period', get: (r) => r.leads_created },
      { label: 'Conv.', title: 'Created in the period and now converted / won', get: (r) => r.leads_converted },
      { label: 'Conv. %', title: 'Converted ÷ created', get: (r) => pctText(r.lead_conversion_rate), csv: (r) => r.lead_conversion_rate },
      { label: 'Open', title: 'Open leads right now', get: (r) => r.open_leads },
      { label: 'Open value', title: 'Value of open leads right now', get: (r) => money(r.open_lead_value), csv: (r) => r.open_lead_value },
    ],
  },
  {
    name: 'Field',
    cols: [
      { label: 'Visits', title: 'Visits completed (planned in the period)', get: (r) => r.visits_completed },
      { label: 'Demos', title: 'Demos completed (held in the period)', get: (r) => r.demos_completed },
      { label: 'Success', title: 'Completed demos with a successful outcome', get: (r) => r.demos_successful },
    ],
  },
  {
    name: 'Proposals',
    cols: [
      { label: 'Sent', title: 'Proposals sent in the period', get: (r) => r.proposals_sent },
      { label: 'Conv.', title: 'Converted, outcome in the period', get: (r) => r.proposals_converted },
      { label: 'Lost', title: 'Lost, outcome in the period', get: (r) => r.proposals_lost },
    ],
  },
  {
    name: 'Tenders',
    cols: [
      { label: 'Submitted', title: 'Bids submitted in the period', get: (r) => r.tenders_submitted },
      { label: 'Won', title: 'Won, result in the period', get: (r) => r.tenders_won },
      { label: 'Lost', title: 'Lost, result in the period', get: (r) => r.tenders_lost },
      { label: 'Win %', title: 'Won ÷ (won + lost)', get: (r) => pctText(r.tender_win_rate), csv: (r) => r.tender_win_rate },
      { label: 'Won value', title: 'Value of tenders won in the period', get: (r) => money(r.tender_won_value), csv: (r) => r.tender_won_value },
      { label: 'Live value', title: 'Value of live bids right now', get: (r) => money(r.live_tender_value), csv: (r) => r.live_tender_value },
    ],
  },
];
const EDGE = 'border-l border-[#ECE9E2]';

const LOSS_CARDS: { key: keyof SalesPipelineReportDto['loss_reasons']; title: string; empty: string }[] = [
  { key: 'tenders', title: 'Tenders lost', empty: 'No tenders lost in this period.' },
  { key: 'proposals', title: 'Proposals lost', empty: 'No proposals lost in this period.' },
  { key: 'demos', title: 'Demo failures', empty: 'No failed or partial demos in this period.' },
  { key: 'leads', title: 'Leads lost', empty: 'No leads lost from this period.' },
];

function PipelineReport() {
  const { user } = useAuth();
  const allowed = canOpen(user?.role, 'pipeline');
  const filters = useReportFilters(['group_by']);
  const groupBy = (['zone', 'region', 'salesperson'].includes(filters.values.group_by) ? filters.values.group_by : 'zone') as PipelineGroupBy;
  const { data, loading, error, reload } = useReport<SalesPipelineReportDto>('/reports/sales-pipeline', { ...filters.query, from: filters.from, to: filters.to }, allowed && !filters.invalid);
  const [moduleTab, setModuleTab] = useState<PipelineModuleKey>('leads');

  if (!user) return <PageLoader rows={4} label="Loading report" />;
  if (!allowed) {
    return (
      <>
        <ReportsNav role={user.role} />
        <ReportsDenied />
      </>
    );
  }

  const exportBreakdown = () => {
    if (!data) return;
    const flat = COLUMNS.flatMap((g) => g.cols.map((c) => ({ ...c, head: `${g.name} – ${c.label}` })));
    const line = (r: PipelineBreakdownRow) => [r.label, r.zone_name ?? '', r.region_name ?? '', ...flat.map((c) => (c.csv ? c.csv(r) : c.get(r)))];
    downloadCsv(
      `Arihant_Sales_Pipeline_by_${GROUP_LABEL[data.group_by]}_${data.period.from}_to_${data.period.to}`,
      [GROUP_LABEL[data.group_by], 'Zone', 'Region', ...flat.map((c) => c.head)],
      [...data.breakdown.rows.map(line), line(data.breakdown.totals)],
    );
  };

  const mod = data?.modules.find((m) => m.key === moduleTab);
  const r = data?.rates;
  const t = data?.tender;

  return (
    <>
      <PageHeader
        title="Sales pipeline & conversion report"
        actions={
          <Button variant="outline" size="sm" leftIcon={<Download className="h-4 w-4" />} onClick={exportBreakdown} disabled={!data}>
            Export CSV
          </Button>
        }
      />
      <ReportsNav role={user.role} />
      <ReportFilterBar filters={filters} territory={data?.filters} />

      {error && (
        <InfoCallout variant="danger" title="Could not load the pipeline report">
          <p>{error}</p>
          <Button variant="secondary" size="xs" className="mt-2" leftIcon={<RefreshCw className="h-3.5 w-3.5" />} onClick={reload}>
            Try again
          </Button>
        </InfoCallout>
      )}

      {!data || !r || !t ? (
        loading ? <PageLoader rows={5} label="Building the pipeline report" /> : null
      ) : (
        <div className={`space-y-6 transition-opacity ${loading ? 'opacity-60' : ''}`} aria-busy={loading}>
          {/* Conversion & win rates */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <StatCard title="Lead conversion" value={pctText(r.lead_conversion.rate)} subtext={rateSub(r.lead_conversion, 'leads created')} icon={<Target className="h-4 w-4" />} variant="primary" />
            <StatCard title="Visit completion" value={pctText(r.visit_completion.rate)} subtext={rateSub(r.visit_completion, 'visits not cancelled')} icon={<Calendar className="h-4 w-4" />} variant="primary" />
            <StatCard title="Demo success" value={pctText(r.demo_success.rate)} subtext={rateSub(r.demo_success, 'demos completed')} icon={<Presentation className="h-4 w-4" />} variant="emerald" />
            <StatCard title="Proposal win rate" value={pctText(r.proposal_win.rate)} subtext={rateSub(r.proposal_win, 'proposals decided')} icon={<FileSpreadsheet className="h-4 w-4" />} variant="amber" />
            <StatCard title="Tender win rate" value={pctText(r.tender_win.rate)} subtext={rateSub(r.tender_win, 'tenders decided')} icon={<Award className="h-4 w-4" />} variant="rose" />
          </div>

          {/* Value in play */}
          <StatGrid cols={4} className="gap-3">
            <StatCard title="Open lead pipeline" value={money(data.values.open_leads)} subtext="All open leads, as of now" />
            <StatCard title="Proposals in play" value={money(data.values.open_proposals)} subtext="Quoted value not yet won / lost / closed" />
            <StatCard title="Live tender value" value={money(data.values.live_tenders)} subtext="Bids not yet decided, as of now" />
            <StatCard title="Won in period" value={money(data.values.tenders_won)} subtext={`Tenders won · proposals converted ${money(data.values.proposals_converted)}`} variant="emerald" />
          </StatGrid>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Lead journey</CardTitle>
                <CardDescription>Of the leads created in the period, how many reached each step (a lead can skip one).</CardDescription>
              </CardHeader>
              <CardContent>
                <BarList
                  label="Leads reaching each step"
                  labelWidth="38%"
                  items={data.journey.map((s) => ({
                    key: s.key,
                    label: s.label,
                    value: s.count,
                    display: s.key === 'created' ? String(s.count) : `${s.count} · ${pctText(s.share)}`,
                  }))}
                  emptyText="No leads were created in this period."
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Tender reporting</CardTitle>
                <CardDescription>Identified in the period, by category; submitted and decided on their own dates.</CardDescription>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs 2xl:grid-cols-3">
                  {(
                    [
                      ['Identified', t.identified],
                      ['PQ', t.pq],
                      ['General / MHA', t.general_mha],
                      ['Other', t.other],
                      ['Worked upon', t.worked_upon],
                      ['Pending', t.pending],
                      ['Submitted', t.submitted],
                      ['Won', t.won],
                      ['Lost', t.lost],
                    ] as const
                  ).map(([label, value]) => (
                    <div key={label} className="flex items-baseline justify-between border-b border-[#ECE9E2] py-1.5">
                      <dt className="text-[#4A5568]">{label}</dt>
                      <dd className="font-mono font-semibold text-[#14213D]">{value}</dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-3 text-xs text-[#4A5568]">
                  Win rate <span className="font-mono font-bold text-[#0F5E63]">{pctText(t.win_rate)}</span> · won value{' '}
                  <span className="font-mono font-semibold text-[#14213D]">{money(data.values.tenders_won)}</span>
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Stages per module */}
          <Card>
            <CardHeader>
              <CardTitle>Pipeline by stage</CardTitle>
              <CardDescription>{mod ? `${mod.period_basis}, by current stage. Closing stages are marked ●.` : ''}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="overflow-x-auto custom-scrollbar">
                <Tabs
                  variant="segmented"
                  size="sm"
                  className="min-w-max"
                  activeTab={moduleTab}
                  onChange={(id) => setModuleTab(id as PipelineModuleKey)}
                  tabs={data.modules.map((m) => ({ id: m.key, label: m.label, count: m.total }))}
                />
              </div>
              {mod && (
                <>
                  <BarList
                    label={`${mod.label} by stage`}
                    labelWidth="42%"
                    items={mod.stages.map((s) => ({
                      key: s.key,
                      label: `${s.terminal ? '● ' : ''}${s.label}`,
                      value: s.count,
                      display: s.value !== null && s.value > 0 ? `${s.count} · ${money(s.value)}` : String(s.count),
                    }))}
                    emptyText={`No ${mod.label.toLowerCase()} in this period.`}
                  />
                  {mod.value !== null && (
                    <p className="text-xs text-[#4A5568]">
                      {mod.total} {mod.label.toLowerCase()} worth <span className="font-mono font-semibold text-[#14213D]">{money(mod.value)}</span>
                    </p>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          {/* Zone / region / salesperson breakdown */}
          <Card>
            <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle>{GROUP_LABEL[groupBy]}-wise breakdown</CardTitle>
                <CardDescription>Each record counts once, under its owner and its customer’s territory, so rows add up to the total.</CardDescription>
              </div>
              <Tabs
                variant="segmented"
                size="sm"
                activeTab={groupBy}
                onChange={(id) => filters.set({ group_by: id === 'zone' ? null : id })}
                tabs={[
                  { id: 'zone', label: 'Zone', icon: <MapIcon className="h-3.5 w-3.5" /> },
                  { id: 'region', label: 'Region', icon: <MapPin className="h-3.5 w-3.5" /> },
                  { id: 'salesperson', label: 'Salesperson', icon: <Users className="h-3.5 w-3.5" /> },
                ]}
              />
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead rowSpan={2} className="sticky left-0 z-10 min-w-[160px] bg-[#FBFAF7]">
                      {GROUP_LABEL[data.group_by]}
                    </TableHead>
                    {COLUMNS.map((g) => (
                      <TableHead key={g.name} colSpan={g.cols.length} className={`text-center text-[#14213D] ${EDGE}`}>
                        {g.name}
                      </TableHead>
                    ))}
                  </TableRow>
                  <TableRow>
                    {COLUMNS.flatMap((g) =>
                      g.cols.map((c, i) => (
                        <TableHead key={`${g.name}-${c.label}`} title={c.title} className={`px-2 text-right normal-case tracking-normal whitespace-nowrap ${i === 0 ? EDGE : ''}`}>
                          {c.label}
                        </TableHead>
                      )),
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.breakdown.rows.map((row) => (
                    <TableRow key={row.key}>
                      <TableCell className="sticky left-0 z-[1] bg-white whitespace-nowrap">
                        <div className="font-semibold text-[#14213D]">{row.label}</div>
                        {data.group_by !== 'zone' && (
                          <div className="text-[10px] text-[#4A5568]">{[data.group_by === 'salesperson' ? row.region_name : null, row.zone_name].filter(Boolean).join(' · ') || '—'}</div>
                        )}
                      </TableCell>
                      {COLUMNS.flatMap((g) =>
                        g.cols.map((c, i) => (
                          <TableCell key={`${g.name}-${c.label}`} className={`px-2 text-right font-mono whitespace-nowrap ${i === 0 ? EDGE : ''}`}>
                            {c.get(row)}
                          </TableCell>
                        )),
                      )}
                    </TableRow>
                  ))}
                  <TableRow className="border-t-2 border-[#DCD8CE] bg-[#FBFAF7] hover:bg-[#FBFAF7]">
                    <TableCell className="sticky left-0 z-[1] bg-[#FBFAF7] font-bold text-[#14213D]">Total</TableCell>
                    {COLUMNS.flatMap((g) =>
                      g.cols.map((c, i) => (
                        <TableCell key={`${g.name}-${c.label}`} className={`px-2 text-right font-mono font-bold whitespace-nowrap ${i === 0 ? EDGE : ''}`}>
                          {c.get(data.breakdown.totals)}
                        </TableCell>
                      )),
                    )}
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Loss reasons */}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {LOSS_CARDS.map((c) => {
              const list: ReportCount[] = data.loss_reasons[c.key];
              return (
                <Card key={c.key}>
                  <CardHeader>
                    <CardTitle className="text-base">{c.title}</CardTitle>
                    <CardDescription>Top reasons recorded</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <BarList label={`${c.title} by reason`} labelWidth="55%" items={list.map((x) => ({ key: x.key, label: x.label, value: x.count }))} emptyText={c.empty} />
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <p className="text-[11px] text-[#6B7280]">
            Period {fmtDay(data.period.from)} → {fmtDay(data.period.to)} (IST). Leads count by created date, visits by planned date, demos by the date
            held, proposals by request / sent / outcome date and tenders by identified / submitted / result date — the same rules as Salesperson &amp;
            Regional Performance, so a rate here matches that page. Open lead, proposal and live tender values are as of now. Rates show “—” when there is
            nothing to divide by.
          </p>
        </div>
      )}
    </>
  );
}

export default function SalesPipelineReportPage() {
  return (
    <PageContainer>
      <Suspense fallback={<PageLoader rows={5} label="Loading report" />}>
        <PipelineReport />
      </Suspense>
    </PageContainer>
  );
}
