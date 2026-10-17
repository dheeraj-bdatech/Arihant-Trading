'use client';

import React, { useState } from 'react';
import { Landmark, Layers } from 'lucide-react';
import { FilterMenu, InfoCallout, PageContainer, PageHeader } from '@/components/ui';
import { ClaimQueue } from '../_lib/ClaimQueue';
import { useBadgeCounts } from '../_lib/expense-lib';

type Stage = 'accounts_review' | 'accounts_approved' | 'processed';

export default function AccountsQueuePage() {
  const [tab, setTab] = useState<Stage>('accounts_review');
  const counts = useBadgeCounts();
  return (
    <PageContainer>
      <PageHeader title="Accounts Queue" icon={<Landmark className="h-5 w-5" />} />
      <ClaimQueue
        endpoint="/expense-claims/pending/accounts"
        query={{ statuses: tab }}
        notice={
          <InfoCallout variant="neutral">
            {tab === 'accounts_review'
              ? 'Manager-approved claims. Verify receipts and amounts, then approve (or approve & process in one step).'
              : tab === 'accounts_approved'
                ? 'Verified claims. Select them, export in the fixed Tally format, post them in Tally, then mark each as paid with its voucher and bank (UTR) reference.'
                : 'Paid claims with their bank payment reference (UTR) and payment date.'}
          </InfoCallout>
        }
        bulkExport={tab !== 'processed'}
        regionFilter
        extraFilters={
          <FilterMenu
            label="Stage"
            icon={<Layers />}
            neutralKeys={[]}
            options={[
              { key: 'accounts_review', label: 'To verify', count: counts?.accounts_pending ?? undefined },
              { key: 'accounts_approved', label: 'Ready for Tally', count: counts?.accounts_ready ?? undefined },
              { key: 'processed', label: 'Paid' },
            ].map((o) => ({ ...o, active: tab === o.key, onSelect: () => setTab(o.key as Stage) }))}
          />
        }
        extraActive={tab !== 'accounts_review'}
        onClearExtra={() => setTab('accounts_review')}
        emptyTitle={tab === 'accounts_review' ? 'No claims to verify' : tab === 'accounts_approved' ? 'Nothing waiting for Tally' : 'No paid claims yet'}
        emptyDescription="Claims arrive here automatically once a manager approves them."
      />
    </PageContainer>
  );
}
