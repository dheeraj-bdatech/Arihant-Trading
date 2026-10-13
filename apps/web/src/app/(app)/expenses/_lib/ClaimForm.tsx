'use client';

/**
 * Create / edit an expense claim (§8.2). The header is saved as a draft first; each line is then
 * saved individually so the server validates it immediately and errors show under the field.
 * Receipts upload per line (drag & drop, file picker or phone camera).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  ArrowLeft,
  Camera,
  Copy,
  FileText,
  ImageIcon,
  Paperclip,
  Pencil,
  Plus,
  Save,
  Send,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  InfoCallout,
  Input,
  Modal,
  PageLoader,
  Select,
  Textarea,
} from '@/components/ui';
import { api } from '@/lib/api';
import {
  CATEGORY_DETAIL_KIND,
  MEAL_TYPES,
  TRAVEL_MODES,
  formatExpenseAmount,
  hotelNights,
  roundMoney,
  todayInKolkata,
} from '@arihant/shared';
import {
  errorMessage,
  fieldErrors,
  isConflict,
  notifyExpensesChanged,
  useCategories,
  type ExpenseAttachment,
  type ExpenseCategory,
  type ExpenseClaim,
  type ExpenseItem,
} from './expense-lib';
import { ConflictCallout, DateText, LateFlag, Money, ReceiptViewer, StatusBadge, useToaster } from './expense-ui';

const MAX_FILE_MB = 10;
const MAX_FILES = 5;
const ACCEPT = 'application/pdf,image/jpeg,image/png,image/heic,.heic,.pdf,.jpg,.jpeg,.png';

interface Linkable {
  trips: { id: string; trip_date: string; base_location: string; status: string; first_visit: string | null; last_visit: string | null; customer_id: string | null; customer_name: string | null }[];
  visits: { id: string; planned_date: string; purpose: string | null; trip_id: string | null; organisation_id: string; organisation_name: string }[];
}

type ItemDraft = {
  id?: string;
  expense_date: string;
  category_id: string;
  amount: string;
  purpose: string;
  customer_id: string;
  project_id: string;
  remarks: string;
  late_submission_reason: string;
  details: Record<string, string>;
  confirm_not_duplicate: boolean;
};

const emptyItem = (defaults: Partial<ItemDraft> = {}): ItemDraft => ({
  expense_date: todayInKolkata(),
  category_id: '',
  amount: '',
  purpose: '',
  customer_id: '',
  project_id: '',
  remarks: '',
  late_submission_reason: '',
  details: {},
  confirm_not_duplicate: false,
  ...defaults,
});

const label = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

export const ClaimForm: React.FC<{ claimId?: string; initialVisitId?: string | null; initialTripId?: string | null }> = ({ claimId, initialVisitId, initialTripId }) => {
  const router = useRouter();
  const { push, Toaster } = useToaster();
  const { categories } = useCategories();
  const [claim, setClaim] = useState<ExpenseClaim | null>(null);
  const [loading, setLoading] = useState(Boolean(claimId));
  const [loadError, setLoadError] = useState<string | null>(null);
  const [linkable, setLinkable] = useState<Linkable>({ trips: [], visits: [] });
  const [customers, setCustomers] = useState<{ id: string; name: string }[]>([]);
  const [projects, setProjects] = useState<{ id: string; code: string; name: string }[]>([]);

  const [header, setHeader] = useState({ title: '', trip_id: initialTripId || '', visit_id: initialVisitId || '', remarks: '' });
  const [headerDirty, setHeaderDirty] = useState(false);
  const [headerErrors, setHeaderErrors] = useState<Record<string, string>>({});
  const [savingHeader, setSavingHeader] = useState(false);

  const [editor, setEditor] = useState<ItemDraft | null>(null);
  const [editorErrors, setEditorErrors] = useState<Record<string, string>>({});
  const [duplicateNotice, setDuplicateNotice] = useState<string | null>(null);
  const [savingItem, setSavingItem] = useState(false);
  const [itemErrors, setItemErrors] = useState<Record<string, Record<string, string>>>({});

  const [conflict, setConflict] = useState(false);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitMessage, setSubmitMessage] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [preview, setPreview] = useState<ExpenseAttachment | null>(null);
  const [uploadingFor, setUploadingFor] = useState<string | null>(null);

  const isNew = !claimId;
  const editorDirty = Boolean(editor && (editor.amount || editor.purpose || editor.category_id));
  const dirty = headerDirty || editorDirty;

  // ------------------------------------------------------------------ loading
  const load = useCallback(async () => {
    if (!claimId) return;
    setLoadError(null);
    try {
      const c = await api.get<ExpenseClaim>(`/expense-claims/${claimId}`);
      setClaim(c);
      setHeader({ title: c.title, trip_id: c.trip_id || '', visit_id: c.visit_id || '', remarks: c.remarks || '' });
      setHeaderDirty(false);
      setConflict(false);
    } catch (e) {
      setLoadError(errorMessage(e, 'Could not load this claim.'));
    } finally {
      setLoading(false);
    }
  }, [claimId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    api.get<Linkable>('/expense-claims/linkable').then(setLinkable).catch(() => undefined);
    api.get('/organisations', { limit: 100 }).then((r: any) => setCustomers((r.data || []).map((o: any) => ({ id: o.id, name: o.name })))).catch(() => setCustomers([]));
    api.get('/projects').then((r: any) => setProjects(r || [])).catch(() => setProjects([]));
  }, []);

  // Warn before leaving with unsaved edits.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const leave = (href: string) => {
    if (dirty && !window.confirm('You have unsaved changes. Leave without saving?')) return;
    router.push(href);
  };

  const categoryById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const items = claim?.items || [];
  const runningTotal = useMemo(() => {
    const saved = items.filter((i) => i.id !== editor?.id).reduce((s, i) => s + i.amount, 0);
    const pending = editor ? Number(editorAmount(editor, categoryById.get(editor.category_id))) || 0 : 0;
    return roundMoney(saved + pending);
  }, [items, editor, categoryById]);

  const selectedTrip = linkable.trips.find((t) => t.id === header.trip_id);
  const selectedVisit = linkable.visits.find((v) => v.id === header.visit_id);
  const defaultCustomer = selectedVisit?.organisation_id || selectedTrip?.customer_id || claim?.visit_organisation_id || '';
  const defaultDate = selectedVisit?.planned_date || selectedTrip?.first_visit || selectedTrip?.trip_date || todayInKolkata();

  // ------------------------------------------------------------------ header
  const saveHeader = async (): Promise<ExpenseClaim | null> => {
    setSavingHeader(true);
    setHeaderErrors({});
    try {
      const body = { title: header.title, trip_id: header.trip_id || null, visit_id: header.visit_id || null, remarks: header.remarks || null };
      const saved = isNew
        ? await api.post<ExpenseClaim>('/expense-claims', body)
        : await api.patch<ExpenseClaim>(`/expense-claims/${claimId}`, { ...body, version: claim?.version });
      setHeaderDirty(false);
      notifyExpensesChanged();
      if (isNew) {
        push('success', `Draft ${saved.claim_number} created. Now add your expense lines.`);
        router.replace(`/expenses/${saved.id}/edit`);
        return saved;
      }
      setClaim(saved);
      push('success', 'Draft saved.');
      return saved;
    } catch (e) {
      if (isConflict(e) && (e as any).data?.code === 'STALE_VERSION') setConflict(true);
      setHeaderErrors(fieldErrors(e));
      if (!Object.keys(fieldErrors(e)).length) push('error', errorMessage(e));
      return null;
    } finally {
      setSavingHeader(false);
    }
  };

  // ------------------------------------------------------------------ items
  const startNewItem = () => {
    setEditor(emptyItem({ expense_date: defaultDate > todayInKolkata() ? todayInKolkata() : defaultDate, customer_id: defaultCustomer }));
    setEditorErrors({});
    setDuplicateNotice(null);
  };

  const startEditItem = (i: ExpenseItem) => {
    const d = i.category_details || {};
    setEditor({
      id: i.id,
      expense_date: i.expense_date,
      category_id: i.category_id,
      amount: String(i.amount),
      purpose: i.purpose,
      customer_id: i.customer_id || '',
      project_id: i.project_id || '',
      remarks: i.remarks || '',
      late_submission_reason: i.late_submission_reason || '',
      details: Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v === null || v === undefined ? '' : String(v)])),
      confirm_not_duplicate: false,
    });
    setEditorErrors({});
    setDuplicateNotice(null);
  };

  const saveItem = async () => {
    if (!editor || !claim) return;
    const cat = categoryById.get(editor.category_id);
    const clientErrors = validateEditor(editor, cat);
    setEditorErrors(clientErrors);
    if (Object.keys(clientErrors).length) return;
    setSavingItem(true);
    try {
      const kind = cat ? CATEGORY_DETAIL_KIND[cat.code] : undefined;
      const details: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(editor.details)) {
        if (v === '' || k === 'nights') continue;
        details[k] = ['km', 'rate_per_km', 'persons'].includes(k) ? Number(v) : v;
      }
      const body = {
        expense_date: editor.expense_date,
        category_id: editor.category_id,
        amount: editorAmount(editor, cat),
        purpose: editor.purpose,
        customer_id: editor.customer_id || null,
        project_id: editor.project_id || null,
        remarks: editor.remarks || null,
        late_submission_reason: editor.late_submission_reason || null,
        category_details: kind ? details : {},
        confirm_not_duplicate: editor.confirm_not_duplicate || undefined,
        version: claim.version,
      };
      const res: any = editor.id
        ? await api.patch(`/expense-claims/${claim.id}/items/${editor.id}`, body)
        : await api.post(`/expense-claims/${claim.id}/items`, body);
      (res.warnings || []).forEach((w: string) => push('success', w));
      push('success', editor.id ? 'Line updated.' : 'Line added.');
      setEditor(null);
      setDuplicateNotice(null);
      await load();
      notifyExpensesChanged();
    } catch (e: any) {
      if (isConflict(e) && e.data?.code === 'STALE_VERSION') setConflict(true);
      if (e?.data?.code === 'DUPLICATE_CONFIRMATION_REQUIRED') setDuplicateNotice(e.data.message);
      const errs = fieldErrors(e);
      setEditorErrors(errs);
      if (!Object.keys(errs).length) push('error', errorMessage(e));
    } finally {
      setSavingItem(false);
    }
  };

  const deleteItem = async (i: ExpenseItem) => {
    if (!claim || !window.confirm(`Remove the line "${i.purpose}"?`)) return;
    try {
      await api.delete(`/expense-claims/${claim.id}/items/${i.id}?version=${claim.version}`);
      push('success', 'Line removed.');
      await load();
      notifyExpensesChanged();
    } catch (e) {
      if (isConflict(e)) setConflict(true);
      push('error', errorMessage(e));
    }
  };

  const uploadFiles = async (item: ExpenseItem, files: FileList | File[]) => {
    const list = Array.from(files);
    if (!list.length) return;
    if (item.attachments.length + list.length > MAX_FILES) {
      push('error', `A line can have at most ${MAX_FILES} receipts.`);
      return;
    }
    for (const f of list) {
      if (f.size > MAX_FILE_MB * 1024 * 1024) {
        push('error', `${f.name} is larger than ${MAX_FILE_MB} MB.`);
        return;
      }
      if (!/\.(pdf|jpe?g|png|heic)$/i.test(f.name) && !/^(application\/pdf|image\/(jpeg|png|heic))$/.test(f.type)) {
        push('error', `${f.name}: only PDF, JPG, PNG or HEIC receipts are accepted.`);
        return;
      }
    }
    setUploadingFor(item.id);
    try {
      for (const f of list) {
        const form = new FormData();
        form.append('file', f);
        const res: any = await api.upload(`/expense-items/${item.id}/attachments`, form);
        (res.warnings || []).forEach((w: string) => push('error', w));
      }
      push('success', list.length > 1 ? `${list.length} receipts attached.` : 'Receipt attached.');
      setItemErrors((prev) => ({ ...prev, [item.id]: { ...prev[item.id], receipt: '' } }));
      await load();
    } catch (e) {
      push('error', fieldErrors(e).file || errorMessage(e));
      await load();
    } finally {
      setUploadingFor(null);
    }
  };

  const removeAttachment = async (a: ExpenseAttachment) => {
    if (!window.confirm(`Remove receipt "${a.file_name}"?`)) return;
    try {
      await api.delete(`/expense-attachments/${a.id}`);
      await load();
    } catch (e) {
      push('error', errorMessage(e));
    }
  };

  // ------------------------------------------------------------------ submit / delete
  const submit = async () => {
    if (!claim) return;
    setSubmitting(true);
    setSubmitMessage(null);
    try {
      await api.post(`/expense-claims/${claim.id}/submit`, { version: claim.version });
      notifyExpensesChanged();
      setConfirmSubmit(false);
      push('success', `${claim.claim_number} submitted for approval.`);
      router.push(`/expenses/${claim.id}`);
    } catch (e: any) {
      setConfirmSubmit(false);
      if (isConflict(e)) setConflict(true);
      const errs = fieldErrors(e);
      const perItem: Record<string, Record<string, string>> = {};
      for (const [k, v] of Object.entries(errs)) {
        const m = /^items\.([0-9a-f-]{36})\.(.+)$/.exec(k);
        if (m) (perItem[m[1]] ||= {})[m[2]] = v;
      }
      setItemErrors(perItem);
      setSubmitMessage(e?.data?.code === 'NO_APPROVER' ? 'No approver configured, contact admin.' : errs.items || errorMessage(e));
    } finally {
      setSubmitting(false);
    }
  };

  const deleteDraft = async () => {
    if (!claim) return;
    try {
      await api.delete(`/expense-claims/${claim.id}`);
      notifyExpensesChanged();
      router.push('/expenses');
    } catch (e) {
      push('error', errorMessage(e));
    }
  };

  // ------------------------------------------------------------------ render
  if (loading) return <PageLoader rows={4} />;
  if (loadError) return <InfoCallout variant="danger" title="Could not open claim">{loadError}</InfoCallout>;
  if (claim && !claim.allowed_actions.includes('edit')) {
    return (
      <InfoCallout variant="info" title={`${claim.claim_number} can no longer be edited`}>
        <div className="space-y-2">
          <p>Claims are locked once submitted. </p>
          <Link href={`/expenses/${claim.id}`}><Button size="sm" variant="secondary">View claim</Button></Link>
        </div>
      </InfoCallout>
    );
  }

  const tripOptions = [{ value: '', label: 'Not linked to a trip' }, ...linkable.trips.map((t) => ({ value: t.id, label: `${t.trip_date.split('-').reverse().join('-')} · ${t.base_location}${t.customer_name ? ` · ${t.customer_name}` : ''}` }))];
  const visitOptions = [
    { value: '', label: 'Not linked to a visit' },
    ...linkable.visits.filter((v) => !header.trip_id || v.trip_id === header.trip_id).map((v) => ({ value: v.id, label: `${v.planned_date.split('-').reverse().join('-')} · ${v.organisation_name}` })),
  ];

  return (
    <div className="space-y-5 pb-4 md:pb-12">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" leftIcon={<ArrowLeft className="h-4 w-4" />} onClick={() => leave(claim ? `/expenses/${claim.id}` : '/expenses')}>
          Back
        </Button>
        {claim && (
          <>
            <span className="font-mono text-sm font-semibold text-[#0F5E63]">{claim.claim_number}</span>
            <StatusBadge status={claim.status} />
          </>
        )}
      </div>

      {conflict && <ConflictCallout onRefresh={load} />}

      {claim?.status === 'clarification_required' && claim.last_reviewer_comment && (
        <InfoCallout variant="warning" title="Your reviewer asked for clarification">
          <p className="text-sm font-medium">“{claim.last_reviewer_comment}”</p>
          <p className="text-xs mt-1">Update the lines or receipts below, then resubmit. Every change is recorded in the claim history.</p>
        </InfoCallout>
      )}

      {/* Header */}
      <Card className="p-4 sm:p-5 space-y-4 overflow-visible">
        <h2 className="font-serif text-lg text-[#14213D]">Claim details</h2>
        <Input
          label="Title / purpose *"
          value={header.title}
          maxLength={200}
          placeholder="e.g. Lucknow CRPF demo trip, 3–5 Oct"
          onChange={(e) => {
            setHeader({ ...header, title: e.target.value });
            setHeaderDirty(true);
          }}
          error={headerErrors.title}
        />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
          <Select
            label="Trip"
            value={header.trip_id}
            options={tripOptions}
            onChange={(e) => {
              setHeader({ ...header, trip_id: e.target.value, visit_id: '' });
              setHeaderDirty(true);
            }}
            error={headerErrors.trip_id}
            helperText="Only your own active trips are listed. Line dates must fall within the trip."
          />
          <Select
            label="Visit"
            value={header.visit_id}
            options={visitOptions}
            onChange={(e) => {
              setHeader({ ...header, visit_id: e.target.value });
              setHeaderDirty(true);
            }}
            error={headerErrors.visit_id}
          />
        </div>
        <Textarea
          label="Remarks"
          value={header.remarks}
          rows={2}
          maxLength={1000}
          onChange={(e) => {
            setHeader({ ...header, remarks: e.target.value });
            setHeaderDirty(true);
          }}
          error={headerErrors.remarks}
        />
        <div className="flex justify-end">
          <Button variant={isNew ? 'primary' : 'secondary'} leftIcon={<Save className="h-4 w-4" />} isLoading={savingHeader} disabled={!isNew && !headerDirty} onClick={saveHeader}>
            {isNew ? 'Save draft & add lines' : 'Save details'}
          </Button>
        </div>
      </Card>

      {/* Lines */}
      {claim && (
        <Card className="p-4 sm:p-5 space-y-4 overflow-visible">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-serif text-lg text-[#14213D]">Expense lines</h2>
            <div className="text-right">
              <div className="text-[11px] uppercase tracking-wide text-[#4A5568]">Running total</div>
              <Money value={runningTotal} className="text-lg font-semibold text-[#14213D]" />
            </div>
          </div>

          {submitMessage && <InfoCallout variant="danger" title="Not submitted yet">{submitMessage}</InfoCallout>}

          {items.length === 0 && !editor && (
            <div className="rounded-[14px] border border-dashed border-[#C9C4B8] p-6 text-center text-sm text-[#4A5568]">
              No lines yet. Add one line per bill — ticket, hotel, cab, meal.
            </div>
          )}

          <div className="space-y-3">
            {items.map((i) =>
              editor?.id === i.id ? (
                <ItemEditor
                  key={i.id}
                  draft={editor}
                  categories={categories}
                  customers={customers}
                  projects={projects}
                  errors={editorErrors}
                  duplicateNotice={duplicateNotice}
                  busy={savingItem}
                  onChange={setEditor}
                  onCancel={() => setEditor(null)}
                  onSave={saveItem}
                />
              ) : (
                <ItemCard
                  key={i.id}
                  item={i}
                  errors={itemErrors[i.id] || {}}
                  uploading={uploadingFor === i.id}
                  onEdit={() => startEditItem(i)}
                  onDelete={() => deleteItem(i)}
                  onUpload={(files) => uploadFiles(i, files)}
                  onPreview={setPreview}
                  onRemoveAttachment={removeAttachment}
                  disabled={Boolean(editor)}
                />
              ),
            )}
            {editor && !editor.id && (
              <ItemEditor
                draft={editor}
                categories={categories}
                customers={customers}
                projects={projects}
                errors={editorErrors}
                duplicateNotice={duplicateNotice}
                busy={savingItem}
                onChange={setEditor}
                onCancel={() => setEditor(null)}
                onSave={saveItem}
              />
            )}
          </div>

          {!editor && (
            <Button variant="outline" fullWidth leftIcon={<Plus className="h-4 w-4" />} onClick={startNewItem}>
              Add expense line
            </Button>
          )}
        </Card>
      )}

      {/* Sticky action bar (thumb-reachable on phones) */}
      {claim && (
        <div className="sticky md:static bottom-0 z-30 -mx-4 md:mx-0 border-t md:border-0 border-[#DCD8CE] bg-white/95 md:bg-transparent backdrop-blur pl-4 pr-20 py-3 md:p-0 flex items-center gap-2 justify-end">
          {claim.allowed_actions.includes('delete') && (
            <Button variant="ghost" leftIcon={<Trash2 className="h-4 w-4" />} onClick={() => setConfirmDelete(true)}>
              <span className="hidden sm:inline">Delete draft</span>
            </Button>
          )}
          <div className="mr-auto md:hidden text-xs text-[#4A5568]">
            {items.length} line(s) · <Money value={runningTotal} className="font-semibold text-[#14213D]" />
          </div>
          <Button
            leftIcon={<Send className="h-4 w-4" />}
            disabled={items.length === 0 || Boolean(editor) || headerDirty}
            title={editor ? 'Save or cancel the open line first' : headerDirty ? 'Save the claim details first' : undefined}
            onClick={() => setConfirmSubmit(true)}
          >
            {claim.status === 'clarification_required' ? 'Resubmit' : 'Submit for approval'}
          </Button>
        </div>
      )}

      <Modal isOpen={confirmSubmit} onClose={() => setConfirmSubmit(false)} title={claim?.status === 'clarification_required' ? 'Resubmit claim?' : 'Submit claim for approval?'} description="Once submitted the claim is locked until your approver acts on it." maxWidth="sm">
        <div className="space-y-4">
          <div className="rounded-[14px] bg-[#FBFAF7] border border-[#ECE9E2] p-4 flex items-center justify-between">
            <span className="text-sm text-[#4A5568]">{items.length} line(s)</span>
            <Money value={claim?.total_claimed ?? 0} className="text-xl font-semibold text-[#14213D]" />
          </div>
          {items.some((i) => i.receipt_missing) && (
            <InfoCallout variant="warning">Some lines still need a receipt — the submission will be rejected until they are attached.</InfoCallout>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmSubmit(false)} disabled={submitting}>Cancel</Button>
            <Button onClick={submit} isLoading={submitting} leftIcon={<Send className="h-4 w-4" />}>Confirm & submit</Button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={confirmDelete} onClose={() => setConfirmDelete(false)} title="Delete this draft?" description="The draft and its lines will be removed. This cannot be undone from the app." maxWidth="sm">
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmDelete(false)}>Keep</Button>
          <Button variant="danger" onClick={deleteDraft}>Delete draft</Button>
        </div>
      </Modal>

      <ReceiptViewer attachment={preview} onClose={() => setPreview(null)} />
      <Toaster />
    </div>
  );
};

