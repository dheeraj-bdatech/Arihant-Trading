'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { PageLoader } from '@/components/ui';

/** A claim opens as a popup over the Expenses list; old /expenses/:id links (notifications, e-mails) land there. */
export default function ExpenseClaimRedirect() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  useEffect(() => {
    router.replace(`/expenses?open=${encodeURIComponent(id)}`);
  }, [id, router]);
  return <PageLoader rows={4} />;
}
