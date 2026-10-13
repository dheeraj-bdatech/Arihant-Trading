'use client';

/**
 * Admin masters for Module 9: expense categories (thresholds, caps, rules), projects, and claims
 * stuck with an inactive approver. Categories are never deleted — deactivate them instead so
 * historic claims keep their category.
 */
import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { FolderKanban, Pencil, Plus, Settings2, UserX } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  EmptyState,
  InfoCallout,
  Input,
  Modal,
  PageContainer,
  PageHeader,
  PageLoader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
} from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { errorMessage, fieldErrors, useCategories, type ExpenseCategory, type ExpenseClaim, type Paged } from '../_lib/expense-lib';
import { DateText, ExpensesNav, Money, StatusBadge, useToaster } from '../_lib/expense-ui';

type CatForm = {
  id?: string;
  code: string;
  name: string;
  receipt_mode: 'always' | 'above' | 'never';
  receipt_required_above: string;
  max_amount_per_item: string;
  cap_is_hard: boolean;
  requires_customer_or_project: boolean;
  requires_remark: boolean;
  is_active: boolean;
  display_order: string;
};

const toForm = (c?: ExpenseCategory): CatForm => ({
  id: c?.id,
  code: c?.code || '',
  name: c?.name || '',
  receipt_mode: !c ? 'always' : c.receipt_required_above === null ? 'never' : c.receipt_required_above === 0 ? 'always' : 'above',
  receipt_required_above: c?.receipt_required_above ? String(c.receipt_required_above) : '',
  max_amount_per_item: c?.max_amount_per_item ? String(c.max_amount_per_item) : '',
  cap_is_hard: c?.cap_is_hard ?? false,
  requires_customer_or_project: c?.requires_customer_or_project ?? false,
  requires_remark: c?.requires_remark ?? false,
  is_active: c?.is_active ?? true,
  display_order: String(c?.display_order ?? 50),
});

