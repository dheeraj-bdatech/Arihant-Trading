'use client';

/**
 * Home screen, one per role (Blueprint §5). Each desk gets its own layout and its own scoped data
 * from GET /dashboard/workspace: management sees the §45 command buckets across India, a regional
 * manager the zone and team, sales their day, tender team the bid deadlines, demo team the fleet,
 * service the §34 queue KPIs, accounts the stage-2 settlement queue, admin the platform console.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Award,
  Box,
  Calendar,
  CheckSquare,
  Clock,
  Compass,
  Database,
  FileText,
  Key,
  Layers,
  ListChecks,
  MapPin,
  Receipt,
  RefreshCw,
  Settings,
  ShieldCheck,
  Target,
  TrendingUp,
  Truck,
  Users,
  Wallet,
  Wrench,
  Zap,
} from 'lucide-react';
import { useAuth, PRESET_ROLE_USERS } from '@/lib/auth-context';
import { api } from '@/lib/api';
import { Button, InfoCallout, PageContainer, PageLoader } from '@/components/ui';
import { DeadlineChip } from '@/components/tender/Countdown';
import {
  BarList,
  HeroBanner,
  ItemList,
  KpiTile,
  Panel,
  QuickActions,
  RingGauge,
  Scorecard,
  StatStrip,
  type DeckItem,
  type HeroStat,
  type KpiProps,
  type QuickAction,
} from '@/components/dashboard/command/CommandDeck';
import { formatINR, formatIndianCurrency, type DashboardWorkspaceDto, type UserRole } from '@arihant/shared';

type W = DashboardWorkspaceDto;

const num = (w: W, k: string) => w.numbers[k] ?? 0;
const list = (w: W, k: string): DeckItem[] => w.lists[k] ?? [];
const bars = (w: W, k: string) => w.bars[k] ?? [];
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);
/** ₹ 2.18 Cr / ₹ 4.60 Lakh / ₹ 4,610 */
const inr = (n: number) => formatIndianCurrency(n, true);
const lakh = (l: number) => formatIndianCurrency(l * 100000, true);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const countdown = (d: string) => <DeadlineChip deadline={d} />;

/** Builds a readable "x, y and z need you today" line from the non-zero parts: [count, singular, plural]. */
function sentence(parts: [number, string, string][], allClear: string): string {
  const live = parts.filter(([n]) => n > 0).map(([n, one, many]) => `${n} ${n === 1 ? one : many}`);
  if (live.length === 0) return allClear;
  const body = live.length === 1 ? live[0] : `${live.slice(0, -1).join(', ')} and ${live[live.length - 1]}`;
  return `${body.charAt(0).toUpperCase()}${body.slice(1)}.`;
}

const Grid: React.FC<{ className?: string; children: React.ReactNode }> = ({ className = '', children }) => (
  <div className={`grid grid-cols-1 gap-4 sm:gap-5 ${className}`}>{children}</div>
);

const Kpis: React.FC<{ items: KpiProps[]; cols?: 'four' | 'six' }> = ({ items, cols = 'four' }) => (
  <div className={`grid grid-cols-2 gap-3 sm:gap-4 ${cols === 'six' ? 'md:grid-cols-3 2xl:grid-cols-6' : 'xl:grid-cols-4'}`}>
    {items.map((k, i) => (
      <div key={k.label} className="dx-rise" style={{ animationDelay: `${80 + i * 60}ms` }}>
        <KpiTile {...k} />
      </div>
    ))}
  </div>
);

const A = (label: string, hint: string, href: string, icon: React.ReactNode): QuickAction => ({ label, hint, href, icon });

interface DeskView {
  eyebrow: string;
  summary: string;
  stats: HeroStat[];
  cta: { href: string; label: string };
  body: React.ReactNode;
}

