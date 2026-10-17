'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRightLeft,
  BarChart3,
  CheckCircle2,
  ClipboardCheck,
  Download,
  FileText,
  Landmark,
  LayoutList,
  Receipt,
  RefreshCw,
  Settings2,
  XCircle,
} from 'lucide-react';
import {
  Badge,
  Button,
  FilterMenu,
  InfoCallout,
  Input,
  Modal,
  Select,
  Spinner,
  Textarea,
  type FilterMenuOption,
} from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { istToday, isIstFutureDate } from '@/lib/ist-date';
import {
  EXPENSE_ACTION_LABELS,
  EXPENSE_ITEM_STATUS_LABELS,
  EXPENSE_MIN_COMMENT_LENGTH,
  EXPENSE_STATUS_LABELS,
  formatExpenseAmount,
  formatExpenseDate,
  type ExpenseClaimStatus,
  type ExpenseItemStatus,
} from '@arihant/shared';
import {
  ITEM_BADGE,
  MANAGEMENT_ROLES,
  STATUS_BADGE,
  errorMessage,
  fieldErrors,
  saveBlob,
  useBadgeCounts,
  type ExpenseAttachment,
  type ExpenseHistory,
} from './expense-lib';

export const Money: React.FC<{ value: number | null | undefined; className?: string }> = ({ value, className }) => (
  <span className={`font-mono tabular-nums ${className || ''}`}>{value === null || value === undefined ? '—' : formatExpenseAmount(value)}</span>
);

export const DateText: React.FC<{ value: string | null | undefined; className?: string }> = ({ value, className }) => (
  <span className={`font-mono tabular-nums ${className || ''}`}>{formatExpenseDate(value)}</span>
);

export const StatusBadge: React.FC<{ status: ExpenseClaimStatus }> = ({ status }) => (
  <Badge variant={STATUS_BADGE[status] || 'default'} size="sm" className="whitespace-nowrap">
    {EXPENSE_STATUS_LABELS[status] || status}
  </Badge>
);

export const ItemStatusBadge: React.FC<{ status: ExpenseItemStatus }> = ({ status }) => (
  <Badge variant={ITEM_BADGE[status] || 'default'} size="sm" className="whitespace-nowrap">
    {EXPENSE_ITEM_STATUS_LABELS[status] || status}
  </Badge>
);

// ------------------------------------------------------------------ navigation
type ExpenseView = { href: string; label: string; icon: React.ReactNode; count?: number; urgent?: boolean };

/** Expense screens this user can open — filtered by role, with live "waiting on you" counts. */
function useExpenseViews(): ExpenseView[] {
  const { user } = useAuth();
  const counts = useBadgeCounts(Boolean(user));
  const role = user?.role || '';
  const isAdminLike = MANAGEMENT_ROLES.includes(role);
  return useMemo(() => {
    const n = (v?: number) => (v && v > 0 ? v : undefined);
    const v: ExpenseView[] = [{ href: '/expenses', label: 'My Expenses', icon: <Receipt />, count: n(counts?.my_clarifications), urgent: true }];
    if (role === 'regional_manager' || isAdminLike || counts?.has_team) {
      v.push({ href: '/expenses/approvals', label: 'Approvals', icon: <ClipboardCheck />, count: n(counts?.manager_pending), urgent: true });
    }
    if (role === 'accounts' || isAdminLike) {
      v.push({ href: '/expenses/accounts', label: 'Accounts Queue', icon: <Landmark />, count: n((counts?.accounts_pending || 0) + (counts?.accounts_ready || 0)), urgent: true });
    }
    if (['management', 'admin', 'accounts', 'regional_manager'].includes(role) || counts?.has_team) {
      v.push({ href: '/expenses/reports', label: 'Reports', icon: <BarChart3 /> });
    }
    if (isAdminLike) v.push({ href: '/expenses/categories', label: 'Categories', icon: <Settings2 />, count: n(counts?.approver_inactive), urgent: true });
    return v;
  }, [counts, role, isAdminLike]);
}

/**
 * Every expense screen behind one "View" dropdown — the first control of each page's filter row.
 * The active entry comes from the URL unless `active` (an href) is given; claim pages match none.
 */
export const ExpenseViewMenu: React.FC<{ active?: string; align?: 'left' | 'right' }> = ({ active, align }) => {
  const router = useRouter();
  const pathname = usePathname();
  const views = useExpenseViews();
  const current =
    active ??
    views.find((v) => (v.href === '/expenses' ? pathname === v.href : pathname === v.href || pathname.startsWith(`${v.href}/`)))?.href;
  const options: FilterMenuOption[] = views.map((v) => ({
    key: v.href,
    label: v.label,
    icon: v.icon,
    count: v.count,
    urgent: v.urgent,
    active: current === v.href,
    onSelect: () => router.push(v.href),
  }));
  return <FilterMenu label="View" icon={<LayoutList />} options={options} neutralKeys={[]} align={align} />;
};

