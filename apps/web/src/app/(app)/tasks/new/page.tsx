'use client';

import React, { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { CheckSquare } from 'lucide-react';
import { PageContainer, PageHeader, PageLoader } from '@/components/ui';
import { TaskForm } from '../_lib/TaskForm';
import { TasksNav } from '../_lib/task-ui';

/**
 * Other modules deep-link here, e.g. /tasks/new?tender_id=… or ?customer_id=…&title=…;
 * the matching category is pre-selected. `?frequency=weekly` opens the recurrence builder.
 */
function NewTask() {
  const params = useSearchParams();
  const get = (k: string) => params.get(k) || null;
  return (
    <TaskForm
      key={params.toString()}
      prefill={{
        customer_id: get('customer_id'),
        tender_id: get('tender_id'),
        demo_id: get('demo_id'),
        service_ticket_id: get('service_ticket_id'),
        project_id: get('project_id'),
        category_id: get('category_id'),
        frequency: get('frequency'),
        title: get('title'),
        assignee_id: get('assignee_id'),
      }}
    />
  );
}

export default function NewTaskPage() {
  return (
    <PageContainer>
      <PageHeader title="New Task" icon={<CheckSquare className="h-5 w-5" />} />
      <TasksNav />
      <Suspense fallback={<PageLoader rows={4} label="Loading form" />}>
        <NewTask />
      </Suspense>
    </PageContainer>
  );
}
