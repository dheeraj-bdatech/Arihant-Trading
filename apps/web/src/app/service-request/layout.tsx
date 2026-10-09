'use client';

import React, { useEffect } from 'react';
import Link from 'next/link';
import { MithilaBand, MithilaDecor } from '@/components/ui';

/**
 * Public, login-free shell for customer service requests. No sidebar and no auth redirect:
 * AuthProvider (root layout) only redirects after an explicit login, never on mount.
 */
export default function ServiceRequestLayout({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    document.body.classList.add('mithila');
    return () => document.body.classList.remove('mithila');
  }, []);

  return (
    <div className="relative min-h-screen overflow-x-hidden">
      {/* Staff persona switcher (root layout) is not meant for customers. */}
      <style dangerouslySetInnerHTML={{ __html: 'body > div.fixed.bottom-5.right-5 { display: none !important; }' }} />
      <MithilaDecor />
      <div className="relative z-10 flex min-h-screen flex-col">
        <header className="border-b border-[#DCD8CE] bg-white/90 backdrop-blur">
          <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 px-4 py-3">
            <Link href="/service-request" className="flex min-w-0 items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#0F5E63] font-serif text-lg font-bold text-white">
                A
              </span>
              <span className="min-w-0">
                <span className="block truncate font-serif text-[15px] font-bold leading-tight text-[#14213D]">
                  Arihant Trading Corporation
                </span>
                <span className="block truncate text-[11px] text-[#4A5568]">Service &amp; After-Sales</span>
              </span>
            </Link>
            <Link
              href="/service-request/track"
              className="inline-flex min-h-[44px] shrink-0 items-center text-xs font-semibold text-[#0F5E63] hover:underline"
            >
              Track a request
            </Link>
          </div>
        </header>
        <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-5 sm:py-8">
          <MithilaBand className="mithila-band--slim mb-5" />
          {children}
        </main>
        <footer className="border-t border-[#DCD8CE] bg-white/90 px-4 py-4 text-center text-xs text-[#4A5568]">
          For an active security emergency also call the Arihant service desk.
        </footer>
      </div>
    </div>
  );
}