// ======================================================================== helpers
function editorAmount(d: ItemDraft, cat?: ExpenseCategory): string {
  if (cat && CATEGORY_DETAIL_KIND[cat.code] === 'conveyance') {
    const km = Number(d.details.km);
    const rate = Number(d.details.rate_per_km);
    if (km > 0 && rate > 0) return roundMoney(km * rate).toFixed(2);
  }
  return d.amount.trim();
}

/** Mirrors the server rules so most mistakes are caught before a round-trip. */
function validateEditor(d: ItemDraft, cat?: ExpenseCategory): Record<string, string> {
  const e: Record<string, string> = {};
  const today = todayInKolkata();
  if (!d.expense_date) e.expense_date = 'Expense date is required.';
  else if (d.expense_date > today) e.expense_date = 'Expense date cannot be in the future.';
  else if (daysBetween(d.expense_date, today) > 90 && d.late_submission_reason.trim().length < 5) {
    e.late_submission_reason = 'Older than 90 days — explain the late submission (min 5 characters).';
  }
  if (!cat) e.category_id = 'Choose a category.';
  if (!d.purpose.trim()) e.purpose = 'Purpose is required.';
  const amount = editorAmount(d, cat);
  if (!/^\d+(\.\d{1,2})?$/.test(amount) || Number(amount) <= 0) e.amount = 'Enter an amount greater than zero (max 2 decimals).';
  else if (Number(amount) > 1_000_000) e.amount = 'Amount cannot exceed ₹10,00,000.00 per item.';
  if (cat) {
    if (cat.requires_customer_or_project && !d.customer_id && !d.project_id) e.customer_id = `${cat.name} must be linked to a customer or a project.`;
    if (cat.requires_remark && !d.remarks.trim()) e.remarks = `Remarks are mandatory for ${cat.name}.`;
    if (cat.max_amount_per_item !== null && Number(amount) > cat.max_amount_per_item) {
      if (cat.cap_is_hard) e.amount = `${cat.name} is capped at ${formatExpenseAmount(cat.max_amount_per_item)} per item.`;
      else if (!d.remarks.trim()) e.remarks = `Above the ${formatExpenseAmount(cat.max_amount_per_item)} limit — add a remark explaining why.`;
    }
    const kind = CATEGORY_DETAIL_KIND[cat.code];
    const det = d.details;
    const need = (k: string, m: string) => {
      if (!String(det[k] || '').trim()) e[`category_details.${k}`] = m;
    };
    if (kind === 'travel') {
      need('from', 'From is required.');
      need('to', 'To is required.');
      need('mode', 'Choose a travel mode.');
    }
    if (kind === 'hotel') {
      need('hotel_name', 'Hotel name is required.');
      need('check_in', 'Check-in date is required.');
      need('check_out', 'Check-out date is required.');
      if (det.check_in && det.check_out && hotelNights(det.check_in, det.check_out) <= 0) e['category_details.check_out'] = 'Check-out must be after check-in.';
    }
    if (kind === 'conveyance') {
      need('from', 'From is required.');
      need('to', 'To is required.');
    }
    if (kind === 'food') {
      need('meal_type', 'Choose a meal type.');
      const p = Number(det.persons);
      if (!Number.isInteger(p) || p < 1 || p > 50) e['category_details.persons'] = 'Persons must be 1–50.';
    }
  }
  return e;
}

