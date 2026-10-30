'use client';

/**
 * Administration dialogs: user create / edit (role, department, reporting manager, territory), inviting many people
 * at once, master records (equipment, zones, regions, departments), switching a module off for a role, and a
 * confirmation step for destructive account changes.
 * Every save goes to the API, which re-validates and writes the audit trail.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Copy, Download, KeyRound, Upload } from 'lucide-react';
import { api } from '@/lib/api';
import { Badge, Button, Checkbox, InfoCallout, Input, Modal, Select, Textarea } from '@/components/ui';
import { ROLE_PROFILES, USER_ROLES, type UserRole } from '@arihant/shared';

export interface AdminUser {
  id: string;
  full_name: string;
  email: string;
  phone?: string | null;
  role: UserRole;
  region_id?: string | null;
  zone_id?: string | null;
  reporting_manager_id?: string | null;
  reporting_manager_name?: string | null;
  department_id?: string | null;
  is_active: boolean;
}
export interface AdminDepartment {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  head_user_id?: string | null;
  head_name?: string | null;
  member_count?: number;
}
export interface AdminZone {
  id: string;
  code: string;
  name: string;
}
export interface AdminRegion {
  id: string;
  name: string;
  zone_id: string | null;
  zone_name?: string | null;
}
export interface AdminProduct {
  id: string;
  name: string;
  category?: string | null;
  make?: string | null;
  is_mha_qr?: boolean | null;
  spec_ref?: string | null;
}

/** Roles that are expected to sit under a reporting manager and inside a zone (Blueprint §5). */
const FIELD_ROLES: UserRole[] = ['sales', 'demo_team', 'service_team', 'regional_manager'];
/** Who may be picked as a manager for a role: someone senior who can approve stage-1 work. */
const MANAGER_ROLES: UserRole[] = ['management', 'regional_manager', 'admin', 'tender_team', 'service_team', 'accounts', 'demo_team'];

const errText = (e: any) => e?.message || 'The request failed. Please try again.';

