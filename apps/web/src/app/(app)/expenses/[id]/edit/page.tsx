'use client';

import React from 'react';
import { useParams } from 'next/navigation';
import { Receipt } from 'lucide-react';
import { PageContainer, PageHeader } from '@/components/ui';
import { ClaimForm } from '../../_lib/ClaimForm';
import { ExpensesNav } from '../../_lib/expense-ui';

export default function EditExpenseClaimPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <PageContainer>
      <PageHeader title="Edit Expense Claim" icon={<Receipt className="h-5 w-5" />} />
      <ExpensesNav />
      <ClaimForm key={id} claimId={id} />
    </PageContainer>
  );
}
