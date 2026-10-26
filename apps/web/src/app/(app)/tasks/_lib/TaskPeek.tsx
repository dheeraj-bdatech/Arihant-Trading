'use client';

/**
 * Task quick view: a task opens as a popup with its essentials wherever it is linked (task lists and boards,
 * queues, linked records, notifications…). Any plain click on a `/tasks/<id>` link is caught here; ctrl/⌘/shift
 * or middle click, `target="_blank"` and links marked `data-full-page` still open the full page. Code that
 * opened a task with router.push calls `openTaskPeek(id)` instead.
 */
import React, { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Modal } from '@/components/ui';
import { TaskDetailView } from './TaskDetailView';

const TASK_PATH = /^\/tasks\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i;
const PEEK_EVENT = 'task:peek';

export const openTaskPeek = (taskId: string) => {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent<string>(PEEK_EVENT, { detail: taskId }));
};

export const TaskPeek: React.FC = () => {
  const [taskId, setTaskId] = useState<string | null>(null);
  // the dialog header carries the task's own title and number once it has loaded
  const [head, setHead] = useState<{ title: string; number: string } | null>(null);
  const pathname = usePathname();
  useEffect(() => setHead(null), [taskId]);

  // Leaving the page (e.g. "Open full page", or a link inside the task) closes the quick view
  useEffect(() => setTaskId(null), [pathname]);

  useEffect(() => {
    const onPeek = (e: Event) => setTaskId((e as CustomEvent<string>).detail);
    // Capture phase, before the link's own (Next.js) click handler, which then sees defaultPrevented and stays put
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download') || a.hasAttribute('data-full-page')) return;
      if (a.origin !== window.location.origin) return;
      const match = TASK_PATH.exec(a.pathname);
      if (!match) return;
      e.preventDefault();
      setTaskId(match[1]);
    };
    window.addEventListener(PEEK_EVENT, onPeek);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener(PEEK_EVENT, onPeek);
      document.removeEventListener('click', onClick, true);
    };
  }, []);

  return (
    <Modal isOpen={Boolean(taskId)} onClose={() => setTaskId(null)} title={head?.title || 'Task'} description={head?.number} maxWidth="3xl">
      {taskId && <TaskDetailView key={taskId} taskId={taskId} variant="popup" onLoaded={(t) => setHead({ title: t.title, number: t.task_number })} />}
    </Modal>
  );
};