/* ------------------------------------------------------------ management -- */
function management(w: W): DeskView {
  const won = num(w, 'tendersWon');
  const lost = num(w, 'tendersLost');
  const open = num(w, 'openTickets');
  return {
    eyebrow: 'Executive command',
    summary: sentence(
      [
        [num(w, 'tendersClosing48h'), 'bid closes within 48 hours', 'bids close within 48 hours'],
        [num(w, 'urgentTickets'), 'urgent service ticket is open', 'urgent service tickets are open'],
        [num(w, 'criticalBlockers'), 'blocked task waits for a decision', 'blocked tasks wait for a decision'],
        [num(w, 'depotConflicts'), 'demo unit is double-booked', 'demo units are double-booked'],
      ],
      'Nothing urgent across India right now. Bids, service and approvals are on track.',
    ),
    stats: [
      { label: 'Close ≤ 48h', value: num(w, 'tendersClosing48h'), tone: 'red' },
      { label: 'Urgent tickets', value: num(w, 'urgentTickets'), tone: 'ochre' },
      { label: 'Blockers', value: num(w, 'criticalBlockers'), tone: 'teal' },
    ],
    cta: { href: '/tenders', label: 'Open tender pipeline' },
    body: (
      <>
        {/* §45 executive command buckets */}
        <Kpis
          cols="six"
          items={[
            { label: 'Tenders closing ≤ 48h', value: num(w, 'tendersClosing48h'), sub: `${num(w, 'tendersClosing7d')} within 7 days`, chip: num(w, 'tendersAwaitingApproval') ? `${num(w, 'tendersAwaitingApproval')} to approve` : undefined, href: '/tenders', icon: <FileText size={15} />, tone: num(w, 'tendersClosing48h') ? 'red' : 'teal' },
            { label: 'Demos this week', value: num(w, 'demosThisWeek'), sub: `${num(w, 'demosPending')} requests waiting`, href: '/demos', icon: <Box size={15} />, tone: 'teal' },
            { label: 'Depot conflicts', value: num(w, 'depotConflicts'), sub: 'Units booked twice', href: '/demos', icon: <AlertTriangle size={15} />, tone: num(w, 'depotConflicts') ? 'red' : 'green' },
            { label: 'Urgent service tickets', value: num(w, 'urgentTickets'), sub: `${open} open · ${num(w, 'slaBreached')} past SLA`, href: '/service', icon: <Wrench size={15} />, tone: num(w, 'urgentTickets') ? 'ochre' : 'teal' },
            { label: 'Expenses in approval', value: num(w, 'expenseBatches'), sub: inr(num(w, 'expenseAmount')), href: '/expenses', icon: <Receipt size={15} />, tone: 'ochre' },
            { label: 'Critical blockers', value: num(w, 'criticalBlockers'), sub: 'Awaiting manager decision', href: '/tasks/blockers', icon: <Key size={15} />, tone: num(w, 'criticalBlockers') ? 'red' : 'green' },
          ]}
        />
        <Grid className="lg:grid-cols-3">
          <Panel className="lg:col-span-2" title="Zone performance" icon={<Compass size={15} />} tone="teal" href="/regional" hrefLabel="Regional command">
            <BarList bars={bars(w, 'zones')} format={lakh} secondaryLabel={(n) => plural(n, 'open bid')} />
          </Panel>
          <Panel title="Health" icon={<TrendingUp size={15} />} tone="green">
            <div className="grid grid-cols-2 gap-2 px-4 pb-4 pt-2">
              <RingGauge label="Tender win rate" sub={`${won} won · ${lost} lost`} value={won} max={won + lost} tone="green" />
              <RingGauge label="Tickets within SLA" sub={`${num(w, 'slaBreached')} breached`} value={Math.max(0, open - num(w, 'slaBreached'))} max={open} display={open === 0 ? '—' : undefined} tone="teal" />
            </div>
            <div className="mx-4 mb-4 flex items-center justify-between rounded-[12px] bg-[color:var(--th-soft)] px-3 py-2.5">
              <span className="text-xs font-semibold text-[color:var(--th-mute)]">Open lead pipeline</span>
              <span className="font-mono text-sm font-bold text-[color:var(--th-ink)]">{lakh(num(w, 'pipelineLakh'))}</span>
            </div>
          </Panel>
        </Grid>
        <Grid className="lg:grid-cols-3">
          <Panel title="Bids closing this week" icon={<Clock size={15} />} tone="red" href="/tenders" hrefLabel="All bids">
            <ItemList items={list(w, 'closing')} dateMode="countdown" countdown={countdown} money={(n) => (n ? `EMD ${formatINR(n)}` : 'EMD exempt')} empty="No bid closes in the next 7 days" />
          </Panel>
          <Panel title="Urgent service tickets" icon={<Wrench size={15} />} tone="ochre" href="/service" hrefLabel="Service desk">
            <ItemList items={list(w, 'urgentTickets')} dateMode="countdown" countdown={countdown} empty="No critical or high-priority tickets open" />
          </Panel>
          <Panel title="Blockers awaiting decision" icon={<Key size={15} />} tone="ink" href="/tasks/blockers" hrefLabel="Review">
            <ItemList items={list(w, 'blockers')} dateMode="ago" empty="No blockers waiting for review" />
          </Panel>
        </Grid>
      </>
    ),
  };
}

