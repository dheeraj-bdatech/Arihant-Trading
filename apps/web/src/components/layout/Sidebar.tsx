'use client';

import { BrandMark } from '@/components/layout/BrandMark';
import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  FileText,
  Target,
  Calendar,
  Box,
  FileSpreadsheet,
  Wrench,
  Receipt,
  CheckSquare,
  Bell,
  Settings,
  LogOut,
  Compass,
  Activity,
  PanelLeftClose,
  PanelLeftOpen,
  X,
  Truck,
  AlertTriangle,
  Search,
  ChevronDown,
  Users,
  MessageSquarePlus,
  TrendingUp,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';
import { useSidebar } from '@/lib/sidebar-context';
import { ROLE_PROFILES, type UserRole, type BosModuleKey } from '@arihant/shared';
import { useBadgeCounts, type BadgeCounts } from '@/app/(app)/expenses/_lib/expense-lib';
import { useTaskSummary, type TaskSummary } from '@/app/(app)/tasks/_lib/task-lib';

interface NavItem {
  label: string;
  href: string;
  icon: React.ElementType;
  moduleKey: BosModuleKey | 'reports';
  badge?: string;
  badgeVariant?: 'urgent' | 'cyber' | 'warning' | 'neutral';
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

/**
 * Generates custom role-tailored navigation groups and workflows for each of the 8 RBAC personas.
 */
function getRoleNavGroups(role: UserRole): NavGroup[] {
  switch (role) {
    case 'sales':
      return [
        {
          title: 'MY SALES WORKSPACE',
          items: [
            {
              label: 'Sales Field Desk',
              href: '/dashboard',
              icon: Target,
              moduleKey: 'dashboard',
              badge: 'My Deals',
              badgeVariant: 'cyber',
            },
            {
              label: 'My Leads & Accounts',
              href: '/leads',
              icon: Target,
              moduleKey: 'leads',
              badge: 'Active Funnel',
              badgeVariant: 'cyber',
            },
            {
              label: 'My Assigned Tenders',
              href: '/tenders?scope=my_tenders',
              icon: FileText,
              moduleKey: 'tenders',
              badge: 'Bids',
              badgeVariant: 'urgent',
            },
            {
              label: 'Commercial Price Quotes',
              href: '/proposals',
              icon: FileSpreadsheet,
              moduleKey: 'proposals',
            },
            {
              label: 'My Performance',
              href: '/regional/performance',
              icon: TrendingUp,
              moduleKey: 'dashboard',
            },
          ],
        },
        {
          title: 'FIELD TOURS & DEMOS',
          items: [
            {
              label: 'Client Tour Planner',
              href: '/visits',
              icon: Calendar,
              moduleKey: 'visits',
              badge: 'Tour Plan',
              badgeVariant: 'cyber',
            },
            {
              label: 'Demo Equipment Requests',
              href: '/demos',
              icon: Box,
              moduleKey: 'demos',
              badge: 'Trials',
              badgeVariant: 'neutral',
            },
            {
              label: 'Deliveries & Logistics',
              href: '/deliveries',
              icon: Truck,
              moduleKey: 'deliveries',
              badge: 'Consignments',
              badgeVariant: 'cyber',
            },
          ],
        },
        {
          title: 'CLAIMS & PRODUCTIVITY',
          items: [
            {
              label: 'Travel Expense Claims',
              href: '/expenses',
              icon: Receipt,
              moduleKey: 'expenses',
              badge: 'My Claims',
              badgeVariant: 'warning',
            },
            {
              label: 'My Tasks & Milestones',
              href: '/tasks',
              icon: CheckSquare,
              moduleKey: 'tasks',
            },
            {
              label: 'Client Directives & Alerts',
              href: '/notifications',
              icon: Bell,
              moduleKey: 'notifications',
            },
          ],
        },
      ];

    case 'tender_team':
      return [
        {
          title: 'BID CELL & GeM OPS',
          items: [
            {
              label: 'Tender War Room',
              href: '/dashboard',
              icon: FileText,
              moduleKey: 'dashboard',
              badge: 'Live Bids',
              badgeVariant: 'urgent',
            },
            {
              label: 'GeM Defence Tenders',
              href: '/tenders',
              icon: FileText,
              moduleKey: 'tenders',
              badge: '≤7d Closing',
              badgeVariant: 'urgent',
            },
            {
              label: 'Commercial Bid Proposals',
              href: '/proposals',
              icon: FileSpreadsheet,
              moduleKey: 'proposals',
              badge: 'PQ Docs',
              badgeVariant: 'cyber',
            },
            {
              label: 'Tender Win/Loss Reports',
              href: '/reports',
              icon: FileSpreadsheet,
              moduleKey: 'reports',
              badge: 'L1 Audits',
              badgeVariant: 'cyber',
            },
          ],
        },
        {
          title: 'OPERATIONAL CONTROL',
          items: [
            {
              label: 'Tender Expenses & EMDs',
              href: '/expenses',
              icon: Receipt,
              moduleKey: 'expenses',
              badge: 'EMD/Claims',
              badgeVariant: 'warning',
            },
            {
              label: 'Bid Milestones & Tasks',
              href: '/tasks',
              icon: CheckSquare,
              moduleKey: 'tasks',
            },
            {
              label: 'Corrigenda & Bid Alerts',
              href: '/notifications',
              icon: Bell,
              moduleKey: 'notifications',
            },
          ],
        },
      ];

    case 'demo_team':
      return [
        {
          title: 'DEPOT & TRIALS FLEET',
          items: [
            {
              label: 'Demo Fleet Hub',
              href: '/dashboard',
              icon: Box,
              moduleKey: 'dashboard',
              badge: 'Delhi Depot',
              badgeVariant: 'cyber',
            },
            {
              label: 'Demo Equipment Matrix',
              href: '/demos',
              icon: Box,
              moduleKey: 'demos',
              badge: 'Depot Fleet',
              badgeVariant: 'cyber',
            },
            {
              label: 'Field Trial Visits',
              href: '/visits',
              icon: Calendar,
              moduleKey: 'visits',
              badge: 'Trials Tour',
              badgeVariant: 'cyber',
            },
          ],
        },
        {
          title: 'FIELD DESK & CLAIMS',
          items: [
            {
              label: 'Transit & Freight Expenses',
              href: '/expenses',
              icon: Receipt,
              moduleKey: 'expenses',
              badge: 'Freight',
              badgeVariant: 'warning',
            },
            {
              label: 'Depot Tasks & Handover Logs',
              href: '/tasks',
              icon: CheckSquare,
              moduleKey: 'tasks',
            },
            {
              label: 'Dispatch Alerts & Directives',
              href: '/notifications',
              icon: Bell,
              moduleKey: 'notifications',
            },
          ],
        },
      ];

    case 'service_team':
      return [
        {
          title: 'SERVICE & MAINTENANCE',
          items: [
            {
              label: 'Service Support Desk',
              href: '/dashboard',
              icon: Wrench,
              moduleKey: 'dashboard',
              badge: 'SLA Triage',
              badgeVariant: 'urgent',
            },
            {
              label: 'Breakdown Tickets & AMC',
              href: '/service',
              icon: Wrench,
              moduleKey: 'service',
              badge: 'Emergency',
              badgeVariant: 'urgent',
            },
            {
              label: 'On-site Field Visits',
              href: '/visits',
              icon: Calendar,
              moduleKey: 'visits',
              badge: 'Repair Tour',
              badgeVariant: 'cyber',
            },
            {
              label: 'Deliveries & Installations',
              href: '/deliveries',
              icon: Truck,
              moduleKey: 'deliveries',
              badge: 'Commissioning',
              badgeVariant: 'cyber',
            },
          ],
        },
        {
          title: 'CLAIMS & WORKFLOW',
          items: [
            {
              label: 'Spares & Travel Expenses',
              href: '/expenses',
              icon: Receipt,
              moduleKey: 'expenses',
              badge: 'Spares/Claims',
              badgeVariant: 'warning',
            },
            {
              label: 'Repair Tasks & Preventive AMC',
              href: '/tasks',
              icon: CheckSquare,
              moduleKey: 'tasks',
            },
            {
              label: 'Service Alerts & Escalations',
              href: '/notifications',
              icon: Bell,
              moduleKey: 'notifications',
            },
          ],
        },
      ];

    case 'accounts':
      return [
        {
          title: 'FINANCE & AUDIT',
          items: [
            {
              label: 'Finance & Audit Desk',
              href: '/dashboard',
              icon: Receipt,
              moduleKey: 'dashboard',
              badge: 'Stage-2 Audit',
              badgeVariant: 'warning',
            },
            {
              label: 'Expense Claims & Payouts',
              href: '/expenses',
              icon: Receipt,
              moduleKey: 'expenses',
              badge: 'Payout Audit',
              badgeVariant: 'warning',
            },
            {
              label: 'Financial & Tax Reports',
              href: '/reports',
              icon: FileSpreadsheet,
              moduleKey: 'reports',
              badge: 'GST / Vouchers',
              badgeVariant: 'cyber',
            },
          ],
        },
        {
          title: 'FINANCIAL COMPLIANCE',
          items: [
            {
              label: 'Audit Tasks & Vouchers',
              href: '/tasks',
              icon: CheckSquare,
              moduleKey: 'tasks',
            },
            {
              label: 'Disbursement Directives',
              href: '/notifications',
              icon: Bell,
              moduleKey: 'notifications',
            },
          ],
        },
      ];

    case 'regional_manager':
      return [
        {
          title: 'TERRITORY COMMAND',
          items: [
            {
              label: 'Territory Operations Hub',
              href: '/dashboard',
              icon: Compass,
              moduleKey: 'dashboard',
              badge: 'North Zone',
              badgeVariant: 'cyber',
            },
            {
              label: 'Zonal Command & Scorecard',
              href: '/regional',
              icon: Target,
              moduleKey: 'regional',
              badge: 'Directives',
              badgeVariant: 'cyber',
            },
            {
              label: 'Sales & Regional Performance',
              href: '/regional/performance',
              icon: TrendingUp,
              moduleKey: 'regional',
            },
            {
              label: 'Regional Performance Reports',
              href: '/reports',
              icon: FileSpreadsheet,
              moduleKey: 'reports',
              badge: 'Exports',
              badgeVariant: 'cyber',
            },
          ],
        },
        {
          title: 'ZONAL PIPELINE',
          items: [
            {
              label: 'Regional GeM Tenders',
              href: '/tenders',
              icon: FileText,
              moduleKey: 'tenders',
              badge: 'Zonal Bids',
              badgeVariant: 'urgent',
            },
            {
              label: 'Territory Leads & CRM',
              href: '/leads',
              icon: Target,
              moduleKey: 'leads',
            },
            {
              label: 'Commercial Proposals',
              href: '/proposals',
              icon: FileSpreadsheet,
              moduleKey: 'proposals',
            },
          ],
        },
        {
          title: 'FIELD DEPLOYMENT',
          items: [
            {
              label: 'Client Tour Planner',
              href: '/visits',
              icon: Calendar,
              moduleKey: 'visits',
              badge: 'Also-Meet',
              badgeVariant: 'cyber',
            },
            {
              label: 'Demo Fleet Matrix',
              href: '/demos',
              icon: Box,
              moduleKey: 'demos',
            },
            {
              label: 'Demo Failures & Incident Log',
              href: '/demos?tab=failures',
              icon: AlertTriangle,
              moduleKey: 'demos',
              badge: 'Failure Audit',
              badgeVariant: 'urgent',
            },
            {
              label: 'Service Support & Spares',
              href: '/service',
              icon: Wrench,
              moduleKey: 'service',
            },
            {
              label: 'Logistics & Deliveries',
              href: '/deliveries',
              icon: Truck,
              moduleKey: 'deliveries',
              badge: 'Consignments',
              badgeVariant: 'cyber',
            },
          ],
        },
        {
          title: 'APPROVALS & DIRECTIVES',
          items: [
            {
              label: 'Expense Endorsements',
              // Stage-1 endorsement is the RM's job here; their own claims are one click away in the module's View menu.
              href: '/expenses/approvals',
              icon: Receipt,
              moduleKey: 'expenses',
              badge: 'Stage 1 RM',
              badgeVariant: 'warning',
            },
            {
              label: 'Tasks & Blocker Escalations',
              href: '/tasks',
              icon: CheckSquare,
              moduleKey: 'tasks',
            },
            {
              label: 'Zonal Alerts & Directives',
              href: '/notifications',
              icon: Bell,
              moduleKey: 'notifications',
            },
          ],
        },
      ];

    case 'admin':
      return [
        {
          title: 'SYSTEM ADMINISTRATION',
          items: [
            {
              label: 'System Admin Console',
              href: '/dashboard',
              icon: Settings,
              moduleKey: 'dashboard',
              badge: 'Masters',
              badgeVariant: 'cyber',
            },
            {
              label: 'Users & Security Audit',
              href: '/admin',
              icon: Settings,
              moduleKey: 'admin',
              badge: 'Security',
              badgeVariant: 'urgent',
            },
            {
              label: 'Consolidated Audit Reports',
              href: '/reports',
              icon: FileSpreadsheet,
              moduleKey: 'reports',
              badge: 'System Logs',
              badgeVariant: 'cyber',
            },
          ],
        },
        {
          title: 'OPERATIONAL REGISTRY',
          items: [
            {
              label: 'Regional Command Hub',
              href: '/regional',
              icon: Compass,
              moduleKey: 'regional',
            },
            {
              label: 'GeM Defence Tenders',
              href: '/tenders',
              icon: FileText,
              moduleKey: 'tenders',
              badge: 'Live',
              badgeVariant: 'urgent',
            },
            {
              label: 'Leads & CRM Registry',
              href: '/leads',
              icon: Target,
              moduleKey: 'leads',
            },
            {
              label: 'Field Tour Matrix',
              href: '/visits',
              icon: Calendar,
              moduleKey: 'visits',
            },
            {
              label: 'Demo Fleet Matrix',
              href: '/demos',
              icon: Box,
              moduleKey: 'demos',
            },
            {
              label: 'Demo Failures & Incident Log',
              href: '/demos?tab=failures',
              icon: AlertTriangle,
              moduleKey: 'demos',
              badge: 'Failure Audit',
              badgeVariant: 'urgent',
            },
            {
              label: 'Commercial Proposals',
              href: '/proposals',
              icon: FileSpreadsheet,
              moduleKey: 'proposals',
            },
            {
              label: 'Service & Maintenance',
              href: '/service',
              icon: Wrench,
              moduleKey: 'service',
            },
            {
              label: 'Logistics & Deliveries',
              href: '/deliveries',
              icon: Truck,
              moduleKey: 'deliveries',
            },
          ],
        },
        {
          title: 'GOVERNANCE & AUDIT',
          items: [
            {
              label: 'Two-Stage Expenses',
              href: '/expenses',
              icon: Receipt,
              moduleKey: 'expenses',
            },
            {
              label: 'Tasks & System Blockers',
              href: '/tasks',
              icon: CheckSquare,
              moduleKey: 'tasks',
            },
            {
              label: 'System Alerts & Broadcasts',
              href: '/notifications',
              icon: Bell,
              moduleKey: 'notifications',
            },
            {
              label: 'UI/UX Ergonomics Hub',
              href: '/feedback',
              icon: MessageSquarePlus,
              moduleKey: 'admin',
              badge: 'Blueprint §4',
              badgeVariant: 'cyber',
            },
          ],
        },
      ];

    case 'management':
    default:
      return [
        {
          title: 'ENTERPRISE COMMAND',
          items: [
            {
              label: 'Executive Command Deck',
              href: '/dashboard',
              icon: Activity,
              moduleKey: 'dashboard',
              badge: 'All India',
              badgeVariant: 'cyber',
            },
            {
              label: 'Regional Territory Command',
              href: '/regional',
              icon: Compass,
              moduleKey: 'regional',
              badge: '4 Zones',
              badgeVariant: 'cyber',
            },
            {
              label: 'Sales & Regional Performance',
              href: '/regional/performance',
              icon: TrendingUp,
              moduleKey: 'regional',
            },
            {
              label: 'Consolidated Reports & Exports',
              href: '/reports',
              icon: FileSpreadsheet,
              moduleKey: 'reports',
              badge: 'Audits',
              badgeVariant: 'cyber',
            },
          ],
        },
        {
          title: 'COMMERCIAL & TENDERS',
          items: [
            {
              label: 'GeM Defence Tenders',
              href: '/tenders',
              icon: FileText,
              moduleKey: 'tenders',
              badge: 'Live',
              badgeVariant: 'urgent',
            },
            {
              label: 'Enterprise Leads & Accounts',
              href: '/leads',
              icon: Target,
              moduleKey: 'leads',
            },
            {
              label: 'Commercial Proposals & Bids',
              href: '/proposals',
              icon: FileSpreadsheet,
              moduleKey: 'proposals',
            },
          ],
        },
        {
          title: 'FIELD OPERATIONS & ASSETS',
          items: [
            {
              label: 'Client Tour Planner',
              href: '/visits',
              icon: Calendar,
              moduleKey: 'visits',
            },
            {
              label: 'Demo Fleet Matrix',
              href: '/demos',
              icon: Box,
              moduleKey: 'demos',
            },
            {
              label: 'Demo Failures & Incident Log',
              href: '/demos?tab=failures',
              icon: AlertTriangle,
              moduleKey: 'demos',
              badge: 'Failure Audit',
              badgeVariant: 'urgent',
            },
            {
              label: 'Service Desk & Spares',
              href: '/service',
              icon: Wrench,
              moduleKey: 'service',
            },
            {
              label: 'Logistics & Deliveries',
              href: '/deliveries',
              icon: Truck,
              moduleKey: 'deliveries',
              badge: 'Consignments',
              badgeVariant: 'cyber',
            },
          ],
        },
        {
          title: 'GOVERNANCE & AUDIT',
          items: [
            {
              label: 'Expense Claims & Sign-offs',
              href: '/expenses',
              icon: Receipt,
              moduleKey: 'expenses',
              badge: 'Stage 1 & 2',
              badgeVariant: 'warning',
            },
            {
              label: 'Tasks & Milestone Blockers',
              href: '/tasks',
              icon: CheckSquare,
              moduleKey: 'tasks',
            },
            {
              label: 'Administration & Masters',
              href: '/admin',
              icon: Settings,
              moduleKey: 'admin',
              badge: 'System',
              badgeVariant: 'cyber',
            },
            {
              label: 'Directives & Broadcasts',
              href: '/notifications',
              icon: Bell,
              moduleKey: 'notifications',
            },
            {
              label: 'UI/UX Ergonomics Hub',
              href: '/feedback',
              icon: MessageSquarePlus,
              moduleKey: 'admin',
              badge: 'Blueprint §4',
              badgeVariant: 'cyber',
            },
          ],
        },
      ];
  }
}

/**
 * Module 9: each role gets one "Expenses" entry. Approvals, Accounts queue, reports and categories are reached from
 * the module's View menu (ExpenseViewMenu), so the badge sums what is waiting on this user there.
 */
function withExpenseItems(groups: NavGroup[], role: UserRole, counts: BadgeCounts | null): NavGroup[] {
  const isAdminLike = role === 'admin' || role === 'management';
  const approver = role === 'regional_manager' || isAdminLike || Boolean(counts?.has_team);
  const waiting =
    (counts?.my_clarifications || 0) +
    (approver ? counts?.manager_pending || 0 : 0) +
    (role === 'accounts' ? (counts?.accounts_pending || 0) + (counts?.accounts_ready || 0) : 0) +
    (isAdminLike ? counts?.approver_inactive || 0 : 0);
  return groups.map((g) => ({
    ...g,
    items: g.items.map((item) =>
      item.href === '/expenses'
        ? { ...item, label: 'Expenses', badge: waiting > 0 ? String(waiting) : item.badge, badgeVariant: waiting > 0 ? 'urgent' : item.badgeVariant }
        : item.href === '/expenses/approvals'
          ? { ...item, badge: waiting > 0 ? String(waiting) : item.badge, badgeVariant: waiting > 0 ? 'urgent' : item.badgeVariant }
          : item,
    ),
  }));
}

/**
 * Module 8: each role gets one "Tasks" entry. Team, blockers, approvals, accountability and evidence are
 * reached from the module's View menu (TaskViewMenu), so the badge sums everything waiting on this user.
 */
function withTaskItems(groups: NavGroup[], s: TaskSummary | null): NavGroup[] {
  const waiting = (s?.my_overdue || 0) + (s?.pending_blockers || 0) + (s?.pending_approvals || 0);
  return groups.map((g) => ({
    ...g,
    items: g.items.map((item) =>
      item.href === '/tasks'
        ? { ...item, label: 'Tasks', badge: waiting > 0 ? String(waiting) : item.badge, badgeVariant: waiting > 0 ? 'urgent' : item.badgeVariant }
        : item,
    ),
  }));
}

interface NavCounts {
  tendersLive: number;
  tendersClosing7d: number;
}

/**
 * Tender badges show the live figures from GET /dashboard/nav-counts (the dashboards' own definitions, in the
 * user's scope) instead of fixed text, so the sidebar never disagrees with the dashboard or the Tenders page.
 */
function withTenderItems(groups: NavGroup[], c: NavCounts | null): NavGroup[] {
  if (!c) return groups;
  return groups.map((g) => ({
    ...g,
    items: g.items.map((item) => {
      if (item.href !== '/tenders' || !item.badge) return item;
      if (/live/i.test(item.badge)) return { ...item, badge: `${c.tendersLive} Live` };
      if (/≤\s*7d|closing/i.test(item.badge)) return { ...item, badge: `${c.tendersClosing7d} ≤7d` };
      return item;
    }),
  }));
}

function useNavCounts(enabled: boolean): NavCounts | null {
  const [counts, setCounts] = useState<NavCounts | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const load = () =>
      api
        .get<NavCounts>('/dashboard/nav-counts')
        .then((r) => alive && setCounts(r))
        .catch(() => undefined);
    load();
    const t = window.setInterval(load, 5 * 60 * 1000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [enabled]);
  return counts;
}

function toSentenceCase(str: string): string {
  if (!str) return '';
  const lower = str.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

export const Sidebar: React.FC = () => {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const { isCollapsed, isOpenMobile, toggleCollapse, closeMobile } = useSidebar();

  const role = user?.role || 'management';
  const roleProfile = ROLE_PROFILES[role];
  const expenseCounts = useBadgeCounts(Boolean(user));
  const { summary: taskSummary } = useTaskSummary(Boolean(user));
  const navCounts = useNavCounts(Boolean(user));
  const navGroups = useMemo(
    () => withTenderItems(withTaskItems(withExpenseItems(getRoleNavGroups(role), role, expenseCounts), taskSummary), navCounts),
    [role, expenseCounts, taskSummary, navCounts],
  );

  // RBAC clearance validation
  const isModuleAllowed = (moduleKey: BosModuleKey | 'reports') => {
    if (!user) return false;
    if (moduleKey === 'reports') {
      return ['management', 'regional_manager', 'tender_team', 'accounts', 'admin'].includes(user.role);
    }
    if (moduleKey === 'tenders' && user.role === 'sales') {
      return true;
    }
    return roleProfile?.allowedModules?.includes(moduleKey as BosModuleKey);
  };

  const [query, setQuery] = useState('');
  const [closedGroups, setClosedGroups] = useState<string[]>([]);
  const [tip, setTip] = useState<{ label: string; top: number; badge?: string } | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('bos.sidebar.closedGroups');
      if (raw) setClosedGroups(JSON.parse(raw));
    } catch {}
  }, []);
  const toggleGroup = (title: string) =>
    setClosedGroups((prev) => {
      const next = prev.includes(title) ? prev.filter((t) => t !== title) : [...prev, title];
      try {
        localStorage.setItem('bos.sidebar.closedGroups', JSON.stringify(next));
      } catch {}
      return next;
    });

  const isItemActive = (item: NavItem) =>
    item.href.includes('?')
      ? pathname === item.href.split('?')[0] &&
        typeof window !== 'undefined' &&
        window.location.search.includes(item.href.split('?')[1])
      : pathname === item.href ||
        (item.href !== '/dashboard' &&
          pathname.startsWith(item.href) &&
          (typeof window === 'undefined' || !window.location.search.includes('tab=failures')));

  const q = query.trim().toLowerCase();
  const visibleGroups = useMemo(
    () =>
      navGroups
        .map((g) => ({
          ...g,
          items: g.items.filter(
            (it) => isModuleAllowed(it.moduleKey) && (!q || it.label.toLowerCase().includes(q)),
          ),
        }))
        .filter((g) => g.items.length > 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [navGroups, q, user],
  );

  const renderNavContent = (isCompact: boolean, onNavigate?: () => void) => (
    <nav className={`overflow-y-auto overflow-x-hidden custom-scrollbar flex-1 min-h-0 ${isCompact ? 'pl-0 pr-0 py-3 space-y-0' : 'px-3 py-3 space-y-3'}`}>
      {!isCompact && user && (
        <div className="md-rolecard select-none">
          <span className="md-rolecard__label">Active clearance</span>
          <div className="md-rolecard__title">{roleProfile?.title || role.replace('_', ' ')}</div>
          <div className="md-rolecard__sub truncate capitalize">{String((user as any)?.territory || roleProfile?.territorialScope || 'All India Operations').replace(/_/g, ' ')}</div>
        </div>
      )}

      {!isCompact && (
        <div className="md-search">
          <Search aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a module…"
            aria-label="Find a module"
          />
        </div>
      )}

      {visibleGroups.map((group, gIdx) => {
        const closed = !isCompact && !q && closedGroups.includes(group.title);
        return (
          <div key={group.title} className={isCompact ? '' : 'space-y-1'}>
            {isCompact ? (
              gIdx > 0 && <div className="md-rail-divider" />
            ) : (
              <button
                type="button"
                onClick={() => toggleGroup(group.title)}
                aria-expanded={!closed}
                className="md-navgroup"
              >
                <span className="flex-1 truncate">{group.title}</span>
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${closed ? '-rotate-90' : ''}`} />
              </button>
            )}
            {!closed &&
              group.items.map((item) => {
                const isActive = isItemActive(item);
                const Icon = item.icon;

                if (isCompact) {
                  return (
                    <Link
                      key={item.href + item.label}
                      href={item.href}
                      onClick={onNavigate}
                      aria-label={item.label}
                      onMouseEnter={(e) => {
                        const r = e.currentTarget.getBoundingClientRect();
                        setTip({ label: item.label, top: r.top + r.height / 2, badge: item.badge });
                      }}
                      onMouseLeave={() => setTip(null)}
                      data-active={isActive || undefined}
                      className="md-rail-item relative my-1.5 ml-2 flex h-9 w-14 cursor-pointer items-center justify-center"
                    >
                      <Icon className="h-[22px] w-[22px]" />
                      {item.badge && <span className="md-rail-badge" aria-hidden />}
                    </Link>
                  );
                }

                return (
                  <Link
                    key={item.href + item.label}
                    href={item.href}
                    onClick={onNavigate}
                    data-active={isActive || undefined}
                    className="md-nav-item min-w-0 max-w-full"
                  >
                    <Icon className="md-nav-item__icon" />
                    <span className="md-nav-item__label">{item.label}</span>
                    {item.badge && <span className="md-nav-item__badge">{item.badge}</span>}
                  </Link>
                );
              })}
          </div>
        );
      })}

      {visibleGroups.length === 0 && (
        <p className="px-2 py-6 text-center text-xs text-[#6B7280]">No module matches “{query}”.</p>
      )}
    </nav>
  );

  return (
    <>
      {/* ========================================================================= */}
      {/* DESKTOP SIDEBAR (Sidebar bg matching page background #F6F5F1)              */}
      {/* ========================================================================= */}
      <aside
        className={`hidden lg:flex flex-col justify-between shrink-0 z-20 select-none shadow-xs text-[#4A5568] bg-white border-r border-[#DCD8CE] transition-all duration-300 ease-in-out h-screen max-h-screen ${
          isCollapsed ? 'w-[72px]' : 'w-72'
        }`}
      >
        <div className="flex flex-col flex-1 min-h-0">
          {/* Header with Open/Close Buttons */}
          {isCollapsed ? (
            <div className="md-side-head h-[64px] pl-2 flex items-center shrink-0">
              {/* OPEN BUTTON IN SIDEBAR */}
              <button
                type="button"
                onClick={toggleCollapse}
                className="md-icon-btn h-10 w-10 flex items-center justify-center cursor-pointer"
                title="Open sidebar (Expand) [Ctrl+B]"
                aria-label="Open sidebar"
              >
                <PanelLeftOpen className="w-4 h-4 transition-transform group-hover:scale-110" />
              </button>
            </div>
          ) : (
            <div className="md-side-head h-[64px] px-4 flex items-center justify-between shrink-0">
              <div className="flex items-center space-x-2.5 min-w-0">
                <div className="app-logo h-9 w-9 flex items-center justify-center shrink-0">
                  <BrandMark className="h-6 w-6" />
                </div>
                <div className="min-w-0">
                  <div className="font-display font-semibold text-[#14213D] text-[15px] tracking-tight flex items-center gap-1.5">
                    <span>Arihant</span>
                    <span className="app-pill font-sans font-bold text-[10px] px-1.5 py-0.5 rounded-md bg-[#FBEBDD] text-[#9A3412]">
                      BOS
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex items-center space-x-1 shrink-0">
                {/* CLOSE BUTTON IN SIDEBAR */}
                <button
                  type="button"
                  onClick={toggleCollapse}
                  className="md-icon-btn p-2 cursor-pointer shrink-0 ml-1"
                  title="Close sidebar (Collapse) [Ctrl+B]"
                  aria-label="Close sidebar"
                >
                  <PanelLeftClose className="w-4 h-4 transition-transform group-hover:scale-105" />
                </button>
              </div>
            </div>
          )}

          {/* Navigation List */}
          {renderNavContent(isCollapsed)}
        </div>

        {/* Footer / Status / Logout */}
        {isCollapsed ? (
          <div className="md-side-foot py-3 flex flex-col items-start space-y-2 shrink-0">
            {user && (
              <div
                className="md-avatar h-10 w-10 ml-3 flex items-center justify-center text-sm font-semibold shrink-0 cursor-default"
                title={`${user.full_name} (${user.role.replace('_', ' ')})`}
              >
                {user.full_name ? user.full_name[0].toUpperCase() : 'U'}
              </div>
            )}
            <button
              type="button"
              onClick={() => window.dispatchEvent(new CustomEvent('open-uiux-feedback'))}
              className="md-icon-btn h-10 w-10 ml-3 flex items-center justify-center cursor-pointer text-[#0F5E63] hover:bg-[#E3EFEE]"
              title="UI/UX & Field Ergonomics Feedback"
              aria-label="UI/UX & Field Ergonomics Feedback"
            >
              <MessageSquarePlus className="h-4 w-4" />
            </button>
            <button
              onClick={logout}
              title="Sign Out"
              aria-label="Sign Out"
              className="md-icon-btn h-10 w-10 ml-3 flex items-center justify-center cursor-pointer"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <div className="md-side-foot p-3 space-y-2 shrink-0">
            <button
              type="button"
              onClick={() => window.dispatchEvent(new CustomEvent('open-uiux-feedback'))}
              className="w-full flex items-center justify-between px-3 py-1.5 rounded-[8px] border border-[#DCD8CE] bg-[#FBFAF7] hover:bg-[#E3EFEE] hover:border-[#0F5E63]/40 text-[#14213D] text-[12px] font-medium transition-all cursor-pointer group shadow-xs"
              title="Give UI/UX & Field Ergonomics Feedback"
            >
              <span className="flex items-center gap-2">
                <MessageSquarePlus className="w-3.5 h-3.5 text-[#0F5E63] group-hover:scale-110 transition-transform" />
                <span className="font-semibold text-xs">UI/UX Feedback</span>
              </span>
              <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-white border border-[#DCD8CE] text-[#0F5E63]">
                Ergonomics
              </span>
            </button>

            {user && (
              <div className="md-userrow flex items-center gap-3 p-2">
                <div className="md-avatar h-10 w-10 flex items-center justify-center text-sm font-semibold shrink-0">
                  {user.full_name ? user.full_name[0].toUpperCase() : 'U'}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-semibold text-[#14213D] truncate">{user.full_name}</div>
                  <div className="text-[11px] text-[#4A5568] capitalize truncate">{user.role.replace('_', ' ')}</div>
                </div>
                <button
                  onClick={logout}
                  title="Sign Out"
                  aria-label="Sign Out"
                  className="md-icon-btn h-10 w-10 shrink-0 flex items-center justify-center cursor-pointer"
                >
                  <LogOut className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>
        )}
      </aside>
      {isCollapsed && tip && (
        <div
          role="tooltip"
          className="md-tooltip pointer-events-none fixed z-[130] -translate-y-1/2 animate-in fade-in slide-in-from-left-1 duration-100"
          style={{ left: 82, top: tip.top }}
        >
          {tip.label}
          {tip.badge && <span className="ml-2 font-mono text-[10px] opacity-80">{tip.badge}</span>}
        </div>
      )}

      {/* ========================================================================= */}
      {/* MOBILE DRAWER (With Backdrop and Close button)                            */}
      {/* ========================================================================= */}
      {isOpenMobile && (
        <div className="fixed inset-0 z-50 lg:hidden">
          {/* Backdrop */}
          <div
            className="md-scrim fixed inset-0 transition-opacity"
            onClick={closeMobile}
          />

          {/* Drawer Panel */}
          <aside className="md-drawer fixed top-0 left-0 bottom-0 w-72 max-w-[85vw] z-50 flex flex-col justify-between select-none text-[#4A5568] animate-in slide-in-from-left duration-200">
            <div className="flex flex-col flex-1 min-h-0">
              {/* Header with Close Button */}
              <div className="md-side-head h-[64px] px-4 flex items-center justify-between shrink-0">
                <div className="flex items-center space-x-2.5 min-w-0">
                  <div className="app-logo h-9 w-9 flex items-center justify-center shrink-0">
                    <BrandMark className="h-6 w-6" />
                  </div>
                  <div className="min-w-0">
                    <div className="font-display font-semibold text-[#14213D] text-[15px] tracking-tight flex items-center gap-1.5">
                      <span>Arihant</span>
                      <span className="app-pill font-sans font-bold text-[10px] px-1.5 py-0.5 rounded-md bg-[#FBEBDD] text-[#9A3412]">
                        BOS
                      </span>
                    </div>
                  </div>
                </div>

                {/* CLOSE BUTTON IN MOBILE DRAWER */}
                <button
                  type="button"
                  onClick={closeMobile}
                  className="md-icon-btn p-2 cursor-pointer"
                  title="Close sidebar drawer"
                  aria-label="Close sidebar drawer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Navigation List */}
              {renderNavContent(false, closeMobile)}
            </div>

            {/* Mobile Footer */}
            <div className="md-side-foot p-3 space-y-2 shrink-0">
              {user && (
                <div className="md-userrow flex items-center gap-3 p-2">
                  <div className="md-avatar h-10 w-10 flex items-center justify-center text-sm font-semibold shrink-0">
                    {user.full_name ? user.full_name[0].toUpperCase() : 'U'}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-semibold text-[#14213D] truncate">{user.full_name}</div>
                    <div className="text-[11px] text-[#4A5568] capitalize truncate">
                      {user.role.replace('_', ' ')}
                    </div>
                  </div>
                </div>
              )}

              <button
                type="button"
                onClick={() => {
                  closeMobile();
                  window.dispatchEvent(new CustomEvent('open-uiux-feedback'));
                }}
                className="w-full flex items-center justify-between px-3 py-2 rounded-[8px] border border-[#DCD8CE] bg-[#FBFAF7] hover:bg-[#E3EFEE] text-[#14213D] text-[12px] font-medium transition-all cursor-pointer group"
              >
                <span className="flex items-center gap-2">
                  <MessageSquarePlus className="w-4 h-4 text-[#0F5E63]" />
                  <span className="font-semibold">UI/UX Feedback Section</span>
                </span>
                <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-white border border-[#DCD8CE] text-[#0F5E63]">
                  Field Review
                </span>
              </button>

              <button
                onClick={() => {
                  closeMobile();
                  logout();
                }}
                className="md-btn-outlined w-full flex items-center justify-center space-x-2 px-3 min-w-0 truncate cursor-pointer"
              >
                <LogOut className="h-3.5 w-3.5 shrink-0 text-[#4A5568]" />
                <span className="truncate">Sign Out</span>
              </button>
            </div>
          </aside>
        </div>
      )}
    </>
  );
};
