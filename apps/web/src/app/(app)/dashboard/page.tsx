'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Award,
  Box,
  Calendar,
  CheckSquare,
  Compass,
  FileText,
  Key,
  Layers,
  Receipt,
  Settings,
  Target,
  TrendingUp,
  Truck,
  Users,
  Wrench,
  Zap,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';
import { PageContainer, PageLoader } from '@/components/ui';
import { DeadlineChip } from '@/components/tender/Countdown';
import {
  AttentionList,
  KpiTile,
  Panel,
  QuickActions,
  RingGauge,
  StackBar,
  Timeline,
  timeAgo,
  type AttentionItem,
  type KpiProps,
  type QuickAction,
  type Segment,
  type TimelineItem,
  type Tone,
} from '@/components/dashboard/command/CommandDeck';
import { formatINR, formatLakh, type UserRole } from '@arihant/shared';
import type { DashboardMetricsDto } from '@arihant/shared';

type Rows = any[];
interface Data {
  m: DashboardMetricsDto | null;
  closing: Rows;
  visits: Rows;
  leads: Rows;
  demos: Rows;
  service: Rows;
  expenses: Rows;
  tasks: Rows;
  totals: { visits: number; leads: number; demos: number; service: number; expenses: number; tasks: number };
  svc: any | null;
  admin: { users: number; products: number; audit: number } | null;
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);
const rows = (res: any): Rows => (Array.isArray(res) ? res : Array.isArray(res?.data) ? res.data : []);
const totalOf = (res: any): number => num(res?.total ?? rows(res).length);