/* ------------------------------------------------------ regional manager -- */
function regional(w: W): DeskView {
  return {
    eyebrow: `Territory desk · ${w.scopeLabel}`,
    summary: sentence(
      [
        [num(w, 'stage1Pending'), 'expense claim waits for your stage-1 approval', 'expense claims wait for your stage-1 approval'],
        [num(w, 'blockersToReview'), 'task blocker needs your review', 'task blockers need your review'],
        [num(w, 'followupsOverdue'), 'lead follow-up in your zone is overdue', 'lead follow-ups in your zone are overdue'],
      ],
      'Your team is on track. No approvals, blockers or overdue follow-ups are waiting on you.',
    ),
    stats: [
      { label: 'Approvals', value: num(w, 'stage1Pending'), tone: 'ochre' },
      { label: 'Blockers', value: num(w, 'blockersToReview'), tone: 'red' },
      { label: 'Overdue follow-ups', value: num(w, 'followupsOverdue'), tone: 'teal' },
    ],
    cta: { href: '/expenses/approvals', label: 'Review approvals' },
    body: (
      <>
        <Kpis
          items={[
            { label: 'Zone pipeline', value: lakh(num(w, 'pipelineLakh')), sub: `${num(w, 'openLeads')} open leads`, chip: num(w, 'followupsOverdue') ? `${num(w, 'followupsOverdue')} overdue` : undefined, href: '/leads', icon: <Target size={15} />, tone: 'teal' },
            { label: 'Team visits this week', value: num(w, 'visitsWeek'), sub: `${num(w, 'visitsToday')} today · ${num(w, 'visitsDone30d')} done in 30 days`, href: '/visits', icon: <MapPin size={15} />, tone: 'teal' },
            { label: 'Stage-1 approvals', value: num(w, 'stage1Pending'), sub: inr(num(w, 'stage1Amount')), href: '/expenses/approvals', icon: <Receipt size={15} />, tone: num(w, 'stage1Pending') ? 'ochre' : 'green' },
            { label: 'Zone bids closing', value: num(w, 'tendersClosing7d'), sub: 'Within 7 days', href: '/tenders', icon: <FileText size={15} />, tone: num(w, 'tendersClosing7d') ? 'red' : 'teal' },
          ]}
        />
        <Grid className="lg:grid-cols-3">
          <Panel className="lg:col-span-2" title={`Team scorecard · ${plural(num(w, 'teamSize'), 'person', 'people')}`} icon={<Users size={15} />} tone="teal" href="/regional" hrefLabel="Territory command">
            <Scorecard
              rows={list(w, 'team')}
              columns={[
                { key: 'openTasks', label: 'Open tasks' },
                { key: 'overdue', label: 'Overdue', alert: (n) => n > 0 },
                { key: 'visitsDone', label: 'Visits 30d' },
                { key: 'pipelineLakh', label: 'Pipeline', format: (n) => (n ? `${Math.round(n)}L` : '—') },
              ]}
            />
          </Panel>
          <Panel title="Waiting for your approval" icon={<Receipt size={15} />} tone="ochre" href="/expenses/approvals" hrefLabel="Approve">
            <ItemList items={list(w, 'approvals')} dateMode="ago" money={formatINR} empty="No claims waiting for stage-1 approval" />
          </Panel>
        </Grid>
        <Grid className="lg:grid-cols-3">
          <Panel title="Team visits this week" icon={<Calendar size={15} />} tone="teal" href="/visits" hrefLabel="Tour planner">
            <ItemList items={list(w, 'agenda')} dateMode="day" empty="No team visits planned this week" />
          </Panel>
          <Panel title="Blockers to review" icon={<Key size={15} />} tone="red" href="/tasks/blockers" hrefLabel="Review">
            <ItemList items={list(w, 'blockers')} dateMode="ago" empty="No blockers raised by your team" />
          </Panel>
          <Panel title="Quick actions" icon={<Zap size={15} />} tone="teal">
            <QuickActions
              actions={[
                A('Territory command', 'Zones, reps and tours', '/regional', <Compass size={16} />),
                A('Approve expenses', 'Stage-1 endorsements', '/expenses/approvals', <Receipt size={16} />),
                A('Team tasks', 'Assign and follow up', '/tasks/team', <ListChecks size={16} />),
                A('Leads', 'Pipeline and follow-ups', '/leads', <Target size={16} />),
              ]}
            />
          </Panel>
        </Grid>
      </>
    ),
  };
}

