'use client';

import React, { useState } from 'react';
import { Landmark } from 'lucide-react';
import { InfoCallout, PageContainer, PageHeader, Tabs } from '@/components/ui';
import { ClaimQueue } from '../_lib/ClaimQueue';
import { ExpensesNav } from '../_lib/expense-ui';
import { useBadgeCounts } from '../_lib/expense-lib';

export default function AccountsQueuePage() {
  const [tab, setTab] = useState<'accounts_review' | 'accounts_approved'>('accounts_review');
  const counts = useBadgeCounts();
  return (
    <PageContainer>
      <PageHeader title="Accounts Queue" icon={<Landmark className="h-5 w-5" />} />
      <ExpensesNav />
      <Tabs
        variant="segmented"
        activeTab={tab}
        onChange={(id) => setTab(id as typeof tab)}
        tabs={[
          { id: 'accounts_review', label: 'To verify', count: counts?.accounts_pending || undefined },
          { id: 'accounts_approved', label: 'Ready for Tally', count: counts?.accounts_ready || undefined },
        ]}
      />
      <InfoCallout variant="neutral">
        {tab === 'accounts_review'
          ? 'Manager-approved claims. Verify receipts and amounts, then approve (or approve & process in one step).'
          : 'Verified claims. Select them, export in the fixed Tally format, post them in Tally, then mark each as processed with its voucher reference.'}
      </InfoCallout>
      <ClaimQueue
        endpoint="/expense-claims/pending/accounts"
        query={{ statuses: tab }}
        bulkExport
        emptyTitle={tab === 'accounts_review' ? 'No claims to verify' : 'Nothing waiting for Tally'}
        emptyDescription="Claims arrive here automatically once a manager approves them."
      />
    </PageContainer>
  );
}