/* ---------------------------------------------------------------- KPIs -- */
function kpisFor(role: UserRole, d: Data): KpiProps[] {
  const m = d.m;
  const t = m?.tendersCount;
  const l = m?.leadsCount;
  const k = m?.tasksCount;
  const e = m?.expensesCount;
  const s = m?.serviceTicketsCount;
  const v = m?.visitsCount;
  const claimsWaiting = num(e?.pendingManager) + num(e?.pendingAccounts);

  const tenders = (label: string): KpiProps => ({
    label,
    value: num(t?.closingSoon),
    sub: `${num(t?.total)} bids tracked`,
    chip: num(t?.awaitingApproval) ? `${num(t?.awaitingApproval)} to approve` : undefined,
    href: '/tenders',
    icon: <FileText size={15} />,
    tone: num(t?.closingSoon) > 0 ? 'red' : 'teal',
  });
  const pipeline = (label: string, href = '/leads'): KpiProps => ({
    label,
    value: formatLakh(num(l?.totalValueLakh)),
    sub: `${num(l?.active)} active · ${num(l?.expected)} expected`,
    chip: num(l?.followUp) ? `${num(l?.followUp)} follow-ups` : undefined,
    href,
    icon: <Target size={15} />,
    tone: 'teal',
  });
  const reimb: KpiProps = {
    label: 'Pending reimbursements',
    value: formatINR(num(e?.pendingAmount)),
    sub: `${claimsWaiting} claims awaiting action`,
    href: '/expenses',
    icon: <Receipt size={15} />,
    tone: 'ochre',
  };
  const service = (label: string): KpiProps => ({
    label,
    value: num(s?.open),
    sub: `${num(s?.critical)} critical · ${num(s?.total)} logged`,
    chip: num(d.svc?.slaBreached) ? `${num(d.svc?.slaBreached)} SLA breached` : undefined,
    href: '/service',
    icon: <Wrench size={15} />,
    tone: num(s?.critical) > 0 ? 'red' : 'teal',
    progress: pct(num(s?.total) - num(s?.open), num(s?.total)),
  });
  const tasks = (label: string): KpiProps => ({
    label,
    value: num(k?.pending),
    sub: `${num(k?.blocked)} blocked · ${num(k?.overdue)} overdue`,
    href: '/tasks',
    icon: <CheckSquare size={15} />,
    tone: num(k?.blocked) + num(k?.overdue) > 0 ? 'ochre' : 'teal',
    progress: pct(num(k?.total) - num(k?.pending), num(k?.total)),
  });
  const visits = (label: string): KpiProps => ({
    label,
    value: num(v?.planned),
    sub: `${num(v?.completed)} completed of ${num(v?.total)}`,
    href: '/visits',
    icon: <Calendar size={15} />,
    tone: 'teal',
    progress: pct(num(v?.completed), num(v?.total)),
  });

  switch (role) {
    case 'management':
      return [tenders('Tenders closing ≤ 7 days'), pipeline('Active pipeline'), reimb, service('Open service tickets')];
    case 'regional_manager':
      return [pipeline('Zone pipeline', '/regional'), tenders('Territory bids closing'), visits('Field tours planned'), tasks('Team tasks in progress')];
    case 'sales':
      return [
        pipeline('My pipeline'),
        {
          // the metrics endpoint counts every tender; the tender list is already scoped to this salesperson
          label: 'My bids closing',
          value: d.closing.length,
          sub: 'Assigned to you, closing within 7 days',
          href: '/tenders?scope=my_tenders',
          icon: <FileText size={15} />,
          tone: d.closing.length > 0 ? 'red' : 'teal',
        },
        visits('My planned visits'),
        tasks('My open tasks'),
      ];
    case 'tender_team':
      return [
        tenders('Closing ≤ 7 days'),
        { label: 'Under preparation', value: num(t?.underPreparation), sub: 'Bids being drafted', href: '/tenders', icon: <Layers size={15} />, tone: 'ochre' },
        { label: 'Awaiting approval', value: num(t?.awaitingApproval), sub: 'Pending management sign-off', href: '/tenders', icon: <Key size={15} />, tone: 'red' },
        {
          label: 'Win rate',
          value: `${pct(num(t?.won), num(t?.won) + num(t?.lost))}%`,
          sub: `${num(t?.won)} won · ${num(t?.lost)} lost`,
          href: '/tenders',
          icon: <Award size={15} />,
          tone: 'green',
          progress: pct(num(t?.won), num(t?.won) + num(t?.lost)),
        },
      ];
    case 'demo_team':
      return [
        { label: 'Demonstrations', value: d.totals.demos, sub: 'Requests & trials on record', href: '/demos', icon: <Box size={15} />, tone: 'teal' },
        visits('Field trials planned'),
        {
          label: 'Deliveries in transit',
          value: num(m?.deliveriesCount?.inTransit),
          sub: `${num(m?.deliveriesCount?.scheduled)} scheduled`,
          href: '/deliveries',
          icon: <Truck size={15} />,
          tone: 'ochre',
        },
        tasks('Open tasks'),
      ];
    case 'service_team':
      return [
        service('Open tickets'),
        { label: 'Critical (LD risk)', value: num(s?.critical), sub: 'Liquidated-damages exposure', href: '/service', icon: <AlertTriangle size={15} />, tone: num(s?.critical) ? 'red' : 'teal' },
        { label: 'Awaiting spares', value: num(d.svc?.awaitingParts), sub: 'Parts bottleneck', href: '/service', icon: <Box size={15} />, tone: 'ochre' },
        visits('Visits planned'),
      ];
    case 'accounts':
      return [
        { label: 'Stage 2: awaiting accounts', value: num(e?.pendingAccounts), sub: 'Manager-approved, ready to settle', href: '/expenses', icon: <Receipt size={15} />, tone: 'red' },
        { label: 'Stage 1: with managers', value: num(e?.pendingManager), sub: 'Awaiting RM endorsement', href: '/expenses', icon: <Users size={15} />, tone: 'ochre' },
        { label: 'Amount pending', value: formatINR(num(e?.pendingAmount)), sub: 'Across all open claims', href: '/expenses', icon: <TrendingUp size={15} />, tone: 'teal' },
        { label: 'Settled & reconciled', value: num(e?.processed), sub: 'Processed into Tally', href: '/expenses', icon: <Award size={15} />, tone: 'green' },
      ];
    case 'admin':
      return [
        { label: 'User accounts', value: d.admin?.users ?? 0, sub: 'Across all roles', href: '/admin', icon: <Users size={15} />, tone: 'teal' },
        { label: 'Equipment masters', value: d.admin?.products ?? 0, sub: 'Products & MHA QRs', href: '/admin', icon: <Box size={15} />, tone: 'teal' },
        { label: 'Audit entries', value: d.admin?.audit ?? 0, sub: 'Immutable trail', href: '/admin', icon: <Key size={15} />, tone: 'ink' },
        { label: 'Open exceptions', value: m?.recentExceptions?.length ?? 0, sub: 'Needing attention', href: '/notifications', icon: <AlertTriangle size={15} />, tone: (m?.recentExceptions?.length ?? 0) > 0 ? 'red' : 'teal' },
      ];
    default:
      return [tenders('Tenders closing'), pipeline('Pipeline'), reimb, tasks('Tasks')];
  }
}