/* ----------------------------------------------------------------- sales -- */
function sales(w: W): DeskView {
  return {
    eyebrow: 'My day',
    summary: sentence(
      [
        [num(w, 'visitsToday'), 'visit is planned today', 'visits are planned today'],
        [num(w, 'followupsDue'), 'follow-up is due', 'follow-ups are due'],
        [num(w, 'bidsClosing'), 'of your bids closes this week', 'of your bids close this week'],
        [num(w, 'claimsClarify'), 'expense claim needs clarification', 'expense claims need clarification'],
      ],
      'A clear day. Plan a visit or follow up with a prospect to keep the pipeline moving.',
    ),
    stats: [
      { label: 'Visits today', value: num(w, 'visitsToday'), tone: 'teal' },
      { label: 'Follow-ups due', value: num(w, 'followupsDue'), tone: 'red' },
      { label: 'Bids closing', value: num(w, 'bidsClosing'), tone: 'ochre' },
    ],
    cta: { href: '/visits', label: 'Plan a visit' },
    body: (
      <>
        <Grid className="lg:grid-cols-3">
          <Panel className="lg:col-span-2" title="This week's visits" icon={<Calendar size={15} />} tone="teal" href="/visits" hrefLabel="Tour planner">
            <ItemList items={list(w, 'agenda')} dateMode="day" empty="No visits planned this week. Use “Plan a visit” to add one." />
          </Panel>
          <Panel title="Follow-ups due" icon={<Clock size={15} />} tone="red" href="/leads" hrefLabel="All leads">
            <ItemList items={list(w, 'followups')} dateMode="day" money={inr} empty="No follow-ups due in the next 3 days" />
          </Panel>
        </Grid>
        <Kpis
          items={[
            { label: 'My pipeline', value: lakh(num(w, 'pipelineLakh')), sub: `${num(w, 'openLeads')} open leads`, href: '/leads', icon: <Target size={15} />, tone: 'teal' },
            { label: 'Open proposals', value: num(w, 'proposalsOpen'), sub: 'Requested or with the customer', href: '/proposals', icon: <Layers size={15} />, tone: 'ink' },
            { label: 'Demos in progress', value: num(w, 'demosOpen'), sub: 'Requested by you', href: '/demos', icon: <Box size={15} />, tone: 'teal' },
            { label: 'My expense claims', value: num(w, 'claimsLive'), sub: `${inr(num(w, 'claimsAmount'))} in approval`, chip: num(w, 'claimsDraft') ? `${num(w, 'claimsDraft')} draft` : undefined, href: '/expenses', icon: <Wallet size={15} />, tone: num(w, 'claimsClarify') ? 'red' : 'ochre' },
          ]}
        />
        <Grid className="md:grid-cols-2 xl:grid-cols-3">
          <Panel title="My proposals" icon={<Layers size={15} />} tone="ink" href="/proposals" hrefLabel="All">
            <ItemList items={list(w, 'proposals')} dateMode="day" empty="No open proposals" />
          </Panel>
          <Panel title="My bids closing" icon={<FileText size={15} />} tone="red" href="/tenders?scope=my_tenders" hrefLabel="My tenders">
            <ItemList items={list(w, 'bids')} dateMode="countdown" countdown={countdown} empty="None of your bids close this week" />
          </Panel>
          <Panel title="My demos" icon={<Box size={15} />} tone="teal" href="/demos" hrefLabel="All demos">
            <ItemList items={list(w, 'demos')} dateMode="day" empty="No demos in progress" />
          </Panel>
        </Grid>
        <Grid className="lg:grid-cols-3">
          <Panel title="Lead funnel" icon={<TrendingUp size={15} />} tone="teal" href="/leads" hrefLabel="Pipeline">
            <BarList bars={bars(w, 'funnel')} format={(n) => plural(n, 'lead')} />
          </Panel>
          <Panel className="lg:col-span-2" title="Quick actions" icon={<Zap size={15} />} tone="teal">
            <QuickActions
              actions={[
                A('New opportunity', 'Log a lead or account', '/leads', <Target size={16} />),
                A('Plan a visit', 'Client tour planner', '/visits', <Calendar size={16} />),
                A('Request a demo', 'Reserve a demo unit', '/demos', <Box size={16} />),
                A('Submit expenses', 'Travel and lodging claims', '/expenses', <Receipt size={16} />),
              ]}
            />
          </Panel>
        </Grid>
      </>
    ),
  };
}

