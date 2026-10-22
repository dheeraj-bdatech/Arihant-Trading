'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { Spinner } from '@/components/ui';

export default function RootIndexPage() {
  const { user, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading) {
      if (user) {
        router.replace('/dashboard');
      } else {
        router.replace('/login');
      }
    }
  }, [user, isLoading, router]);

  // Never a blank screen while the session is checked and the next route loads.
  return (
    <div className="app-shell flex min-h-screen flex-col items-center justify-center gap-4 bg-[#F6F5F1]">
      <Spinner size="lg" />
      <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-[#4A5568]">
        {isLoading ? 'Securing session' : user ? 'Opening your dashboard' : 'Redirecting to sign in'}
        <span className="loader-dots" aria-hidden />
      </p>
    </div>
  );
}
