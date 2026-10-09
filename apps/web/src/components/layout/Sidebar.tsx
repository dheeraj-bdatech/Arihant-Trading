'use client';

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
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { useSidebar } from '@/lib/sidebar-context';
import { ROLE_PROFILES, type UserRole, type BosModuleKey } from '@arihant/shared';

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
              href: '/expenses',
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
              badge: '30 Live',
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
              badge: '30 Live',
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
          ],
        },
      ];
  }
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
  const navGroups = getRoleNavGroups(role);

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
        <div className="mt-clearance relative overflow-hidden rounded-[14px] border-[1.5px] border-[#D9B98A] bg-gradient-to-br from-[#FFF6E6] to-[#FBE9D0] p-3 select-none">
          <span aria-hidden className="absolute -right-3 -top-3 h-14 w-14 rotate-45 border-2 border-dashed border-[#C98A1B]/40" />
          <span className="text-[10px] tracking-[0.12em] text-[#9A3412] uppercase font-bold">Active clearance</span>
          <div className="text-[#14213D] text-[13px] font-bold leading-snug mt-0.5">{roleProfile?.title || role.replace('_', ' ')}</div>
          <div className="text-[11px] text-[#4A5568] truncate">{(user as any)?.territory || roleProfile?.territorialScope || 'All India Operations'}</div>
        </div>
      )}

      {!isCompact && (
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#9A3412]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a module…"
            aria-label="Find a module"
            className="h-9 w-full rounded-xl border-[1.5px] border-[#E8D5B5] bg-[#FFFCF5] pl-9 pr-3 text-xs text-[#14213D] placeholder:text-[#8A8578] focus:border-[#9A3412] focus:outline-none"
          />
        </div>
      )}

      {visibleGroups.map((group, gIdx) => {
        const closed = !isCompact && !q && closedGroups.includes(group.title);
        return (
          <div key={group.title} className={isCompact ? '' : 'space-y-1'}>
            {isCompact ? (
              gIdx > 0 && <div className="my-2 ml-[10px] w-10 border-t border-dashed border-[#D9B98A]" />
            ) : (
              <button
                type="button"
                onClick={() => toggleGroup(group.title)}
                aria-expanded={!closed}
                className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left text-[10px] font-bold uppercase tracking-[0.06em] text-[#8A6A3B] hover:text-[#9A3412] transition-colors"
              >
                <span aria-hidden className="h-1.5 w-1.5 rotate-45 bg-[#C98A1B]" />
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
                      className={`relative w-10 h-10 ml-[10px] my-1.5 flex items-center justify-center rounded-[10px] border-[1.5px] transition-all cursor-pointer group ${
                        isActive
                          ? 'bg-[#9A3412] border-[#9A3412] shadow-[2px_2px_0_rgba(154,52,18,0.22)]'
                          : 'bg-[#FFFCF5] border-[#E8D5B5] hover:bg-[#FBE9D0] hover:border-[#9A3412] hover:shadow-[2px_2px_0_rgba(154,52,18,0.14)]'
                      }`}
                    >
                      <Icon className={`w-[18px] h-[18px] transition-transform group-hover:scale-110 ${isActive ? 'text-[#FFFCF5]' : 'text-[#9A3412]'}`} />
                      {item.badge && <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-[#C98A1B] ring-2 ring-[#FFFCF5]" />}
                    </Link>
                  );
                }

                return (
                  <Link
                    key={item.href + item.label}
                    href={item.href}
                    onClick={onNavigate}
                    className={`group flex items-center gap-3 rounded-xl border-[1.5px] px-2 py-1.5 min-w-0 max-w-full transition-all ${
                      isActive
                        ? 'bg-[#FBE9D0] border-[#D9B98A] shadow-[2px_2px_0_rgba(154,52,18,0.12)]'
                        : 'border-transparent hover:bg-[#FFF6E6] hover:border-[#EBD9B8]'
                    }`}
                  >
                    <span
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-colors ${
                        isActive
                          ? 'bg-[#9A3412] border-[#9A3412] text-[#FFFCF5]'
                          : 'bg-[#FFFCF5] border-[#E8D5B5] text-[#9A3412] group-hover:border-[#9A3412]'
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate text-[13px] leading-tight ${isActive ? 'font-bold text-[#14213D]' : 'font-medium text-[#4A5568] group-hover:text-[#14213D]'}`}>
                        {item.label}
                      </span>
                      {item.badge && (
                        <span className="block truncate font-mono text-[10px] font-semibold leading-tight text-[#9A3412]">{item.badge}</span>
                      )}
                    </span>
                  </Link>
                );
              })}
          </div>
        );
      })}

      {visibleGroups.length === 0 && (
        <p className="px-2 py-6 text-center text-xs text-[#8A8578]">No module matches “{query}”.</p>
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
            <div className="h-[64px] pl-[10px] border-b border-[#DCD8CE] flex items-center bg-white shrink-0">
              {/* OPEN BUTTON IN SIDEBAR */}
              <button
                type="button"
                onClick={toggleCollapse}
                className="h-10 w-10 rounded-[8px] bg-white hover:bg-[#F6F5F1] border border-[#DCD8CE] text-[#4A5568] hover:text-[#0F5E63] flex items-center justify-center transition-all cursor-pointer group"
                title="Open sidebar (Expand) [Ctrl+B]"
                aria-label="Open sidebar"
              >
                <PanelLeftOpen className="w-4 h-4 transition-transform group-hover:scale-110" />
              </button>
            </div>
          ) : (
            <div className="h-[64px] px-4 border-b border-[#DCD8CE] flex items-center justify-between bg-white shrink-0">
              <div className="flex items-center space-x-2.5 min-w-0">
                <div className="mt-logo h-9 w-9 rounded-[10px] bg-gradient-to-br from-[#9A3412] to-[#7C2D12] flex items-center justify-center text-white shadow-xs shrink-0">
                  <img src="/mithila/lotus.svg" alt="" className="h-7 w-7" />
                </div>
                <div className="min-w-0">
                  <div className="font-serif font-bold text-[#14213D] text-sm tracking-tight flex items-center gap-1.5">
                    <span>ARIHANT</span>
                    <span className="mt-bos-pill font-sans font-bold text-[10px] px-1.5 py-0.5 rounded bg-[#FBEBDD] text-[#9A3412]">
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
                  className="p-1.5 rounded-[8px] text-[#6B7280] hover:text-[#14213D] hover:bg-[#F6F5F1] border border-transparent transition-all cursor-pointer shrink-0 ml-1 group"
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
          <div className="py-3 border-t border-[#DCD8CE] bg-white flex flex-col items-start space-y-2 shrink-0">
            {user && (
              <div
                className="h-10 w-10 ml-[10px] rounded-[10px] bg-[#9A3412] text-white flex items-center justify-center text-xs font-bold shrink-0 cursor-default"
                title={`${user.full_name} (${user.role.replace('_', ' ')})`}
              >
                {user.full_name ? user.full_name[0].toUpperCase() : 'U'}
              </div>
            )}
            <button
              onClick={logout}
              title="Sign Out"
              aria-label="Sign Out"
              className="h-10 w-10 ml-[10px] flex items-center justify-center rounded-[10px] text-[#9A3412] bg-[#FFFCF5] hover:bg-[#FBE9D0] border border-[#E8D5B5] transition-colors cursor-pointer"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <div className="p-3 border-t border-[#E8D5B5] bg-[#FFFCF5] shrink-0">
            {user && (
              <div className="flex items-center gap-2.5 rounded-xl border-[1.5px] border-[#E8D5B5] bg-white p-2">
                <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-[#9A3412] to-[#7C2D12] text-white flex items-center justify-center text-sm font-bold shrink-0">
                  {user.full_name ? user.full_name[0].toUpperCase() : 'U'}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-bold text-[#14213D] truncate">{user.full_name}</div>
                  <div className="text-[9px] text-[#8A6A3B] font-bold uppercase tracking-wider truncate">{user.role.replace('_', ' ')}</div>
                </div>
                <button
                  onClick={logout}
                  title="Sign Out"
                  aria-label="Sign Out"
                  className="h-8 w-8 shrink-0 flex items-center justify-center rounded-lg text-[#9A3412] hover:bg-[#FBE9D0] border border-transparent hover:border-[#D9B98A] transition-colors cursor-pointer"
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
          className="pointer-events-none fixed z-[130] -translate-y-1/2 rounded-lg border-[1.5px] border-[#9A3412] bg-[#FFFCF5] px-3 py-1.5 text-xs font-semibold text-[#14213D] shadow-[3px_3px_0_rgba(154,52,18,0.18)] animate-in fade-in slide-in-from-left-1 duration-100"
          style={{ left: 82, top: tip.top }}
        >
          {tip.label}
          {tip.badge && <span className="ml-2 rounded-full bg-[#FBEBDD] px-1.5 py-0.5 font-mono text-[10px] text-[#9A3412]">{tip.badge}</span>}
        </div>
      )}

      {/* ========================================================================= */}
      {/* MOBILE DRAWER (With Backdrop and Close button)                            */}
      {/* ========================================================================= */}
      {isOpenMobile && (
        <div className="fixed inset-0 z-50 lg:hidden">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-[#2B1A12]/45 backdrop-blur-[3px] transition-opacity"
            onClick={closeMobile}
          />

          {/* Drawer Panel */}
          <aside className="fixed top-0 left-0 bottom-0 w-72 max-w-[85vw] bg-white z-50 shadow-2xl flex flex-col justify-between select-none text-[#4A5568] border-r border-[#DCD8CE] animate-in slide-in-from-left duration-200">
            <div className="flex flex-col flex-1 min-h-0">
              {/* Header with Close Button */}
              <div className="h-[64px] px-4 border-b border-[#DCD8CE] flex items-center justify-between bg-white shrink-0">
                <div className="flex items-center space-x-2.5 min-w-0">
                  <div className="mt-logo h-9 w-9 rounded-[10px] bg-gradient-to-br from-[#9A3412] to-[#7C2D12] flex items-center justify-center text-white shadow-xs shrink-0">
                    <img src="/mithila/lotus.svg" alt="" className="h-7 w-7" />
                  </div>
                  <div className="min-w-0">
                    <div className="font-serif font-bold text-[#14213D] text-sm tracking-tight flex items-center gap-1.5">
                      <span>ARIHANT</span>
                      <span className="mt-bos-pill font-sans font-bold text-[10px] px-1.5 py-0.5 rounded bg-[#FBEBDD] text-[#9A3412]">
                        BOS
                      </span>
                    </div>
                  </div>
                </div>

                {/* CLOSE BUTTON IN MOBILE DRAWER */}
                <button
                  type="button"
                  onClick={closeMobile}
                  className="p-1.5 rounded-[8px] text-[#6B7280] hover:text-[#14213D] hover:bg-[#F6F5F1] transition-colors cursor-pointer"
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
            <div className="p-3 border-t border-[#DCD8CE] bg-white space-y-2 shrink-0">
              {user && (
                <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-[8px] bg-white border border-[#DCD8CE]">
                  <div className="h-6 w-6 rounded-md bg-[#0F5E63] text-white flex items-center justify-center text-[11px] font-bold shrink-0">
                    {user.full_name ? user.full_name[0].toUpperCase() : 'U'}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-bold text-[#14213D] truncate">{user.full_name}</div>
                    <div className="text-[9px] text-[#6B7280] font-semibold uppercase tracking-wider truncate">
                      {user.role.replace('_', ' ')}
                    </div>
                  </div>
                </div>
              )}

              <button
                onClick={() => {
                  closeMobile();
                  logout();
                }}
                className="w-full flex items-center justify-center space-x-2 px-3 py-2 rounded-[8px] text-xs font-semibold text-[#14213D] hover:text-[#9A3412] bg-white hover:bg-[#FBEBDD] border border-[#DCD8CE] hover:border-[#F2B872] transition-colors min-w-0 truncate cursor-pointer shadow-2xs"
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
