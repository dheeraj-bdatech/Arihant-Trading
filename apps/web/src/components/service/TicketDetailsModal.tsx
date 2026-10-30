'use client';

/**
 * §31: complete (or correct) an open ticket's equipment, serial number, contact person and location — a phone or
 * portal complaint often arrives without them. PATCH /service/tickets/:id/details sends only what changed.
 */
import React, { useEffect, useState } from 'react';
import { Modal, Button, Input, Select, InfoCallout } from '@/components/ui';
import { api } from '@/lib/api';
import { errMsg, isConflict } from './serviceHelpers';

interface Props {
  ticket: any | null;
  onClose: () => void;
  onDone: () => unknown;
  onStale: () => unknown;
}

const listOf = (res: any): any[] => (Array.isArray(res) ? res : Array.isArray(res?.data) ? res.data : []);

export const TicketDetailsModal: React.FC<Props> = ({ ticket, onClose, onDone, onStale }) => {
  const [products, setProducts] = useState<any[]>([]);
  const [contacts, setContacts] = useState<any[]>([]);
  const [f, setF] = useState({ product_id: '', serial: '', contact_id: '', location: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ticket) return;
    setF({
      product_id: ticket.product_id || '',
      serial: ticket.equipment_serial || ticket.serial_number || '',
      contact_id: ticket.contact_id || '',
      location: ticket.location || '',
    });
    setError(null);
    let live = true;
    api.get('/products').then((r: any) => live && setProducts(listOf(r))).catch(() => live && setProducts([]));
    api
      .get('/contacts', { organisation_id: ticket.organisation_id, limit: 100 })
      .then((r: any) => live && setContacts(listOf(r)))
      .catch(() => live && setContacts([]));
    return () => {
      live = false;
    };
  }, [ticket]);

  if (!ticket) return null;

  const changes: Record<string, string> = {};
  if (f.product_id && f.product_id !== (ticket.product_id || '')) changes.product_id = f.product_id;
  if (f.serial.trim() && f.serial.trim() !== (ticket.equipment_serial || ticket.serial_number || '')) changes.equipment_serial = f.serial.trim();
  if (f.contact_id && f.contact_id !== (ticket.contact_id || '')) changes.contact_id = f.contact_id;
  if (f.location.trim() && f.location.trim() !== (ticket.location || '')) changes.location = f.location.trim();
  const nothing = Object.keys(changes).length === 0;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/service/tickets/${ticket.id}/details`, changes);
      await onDone();
      onClose();
    } catch (err) {
      setError(errMsg(err));
      if (isConflict(err)) await onStale();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen={!!ticket} onClose={onClose} title={`Ticket details · ${ticket.ticket_no}`} description="Add what was missing when the complaint came in, or correct it." maxWidth="lg">
      <div className="space-y-4">
        <Select label="Equipment" value={f.product_id} onChange={(e) => setF({ ...f, product_id: e.target.value })}>
          <option value="">{ticket.product_id ? 'Keep current equipment' : '-- Choose the equipment --'}</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
        <Input
          label="Machine serial number"
          value={f.serial}
          onChange={(e) => setF({ ...f, serial: e.target.value })}
          placeholder="As printed on the machine's rating plate"
          helperText="The service history and repeat complaints are tracked by this number."
        />
        <Select label="Contact person" value={f.contact_id} onChange={(e) => setF({ ...f, contact_id: e.target.value })}>
          <option value="">{contacts.length ? '-- Choose a contact --' : '-- No contacts on file for this customer --'}</option>
          {contacts.map((c) => (
            <option key={c.id} value={c.id}>
              {[c.full_name || c.name, c.designation].filter(Boolean).join(' · ')}
            </option>
          ))}
        </Select>
        <Input label="Location" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} placeholder="e.g. Terminal 3, baggage screening bay A" />
        {error && <InfoCallout variant="danger" title="Not saved">{error}</InfoCallout>}
        <div className="flex flex-col-reverse gap-2 border-t border-[#ECE9E2] pt-4 sm:flex-row sm:justify-end">
          <Button variant="secondary" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={save} isLoading={busy} disabled={busy || nothing}>
            Save details
          </Button>
        </div>
      </div>
    </Modal>
  );
};
