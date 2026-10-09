'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Spinner } from '@/components/ui/Spinner';
import { useAuth, PRESET_ROLE_USERS } from '@/lib/auth-context';
import { ROLE_PROFILES, type UserRole } from '@arihant/shared';
import {
  Shield,
  ShieldCheck,
  CheckCircle2,
  UserCheck,
  X,
  ChevronUp,
  LogOut,
  Sparkles,
  AlertCircle,
} from 'lucide-react';

const ROLE_CAPABILITY_TAGS: Record<UserRole, string[]> = {
  management: ['All-India Scope', 'Tender Signoff', 'Stage 1 & 2 Payouts'],
  regional_manager: ['North Zone Command', 'Stage-1 Endorse', 'Directive Oversight'],
  sales: ['Delhi NCR Pipeline', 'Tour Itinerary', 'Quotation Prep'],
  tender_team: ['National GeM Cell', 'Bid Prep & PQ', 'EMD Tracking'],
  demo_team: ['North Depot Fleet', 'Trials Dispatch', 'Gate-Pass Handover'],
  service_team: ['National Service Desk', 'Breakdown SLAs', 'Spares Coordination'],
  accounts: ['Corporate Accounts', 'Stage-2 Payouts', 'GST & Bank Audit'],
  admin: ['Platform Admin', 'User Provisioning', 'Master Data & RBAC'],
};

const ROLE_SHORT_LABELS: Record<UserRole, string> = {
  management: 'MGMT',
  regional_manager: 'REG MGR',
  sales: 'SALES',
  tender_team: 'TENDER',
  demo_team: 'DEMO',
  service_team: 'SERVICE',
  accounts: 'ACCOUNTS',
  admin: 'ADMIN',
};

