'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { PageLoader } from '@/components/ui';

/** Old Stage-1 approvals links (dashboard, notifications, e-mails) open the Expenses list filtered to Awaiting approval. */
export default function ExpenseApprovalsRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/expenses?stage=approval');
  }, [router]);
  return <PageLoader rows={4} />;
}