/* ------------------------------------------------------------------ user form -- */
export const UserFormModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  editing: AdminUser | null;
  users: AdminUser[];
  zones: AdminZone[];
  regions: AdminRegion[];
  departments: AdminDepartment[];
  currentUserId?: string;
  onSaved: (user: AdminUser, temporaryPassword?: string) => void;
}> = ({ isOpen, onClose, editing, users, zones, regions, departments, currentUserId, onSaved }) => {
  const blank = { full_name: '', email: '', phone: '', role: 'sales' as UserRole, department_id: '', zone_id: '', region_id: '', reporting_manager_id: '', password: '' };
  const [form, setForm] = useState(blank);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    setForm(
      editing
        ? {
            full_name: editing.full_name || '',
            email: editing.email || '',
            phone: editing.phone || '',
            role: editing.role,
            department_id: editing.department_id || '',
            zone_id: editing.zone_id || '',
            region_id: editing.region_id || '',
            reporting_manager_id: editing.reporting_manager_id || '',
            password: '',
          }
        : blank,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, editing]);

  const isSelf = !!editing && editing.id === currentUserId;
  const zoneRegions = useMemo(() => regions.filter((r) => !form.zone_id || r.zone_id === form.zone_id), [regions, form.zone_id]);
  const managers = useMemo(
    () =>
      users
        .filter((u) => u.is_active && u.id !== editing?.id && MANAGER_ROLES.includes(u.role))
        .sort((a, b) => a.full_name.localeCompare(b.full_name)),
    [users, editing],
  );
  const needsTerritory = FIELD_ROLES.includes(form.role);

  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (form.full_name.trim().length < 2) return setError('Enter the full name (at least 2 characters).');
    if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) return setError('Enter a valid email address.');
    if (form.password && form.password.length < 8) return setError('The initial password must be at least 8 characters.');
    if (needsTerritory && !form.zone_id) return setError(`${ROLE_PROFILES[form.role].title} accounts need a zone.`);
    if (form.role !== 'management' && form.role !== 'admin' && !form.reporting_manager_id) {
      return setError('Choose a reporting manager — stage-1 approvals and task escalations route to them.');
    }
    const body: Record<string, unknown> = {
      full_name: form.full_name.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
      department_id: form.department_id || null,
      zone_id: form.zone_id,
      region_id: form.region_id,
      reporting_manager_id: form.reporting_manager_id,
    };
    if (!isSelf) body.role = form.role;
    setSaving(true);
    try {
      if (editing) {
        const saved = await api.patch<AdminUser>(`/users/${editing.id}`, body);
        onSaved(saved);
      } else {
        if (form.password) body.password = form.password;
        body.role = form.role;
        const saved = await api.post<AdminUser & { temporary_password?: string }>('/users', body);
        onSaved(saved, saved.temporary_password);
      }
    } catch (err) {
      setError(errText(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={editing ? `Edit ${editing.full_name}` : 'Add user'}
      description={editing ? 'Role, reporting line and territory decide what this person sees and who approves their work.' : 'Creates a sign-in account. A one-time password is generated unless you set one.'}
      maxWidth="2xl"
    >
      <form onSubmit={submit} className="space-y-4">
        {error && (
          <InfoCallout variant="danger" title="Not saved">
            {error}
          </InfoCallout>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input label="Full name" required value={form.full_name} onChange={(e) => set({ full_name: e.target.value })} maxLength={120} />
          <Input label="Official email" type="email" required value={form.email} onChange={(e) => set({ email: e.target.value })} maxLength={254} />
          <Input label="Mobile" type="tel" inputMode="tel" value={form.phone} onChange={(e) => set({ phone: e.target.value })} placeholder="+91 98110 00000" />
          <Select
            label="Role"
            required
            value={form.role}
            disabled={isSelf}
            helperText={isSelf ? 'You cannot change your own role.' : ROLE_PROFILES[form.role].scopeSummary}
            onChange={(e) => set({ role: e.target.value as UserRole })}
            options={USER_ROLES.map((r) => ({ value: r, label: ROLE_PROFILES[r].title }))}
          />
          <Select
            label="Department"
            value={form.department_id}
            helperText={departments.length ? undefined : 'Add departments under Departments first'}
            onChange={(e) => set({ department_id: e.target.value })}
            options={[{ value: '', label: '— No department —' }, ...departments.map((d) => ({ value: d.id, label: d.name }))]}
          />
          <Select
            label="Zone"
            required={needsTerritory}
            value={form.zone_id}
            onChange={(e) => set({ zone_id: e.target.value, region_id: '' })}
            options={[{ value: '', label: needsTerritory ? '— Choose zone —' : 'All India (no zone)' }, ...zones.map((z) => ({ value: z.id, label: `${z.name} (${z.code})` }))]}
          />
          <Select
            label="Region"
            value={form.region_id}
            disabled={!form.zone_id}
            helperText={form.zone_id ? undefined : 'Pick a zone first'}
            onChange={(e) => set({ region_id: e.target.value })}
            options={[{ value: '', label: 'Whole zone' }, ...zoneRegions.map((r) => ({ value: r.id, label: r.name }))]}
          />
          <div className="sm:col-span-2">
            <Select
              label="Reporting manager"
              required={form.role !== 'management' && form.role !== 'admin'}
              value={form.reporting_manager_id}
              onChange={(e) => set({ reporting_manager_id: e.target.value })}
              options={[
                { value: '', label: '— None (top of the hierarchy) —' },
                ...managers.map((m) => ({ value: m.id, label: `${m.full_name} · ${ROLE_PROFILES[m.role]?.title ?? m.role}` })),
              ]}
            />
          </div>
          {!editing && (
            <div className="sm:col-span-2">
              <Input
                label="Initial password (optional)"
                type="password"
                autoComplete="new-password"
                value={form.password}
                onChange={(e) => set({ password: e.target.value })}
                helperText="Leave blank to generate a one-time password that is shown once after saving."
              />
            </div>
          )}
        </div>
        <div className="flex flex-col-reverse gap-2 border-t border-[#ECE9E2] pt-4 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" isLoading={saving}>
            {editing ? 'Save changes' : 'Create user'}
          </Button>
        </div>
      </form>
    </Modal>
  );
};

/* -------------------------------------------------------- one-time password -- */
export const TemporaryPasswordModal: React.FC<{ value: { email: string; password: string } | null; onClose: () => void }> = ({ value, onClose }) => {
  const [copied, setCopied] = useState(false);
  useEffect(() => setCopied(false), [value]);
  return (
    <Modal isOpen={!!value} onClose={onClose} title="Account created" description="Hand this one-time password to the user over a secure channel. It is not shown again." maxWidth="md">
      {value && (
        <div className="space-y-4">
          <div className="rounded-[14px] border border-[#DCD8CE] bg-[#FBFAF7] p-4">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[#4A5568]">Sign-in email</div>
            <div className="font-mono text-sm text-[#14213D]">{value.email}</div>
            <div className="mt-3 text-[11px] font-semibold uppercase tracking-wider text-[#4A5568]">One-time password</div>
            <div className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-[#0F5E63]" />
              <span className="font-mono text-sm font-bold text-[#14213D]">{value.password}</span>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              leftIcon={<Copy className="h-3.5 w-3.5" />}
              onClick={() => {
                navigator.clipboard?.writeText(value.password).then(() => setCopied(true), () => undefined);
              }}
            >
              {copied ? 'Copied' : 'Copy password'}
            </Button>
            <Button onClick={onClose}>Done</Button>
          </div>
        </div>
      )}
    </Modal>
  );
};

/* -------------------------------------------------------------- confirmation -- */
export const ConfirmModal: React.FC<{
  isOpen: boolean;
  title: string;
  message: React.ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}> = ({ isOpen, title, message, confirmLabel, danger, onConfirm, onClose }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (isOpen) setError(null);
  }, [isOpen]);
  return (
    <Modal isOpen={isOpen} onClose={() => !busy && onClose()} title={title} maxWidth="md">
      <div className="space-y-4">
        <div className="flex items-start gap-3 text-sm text-[#14213D]">
          {danger && <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-[#9A3412]" />}
          <div className="space-y-1 text-xs leading-relaxed text-[#4A5568]">{message}</div>
        </div>
        {error && (
          <InfoCallout variant="danger" title="Not done">
            {error}
          </InfoCallout>
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            isLoading={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await onConfirm();
                onClose();
              } catch (e) {
                setError(errText(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
};

/* ------------------------------------------------------------ product master -- */
export const ProductFormModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  editing: AdminProduct | null;
  onSaved: (p: AdminProduct) => void;
}> = ({ isOpen, onClose, editing, onSaved }) => {
  const [form, setForm] = useState({ name: '', category: '', make: '', spec_ref: '', is_mha_qr: false });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    setForm({
      name: editing?.name || '',
      category: editing?.category || '',
      make: editing?.make || '',
      spec_ref: editing?.spec_ref || '',
      is_mha_qr: !!editing?.is_mha_qr,
    });
  }, [isOpen, editing]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return setError('Enter the equipment name.');
    setSaving(true);
    setError(null);
    try {
      const body = { ...form, name: form.name.trim() };
      const saved = editing ? await api.patch<AdminProduct>(`/masters/products/${editing.id}`, body) : await api.post<AdminProduct>('/masters/products', body);
      onSaved(saved);
    } catch (err) {
      setError(errText(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={editing ? `Edit ${editing.name}` : 'Add equipment master'} maxWidth="lg">
      <form onSubmit={submit} className="space-y-4">
        {error && (
          <InfoCallout variant="danger" title="Not saved">
            {error}
          </InfoCallout>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Input label="Equipment name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={160} />
          </div>
          <Input label="Category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="e.g. X-Ray Baggage Scanner" />
          <Input label="Make / OEM" value={form.make} onChange={(e) => setForm({ ...form, make: e.target.value })} />
          <div className="sm:col-span-2">
            <Input label="MHA QR / spec reference" value={form.spec_ref} onChange={(e) => setForm({ ...form, spec_ref: e.target.value })} />
          </div>
          <div className="sm:col-span-2">
            <Checkbox
              label="MHA Qualitative Requirement (QR) compliant"
              description="Shown as an MHA QR badge on tenders, proposals and demos."
              checked={form.is_mha_qr}
              onChange={(e) => setForm({ ...form, is_mha_qr: e.target.checked })}
            />
          </div>
        </div>
        <div className="flex flex-col-reverse gap-2 border-t border-[#ECE9E2] pt-4 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" isLoading={saving}>
            {editing ? 'Save changes' : 'Add equipment'}
          </Button>
        </div>
      </form>
    </Modal>
  );
};

/* ------------------------------------------------------------ zone / region -- */
export const TerritoryFormModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  kind: 'zone' | 'region';
  editing: AdminZone | AdminRegion | null;
  zones: AdminZone[];
  defaultZoneId?: string;
  onSaved: () => void;
}> = ({ isOpen, onClose, kind, editing, zones, defaultZoneId, onSaved }) => {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [zoneId, setZoneId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    setName(editing?.name || '');
    setCode(kind === 'zone' ? (editing as AdminZone | null)?.code || '' : '');
    setZoneId(kind === 'region' ? (editing as AdminRegion | null)?.zone_id || defaultZoneId || '' : '');
  }, [isOpen, editing, kind, defaultZoneId]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError(`Enter the ${kind} name.`);
    if (kind === 'zone' && !code.trim()) return setError('Enter a short zone code (e.g. NZ).');
    if (kind === 'region' && !zoneId) return setError('Choose the zone this region belongs to.');
    setSaving(true);
    setError(null);
    try {
      const body = kind === 'zone' ? { name: name.trim(), code: code.trim() } : { name: name.trim(), zone_id: zoneId };
      const path = kind === 'zone' ? '/masters/zones' : '/masters/regions';
      if (editing) await api.patch(`${path}/${editing.id}`, body);
      else await api.post(path, body);
      onSaved();
    } catch (err) {
      setError(errText(err));
    } finally {
      setSaving(false);
    }
  };

  const movesZone = kind === 'region' && !!editing && (editing as AdminRegion).zone_id !== zoneId;
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`${editing ? 'Edit' : 'Add'} ${kind}`} maxWidth="md">
      <form onSubmit={submit} className="space-y-4">
        {error && (
          <InfoCallout variant="danger" title="Not saved">
            {error}
          </InfoCallout>
        )}
        {kind === 'zone' && <Input label="Zone code" required value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={12} placeholder="NZ" />}
        <Input label={kind === 'zone' ? 'Zone name' : 'Region name'} required value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        {kind === 'region' && (
          <Select
            label="Zone"
            required
            value={zoneId}
            onChange={(e) => setZoneId(e.target.value)}
            options={[{ value: '', label: '— Choose zone —' }, ...zones.map((z) => ({ value: z.id, label: `${z.name} (${z.code})` }))]}
          />
        )}
        {movesZone && (
          <InfoCallout variant="warning" title="Moving a region">
            Users based in this region move to the new zone with it, which changes what their regional manager sees.
          </InfoCallout>
        )}
        <div className="flex flex-col-reverse gap-2 border-t border-[#ECE9E2] pt-4 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" isLoading={saving}>
            Save
          </Button>
        </div>
      </form>
    </Modal>
  );
};

/* ---------------------------------------------------------------- invite people -- */
interface InviteRow {
  line: number;
  full_name: string;
  email: string;
  role?: UserRole;
  region_name?: string;
  manager_email?: string;
  problem?: string;
}
interface InviteResult {
  created: number;
  skipped: number;
  invited: { email: string; temporary_password: string }[];
  errors: { email: string; reason: string }[];
}

/** 'Sales', 'sales', 'Senior Sales Executive' → 'sales'. */
const roleFrom = (raw: string): UserRole | undefined => {
  const v = raw.trim().toLowerCase().replace(/[\s-]+/g, '_');
  return USER_ROLES.find((r) => r === v || ROLE_PROFILES[r].title.toLowerCase().replace(/[\s-]+/g, '_') === v);
};

/** One person per line: name, email, role[, region[, manager email]] (comma or tab separated; a header row is skipped). */
function parseInvites(text: string, regions: AdminRegion[], users: AdminUser[]): InviteRow[] {
  const regionNames = new Set(regions.map((r) => r.name.toLowerCase()));
  const managers = new Set(users.filter((u) => u.is_active).map((u) => u.email.toLowerCase()));
  const seen = new Set<string>();
  return text
    .split(/\r?\n/)
    .map((raw, i) => ({ raw: raw.trim(), line: i + 1 }))
    .filter(({ raw }) => raw && !/^#/.test(raw) && !/^(full[_ ]?)?name\s*[,\t]/i.test(raw))
    .map(({ raw, line }) => {
      const [full_name = '', email = '', role = '', region_name = '', manager_email = ''] = raw.split(/\t|,/).map((c) => c.trim());
      const row: InviteRow = { line, full_name, email: email.toLowerCase(), role: roleFrom(role), region_name: region_name || undefined, manager_email: manager_email.toLowerCase() || undefined };
      if (full_name.length < 2) row.problem = 'Name missing';
      else if (!/^\S+@\S+\.\S+$/.test(row.email)) row.problem = 'Email is not valid';
      else if (seen.has(row.email)) row.problem = 'Listed twice';
      else if (!row.role) row.problem = `Unknown role "${role}"`;
      else if (FIELD_ROLES.includes(row.role) && !row.region_name) row.problem = 'Field roles need a region';
      else if (row.region_name && !regionNames.has(row.region_name.toLowerCase())) row.problem = `Unknown region "${row.region_name}"`;
      else if (row.role !== 'management' && row.role !== 'admin' && !row.manager_email) row.problem = 'Needs a reporting manager email';
      else if (row.manager_email && !managers.has(row.manager_email)) row.problem = 'Manager is not an active user';
      seen.add(row.email);
      return row;
    });
}

export const BulkInviteModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  users: AdminUser[];
  regions: AdminRegion[];
  onInvited: () => void;
}> = ({ isOpen, onClose, users, regions, onInvited }) => {
  const [text, setText] = useState('');
  const [result, setResult] = useState<InviteResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!isOpen) return;
    setText('');
    setResult(null);
    setError(null);
    setCopied(false);
  }, [isOpen]);

  const rows = useMemo(() => parseInvites(text, regions, users), [text, regions, users]);
  const ready = rows.filter((r) => !r.problem);

  const readFile = async (file?: File | null) => {
    if (!file) return;
    if (file.size > 512 * 1024) return setError('The file is larger than 512 KB — split it into smaller lists.');
    setText((await file.text()).trim());
  };

  const submit = async () => {
    if (!ready.length) return setError('Nobody on the list is ready to invite — fix the rows marked in red.');
    setSaving(true);
    setError(null);
    try {
      const res = await api.post<InviteResult>('/users/bulk-invite', {
        users: ready.map(({ full_name, email, role, region_name, manager_email }) => ({ full_name, email, role, region_name, manager_email })),
      });
      setResult(res);
      if (res.created) onInvited();
    } catch (err) {
      setError(errText(err));
    } finally {
      setSaving(false);
    }
  };

  const credentials = (result?.invited || []).map((i) => `${i.email}\t${i.temporary_password}`).join('\n');
  const downloadCsv = () => {
    const csv = ['email,temporary_password', ...(result?.invited || []).map((i) => `${i.email},${i.temporary_password}`)].join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: 'invited-accounts.csv' });
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => !saving && onClose()}
      title={result ? 'Invitations created' : 'Invite people'}
      description={
        result
          ? 'Hand each person their one-time password over a secure channel. The passwords are not shown again.'
          : 'One person per line: name, email, role, region, reporting manager email. No e-mail is sent — you share the one-time passwords.'
      }
      maxWidth="3xl"
    >
      {result ? (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge variant="success">{result.created} created</Badge>
            {result.skipped > 0 && <Badge variant="outline">{result.skipped} already had an account</Badge>}
            {result.errors.length > 0 && <Badge variant="danger">{result.errors.length} refused</Badge>}
          </div>
          {result.errors.length > 0 && (
            <InfoCallout variant="danger" title="Not invited">
              <ul className="space-y-0.5">
                {result.errors.map((e) => (
                  <li key={e.email}>
                    <span className="font-mono">{e.email}</span> — {e.reason}
                  </li>
                ))}
              </ul>
            </InfoCallout>
          )}
          {result.invited.length > 0 && (
            <div className="max-h-72 overflow-y-auto rounded-[14px] border border-[#DCD8CE]">
              <table className="w-full text-xs">
                <thead className="bg-[#FBFAF7] text-left text-[11px] uppercase tracking-wider text-[#4A5568]">
                  <tr>
                    <th className="px-3 py-2">Sign-in email</th>
                    <th className="px-3 py-2">One-time password</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#ECE9E2]">
                  {result.invited.map((i) => (
                    <tr key={i.email}>
                      <td className="px-3 py-2 font-mono text-[#14213D]">{i.email}</td>
                      <td className="px-3 py-2 font-mono font-bold text-[#14213D]">{i.temporary_password}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex flex-col-reverse gap-2 border-t border-[#ECE9E2] pt-4 sm:flex-row sm:justify-end">
            {result.invited.length > 0 && (
              <>
                <Button variant="secondary" leftIcon={<Download className="h-3.5 w-3.5" />} onClick={downloadCsv}>
                  Download CSV
                </Button>
                <Button
                  variant="secondary"
                  leftIcon={<Copy className="h-3.5 w-3.5" />}
                  onClick={() => navigator.clipboard?.writeText(credentials).then(() => setCopied(true), () => undefined)}
                >
                  {copied ? 'Copied' : 'Copy all'}
                </Button>
              </>
            )}
            <Button onClick={onClose}>Done</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {error && (
            <InfoCallout variant="danger" title="Not invited">
              {error}
            </InfoCallout>
          )}
          <Textarea
            label="People to invite"
            rows={7}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={'Amit Verma, amit.verma@arihant.com, sales, Delhi NCR, regmgr.north@arihant.com\nKavita Rao, kavita.rao@arihant.com, accounts, , accounts@arihant.com'}
            className="font-mono text-xs"
          />
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#4A5568]">
            <span>
              Roles: {USER_ROLES.join(', ')}. Field roles (sales, demo, service, regional manager) need a region.
            </span>
            <label className="inline-flex min-h-10 cursor-pointer items-center gap-1 rounded-lg border border-[#C9C4B8] bg-white px-2.5 font-semibold text-[#0F5E63] hover:bg-[#E3EFEE] sm:min-h-8">
              <Upload className="h-3.5 w-3.5" /> Load a CSV file
              <input type="file" accept=".csv,text/csv,text/plain" className="hidden" onChange={(e) => void readFile(e.target.files?.[0])} />
            </label>
          </div>
          {rows.length > 0 && (
            <div className="max-h-64 overflow-y-auto rounded-[14px] border border-[#DCD8CE]">
              <table className="w-full text-xs">
                <thead className="bg-[#FBFAF7] text-left text-[11px] uppercase tracking-wider text-[#4A5568]">
                  <tr>
                    <th className="px-3 py-2">Person</th>
                    <th className="px-3 py-2">Role</th>
                    <th className="px-3 py-2">Region · manager</th>
                    <th className="px-3 py-2">Check</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#ECE9E2]">
                  {rows.map((r) => (
                    <tr key={r.line} className={r.problem ? 'bg-[#FCE8EC]/50' : undefined}>
                      <td className="px-3 py-2">
                        <div className="font-semibold text-[#14213D]">{r.full_name || '—'}</div>
                        <div className="font-mono text-[11px] text-[#4A5568]">{r.email || '—'}</div>
                      </td>
                      <td className="px-3 py-2 text-[#14213D]">{r.role ? ROLE_PROFILES[r.role].title : '—'}</td>
                      <td className="px-3 py-2 text-[#4A5568]">{[r.region_name, r.manager_email].filter(Boolean).join(' · ') || '—'}</td>
                      <td className={`px-3 py-2 font-semibold ${r.problem ? 'text-[#881337]' : 'text-[#0F5E63]'}`}>{r.problem || 'Ready'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex flex-col-reverse gap-2 border-t border-[#ECE9E2] pt-4 sm:flex-row sm:items-center sm:justify-end">
            <span className="text-xs text-[#4A5568] sm:mr-auto">
              {rows.length ? `${ready.length} of ${rows.length} ready${ready.length < rows.length ? ' — rows marked in red are left out' : ''}` : 'Paste a list or load a CSV file'}
            </span>
            <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={submit} isLoading={saving} disabled={!ready.length}>
              Invite {ready.length || ''} {ready.length === 1 ? 'person' : 'people'}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
};

/* ------------------------------------------------------------------- departments -- */
export const DepartmentFormModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  editing: AdminDepartment | null;
  users: AdminUser[];
  onSaved: () => void;
}> = ({ isOpen, onClose, editing, users, onSaved }) => {
  const [form, setForm] = useState({ code: '', name: '', description: '', head_user_id: '' });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    setForm({ code: editing?.code || '', name: editing?.name || '', description: editing?.description || '', head_user_id: editing?.head_user_id || '' });
  }, [isOpen, editing]);
  const heads = useMemo(() => users.filter((u) => u.is_active).sort((a, b) => a.full_name.localeCompare(b.full_name)), [users]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing && !/^[a-z0-9_]{2,30}$/.test(form.code.trim())) return setError('Code: 2–30 lowercase letters, digits or _ (e.g. field_service).');
    if (form.name.trim().length < 2) return setError('Enter the department name.');
    setSaving(true);
    setError(null);
    try {
      const body = { name: form.name.trim(), description: form.description.trim() || null, head_user_id: form.head_user_id || null };
      if (editing) await api.patch(`/masters/departments/${editing.id}`, body);
      else await api.post('/masters/departments', { ...body, code: form.code.trim() });
      onSaved();
    } catch (err) {
      setError(errText(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={editing ? `Edit ${editing.name}` : 'Add department'} maxWidth="lg">
      <form onSubmit={submit} className="space-y-4">
        {error && (
          <InfoCallout variant="danger" title="Not saved">
            {error}
          </InfoCallout>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input
            label="Code"
            required={!editing}
            disabled={!!editing}
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value.toLowerCase() })}
            maxLength={30}
            placeholder="field_service"
            helperText={editing ? 'The code is fixed once created.' : undefined}
          />
          <Input label="Name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={80} />
          <div className="sm:col-span-2">
            <Select
              label="Department head"
              value={form.head_user_id}
              helperText="Task blockers and escalations of the department route to the head."
              onChange={(e) => setForm({ ...form, head_user_id: e.target.value })}
              options={[{ value: '', label: '— No head —' }, ...heads.map((u) => ({ value: u.id, label: `${u.full_name} · ${ROLE_PROFILES[u.role]?.title ?? u.role}` }))]}
            />
          </div>
          <div className="sm:col-span-2">
            <Textarea label="Description" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} maxLength={500} />
          </div>
        </div>
        <div className="flex flex-col-reverse gap-2 border-t border-[#ECE9E2] pt-4 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" isLoading={saving}>
            {editing ? 'Save changes' : 'Add department'}
          </Button>
        </div>
      </form>
    </Modal>
  );
};

/* ---------------------------------------------------- switch a module off for a role -- */
export const ModuleSwitchOffModal: React.FC<{
  target: { role: UserRole; module: string; label: string } | null;
  onClose: () => void;
  onDone: () => void;
}> = ({ target, onClose, onDone }) => {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setReason('');
    setError(null);
  }, [target]);
  if (!target) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (reason.trim().length < 5) return setError('Give a reason of at least 5 characters — it goes into the audit trail.');
    setSaving(true);
    setError(null);
    try {
      await api.patch(`/admin/access/${target.role}/${target.module}`, { blocked: true, reason: reason.trim() });
      onDone();
    } catch (err) {
      setError(errText(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen onClose={() => !saving && onClose()} title={`Switch off ${target.label}`} description={`For every ${ROLE_PROFILES[target.role].title} account.`} maxWidth="md">
      <form onSubmit={submit} className="space-y-4">
        <InfoCallout variant="warning" title="Takes effect at once">
          The API refuses {target.label} for this role straight away, and its pages, links and menu entries disappear the next time those users open the app or
          return to it. You can switch it back on at any time.
        </InfoCallout>
        {error && (
          <InfoCallout variant="danger" title="Not switched off">
            {error}
          </InfoCallout>
        )}
        <Textarea label="Reason" required rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="e.g. Tender data restricted during the annual audit" />
        <div className="flex flex-col-reverse gap-2 border-t border-[#ECE9E2] pt-4 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" variant="danger" isLoading={saving}>
            Switch off
          </Button>
        </div>
      </form>
    </Modal>
  );
};
