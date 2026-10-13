'use client';

import React, { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Receipt } from 'lucide-react';
import { PageContainer, PageHeader, PageLoader } from '@/components/ui';
import { ClaimForm } from '../_lib/ClaimForm';
import { ExpensesNav } from '../_lib/expense-ui';

function NewClaim() {
  const params = useSearchParams();
  return <ClaimForm initialVisitId={params.get('visit_id')} initialTripId={params.get('trip_id')} />;
}

export default function NewExpenseClaimPage() {
  return (
    <PageContainer>
      <PageHeader title="New Expense Claim" icon={<Receipt className="h-5 w-5" />} />
      <ExpensesNav />
      <Suspense fallback={<PageLoader rows={3} />}>
        <NewClaim />
      </Suspense>
    </PageContainer>
  );
}
