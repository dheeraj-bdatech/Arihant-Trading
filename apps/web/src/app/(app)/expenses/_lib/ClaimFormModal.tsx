'use client';

/**
 * New / edit expense claim as a popup instead of a trip to /expenses/new or /expenses/:id/edit.
 * The draft is saved first, then expenses are added in the same popup. Submit, delete or close
 * returns the user to the page they were on (lists refresh through notifyExpensesChanged).
 */
import React, { useCallback, useRef, useState } from 'react';
import { Button, Modal, type ButtonProps } from '@/components/ui';
import { ClaimForm } from './ClaimForm';
import { useToaster } from './expense-ui';

export const ClaimFormModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  claimId?: string | null;
  initialVisitId?: string | null;
  initialTripId?: string | null;
  onDone?: (message: string) => void;
}> = ({ isOpen, onClose, claimId, initialVisitId, initialTripId, onDone }) => {
  const dirty = useRef(false);
  const onDirtyChange = useCallback((d: boolean) => {
    dirty.current = d;
  }, []);
  // Esc, the X and an outside click all land here — ask before throwing unsaved input away.
  const requestClose = () => {
    if (dirty.current && !window.confirm('You have unsaved changes. Close without saving?')) return;
    dirty.current = false;
    onClose();
  };
  return (
    <Modal
      isOpen={isOpen}
      onClose={requestClose}
      title={claimId ? 'Edit expense claim' : 'New expense claim'}
      description={claimId ? 'Update the trip details or expenses, then submit.' : 'Save the trip details, then add one entry per bill.'}
      maxWidth="3xl"
    >
      <ClaimForm
        key={claimId || 'new'}
        variant="modal"
        claimId={claimId || undefined}
        initialVisitId={initialVisitId}
        initialTripId={initialTripId}
        onClose={() => {
          dirty.current = false;
          onClose();
        }}
        onDone={onDone}
        onDirtyChange={onDirtyChange}
      />
    </Modal>
  );
};

/** A button that opens the New expense claim popup — drop-in for `<Link href="/expenses/new">`. */
export const NewClaimButton: React.FC<Omit<ButtonProps, 'onClick'> & { visitId?: string | null; tripId?: string | null }> = ({ visitId, tripId, children, ...buttonProps }) => {
  const [open, setOpen] = useState(false);
  const { push, Toaster } = useToaster();
  return (
    <>
      <Button type="button" {...buttonProps} onClick={() => setOpen(true)}>
        {children}
      </Button>
      {open && <ClaimFormModal isOpen initialVisitId={visitId} initialTripId={tripId} onClose={() => setOpen(false)} onDone={(m) => push('success', m)} />}
      <Toaster />
    </>
  );
};
