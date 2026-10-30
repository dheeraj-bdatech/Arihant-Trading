'use client';

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { PageContainer, PageLoader } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { REPORT_TABS, ReportsDenied, canOpen } from './_lib/report-ui';

/** /reports opens the first report this role may see (Accounts → Expenses, Tender cell → Sales pipeline, …). */
export default function ReportsIndexPage() {
  const router = useRouter();
  const { user } = useAuth();
  const first = REPORT_TABS.find((t) => canOpen(user?.role, t.key));
  useEffect(() => {
    if (first) router.replace(first.href);
  }, [first, router]);
  return <PageContainer>{user && !first ? <ReportsDenied /> : <PageLoader rows={3} label="Opening reports" />}</PageContainer>;
}