/* ----------------------------------------------------------- tender team -- */
function tender(w: W): DeskView {
  const won = num(w, 'won');
  const lost = num(w, 'lost');
  const rate = pct(won, won + lost);
  return {
    eyebrow: 'Bid desk',
    summary: sentence(
      [
        [num(w, 'closing48h'), 'bid closes within 48 hours', 'bids close within 48 hours'],
        [num(w, 'awaitingApproval'), 'bid waits for participation approval', 'bids wait for participation approval'],
        [num(w, 'underPreparation'), 'bid is being prepared', 'bids are being prepared'],
      ],
      'No deadlines in the next 48 hours. Good time to clear PQ documents for upcoming bids.',
    ),
    stats: [
      { label: 'Close ≤ 48h', value: num(w, 'closing48h'), tone: 'red' },
      { label: 'Close ≤ 7d', value: num(w, 'closing7d'), tone: 'ochre' },
      { label: 'To approve', value: num(w, 'awaitingApproval'), tone: 'teal' },
    ],
    cta: { href: '/tenders', label: 'Open bid pipeline' },
    body: (
      <>
        <Kpis
          items={[
            { label: 'Bids in preparation', value: num(w, 'underPreparation'), sub: `${num(w, 'identified')} identified, not started`, href: '/tenders', icon: <Layers size={15} />, tone: 'ochre' },
            { label: 'Submitted / in evaluation', value: num(w, 'inEvaluation'), sub: 'PQ, technical, commercial, RA', href: '/tenders', icon: <ShieldCheck size={15} />, tone: 'ink' },
            { label: 'Win rate', value: `${rate}%`, sub: `${won} won · ${lost} lost`, href: '/reports', icon: <Award size={15} />, tone: 'green', progress: rate },
            { label: 'EMD at stake', value: inr(num(w, 'emdAtStake')), sub: 'Bids prepared or submitted', href: '/tenders', icon: <Wallet size={15} />, tone: 'teal' },
          ]}
        />
        <Grid className="lg:grid-cols-3">
          <Panel className="lg:col-span-2" title="Deadline board" icon={<Clock size={15} />} tone="red" href="/tenders" hrefLabel="All bids">
            <ItemList items={list(w, 'deadlines')} dateMode="countdown" countdown={countdown} money={(n) => (n ? `EMD ${formatINR(n)}` : 'EMD exempt')} empty="No open bid closes in the next 30 days" />
          </Panel>
          <Panel title="Bid pipeline" icon={<TrendingUp size={15} />} tone="ink" href="/reports" hrefLabel="Win/loss">
            <BarList bars={bars(w, 'stages')} tone="ink" />
          </Panel>
        </Grid>
        <Grid className="lg:grid-cols-3">
          <Panel title="Awaiting participation approval" icon={<Key size={15} />} tone="ochre" href="/tenders" hrefLabel="Approvals">
            <ItemList items={list(w, 'approvals')} dateMode="countdown" countdown={countdown} money={(n) => `Est. ${inr(n)}`} empty="No bid waits for approval" />
          </Panel>
          <Panel title="In evaluation" icon={<ShieldCheck size={15} />} tone="ink" href="/tenders" hrefLabel="Results">
            <ItemList items={list(w, 'evaluation')} dateMode="ago" empty="No bids in evaluation" />
          </Panel>
          <Panel title="Quick actions" icon={<Zap size={15} />} tone="teal">
            <QuickActions
              actions={[
                A('Tender pipeline', 'Prepare and submit bids', '/tenders', <FileText size={16} />),
                A('Proposals', 'Commercial quotes', '/proposals', <Layers size={16} />),
                A('Tasks', 'PQ documents and milestones', '/tasks', <CheckSquare size={16} />),
                A('Reports', 'Win/loss analytics', '/reports', <TrendingUp size={16} />),
              ]}
            />
          </Panel>
        </Grid>
      </>
    ),
  };
}

/* ------------------------------------------------------------- demo team -- */
function demo(w: W): DeskView {
  return {
    eyebrow: 'Demo & depot desk',
    summary: sentence(
      [
        [num(w, 'thisWeek'), 'demo is scheduled this week', 'demos are scheduled this week'],
        [num(w, 'pendingRequests'), 'request waits for planning', 'requests wait for planning'],
        [num(w, 'conflicts'), 'unit is double-booked', 'units are double-booked'],
        [num(w, 'outcomesDue'), 'outcome report is due', 'outcome reports are due'],
      ],
      'No demos or requests waiting. The fleet is ready for the next booking.',
    ),
    stats: [
      { label: 'This week', value: num(w, 'thisWeek'), tone: 'teal' },
      { label: 'Requests', value: num(w, 'pendingRequests'), tone: 'ochre' },
      { label: 'Conflicts', value: num(w, 'conflicts'), tone: 'red' },
    ],
    cta: { href: '/demos', label: 'Open demo pipeline' },
    body: (
      <>
        <Kpis
          items={[
            { label: 'Demos this week', value: num(w, 'thisWeek'), sub: num(w, 'overdue') ? `${num(w, 'overdue')} past their date` : 'All on schedule', href: '/demos', icon: <Calendar size={15} />, tone: num(w, 'overdue') ? 'red' : 'teal' },
            { label: 'Requests waiting', value: num(w, 'pendingRequests'), sub: 'Highest tender value first', href: '/demos', icon: <ListChecks size={15} />, tone: 'ochre' },
            { label: 'Assigned to me', value: num(w, 'assignedToMe'), sub: 'Open demos', href: '/demos', icon: <Users size={15} />, tone: 'ink' },
            { label: 'Outcome reports due', value: num(w, 'outcomesDue'), sub: 'Completed, no report yet', href: '/demos', icon: <FileText size={15} />, tone: num(w, 'outcomesDue') ? 'red' : 'green' },
          ]}
        />
        <Grid className="lg:grid-cols-3">
          <Panel className="lg:col-span-2" title="This week's schedule" icon={<Calendar size={15} />} tone="teal" href="/demos" hrefLabel="Calendar">
            <ItemList items={list(w, 'schedule')} dateMode="day" empty="No demos scheduled in the next 7 days" />
          </Panel>
          <Panel title="Priority queue" icon={<Award size={15} />} tone="ochre" href="/demos" hrefLabel="All requests">
            <ItemList items={list(w, 'requests')} dateMode="day" money={inr} empty="No requests waiting" />
          </Panel>
        </Grid>
        <Grid className="lg:grid-cols-3">
          <Panel className="lg:col-span-2" title="Demo fleet" icon={<Box size={15} />} tone="teal" href="/demos" hrefLabel="Equipment">
            <StatStrip
              stats={[
                { label: 'Available', value: num(w, 'fleetAvailable'), tone: 'green' },
                { label: 'Reserved', value: num(w, 'fleetReserved'), tone: 'ochre' },
                { label: 'In use', value: num(w, 'fleetInUse'), tone: 'teal' },
                { label: 'Maintenance', value: num(w, 'fleetMaintenance'), tone: 'red' },
              ]}
            />
            <BarList bars={bars(w, 'depots')} format={(n) => `${n} free`} secondaryLabel={(n) => `of ${n}`} tone="green" />
          </Panel>
          <Panel title="Outcome reports due" icon={<FileText size={15} />} tone="red" href="/demos" hrefLabel="Demos">
            <ItemList items={list(w, 'outcomes')} dateMode="day" empty="Every completed demo has its outcome report" />
          </Panel>
        </Grid>
        <Panel title="Quick actions" icon={<Zap size={15} />} tone="teal">
          <div className="sm:[&_.dx-qa]:grid sm:[&_.dx-qa]:grid-cols-2 xl:[&_.dx-qa]:grid-cols-4">
            <QuickActions
              actions={[
                A('Demo pipeline', 'Requests, dates, engineers', '/demos', <Box size={16} />),
                A('Deliveries', 'Dispatch and handover', '/deliveries', <Truck size={16} />),
                A('Field trials', 'Visits in the field', '/visits', <MapPin size={16} />),
                A('Freight claims', 'Transit and freight costs', '/expenses', <Receipt size={16} />),
              ]}
            />
          </div>
        </Panel>
      </>
    ),
  };
}

