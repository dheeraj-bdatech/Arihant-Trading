'use client';

import React from 'react';
import { useParams } from 'next/navigation';
import { PageContainer } from '@/components/ui';
import { TaskDetailView } from '../_lib/TaskDetailView';
import { TasksNav } from '../_lib/task-ui';

export default function TaskDetailPage() {
  const { id } = useParams<{ id: string }>();
  // The task's own header card carries the title, status and actions, so no generic page header here.
  return (
    <PageContainer>
      <TasksNav />
      <TaskDetailView key={id} taskId={id} />
    </PageContainer>
  );
}
