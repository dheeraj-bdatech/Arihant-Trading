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
  ArrowLeftRight,
  ArrowRight,
  Building2,
  Calendar,
  Camera,
  CircleCheck,
  Circle,
  Copy,
  FileText,
  ImageIcon,
  IndianRupee,
  Info,
  MapPin,
  Minus,
  Paperclip,
  Pencil,
  Plus,
  Route,
  Save,
  Send,
  StickyNote,
  Trash2,
  Upload,
  Users,
  X,
} from 'lucide-react';
import { Badge, Button, Card, Checkbox, InfoCallout, Modal, PageLoader, ScrollStrip } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { canRead } from '@/lib/module-access';
import {
  CATEGORY_DETAIL_KIND,
  MEAL_TYPES,
  TRAVEL_MODES,
  formatExpenseAmount,
  hotelNights,
  roundMoney,
} from '@arihant/shared';
import { istToday, isIstFutureDate } from '@/lib/ist-date';
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
import {
  ChipGroup,
  FieldTile,
  RevealButton,
  StepCard,
  Stepper,
  TileInput,
  TileSelect,
  TileTextarea,
  categoryIcon,
  travelModeIcon,
  type StepState,
} from './booking-fields';

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
  expense_date: istToday(),
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

export interface ClaimFormProps {
  claimId?: string;
  initialVisitId?: string | null;
  initialTripId?: string | null;
  /**
   * 'modal': rendered inside a popup — no hero or side panel; saving the trip details keeps the
   * draft open in the same popup, and submit / delete / cancel close it (onDone gets the message)
   * instead of navigating. 'page' (default): the full page.
   */
  variant?: 'page' | 'modal';
  onClose?: () => void;
  onDone?: (message: string) => void;
  /** Lets the popup ask before an outside click / Esc throws away unsaved input. */
  onDirtyChange?: (dirty: boolean) => void;
}

