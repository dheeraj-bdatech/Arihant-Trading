'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { PageLoader } from '@/components/ui';

/** Old Accounts-queue links (dashboard, notifications, e-mails) open the Expenses list filtered to With Accounts. */
export default function AccountsQueueRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/expenses?stage=accounts');
  }, [router]);
  return <PageLoader rows={4} />;
}
