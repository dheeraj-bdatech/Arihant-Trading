import React from 'react';
import type { Metadata } from 'next';
import { AppearanceMenu } from '@/components/layout/AppearanceMenu';

// The page's address carries the private chat token: keep it out of search engines and referrer headers
export const metadata: Metadata = {
  title: 'Chat with Arihant Trading Corporation',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

/**
 * Public, login-free shell for a customer's lead chat. No sidebar and no auth redirect: AuthProvider (root layout)
 * only redirects after an explicit login, never on mount.
 */
export default function LeadChatLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-shell relative min-h-screen overflow-x-hidden">
      {/* Staff persona switcher (root layout) is not meant for customers. */}
      <style dangerouslySetInnerHTML={{ __html: 'body > div.fixed.bottom-5.right-5 { display: none !important; }' }} />
      <div className="relative z-10 flex min-h-screen flex-col">
        <header className="border-b border-[#DCD8CE] bg-white/90 backdrop-blur">
          <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 px-4 py-3">
            <span className="flex min-w-0 items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#0F5E63] font-serif text-lg font-bold text-white">
                A
              </span>
              <span className="min-w-0">
                <span className="block truncate font-serif text-[15px] font-bold leading-tight text-[#14213D]">
                  Arihant Trading Corporation
                </span>
                <span className="block truncate text-[11px] text-[#4A5568]">Sales chat</span>
              </span>
            </span>
            <AppearanceMenu />
          </div>
        </header>
        <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-5 sm:py-8">{children}</main>
        <footer className="border-t border-[#DCD8CE] bg-white/90 px-4 py-4 text-center text-xs text-[#4A5568]">
          Messages here are read by the Arihant sales team. Keep this link private: anyone who has it can read this chat.
        </footer>
      </div>
    </div>
  );
}