/* ------------------------------------------------------------ attention -- */
/** which roles act on which kind of exception (the metrics feed is organisation-wide) */
const EXCEPTION_ROLES: Record<string, UserRole[]> = {
  tender_deadline: ['management', 'regional_manager', 'tender_team', 'sales', 'admin'],
  tender_approval: ['management', 'regional_manager', 'tender_team', 'admin'],
  expense_approval: ['management', 'regional_manager', 'accounts', 'admin'],
  task_blocked: ['management', 'regional_manager', 'sales', 'tender_team', 'demo_team', 'service_team', 'accounts', 'admin'],
  task_overdue: ['management', 'regional_manager', 'sales', 'tender_team', 'demo_team', 'service_team', 'accounts', 'admin'],
};
const EXCEPTION_HREF: Record<string, string> = {
  tender_deadline: '/tenders',
  tender_approval: '/tenders',
  task_blocked: '/tasks',
  task_overdue: '/tasks',
  expense_approval: '/expenses',
};

function attentionFor(role: UserRole, d: Data): AttentionItem[] {
  const out: AttentionItem[] = [];
  const wants = (...roles: UserRole[]) => roles.includes(role);

  if (wants('management', 'regional_manager', 'tender_team', 'sales', 'admin')) {
    d.closing
      .filter((t) => t.submission_deadline && new Date(t.submission_deadline).getTime() > Date.now()) // closed/past bids are history, not action
      .slice(0, 5)
      .forEach((t) =>
      out.push({
        id: `t-${t.id}`,
        severity: 'critical',
        title: t.tender_no || 'Tender',
        detail: `${t.department || t.organisation || 'Buyer'}${t.emd_fee ? ` · EMD ${formatINR(Number(t.emd_fee))}` : ''}`,
        href: '/tenders',
        right: <DeadlineChip deadline={t.submission_deadline} />,
      }),
    );
  }
  if (wants('service_team', 'management', 'regional_manager', 'admin', 'sales')) {
    d.service
      .filter((s) => s.priority === 'critical' && !['resolved', 'report_submitted', 'closed', 'cancelled'].includes(s.status))
      .slice(0, 4)
      .forEach((s) =>
        out.push({
          id: `s-${s.id}`,
          severity: 'critical',
          title: `${s.ticket_no || 'Ticket'} · critical`,
          detail: `${s.organisation_name || 'Customer'} — ${String(s.status).replace(/_/g, ' ')}`,
          href: '/service',
          right: s.sla_resolution_due_at ? <DeadlineChip deadline={s.sla_resolution_due_at} /> : undefined,
        }),
      );
  }
  if (wants('management', 'regional_manager', 'accounts', 'admin', 'sales')) {
    d.expenses
      .filter((x) => ['submitted', 'manager_approved'].includes(x.status))
      .slice(0, 3)
      .forEach((x) =>
        out.push({
          id: `e-${x.id}`,
          severity: 'warning',
          title: `${formatINR(Number(x.amount) || 0)} · ${String(x.category || 'claim').replace(/_/g, ' ')}`,
          detail: `${x.employee_name || 'Employee'} — ${x.status === 'submitted' ? 'awaiting manager' : 'awaiting accounts'}`,
          href: '/expenses',
          when: timeAgo(x.created_at),
        }),
      );
  }
  d.tasks
    .filter((t) => ['blocked', 'overdue'].includes(String(t.status)))
    .slice(0, 3)
    .forEach((t) =>
      out.push({
        id: `k-${t.id}`,
        severity: t.status === 'blocked' ? 'warning' : 'critical',
        title: t.title || 'Task',
        detail: `${t.status === 'blocked' ? 'Blocked' : 'Overdue'}${t.assignee_name ? ` · ${t.assignee_name}` : ''}`,
        href: '/tasks',
        when: timeAgo(t.updated_at),
      }),
    );
  (d.m?.recentExceptions || [])
    .filter((x) => (EXCEPTION_ROLES[x.type] || []).includes(role))
    .slice(0, 4)
    .forEach((x) =>
    out.push({
      id: `x-${x.id}`,
      severity: x.severity === 'info' ? 'info' : x.severity,
      title: x.title,
      detail: x.description,
      href: EXCEPTION_HREF[x.type] || '/notifications',
      when: timeAgo(x.timestamp),
    }),
  );

  const rank = { critical: 0, warning: 1, info: 2 } as const;
  const seen = new Set<string>();
  return out
    .filter((i) => (seen.has(i.id) ? false : (seen.add(i.id), true)))
    .sort((a, b) => rank[a.severity] - rank[b.severity])
    .slice(0, 8);
}