export const PersonaSwitcherFab: React.FC = () => {
  const { user, switchRole, logout } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [switchingRole, setSwitchingRole] = useState<UserRole | null>(null);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const handleRoleSelect = async (role: UserRole) => {
    if (user?.role === role && !error) {
      setIsOpen(false);
      return;
    }
    try {
      setSwitchingRole(role);
      setError(null);
      await switchRole(role);
      setIsOpen(false);
    } catch (err: any) {
      setError(err.message || 'Failed to switch persona. Please try again.');
    } finally {
      setSwitchingRole(null);
    }
  };

  const activeRole = user?.role;
  const activePreset = activeRole ? PRESET_ROLE_USERS[activeRole] : null;
  const activeProfile = activeRole ? ROLE_PROFILES[activeRole] : null;

  return (
    <div
      ref={containerRef}
      className="fixed bottom-5 right-5 z-50 flex flex-col items-end select-none font-sans"
    >
      {/* Floating Modal / Panel */}
      {isOpen && (
        <div
          className="mt-popup mb-3 w-[360px] sm:w-[440px] max-h-[85vh] flex flex-col rounded-[14px] bg-white border border-[#DCD8CE] shadow-2xl p-4 text-xs text-[#14213D] animate-in fade-in slide-in-from-bottom-3 duration-200"
          style={{
            boxShadow:
              '0 20px 45px -10px rgba(15, 94, 99, 0.18), 0 0 0 1px rgba(220, 216, 206, 0.9)',
          }}
        >
          {/* Header */}
          <div className="flex items-center justify-between pb-3 border-b border-[#ECE9E2] shrink-0">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-[8px] bg-[#E3EFEE] border border-[#0F5E63]/30 flex items-center justify-center text-[#0F5E63]">
                <ShieldCheck className="w-4 h-4" />
              </div>
              <div>
                <div className="text-xs font-bold text-[#14213D] flex items-center gap-1.5">
                  <span className="font-serif">Fast Role Access</span>
                  <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-[#E3EFEE] text-[#0F5E63] border border-[#0F5E63]/30">
                    8 Clearances
                  </span>
                </div>
                <div className="text-[10px] text-[#4A5568]">
                  {user ? '1-Click Persona Switcher' : '1-Click Role Sign-In'}
                </div>
              </div>
            </div>

            <button
              onClick={() => setIsOpen(false)}
              className="p-1 rounded-[6px] hover:bg-slate-100 text-[#4A5568] hover:text-[#14213D] transition-colors"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Error Notice */}
          {error && (
            <div className="mt-2.5 p-2 rounded-[8px] bg-[#FCE8EC] border border-red-200 text-[11px] text-[#881337] flex items-center gap-2 shrink-0">
              <AlertCircle className="w-4 h-4 shrink-0 text-[#881337]" />
              <span className="truncate">{error}</span>
            </div>
          )}

          {/* Current Active User Banner (if authenticated) */}
          {user && activePreset && (
            <div className="mt-3 p-2.5 rounded-[10px] bg-[#FBFAF7] border border-[#DCD8CE] shrink-0 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-7 h-7 rounded-full bg-[#0F5E63] text-white flex items-center justify-center font-bold text-[11px] shrink-0">
                    {activePreset.name.charAt(0)}
                  </div>
                  <div className="min-w-0">
                    <div className="font-bold text-[#14213D] text-xs truncate flex items-center gap-1.5">
                      <span>{user.full_name}</span>
                      <span
                        className="text-[9px] font-extrabold px-1.5 py-0.2 rounded border uppercase tracking-wider bg-[#E3EFEE] text-[#0F5E63] border-[#0F5E63]/30"
                      >
                        {ROLE_SHORT_LABELS[user.role] || user.role}
                      </span>
                    </div>
                    <div className="text-[10px] text-[#4A5568] truncate">
                      {activePreset.title} &bull; {activePreset.zone}
                    </div>
                  </div>
                </div>

                <button
                  onClick={() => {
                    setIsOpen(false);
                    logout();
                  }}
                  title="Sign Out"
                  className="flex items-center gap-1 px-2 py-1 rounded-[6px] text-[10px] font-semibold text-gray-600 hover:text-[#881337] hover:bg-[#FCE8EC] border border-[#DCD8CE] transition-colors shrink-0"
                >
                  <LogOut className="w-3 h-3" />
                  <span>Sign Out</span>
                </button>
              </div>

              {/* Scope Summary Quote */}
              {activeProfile && (
                <div className="text-[10px] text-gray-700 bg-white border border-[#DCD8CE] rounded-[6px] px-2 py-1 leading-snug italic truncate">
                  &ldquo;{activeProfile.scopeSummary}&rdquo;
                </div>
              )}
            </div>
          )}

          {/* Section Header */}
          <div className="mt-3 mb-1.5 flex items-center justify-between px-0.5 shrink-0">
            <span className="text-[10px] font-bold text-[#4A5568] uppercase tracking-wider flex items-center gap-1">
              <UserCheck className="w-3 h-3 text-[#0F5E63]" />
              Select Profile to Authenticate
            </span>
            <span className="text-[10px] text-[#4A5568]">
              Instant &bull; No password entry
            </span>
          </div>

          {/* 8 Roles Grid */}
          <div className="overflow-y-auto pr-1 space-y-1.5 flex-1 custom-scrollbar">
            {(Object.keys(PRESET_ROLE_USERS) as UserRole[]).map((roleKey) => {
              const info = PRESET_ROLE_USERS[roleKey];
              const isCurrent = user?.role === roleKey;
              const isSwitchingThis = switchingRole === roleKey;
              const shortLabel = ROLE_SHORT_LABELS[roleKey] || roleKey;

              return (
                <button
                  key={roleKey}
                  onClick={() => handleRoleSelect(roleKey)}
                  disabled={switchingRole !== null}
                  className={`w-full text-left p-2 rounded-[8px] border transition-all flex items-center justify-between group cursor-pointer ${
                    isCurrent
                      ? 'bg-[#E3EFEE] border-[#0F5E63] shadow-xs'
                      : 'bg-white hover:bg-[#FBFAF7] border-[#DCD8CE] hover:border-[#0F5E63]'
                  } ${switchingRole !== null && !isSwitchingThis ? 'opacity-50' : ''}`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div
                      className={`w-7 h-7 rounded-[6px] flex items-center justify-center font-bold text-[10px] shrink-0 transition-transform group-hover:scale-105 ${
                        isCurrent
                          ? 'bg-[#0F5E63] text-white'
                          : 'bg-[#FBFAF7] text-[#0F5E63] border border-[#DCD8CE]'
                      }`}
                    >
                      {isSwitchingThis ? (
                        <Spinner size="xs" />
                      ) : (
                        shortLabel.slice(0, 2)
                      )}
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-xs text-[#14213D] truncate">
                          {info.name}
                        </span>
                        <span
                          className="text-[9px] font-extrabold px-1.5 py-0.2 rounded border uppercase tracking-wider shrink-0 bg-[#FBFAF7] text-[#4A5568] border-[#DCD8CE]"
                        >
                          {shortLabel}
                        </span>
                      </div>
                      <div className="text-[10px] text-[#4A5568] truncate">
                        {info.title} &bull;{' '}
                        <span className="font-medium text-[#0F5E63]">{info.zone}</span>
                      </div>
                    </div>
                  </div>

                  <div className="shrink-0 ml-2">
                    {isSwitchingThis ? (
                      <span className="text-[10px] text-[#0F5E63] font-semibold flex items-center gap-1">
                        <Spinner size="xs" />
                        <span>Signing In...</span>
                      </span>
                    ) : isCurrent ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-[#0F5E63] bg-white px-2 py-0.5 rounded-full border border-[#DCD8CE]">
                        <CheckCircle2 className="w-3 h-3 text-[#0F5E63]" />
                        <span>Active</span>
                      </span>
                    ) : (
                      <span className="text-[10px] font-semibold text-[#4A5568] group-hover:text-[#0F5E63] group-hover:translate-x-0.5 transition-all">
                        Sign In &rarr;
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Footer Note */}
          <div className="mt-3 pt-2 border-t border-[#ECE9E2] text-center text-[10px] text-[#4A5568] shrink-0 font-medium">
            Arihant BOS &bull; Seamless RBAC Persona Switcher
          </div>
        </div>
      )}

      {/* Floating Action Button (FAB Trigger) */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        title="Quick Role Sign-In & Persona Clearance Switcher"
        className="mt-fab flex items-center gap-2.5 px-3.5 py-2 rounded-full bg-white/95 backdrop-blur-md border border-[#DCD8CE] shadow-lg hover:shadow-xl hover:border-[#0F5E63]/50 transition-all duration-200 group text-left cursor-pointer active:scale-98"
        style={{ boxShadow: '0 8px 24px -6px rgba(15, 94, 99, 0.18)' }}
      >
        <div className="relative shrink-0">
          <div className="w-7 h-7 rounded-full bg-[#0F5E63] text-white flex items-center justify-center font-bold text-xs shadow-xs group-hover:scale-105 transition-transform">
            <Shield className="w-3.5 h-3.5" />
          </div>
          <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-500 ring-2 ring-white animate-pulse" />
        </div>

        <div className="flex flex-col min-w-0 pr-1">
          {user ? (
            <>
              <div className="flex items-center gap-1.5">
                <span className="text-[9px] font-bold text-[#4A5568] uppercase tracking-wider leading-none">
                  Role
                </span>
                <span
                  className="text-[9px] font-extrabold px-1.5 py-0.2 rounded border leading-none bg-[#E3EFEE] text-[#0F5E63] border-[#0F5E63]/30"
                >
                  {ROLE_SHORT_LABELS[user.role] || user.role.toUpperCase().replace('_', ' ')}
                </span>
              </div>
              <span className="text-xs font-bold text-[#14213D] truncate max-w-[140px] mt-0.5 leading-tight">
                {activePreset?.name || user.full_name}
              </span>
            </>
          ) : (
            <>
              <div className="flex items-center gap-1">
                <Sparkles className="w-2.5 h-2.5 text-[#0F5E63]" />
                <span className="text-[9px] font-extrabold text-[#0F5E63] uppercase tracking-wider leading-none">
                  Role Sign-In
                </span>
              </div>
              <span className="text-xs font-bold text-[#14213D] mt-0.5 leading-tight">
                8 Demo Profiles
              </span>
            </>
          )}
        </div>

        <div className="pl-1 border-l border-[#DCD8CE]/60 text-[#4A5568] group-hover:text-[#0F5E63] transition-colors">
          <ChevronUp
            className={`w-4 h-4 transition-transform duration-200 ${
              isOpen ? 'rotate-180 text-[#0F5E63]' : ''
            }`}
          />
        </div>
      </button>
    </div>
  );
};
