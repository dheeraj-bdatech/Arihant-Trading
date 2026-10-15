'use client';

import React from 'react';
import { useParams } from 'next/navigation';
import { CheckSquare } from 'lucide-react';
import { PageContainer, PageHeader } from '@/components/ui';
import { TaskDetailView } from '../_lib/TaskDetailView';
import { TasksNav } from '../_lib/task-ui';

export default function TaskDetailPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <PageContainer>
      <PageHeader title="Task" icon={<CheckSquare className="h-5 w-5" />} />
      <TasksNav />
      <TaskDetailView key={id} taskId={id} />
    </PageContainer>
  );
}