/* ---------------------------------------------------------------- health -- */
interface Ring { key: string; label: string; sub: string; value: number; max: number; display?: string; tone: Tone }
function ringsFor(role: UserRole, d: Data): Ring[] {
  const m = d.m;
  const k = m?.tasksCount;
  const t = m?.tendersCount;
  const v = m?.visitsCount;
  const e = m?.expensesCount;
  const s = m?.serviceTicketsCount;
  const all: Record<string, Ring> = {
    tasks: { key: 'tasks', label: 'Tasks on track', sub: `${num(k?.overdue) + num(k?.blocked)} at risk`, value: num(k?.total) - num(k?.overdue) - num(k?.blocked), max: num(k?.total), tone: 'teal' },
    win: { key: 'win', label: 'Tender win rate', sub: `${num(t?.won)} won · ${num(t?.lost)} lost`, value: num(t?.won), max: num(t?.won) + num(t?.lost), tone: 'green' },
    visits: { key: 'visits', label: 'Visits completed', sub: `${num(v?.completed)} of ${num(v?.total)}`, value: num(v?.completed), max: num(v?.total), tone: 'teal' },
    claims: { key: 'claims', label: 'Claims cleared', sub: `${num(e?.processed)} processed`, value: num(e?.processed), max: num(e?.processed) + num(e?.pendingManager) + num(e?.pendingAccounts), tone: 'ochre' },
    service: { key: 'service', label: 'Tickets resolved', sub: `${num(s?.open)} still open`, value: num(s?.total) - num(s?.open), max: num(s?.total), tone: 'red' },
    sla: { key: 'sla', label: 'Within SLA', sub: `${num(d.svc?.slaBreached)} breached`, value: Math.max(0, num(d.svc?.pendingTickets) - num(d.svc?.slaBreached)), max: num(d.svc?.pendingTickets), tone: 'red' },
  };
  const pick: Record<string, string[]> = {
    management: ['win', 'tasks', 'service'],
    regional_manager: ['visits', 'tasks', 'win'],
    sales: ['visits', 'tasks', 'win'],
    tender_team: ['win', 'tasks', 'claims'],
    demo_team: ['visits', 'tasks', 'service'],
    service_team: ['service', 'sla', 'visits'],
    accounts: ['claims', 'tasks', 'win'],
    admin: ['tasks', 'service', 'win'],
  };
  return (pick[role] || pick.management).map((key) => all[key]);
}

function segmentsFor(role: UserRole, d: Data): { title: string; segments: Segment[] }[] {
  const m = d.m;
  const t = m?.tendersCount;
  const l = m?.leadsCount;
  const k = m?.tasksCount;
  const e = m?.expensesCount;
  const s = m?.serviceTicketsCount;
  const sets: Record<string, { title: string; segments: Segment[] }> = {
    tenders: {
      title: 'Tender pipeline',
      segments: [
        { label: 'Under preparation', value: num(t?.underPreparation), tone: 'ochre' },
        { label: 'Awaiting approval', value: num(t?.awaitingApproval), tone: 'red' },
        { label: 'Won', value: num(t?.won), tone: 'green' },
        { label: 'Lost', value: num(t?.lost), tone: 'ink' },
      ],
    },
    leads: {
      title: 'Lead funnel',
      segments: [
        { label: 'Active', value: num(l?.active), tone: 'teal' },
        { label: 'Expected', value: num(l?.expected), tone: 'ochre' },
        { label: 'Follow-up', value: num(l?.followUp), tone: 'red' },
      ],
    },
    tasks: {
      title: 'Task load',
      segments: [
        { label: 'In progress', value: Math.max(0, num(k?.pending) - num(k?.blocked)), tone: 'teal' },
        { label: 'Blocked', value: num(k?.blocked), tone: 'ochre' },
        { label: 'Overdue', value: num(k?.overdue), tone: 'red' },
      ],
    },
    expenses: {
      title: 'Reimbursement stages',
      segments: [
        { label: 'With managers', value: num(e?.pendingManager), tone: 'ochre' },
        { label: 'With accounts', value: num(e?.pendingAccounts), tone: 'red' },
        { label: 'Settled', value: num(e?.processed), tone: 'green' },
      ],
    },
    service: {
      title: 'Service queue',
      segments: [
        { label: 'Open', value: Math.max(0, num(s?.open) - num(s?.critical)), tone: 'teal' },
        { label: 'Critical', value: num(s?.critical), tone: 'red' },
        { label: 'Resolved', value: Math.max(0, num(s?.total) - num(s?.open)), tone: 'green' },
      ],
    },
  };
  const pick: Record<string, string[]> = {
    management: ['tenders', 'leads'],
    regional_manager: ['leads', 'tasks'],
    sales: ['leads', 'tasks'],
    tender_team: ['tenders', 'tasks'],
    demo_team: ['tasks', 'service'],
    service_team: ['service', 'tasks'],
    accounts: ['expenses', 'tasks'],
    admin: ['tenders', 'service'],
  };
  return (pick[role] || pick.management).map((key) => sets[key]).filter((x) => x.segments.some((s2) => s2.value > 0));
}

