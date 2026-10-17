'use client';

/**
 * "New task" as a popup instead of a trip to /tasks/new: the same TaskForm in two steps (task & people,
 * then schedule & rules).
 * After saving, the popup closes and the user stays where they were (lists refresh through
 * notifyTasksChanged). /tasks/new still works for deep links from other modules.
 */
import React, { useCallback, useRef, useState } from 'react';
import { Button, Modal, type ButtonProps } from '@/components/ui';
import { TaskForm, type TaskFormPrefill } from './TaskForm';
import { useToaster } from './task-ui';

export const NewTaskModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  prefill?: TaskFormPrefill;
  onCreated?: (result: { message: string; href: string }) => void;
}> = ({ isOpen, onClose, prefill, onCreated }) => {
  const dirty = useRef(false);
  const onDirtyChange = useCallback((d: boolean) => {
    dirty.current = d;
  }, []);
  // Esc, the X and an outside click all land here — ask before throwing input away.
  const requestClose = () => {
    if (dirty.current && !window.confirm('Discard this task? Nothing has been saved yet.')) return;
    dirty.current = false;
    onClose();
  };
  const recurring = Boolean(prefill?.frequency && prefill.frequency !== 'one_time');

  return (
    <Modal
      isOpen={isOpen}
      onClose={requestClose}
      title={recurring ? 'New recurring task' : 'New task'}
      description="Two short steps — the task and who does it, then when it is due and the rules."
      maxWidth="3xl"
    >
      <TaskForm
        prefill={prefill}
        variant="modal"
        onDirtyChange={onDirtyChange}
        onClose={() => {
          dirty.current = false;
          onClose();
        }}
        onCreated={onCreated}
      />
    </Modal>
  );
};

/** A button that opens the New task popup — drop-in for the old `<Link href="/tasks/new">` buttons. */
export const NewTaskButton: React.FC<Omit<ButtonProps, 'onClick'> & { prefill?: TaskFormPrefill }> = ({ prefill, children, ...buttonProps }) => {
  const [open, setOpen] = useState(false);
  const { push, Toaster } = useToaster();
  return (
    <>
      <Button type="button" {...buttonProps} onClick={() => setOpen(true)}>
        {children}
      </Button>
      {open && (
        <NewTaskModal
          isOpen
          prefill={prefill}
          onClose={() => setOpen(false)}
          onCreated={({ message }) => push('success', message)}
        />
      )}
      <Toaster />
    </>
  );
};
