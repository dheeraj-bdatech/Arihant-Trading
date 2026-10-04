'use client';

import React from 'react';
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
  Shield,
  ShieldCheck,
  PanelLeftClose,
  PanelLeftOpen,
  X,
  Truck,
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

  const renderNavContent = (isCompact: boolean, onNavigate?: () => void) => (
    <nav className={`px-2 py-2 ${isCompact ? 'space-y-3' : 'space-y-4'} overflow-y-auto custom-scrollbar flex-1 min-h-0`}>
      {!isCompact && user && (
        <div className="mx-1 mb-3 p-3 rounded-[10px] bg-white border border-[#E3E7ED] border-l-[3px] border-l-[#16917A] flex flex-col gap-0.5 select-none">
          <span className="text-[10px] tracking-wider text-[#84928C] uppercase font-semibold">Active clearance</span>
          <span className="text-[#132822] text-xs font-bold truncate">{roleProfile?.title || role.replace('_', ' ')}</span>
          <span className="text-[11px] text-[#5E6A7C] truncate">{(user as any)?.territory || roleProfile?.territorialScope || 'All India Operations'}</span>
        </div>
      )}

      {navGroups.map((group, gIdx) => {
        const visibleItems = group.items.filter((item) => isModuleAllowed(item.moduleKey));
        if (visibleItems.length === 0) return null;

        return (
          <div key={group.title} className="space-y-0.5">
            {isCompact ? (
              gIdx > 0 && <div className="h-px bg-[#E3E7ED] my-2 mx-1" />
            ) : (
              <div className="px-3 text-[11px] font-semibold text-[#84928C] normal-case tracking-normal mb-1.5">
                {toSentenceCase(group.title)}
              </div>
            )}
            {visibleItems.map((item) => {
              const isActive =
                pathname === item.href ||
                (item.href !== '/dashboard' && pathname.startsWith(item.href));
              const Icon = item.icon;

              if (isCompact) {
                return (
                  <Link
                    key={item.href + item.label}
                    href={item.href}
                    onClick={onNavigate}
                    title={item.label + (item.badge ? ` (${item.badge})` : '')}
                    className={`relative w-10 h-10 mx-auto flex items-center justify-center rounded-[8px] transition-all cursor-pointer group ${
                      isActive
                        ? 'bg-[#E9F6F2] text-[#132822] font-semibold border-l-[3px] border-l-[#16917A] rounded-l-none'
                        : 'text-[#35463F] hover:bg-[#F1F7F5] hover:text-[#132822] border border-transparent'
                    }`}
                  >
                    <Icon
                      className={`w-4 h-4 transition-transform group-hover:scale-110 ${
                        isActive ? 'text-[#0F5E4E]' : 'text-[#84928C]'
                      }`}
                    />
                    {item.badge && (
                      <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-[#16917A]" />
                    )}
                  </Link>
                );
              }

              return (
                <Link
                  key={item.href + item.label}
                  href={item.href}
                  onClick={onNavigate}
                  className={`flex items-center justify-between py-2 text-[13px] transition-colors rounded-[8px] px-3 min-w-0 max-w-full ${
                    isActive
                      ? 'bg-[#E9F6F2] text-[#132822] font-semibold border-l-[3px] border-l-[#16917A] rounded-l-none pl-2.5'
                      : 'text-[#35463F] hover:bg-[#F1F7F5] hover:text-[#132822]'
                  }`}
                >
                  <div className="flex items-center space-x-2.5 min-w-0 flex-1 mr-1.5">
                    <Icon
                      className={`w-4 h-4 shrink-0 ${
                        isActive ? 'text-[#0F5E4E]' : 'text-[#84928C]'
                      }`}
                    />
                    <span className="truncate">{item.label}</span>
                  </div>

                  <div className="flex items-center space-x-1 shrink-0">
                    {item.badge && (
                      <span className="font-mono text-[11px] font-semibold text-[#0F5E4E] shrink-0 bg-transparent">
                        {item.badge}
                      </span>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        );
      })}
    </nav>
  );

  return (
    <>
      {/* ========================================================================= */}
      {/* DESKTOP SIDEBAR (Sidebar bg matching page background #F7F8FA)              */}
      {/* ========================================================================= */}
      <aside
        className={`hidden lg:flex flex-col justify-between shrink-0 z-20 select-none shadow-xs text-[#35463F] bg-[#F7F8FA] border-r border-[#E3E7ED] transition-all duration-300 ease-in-out h-screen max-h-screen ${
          isCollapsed ? 'w-[72px]' : 'w-72'
        }`}
      >
        <div className="flex flex-col flex-1 min-h-0">
          {/* Header with Open/Close Buttons */}
          {isCollapsed ? (
            <div className="h-[64px] px-2 border-b border-[#E3E7ED] flex items-center justify-center bg-[#F7F8FA] shrink-0">
              {/* OPEN BUTTON IN SIDEBAR */}
              <button
                type="button"
                onClick={toggleCollapse}
                className="h-10 w-10 rounded-[8px] bg-white hover:bg-[#F1F7F5] border border-[#E3E7ED] text-[#5E6A7C] hover:text-[#0F5E4E] flex items-center justify-center transition-all cursor-pointer group"
                title="Open sidebar (Expand) [Ctrl+B]"
                aria-label="Open sidebar"
              >
                <PanelLeftOpen className="w-4 h-4 transition-transform group-hover:scale-110" />
              </button>
            </div>
          ) : (
            <div className="h-[64px] px-4 border-b border-[#E3E7ED] flex items-center justify-between bg-[#F7F8FA] shrink-0">
              <div className="flex items-center space-x-2.5 min-w-0">
                <div className="h-9 w-9 rounded-[8px] bg-[#0F5E4E] flex items-center justify-center text-white shadow-xs shrink-0">
                  <Shield className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <div className="font-serif font-bold text-[#132822] text-sm tracking-tight flex items-center gap-1.5">
                    <span>ARIHANT</span>
                    <span className="font-sans font-bold text-[10px] px-1.5 py-0.5 rounded bg-[#E9F6F2] text-[#0F5E4E]">
                      BOS
                    </span>
                  </div>
                  <div className="text-[10px] text-[#84928C] font-medium truncate">
                    Defence &amp; Security ERP
                  </div>
                </div>
              </div>

              <div className="flex items-center space-x-1 shrink-0">
                <span className="hidden xl:inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-[#EAF6F0] text-[#1F7A55] border border-[#1F7A55]/30">
                  <ShieldCheck className="w-2.5 h-2.5 mr-0.5" />
                  Verified
                </span>
                {/* CLOSE BUTTON IN SIDEBAR */}
                <button
                  type="button"
                  onClick={toggleCollapse}
                  className="p-1.5 rounded-[8px] text-[#84928C] hover:text-[#132822] hover:bg-[#F1F7F5] border border-transparent transition-all cursor-pointer shrink-0 ml-1 group"
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
          <div className="p-2 border-t border-[#E3E7ED] bg-[#F7F8FA] flex flex-col items-center space-y-2 shrink-0">
            <div
              className="h-2 w-2 rounded-full bg-[#1F7A55] animate-pulse my-1"
              title="GeM Gateway: Online & Connected"
            />
            {user && (
              <div
                className="h-8 w-8 rounded-[8px] bg-[#0F5E4E] text-white flex items-center justify-center text-xs font-bold shrink-0 cursor-default"
                title={`${user.full_name} (${user.role.replace('_', ' ')})`}
              >
                {user.full_name ? user.full_name[0].toUpperCase() : 'U'}
              </div>
            )}
            <button
              onClick={logout}
              title="Sign Out"
              aria-label="Sign Out"
              className="h-8 w-8 flex items-center justify-center rounded-[8px] text-[#5E6A7C] hover:text-[#B42318] bg-white hover:bg-[#FEF1EF] border border-[#E3E7ED] transition-colors cursor-pointer"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <div className="p-3 border-t border-[#E3E7ED] bg-[#F7F8FA] space-y-2 shrink-0">
            <div className="flex items-center justify-between text-[11px] text-[#1F7A55] px-1 font-medium">
              <div className="flex items-center space-x-1.5">
                <span className="h-2 w-2 rounded-full bg-[#1F7A55] animate-pulse" />
                <span className="font-semibold text-[#1F7A55]">GeM Gateway: Online</span>
              </div>
              <span className="text-[10px] text-[#1F7A55] font-semibold bg-[#EAF6F0] px-1.5 py-0.2 rounded border border-[#1F7A55]/30">
                Connected
              </span>
            </div>

            {user && (
              <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-[8px] bg-white border border-[#E3E7ED]">
                <div className="h-6 w-6 rounded-md bg-[#0F5E4E] text-white flex items-center justify-center text-[11px] font-bold shrink-0">
                  {user.full_name ? user.full_name[0].toUpperCase() : 'U'}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-bold text-[#132822] truncate">{user.full_name}</div>
                  <div className="text-[9px] text-[#84928C] font-semibold uppercase tracking-wider truncate">
                    {user.role.replace('_', ' ')}
                  </div>
                </div>
              </div>
            )}

            <button
              onClick={logout}
              className="w-full flex items-center justify-center space-x-2 px-3 py-2 rounded-[8px] text-xs font-semibold text-[#152235] hover:text-[#B42318] bg-white hover:bg-[#FEF1EF] border border-[#E3E7ED] hover:border-[#F6CFC9] transition-colors min-w-0 truncate cursor-pointer shadow-2xs group"
            >
              <LogOut className="h-3.5 w-3.5 shrink-0 text-[#5E6A7C] group-hover:text-[#B42318] transition-colors" />
              <span className="truncate">Sign Out</span>
            </button>
          </div>
        )}
      </aside>

      {/* ========================================================================= */}
      {/* MOBILE DRAWER (With Backdrop and Close button)                            */}
      {/* ========================================================================= */}
      {isOpenMobile && (
        <div className="fixed inset-0 z-50 lg:hidden">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/40 backdrop-blur-xs transition-opacity"
            onClick={closeMobile}
          />

          {/* Drawer Panel */}
          <aside className="fixed top-0 left-0 bottom-0 w-72 max-w-[85vw] bg-[#F7F8FA] z-50 shadow-2xl flex flex-col justify-between select-none text-[#35463F] border-r border-[#E3E7ED] animate-in slide-in-from-left duration-200">
            <div className="flex flex-col flex-1 min-h-0">
              {/* Header with Close Button */}
              <div className="h-[64px] px-4 border-b border-[#E3E7ED] flex items-center justify-between bg-[#F7F8FA] shrink-0">
                <div className="flex items-center space-x-2.5 min-w-0">
                  <div className="h-9 w-9 rounded-[8px] bg-[#0F5E4E] flex items-center justify-center text-white shadow-xs shrink-0">
                    <Shield className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="font-serif font-bold text-[#132822] text-sm tracking-tight flex items-center gap-1.5">
                      <span>ARIHANT</span>
                      <span className="font-sans font-bold text-[10px] px-1.5 py-0.5 rounded bg-[#E9F6F2] text-[#0F5E4E]">
                        BOS
                      </span>
                    </div>
                    <div className="text-[10px] text-[#84928C] font-medium truncate">
                      Defence &amp; Security ERP
                    </div>
                  </div>
                </div>

                {/* CLOSE BUTTON IN MOBILE DRAWER */}
                <button
                  type="button"
                  onClick={closeMobile}
                  className="p-1.5 rounded-[8px] text-[#84928C] hover:text-[#132822] hover:bg-[#F1F7F5] transition-colors cursor-pointer"
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
            <div className="p-3 border-t border-[#E3E7ED] bg-[#F7F8FA] space-y-2 shrink-0">
              {user && (
                <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-[8px] bg-white border border-[#E3E7ED]">
                  <div className="h-6 w-6 rounded-md bg-[#0F5E4E] text-white flex items-center justify-center text-[11px] font-bold shrink-0">
                    {user.full_name ? user.full_name[0].toUpperCase() : 'U'}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-bold text-[#132822] truncate">{user.full_name}</div>
                    <div className="text-[9px] text-[#84928C] font-semibold uppercase tracking-wider truncate">
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
                className="w-full flex items-center justify-center space-x-2 px-3 py-2 rounded-[8px] text-xs font-semibold text-[#152235] hover:text-[#B42318] bg-white hover:bg-[#FEF1EF] border border-[#E3E7ED] hover:border-[#F6CFC9] transition-colors min-w-0 truncate cursor-pointer shadow-2xs"
              >
                <LogOut className="h-3.5 w-3.5 shrink-0 text-[#5E6A7C]" />
                <span className="truncate">Sign Out</span>
              </button>
            </div>
          </aside>
        </div>
      )}
    </>
  );
};