/* ---------------------------------------------------------------- actions -- */
const A = (label: string, hint: string, href: string, icon: React.ReactNode): QuickAction => ({ label, hint, href, icon });
function actionsFor(role: UserRole): QuickAction[] {
  const map: Record<string, QuickAction[]> = {
    management: [
      A('Tender pipeline', 'Bids, approvals, deadlines', '/tenders', <FileText size={16} />),
      A('Regional command', 'Zones and field teams', '/regional', <Compass size={16} />),
      A('Reports', 'Consolidated exports', '/reports', <TrendingUp size={16} />),
      A('Service desk', 'Tickets, SLAs, portal requests', '/service', <Wrench size={16} />),
    ],
    regional_manager: [
      A('Territory command', 'Team scorecards', '/regional', <Compass size={16} />),
      A('Approve expenses', 'Stage 1 endorsements', '/expenses', <Receipt size={16} />),
      A('Field tours', 'Visits and directives', '/visits', <Calendar size={16} />),
      A('Leads', 'Pipeline and follow-ups', '/leads', <Target size={16} />),
    ],
    sales: [
      A('New opportunity', 'Log a lead or account', '/leads', <Target size={16} />),
      A('Plan a visit', 'Client tour planner', '/visits', <Calendar size={16} />),
      A('Request a demo', 'Reserve a demo unit', '/demos', <Box size={16} />),
      A('Proposals', 'Quotes and follow-ups', '/proposals', <FileText size={16} />),
    ],
    tender_team: [
      A('Tender pipeline', 'Prepare and submit bids', '/tenders', <FileText size={16} />),
      A('Proposals', 'Commercial quotes', '/proposals', <Layers size={16} />),
      A('Tasks', 'Blockers and milestones', '/tasks', <CheckSquare size={16} />),
      A('Reports', 'Win/loss analytics', '/reports', <TrendingUp size={16} />),
    ],
    demo_team: [
      A('Demo fleet', 'Units and availability', '/demos', <Box size={16} />),
      A('Deliveries', 'Dispatch and handover', '/deliveries', <Truck size={16} />),
      A('Field visits', 'Trials in the field', '/visits', <Calendar size={16} />),
      A('Tasks', 'Outcome certificates', '/tasks', <CheckSquare size={16} />),
    ],
    service_team: [
      A('Service desk', 'Open tickets and SLAs', '/service', <Wrench size={16} />),
      A('Field visits', 'Check in and out', '/visits', <Calendar size={16} />),
      A('Deliveries', 'Installations', '/deliveries', <Truck size={16} />),
      A('Expense claim', 'Submit travel costs', '/expenses', <Receipt size={16} />),
    ],
    accounts: [
      A('Settle claims', 'Stage 2 reimbursements', '/expenses', <Receipt size={16} />),
      A('Reports', 'Tally export', '/reports', <TrendingUp size={16} />),
      A('Tasks', 'Finance milestones', '/tasks', <CheckSquare size={16} />),
      A('Notifications', 'Alerts and directives', '/notifications', <Zap size={16} />),
    ],
    admin: [
      A('Administration', 'Users, roles, masters', '/admin', <Settings size={16} />),
      A('Audit trail', 'Security log', '/admin', <Key size={16} />),
      A('Reports', 'Consolidated records', '/reports', <TrendingUp size={16} />),
      A('Service desk', 'Operations check', '/service', <Wrench size={16} />),
    ],
  };
  return map[role] || map.management;
}