/** Compact bar for expense pages without a filter row (new claim, claim detail, edit): back to My expenses + View. */
export const ExpensesNav: React.FC = () => (
  <div className="flex flex-wrap items-center gap-2">
    <Link href="/expenses">
      <Button size="sm" variant="secondary" className="h-9" leftIcon={<ArrowLeft className="h-4 w-4" />}>
        My expenses
      </Button>
    </Link>
    <ExpenseViewMenu />
  </div>
);

export const ConflictCallout: React.FC<{ onRefresh: () => void }> = ({ onRefresh }) => (
  <InfoCallout variant="warning" title="This claim was updated by someone else">
    <div className="flex flex-wrap items-center gap-3">
      <span>Your view is out of date. Refresh to see the latest version before acting.</span>
      <Button size="xs" variant="secondary" leftIcon={<RefreshCw className="h-3 w-3" />} onClick={onRefresh}>
        Refresh
      </Button>
    </div>
  </InfoCallout>
);

// ------------------------------------------------------------------ toasts
type Toast = { id: number; kind: 'success' | 'error'; text: string };
export function useToaster() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((kind: Toast['kind'], text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 7000 : 4000);
  }, []);
  const Toaster = () => (
    <div className="fixed bottom-4 right-4 left-4 sm:left-auto z-[80] flex flex-col gap-2 sm:w-96" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`flex items-start gap-2 rounded-[14px] border px-4 py-3 text-sm shadow-lg bg-white ${
            t.kind === 'error' ? 'border-[#881337]/30 text-[#881337]' : 'border-[#0F5E63]/30 text-[#0F5E63]'
          }`}
        >
          {t.kind === 'error' ? <XCircle className="h-4 w-4 mt-0.5 shrink-0" /> : <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />}
          <span className="text-[#14213D]">{t.text}</span>
        </div>
      ))}
    </div>
  );
  return { push, Toaster };
}

// ------------------------------------------------------------------ modals
export const CommentModal: React.FC<{
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  serverError?: string | null;
  onClose: () => void;
  onConfirm: (comment: string) => void;
}> = ({ open, title, description, confirmLabel, danger, busy, serverError, onClose, onConfirm }) => {
  const [comment, setComment] = useState('');
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (open) {
      setComment('');
      setTouched(false);
    }
  }, [open]);
  const tooShort = comment.trim().length < EXPENSE_MIN_COMMENT_LENGTH;
  return (
    <Modal isOpen={open} onClose={onClose} title={title} description={description} maxWidth="md">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setTouched(true);
          if (!tooShort) onConfirm(comment.trim());
        }}
        className="space-y-4"
      >
        <Textarea
          label="Comment *"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={4}
          maxLength={1000}
          autoFocus
          placeholder="Explain what is wrong or what you need from the employee"
          error={touched && tooShort ? `At least ${EXPENSE_MIN_COMMENT_LENGTH} characters are required.` : serverError || undefined}
        />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant={danger ? 'danger' : 'primary'} isLoading={busy}>
            {confirmLabel}
          </Button>
        </div>
      </form>
    </Modal>
  );
};