/* ---------------------------------------------------------- service team -- */
function service(w: W): DeskView {
  const hours = num(w, 'avgClosureHours');
  return {
    eyebrow: 'Service desk',
    summary: sentence(
      [
        [num(w, 'overdue'), 'of your tickets is past SLA', 'of your tickets are past SLA'],
        [num(w, 'critical'), 'critical (LD risk) ticket is yours', 'critical (LD risk) tickets are yours'],
        [num(w, 'awaitingParts'), 'ticket waits for spares', 'tickets wait for spares'],
        [num(w, 'unassigned'), 'new ticket has no engineer yet', 'new tickets have no engineer yet'],
      ],
      'Your queue is within SLA. Pick up an unassigned ticket or close out a report.',
    ),
    stats: [
      { label: 'My open', value: num(w, 'open'), tone: 'teal' },
      { label: 'Past SLA', value: num(w, 'overdue'), tone: 'red' },
      { label: 'Critical', value: num(w, 'critical'), tone: 'ochre' },
    ],
    cta: { href: '/service', label: 'Open my tickets' },
    body: (
      <>
        {/* §34 service KPIs */}
        <Kpis
          items={[
            { label: 'My open tickets', value: num(w, 'open'), sub: `${num(w, 'resolved30d')} resolved in 30 days`, chip: num(w, 'visitsScheduled') ? `${num(w, 'visitsScheduled')} visits booked` : undefined, href: '/service', icon: <Wrench size={15} />, tone: num(w, 'overdue') ? 'red' : 'teal' },
            { label: 'Awaiting spares', value: num(w, 'awaitingParts'), sub: 'Parts bottleneck', href: '/service', icon: <Box size={15} />, tone: num(w, 'awaitingParts') ? 'ochre' : 'green' },
            { label: 'Repeat complaints', value: num(w, 'repeatComplaints'), sub: 'Same machine again', href: '/service', icon: <RefreshCw size={15} />, tone: num(w, 'repeatComplaints') ? 'red' : 'green' },
            { label: 'Avg. closure time', value: hours ? (hours >= 48 ? `${Math.round(hours / 24)}d` : `${hours}h`) : '—', sub: 'Last 90 days, all engineers', href: '/service', icon: <Clock size={15} />, tone: 'ink' },
          ]}
        />
        <Grid className="lg:grid-cols-3">
          <Panel className="lg:col-span-2" title="My queue · by SLA" icon={<ListChecks size={15} />} tone="red" href="/service" hrefLabel="All tickets">
            <ItemList items={list(w, 'queue')} dateMode="countdown" countdown={countdown} empty="No open tickets assigned to you" />
          </Panel>
          <Panel title="Engineer workload" icon={<Users size={15} />} tone="teal" href="/service" hrefLabel="Workload">
            <BarList bars={bars(w, 'workload')} format={(n) => plural(n, 'open')} secondaryLabel={(n) => (n ? `${n} late` : '')} />
          </Panel>
        </Grid>
        <Grid className="lg:grid-cols-3">
          <Panel className="lg:col-span-2" title={`Unassigned pool · ${num(w, 'unassigned')}`} icon={<AlertTriangle size={15} />} tone="ochre" href="/service" hrefLabel="Pick up">
            <ItemList items={list(w, 'unassigned')} dateMode="ago" empty="Every ticket has an engineer" />
          </Panel>
          <Panel title="Quick actions" icon={<Zap size={15} />} tone="teal">
            <QuickActions
              actions={[
                A('Service desk', 'Tickets and SLAs', '/service', <Wrench size={16} />),
                A('Field visits', 'Check in and out', '/visits', <MapPin size={16} />),
                A('Installations', 'Deliveries to install', '/deliveries', <Truck size={16} />),
                A('Expense claim', 'Spares and travel', '/expenses', <Receipt size={16} />),
              ]}
            />
          </Panel>
        </Grid>
      </>
    ),
  };
}