export const ClaimForm: React.FC<ClaimFormProps> = ({ claimId: claimIdProp, initialVisitId, initialTripId, variant = 'page', onClose, onDone, onDirtyChange }) => {
  const modal = variant === 'modal';
  // In the popup a new draft keeps its id here instead of moving to /expenses/:id/edit.
  const [claimId, setClaimId] = useState(claimIdProp);
  const router = useRouter();
  const { push, Toaster } = useToaster();
  const { categories } = useCategories();
  const [claim, setClaim] = useState<ExpenseClaim | null>(null);
  const [loading, setLoading] = useState(Boolean(claimId));
  const [loadError, setLoadError] = useState<string | null>(null);
  const [linkable, setLinkable] = useState<Linkable>({ trips: [], visits: [] });
  // Linking a customer needs read access to the customer master (Accounts has none: it links a project instead).
  const { user } = useAuth();
  const canLinkCustomer = canRead(user?.role, 'organisations');
  const [projects, setProjects] = useState<{ id: string; code: string; name: string }[]>([]);

  const [header, setHeader] = useState({ title: '', trip_id: initialTripId || '', visit_id: initialVisitId || '', remarks: '' });
  const [headerDirty, setHeaderDirty] = useState(false);
  const [editingHeader, setEditingHeader] = useState(!claimId);
  const [showHeaderNote, setShowHeaderNote] = useState(false);
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

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const leave = (href: string) => {
    if (dirty && !window.confirm('You have unsaved changes. Leave without saving?')) return;
    if (modal && onClose) onClose();
    else router.push(href);
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
  // Names of customers already linked (saved items, trips, visits): the picker searches the server, so a linked
  // customer may not be in the current results but must still show by name.
  const customerNames = useMemo(() => {
    const names: Record<string, string> = {};
    for (const t of linkable.trips) if (t.customer_id && t.customer_name) names[t.customer_id] = t.customer_name;
    for (const v of linkable.visits) names[v.organisation_id] = v.organisation_name;
    for (const i of items) if (i.customer_id && i.customer_name) names[i.customer_id] = i.customer_name;
    return names;
  }, [linkable, items]);
  const defaultDate = selectedVisit?.planned_date || selectedTrip?.first_visit || selectedTrip?.trip_date || istToday();

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
        if (modal) {
          setHeaderDirty(false);
          setEditingHeader(false);
          setLoading(true);
          setClaimId(saved.id);
        } else router.replace(`/expenses/${saved.id}/edit`);
        return saved;
      }
      setClaim(saved);
      setEditingHeader(false);
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
  const cancelHeaderEdit = () => {
    if (claim) setHeader({ title: claim.title, trip_id: claim.trip_id || '', visit_id: claim.visit_id || '', remarks: claim.remarks || '' });
    setHeaderDirty(false);
    setHeaderErrors({});
    setEditingHeader(false);
  };

  const startNewItem = (category_id = '') => {
    setEditor(emptyItem({ category_id, details: detailsFor(categoryById.get(category_id)), expense_date: isIstFutureDate(defaultDate) ? istToday() : defaultDate, customer_id: defaultCustomer }));
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
    const clientErrors = validateEditor(editor, cat, canLinkCustomer);
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
      if (modal) {
        onDone?.(`${claim.claim_number} submitted for approval.`);
        onClose?.();
      } else {
        push('success', `${claim.claim_number} submitted for approval.`);
        router.push(`/expenses/${claim.id}`);
      }
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
      if (modal) {
        onDone?.(`${claim.claim_number} deleted.`);
        onClose?.();
      } else router.push('/expenses');
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
  const tripText = header.trip_id
    ? tripOptions.find((o) => o.value === header.trip_id)?.label ||
      [claim?.trip_date?.split('-').reverse().join('-'), claim?.trip_location].filter(Boolean).join(' · ') ||
      'Linked trip'
    : 'Not linked';
  const visitText = header.visit_id
    ? visitOptions.find((o) => o.value === header.visit_id)?.label ||
      [claim?.visit_date?.split('-').reverse().join('-'), claim?.visit_organisation_name].filter(Boolean).join(' · ') ||
      'Linked visit'
    : 'Not linked';

  const setH = (patch: Partial<typeof header>) => {
    setHeader({ ...header, ...patch });
    setHeaderDirty(true);
  };
  const noteOpen = showHeaderNote || Boolean(header.remarks) || Boolean(headerErrors.remarks);

  // Breakdown for the summary panel; the line being edited shows as its own row.
  const breakdown = new Map<string, { code: string; name: string; count: number; total: number }>();
  for (const i of items) {
    if (i.id === editor?.id) continue;
    const row = breakdown.get(i.category_id) || { code: i.category_code, name: i.category_name, count: 0, total: 0 };
    row.count += 1;
    row.total = roundMoney(row.total + i.amount);
    breakdown.set(i.category_id, row);
  }
  const editorCat = editor ? categoryById.get(editor.category_id) : undefined;
  const pendingAmount = editor ? Number(editorAmount(editor, editorCat)) || 0 : 0;
  const receiptsMissing = items.filter((i) => i.receipt_missing).length;

  const step1: StepState = claim && !editingHeader ? 'done' : 'active';
  const step2: StepState = !claim ? 'pending' : items.length && !editor ? 'done' : 'active';
  const step3: StepState = claim && items.length && !editor && !headerDirty ? 'active' : 'pending';
  const canSubmit = Boolean(claim) && items.length > 0 && !editor && !headerDirty;
  const submitBlocker = editor
    ? 'Save or cancel the open expense first'
    : headerDirty
      ? 'Save the trip details first'
      : items.length === 0
        ? 'Add at least one expense'
        : undefined;
  const submitLabel = claim?.status === 'clarification_required' ? 'Resubmit' : 'Submit for approval';
  // Phone action bars are narrow; the summary card and the confirm dialog keep the full wording.
  const submitLabelShort = claim?.status === 'clarification_required' ? 'Resubmit' : 'Submit';

  const checklist = [
    { done: Boolean(claim) && !headerDirty, text: 'Trip details saved' },
    { done: items.length > 0, text: items.length ? `${items.length} expense${items.length === 1 ? '' : 's'} added` : 'Add at least one expense' },
    {
      done: items.length > 0 && receiptsMissing === 0,
      text: receiptsMissing ? `${receiptsMissing} receipt${receiptsMissing === 1 ? '' : 's'} still needed` : 'All required receipts attached',
    },
    ...(editor ? [{ done: false, text: 'Finish the open expense' }] : []),
  ];

  return (
    <div className={modal ? 'space-y-5' : 'space-y-5'}>
      {modal && claim && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-[14px] border border-[#ECE9E2] bg-[#FBFAF7] px-3 py-2.5 sm:px-4 sm:py-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="break-all font-mono text-xs font-semibold text-[#0F5E63]">{claim.claim_number}</span>
            <StatusBadge status={claim.status} />
          </div>
          {/* ml-auto: when the row wraps on a phone the total still sits on the right */}
          <div className="ml-auto text-right">
            <span className="mr-2 text-xs text-[#4A5568]">
              {items.length} expense{items.length === 1 ? '' : 's'}
            </span>
            <Money value={runningTotal} className="text-lg font-semibold text-[#14213D]" />
          </div>
        </div>
      )}

      {/* Hero: who / what / where, plus progress through the three steps */}
      {!modal && (
      <section className="relative overflow-hidden rounded-[14px] bg-[#14213D] text-white">
        <div aria-hidden className="pointer-events-none absolute -right-20 -top-28 h-72 w-72 rounded-full bg-[#0F5E63]/50 blur-3xl" />
        <div className="relative space-y-5 p-4 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 flex-1 space-y-1.5">
              {claim && (
                <button
                  type="button"
                  onClick={() => leave(`/expenses/${claim.id}`)}
                  className="inline-flex items-center gap-1 rounded text-xs font-medium text-white/70 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                >
                  <ArrowLeft className="h-3.5 w-3.5" /> Back to claim
                </button>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-[#F2B872]">{claim ? claim.claim_number : 'New expense claim'}</span>
                {claim && (
                  <span className="rounded-full bg-white">
                    <StatusBadge status={claim.status} />
                  </span>
                )}
              </div>
              <h2 className="break-words font-serif text-2xl leading-tight sm:text-[28px]">{claim?.title || 'Where did you travel?'}</h2>
              <p className="max-w-xl text-sm text-white/70">
                {claim
                  ? [header.trip_id && tripText, header.visit_id && visitText].filter(Boolean).join('  ·  ') || 'Not linked to a trip or visit'
                  : 'Three quick steps: trip details, one entry per bill, then submit for approval.'}
              </p>
            </div>
            {claim && (
              <div className="text-right">
                <div className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-white/60">Total claimed</div>
                <Money value={runningTotal} className="text-2xl font-semibold text-white sm:text-3xl" />
                <div className="text-xs text-white/60">
                  {items.length} expense{items.length === 1 ? '' : 's'}
                </div>
              </div>
            )}
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.06] px-3 py-3 sm:px-4">
            <Stepper
              steps={[
                { label: 'Trip details', state: step1 },
                { label: 'Add expenses', state: step2 },
                { label: 'Review & submit', state: step3 },
              ]}
            />
          </div>
        </div>
      </section>
      )}

      {conflict && <ConflictCallout onRefresh={load} />}

      {claim?.status === 'clarification_required' && claim.last_reviewer_comment && (
        <InfoCallout variant="warning" title="Your reviewer asked for clarification">
          <p className="text-sm font-medium">“{claim.last_reviewer_comment}”</p>
          <p className="text-xs mt-1">Update the expenses or receipts below, then resubmit. Every change is recorded in the claim history.</p>
        </InfoCallout>
      )}

      <div className={`grid grid-cols-1 items-start gap-5 ${modal ? '' : 'lg:grid-cols-[minmax(0,1fr)_340px]'}`}>
        <div className="min-w-0 space-y-5">
          {/* Step 1 — trip details */}
          <StepCard
            n={1}
            state={step1}
            title="Trip details"
            description={editingHeader ? 'Name the claim and link the trip or visit it belongs to.' : undefined}
            action={
              !editingHeader && claim ? (
                <Button size="sm" variant="secondary" leftIcon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setEditingHeader(true)} disabled={Boolean(editor)}>
                  Modify
                </Button>
              ) : undefined
            }
          >
            {editingHeader ? (
              <div className="space-y-3">
                <FieldTile label="Claim title" htmlFor="claim-title" required error={headerErrors.title} hint="Place and dates work best, so your approver recognises it.">
                  <TileInput
                    id="claim-title"
                    value={header.title}
                    maxLength={200}
                    autoFocus={isNew}
                    placeholder="e.g. Lucknow CRPF demo trip, 3–5 Oct"
                    className="text-lg"
                    onChange={(e) => setH({ title: e.target.value })}
                  />
                </FieldTile>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <FieldTile label="Trip" icon={<Route />} error={headerErrors.trip_id} hint="Only your active trips. Expense dates must fall within the trip.">
                    <TileSelect value={header.trip_id} options={tripOptions} onChange={(v) => setH({ trip_id: v, visit_id: '' })} />
                  </FieldTile>
                  <FieldTile label="Customer visit" icon={<MapPin />} error={headerErrors.visit_id}>
                    <TileSelect value={header.visit_id} options={visitOptions} onChange={(v) => setH({ visit_id: v })} />
                  </FieldTile>
                </div>
                {noteOpen ? (
                  <FieldTile label="Note for your approver" htmlFor="claim-remarks" icon={<StickyNote />} error={headerErrors.remarks}>
                    <TileTextarea
                      id="claim-remarks"
                      rows={2}
                      maxLength={1000}
                      value={header.remarks}
                      placeholder="Anything your approver should know about this trip"
                      onChange={(e) => setH({ remarks: e.target.value })}
                    />
                  </FieldTile>
                ) : (
                  <RevealButton onClick={() => setShowHeaderNote(true)}>Add a note for your approver</RevealButton>
                )}
                {/* Phones: full-width buttons, primary on top; from sm the right-aligned row. */}
                <div className="flex flex-col-reverse gap-2 border-t border-[#ECE9E2] pt-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
                  {!isNew && (
                    <Button variant="ghost" className="w-full sm:w-auto" onClick={cancelHeaderEdit} disabled={savingHeader}>
                      Cancel
                    </Button>
                  )}
                  <Button
                    size="lg"
                    className="w-full sm:w-auto"
                    leftIcon={isNew ? undefined : <Save className="h-4 w-4" />}
                    rightIcon={isNew ? <ArrowRight className="h-4 w-4" /> : undefined}
                    isLoading={savingHeader}
                    disabled={!isNew && !headerDirty}
                    onClick={saveHeader}
                  >
                    {isNew ? 'Continue to add expenses' : 'Save trip details'}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <FieldTile label="Trip" icon={<Route />} readOnly>
                    <div className="mt-0.5 h-7 truncate text-[15px] leading-7 font-semibold text-[#14213D]">{tripText}</div>
                  </FieldTile>
                  <FieldTile label="Customer visit" icon={<MapPin />} readOnly>
                    <div className="mt-0.5 h-7 truncate text-[15px] leading-7 font-semibold text-[#14213D]">{visitText}</div>
                  </FieldTile>
                </div>
                {header.remarks && (
                  <p className="flex items-start gap-1.5 text-[13px] text-[#4A5568]">
                    <StickyNote className="mt-0.5 h-3.5 w-3.5 shrink-0" /> <span className="break-words">{header.remarks}</span>
                  </p>
                )}
              </div>
            )}
          </StepCard>

          {/* Step 2 — expenses */}
          <StepCard
            n={2}
            state={step2}
            title="Expenses"
            description={claim ? 'One entry per bill — ticket, hotel, cab or meal. Attach the receipt after saving.' : 'Unlocks once the trip details are saved.'}
            action={
              items.length ? (
                <span className="font-mono text-xs text-[#4A5568]">
                  {items.length} {items.length === 1 ? 'entry' : 'entries'}
                </span>
              ) : undefined
            }
          >
            {claim && (
              <div className="space-y-3">
                {submitMessage && <InfoCallout variant="danger" title="Not submitted yet">{submitMessage}</InfoCallout>}
                {items.map((i) =>
                  editor?.id === i.id ? (
                    <ItemEditor
                      key={i.id}
                      draft={editor}
                      categories={categories}
                      canLinkCustomer={canLinkCustomer}
                      customerNames={customerNames}
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
                    canLinkCustomer={canLinkCustomer}
                    customerNames={customerNames}
                    projects={projects}
                    errors={editorErrors}
                    duplicateNotice={duplicateNotice}
                    busy={savingItem}
                    onChange={setEditor}
                    onCancel={() => setEditor(null)}
                    onSave={saveItem}
                  />
                )}
                {!editor && <CategoryPicker categories={categories} hasItems={items.length > 0} onPick={startNewItem} />}
              </div>
            )}
          </StepCard>
        </div>

        {/* Summary panel (fare-summary style) */}
        <aside className={modal ? 'space-y-4' : 'space-y-4 lg:sticky lg:top-20'}>
          <Card className="overflow-hidden">
            <div className="border-b border-[#ECE9E2] bg-[#FBFAF7] px-3 py-3 sm:px-4">
              <h3 className="font-serif text-base text-[#14213D]">Claim summary</h3>
            </div>
            <div className="space-y-4 p-3 sm:p-4">
              {breakdown.size || editor ? (
                <ul className="space-y-2.5">
                  {[...breakdown.values()].map((b) => (
                    <li key={b.name} className="flex items-center gap-2.5 text-sm">
                      <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#E3EFEE] text-[#0F5E63]">{categoryIcon(b.code, 'h-3.5 w-3.5')}</span>
                      <span className="min-w-0 flex-1 truncate text-[#14213D]">
                        {b.name} <span className="text-xs text-[#4A5568]">× {b.count}</span>
                      </span>
                      <Money value={b.total} className="text-sm text-[#14213D]" />
                    </li>
                  ))}
                  {editor && (
                    <li className="flex items-center gap-2.5 text-sm">
                      <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-dashed border-[#0F5E63]/50 text-[#0F5E63]">
                        <Pencil className="h-3.5 w-3.5" />
                      </span>
                      <span className="min-w-0 flex-1 truncate italic text-[#4A5568]">{editor.id ? 'Editing entry' : 'New entry'} (unsaved)</span>
                      <Money value={pendingAmount} className="text-sm text-[#4A5568]" />
                    </li>
                  )}
                </ul>
              ) : (
                <p className="text-sm text-[#4A5568]">{claim ? 'No expenses added yet.' : 'Your expenses will add up here.'}</p>
              )}
              <div className="flex items-end justify-between border-t border-dashed border-[#DCD8CE] pt-3">
                <span className="text-sm font-semibold text-[#14213D]">Total claimed</span>
                <Money value={runningTotal} className="text-xl font-semibold text-[#14213D]" />
              </div>
              <ul className="space-y-1.5 rounded-lg bg-[#FBFAF7] p-3">
                {checklist.map((c) => (
                  <li key={c.text} className={`flex items-center gap-2 text-[13px] ${c.done ? 'text-[#14213D]' : 'text-[#4A5568]'}`}>
                    {c.done ? <CircleCheck className="h-4 w-4 shrink-0 text-[#0F5E63]" /> : <Circle className="h-4 w-4 shrink-0 text-[#C9C4B8]" />}
                    {c.text}
                  </li>
                ))}
              </ul>
              {claim && (
                // Below the breakpoint the sticky action bar (page: < lg, popup: < sm) carries Submit instead.
                <div className={modal ? 'hidden space-y-2 sm:block' : 'hidden space-y-2 lg:block'}>
                  <Button fullWidth size="lg" leftIcon={<Send className="h-4 w-4" />} disabled={!canSubmit} title={submitBlocker} onClick={() => setConfirmSubmit(true)}>
                    {submitLabel}
                  </Button>
                  {submitBlocker && <p className="text-center text-xs text-[#4A5568]">{submitBlocker}</p>}
                </div>
              )}
              {claim?.allowed_actions.includes('delete') && (
                <Button variant="ghost" size="sm" fullWidth leftIcon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => setConfirmDelete(true)} className="text-[#881337] hover:text-[#881337]">
                  Delete draft
                </Button>
              )}
            </div>
          </Card>
          <div className={`space-y-2 rounded-[14px] border border-[#DCD8CE] bg-[#FBFAF7] p-4 text-xs text-[#4A5568] ${modal ? 'hidden' : ''}`}>
            <div className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[#14213D]">
              <Info className="h-3.5 w-3.5 text-[#0F5E63]" /> Good to know
            </div>
            <p>Receipts: PDF, JPG, PNG or HEIC, up to {MAX_FILE_MB} MB each and {MAX_FILES} per expense.</p>
            <p>Bills older than 90 days need a reason and are flagged to your approver.</p>
            <p>Future-dated expenses cannot be submitted.</p>
          </div>
        </aside>
      </div>

      {/* Sticky action bar (thumb-reachable on phones and tablets). Phones: count over total and a short
          label, so the button and the figures both fit between the corner buttons. */}
      {claim && !modal && (
        <div className="sticky bottom-0 z-30 -mx-4 flex items-center gap-2 border-t border-[#DCD8CE] bg-white/95 py-3 pl-[4.5rem] pr-20 backdrop-blur lg:hidden">
          <div className="mr-auto min-w-0 text-xs text-[#4A5568]">
            <span className="block sm:inline">
              {items.length} expense{items.length === 1 ? '' : 's'}
            </span>
            <span className="hidden sm:inline"> · </span>
            <Money value={runningTotal} className="block font-semibold text-[#14213D] sm:inline" />
          </div>
          <Button leftIcon={<Send className="h-4 w-4" />} disabled={!canSubmit} title={submitBlocker} onClick={() => setConfirmSubmit(true)}>
            <span className="sm:hidden">{submitLabelShort}</span>
            <span className="hidden sm:inline">{submitLabel}</span>
          </Button>
        </div>
      )}

      {/* Popup on a phone: Submit pinned to the bottom of the sheet (the summary card's button shows from sm).
          Hidden while an expense is open — its own Add / Save button is the action then. */}
      {claim && modal && !editor && (
        <div className="sticky -bottom-4 z-20 -mx-4 -mb-4 flex items-center gap-3 border-t border-[#DCD8CE] bg-white px-4 py-3 sm:hidden">
          <div className="min-w-0 flex-1 text-xs leading-tight text-[#4A5568]">
            <span className="block">{submitBlocker || `${items.length} expense${items.length === 1 ? '' : 's'}`}</span>
            <Money value={runningTotal} className="text-base font-semibold text-[#14213D]" />
          </div>
          <Button leftIcon={<Send className="h-4 w-4" />} disabled={!canSubmit} onClick={() => setConfirmSubmit(true)} className="shrink-0">
            {submitLabelShort}
          </Button>
        </div>
      )}

      <Modal isOpen={confirmSubmit} onClose={() => setConfirmSubmit(false)} title={claim?.status === 'clarification_required' ? 'Resubmit claim?' : 'Submit claim for approval?'} description="Once submitted the claim is locked until your approver acts on it." maxWidth="sm">
        <div className="space-y-4">
          <div className="rounded-[14px] bg-[#FBFAF7] border border-[#ECE9E2] p-3 sm:p-4 flex items-center justify-between gap-3">
            <span className="text-sm text-[#4A5568]">{items.length} expense{items.length === 1 ? '' : 's'}</span>
            <Money value={claim?.total_claimed ?? 0} className="text-xl font-semibold text-[#14213D]" />
          </div>
          {items.some((i) => isIstFutureDate(i.expense_date)) && (
            <InfoCallout variant="danger">Some expenses are dated after today ({istToday().split('-').reverse().join('-')}). Fix their dates — future-dated expenses cannot be submitted.</InfoCallout>
          )}
          {items.some((i) => i.receipt_missing) && (
            <InfoCallout variant="warning">Some expenses still need a receipt — the submission will be rejected until they are attached.</InfoCallout>
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" className="w-full sm:w-auto" onClick={() => setConfirmSubmit(false)} disabled={submitting}>Cancel</Button>
            <Button className="w-full sm:w-auto" onClick={submit} isLoading={submitting} leftIcon={<Send className="h-4 w-4" />}>Confirm & submit</Button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={confirmDelete} onClose={() => setConfirmDelete(false)} title="Delete this draft?" description="The draft and its expenses will be removed. This cannot be undone from the app." maxWidth="sm">
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" className="w-full sm:w-auto" onClick={() => setConfirmDelete(false)}>Keep</Button>
          <Button variant="danger" className="w-full sm:w-auto" onClick={deleteDraft}>Delete draft</Button>
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

/** Sensible starting details when a category is picked (meals default to one person). */
function detailsFor(cat?: ExpenseCategory): Record<string, string> {
  return cat && CATEGORY_DETAIL_KIND[cat.code] === 'food' ? { persons: '1' } : {};
}

/** Mirrors the server rules so most mistakes are caught before a round-trip. */
function validateEditor(d: ItemDraft, cat?: ExpenseCategory, canLinkCustomer = true): Record<string, string> {
  const e: Record<string, string> = {};
  const today = istToday();
  if (!d.expense_date) e.expense_date = 'Expense date is required.';
  else if (isIstFutureDate(d.expense_date)) e.expense_date = 'Expense date cannot be in the future.';
  else if (daysBetween(d.expense_date, today) > 90 && d.late_submission_reason.trim().length < 5) {
    e.late_submission_reason = 'Older than 90 days — explain the late submission (min 5 characters).';
  }
  if (!cat) e.category_id = 'Choose a category.';
  if (!d.purpose.trim()) e.purpose = 'Purpose is required.';
  const amount = editorAmount(d, cat);
  if (!/^\d+(\.\d{1,2})?$/.test(amount) || Number(amount) <= 0) e.amount = 'Enter an amount greater than zero (max 2 decimals).';
  else if (Number(amount) > 1_000_000) e.amount = 'Amount cannot exceed ₹10,00,000.00 per item.';
  if (cat) {
    if (cat.requires_customer_or_project && !d.customer_id && !d.project_id) {
      if (canLinkCustomer) e.customer_id = `${cat.name} must be linked to a customer or a project.`;
      else e.project_id = `${cat.name} must be linked to a project.`;
    }
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
      if (det.check_in && isIstFutureDate(det.check_in)) e['category_details.check_in'] = 'Check-in date cannot be in the future.';
      if (det.check_out && isIstFutureDate(det.check_out)) e['category_details.check_out'] = 'Check-out date cannot be in the future — claim the stay after you check out.';
      else if (det.check_in && det.check_out && hotelNights(det.check_in, det.check_out) <= 0) e['category_details.check_out'] = 'Check-out must be after check-in.';
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

// ======================================================================== category picker
/** Big icon tiles — the first decision for every expense, like choosing Flights / Hotels / Cabs. */
const CategoryPicker: React.FC<{ categories: ExpenseCategory[]; hasItems: boolean; onPick: (categoryId: string) => void }> = ({ categories, hasItems, onPick }) => (
  <div className="rounded-[14px] border border-dashed border-[#C9C4B8] bg-[#FBFAF7] p-3 sm:p-4">
    <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[#14213D]">
      <Plus className="h-4 w-4 text-[#0F5E63]" />
      {hasItems ? 'Add another expense' : 'What did you spend on?'}
    </div>
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
      {categories.map((c) => (
        <button
          key={c.id}
          type="button"
          onClick={() => onPick(c.id)}
          className="group flex min-h-[92px] flex-col items-start gap-2 rounded-xl border border-[#DCD8CE] bg-white p-3 text-left transition-all hover:-translate-y-px hover:border-[#0F5E63] hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5E63]/30"
        >
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-[#E3EFEE] text-[#0F5E63] transition-colors group-hover:bg-[#0F5E63] group-hover:text-white">
            {categoryIcon(c.code)}
          </span>
          <span className="text-[13px] font-semibold leading-tight text-[#14213D]">{c.name}</span>
          {c.max_amount_per_item !== null && (
            <span className="-mt-1 font-mono text-[10.5px] text-[#4A5568]">up to {formatExpenseAmount(c.max_amount_per_item)}</span>
          )}
        </button>
      ))}
    </div>
    {!hasItems && <p className="mt-3 text-xs text-[#4A5568]">Add one entry per bill. You can attach the receipt right after saving it.</p>}
  </div>
);

// ======================================================================== item editor
/** From ⇄ To pair shared by travel and local conveyance. */
const RouteFields: React.FC<{
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
  errors: { from?: string; to?: string };
}> = ({ from, to, onChange, errors }) => (
  <div className="relative grid grid-cols-1 gap-3 sm:grid-cols-2">
    <FieldTile label="From" htmlFor="route-from" icon={<MapPin />} required error={errors.from}>
      <TileInput id="route-from" value={from} maxLength={120} placeholder="City or place" onChange={(e) => onChange(e.target.value, to)} />
    </FieldTile>
    <FieldTile label="To" htmlFor="route-to" icon={<MapPin />} required error={errors.to} className="sm:[&>div]:pl-6">
      <TileInput id="route-to" value={to} maxLength={120} placeholder="City or place" onChange={(e) => onChange(from, e.target.value)} />
    </FieldTile>
    <button
      type="button"
      aria-label="Swap from and to"
      onClick={() => onChange(to, from)}
      className="absolute left-1/2 top-[29px] z-10 hidden h-8 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-[#C9C4B8] bg-white text-[#0F5E63] shadow-sm transition-colors hover:border-[#0F5E63] hover:bg-[#E3EFEE] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5E63]/30 sm:inline-flex"
    >
      <ArrowLeftRight className="h-4 w-4" />
    </button>
  </div>
);

const ItemEditor: React.FC<{
  draft: ItemDraft;
  categories: ExpenseCategory[];
  canLinkCustomer: boolean;
  customerNames: Record<string, string>;
  projects: { id: string; code: string; name: string }[];
  errors: Record<string, string>;
  duplicateNotice: string | null;
  busy: boolean;
  onChange: (d: ItemDraft) => void;
  onCancel: () => void;
  onSave: () => void;
}> = ({ draft, categories, canLinkCustomer, customerNames, projects, errors, duplicateNotice, busy, onChange, onCancel, onSave }) => {
  const [showLink, setShowLink] = useState(false);
  const [showRemarks, setShowRemarks] = useState(false);
  const cat = categories.find((c) => c.id === draft.category_id);
  const kind = cat ? CATEGORY_DETAIL_KIND[cat.code] : undefined;
  const set = (patch: Partial<ItemDraft>) => onChange({ ...draft, ...patch });
  const setDetail = (k: string, v: string) => onChange({ ...draft, details: { ...draft.details, [k]: v } });
  const setRoute = (from: string, to: string) => onChange({ ...draft, details: { ...draft.details, from, to } });
  const today = istToday();
  const late = draft.expense_date && daysBetween(draft.expense_date, today) > 90;
  const computed = kind === 'conveyance' ? editorAmount(draft, cat) : null;
  const autoAmount = kind === 'conveyance' && Number(draft.details.km) > 0 && Number(draft.details.rate_per_km) > 0;
  const nights = kind === 'hotel' && draft.details.check_in && draft.details.check_out ? hotelNights(draft.details.check_in, draft.details.check_out) : null;
  const d = (k: string) => errors[`category_details.${k}`];
  const persons = Number(draft.details.persons) || 0;
  const linkOpen = Boolean(showLink || cat?.requires_customer_or_project || draft.customer_id || draft.project_id || errors.customer_id || errors.project_id);
  const remarksOpen = Boolean(showRemarks || cat?.requires_remark || draft.remarks || errors.remarks);

  // Customers are searched on the server as you type: the master is larger than one page of results.
  const [customerQuery, setCustomerQuery] = useState('');
  const [customerResults, setCustomerResults] = useState<{ id: string; name: string }[]>([]);
  const [pickedNames, setPickedNames] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!canLinkCustomer || !linkOpen) return;
    let cancelled = false;
    const t = setTimeout(() => {
      api
        .get('/organisations', { search: customerQuery.trim() || undefined, limit: 20 })
        .then((r: any) => !cancelled && setCustomerResults((r?.data || []).map((o: any) => ({ id: o.id, name: o.name }))))
        .catch(() => !cancelled && setCustomerResults([]));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [canLinkCustomer, linkOpen, customerQuery]);
  const customerOptions = useMemo(() => {
    const id = draft.customer_id;
    const linked = id && !customerResults.some((c) => c.id === id) ? [{ id, name: pickedNames[id] || customerNames[id] || 'Linked customer' }] : [];
    return [{ value: '', label: 'None' }, ...[...linked, ...customerResults].map((c) => ({ value: c.id, label: c.name }))];
  }, [customerResults, draft.customer_id, pickedNames, customerNames]);

  return (
    <div className="rounded-[14px] border-2 border-[#0F5E63]/50 bg-white shadow-sm">
      {/* Expense type tabs */}
      <div className="flex items-stretch gap-1 rounded-t-[12px] border-b border-[#ECE9E2] bg-[#FBFAF7] pr-2">
        <ScrollStrip role="tablist" aria-label="Expense type" activeKey={draft.category_id} wrapperClassName="min-w-0 flex-1">
          {categories.map((c) => {
            const active = c.id === draft.category_id;
            return (
              <button
                key={c.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => !active && onChange({ ...draft, category_id: c.id, details: detailsFor(c) })}
                className={`relative flex min-w-[76px] shrink-0 flex-col items-center gap-1 px-3 pb-2.5 pt-3 text-[11.5px] font-semibold transition-colors focus:outline-none focus-visible:bg-[#E3EFEE] ${
                  active ? 'text-[#0F5E63]' : 'text-[#4A5568] hover:text-[#14213D]'
                }`}
              >
                {categoryIcon(c.code)}
                <span className="whitespace-nowrap">{c.name}</span>
                {active && <span className="absolute inset-x-2 bottom-0 h-[3px] rounded-t-full bg-[#0F5E63]" />}
              </button>
            );
          })}
        </ScrollStrip>
        <button type="button" aria-label="Close" onClick={onCancel} className="my-2 inline-flex w-10 shrink-0 items-center justify-center rounded-lg text-[#4A5568] hover:bg-[#E3EFEE] hover:text-[#14213D] sm:w-8">
          <X className="h-4 w-4" />
        </button>
      </div>

      {!cat ? (
        <div className="p-6 text-center text-sm text-[#4A5568]">
          {errors.category_id ? <span className="font-medium text-[#881337]">{errors.category_id}</span> : 'Pick the type of expense above to continue.'}
        </div>
      ) : (
        <div className="space-y-4 p-3 sm:p-5">
          {/* Category-specific details */}
          {kind === 'travel' && (
            <>
              <RouteFields from={draft.details.from || ''} to={draft.details.to || ''} onChange={setRoute} errors={{ from: d('from'), to: d('to') }} />
              <ChipGroup
                label="Travel mode"
                required
                value={draft.details.mode || ''}
                options={TRAVEL_MODES.map((m) => ({ value: m, label: label(m), icon: travelModeIcon(m) }))}
                onChange={(v) => setDetail('mode', v)}
                error={d('mode')}
              />
            </>
          )}
          {kind === 'hotel' && (
            <>
              <FieldTile label="Hotel name" htmlFor="hotel-name" icon={<Building2 />} required error={d('hotel_name')}>
                <TileInput id="hotel-name" value={draft.details.hotel_name || ''} maxLength={120} placeholder="e.g. Hotel Clarks Avadh, Lucknow" onChange={(e) => setDetail('hotel_name', e.target.value)} />
              </FieldTile>
              {/* Phones: one tile per row — two native date pickers (and their long errors) do not fit side by side. */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_110px]">
                <FieldTile label="Check-in" htmlFor="hotel-in" icon={<Calendar />} required error={d('check_in')}>
                  <TileInput id="hotel-in" type="date" max={today} value={draft.details.check_in || ''} onChange={(e) => setDetail('check_in', e.target.value)} />
                </FieldTile>
                <FieldTile label="Check-out" htmlFor="hotel-out" icon={<Calendar />} required error={d('check_out')}>
                  <TileInput id="hotel-out" type="date" min={draft.details.check_in || undefined} max={today} value={draft.details.check_out || ''} onChange={(e) => setDetail('check_out', e.target.value)} />
                </FieldTile>
                <FieldTile label="Nights" readOnly>
                  <div className="mt-0.5 h-7 font-mono text-[15px] leading-7 font-semibold text-[#14213D]">{nights !== null && nights > 0 ? nights : '—'}</div>
                </FieldTile>
              </div>
            </>
          )}
          {kind === 'conveyance' && (
            <>
              <RouteFields from={draft.details.from || ''} to={draft.details.to || ''} onChange={setRoute} errors={{ from: d('from'), to: d('to') }} />
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <FieldTile label="Distance (km)" htmlFor="conv-km" error={d('km')}>
                  <TileInput id="conv-km" inputMode="decimal" placeholder="0" className="font-mono" value={draft.details.km || ''} onChange={(e) => setDetail('km', e.target.value.replace(/[^\d.]/g, ''))} />
                </FieldTile>
                <FieldTile label="Rate per km (₹)" htmlFor="conv-rate" error={d('rate_per_km')}>
                  <TileInput id="conv-rate" inputMode="decimal" placeholder="0.00" className="font-mono" value={draft.details.rate_per_km || ''} onChange={(e) => setDetail('rate_per_km', e.target.value.replace(/[^\d.]/g, ''))} />
                </FieldTile>
              </div>
            </>
          )}
          {kind === 'food' && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_auto] sm:items-start">
              <ChipGroup
                label="Meal"
                required
                value={draft.details.meal_type || ''}
                options={MEAL_TYPES.map((m) => ({ value: m, label: label(m) }))}
                onChange={(v) => setDetail('meal_type', v)}
                error={d('meal_type')}
              />
              <FieldTile label="Persons" htmlFor="food-persons" icon={<Users />} required error={d('persons')} className="sm:w-40">
                <div className="mt-0.5 flex items-center gap-2">
                  <button
                    type="button"
                    aria-label="One person fewer"
                    disabled={persons <= 1}
                    onClick={() => setDetail('persons', String(Math.max(1, persons - 1)))}
                    className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-[#C9C4B8] text-[#14213D] hover:border-[#0F5E63] disabled:opacity-40 sm:h-7 sm:w-7"
                  >
                    <Minus className="h-3.5 w-3.5" />
                  </button>
                  <TileInput
                    id="food-persons"
                    inputMode="numeric"
                    className="mt-0 w-10 text-center font-mono"
                    value={draft.details.persons || ''}
                    onChange={(e) => setDetail('persons', e.target.value.replace(/\D/g, ''))}
                  />
                  <button
                    type="button"
                    aria-label="One more person"
                    disabled={persons >= 50}
                    onClick={() => setDetail('persons', String(Math.min(50, persons + 1)))}
                    className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-[#C9C4B8] text-[#14213D] hover:border-[#0F5E63] disabled:opacity-40 sm:h-7 sm:w-7"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </div>
              </FieldTile>
            </div>
          )}

          {/* Date & amount — the same pair for every expense type */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FieldTile label={kind === 'travel' ? 'Travel date' : kind === 'hotel' ? 'Bill date' : 'Date'} htmlFor="item-date" icon={<Calendar />} required error={errors.expense_date}>
              <TileInput id="item-date" type="date" max={today} value={draft.expense_date} onChange={(e) => set({ expense_date: e.target.value })} />
            </FieldTile>
            <FieldTile
              label={autoAmount ? 'Amount · km × rate' : 'Amount'}
              htmlFor="item-amount"
              icon={<IndianRupee />}
              required
              readOnly={autoAmount}
              error={errors.amount}
              hint={amountHint(cat)}
            >
              <div className="flex items-baseline gap-1">
                <span className="font-mono text-[15px] text-[#4A5568]">₹</span>
                <TileInput
                  id="item-amount"
                  inputMode="decimal"
                  placeholder="0.00"
                  className="font-mono text-lg"
                  value={autoAmount ? computed! : draft.amount}
                  readOnly={autoAmount}
                  onChange={(e) => set({ amount: e.target.value.replace(/[^\d.]/g, '') })}
                />
              </div>
            </FieldTile>
          </div>

          <FieldTile label="Purpose" htmlFor="item-purpose" required error={errors.purpose}>
            <TileInput id="item-purpose" value={draft.purpose} maxLength={500} placeholder="What was this for? e.g. Demo at CRPF Group Centre" onChange={(e) => set({ purpose: e.target.value })} />
          </FieldTile>

          {linkOpen && (
            <div className="space-y-2">
              {cat.requires_customer_or_project && (
                <p className="flex items-center gap-1.5 text-xs text-[#4A5568]">
                  <Info className="h-3.5 w-3.5 text-[#0F5E63]" /> {cat.name} must be linked to {canLinkCustomer ? 'a customer or a project' : 'a project'}.
                </p>
              )}
              <div className={`grid grid-cols-1 gap-3 ${canLinkCustomer ? 'sm:grid-cols-2' : ''}`}>
                {canLinkCustomer && (
                  <FieldTile label="Customer" icon={<Building2 />} required={cat.requires_customer_or_project && !draft.project_id} error={errors.customer_id}>
                    <TileSelect
                      value={draft.customer_id}
                      options={customerOptions}
                      onSearchChange={setCustomerQuery}
                      searchPlaceholder="Type to search customers…"
                      onChange={(v) => {
                        const hit = customerResults.find((c) => c.id === v);
                        if (hit) setPickedNames((p) => ({ ...p, [hit.id]: hit.name }));
                        set({ customer_id: v });
                      }}
                    />
                  </FieldTile>
                )}
                <FieldTile label="Project" icon={<Route />} required={!canLinkCustomer && cat.requires_customer_or_project} error={errors.project_id}>
                  <TileSelect value={draft.project_id} options={[{ value: '', label: 'None' }, ...projects.map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` }))]} onChange={(v) => set({ project_id: v })} />
                </FieldTile>
              </div>
            </div>
          )}

          {remarksOpen && (
            <FieldTile label="Remarks" htmlFor="item-remarks" icon={<StickyNote />} required={cat.requires_remark} error={errors.remarks}>
              <TileTextarea id="item-remarks" rows={2} maxLength={1000} value={draft.remarks} placeholder="Extra context for your approver" onChange={(e) => set({ remarks: e.target.value })} />
            </FieldTile>
          )}

          {(!linkOpen || !remarksOpen) && (
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {!linkOpen && <RevealButton onClick={() => setShowLink(true)}>{canLinkCustomer ? 'Link a customer or project' : 'Link a project'}</RevealButton>}
              {!remarksOpen && <RevealButton onClick={() => setShowRemarks(true)}>Add remarks</RevealButton>}
            </div>
          )}

          {late && (
            <div className="space-y-2 rounded-lg border border-[#9A3412]/30 bg-[#FBEBDD]/60 p-3">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-[#7C2D12]">
                <AlertTriangle className="h-3.5 w-3.5" /> This bill is older than 90 days and will be flagged to your approver.
              </p>
              <FieldTile label="Late submission reason" htmlFor="item-late" required error={errors.late_submission_reason}>
                <TileTextarea id="item-late" rows={2} maxLength={1000} value={draft.late_submission_reason} onChange={(e) => set({ late_submission_reason: e.target.value })} />
              </FieldTile>
            </div>
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
        </div>
      )}

      {/* Phones: amount on its own line, then full-width buttons (primary on top); from sm one row. */}
      <div className="flex flex-col gap-3 rounded-b-[12px] border-t border-[#ECE9E2] bg-[#FBFAF7] px-3 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:px-5">
        <div className="flex items-baseline justify-between gap-2 text-xs text-[#4A5568] sm:block">
          This expense <Money value={Number(editorAmount(draft, cat)) || 0} className="ml-1 text-base font-semibold text-[#14213D]" />
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <Button variant="ghost" className="w-full sm:w-auto" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button className="w-full sm:w-auto" onClick={onSave} isLoading={busy} disabled={!cat} leftIcon={<Save className="h-4 w-4" />}>
            {draft.id ? 'Save changes' : 'Add expense'}
          </Button>
        </div>
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
  const isRoute = item.category_code === 'TRAVEL' || item.category_code === 'LOCAL_CONVEYANCE';
  const headline: React.ReactNode = isRoute ? (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {det.from} <ArrowRight className="h-4 w-4 text-[#0F5E63]" /> {det.to}
    </span>
  ) : item.category_code === 'HOTEL' ? (
    det.hotel_name
  ) : item.category_code === 'FOOD' ? (
    label(det.meal_type || '')
  ) : (
    item.purpose
  );
  const sub: React.ReactNode =
    item.category_code === 'TRAVEL' ? (
      <span className="inline-flex items-center gap-1">{travelModeIcon(det.mode || '', 'h-3.5 w-3.5')} {label(det.mode || '')}</span>
    ) : item.category_code === 'HOTEL' ? (
      `${det.nights} night${Number(det.nights) === 1 ? '' : 's'}`
    ) : item.category_code === 'LOCAL_CONVEYANCE' && det.km ? (
      `${det.km} km × ₹${det.rate_per_km}`
    ) : item.category_code === 'FOOD' ? (
      `${det.persons} person${Number(det.persons) === 1 ? '' : 's'}`
    ) : null;
  const showPurpose = headline !== item.purpose;
  const hasErrors = Object.values(errors).some(Boolean);

  return (
    <div
      className={`rounded-[14px] border bg-white transition-shadow hover:shadow-sm ${hasErrors ? 'border-[#881337]/50' : 'border-[#DCD8CE]'} ${drag ? 'ring-2 ring-[#0F5E63]/30' : ''}`}
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
      {/* Phones: the big category icon moves into the caption line so the route / hotel name gets the width. */}
      <div className="flex gap-3 p-3 sm:p-4">
        <span className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#E3EFEE] text-[#0F5E63] sm:inline-flex">{categoryIcon(item.category_code)}</span>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[#4A5568]">
            <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[#0F5E63]">
              <span className="sm:hidden" aria-hidden>{categoryIcon(item.category_code, 'h-3.5 w-3.5')}</span>
              {item.category_name}
            </span>
            <span aria-hidden>·</span>
            <DateText value={item.expense_date} />
            {sub && (
              <>
                <span aria-hidden>·</span>
                {sub}
              </>
            )}
            {item.is_late && <LateFlag />}
            {item.duplicate_flag && (
              <Badge variant="warning" size="sm" className="gap-1"><Copy className="h-3 w-3" /> Duplicate flagged</Badge>
            )}
          </div>
          <div className="break-words text-[15px] font-semibold text-[#14213D]">{headline}</div>
          {showPurpose && <div className="break-words text-[13px] text-[#4A5568]">{item.purpose}</div>}
          {(item.customer_name || item.project_code) && (
            <div className="flex items-center gap-1 text-xs text-[#4A5568]">
              <Building2 className="h-3 w-3" />
              {[item.customer_name, item.project_code && `${item.project_code} ${item.project_name || ''}`].filter(Boolean).join(' · ')}
            </div>
          )}
          {item.remarks && <div className="text-xs italic text-[#4A5568]">“{item.remarks}”</div>}
        </div>
        <div className="shrink-0 text-right">
          <Money value={item.amount} className="text-base font-semibold text-[#14213D] sm:text-lg" />
          <div className="mt-1 flex justify-end gap-1">
            <Button size="icon" variant="ghost" className="h-10 w-10 sm:h-8 sm:w-8" aria-label="Edit expense" onClick={onEdit} disabled={disabled}><Pencil className="h-4 w-4" /></Button>
            <Button size="icon" variant="ghost" className="h-10 w-10 sm:h-8 sm:w-8" aria-label="Remove expense" onClick={onDelete} disabled={disabled}><Trash2 className="h-4 w-4" /></Button>
          </div>
        </div>
      </div>

      {hasErrors && (
        <div className="space-y-1 px-3 pb-3 sm:px-4">
          {Object.entries(errors).filter(([, v]) => v).map(([k, v]) => (
            <p key={k} className="flex items-center gap-1 text-xs text-[#881337]"><AlertTriangle className="h-3 w-3" /> {v}</p>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 rounded-b-[14px] border-t border-dashed border-[#DCD8CE] bg-[#FBFAF7] px-3 py-2.5 sm:px-4">
        {item.attachments.map((a) => (
          <span key={a.id} className={`inline-flex min-w-0 max-w-full items-center gap-1 rounded-lg border px-2 py-1 text-xs ${a.duplicate_of_attachment_id ? 'border-[#9A3412]/40 bg-[#FBEBDD]' : 'border-[#DCD8CE] bg-white'}`}>
            <button type="button" className="inline-flex min-w-0 items-center gap-1 hover:underline" onClick={() => onPreview(a)}>
              {a.mime_type === 'application/pdf' ? <FileText className="h-3.5 w-3.5 shrink-0" /> : <ImageIcon className="h-3.5 w-3.5 shrink-0" />}
              <span className="max-w-[140px] truncate">{a.file_name}</span>
            </button>
            {/* phones: a 28px hit area around the 14px cross (negative margins keep the chip's size) */}
            <button
              type="button"
              aria-label={`Remove ${a.file_name}`}
              className="-my-1 -mr-1.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-[#6B7280] hover:text-[#881337] sm:m-0 sm:inline-block sm:h-auto sm:w-auto"
              onClick={() => onRemoveAttachment(a)}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </span>
        ))}
        {item.receipt_missing ? (
          <Badge variant="urgent" size="sm" className="gap-1"><Paperclip className="h-3 w-3" /> Receipt required</Badge>
        ) : (
          item.attachments.length === 0 && <span className="hidden text-[11px] text-[#6B7280] sm:inline">Drop a receipt here (optional)</span>
        )}
        <input ref={fileRef} type="file" accept={ACCEPT} multiple className="hidden" onChange={(e) => e.target.files && onUpload(e.target.files)} />
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => e.target.files && onUpload(e.target.files)} />
        {item.attachments.length < MAX_FILES && (
          // Phones: Receipt / Photo share their own full-width row as real 36px buttons (the main job on the road).
          <span className="flex w-full gap-2 sm:ml-auto sm:inline-flex sm:w-auto sm:gap-1">
            <Button
              size="xs"
              variant="secondary"
              isLoading={uploading}
              leftIcon={<Upload className="h-4 w-4 sm:h-3 sm:w-3" />}
              onClick={() => fileRef.current?.click()}
              className="h-9 flex-1 px-3 text-xs sm:h-7 sm:flex-initial sm:px-2 sm:text-[11px]"
            >
              Receipt
            </Button>
            <Button
              size="xs"
              variant="secondary"
              disabled={uploading}
              leftIcon={<Camera className="h-4 w-4" />}
              onClick={() => cameraRef.current?.click()}
              className="h-9 flex-1 px-3 text-xs sm:hidden"
            >
              Photo
            </Button>
          </span>
        )}
      </div>
    </div>
  );
};

/** Amount-field hint: the category's per-line cap and when a receipt becomes mandatory (the server enforces both). */
function amountHint(cat: { max_amount_per_item: number | null; cap_is_hard: boolean; receipt_required_above: number | null }): string | undefined {
  const parts: string[] = [];
  if (cat.max_amount_per_item) parts.push(`Limit ${formatExpenseAmount(cat.max_amount_per_item)}${cat.cap_is_hard ? ' (hard cap)' : ' — add a remark if above'}`);
  if (cat.receipt_required_above !== null && cat.receipt_required_above !== undefined) {
    const t = Number(cat.receipt_required_above);
    parts.push(t <= 0 ? 'Receipt required' : `Receipt required from ${formatExpenseAmount(t)}`);
  }
  return parts.length ? parts.join(' · ') : undefined;
}