export const ProcessModal: React.FC<{
  open: boolean;
  busy?: boolean;
  total: number | null;
  errors: Record<string, string>;
  /** The server's refusal (e.g. future-dated lines) — shown inside the dialog so it never fails silently. */
  serverError?: string | null;
  onClose: () => void;
  onConfirm: (v: { tally_voucher_ref: string; payment_reference: string; payment_date: string }) => void;
}> = ({ open, busy, total, errors, serverError, onClose, onConfirm }) => {
  const blank = () => ({ tally_voucher_ref: '', payment_reference: '', payment_date: istToday() });
  const [v, setV] = useState(blank);
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (open) {
      setV(blank());
      setTouched(false);
    }
  }, [open]);
  // Mirrors the server: voucher, bank reference and payment date are all required; the date cannot be after today (IST).
  const local: Record<string, string> = {};
  if (!v.tally_voucher_ref.trim()) local.tally_voucher_ref = 'Required.';
  if (!v.payment_reference.trim()) local.payment_reference = 'Enter the bank UTR / NEFT / cheque reference.';
  else if (v.payment_reference.trim().length < 4) local.payment_reference = 'Payment reference must be at least 4 characters.';
  if (!v.payment_date) local.payment_date = 'Payment date is required.';
  else if (isIstFutureDate(v.payment_date)) local.payment_date = 'Payment date cannot be in the future.';
  const shown = (k: string) => (touched ? local[k] : undefined) || errors[k];
  const otherErrors = Object.entries(errors).filter(([k]) => !['tally_voucher_ref', 'payment_reference', 'payment_date'].includes(k));
  return (
    <Modal isOpen={open} onClose={onClose} title="Mark as processed & paid" description={`Approved total ${formatExpenseAmount(total ?? 0)}. Record the Tally voucher and the bank payment. After this the claim is read-only.`} maxWidth="md">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setTouched(true);
          if (!Object.keys(local).length) onConfirm({ ...v, tally_voucher_ref: v.tally_voucher_ref.trim(), payment_reference: v.payment_reference.trim() });
        }}
        className="space-y-4"
      >
        {serverError && (
          <InfoCallout variant="danger" title="Not marked as paid">
            <p>{serverError}</p>
            {otherErrors.length > 0 && (
              <ul className="mt-1 list-disc pl-4 text-xs">
                {otherErrors.map(([k, m]) => <li key={k}>{m}</li>)}
              </ul>
            )}
          </InfoCallout>
        )}
        <Input
          label="Tally voucher reference *"
          value={v.tally_voucher_ref}
          onChange={(e) => setV({ ...v, tally_voucher_ref: e.target.value })}
          maxLength={100}
          autoFocus
          placeholder="e.g. JV/2026/0451"
          error={shown('tally_voucher_ref')}
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input label="Payment reference (UTR) *" value={v.payment_reference} onChange={(e) => setV({ ...v, payment_reference: e.target.value })} maxLength={100} placeholder="NEFT / RTGS UTR or cheque no." className="font-mono" error={shown('payment_reference')} />
          <Input label="Payment date *" type="date" max={istToday()} value={v.payment_date} onChange={(e) => setV({ ...v, payment_date: e.target.value })} error={shown('payment_date')} />
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" isLoading={busy}>
            Mark paid
          </Button>
        </div>
      </form>
    </Modal>
  );
};

/** How a processed claim was paid: bank reference + date (and the Tally voucher). */
export const PaymentInfo: React.FC<{
  claim: { status: string; payment_reference?: string | null; payment_date?: string | null; tally_voucher_ref?: string | null };
  className?: string;
}> = ({ claim, className = '' }) => {
  if (claim.status !== 'processed') return null;
  return (
    <div className={`text-[11px] text-[#4A5568] ${className}`}>
      {claim.payment_reference ? (
        <>Paid · UTR <span className="font-mono text-[#14213D]">{claim.payment_reference}</span></>
      ) : (
        <span className="text-[#9A3412]">Paid · no bank reference recorded</span>
      )}
      {claim.payment_date && <> · <DateText value={claim.payment_date} /></>}
    </div>
  );
};

export const ReassignModal: React.FC<{
  open: boolean;
  busy?: boolean;
  employeeId: string;
  currentApproverId: string | null;
  errors: Record<string, string>;
  onClose: () => void;
  onConfirm: (v: { approver_id: string; comment: string }) => void;
}> = ({ open, busy, employeeId, currentApproverId, errors, onClose, onConfirm }) => {
  const [users, setUsers] = useState<{ id: string; full_name: string; role: string; is_active: boolean }[]>([]);
  const [approver, setApprover] = useState('');
  const [comment, setComment] = useState('');
  useEffect(() => {
    if (!open) return;
    setApprover('');
    setComment('');
    api
      .get('/users', { limit: 100 })
      .then((r: any) => setUsers((r.data || r || []).filter((u: any) => u.is_active && u.id !== employeeId && u.id !== currentApproverId)))
      .catch(() => setUsers([]));
  }, [open, employeeId, currentApproverId]);
  return (
    <Modal isOpen={open} onClose={onClose} title="Reassign approver" description="Use this when the approver has left, moved or is unavailable. The change is recorded in the claim history." maxWidth="md">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (approver) onConfirm({ approver_id: approver, comment });
        }}
        className="space-y-4"
      >
        <Select
          label="New approver *"
          value={approver}
          onChange={(e) => setApprover(e.target.value)}
          options={[{ value: '', label: 'Choose an active user…' }, ...users.map((u) => ({ value: u.id, label: `${u.full_name} (${u.role.replace(/_/g, ' ')})` }))]}
          error={errors.approver_id}
        />
        <Textarea label="Reason" value={comment} onChange={(e) => setComment(e.target.value)} rows={3} maxLength={1000} placeholder="e.g. Manager left the company" />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" isLoading={busy} disabled={!approver} leftIcon={<ArrowRightLeft className="h-4 w-4" />}>
            Reassign
          </Button>
        </div>
      </form>
    </Modal>
  );
};

