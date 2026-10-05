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
  PanelLeftClose,
  PanelLeftOpen,
  X,
  Truck,
  Package,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { useSidebar } from '@/lib/sidebar-context';
import { ROLE_PROFILES, type UserRole, type BosModuleKey } from '@arihant/shared';

interface NavItem {
  label: string;
  href: string;
  icon: React.ElementType;
  moduleKey: BosModuleKey | 'reports' | 'products';
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
          title: 'Workspace',
          items: [
            {
              label: 'Dashboard',
              href: '/dashboard',
              icon: Target,
              moduleKey: 'dashboard',
            },
            {
              label: 'Leads',
              href: '/leads',
              icon: Target,
              moduleKey: 'leads',
            },
            {
              label: 'Tenders',
              href: '/tenders?scope=my_tenders',
              icon: FileText,
              moduleKey: 'tenders',
            },
            {
              label: 'Proposals',
              href: '/proposals',
              icon: FileSpreadsheet,
              moduleKey: 'proposals',
            },
            {
              label: 'Products',
              href: '/products',
              icon: Package,
              moduleKey: 'products',
            },
          ],
        },
        {
          title: 'Field Operations',
          items: [
            {
              label: 'Visits',
              href: '/visits',
              icon: Calendar,
              moduleKey: 'visits',
            },
            {
              label: 'Demos',
              href: '/demos',
              icon: Box,
              moduleKey: 'demos',
            },
            {
              label: 'Deliveries',
              href: '/deliveries',
              icon: Truck,
              moduleKey: 'deliveries',
            },
          ],
        },
        {
          title: 'Claims & Tasks',
          items: [
            {
              label: 'Expenses',
              href: '/expenses',
              icon: Receipt,
              moduleKey: 'expenses',
            },
            {
              label: 'Tasks',
              href: '/tasks',
              icon: CheckSquare,
              moduleKey: 'tasks',
            },
            {
              label: 'Notifications',
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
          title: 'Tender Operations',
          items: [
            {
              label: 'Dashboard',
              href: '/dashboard',
              icon: FileText,
              moduleKey: 'dashboard',
            },
            {
              label: 'Tenders',
              href: '/tenders',
              icon: FileText,
              moduleKey: 'tenders',
              badge: 'Live Bids',
              badgeVariant: 'urgent',
            },
            {
              label: 'Proposals',
              href: '/proposals',
              icon: FileSpreadsheet,
              moduleKey: 'proposals',
            },
            {
              label: 'Reports',
              href: '/reports',
              icon: FileSpreadsheet,
              moduleKey: 'reports',
            },
            {
              label: 'Products',
              href: '/products',
              icon: Package,
              moduleKey: 'products',
            },
          ],
        },
        {
          title: 'Operations & Claims',
          items: [
            {
              label: 'Expenses',
              href: '/expenses',
              icon: Receipt,
              moduleKey: 'expenses',
            },
            {
              label: 'Tasks',
              href: '/tasks',
              icon: CheckSquare,
              moduleKey: 'tasks',
            },
            {
              label: 'Notifications',
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
          title: 'Depot Fleet',
          items: [
            {
              label: 'Dashboard',
              href: '/dashboard',
              icon: Box,
              moduleKey: 'dashboard',
            },
            {
              label: 'Demos',
              href: '/demos',
              icon: Box,
              moduleKey: 'demos',
            },
            {
              label: 'Visits',
              href: '/visits',
              icon: Calendar,
              moduleKey: 'visits',
            },
            {
              label: 'Products',
              href: '/products',
              icon: Package,
              moduleKey: 'products',
            },
          ],
        },
        {
          title: 'Operations & Claims',
          items: [
            {
              label: 'Expenses',
              href: '/expenses',
              icon: Receipt,
              moduleKey: 'expenses',
            },
            {
              label: 'Tasks',
              href: '/tasks',
              icon: CheckSquare,
              moduleKey: 'tasks',
            },
            {
              label: 'Notifications',
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
          title: 'Service & Maintenance',
          items: [
            {
              label: 'Dashboard',
              href: '/dashboard',
              icon: Wrench,
              moduleKey: 'dashboard',
            },
            {
              label: 'Service',
              href: '/service',
              icon: Wrench,
              moduleKey: 'service',
              badge: 'Tickets',
              badgeVariant: 'urgent',
            },
            {
              label: 'Visits',
              href: '/visits',
              icon: Calendar,
              moduleKey: 'visits',
            },
            {
              label: 'Deliveries',
              href: '/deliveries',
              icon: Truck,
              moduleKey: 'deliveries',
            },
            {
              label: 'Products',
              href: '/products',
              icon: Package,
              moduleKey: 'products',
            },
          ],
        },
        {
          title: 'Operations & Claims',
          items: [
            {
              label: 'Expenses',
              href: '/expenses',
              icon: Receipt,
              moduleKey: 'expenses',
            },
            {
              label: 'Tasks',
              href: '/tasks',
              icon: CheckSquare,
              moduleKey: 'tasks',
            },
            {
              label: 'Notifications',
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
          title: 'Finance & Audit',
          items: [
            {
              label: 'Dashboard',
              href: '/dashboard',
              icon: Receipt,
              moduleKey: 'dashboard',
            },
            {
              label: 'Expenses',
              href: '/expenses',
              icon: Receipt,
              moduleKey: 'expenses',
              badge: 'Audit',
              badgeVariant: 'warning',
            },
            {
              label: 'Reports',
              href: '/reports',
              icon: FileSpreadsheet,
              moduleKey: 'reports',
            },
            {
              label: 'Products',
              href: '/products',
              icon: Package,
              moduleKey: 'products',
            },
          ],
        },
        {
          title: 'Compliance & Tasks',
          items: [
            {
              label: 'Tasks',
              href: '/tasks',
              icon: CheckSquare,
              moduleKey: 'tasks',
            },
            {
              label: 'Notifications',
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
          title: 'Territory Command',
          items: [
            {
              label: 'Dashboard',
              href: '/dashboard',
              icon: Compass,
              moduleKey: 'dashboard',
            },
            {
              label: 'Regional Hub',
              href: '/regional',
              icon: Compass,
              moduleKey: 'regional',
            },
            {
              label: 'Leads',
              href: '/leads',
              icon: Target,
              moduleKey: 'leads',
            },
            {
              label: 'Tenders',
              href: '/tenders',
              icon: FileText,
              moduleKey: 'tenders',
            },
            {
              label: 'Proposals',
              href: '/proposals',
              icon: FileSpreadsheet,
              moduleKey: 'proposals',
            },
            {
              label: 'Reports',
              href: '/reports',
              icon: FileSpreadsheet,
              moduleKey: 'reports',
            },
            {
              label: 'Products',
              href: '/products',
              icon: Package,
              moduleKey: 'products',
            },
          ],
        },
        {
          title: 'Field Operations',
          items: [
            {
              label: 'Visits',
              href: '/visits',
              icon: Calendar,
              moduleKey: 'visits',
            },
            {
              label: 'Demos',
              href: '/demos',
              icon: Box,
              moduleKey: 'demos',
            },
            {
              label: 'Service',
              href: '/service',
              icon: Wrench,
              moduleKey: 'service',
            },
            {
              label: 'Deliveries',
              href: '/deliveries',
              icon: Truck,
              moduleKey: 'deliveries',
            },
          ],
        },
        {
          title: 'Approvals & Tasks',
          items: [
            {
              label: 'Expenses',
              href: '/expenses',
              icon: Receipt,
              moduleKey: 'expenses',
              badge: 'Stage 1',
              badgeVariant: 'warning',
            },
            {
              label: 'Tasks',
              href: '/tasks',
              icon: CheckSquare,
              moduleKey: 'tasks',
            },
            {
              label: 'Notifications',
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
          title: 'System',
          items: [
            {
              label: 'Dashboard',
              href: '/dashboard',
              icon: Settings,
              moduleKey: 'dashboard',
            },
            {
              label: 'Admin',
              href: '/admin',
              icon: Settings,
              moduleKey: 'admin',
              badge: 'Security',
              badgeVariant: 'urgent',
            },
            {
              label: 'Reports',
              href: '/reports',
              icon: FileSpreadsheet,
              moduleKey: 'reports',
            },
            {
              label: 'Products',
              href: '/products',
              icon: Package,
              moduleKey: 'products',
            },
          ],
        },
        {
          title: 'Operations',
          items: [
            {
              label: 'Regional Hub',
              href: '/regional',
              icon: Compass,
              moduleKey: 'regional',
            },
            {
              label: 'Tenders',
              href: '/tenders',
              icon: FileText,
              moduleKey: 'tenders',
            },
            {
              label: 'Leads',
              href: '/leads',
              icon: Target,
              moduleKey: 'leads',
            },
            {
              label: 'Visits',
              href: '/visits',
              icon: Calendar,
              moduleKey: 'visits',
            },
            {
              label: 'Demos',
              href: '/demos',
              icon: Box,
              moduleKey: 'demos',
            },
            {
              label: 'Proposals',
              href: '/proposals',
              icon: FileSpreadsheet,
              moduleKey: 'proposals',
            },
            {
              label: 'Service',
              href: '/service',
              icon: Wrench,
              moduleKey: 'service',
            },
            {
              label: 'Deliveries',
              href: '/deliveries',
              icon: Truck,
              moduleKey: 'deliveries',
            },
          ],
        },
        {
          title: 'Governance',
          items: [
            {
              label: 'Expenses',
              href: '/expenses',
              icon: Receipt,
              moduleKey: 'expenses',
            },
            {
              label: 'Tasks',
              href: '/tasks',
              icon: CheckSquare,
              moduleKey: 'tasks',
            },
            {
              label: 'Notifications',
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
          title: 'Executive',
          items: [
            {
              label: 'Dashboard',
              href: '/dashboard',
              icon: Activity,
              moduleKey: 'dashboard',
            },
            {
              label: 'Regional Hub',
              href: '/regional',
              icon: Compass,
              moduleKey: 'regional',
            },
            {
              label: 'Reports',
              href: '/reports',
              icon: FileSpreadsheet,
              moduleKey: 'reports',
            },
            {
              label: 'Products',
              href: '/products',
              icon: Package,
              moduleKey: 'products',
            },
          ],
        },
        {
          title: 'Commercial & Operations',
          items: [
            {
              label: 'Tenders',
              href: '/tenders',
              icon: FileText,
              moduleKey: 'tenders',
              badge: 'Live Bids',
              badgeVariant: 'urgent',
            },
            {
              label: 'Leads',
              href: '/leads',
              icon: Target,
              moduleKey: 'leads',
            },
            {
              label: 'Proposals',
              href: '/proposals',
              icon: FileSpreadsheet,
              moduleKey: 'proposals',
            },
            {
              label: 'Visits',
              href: '/visits',
              icon: Calendar,
              moduleKey: 'visits',
            },
            {
              label: 'Demos',
              href: '/demos',
              icon: Box,
              moduleKey: 'demos',
            },
            {
              label: 'Service',
              href: '/service',
              icon: Wrench,
              moduleKey: 'service',
            },
            {
              label: 'Deliveries',
              href: '/deliveries',
              icon: Truck,
              moduleKey: 'deliveries',
            },
          ],
        },
        {
          title: 'Governance',
          items: [
            {
              label: 'Expenses',
              href: '/expenses',
              icon: Receipt,
              moduleKey: 'expenses',
              badge: 'Sign-offs',
              badgeVariant: 'warning',
            },
            {
              label: 'Tasks',
              href: '/tasks',
              icon: CheckSquare,
              moduleKey: 'tasks',
            },
            {
              label: 'Admin',
              href: '/admin',
              icon: Settings,
              moduleKey: 'admin',
            },
            {
              label: 'Notifications',
              href: '/notifications',
              icon: Bell,
              moduleKey: 'notifications',
            },
          ],
        },
      ];
  }
}

export const Sidebar: React.FC = () => {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const { isCollapsed, isOpenMobile, toggleCollapse, closeMobile } = useSidebar();

  const role = user?.role || 'management';
  const roleProfile = ROLE_PROFILES[role];
  const navGroups = getRoleNavGroups(role);

  // RBAC clearance validation
  const isModuleAllowed = (moduleKey: BosModuleKey | 'reports' | 'products') => {
    if (!user) return false;
    if (moduleKey === 'products' || moduleKey === 'dashboard') {
      return true;
    }
    if (moduleKey === 'reports') {
      return ['management', 'regional_manager', 'tender_team', 'accounts', 'admin'].includes(user.role);
    }
    if (moduleKey === 'tenders' && user.role === 'sales') {
      return true;
    }
    return roleProfile?.allowedModules?.includes(moduleKey as BosModuleKey);
  };

  const renderNavContent = (isCompact: boolean, onNavigate?: () => void) => (
    <nav className={`px-2.5 py-3 ${isCompact ? 'space-y-3' : 'space-y-4'} overflow-y-auto custom-scrollbar flex-1 min-h-0`}>
      {navGroups.map((group, gIdx) => {
        const visibleItems = group.items.filter((item) => isModuleAllowed(item.moduleKey));
        if (visibleItems.length === 0) return null;

        return (
          <div key={group.title} className="space-y-1">
            {isCompact ? (
              gIdx > 0 && <div className="h-px bg-[#ECE9E2] my-2 mx-1" />
            ) : (
              <div className="px-2.5 text-[10px] font-bold text-[#8C827A] uppercase tracking-wider mb-1 select-none">
                {group.title}
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
                    className={`relative w-10 h-10 mx-auto flex items-center justify-center rounded-xl transition-all cursor-pointer group ${
                      isActive
                        ? 'bg-[#0F5E63] text-white shadow-xs font-semibold'
                        : 'text-[#4A5568] hover:bg-[#F6F5F1] hover:text-[#14213D]'
                    }`}
                  >
                    <Icon
                      className={`w-4 h-4 transition-transform group-hover:scale-105 ${
                        isActive ? 'text-white' : 'text-[#4A5568]'
                      }`}
                    />
                    {item.badge && (
                      <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-[#9A3412]" />
                    )}
                  </Link>
                );
              }

              return (
                <Link
                  key={item.href + item.label}
                  href={item.href}
                  onClick={onNavigate}
                  className={`flex items-center justify-between h-9 text-[13px] font-medium transition-all rounded-xl px-2.5 min-w-0 max-w-full group ${
                    isActive
                      ? 'bg-[#0F5E63] text-white shadow-xs font-semibold'
                      : 'text-[#4A5568] hover:bg-[#F6F5F1] hover:text-[#14213D]'
                  }`}
                >
                  <div className="flex items-center space-x-2.5 min-w-0 flex-1 mr-1.5">
                    <Icon
                      className={`w-4 h-4 shrink-0 transition-colors ${
                        isActive ? 'text-white' : 'text-[#71717A] group-hover:text-[#14213D]'
                      }`}
                    />
                    <span className="truncate">{item.label}</span>
                  </div>

                  <div className="flex items-center space-x-1 shrink-0">
                    {item.badge && (
                      <span
                        className={`text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full shrink-0 ${
                          isActive
                            ? 'bg-white/20 text-white'
                            : item.badgeVariant === 'urgent'
                            ? 'bg-[#FBEBDD] text-[#9A3412] border border-[#9A3412]/30'
                            : item.badgeVariant === 'warning'
                            ? 'bg-[#FEF3C7] text-[#92400E] border border-[#F59E0B]/30'
                            : 'bg-[#E3EFEE] text-[#0F5E63]'
                        }`}
                      >
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
      {/* DESKTOP SIDEBAR                                                           */}
      {/* ========================================================================= */}
      <aside
        className={`hidden lg:flex flex-col justify-between shrink-0 z-20 select-none bg-white border-r border-[#DCD8CE] transition-all duration-300 ease-in-out h-screen max-h-screen ${
          isCollapsed ? 'w-[72px]' : 'w-64'
        }`}
      >
        <div className="flex flex-col flex-1 min-h-0">
          {/* Header */}
          {isCollapsed ? (
            <div className="h-16 px-2 border-b border-[#DCD8CE] flex items-center justify-center bg-white shrink-0">
              <button
                type="button"
                onClick={toggleCollapse}
                className="h-9 w-9 rounded-lg hover:bg-[#F6F5F1] text-[#4A5568] hover:text-[#14213D] flex items-center justify-center transition-all cursor-pointer"
                title="Expand sidebar [Ctrl+B]"
                aria-label="Expand sidebar"
              >
                <PanelLeftOpen className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="h-16 px-4 border-b border-[#DCD8CE] flex items-center justify-between bg-white shrink-0">
              <div className="flex items-center space-x-2.5 min-w-0">
                <div className="h-9 w-9 rounded-xl bg-[#0F5E63] flex items-center justify-center text-white shadow-xs shrink-0">
                  <Shield className="h-4.5 w-4.5" />
                </div>
                <div className="min-w-0">
                  <div className="font-serif font-bold text-[#14213D] text-[15px] tracking-tight flex items-center gap-1.5">
                    <span>ARIHANT</span>
                    <span className="font-sans font-bold text-[9px] px-1.5 py-0.5 rounded-md bg-[#E3EFEE] text-[#0F5E63] tracking-wide">
                      BOS
                    </span>
                  </div>
                  <div className="text-[10px] text-[#4A5568] font-medium tracking-wide">
                    Defence &amp; Security ERP
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={toggleCollapse}
                className="p-1.5 rounded-lg text-[#4A5568] hover:text-[#14213D] hover:bg-[#F6F5F1] transition-all cursor-pointer shrink-0 ml-1"
                title="Collapse sidebar [Ctrl+B]"
                aria-label="Collapse sidebar"
              >
                <PanelLeftClose className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Navigation List */}
          {renderNavContent(isCollapsed)}
        </div>

        {/* Footer / User Card / Logout */}
        {isCollapsed ? (
          <div className="p-2 border-t border-[#DCD8CE] bg-[#FBFAF7] flex flex-col items-center space-y-2 shrink-0">
            {user && (
              <div
                className="h-8 w-8 rounded-lg bg-[#0F5E63] text-white flex items-center justify-center text-xs font-bold shrink-0 relative cursor-default"
                title={`${user.full_name} • ${roleProfile?.title || user.role.replace('_', ' ')}`}
              >
                {user.full_name ? user.full_name[0].toUpperCase() : 'A'}
                <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-500 ring-2 ring-white" />
              </div>
            )}
            <button
              onClick={logout}
              title="Sign Out"
              aria-label="Sign Out"
              className="h-8 w-8 flex items-center justify-center rounded-lg text-[#4A5568] hover:text-[#9A3412] hover:bg-[#FBEBDD] transition-colors cursor-pointer"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <div className="p-3 border-t border-[#DCD8CE] bg-[#FBFAF7] shrink-0">
            {user && (
              <div className="flex items-center justify-between gap-2 p-2 rounded-xl bg-white border border-[#DCD8CE] shadow-xs">
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  <div className="h-8 w-8 rounded-lg bg-[#0F5E63] text-white flex items-center justify-center text-xs font-bold shrink-0 relative">
                    {user.full_name ? user.full_name[0].toUpperCase() : 'A'}
                    <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-500 ring-2 ring-white" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-semibold text-[#14213D] truncate">{user.full_name}</div>
                    <div className="text-[10px] text-[#4A5568] truncate font-medium">
                      {roleProfile?.title || user.role.replace('_', ' ')}
                    </div>
                  </div>
                </div>
                <button
                  onClick={logout}
                  title="Sign Out"
                  aria-label="Sign Out"
                  className="p-1.5 rounded-lg text-[#4A5568] hover:text-[#9A3412] hover:bg-[#FBEBDD] transition-colors cursor-pointer shrink-0"
                >
                  <LogOut className="h-4 w-4" />
                </button>
              </div>
            )}
            <div className="mt-2 flex items-center justify-between px-1 text-[10px] text-[#4A5568]">
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span>GeM Portal Active</span>
              </span>
              <span className="font-mono text-[9px] text-[#8C827A]">v2.4.0</span>
            </div>
          </div>
        )}
      </aside>

      {/* ========================================================================= */}
      {/* MOBILE DRAWER                                                             */}
      {/* ========================================================================= */}
      {isOpenMobile && (
        <div className="fixed inset-0 z-50 lg:hidden">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/40 backdrop-blur-xs transition-opacity"
            onClick={closeMobile}
          />

          {/* Drawer Panel */}
          <aside className="fixed top-0 left-0 bottom-0 w-72 max-w-[85vw] bg-white z-50 shadow-2xl flex flex-col justify-between select-none text-[#35463F] border-r border-[#DCD8CE] animate-in slide-in-from-left duration-200">
            <div className="flex flex-col flex-1 min-h-0">
              {/* Header with Close Button */}
              <div className="h-16 px-4 border-b border-[#DCD8CE] flex items-center justify-between bg-white shrink-0">
                <div className="flex items-center space-x-2.5 min-w-0">
                  <div className="h-9 w-9 rounded-xl bg-[#0F5E63] flex items-center justify-center text-white shadow-xs shrink-0">
                    <Shield className="h-4.5 w-4.5" />
                  </div>
                  <div className="min-w-0">
                    <div className="font-serif font-bold text-[#14213D] text-[15px] tracking-tight flex items-center gap-1.5">
                      <span>ARIHANT</span>
                      <span className="font-sans font-bold text-[9px] px-1.5 py-0.5 rounded-md bg-[#E3EFEE] text-[#0F5E63] tracking-wide">
                        BOS
                      </span>
                    </div>
                    <div className="text-[10px] text-[#4A5568] font-medium tracking-wide">
                      Defence &amp; Security ERP
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={closeMobile}
                  className="p-1.5 rounded-lg text-[#4A5568] hover:text-[#14213D] hover:bg-[#F6F5F1] transition-colors cursor-pointer"
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
            <div className="p-3 border-t border-[#DCD8CE] bg-[#FBFAF7] shrink-0">
              {user && (
                <div className="flex items-center justify-between gap-2 p-2 rounded-xl bg-white border border-[#DCD8CE] shadow-xs">
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <div className="h-8 w-8 rounded-lg bg-[#0F5E63] text-white flex items-center justify-center text-xs font-bold shrink-0 relative">
                      {user.full_name ? user.full_name[0].toUpperCase() : 'A'}
                      <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-500 ring-2 ring-white" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-semibold text-[#14213D] truncate">{user.full_name}</div>
                      <div className="text-[10px] text-[#4A5568] truncate font-medium">
                        {roleProfile?.title || user.role.replace('_', ' ')}
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      closeMobile();
                      logout();
                    }}
                    title="Sign Out"
                    aria-label="Sign Out"
                    className="p-1.5 rounded-lg text-[#4A5568] hover:text-[#9A3412] hover:bg-[#FBEBDD] transition-colors cursor-pointer shrink-0"
                  >
                    <LogOut className="h-4 w-4" />
                  </button>
                </div>
              )}
              <div className="mt-2 flex items-center justify-between px-1 text-[10px] text-[#4A5568]">
                <span className="flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  <span>GeM Portal Active</span>
                </span>
                <span className="font-mono text-[9px] text-[#8C827A]">v2.4.0</span>
              </div>
            </div>
          </aside>
        </div>
      )}
    </>
  );
};