export default function ExpenseCategoriesPage() {
  const { user } = useAuth();
  const allowed = user?.role === 'admin' || user?.role === 'management';
  const [tab, setTab] = useState<'categories' | 'projects' | 'approvers'>('categories');
  const { categories, loading, reload } = useCategories(true);
  const [form, setForm] = useState<CatForm | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const { push, Toaster } = useToaster();

  if (!allowed) {
    return (
      <PageContainer>
        <ExpensesNav />
        <InfoCallout variant="warning" title="Administrators only">Expense categories are managed by administrators.</InfoCallout>
      </PageContainer>
    );
  }

  const save = async () => {
    if (!form) return;
    setSaving(true);
    setErrors({});
    const body: Record<string, unknown> = {
      name: form.name,
      receipt_required_above: form.receipt_mode === 'never' ? null : form.receipt_mode === 'always' ? 0 : form.receipt_required_above,
      max_amount_per_item: form.max_amount_per_item || null,
      cap_is_hard: form.cap_is_hard,
      requires_customer_or_project: form.requires_customer_or_project,
      requires_remark: form.requires_remark,
      is_active: form.is_active,
      display_order: Number(form.display_order),
    };
    try {
      if (form.id) await api.patch(`/expense-categories/${form.id}`, body);
      else await api.post('/expense-categories', { ...body, code: form.code });
      push('success', form.id ? 'Category updated.' : 'Category created.');
      setForm(null);
      reload();
    } catch (e) {
      setErrors(fieldErrors(e));
      if (!Object.keys(fieldErrors(e)).length) push('error', errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <PageContainer>
      <PageHeader
        title="Expense Categories"
        icon={<Settings2 className="h-5 w-5" />}
        actions={tab === 'categories' ? <Button size="sm" leftIcon={<Plus className="h-4 w-4" />} onClick={() => { setErrors({}); setForm(toForm()); }}>New category</Button> : undefined}
      />
      <ExpensesNav />
      <Tabs
        variant="segmented"
        activeTab={tab}
        onChange={(id) => setTab(id as typeof tab)}
        tabs={[
          { id: 'categories', label: 'Categories' },
          { id: 'projects', label: 'Projects' },
          { id: 'approvers', label: 'Stuck approvals' },
        ]}
      />

      {tab === 'categories' && (
        loading ? <PageLoader rows={4} /> : (
          <Card className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Receipt required</TableHead>
                  <TableHead>Cap per item</TableHead>
                  <TableHead>Rules</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Edit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {categories.map((c) => (
                  <TableRow key={c.id} className={c.is_active ? '' : 'opacity-60'}>
                    <TableCell className="font-mono text-xs">{c.code}</TableCell>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell className="text-xs">{c.receipt_required_above === null ? 'Never' : c.receipt_required_above === 0 ? 'Always' : <>At or above <Money value={c.receipt_required_above} /></>}</TableCell>
                    <TableCell className="text-xs">{c.max_amount_per_item === null ? '—' : <><Money value={c.max_amount_per_item} /> {c.cap_is_hard ? <Badge size="sm" variant="danger">hard</Badge> : <Badge size="sm" variant="warning">soft</Badge>}</>}</TableCell>
                    <TableCell className="text-xs space-x-1">
                      {c.requires_customer_or_project && <Badge size="sm" variant="outline">customer/project</Badge>}
                      {c.requires_remark && <Badge size="sm" variant="outline">remark</Badge>}
                    </TableCell>
                    <TableCell>{c.is_active ? <Badge size="sm" variant="success">Active</Badge> : <Badge size="sm">Inactive</Badge>}</TableCell>
                    <TableCell className="text-right"><Button size="xs" variant="ghost" leftIcon={<Pencil className="h-3 w-3" />} onClick={() => { setErrors({}); setForm(toForm(c)); }}>Edit</Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )
      )}

      {tab === 'projects' && <ProjectsPanel push={push} />}
      {tab === 'approvers' && <StuckApprovals />}

      <Modal isOpen={Boolean(form)} onClose={() => setForm(null)} title={form?.id ? `Edit ${form.code}` : 'New category'} description="Inactive categories cannot be chosen on new lines but stay on historic claims." maxWidth="lg">
        {form && (
          <form onSubmit={(e) => { e.preventDefault(); save(); }} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
              <Input label="Code *" value={form.code} disabled={Boolean(form.id)} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '') })} helperText={form.id ? 'Codes are fixed — they feed the Tally mapping.' : 'e.g. TOLL_PARKING'} error={errors.code} />
              <Input label="Name *" value={form.name} maxLength={120} onChange={(e) => setForm({ ...form, name: e.target.value })} error={errors.name} />
            </div>
            <div>
              <span className="block text-xs font-semibold text-[#14213D] mb-1.5">Receipt required</span>
              <Tabs variant="segmented" size="sm" activeTab={form.receipt_mode} onChange={(id) => setForm({ ...form, receipt_mode: id as CatForm['receipt_mode'] })} tabs={[{ id: 'always', label: 'Always' }, { id: 'above', label: 'At or above an amount' }, { id: 'never', label: 'Never' }]} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
              {form.receipt_mode === 'above' && (
                <Input label="Receipt threshold (₹)" inputMode="decimal" value={form.receipt_required_above} onChange={(e) => setForm({ ...form, receipt_required_above: e.target.value })} error={errors.receipt_required_above} />
              )}
              <Input label="Display order" inputMode="numeric" value={form.display_order} onChange={(e) => setForm({ ...form, display_order: e.target.value.replace(/\D/g, '') })} error={errors.display_order} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
              <Input label="Cap per item (₹)" inputMode="decimal" placeholder="No cap" value={form.max_amount_per_item} onChange={(e) => setForm({ ...form, max_amount_per_item: e.target.value })} error={errors.max_amount_per_item} />
              <Checkbox label="Hard cap" description="Block amounts above the cap (otherwise warn and require a remark)" checked={form.cap_is_hard} onChange={(e) => setForm({ ...form, cap_is_hard: e.target.checked })} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Checkbox label="Needs customer or project" checked={form.requires_customer_or_project} onChange={(e) => setForm({ ...form, requires_customer_or_project: e.target.checked })} />
              <Checkbox label="Needs remarks" checked={form.requires_remark} onChange={(e) => setForm({ ...form, requires_remark: e.target.checked })} />
              <Checkbox label="Active" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setForm(null)} disabled={saving}>Cancel</Button>
              <Button type="submit" isLoading={saving}>Save</Button>
            </div>
          </form>
        )}
      </Modal>
      <Toaster />
    </PageContainer>
  );
}