/** Receipt preview through the authorised endpoint (images and PDFs inline, HEIC as download). */
export const ReceiptViewer: React.FC<{ attachment: ExpenseAttachment | null; onClose: () => void }> = ({ attachment, onClose }) => {
  const [url, setUrl] = useState<string | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!attachment) return;
    let objectUrl: string | null = null;
    setUrl(null);
    setError(null);
    api
      .blob(`/expense-attachments/${attachment.id}`)
      .then(({ blob }) => {
        setBlob(blob);
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch((e) => setError(errorMessage(e, 'Could not load the receipt.')));
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [attachment]);
  if (!attachment) return null;
  const isImage = attachment.mime_type.startsWith('image/') && attachment.mime_type !== 'image/heic';
  const isPdf = attachment.mime_type === 'application/pdf';
  return (
    <Modal isOpen onClose={onClose} title={attachment.file_name} description={`${(attachment.size_bytes / 1024).toFixed(0)} KB · uploaded ${formatExpenseDate(attachment.uploaded_at)}`} maxWidth="4xl">
      <div className="space-y-3">
        {attachment.duplicate_of_attachment_id && (
          <InfoCallout variant="warning" title="Possible duplicate receipt">
            The same file is attached on {attachment.duplicate_claim_number || 'another claim'}.
          </InfoCallout>
        )}
        <div className="min-h-[320px] rounded-[14px] border border-[#DCD8CE] bg-[#FBFAF7] flex items-center justify-center overflow-hidden">
          {error ? (
            <p className="text-sm text-[#881337] p-6">{error}</p>
          ) : !url ? (
            <Spinner size="lg" />
          ) : isImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt={attachment.file_name} className="max-h-[70vh] w-auto object-contain" />
          ) : isPdf ? (
            <iframe src={url} title={attachment.file_name} className="w-full h-[70vh]" />
          ) : (
            <div className="text-center p-6 space-y-2">
              <FileText className="h-10 w-10 mx-auto text-[#4A5568]" />
              <p className="text-sm text-[#4A5568]">This format cannot be previewed in the browser.</p>
            </div>
          )}
        </div>
        <div className="flex justify-end">
          <Button variant="secondary" size="sm" disabled={!blob} leftIcon={<Download className="h-4 w-4" />} onClick={() => blob && saveBlob(blob, attachment.file_name)}>
            Download
          </Button>
        </div>
      </div>
    </Modal>
  );
};

export const Timeline: React.FC<{ history: ExpenseHistory[] }> = ({ history }) => (
  <ol className="relative border-l border-[#DCD8CE] ml-2 space-y-5">
    {history.map((h) => {
      const tone =
        h.to_status === 'rejected'
          ? 'bg-[#881337]'
          : h.to_status === 'clarification_required'
            ? 'bg-[#9A3412]'
            : h.to_status === 'processed' || h.action.includes('approve')
              ? 'bg-[#0F5E63]'
              : 'bg-[#C9C4B8]';
      return (
        <li key={h.id} className="ml-4">
          <span className={`absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full ${tone}`} aria-hidden />
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-sm font-semibold text-[#14213D]">{EXPENSE_ACTION_LABELS[h.action] || h.action.replace(/_/g, ' ')}</span>
            <span className="text-xs text-[#4A5568]">
              {h.actor_name || (h.actor_role === 'system' ? 'System' : '—')}
              {h.actor_role && h.actor_role !== 'system' ? ` · ${h.actor_role.replace(/_/g, ' ')}` : ''}
            </span>
            <span className="text-[11px] font-mono text-[#8A8578] ml-auto">
              {new Date(h.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
          {h.comment && <p className="mt-1 text-sm text-[#14213D] bg-[#FBFAF7] border border-[#ECE9E2] rounded-lg px-3 py-2">{h.comment}</p>}
          {h.action === 'clarification_edit' && h.metadata?.before && h.metadata?.after && (
            <p className="mt-1 text-xs text-[#4A5568]">
              {['purpose', 'amount', 'expense_date'].filter((k) => String(h.metadata.before[k]) !== String(h.metadata.after[k])).map((k) => `${k.replace('_', ' ')}: ${h.metadata.before[k]} → ${h.metadata.after[k]}`).join(' · ') || 'Details updated'}
            </p>
          )}
        </li>
      );
    })}
  </ol>
);

export const LateFlag: React.FC = () => (
  <Badge variant="urgent" size="sm" className="gap-1">
    <AlertTriangle className="h-3 w-3" /> Late
  </Badge>
);

export { fieldErrors };