/* -------------------------------------------------------------- accounts -- */
function accounts(w: W): DeskView {
  return {
    eyebrow: 'Finance desk',
    summary: sentence(
      [
        [num(w, 'stage2Pending'), `claim waits for stage-2 review (${inr(num(w, 'stage2Amount'))})`, `claims wait for stage-2 review (${inr(num(w, 'stage2Amount'))})`],
        [num(w, 'awaitingPayment'), 'approved claim waits for payment', 'approved claims wait for payment'],
        [num(w, 'clarification'), 'claim is back with the employee for clarification', 'claims are back with employees for clarification'],
      ],
      'The settlement queue is clear. Export this month’s processed claims to Tally when ready.',
    ),
    stats: [
      { label: 'Stage 2', value: num(w, 'stage2Pending'), tone: 'red' },
      { label: 'To pay', value: num(w, 'awaitingPayment'), tone: 'ochre' },
      { label: 'Clarification', value: num(w, 'clarification'), tone: 'teal' },
    ],
    cta: { href: '/expenses/accounts', label: 'Open settlement queue' },
    body: (
      <>
        <Kpis
          items={[
            { label: 'Stage-2 review', value: inr(num(w, 'stage2Amount')), sub: plural(num(w, 'stage2Pending'), 'claim'), href: '/expenses/accounts', icon: <Receipt size={15} />, tone: num(w, 'stage2Pending') ? 'red' : 'green' },
            { label: 'Approved, to pay', value: inr(num(w, 'awaitingPaymentAmount')), sub: plural(num(w, 'awaitingPayment'), 'claim'), href: '/expenses/accounts', icon: <Wallet size={15} />, tone: 'ochre' },
            { label: 'Settled this month', value: inr(num(w, 'settledThisMonthAmount')), sub: `${plural(num(w, 'settledThisMonth'), 'claim')} into Tally`, href: '/expenses/reports', icon: <Award size={15} />, tone: 'green' },
            { label: 'With managers', value: num(w, 'withManagers'), sub: 'Stage 1, coming your way', href: '/expenses', icon: <Users size={15} />, tone: 'ink' },
          ]}
        />
        <Grid className="lg:grid-cols-3">
          <Panel className="lg:col-span-2" title="Settlement queue · oldest first" icon={<ListChecks size={15} />} tone="red" href="/expenses/accounts" hrefLabel="All claims">
            <ItemList
              items={list(w, 'queue')}
              right={(it) => {
                const days = (it as DeckItem & { figures?: Record<string, number> }).figures?.days ?? 0;
                return (
                  <>
                    <span className="dx-items__amt">{it.amount != null ? formatINR(it.amount) : '—'}</span>
                    <span className="dx-items__day" data-overdue={days > 7 || undefined}>
                      {days === 0 ? 'Today' : `${days}d waiting`}
                    </span>
                  </>
                );
              }}
              empty="No claims waiting for accounts"
            />
          </Panel>
          <Panel title="Queue ageing" icon={<Clock size={15} />} tone="ochre">
            <BarList bars={bars(w, 'aging')} format={(n) => plural(n, 'claim')} tone="ochre" />
          </Panel>
        </Grid>
        <Panel title="Quick actions" icon={<Zap size={15} />} tone="teal">
          <div className="sm:[&_.dx-qa]:grid sm:[&_.dx-qa]:grid-cols-2 xl:[&_.dx-qa]:grid-cols-4">
            <QuickActions
              actions={[
                A('Settle claims', 'Stage-2 reimbursements', '/expenses/accounts', <Receipt size={16} />),
                A('Tally export', 'Excel for reconciliation', '/expenses/reports', <TrendingUp size={16} />),
                A('All claims', 'Search and filter', '/expenses', <Wallet size={16} />),
                A('Finance tasks', 'Milestones and follow-ups', '/tasks', <CheckSquare size={16} />),
              ]}
            />
          </div>
        </Panel>
      </>
    ),
  };
}