const ProjectsPanel: React.FC<{ push: (k: 'success' | 'error', t: string) => void }> = ({ push }) => {
  const [projects, setProjects] = useState<any[] | null>(null);
  const [form, setForm] = useState<{ id?: string; code: string; name: string; is_active: boolean } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const load = useCallback(() => api.get('/projects', { include_inactive: true }).then(setProjects).catch(() => setProjects([])), []);
  useEffect(() => {
    load();
  }, [load]);
  const save = async () => {
    if (!form) return;
    setSaving(true);
    setErrors({});
    try {
      if (form.id) await api.patch(`/projects/${form.id}`, { code: form.code, name: form.name, is_active: form.is_active });
      else await api.post('/projects', { code: form.code, name: form.name });
      setForm(null);
      push('success', 'Project saved.');
      load();
    } catch (e) {
      setErrors(fieldErrors(e));
    } finally {
      setSaving(false);
    }
  };
  if (!projects) return <PageLoader rows={3} />;
  return (
    <div className="space-y-3">
      <div className="flex justify-end"><Button size="sm" leftIcon={<Plus className="h-4 w-4" />} onClick={() => { setErrors({}); setForm({ code: '', name: '', is_active: true }); }}>New project</Button></div>
      {projects.length === 0 ? (
        <EmptyState icon={FolderKanban} title="No projects yet" description="Projects let Demo and Service expenses be tagged when there is no single customer." />
      ) : (
        <Card className="p-0 overflow-x-auto">
          <Table>
            <TableHeader><TableRow><TableHead>Code</TableHead><TableHead>Name</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Edit</TableHead></TableRow></TableHeader>
            <TableBody>
              {projects.map((p) => (
                <TableRow key={p.id} className={p.is_active ? '' : 'opacity-60'}>
                  <TableCell className="font-mono text-xs">{p.code}</TableCell>
                  <TableCell>{p.name}</TableCell>
                  <TableCell>{p.is_active ? <Badge size="sm" variant="success">Active</Badge> : <Badge size="sm">Inactive</Badge>}</TableCell>
                  <TableCell className="text-right"><Button size="xs" variant="ghost" onClick={() => { setErrors({}); setForm({ id: p.id, code: p.code, name: p.name, is_active: p.is_active }); }}>Edit</Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      <Modal isOpen={Boolean(form)} onClose={() => setForm(null)} title={form?.id ? 'Edit project' : 'New project'} maxWidth="md">
        {form && (
          <form onSubmit={(e) => { e.preventDefault(); save(); }} className="space-y-3">
            <Input label="Code *" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} error={errors.code} />
            <Input label="Name *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} error={errors.name} />
            {form.id && <Checkbox label="Active" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />}
            <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setForm(null)}>Cancel</Button><Button type="submit" isLoading={saving}>Save</Button></div>
          </form>
        )}
      </Modal>
    </div>
  );
};

/** Claims awaiting a manager who has since been deactivated (§5.17). */
const StuckApprovals: React.FC = () => {
  const [result, setResult] = useState<Paged<ExpenseClaim> | null>(null);
  useEffect(() => {
    const load = () => api.get('/expense-claims', { approver_inactive: true, page_size: 50 }).then(setResult).catch(() => setResult({ data: [], total: 0, page: 1, limit: 50, totalPages: 1 }));
    load();
    window.addEventListener('expenses:changed', load);
    return () => window.removeEventListener('expenses:changed', load);
  }, []);
  if (!result) return <PageLoader rows={3} />;
  if (!result.data.length) return <EmptyState icon={UserX} title="No stuck approvals" description="Claims waiting on a deactivated approver will appear here for reassignment." />;
  return (
    <Card className="p-0 overflow-x-auto">
      <Table>
        <TableHeader><TableRow><TableHead>Claim</TableHead><TableHead>Employee</TableHead><TableHead>Inactive approver</TableHead><TableHead>Submitted</TableHead><TableHead className="text-right">Amount</TableHead><TableHead /></TableRow></TableHeader>
        <TableBody>
          {result.data.map((c) => (
            <TableRow key={c.id}>
              <TableCell className="font-mono text-xs text-[#0F5E63]">{c.claim_number}</TableCell>
              <TableCell>{c.employee_name}</TableCell>
              <TableCell>{c.manager_name} <StatusBadge status={c.status} /></TableCell>
              <TableCell className="text-xs"><DateText value={c.submitted_at} /></TableCell>
              <TableCell className="text-right"><Money value={c.total_claimed} /></TableCell>
              <TableCell className="text-right"><Link href={`/expenses/${c.id}`}><Button size="xs">Reassign</Button></Link></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
};
