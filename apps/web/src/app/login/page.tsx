'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Shield,
  ArrowRight,
  UserCheck,
  CheckCircle2,
  AlertCircle,
  Lock,
} from 'lucide-react';
import { useAuth, PRESET_ROLE_USERS } from '@/lib/auth-context';
import { Button, Input, MithilaDecor } from '@/components/ui';
import type { UserRole } from '@arihant/shared';

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();

  // the sign-in screen sits outside the app shell, so switch the Mithila theme on here too
  useEffect(() => {
    document.body.classList.add('mithila');
    return () => document.body.classList.remove('mithila');
  }, []);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [activeRoleKey, setActiveRoleKey] = useState<UserRole | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      await login(email, password);
    } catch (err: any) {
      setError(err.message || 'Authentication failed. Please check credentials.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleQuickRoleSelect = (role: UserRole) => {
    setActiveRoleKey(role);
    setEmail(PRESET_ROLE_USERS[role].email);
    setPassword('password123');
  };

  return (
    <div className="relative min-h-screen bg-[#F6F5F1] grid grid-cols-1 lg:grid-cols-12 select-none text-[#14213D]">
      {/* Left Column: Brand Hero (matches ui-kit .auth__brand) */}
      <MithilaDecor />
      <section className="mt-login-hero relative z-10 lg:col-span-5 bg-[#FBE9D0] text-[#14213D] p-8 lg:p-14 flex flex-col justify-between gap-8 border-r-[1.5px] border-[#9A3412] overflow-hidden">
        <div className="space-y-2">
          <div className="flex items-center gap-2.5">
            <div className="h-10 w-10 rounded-[8px] mt-logo bg-[#9A3412] flex items-center justify-center text-white shadow-xs">
              <img src="/mithila/lotus.svg" alt="" className="h-8 w-8" />
            </div>
            <div>
              <div className="font-serif text-2xl font-bold text-[#14213D] tracking-tight flex items-center gap-1.5">
                <span>Arihant</span>
                <span className="font-sans font-bold text-xs px-1.5 py-0.2 rounded bg-[#9A3412] text-white">
                  BOS
                </span>
              </div>
              <p className="text-xs text-[#4A5568] font-medium">
                Defence &amp; Security GeM Enterprise ERP
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-6 my-auto py-8">
          <h1 className="font-serif text-3xl lg:text-4xl leading-tight font-bold text-[#14213D]">
            Every stage of defence procurement, on one audited record.
          </h1>
          <p className="text-sm text-[#4A5568] leading-relaxed">
            From PQ qualification, dual-control internal reviews, and GeM external portal dispatch to live reverse auctions and L1 win/loss post-mortems.
          </p>
          <div className="flex flex-wrap gap-2 pt-2">
            <span className="px-2.5 py-1 rounded-full border border-[#D9B98A] text-xs font-mono text-[#14213D]">
              PQ Qualification
            </span>
            <span className="px-2.5 py-1 rounded-full border border-[#D9B98A] text-xs font-mono text-[#14213D]">
              Internal Review
            </span>
            <span className="px-2.5 py-1 rounded-full border border-[#D9B98A] text-xs font-mono text-[#14213D]">
              GeM Submission
            </span>
            <span className="px-2.5 py-1 rounded-full border border-[#9A3412] text-[#9A3412] text-xs font-mono font-bold bg-[#9A3412]/10">
              Live Reverse Auction
            </span>
            <span className="px-2.5 py-1 rounded-full border border-[#D9B98A] text-xs font-mono text-[#14213D]">
              L1 Post-Mortem
            </span>
          </div>
        </div>

        <div className="p-4 rounded-[10px] bg-[#FFFCF5] border border-[#D9B98A] space-y-1">
          <span className="text-[10px] tracking-wider text-[#4A5568] uppercase font-bold">
            GeM Gateway Status
          </span>
          <p className="text-xs text-[#14213D] leading-relaxed">
            Official GeM Portal Bridge connected. All bids signed with registered DSC and territorial clearance.
          </p>
          <span className="text-[11px] text-[#9A3412] font-mono block pt-1">
            Production Release v2.4 · Delhi HQ
          </span>
        </div>
      </section>

      {/* Right Column: Sign In & Role Picker (matches ui-kit .auth__form) */}
      <main className="relative z-10 lg:col-span-7 p-6 sm:p-10 lg:p-14 flex items-center justify-center bg-[#F6F5F1]">
        <div className="w-full max-w-2xl space-y-8">
          <div>
            <span className="text-xs font-semibold text-[#4A5568] uppercase tracking-wider">
              Secure Access Portal
            </span>
            <h2 className="font-serif text-3xl font-bold text-[#14213D] mt-1">
              Sign in to Arihant BOS
            </h2>
            <p className="text-xs text-[#4A5568] mt-1">
              Authenticate with your enterprise credentials or choose one of the 8 RBAC profiles below.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-start">
            {/* Credentials Card */}
            <div className="edge md:col-span-6 bg-white border border-[#DCD8CE] rounded-[14px] p-6 shadow-2xs space-y-4">
              <div className="flex items-center justify-between pb-2 border-b border-[#ECE9E2]">
                <span className="text-xs font-bold text-[#14213D] uppercase tracking-wider">
                  Credentials
                </span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-[#E3EFEE] text-[#0F5E63] border border-[#0F5E63]/30">
                  Dual-Control
                </span>
              </div>

              {error && (
                <div className="p-3 rounded-[8px] bg-[#FCE8EC] border border-red-200 text-xs text-[#881337] flex items-center space-x-2">
                  <AlertCircle className="h-4 w-4 shrink-0 text-[#881337]" />
                  <span>{error}</span>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-3.5">
                <Input
                  label="Official Email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="officer@arihant.com"
                />

                <Input
                  label="Password"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                />

                <div className="pt-2">
                  <Button
                    type="submit"
                    size="lg"
                    className="w-full font-semibold text-xs"
                    isLoading={isLoading}
                  >
                    <span>Sign in to Dashboard</span>
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </div>
              </form>

              <div className="pt-3 border-t border-[#ECE9E2] text-center">
                <span className="text-[11px] text-[#4A5568]">
                  Arihant Trading Corporation &bull; All Rights Reserved
                </span>
              </div>
            </div>

            {/* Persona Switcher (8 Roles) */}
            <div className="edge md:col-span-6 bg-white border border-[#DCD8CE] rounded-[14px] p-5 shadow-2xs space-y-3">
              <div className="flex items-center justify-between pb-2 border-b border-[#ECE9E2]">
                <div className="flex items-center space-x-1.5">
                  <UserCheck className="h-4 w-4 text-[#0F5E63]" />
                  <span className="text-xs font-bold text-[#14213D] uppercase tracking-wider">
                    Quick Role Profiles
                  </span>
                </div>
                <span className="text-[10px] font-mono text-[#4A5568] bg-[#FBFAF7] px-2 py-0.5 rounded border border-[#DCD8CE]">
                  8 Clearances
                </span>
              </div>

              <div className="space-y-2 max-h-[360px] overflow-y-auto pr-1 custom-scrollbar">
                {(Object.keys(PRESET_ROLE_USERS) as UserRole[]).map((roleKey) => {
                  const info = PRESET_ROLE_USERS[roleKey];
                  const isSelected = activeRoleKey === roleKey;

                  return (
                    <div
                      key={roleKey}
                      onClick={() => handleQuickRoleSelect(roleKey)}
                      className={`p-2.5 rounded-[8px] border transition-all cursor-pointer text-left flex items-center justify-between ${
                        isSelected
                          ? 'border-[#0F5E63] bg-[#E3EFEE] text-[#0F5E63]'
                          : 'border-[#DCD8CE] bg-white hover:border-[#0F5E63] hover:bg-[#FBFAF7] text-[#14213D]'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-bold truncate">
                            {info.name}
                          </span>
                          {isSelected && (
                            <CheckCircle2 className="h-3.5 w-3.5 text-[#0F5E63] shrink-0" />
                          )}
                        </div>
                        <div className="text-[11px] text-[#4A5568] truncate">
                          {info.title} · <span className="font-mono">{info.zone}</span>
                        </div>
                      </div>
                      <span className="ml-2 px-1.5 py-0.2 rounded text-[9px] font-bold uppercase tracking-wider bg-[#FBFAF7] text-[#4A5568] border border-[#DCD8CE] shrink-0">
                        {roleKey.replace('_', ' ')}
                      </span>
                    </div>
                  );
                })}
              </div>

              <div className="p-2 rounded-[6px] bg-[#FBFAF7] border border-[#DCD8CE] text-[10px] text-[#4A5568] text-center font-medium">
                Click any clearance above to auto-fill credentials (pw: password123)
              </div>
            </div>
          </div>

          <a
            href="/service-request"
            className="flex min-h-[44px] items-center justify-center rounded-lg border border-[#C9C4B8] bg-white px-4 text-center text-sm font-semibold text-[#0F5E63] hover:bg-[#E3EFEE]"
          >
            Raise or track a service request — no login needed
          </a>
        </div>
      </main>
    </div>
  );
}
