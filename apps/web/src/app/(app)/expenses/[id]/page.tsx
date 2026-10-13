'use client';

import React from 'react';
import { useParams } from 'next/navigation';
import { Receipt } from 'lucide-react';
import { PageContainer, PageHeader } from '@/components/ui';
import { ClaimDetail } from '../_lib/ClaimDetail';
import { ExpensesNav } from '../_lib/expense-ui';

export default function ExpenseClaimPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <PageContainer>
      <PageHeader title="Expense Claim" icon={<Receipt className="h-5 w-5" />} />
      <ExpensesNav />
      <ClaimDetail key={id} claimId={id} />
    </PageContainer>
  );
}
