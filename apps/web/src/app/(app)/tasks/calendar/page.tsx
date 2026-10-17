'use client';

/**
 * Approved-leave register and holiday calendar. They drive recurring-task skips/shifts, deadline warnings and
 * the "approved leave" blocker. Managers record approved leave for their team; nobody records their own.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { CalendarDays, Plus, Trash2, X } from 'lucide-react';
import { Badge, Button, Card, EmptyState, InfoCallout, Input, Modal, PageContainer, PageHeader, PageLoader, Select, Textarea } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { formatTaskDate } from '@arihant/shared';
import { addDays, errorMessage, fieldErrors, istToday, useTaskSummary, type AssigneeOption } from '../_lib/task-lib';
import { DialogActions, TasksNav, useToaster } from '../_lib/task-ui';
import { UserSelect } from '../_lib/pickers';

interface Leave {
  id: string;
  employee_id: string;
  employee_name: string;
  leave_type: string;
  from_date: string;
  to_date: string;
  status: string;
  reason: string | null;
  approved_by_name: string | null;
}
interface Holiday {
  id: string;
  holiday_date: string;
  name: string;
  region_name: string | null;
}

const LEAVE_TYPES = [
  { value: 'casual', label: 'Casual' },
  { value: 'sick', label: 'Sick' },
  { value: 'earned', label: 'Earned' },
  { value: 'comp_off', label: 'Comp-off' },
  { value: 'other', label: 'Other' },
];

export default function LeaveHolidayPage() {
  const { user } = useAuth();
  const { summary } = useTaskSummary();
  const { push, Toaster } = useToaster();
  const [leaves, setLeaves] = useState<Leave[] | null>(null);
  const [holidays, setHolidays] = useState<Holiday[] | null>(null);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [holidayOpen, setHolidayOpen] = useState(false);
  const [cancelling, setCancelling] = useState<Leave | null>(null);
  const today = istToday();
  const isAdminLike = user?.role === 'admin' || user?.role === 'management';
  const canRecordLeave = Boolean(isAdminLike || summary?.has_team);

  const load = useCallback(async () => {
    try {
      const [l, h] = await Promise.all([api.get<Leave[]>('/task-calendar/leaves', { from: addDays(today, -60) }), api.get<Holiday[]>('/task-calendar/holidays', { from: addDays(today, -30), to: addDays(today, 365) })]);
      setLeaves(l);
      setHolidays(h);
    } catch (e) {
      push('error', errorMessage(e));
      setLeaves([]);
      setHolidays([]);
    }
  }, [today, push]);

  useEffect(() => {
    load();
  }, [load]);

  const removeHoliday = async (h: Holiday) => {
    if (!window.confirm(`Remove ${h.name} (${formatTaskDate(h.holiday_date)})?`)) return;
    try {
      await api.delete(`/task-calendar/holidays/${h.id}`);
      push('success', 'Holiday removed.');
      load();
    } catch (e) {
      push('error', errorMessage(e));
    }
  };

  return (
    <PageContainer>
      <PageHeader
        title="Leave & Holidays"
        icon={<CalendarDays className="h-5 w-5" />}
        actions={
          <div className="flex flex-wrap gap-2">
            {canRecordLeave && (
              <Button size="sm" leftIcon={<Plus className="h-4 w-4" />} onClick={() => setLeaveOpen(true)}>
                Record approved leave
              </Button>
            )}
            {isAdminLike && (
              <Button size="sm" variant="secondary" leftIcon={<Plus className="h-4 w-4" />} onClick={() => setHolidayOpen(true)}>
                Add holiday
              </Button>
            )}
          </div>
        }
      />
      <TasksNav />
      <InfoCallout variant="info">
        Approved leave skips recurring tasks on those days, warns managers who assign work with a deadline inside it, and lets the employee raise an “Approved leave” blocker that is accepted automatically.
        {!canRecordLeave && ' Your leave is recorded by your manager.'}
      </InfoCallout>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <Card className="p-4 sm:p-5 space-y-3 lg:col-span-2">
          <h3 className="font-serif text-lg text-[#14213D]">Approved leave</h3>
          {!leaves ? (
            <PageLoader rows={3} />
          ) : leaves.length === 0 ? (
            <EmptyState icon={CalendarDays} title="No approved leave recorded" description={canRecordLeave ? 'Record approved leave for your team so recurring tasks and deadlines respect it.' : 'Nothing recorded for you in this period.'} />
          ) : (
            <ul className="divide-y divide-[#ECE9E2]">
              {leaves.map((l) => (
                <li key={l.id} className="py-3 flex flex-wrap items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-[#14213D]">{l.employee_name}</div>
                    <div className="text-xs text-[#4A5568]">
                      <span className="font-mono">{formatTaskDate(l.from_date)}</span> → <span className="font-mono">{formatTaskDate(l.to_date)}</span> · {LEAVE_TYPES.find((t) => t.value === l.leave_type)?.label || l.leave_type}
                      {l.approved_by_name ? ` · recorded by ${l.approved_by_name}` : ''}
                    </div>
                    {l.reason && <div className="text-xs text-[#4A5568] italic">“{l.reason}”</div>}
                  </div>
                  {l.to_date >= today && l.from_date <= today && <Badge variant="warning" size="sm">On leave now</Badge>}
                  {canRecordLeave && l.employee_id !== user?.id && (
                    <Button size="xs" variant="ghost" leftIcon={<X className="h-3 w-3" />} onClick={() => setCancelling(l)}>
                      Cancel
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-4 sm:p-5 space-y-3">
          <h3 className="font-serif text-lg text-[#14213D]">Holidays</h3>
          <p className="text-[11px] text-[#4A5568]">Weekly off days are set in Task Settings.</p>
          {!holidays ? (
            <PageLoader rows={3} />
          ) : holidays.length === 0 ? (
            <p className="text-sm text-[#8A8578]">No holidays in the calendar yet.</p>
          ) : (
            <ul className="divide-y divide-[#ECE9E2]">
              {holidays.map((h) => (
                <li key={h.id} className={`py-2 flex items-center gap-2 ${h.holiday_date < today ? 'opacity-60' : ''}`}>
                  <span className="font-mono text-xs text-[#0F5E63] w-[86px] shrink-0">{formatTaskDate(h.holiday_date)}</span>
                  <span className="text-sm text-[#14213D] flex-1 min-w-0 truncate">{h.name}</span>
                  {h.region_name && (
                    <Badge variant="outline" size="sm">
                      {h.region_name}
                    </Badge>
                  )}
                  {isAdminLike && (
                    <button type="button" aria-label={`Remove ${h.name}`} onClick={() => removeHoliday(h)} className="-my-1 p-2 text-[#8A8578] hover:text-[#881337] sm:my-0 sm:p-1">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {leaveOpen && <LeaveModal onClose={() => setLeaveOpen(false)} onSaved={(n) => (push('success', n ? `Leave recorded. ${n} recurring instance(s) skipped.` : 'Leave recorded.'), setLeaveOpen(false), load())} />}
      {holidayOpen && <HolidayModal onClose={() => setHolidayOpen(false)} onSaved={() => (push('success', 'Holiday added.'), setHolidayOpen(false), load())} />}
      {cancelling && <CancelLeaveModal leave={cancelling} onClose={() => setCancelling(null)} onSaved={() => (push('success', 'Leave cancelled.'), setCancelling(null), load())} />}
      <Toaster />
    </PageContainer>
  );
}

const LeaveModal: React.FC<{ onClose: () => void; onSaved: (skipped: number) => void }> = ({ onClose, onSaved }) => {
  const { user } = useAuth();
  const [people, setPeople] = useState<AssigneeOption[]>([]);
  const [v, setV] = useState({ employee_id: '', from_date: istToday(), to_date: istToday(), leave_type: 'casual', reason: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api
      .get<AssigneeOption[]>('/tasks/lookups/assignees')
      .then((r) => setPeople(r.filter((p) => p.id !== user?.id && p.scope !== 'peer')))
      .catch(() => setPeople([]));
  }, [user?.id]);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    try {
      const r = await api.post<{ skipped_instances: number }>('/task-calendar/leaves', v);
      onSaved(r.skipped_instances || 0);
    } catch (err) {
      const errs = fieldErrors(err);
      setErrors(Object.keys(errs).length ? errs : { _: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal isOpen onClose={onClose} title="Record approved leave" description="Only leave that has already been approved. Recurring instances on those days are skipped (not counted as missed)." maxWidth="md">
      <form onSubmit={save} className="space-y-3">
        <UserSelect label="Employee *" value={v.employee_id} onChange={(x) => setV({ ...v, employee_id: x })} users={people} error={errors.employee_id} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input label="From *" type="date" value={v.from_date} onChange={(e) => setV({ ...v, from_date: e.target.value })} error={errors.from_date} />
          <Input label="To *" type="date" min={v.from_date} value={v.to_date} onChange={(e) => setV({ ...v, to_date: e.target.value })} error={errors.to_date} />
        </div>
        <Select label="Leave type" value={v.leave_type} onChange={(e) => setV({ ...v, leave_type: e.target.value })} options={LEAVE_TYPES} />
        <Textarea label="Reason" value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} rows={2} maxLength={500} />
        {errors._ && <InfoCallout variant="danger">{errors._}</InfoCallout>}
        <DialogActions>
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" isLoading={busy}>
            Record leave
          </Button>
        </DialogActions>
      </form>
    </Modal>
  );
};

const HolidayModal: React.FC<{ onClose: () => void; onSaved: () => void }> = ({ onClose, onSaved }) => {
  const [v, setV] = useState({ holiday_date: '', name: '', region_id: '' });
  const [regions, setRegions] = useState<{ id: string; name: string }[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api
      .get<any>('/masters/regions')
      .then((r) => setRegions(Array.isArray(r) ? r : r?.data || []))
      .catch(() => setRegions([]));
  }, []);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    try {
      await api.post('/task-calendar/holidays', { ...v, region_id: v.region_id || null });
      onSaved();
    } catch (err) {
      const errs = fieldErrors(err);
      setErrors(Object.keys(errs).length ? errs : { _: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal isOpen onClose={onClose} title="Add holiday" maxWidth="md">
      <form onSubmit={save} className="space-y-3">
        <Input label="Date *" type="date" value={v.holiday_date} onChange={(e) => setV({ ...v, holiday_date: e.target.value })} error={errors.holiday_date} />
        <Input label="Name *" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} maxLength={120} placeholder="e.g. Diwali" error={errors.name} />
        <Select label="Applies to" value={v.region_id} onChange={(e) => setV({ ...v, region_id: e.target.value })} options={[{ value: '', label: 'Everyone (national)' }, ...regions.map((r) => ({ value: r.id, label: r.name }))]} />
        {errors._ && <InfoCallout variant="danger">{errors._}</InfoCallout>}
        <DialogActions>
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" isLoading={busy}>
            Add holiday
          </Button>
        </DialogActions>
      </form>
    </Modal>
  );
};

const CancelLeaveModal: React.FC<{ leave: Leave; onClose: () => void; onSaved: () => void }> = ({ leave, onClose, onSaved }) => {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post(`/task-calendar/leaves/${leave.id}/cancel`, { reason });
      onSaved();
    } catch (err) {
      setError(fieldErrors(err).reason || errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal isOpen onClose={onClose} title="Cancel leave" description={`${leave.employee_name} · ${formatTaskDate(leave.from_date)} → ${formatTaskDate(leave.to_date)}`} maxWidth="md">
      <form onSubmit={save} className="space-y-3">
        <Textarea label="Reason *" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={500} error={error || undefined} />
        <p className="text-[11px] text-[#4A5568]">Recurring instances already skipped for this leave are not regenerated.</p>
        <DialogActions>
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            Back
          </Button>
          <Button type="submit" variant="danger" isLoading={busy}>
            Cancel leave
          </Button>
        </DialogActions>
      </form>
    </Modal>
  );
};