// ======================================================================== item editor
const ItemEditor: React.FC<{
  draft: ItemDraft;
  categories: ExpenseCategory[];
  customers: { id: string; name: string }[];
  projects: { id: string; code: string; name: string }[];
  errors: Record<string, string>;
  duplicateNotice: string | null;
  busy: boolean;
  onChange: (d: ItemDraft) => void;
  onCancel: () => void;
  onSave: () => void;
}> = ({ draft, categories, customers, projects, errors, duplicateNotice, busy, onChange, onCancel, onSave }) => {
  const cat = categories.find((c) => c.id === draft.category_id);
  const kind = cat ? CATEGORY_DETAIL_KIND[cat.code] : undefined;
  const set = (patch: Partial<ItemDraft>) => onChange({ ...draft, ...patch });
  const setDetail = (k: string, v: string) => onChange({ ...draft, details: { ...draft.details, [k]: v } });
  const today = todayInKolkata();
  const late = draft.expense_date && daysBetween(draft.expense_date, today) > 90;
  const computed = kind === 'conveyance' ? editorAmount(draft, cat) : null;
  const autoAmount = kind === 'conveyance' && Number(draft.details.km) > 0 && Number(draft.details.rate_per_km) > 0;
  const nights = kind === 'hotel' && draft.details.check_in && draft.details.check_out ? hotelNights(draft.details.check_in, draft.details.check_out) : null;
  const d = (k: string) => errors[`category_details.${k}`];

  return (
    <div className="rounded-[14px] border-2 border-[#0F5E63]/40 bg-[#FBFAF7] p-4 space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-[#14213D]">{draft.id ? 'Edit line' : 'New line'}</span>
        <Button variant="ghost" size="xs" onClick={onCancel} leftIcon={<X className="h-3 w-3" />}>Cancel</Button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-start">
        <Input label="Date *" type="date" max={today} value={draft.expense_date} onChange={(e) => set({ expense_date: e.target.value })} error={errors.expense_date} />
        <Select
          label="Category *"
          value={draft.category_id}
          onChange={(e) => set({ category_id: e.target.value, details: {} })}
          options={[{ value: '', label: 'Choose…' }, ...categories.map((c) => ({ value: c.id, label: c.name }))]}
          error={errors.category_id}
        />
        <Input
          label={autoAmount ? 'Amount (km × rate)' : 'Amount (₹) *'}
          inputMode="decimal"
          value={autoAmount ? computed! : draft.amount}
          readOnly={autoAmount}
          onChange={(e) => set({ amount: e.target.value.replace(/[^\d.]/g, '') })}
          placeholder="0.00"
          className="font-mono"
          error={errors.amount}
          helperText={cat?.max_amount_per_item ? `Limit ${formatExpenseAmount(cat.max_amount_per_item)}${cat.cap_is_hard ? ' (hard cap)' : ''}` : undefined}
        />
      </div>

      {kind === 'travel' && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Input label="From *" value={draft.details.from || ''} onChange={(e) => setDetail('from', e.target.value)} maxLength={120} error={d('from')} />
          <Input label="To *" value={draft.details.to || ''} onChange={(e) => setDetail('to', e.target.value)} maxLength={120} error={d('to')} />
          <Select label="Mode *" value={draft.details.mode || ''} onChange={(e) => setDetail('mode', e.target.value)} options={[{ value: '', label: 'Choose…' }, ...TRAVEL_MODES.map((m) => ({ value: m, label: label(m) }))]} error={d('mode')} />
        </div>
      )}
      {kind === 'hotel' && (
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <Input label="Hotel name *" value={draft.details.hotel_name || ''} onChange={(e) => setDetail('hotel_name', e.target.value)} maxLength={120} error={d('hotel_name')} />
          <Input label="Check-in *" type="date" value={draft.details.check_in || ''} onChange={(e) => setDetail('check_in', e.target.value)} error={d('check_in')} />
          <Input label="Check-out *" type="date" min={draft.details.check_in || undefined} value={draft.details.check_out || ''} onChange={(e) => setDetail('check_out', e.target.value)} error={d('check_out')} />
          <div className="flex flex-col justify-end">
            <span className="text-xs font-semibold text-[#14213D] mb-1.5">Nights</span>
            <span className="h-10 flex items-center font-mono text-sm">{nights !== null && nights > 0 ? nights : '—'}</span>
          </div>
        </div>
      )}
      {kind === 'conveyance' && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Input label="From *" value={draft.details.from || ''} onChange={(e) => setDetail('from', e.target.value)} maxLength={120} error={d('from')} />
          <Input label="To *" value={draft.details.to || ''} onChange={(e) => setDetail('to', e.target.value)} maxLength={120} error={d('to')} />
          <Input label="Distance (km)" inputMode="decimal" value={draft.details.km || ''} onChange={(e) => setDetail('km', e.target.value.replace(/[^\d.]/g, ''))} error={d('km')} />
          <Input label="Rate per km (₹)" inputMode="decimal" value={draft.details.rate_per_km || ''} onChange={(e) => setDetail('rate_per_km', e.target.value.replace(/[^\d.]/g, ''))} error={d('rate_per_km')} />
        </div>
      )}
      {kind === 'food' && (
        <div className="grid grid-cols-2 gap-3">
          <Select label="Meal *" value={draft.details.meal_type || ''} onChange={(e) => setDetail('meal_type', e.target.value)} options={[{ value: '', label: 'Choose…' }, ...MEAL_TYPES.map((m) => ({ value: m, label: label(m) }))]} error={d('meal_type')} />
          <Input label="Persons *" inputMode="numeric" value={draft.details.persons || ''} onChange={(e) => setDetail('persons', e.target.value.replace(/\D/g, ''))} error={d('persons')} />
        </div>
      )}

      <Input label="Purpose *" value={draft.purpose} maxLength={500} placeholder="What was this for?" onChange={(e) => set({ purpose: e.target.value })} error={errors.purpose} />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Select
          label={`Customer${cat?.requires_customer_or_project ? ' (or project) *' : ''}`}
          value={draft.customer_id}
          onChange={(e) => set({ customer_id: e.target.value })}
          options={[{ value: '', label: 'None' }, ...customers.map((c) => ({ value: c.id, label: c.name }))]}
          error={errors.customer_id}
        />
        <Select
          label={`Project${cat?.requires_customer_or_project ? ' (or customer)' : ''}`}
          value={draft.project_id}
          onChange={(e) => set({ project_id: e.target.value })}
          options={[{ value: '', label: 'None' }, ...projects.map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` }))]}
          error={errors.project_id}
        />
      </div>

      <Textarea
        label={`Remarks${cat?.requires_remark ? ' *' : ''}`}
        rows={2}
        maxLength={1000}
        value={draft.remarks}
        onChange={(e) => set({ remarks: e.target.value })}
        error={errors.remarks}
      />

      {late && (
        <Textarea
          label="Late submission reason *"
          rows={2}
          maxLength={1000}
          value={draft.late_submission_reason}
          onChange={(e) => set({ late_submission_reason: e.target.value })}
          error={errors.late_submission_reason}
          helperText="This expense is older than 90 days and will be flagged to your approver."
        />
      )}

      {duplicateNotice && (
        <InfoCallout variant="warning" title="Possible duplicate">
          <p className="text-sm">{duplicateNotice}</p>
          <div className="mt-2">
            <Checkbox
              label="I confirm this is not a duplicate"
              checked={draft.confirm_not_duplicate}
              onChange={(e) => set({ confirm_not_duplicate: e.target.checked })}
            />
          </div>
          {errors.confirm_not_duplicate && !draft.confirm_not_duplicate && <p className="text-xs text-[#881337] mt-1">{errors.confirm_not_duplicate}</p>}
        </InfoCallout>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button onClick={onSave} isLoading={busy} leftIcon={<Save className="h-4 w-4" />}>
          {draft.id ? 'Save line' : 'Add line'}
        </Button>
      </div>
    </div>
  );
};

// ======================================================================== saved line
const ItemCard: React.FC<{
  item: ExpenseItem;
  errors: Record<string, string>;
  uploading: boolean;
  disabled: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onUpload: (files: FileList | File[]) => void;
  onPreview: (a: ExpenseAttachment) => void;
  onRemoveAttachment: (a: ExpenseAttachment) => void;
}> = ({ item, errors, uploading, disabled, onEdit, onDelete, onUpload, onPreview, onRemoveAttachment }) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const det = item.category_details || {};
  const detailText =
    item.category_code === 'TRAVEL'
      ? `${det.from} → ${det.to} · ${label(det.mode || '')}`
      : item.category_code === 'HOTEL'
        ? `${det.hotel_name} · ${det.nights} night(s)`
        : item.category_code === 'LOCAL_CONVEYANCE'
          ? `${det.from} → ${det.to}${det.km ? ` · ${det.km} km × ₹${det.rate_per_km}` : ''}`
          : item.category_code === 'FOOD'
            ? `${label(det.meal_type || '')} · ${det.persons} person(s)`
            : null;
  const hasErrors = Object.values(errors).some(Boolean);

  return (
    <div
      className={`rounded-[14px] border bg-white p-4 space-y-3 ${hasErrors ? 'border-[#881337]/50' : 'border-[#DCD8CE]'} ${drag ? 'ring-2 ring-[#0F5E63]/30' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        if (e.dataTransfer.files?.length) onUpload(e.dataTransfer.files);
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <DateText value={item.expense_date} className="text-xs text-[#4A5568]" />
            <Badge variant="outline" size="sm">{item.category_name}</Badge>
            {item.is_late && <LateFlag />}
            {item.duplicate_flag && (
              <Badge variant="warning" size="sm" className="gap-1"><Copy className="h-3 w-3" /> Duplicate flagged</Badge>
            )}
          </div>
          <div className="font-medium text-[#14213D] break-words">{item.purpose}</div>
          {detailText && <div className="text-xs text-[#4A5568]">{detailText}</div>}
          {(item.customer_name || item.project_code) && (
            <div className="text-xs text-[#4A5568]">{[item.customer_name, item.project_code && `${item.project_code} ${item.project_name || ''}`].filter(Boolean).join(' · ')}</div>
          )}
          {item.remarks && <div className="text-xs text-[#4A5568] italic">“{item.remarks}”</div>}
        </div>
        <div className="text-right shrink-0">
          <Money value={item.amount} className="font-semibold text-[#14213D]" />
          <div className="flex justify-end gap-1 mt-1">
            <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Edit line" onClick={onEdit} disabled={disabled}><Pencil className="h-4 w-4" /></Button>
            <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Remove line" onClick={onDelete} disabled={disabled}><Trash2 className="h-4 w-4" /></Button>
          </div>
        </div>
      </div>

      {Object.entries(errors).filter(([, v]) => v).map(([k, v]) => (
        <p key={k} className="text-xs text-[#881337] flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> {v}</p>
      ))}

      <div className="flex flex-wrap items-center gap-2">
        {item.attachments.map((a) => (
          <span key={a.id} className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs ${a.duplicate_of_attachment_id ? 'border-[#9A3412]/40 bg-[#FBEBDD]' : 'border-[#DCD8CE] bg-[#FBFAF7]'}`}>
            <button type="button" className="inline-flex items-center gap-1 hover:underline" onClick={() => onPreview(a)}>
              {a.mime_type === 'application/pdf' ? <FileText className="h-3.5 w-3.5" /> : <ImageIcon className="h-3.5 w-3.5" />}
              <span className="max-w-[140px] truncate">{a.file_name}</span>
            </button>
            <button type="button" aria-label={`Remove ${a.file_name}`} className="text-[#8A8578] hover:text-[#881337]" onClick={() => onRemoveAttachment(a)}>
              <X className="h-3.5 w-3.5" />
            </button>
          </span>
        ))}
        {item.receipt_missing && (
          <Badge variant="urgent" size="sm" className="gap-1"><Paperclip className="h-3 w-3" /> Receipt required</Badge>
        )}
        <input ref={fileRef} type="file" accept={ACCEPT} multiple className="hidden" onChange={(e) => e.target.files && onUpload(e.target.files)} />
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => e.target.files && onUpload(e.target.files)} />
        {item.attachments.length < MAX_FILES && (
          <span className="inline-flex gap-1 ml-auto">
            <Button size="xs" variant="secondary" isLoading={uploading} leftIcon={<Upload className="h-3 w-3" />} onClick={() => fileRef.current?.click()}>
              Receipt
            </Button>
            <Button size="xs" variant="secondary" disabled={uploading} leftIcon={<Camera className="h-3 w-3" />} onClick={() => cameraRef.current?.click()} className="sm:hidden">
              Photo
            </Button>
          </span>
        )}
      </div>
      <p className="hidden sm:block text-[11px] text-[#8A8578]">Drop PDF / JPG / PNG / HEIC receipts here · max {MAX_FILE_MB} MB each, {MAX_FILES} per line</p>
    </div>
  );
};