/* ----------------------------------------------------------------- admin -- */
function admin(w: W): DeskView {
  const hygiene = num(w, 'noManager') + num(w, 'noZone');
  return {
    eyebrow: 'System console',
    summary: sentence(
      [
        [num(w, 'deadLetters'), 'failed background event needs a replay', 'failed background events need a replay'],
        [num(w, 'noManager'), 'field user has no reporting manager', 'field users have no reporting manager'],
        [num(w, 'noZone'), 'field user has no zone', 'field users have no zone'],
      ],
      `All ${num(w, 'activeUsers')} accounts are configured and background jobs are healthy.`,
    ),
    stats: [
      { label: 'Active users', value: num(w, 'activeUsers'), tone: 'teal' },
      { label: 'Audit 24h', value: num(w, 'audit24h'), tone: 'ink' },
      { label: 'Dead letters', value: num(w, 'deadLetters'), tone: 'red' },
    ],
    cta: { href: '/admin', label: 'Open administration' },
    body: (
      <>
        <Kpis
          items={[
            { label: 'User accounts', value: num(w, 'activeUsers'), sub: `${num(w, 'inactiveUsers')} deactivated`, href: '/admin', icon: <Users size={15} />, tone: 'teal' },
            { label: 'Product masters', value: num(w, 'products'), sub: `${num(w, 'equipment')} demo units`, href: '/admin', icon: <Database size={15} />, tone: 'ink' },
            { label: 'Territory structure', value: num(w, 'zones'), sub: `zones · ${num(w, 'regions')} regions`, href: '/admin', icon: <Compass size={15} />, tone: 'teal' },
            { label: 'Data hygiene', value: hygiene, sub: hygiene ? 'Users missing manager or zone' : 'Every field user is mapped', href: '/admin', icon: <ShieldCheck size={15} />, tone: hygiene ? 'red' : 'green' },
          ]}
        />
        <Grid className="lg:grid-cols-3">
          <Panel className="lg:col-span-2" title="Recent audit trail" icon={<Key size={15} />} tone="ink" href="/admin" hrefLabel="Full log">
            <ItemList items={list(w, 'audit')} dateMode="ago" empty="No audit entries yet" />
          </Panel>
          <Panel title="Users by role" icon={<Users size={15} />} tone="teal" href="/admin" hrefLabel="Manage">
            <BarList bars={bars(w, 'roles')} format={(n) => plural(n, 'user')} />
          </Panel>
        </Grid>
        <Grid className="lg:grid-cols-3">
          <Panel className="lg:col-span-2" title="Newest accounts" icon={<Users size={15} />} tone="green" href="/admin" hrefLabel="Users">
            <ItemList items={list(w, 'newUsers')} dateMode="ago" empty="No users yet" />
          </Panel>
          <Panel title="Quick actions" icon={<Zap size={15} />} tone="teal">
            <QuickActions
              actions={[
                A('Administration', 'Users, roles, masters', '/admin', <Settings size={16} />),
                A('Audit trail', 'Security log', '/admin', <Key size={16} />),
                A('Reports', 'Consolidated records', '/reports', <TrendingUp size={16} />),
                A('Notifications', 'Alerts and escalations', '/notifications', <Zap size={16} />),
              ]}
            />
          </Panel>
        </Grid>
      </>
    ),
  };
}

const DESKS: Record<UserRole, (w: W) => DeskView> = {
  management,
  regional_manager: regional,
  sales,
  tender_team: tender,
  demo_team: demo,
  service_team: service,
  accounts,
  admin,
};

/* ------------------------------------------------------------------ page -- */
export default function DashboardPage() {
  const { user } = useAuth();
  const role = (user?.role || 'management') as UserRole;
  const [data, setData] = useState<W | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await api.get<W>('/dashboard/workspace'));
    } catch (e: any) {
      setError(e?.message || 'Could not load your dashboard.');
    }
  }, []);

  useEffect(() => {
    setData(null);
    load();
  }, [role, load]);

  if (error && !data) {
    return (
      <PageContainer>
        <InfoCallout variant="danger" title="Dashboard did not load">
          <p className="text-xs">{error}</p>
          <Button size="sm" variant="secondary" className="mt-3" leftIcon={<RefreshCw className="h-3.5 w-3.5" />} onClick={load}>
            Try again
          </Button>
        </InfoCallout>
      </PageContainer>
    );
  }
  // a role switch keeps the previous desk's data until the new one arrives — never show one role another's desk
  if (!data || data.role !== role) {
    return (
      <PageContainer>
        <PageLoader label="Loading your dashboard" rows={4} />
      </PageContainer>
    );
  }

  const view = (DESKS[role] ?? management)(data);
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const preset = PRESET_ROLE_USERS[role];
  const firstName = (user?.full_name || preset?.name || 'there').split(' ')[0];

  return (
    <PageContainer className="dx-root" data-desk={role}>
      <HeroBanner
        eyebrow={view.eyebrow}
        greeting={greeting}
        name={firstName}
        roleLabel={preset?.title || role.replace(/_/g, ' ')}
        zone={data.scopeLabel}
        dateLabel={new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })}
        summary={view.summary}
        stats={view.stats}
        ctaHref={view.cta.href}
        ctaLabel={view.cta.label}
      />
      {view.body}
    </PageContainer>
  );
}
