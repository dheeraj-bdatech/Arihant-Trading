'use client';

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ClipboardCheck } from 'lucide-react';
import { InfoCallout, PageContainer, PageHeader } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { ClaimQueue } from '../_lib/ClaimQueue';
import { ExpensesNav } from '../_lib/expense-ui';

export default function ExpenseApprovalsPage() {
  const { user } = useAuth();
  const router = useRouter();
  // Accounts users reach this page from reminder notifications; their queue is the Accounts one.
  useEffect(() => {
    if (user?.role === 'accounts') router.replace('/expenses/accounts');
  }, [user, router]);

  return (
    <PageContainer>
      <PageHeader title="Expense Approvals" icon={<ClipboardCheck className="h-5 w-5" />} />
      <ExpensesNav />
      <InfoCallout variant="neutral">
        Claims your team submitted for your approval. Open a claim to approve, reduce or reject individual lines. You can never approve your own claims.
      </InfoCallout>
      <ClaimQueue
        endpoint="/expense-claims/pending/manager"
        emptyTitle="Nothing waiting for you"
        emptyDescription="When someone who reports to you submits an expense claim it appears here."
      />
    </PageContainer>
  );
}