/* ------------------------------------------------------------------ page -- */
export default function DashboardPage() {
  const { user } = useAuth();
  const role = (user?.role || 'management') as UserRole;
  const [data, setData] = useState<Data | null>(null);

  useEffect(() => {
    let alive = true;
    const run = async () => {
      const safe = <T,>(p: Promise<T>) => p.catch(() => null as unknown as T);
      const needsSvc = ['service_team', 'management', 'regional_manager', 'admin'].includes(role);
      const [m, closing, visits, leads, demos, service, expenses, tasks, svc, users, products, audit] = await Promise.all([
        safe(api.get<DashboardMetricsDto>('/dashboard/metrics')),
        safe(api.get('/tenders', { closingSoonOnly: true, limit: 6 })),
        safe(api.get('/visits', { limit: 6 })),
        safe(api.get('/leads', { limit: 6 })),
        safe(api.get('/demos', { limit: 6 })),
        safe(api.get('/service', { limit: 20 })),
        safe(api.get('/expenses', { limit: 8 })),
        safe(api.get('/tasks', { limit: 8 })),
        needsSvc ? safe(api.get('/service/stats')) : Promise.resolve(null),
        role === 'admin' ? safe(api.get('/users', { limit: 1 })) : Promise.resolve(null),
        role === 'admin' ? safe(api.get('/masters/products')) : Promise.resolve(null),
        role === 'admin' ? safe(api.get('/audit', { limit: 1 })) : Promise.resolve(null),
      ]);
      if (!alive) return;
      setData({
        m: m || null,
        closing: rows(closing),
        visits: rows(visits),
        leads: rows(leads),
        demos: rows(demos),
        service: rows(service),
        expenses: rows(expenses),
        tasks: rows(tasks),
        totals: { visits: totalOf(visits), leads: totalOf(leads), demos: totalOf(demos), service: totalOf(service), expenses: totalOf(expenses), tasks: totalOf(tasks) },
        svc: svc || null,
        admin: role === 'admin' ? { users: totalOf(users), products: rows(products).length, audit: totalOf(audit) } : null,
      });
    };
    run();
    return () => {
      alive = false;
    };
  }, [role]);

  const view = useMemo(() => {
    if (!data) return null;
    return {
      kpis: kpisFor(role, data),
      attention: attentionFor(role, data),
      rings: ringsFor(role, data),
      segments: segmentsFor(role, data),
      actions: actionsFor(role),
      timeline: (data.m?.recentExceptions || []).filter((x) => (EXCEPTION_ROLES[x.type] || []).includes(role)).slice(0, 6).map(
        (x): TimelineItem => ({
          id: x.id,
          title: x.title,
          detail: x.description,
          when: timeAgo(x.timestamp),
          tone: x.severity === 'critical' ? 'red' : x.severity === 'warning' ? 'ochre' : 'teal',
          href: EXCEPTION_HREF[x.type],
        }),
      ),
    };
  }, [data, role]);

  if (!view) {
    return (
      <PageContainer>
        <PageLoader label="Loading command dashboard" rows={4} />
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <div className="dash-grid grid grid-cols-2 gap-2.5 sm:gap-4 md:grid-cols-4">
        {view.kpis.map((k) => (
          <KpiTile key={k.label} {...k} />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Panel className="lg:col-span-2" title="Needs your attention" icon={<Activity size={15} />} href="/notifications" hrefLabel="All alerts">
          <AttentionList items={view.attention} />
        </Panel>
        <Panel title="Quick actions" icon={<Zap size={15} />}>
          <QuickActions actions={view.actions} />
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Panel title="Operational health" icon={<TrendingUp size={15} />}>
          <div className="grid grid-cols-3 gap-2 p-5">
            {view.rings.map((r) => (
              <RingGauge key={r.key} label={r.label} sub={r.sub} value={Math.max(0, r.value)} max={r.max} display={r.max === 0 ? '—' : r.display} tone={r.tone} />
            ))}
          </div>
        </Panel>
        <Panel title="Pipeline mix" icon={<Layers size={15} />}>
          <div className="space-y-6 p-5">
            {view.segments.length === 0 ? (
              <p className="py-8 text-center text-xs text-[#4A5568]">Nothing to chart yet.</p>
            ) : (
              view.segments.map((s) => <StackBar key={s.title} title={s.title} segments={s.segments} />)
            )}
          </div>
        </Panel>
        <Panel title="Recent activity" icon={<AlertTriangle size={15} />} href="/notifications" hrefLabel="Open inbox">
          <Timeline items={view.timeline} empty="No exceptions or escalations right now" />
        </Panel>
      </div>
    </PageContainer>
  );
}
