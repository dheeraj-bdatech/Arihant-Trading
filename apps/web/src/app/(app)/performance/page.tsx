'use client';

import React, { Suspense } from 'react';
import { TrendingUp } from 'lucide-react';
import { PageContainer, PageHeader, PageLoader } from '@/components/ui';
import { MyPerformance } from './_lib/MyPerformance';

export default function MyPerformancePage() {
  return (
    <Suspense fallback={<PageLoader rows={4} label="Loading your performance" />}>
      <PageContainer>
        <PageHeader title="My Performance" icon={<TrendingUp className="h-5 w-5" />} />
        <MyPerformance />
      </PageContainer>
    </Suspense>
  );
}
