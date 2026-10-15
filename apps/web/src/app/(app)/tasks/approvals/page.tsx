'use client';

/** Approval Queue (§12.6): completed work waiting for my approval, with evidence preview, SLA and delay context. */
import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, ClipboardCheck, ExternalLink, Undo2 } from 'lucide-react';
import { Badge, Button, Card, EmptyState, InfoCallout, PageContainer, PageHeader, PageLoader, Tabs } from '@/components/ui';
import { api } from '@/lib/api';
import { formatTaskDateTime } from '@arihant/shared';
import { errorMessage, notifyTasksChanged, useTaskSummary, type TaskAttachment, type TaskRow } from '../_lib/task-lib';
import { DelayBadge, FileList, FileViewer, FlagChip, PriorityBadge, TaskConflictCallout, TasksNav, useToaster } from '../_lib/task-ui';
import { TaskActionDialog, type ActionTask, type TaskDialogAction } from '../_lib/TaskActions';

type ApprovalRow = TaskRow & { evidence: TaskAttachment[]; waiting_hours: number; sla_breached: boolean };

const age = (h: number) => (h < 24 ? `${h}h` : `${Math.floor(h / 24)}d ${h % 24}h`);

export default function ApprovalQueuePage() {
  const { summary } = useTaskSummary();
  const { push, Toaster } = useToaster();
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const [rows, setRows] = useState<ApprovalRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [viewer, setViewer] = useState<TaskAttachment | null>(null);
  const [dialog, setDialog] = useState<{ action: TaskDialogAction; task: ActionTask } | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setRows(await api.get<ApprovalRow[]>('/tasks/approvals/pending', { scope }));
      setConflict(false);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [scope]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <PageContainer>
      <PageHeader title="Approvals" icon={<ClipboardCheck className="h-5 w-5" />} />
      <TasksNav />
      {summary?.can_view_all && (
        <Tabs
          variant="segmented"
          size="sm"
          tabs={[
            { id: 'mine', label: 'Routed to me' },
            { id: 'all', label: 'All awaiting approval' },
          ]}
          activeTab={scope}
          onChange={(id) => setScope(id as 'mine' | 'all')}
        />
      )}
      {conflict && <TaskConflictCallout onRefresh={load} />}
      {error && <InfoCallout variant="danger" title="Could not load approvals">{error}</InfoCallout>}
      {!rows ? (
        <PageLoader rows={4} />
      ) : rows.length === 0 ? (
        <EmptyState icon={CheckCircle2} title="Nothing to approve" description="Tasks that need your approval appear here once the assignee completes them." />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {rows.map((t) => (
            <Card key={t.id} className={`p-4 space-y-3 ${t.sla_breached ? 'border-[#9A3412]/40' : ''}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <Link href={`/tasks/${t.id}`} className="font-mono text-xs font-semibold text-[#0F5E63] hover:underline inline-flex items-center gap-1">
                    {t.task_number} <ExternalLink className="h-3 w-3" />
                  </Link>
                  <div className="font-medium text-[#14213D] break-words">{t.title}</div>
                  <div className="text-xs text-[#4A5568]">
                    {t.assignee_name} · {t.category_name}
                    {t.customer_name ? ` · ${t.customer_name}` : ''}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <PriorityBadge priority={t.priority} />
                  <DelayBadge delay={t.delay_class} />
                  <Badge variant={t.sla_breached ? 'urgent' : 'outline'} size="sm">
                    Waiting {age(t.waiting_hours)}
                  </Badge>
                </div>
              </div>
              <div className="text-xs text-[#4A5568]">
                Completed {formatTaskDateTime(t.completed_at)} · deadline {formatTaskDateTime(t.deadline)}
                {t.rework_count > 0 && <FlagChip>{t.rework_count} rework round(s)</FlagChip>}
              </div>
              {t.completion_remarks && <p className="text-sm text-[#14213D] bg-[#FBFAF7] border border-[#ECE9E2] rounded-lg px-3 py-2 whitespace-pre-wrap">{t.completion_remarks}</p>}
              {t.delay_reason && <p className="text-xs text-[#9A3412]">Reason for delay: {t.delay_reason}</p>}
              <div>
                <div className="text-[11px] uppercase tracking-wide text-[#4A5568] mb-1">Evidence</div>
                <FileList files={t.evidence} onOpen={setViewer} />
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <Button size="sm" variant="secondary" leftIcon={<Undo2 className="h-4 w-4" />} onClick={() => setDialog({ action: 'send_back', task: t })}>
                  Send back
                </Button>
                <Button size="sm" leftIcon={<CheckCircle2 className="h-4 w-4" />} onClick={() => setDialog({ action: 'approve', task: t })}>
                  Approve
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
      <TaskActionDialog
        action={dialog?.action ?? null}
        task={dialog?.task ?? null}
        onClose={() => setDialog(null)}
        onDone={(_, msg) => {
          setDialog(null);
          push('success', msg);
          notifyTasksChanged();
          load();
        }}
        onConflict={() => setConflict(true)}
      />
      <FileViewer file={viewer} onClose={() => setViewer(null)} />
      <Toaster />
    </PageContainer>
  );
}
