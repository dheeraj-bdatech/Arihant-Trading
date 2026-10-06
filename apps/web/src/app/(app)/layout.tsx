'use client';

import React, { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth, PRESET_ROLE_USERS } from '@/lib/auth-context';
import { Sidebar } from '@/components/layout/Sidebar';
import { Navbar } from '@/components/layout/Navbar';
import { CommandPalette } from '@/components/layout/CommandPalette';
import { Shield, ShieldAlert, ArrowLeft, UserCheck } from 'lucide-react';
import { Button } from '@/components/ui';
import { SidebarProvider } from '@/lib/sidebar-context';
import type { UserRole } from '@arihant/shared';

const ROUTE_PERMISSIONS: { path: string; name: string; roles: UserRole[] }[] = [
  { path: '/regional', name: 'Regional Territory Command', roles: ['regional_manager', 'management', 'admin'] },
  { path: '/tenders', name: 'GeM Defence Tenders', roles: ['management', 'regional_manager', 'tender_team', 'sales', 'admin'] },
  { path: '/leads', name: 'Leads & CRM Accounts', roles: ['management', 'regional_manager', 'sales', 'admin'] },
  { path: '/visits', name: 'Field Tour Planner', roles: ['management', 'regional_manager', 'sales', 'demo_team', 'service_team', 'admin'] },
  { path: '/demos', name: 'Demo Fleet Matrix', roles: ['management', 'regional_manager', 'sales', 'demo_team', 'admin'] },
  { path: '/proposals', name: 'Commercial Proposals', roles: ['management', 'regional_manager', 'sales', 'tender_team', 'admin'] },
  { path: '/deliveries', name: 'Equipment Logistics & Delivery Register', roles: ['management', 'regional_manager', 'sales', 'service_team', 'admin'] },
  { path: '/service', name: 'Service Desk & Spares', roles: ['management', 'regional_manager', 'service_team', 'sales', 'admin'] },
  { path: '/expenses', name: 'Travel & Expense Reimbursements', roles: ['management', 'regional_manager', 'sales', 'tender_team', 'demo_team', 'service_team', 'accounts', 'admin'] },
  { path: '/tasks', name: 'Task & Productivity Management', roles: ['management', 'regional_manager', 'sales', 'tender_team', 'demo_team', 'service_team', 'accounts', 'admin'] },
  { path: '/reports', name: 'Consolidated Reporting & Exports', roles: ['management', 'regional_manager', 'tender_team', 'accounts', 'admin'] },
  { path: '/admin', name: 'Administration & System Audit', roles: ['management', 'admin'] },
];

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, isLoading, switchRole } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [isCommandOpen, setIsCommandOpen] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsCommandOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    if (!isLoading && !user) {
      router.push('/login');
    }
  }, [user, isLoading, router]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#F7F8FA] flex flex-col items-center justify-center space-y-3">
        <div className="h-12 w-12 rounded-[10px] bg-[#0F5E4E] flex items-center justify-center shadow-md animate-pulse">
          <Shield className="h-6 w-6 text-white" />
        </div>
        <p className="text-xs font-semibold text-[#5E6A7C] tracking-wider uppercase">
          Loading Arihant BOS...
        </p>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  // Route-Level Security Guard Check
  const restrictedRoute = ROUTE_PERMISSIONS.find(
    (r) => pathname === r.path || pathname.startsWith(r.path + '/'),
  );
  const isUnauthorized =
    restrictedRoute && !restrictedRoute.roles.includes(user.role);

  return (
    <SidebarProvider>
      <div className="h-screen bg-[#F6F5F1] flex flex-row text-[#152235] overflow-hidden">
        <Sidebar />
        <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
          <Navbar onOpenCommand={() => setIsCommandOpen(true)} />
          <main className="flex-1 overflow-y-auto p-6 lg:p-8 bg-[#F6F5F1] custom-scrollbar">
            {isUnauthorized ? (
              <div className="max-w-2xl mx-auto my-12 bg-white border border-[#E3E7ED] rounded-[10px] p-8 shadow-xs text-center space-y-5">
                <div className="h-14 w-14 rounded-[10px] bg-[#FBEBDD] border border-[#9A3412]/30 flex items-center justify-center mx-auto text-[#7C2D12]">
                  <ShieldAlert className="h-7 w-7" />
                </div>

                <div>
                  <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-[#FBEBDD] text-[#7C2D12] border border-[#9A3412]/20 uppercase tracking-wide">
                    403 — Access Denied
                  </span>
                  <h2 className="font-serif text-xl font-bold text-[#14213D] mt-2">
                    Restricted Operational Domain
                  </h2>
                  <p className="text-xs text-[#4A5568] mt-1.5 max-w-md mx-auto leading-relaxed">
                    Your active role (
                    <span className="font-semibold text-[#14213D]">
                      {user.role.toUpperCase().replace('_', ' ')}
                    </span>
                    ) does not have clearance to view or operate in{' '}
                    <span className="font-semibold text-[#0F5E63]">
                      {restrictedRoute.name}
                    </span>
                    .
                  </p>
                </div>

                <div className="p-3.5 rounded-[10px] bg-[#FBFAF7] border border-[#DCD8CE] text-xs text-left max-w-md mx-auto">
                  <div className="text-[10px] font-bold text-[#4A5568] uppercase tracking-wider mb-1">
                    Permitted Clearances for this Domain
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {restrictedRoute.roles.map((r) => (
                      <span
                        key={r}
                        className="px-2 py-0.5 rounded-[6px] bg-white border border-[#DCD8CE] text-[11px] font-medium text-[#14213D] capitalize"
                      >
                        {r.replace('_', ' ')}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-3">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => router.push('/dashboard')}
                  >
                    <ArrowLeft className="h-3.5 w-3.5 mr-1" />
                    <span>Return to Executive Deck</span>
                  </Button>

                  <div className="flex items-center gap-2 bg-[#FBFAF7] px-3 py-1.5 rounded-[8px] border border-[#DCD8CE]">
                    <UserCheck className="h-4 w-4 text-[#0F5E63]" />
                    <span className="text-xs font-medium text-[#14213D]">Switch Role:</span>
                    <select
                      value={user.role}
                      onChange={(e) => switchRole(e.target.value as UserRole)}
                      className="bg-white text-[#14213D] text-xs rounded-[6px] border border-[#C9C4B8] px-2 py-1 font-medium focus:border-[#0F5E63] focus:outline-none"
                    >
                      {Object.entries(PRESET_ROLE_USERS).map(([roleKey, info]) => (
                        <option key={roleKey} value={roleKey}>
                          {info.title}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            ) : (
              children
            )}
          </main>
        </div>
        <CommandPalette
          isOpen={isCommandOpen}
          onClose={() => setIsCommandOpen(false)}
        />
      </div>
    </SidebarProvider>
  );
}
