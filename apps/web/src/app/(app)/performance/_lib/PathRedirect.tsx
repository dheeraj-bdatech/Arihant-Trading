'use client';

import React, { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { PageLoader } from '@/components/ui';

function Redirect({ to }: { to: string }) {
  const router = useRouter();
  const params = useSearchParams();
  useEffect(() => {
    const qs = params.toString();
    router.replace(qs ? `${to}?${qs}` : to);
  }, [router, params, to]);
  return <PageLoader rows={3} />;
}

/** A page that moved: forwards to its new path with the same query string (old links, bookmarks, notifications). */
export const PathRedirect: React.FC<{ to: string }> = ({ to }) => (
  <Suspense fallback={<PageLoader rows={3} />}>
    <Redirect to={to} />
  </Suspense>
);
