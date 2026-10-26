'use client';

/**
 * "New customer" from inside another form (e.g. a customer-related task): just the fields an account needs.
 * The API de-duplicates on name + city, so typing an existing account hands back that record instead of a copy.
 */
import React, { useEffect, useState } from 'react';
import { Building2 } from 'lucide-react';
import { INDIAN_STATES, stateOfCity } from '@arihant/shared';
import { Button, Input, Modal, Select } from '@/components/ui';
import { api } from '@/lib/api';
import { SECTOR_OPTIONS } from '@/app/(app)/leads/_lib/sectors';
import { errorMessage } from './task-lib';

export interface QuickCustomer {
  id: string;
  name: string;
  city?: string | null;
  state?: string | null;
}

const EMPTY = { name: '', city: '', state: '', sector: '' };

export const QuickCustomerModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  onCreated: (org: QuickCustomer) => void;
}> = ({ isOpen, onClose, onCreated }) => {
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setForm(EMPTY);
    setErrors({});
    setApiError(null);
  }, [isOpen]);

  const set = (patch: Partial<typeof EMPTY>) => {
    setForm((f) => ({ ...f, ...patch }));
    setErrors((e) => {
      const next = { ...e };
      for (const k of Object.keys(patch)) delete next[k];
      return next;
    });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation(); // this form sits inside the task form's dialog
    const errs: Record<string, string> = {};
    if (!form.name.trim()) errs.name = 'Enter the organisation name.';
    if (!form.city.trim()) errs.city = 'Enter the city.';
    if (!form.state) errs.state = 'Select the state / UT.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setSaving(true);
    setApiError(null);
    try {
      const org = await api.post<QuickCustomer>('/organisations', {
        name: form.name.trim(),
        city: form.city.trim(),
        state: form.state,
        sector: form.sector || undefined,
      });
      onCreated(org);
      onClose();
    } catch (err) {
      setApiError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="New customer" description="Create the account and link it to this task. An existing account with the same name and city is reused." maxWidth="lg">
      <form onSubmit={submit} noValidate className="space-y-4 text-xs">
        {apiError && <div className="rounded-lg border border-[#F3C7CF] bg-[#FCE8EC] p-3 text-[#700F2D]">{apiError}</div>}
        <Input
          label="Organisation / Agency Name"
          required
          value={form.name}
          onChange={(e) => set({ name: e.target.value })}
          placeholder="e.g. Central Reserve Police Force"
          error={errors.name}
          autoFocus
        />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input
            label="City"
            required
            value={form.city}
            onChange={(e) => {
              const city = e.target.value;
              const st = stateOfCity(city);
              set(st && !form.state ? { city, state: st } : { city });
            }}
            placeholder="e.g. New Delhi"
            error={errors.city}
          />
          <Select
            label="State / UT"
            required
            value={form.state}
            onChange={(e) => set({ state: e.target.value })}
            error={errors.state}
            options={[{ value: '', label: 'Select State / UT...' }, ...INDIAN_STATES.map((st) => ({ value: st, label: st }))]}
          />
        </div>
        <Select
          label="Sector / Department"
          value={form.sector}
          onChange={(e) => set({ sector: e.target.value })}
          options={[{ value: '', label: 'Select Sector...' }, ...SECTOR_OPTIONS]}
        />
        <div className="flex justify-end gap-2 border-t border-[#ECE9E2] pt-3">
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" isLoading={saving} leftIcon={<Building2 className="h-4 w-4" />}>
            Create customer
          </Button>
        </div>
      </form>
    </Modal>
  );
};
