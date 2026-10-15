'use client';

/** Module 8 settings (admin): thresholds & SLAs, assignment rules, categories, department heads. */
import React, { useEffect, useState } from 'react';
import { Plus, Save, Settings2 } from 'lucide-react';
import { Badge, Button, Card, Checkbox, EmptyState, InfoCallout, Input, Modal, PageContainer, PageHeader, PageLoader, Select, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { TASK_HOLIDAY_POLICIES, TASK_HOLIDAY_POLICY_LABELS, TASK_LEAVE_POLICY_LABELS } from '@arihant/shared';
import { errorMessage, fieldErrors, useTaskCategories, useTaskSettings, type TaskCategory, type TaskSettings } from '../_lib/task-lib';
import { TasksNav, useToaster } from '../_lib/task-ui';
import { useActiveUsers } from '../_lib/pickers';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const NUMBERS: { key: keyof TaskSettings; label: string; unit: string; help?: string }[] = [
  { key: 'no_update_days_critical', label: 'No update — critical', unit: 'days' },
  { key: 'no_update_days_high', label: 'No update — high', unit: 'days' },
  { key: 'no_update_days_medium', label: 'No update — medium', unit: 'days' },
  { key: 'no_update_days_low', label: 'No update — low', unit: 'days' },
  { key: 'repeated_delay_threshold', label: 'Repeated delay threshold', unit: 'late tasks', help: 'Unexcused late tasks within the window below.' },
  { key: 'repeated_delay_window_days', label: 'Repeated delay window', unit: 'days' },
  { key: 'max_extensions_before_flag', label: 'Extensions before flag', unit: 'extensions' },
  { key: 'repeated_blocker_threshold', label: 'Same blocker repeated', unit: 'times' },
  { key: 'blocker_review_sla_hours', label: 'Blocker review SLA', unit: 'hours', help: 'Reminder after this; escalation after twice this.' },
  { key: 'approval_sla_hours', label: 'Approval SLA', unit: 'hours' },
  { key: 'reminder_hours_before_deadline', label: 'Deadline reminder', unit: 'hours before' },
  { key: 'horizon_days_daily', label: 'Generate daily tasks ahead', unit: 'days' },
  { key: 'horizon_days_weekly', label: 'Generate weekly tasks ahead', unit: 'days' },
  { key: 'horizon_days_monthly', label: 'Generate monthly tasks ahead', unit: 'days' },
  { key: 'hard_delete_window_minutes', label: '“Created by mistake” delete window', unit: 'minutes' },
  { key: 'review_rating_scale', label: 'Review rating scale', unit: 'points' },
];

const RULES: { key: keyof TaskSettings; label: string; description: string }[] = [
  { key: 'allow_self_tasks', label: 'Employees can create their own tasks', description: 'Self-tasks count in their metrics like any other task.' },
  { key: 'allow_indirect_reports', label: 'Managers act on indirect reports', description: 'Otherwise only direct reports.' },
  { key: 'allow_peer_linked_assignment', label: 'Colleagues can request linked work', description: 'Tasks linked to a customer, tender, demo or service ticket can be assigned to colleagues outside the team. Approvals always go to the assignee’s own manager.' },
  { key: 'auto_accept_leave_blockers', label: 'Auto-accept approved-leave blockers', description: 'When the leave is in the register; the clock is paused until the leave ends.' },
];

export default function TaskSettingsPage() {
  const { user } = useAuth();
  const { push, Toaster } = useToaster();
  const { settings, setSettings } = useTaskSettings();
  const [draft, setDraft] = useState<TaskSettings | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  useEffect(() => setDraft(settings), [settings]);

  if (user && user.role !== 'admin') {
    return (
      <PageContainer>
        <PageHeader title="Task Settings" icon={<Settings2 className="h-5 w-5" />} />
        <TasksNav />
        <EmptyState icon={Settings2} title="Administrators only" description="Task thresholds, SLAs and categories are maintained by the system administrator." />
      </PageContainer>
    );
  }

  const save = async () => {
    if (!draft || !settings) return;
    const body: Record<string, unknown> = {};
    for (const k of Object.keys(draft) as (keyof TaskSettings)[]) {
      if (JSON.stringify(draft[k]) !== JSON.stringify(settings[k])) body[k] = draft[k];
    }
    if (!Object.keys(body).length) return push('success', 'Nothing changed.');
    setSaving(true);
    setErrors({});
    try {
      const fresh = await api.patch<TaskSettings>('/task-settings', body);
      setSettings(fresh);
      push('success', 'Settings saved.');
    } catch (e) {
      setErrors(fieldErrors(e));
      push('error', errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <PageContainer>
      <PageHeader
        title="Task Settings"
        icon={<Settings2 className="h-5 w-5" />}
        actions={
          <Button size="sm" leftIcon={<Save className="h-4 w-4" />} isLoading={saving} onClick={save} disabled={!draft}>
            Save settings
          </Button>
        }
      />
      <TasksNav />
      {!draft ? (
        <PageLoader rows={4} />
      ) : (
        <>
          <Card className="p-4 sm:p-5 space-y-4">
            <h3 className="font-serif text-lg text-[#14213D]">Thresholds & SLAs</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {NUMBERS.map((n) => (
                <Input
                  key={n.key}
                  type="number"
                  min={0}
                  label={`${n.label} (${n.unit})`}
                  value={String(draft[n.key] ?? '')}
                  onChange={(e) => setDraft({ ...draft, [n.key]: e.target.value === '' ? '' : Number(e.target.value) } as TaskSettings)}
                  error={errors[n.key]}
                  helperText={n.help}
                />
              ))}
            </div>
          </Card>

          <Card className="p-4 sm:p-5 space-y-4">
            <h3 className="font-serif text-lg text-[#14213D]">Rules</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {RULES.map((r) => (
                <Checkbox key={r.key} checked={Boolean(draft[r.key])} onChange={(e) => setDraft({ ...draft, [r.key]: e.target.checked } as TaskSettings)} label={r.label} description={r.description} />
              ))}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <Select
                label="Evidence period rule"
                value={draft.evidence_period_basis}
                onChange={(e) => setDraft({ ...draft, evidence_period_basis: e.target.value as any })}
                options={[
                  { value: 'deadline', label: 'By original deadline' },
                  { value: 'completion', label: 'By completion date' },
                ]}
              />
              <Select
                label="Fallback reviewer"
                value={draft.fallback_approver_role}
                onChange={(e) => setDraft({ ...draft, fallback_approver_role: e.target.value })}
                helperText="Used when an employee has no active manager."
                options={[
                  { value: 'management', label: 'Management (then admin)' },
                  { value: 'admin', label: 'Admin only' },
                ]}
              />
              <Select label="Default holiday policy" value={draft.default_holiday_policy} onChange={(e) => setDraft({ ...draft, default_holiday_policy: e.target.value })} options={TASK_HOLIDAY_POLICIES.map((p) => ({ value: p, label: TASK_HOLIDAY_POLICY_LABELS[p] }))} />
              <Select
                label="Default leave policy"
                value={draft.default_leave_policy}
                onChange={(e) => setDraft({ ...draft, default_leave_policy: e.target.value })}
                options={(['skip', 'keep'] as const).map((p) => ({ value: p, label: TASK_LEAVE_POLICY_LABELS[p] }))}
              />
            </div>
            <fieldset>
              <legend className="text-xs font-semibold text-[#14213D] mb-1.5">Weekly off days</legend>
              <div className="flex flex-wrap gap-2">
                {WEEKDAYS.map((d, i) => {
                  const on = draft.weekly_off_days.includes(i);
                  return (
                    <button
                      key={d}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setDraft({ ...draft, weekly_off_days: on ? draft.weekly_off_days.filter((x) => x !== i) : [...draft.weekly_off_days, i].sort() })}
                      className={`h-9 min-w-[48px] rounded-lg border px-3 text-xs font-semibold ${on ? 'border-[#0F5E63] bg-[#0F5E63] text-white' : 'border-[#C9C4B8] bg-white text-[#14213D]'}`}
                    >
                      {d}
                    </button>
                  );
                })}
              </div>
              {errors.weekly_off_days && <p className="text-xs text-[#881337] mt-1">{errors.weekly_off_days}</p>}
            </fieldset>
          </Card>
        </>
      )}

      <CategoriesCard onToast={push} />
      <DepartmentHeadsCard onToast={push} />
      <Toaster />
    </PageContainer>
  );
}

const CategoriesCard: React.FC<{ onToast: (k: 'success' | 'error', t: string) => void }> = ({ onToast }) => {
  const { categories, loading, reload } = useTaskCategories(true);
  const [editing, setEditing] = useState<Partial<TaskCategory> | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    setBusy(true);
    setErrors({});
    try {
      const body = { code: editing.code, name: editing.name, requires_link_type: editing.requires_link_type || null, default_evidence_required: Boolean(editing.default_evidence_required), display_order: editing.display_order ?? 0, is_active: editing.is_active ?? true };
      if (editing.id) await api.patch(`/task-categories/${editing.id}`, body);
      else await api.post('/task-categories', body);
      onToast('success', 'Category saved.');
      setEditing(null);
      reload();
    } catch (err) {
      setErrors(fieldErrors(err));
      if (!Object.keys(fieldErrors(err)).length) onToast('error', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className="p-4 sm:p-5 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-serif text-lg text-[#14213D]">Task categories</h3>
        <Button size="sm" variant="secondary" leftIcon={<Plus className="h-4 w-4" />} onClick={() => setEditing({ is_active: true, display_order: categories.length + 1 })}>
          Add category
        </Button>
      </div>
      {loading ? (
        <PageLoader rows={2} />
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Required link</TableHead>
                <TableHead>Evidence by default</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Edit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {categories.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-mono text-xs">{c.code}</TableCell>
                  <TableCell>{c.name}</TableCell>
                  <TableCell className="text-xs">{c.requires_link_type || '—'}</TableCell>
                  <TableCell className="text-xs">{c.default_evidence_required ? 'Yes' : 'No'}</TableCell>
                  <TableCell>
                    <Badge variant={c.is_active ? 'success' : 'outline'} size="sm">
                      {c.is_active ? 'Active' : 'Inactive'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="xs" variant="ghost" onClick={() => setEditing(c)}>
                      Edit
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {editing && (
        <Modal isOpen onClose={() => setEditing(null)} title={editing.id ? 'Edit category' : 'New category'} maxWidth="md">
          <form onSubmit={save} className="space-y-3">
            <Input label="Code *" value={editing.code || ''} onChange={(e) => setEditing({ ...editing, code: e.target.value.toUpperCase() })} disabled={Boolean(editing.id)} maxLength={30} error={errors.code} helperText="Capital letters, digits, underscores. Cannot change later." />
            <Input label="Name *" value={editing.name || ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} maxLength={80} error={errors.name} />
            <Select
              label="Required link"
              value={editing.requires_link_type || ''}
              onChange={(e) => setEditing({ ...editing, requires_link_type: (e.target.value || null) as any })}
              options={[
                { value: '', label: 'None' },
                { value: 'customer', label: 'Customer' },
                { value: 'tender', label: 'Tender' },
                { value: 'demo', label: 'Demo (or customer)' },
                { value: 'service', label: 'Service ticket (or customer)' },
              ]}
            />
            <Input label="Display order" type="number" min={0} value={String(editing.display_order ?? 0)} onChange={(e) => setEditing({ ...editing, display_order: Number(e.target.value) })} error={errors.display_order} />
            <Checkbox checked={Boolean(editing.default_evidence_required)} onChange={(e) => setEditing({ ...editing, default_evidence_required: e.target.checked })} label="Evidence required by default" />
            <Checkbox checked={editing.is_active ?? true} onChange={(e) => setEditing({ ...editing, is_active: e.target.checked })} label="Active" description="Inactive categories cannot be chosen for new tasks; existing tasks keep them." />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setEditing(null)} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" isLoading={busy}>
                Save
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </Card>
  );
};

const DepartmentHeadsCard: React.FC<{ onToast: (k: 'success' | 'error', t: string) => void }> = ({ onToast }) => {
  const [rows, setRows] = useState<{ id: string; code: string; name: string; head_user_id: string | null; head_name: string | null }[] | null>(null);
  const users = useActiveUsers();
  const load = () => api.get<any[]>('/task-calendar/departments').then(setRows).catch(() => setRows([]));
  useEffect(() => {
    load();
  }, []);
  const setHead = async (id: string, head: string) => {
    try {
      await api.patch(`/task-calendar/departments/${id}`, { head_user_id: head || null });
      onToast('success', 'Department head updated.');
      load();
    } catch (e) {
      onToast('error', errorMessage(e));
    }
  };
  return (
    <Card className="p-4 sm:p-5 space-y-3">
      <h3 className="font-serif text-lg text-[#14213D]">Department heads</h3>
      <p className="text-xs text-[#4A5568]">A department head has manager powers over every task in their department (in addition to each employee’s reporting manager).</p>
      {!rows ? (
        <PageLoader rows={2} />
      ) : rows.length === 0 ? (
        <InfoCallout variant="neutral">No departments defined.</InfoCallout>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {rows.map((d) => (
            <Select
              key={d.id}
              label={d.name}
              value={d.head_user_id || ''}
              onChange={(e) => setHead(d.id, e.target.value)}
              options={[{ value: '', label: 'No head' }, ...users.map((u) => ({ value: u.id, label: `${u.full_name} (${u.role.replace(/_/g, ' ')})` }))]}
            />
          ))}
        </div>
      )}
    </Card>
  );
};
