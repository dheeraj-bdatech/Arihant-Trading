'use client';

/**
 * Admin masters for Module 9: expense categories (thresholds, caps, rules), projects, and claims
 * stuck with an inactive approver. Categories are never deleted — deactivate them instead so
 * historic claims keep their category.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { FolderKanban, Layers, Pencil, Plus, Receipt, Search, Settings2, Tag, UserX } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  EmptyState,
  FilterMenu,
  FormSteps,
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
import { errorMessage, fieldErrors, useBadgeCounts, useCategories, type ExpenseCategory, type ExpenseClaim, type Paged } from '../_lib/expense-lib';
import { DateText, ExpenseViewMenu, ExpensesNav, Money, StatusBadge, useToaster } from '../_lib/expense-ui';

type Section = 'categories' | 'projects' | 'approvers';
const SECTION_SEARCH: Record<Section, string> = {
  categories: 'Search category code or name…',
  projects: 'Search project code or name…',
  approvers: 'Search claim no., employee or approver…',
};
/** Case-insensitive match of `q` against any of the given fields. */
const matches = (q: string, ...fields: (string | null | undefined)[]) => !q || fields.some((f) => (f || '').toLowerCase().includes(q));

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
  const [tab, setTab] = useState<Section>('categories');
  const [search, setSearch] = useState('');
  const [newProject, setNewProject] = useState(0);
  const { categories, loading, reload } = useCategories(true);
  const counts = useBadgeCounts(allowed);
  const [form, setForm] = useState<CatForm | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const { push, Toaster } = useToaster();
  const q = search.trim().toLowerCase();
  const visibleCategories = useMemo(() => categories.filter((c) => matches(q, c.code, c.name)), [categories, q]);

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
        actions={
          tab === 'categories' ? (
            <Button size="sm" leftIcon={<Plus className="h-4 w-4" />} onClick={() => { setErrors({}); setForm(toForm()); }}>New category</Button>
          ) : tab === 'projects' ? (
            <Button size="sm" leftIcon={<Plus className="h-4 w-4" />} onClick={() => setNewProject((n) => n + 1)}>New project</Button>
          ) : undefined
        }
      />

      {/* One filter row: View (module navigation), section, search over the visible table. */}
      <Card padding="sm" className="relative z-20 overflow-visible border-[#DCD8CE]">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
          <ExpenseViewMenu />
          <div className="relative w-full min-w-[200px] lg:w-auto lg:flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8A8578]" aria-hidden />
            <input
              type="search"
              aria-label="Search this list"
              placeholder={SECTION_SEARCH[tab]}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 w-full rounded-lg border border-[#C9C4B8] bg-white pl-9 pr-3 text-xs text-[#14213D] placeholder:text-[#8A8578] focus:border-[#0F5E63] focus:outline-none focus:ring-2 focus:ring-[#0F5E63]/15"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2 lg:flex-nowrap">
            <FilterMenu
              label="Section"
              icon={<Layers />}
              neutralKeys={[]}
              align="right"
              options={[
                { key: 'categories', label: 'Categories', icon: <Tag /> },
                { key: 'projects', label: 'Projects', icon: <FolderKanban /> },
                { key: 'approvers', label: 'Stuck approvals', icon: <UserX />, count: counts?.approver_inactive || undefined, urgent: true },
              ].map((o) => ({
                ...o,
                active: tab === o.key,
                onSelect: () => {
                  setTab(o.key as Section);
                  setSearch('');
                },
              }))}
            />
            {search && (
              <Button variant="ghost" size="xs" onClick={() => setSearch('')} className="text-xs text-[#4A5568] hover:text-[#881337]">
                Clear
              </Button>
            )}
          </div>
        </div>
      </Card>

      {tab === 'categories' && (
        loading ? <PageLoader rows={4} /> : visibleCategories.length === 0 && q ? (
          <EmptyState
            icon={Tag}
            title="No categories match your search"
            description="Try a different code or name."
            action={<Button variant="secondary" onClick={() => setSearch('')}>Clear search</Button>}
          />
        ) : (
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
                {visibleCategories.map((c) => (
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

      {tab === 'projects' && <ProjectsPanel push={push} search={q} newRequest={newProject} onClearSearch={() => setSearch('')} />}
      {tab === 'approvers' && <StuckApprovals search={q} onClearSearch={() => setSearch('')} />}

      <Modal isOpen={Boolean(form)} onClose={() => setForm(null)} title={form?.id ? `Edit ${form.code}` : 'New category'} description="Inactive categories cannot be chosen on new lines but stay on historic claims." maxWidth="lg">
        {form && (
          <form onSubmit={(e) => { e.preventDefault(); save(); }}>
            <FormSteps
              onCancel={() => setForm(null)}
              busy={saving}
              submit={<Button type="submit" isLoading={saving}>Save</Button>}
              steps={[
                {
                  title: 'Basics',
                  icon: <Tag />,
                  description: 'The code and name staff see when picking this category.',
                  content: (
                    <div className="space-y-3">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
                        <Input label="Code *" value={form.code} disabled={Boolean(form.id)} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '') })} helperText={form.id ? 'Codes are fixed — they feed the Tally mapping.' : 'e.g. TOLL_PARKING'} error={errors.code} />
                        <Input label="Name *" value={form.name} maxLength={120} onChange={(e) => setForm({ ...form, name: e.target.value })} error={errors.name} />
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
                        <Input label="Display order" inputMode="numeric" value={form.display_order} onChange={(e) => setForm({ ...form, display_order: e.target.value.replace(/\D/g, '') })} error={errors.display_order} />
                      </div>
                      <Checkbox label="Active" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
                    </div>
                  ),
                },
                {
                  title: 'Receipts',
                  icon: <Receipt />,
                  description: 'When a bill or receipt must be attached to a line.',
                  content: (
                    <div className="space-y-3">
                      <div>
                        <span className="block text-xs font-semibold text-[#14213D] mb-1.5">Receipt required</span>
                        <Tabs variant="segmented" size="sm" activeTab={form.receipt_mode} onChange={(id) => setForm({ ...form, receipt_mode: id as CatForm['receipt_mode'] })} tabs={[{ id: 'always', label: 'Always' }, { id: 'above', label: 'At or above an amount' }, { id: 'never', label: 'Never' }]} />
                      </div>
                      {form.receipt_mode === 'above' && (
                        <Input label="Receipt threshold (₹)" inputMode="decimal" value={form.receipt_required_above} onChange={(e) => setForm({ ...form, receipt_required_above: e.target.value })} error={errors.receipt_required_above} />
                      )}
                    </div>
                  ),
                },
                {
                  title: 'Limits',
                  icon: <Settings2 />,
                  description: 'Spending caps and what each line must include.',
                  content: (
                    <div className="space-y-3">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
                        <Input label="Cap per item (₹)" inputMode="decimal" placeholder="No cap" value={form.max_amount_per_item} onChange={(e) => setForm({ ...form, max_amount_per_item: e.target.value })} error={errors.max_amount_per_item} />
                        <Checkbox label="Hard cap" description="Block amounts above the cap (otherwise warn and require a remark)" checked={form.cap_is_hard} onChange={(e) => setForm({ ...form, cap_is_hard: e.target.checked })} />
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <Checkbox label="Needs customer or project" checked={form.requires_customer_or_project} onChange={(e) => setForm({ ...form, requires_customer_or_project: e.target.checked })} />
                        <Checkbox label="Needs remarks" checked={form.requires_remark} onChange={(e) => setForm({ ...form, requires_remark: e.target.checked })} />
                      </div>
                    </div>
                  ),
                },
              ]}
            />
          </form>
        )}
      </Modal>
      <Toaster />
    </PageContainer>
  );
}

/** Projects master. `newRequest` increments when the page header's "New project" is pressed. */
const ProjectsPanel: React.FC<{ push: (k: 'success' | 'error', t: string) => void; search: string; newRequest: number; onClearSearch: () => void }> = ({
  push,
  search,
  newRequest,
  onClearSearch,
}) => {
  const [projects, setProjects] = useState<any[] | null>(null);
  const [form, setForm] = useState<{ id?: string; code: string; name: string; is_active: boolean } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const load = useCallback(() => api.get('/projects', { include_inactive: true }).then(setProjects).catch(() => setProjects([])), []);
  useEffect(() => {
    load();
  }, [load]);
  // Only presses made while this panel is open count — not the value it mounts with.
  const handledRequest = useRef(newRequest);
  useEffect(() => {
    if (newRequest === handledRequest.current) return;
    handledRequest.current = newRequest;
    setErrors({});
    setForm({ code: '', name: '', is_active: true });
  }, [newRequest]);
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
  const visible = projects.filter((p) => matches(search, p.code, p.name));
  return (
    <div className="space-y-3">
      {projects.length === 0 ? (
        <EmptyState icon={FolderKanban} title="No projects yet" description="Projects let Demo and Service expenses be tagged when there is no single customer." />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title="No projects match your search"
          description="Try a different code or name."
          action={<Button variant="secondary" onClick={onClearSearch}>Clear search</Button>}
        />
      ) : (
        <Card className="p-0 overflow-x-auto">
          <Table>
            <TableHeader><TableRow><TableHead>Code</TableHead><TableHead>Name</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Edit</TableHead></TableRow></TableHeader>
            <TableBody>
              {visible.map((p) => (
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
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="ghost" className="w-full sm:w-auto" onClick={() => setForm(null)}>Cancel</Button>
              <Button type="submit" className="w-full sm:w-auto" isLoading={saving}>Save</Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
};

/** Claims awaiting a manager who has since been deactivated (§5.17). */
const StuckApprovals: React.FC<{ search: string; onClearSearch: () => void }> = ({ search, onClearSearch }) => {
  const [result, setResult] = useState<Paged<ExpenseClaim> | null>(null);
  useEffect(() => {
    const load = () => api.get('/expense-claims', { approver_inactive: true, page_size: 50 }).then(setResult).catch(() => setResult({ data: [], total: 0, page: 1, limit: 50, totalPages: 1 }));
    load();
    window.addEventListener('expenses:changed', load);
    return () => window.removeEventListener('expenses:changed', load);
  }, []);
  if (!result) return <PageLoader rows={3} />;
  if (!result.data.length) return <EmptyState icon={UserX} title="No stuck approvals" description="Claims waiting on a deactivated approver will appear here for reassignment." />;
  const visible = result.data.filter((c) => matches(search, c.claim_number, c.employee_name, c.manager_name));
  if (!visible.length) {
    return (
      <EmptyState
        icon={UserX}
        title="No stuck approvals match your search"
        description="Try a different claim number or name."
        action={<Button variant="secondary" onClick={onClearSearch}>Clear search</Button>}
      />
    );
  }
  return (
    <Card className="p-0 overflow-x-auto">
      <Table>
        <TableHeader><TableRow><TableHead>Claim</TableHead><TableHead>Employee</TableHead><TableHead>Inactive approver</TableHead><TableHead>Submitted</TableHead><TableHead className="text-right">Amount</TableHead><TableHead /></TableRow></TableHeader>
        <TableBody>
          {visible.map((c) => (
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
