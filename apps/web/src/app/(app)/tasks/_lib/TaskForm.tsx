'use client';

/**
 * Create / assign a task (Module 8): one-time, bulk (one task per assignee) or a recurring series.
 * The category decides the required link; assignee scope, leave and holiday warnings come from a debounced
 * pre-flight (`POST /tasks/check`); the recurrence builder previews the next 10 occurrences from the server
 * so holiday / leave policies are shown exactly as the generator will apply them. The server re-validates
 * everything and its field errors are shown next to each field.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, ArrowLeft, CalendarClock, Camera, ListChecks, Paperclip, Plus, Repeat, Send, ShieldCheck, Upload, Users, X } from 'lucide-react';
import { Badge, Button, Card, Checkbox, FormSteps, InfoCallout, Input, Select, Spinner, Textarea } from '@/components/ui';
import { api } from '@/lib/api';
import {
  TASK_HOLIDAY_POLICIES,
  TASK_HOLIDAY_POLICY_LABELS,
  TASK_LEAVE_POLICY_LABELS,
  TASK_MAX_BULK_ASSIGNEES,
  TASK_PRIORITIES,
  TASK_PRIORITY_LABELS,
  TASK_RECURRENCE_LABELS,
  TASK_RECURRENCE_TYPES,
  TASK_TEXT_LIMITS,
  describeRecurrence,
  formatTaskDate,
  formatTaskDateTime,
  istDateTime,
  isoWeekday,
  validateRecurrenceRule,
  type OccurrenceAdjustment,
  type TaskHolidayPolicy,
  type TaskLeavePolicy,
  type TaskPriority,
  type TaskRecurrenceType,
  type TaskTemplateStatus,
} from '@arihant/shared';
import { errorMessage, fieldErrors, fileSize, istToday, notifyTasksChanged, useTaskCategories, useTaskSettings, useTaskSummary, type AssigneeOption, type LinkOption, type TaskCategory } from './task-lib';
import { AssigneePicker, DeadlineInput, LinkPicker } from './pickers';
import { QuickCustomerModal } from './QuickCustomerModal';
import { CreateDemoModal } from '@/app/(app)/demos/_lib/CreateDemoModal';
import { CreateServiceTicketModal } from '@/app/(app)/service/_lib/CreateServiceTicketModal';
import { uploadTaskFiles } from './TaskActions';
import { useToaster } from './task-ui';

// ======================================================================== shared bits (also used by the recurring pages)
export interface OccurrencePreviewRow {
  occurrence_date: string;
  work_date: string | null;
  adjustment: OccurrenceAdjustment | 'skipped_leave';
  holiday: string | null;
  deadline: string | null;
}

export const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** Monday-first display order (0 = Sunday … 6 = Saturday). */
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

const dayLabel = (iso: string) => `${WEEKDAY_SHORT[isoWeekday(iso)]} ${formatTaskDate(iso)}`;

/** Chip text + tone for a preview row's holiday / leave adjustment. */
export function adjustmentChip(row: Pick<OccurrencePreviewRow, 'adjustment' | 'holiday'>): { text: string; variant: 'info' | 'warning' | 'outline' } | null {
  const where = row.holiday ? row.holiday : 'non-working day';
  switch (row.adjustment) {
    case 'shifted_before':
      return { text: `Moved earlier — ${where}`, variant: 'info' };
    case 'shifted_after':
      return { text: `Moved later — ${where}`, variant: 'info' };
    case 'kept_on_holiday':
      return { text: `Kept on ${where}`, variant: 'warning' };
    case 'skipped_holiday':
      return { text: `Skipped — ${where}`, variant: 'outline' };
    case 'skipped_leave':
      return { text: 'Skipped — on approved leave', variant: 'outline' };
    case 'skipped_collision':
      return { text: 'Skipped — same day as another occurrence', variant: 'outline' };
    default:
      return null;
  }
}

/** Compact list of upcoming occurrences (date → final deadline, with adjustment chips). */
export const OccurrenceList: React.FC<{ rows: OccurrencePreviewRow[]; emptyText?: string }> = ({ rows, emptyText = 'No upcoming occurrences — check the end date or the number of occurrences.' }) => {
  if (!rows.length) return <p className="text-xs text-[#6B7280] px-1 py-2">{emptyText}</p>;
  return (
    <ol className="divide-y divide-[#ECE9E2] rounded-[10px] border border-[#ECE9E2] bg-white">
      {rows.map((r, i) => {
        const chip = adjustmentChip(r);
        const skipped = !r.work_date;
        const moved = r.work_date && r.work_date !== r.occurrence_date;
        return (
          <li key={`${r.occurrence_date}-${i}`} className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1 px-3 py-2">
            <div className="min-w-0 space-y-0.5">
              <div className={`font-mono text-xs tabular-nums ${skipped ? 'text-[#6B7280] line-through' : 'text-[#14213D] font-semibold'}`}>{dayLabel(r.work_date || r.occurrence_date)}</div>
              {moved && <div className="text-[11px] text-[#4A5568]">Scheduled {dayLabel(r.occurrence_date)}</div>}
              {chip && (
                <Badge variant={chip.variant} size="sm" className="whitespace-normal">
                  {chip.text}
                </Badge>
              )}
            </div>
            <div className="text-right">
              {r.deadline ? (
                <>
                  <div className="text-[10px] uppercase tracking-wide text-[#4A5568]">Due</div>
                  <div className="font-mono text-xs tabular-nums text-[#14213D]">{formatTaskDateTime(r.deadline)}</div>
                </>
              ) : (
                <span className="text-[11px] text-[#6B7280]">Not generated</span>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
};

export const TEMPLATE_STATUS_LABELS: Record<TaskTemplateStatus, string> = { active: 'Active', paused: 'Paused', ended: 'Ended' };
export const TemplateStatusBadge: React.FC<{ status: TaskTemplateStatus | string }> = ({ status }) => (
  <Badge variant={status === 'active' ? 'success' : status === 'paused' ? 'warning' : 'outline'} size="sm" className="whitespace-nowrap">
    {TEMPLATE_STATUS_LABELS[status as TaskTemplateStatus] || status}
  </Badge>
);

/** "Due same day at 06:00 PM" / "Due 2 days later at 10:30 AM". */
export function describeDue(offsetDays: number, dueTime: string): string {
  const [h, m] = (dueTime || '18:00').slice(0, 5).split(':').map(Number);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const time = `${String(h12).padStart(2, '0')}:${String(m || 0).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
  return `${offsetDays > 0 ? `Due ${offsetDays} day${offsetDays === 1 ? '' : 's'} after each occurrence` : 'Due the same day'} at ${time} IST`;
}

export const defaultHolidayPolicy = (unit: 'daily' | 'weekly' | 'monthly'): TaskHolidayPolicy => (unit === 'daily' ? 'skip' : 'shift_after');

// ======================================================================== form model
type LinkType = 'customer' | 'tender' | 'demo' | 'service' | 'project';
type LinkField = 'customer_id' | 'tender_id' | 'demo_id' | 'service_ticket_id' | 'project_id';
type Unit = 'daily' | 'weekly' | 'monthly';
type EndMode = 'never' | 'on_date' | 'after';

const LINK_TYPES: LinkType[] = ['customer', 'tender', 'demo', 'service', 'project'];
const LINK_FIELD: Record<LinkType, LinkField> = { customer: 'customer_id', tender: 'tender_id', demo: 'demo_id', service: 'service_ticket_id', project: 'project_id' };
const LINK_NAME: Record<LinkType, string> = { customer: 'Customer', tender: 'Tender', demo: 'Demo', service: 'Service ticket', project: 'Project' };
/** Link pickers the category makes mandatory (demo / service accept the customer instead). */
const REQUIRED_LINKS: Record<string, LinkType[]> = { customer: ['customer'], tender: ['tender'], demo: ['demo', 'customer'], service: ['service', 'customer'] };
/** Categories whose record can be created on the spot from the task form, and what the offer says. */
type CreatableLink = 'demo' | 'service' | 'customer';
const CREATE_OFFER: Record<CreatableLink, { field: LinkField; question: string; detail: string; yes: string }> = {
  demo: {
    field: 'demo_id',
    question: 'Do you want to create a new demo for this task?',
    detail: 'Opens the demo request with live kit and team availability. The demo team is notified, and the demo is linked here.',
    yes: 'Yes, create demo',
  },
  service: {
    field: 'service_ticket_id',
    question: 'Do you want to log a new service ticket for this task?',
    detail: 'Opens the breakdown form. The service desk is notified, and the ticket is linked here.',
    yes: 'Yes, create ticket',
  },
  customer: {
    field: 'customer_id',
    question: 'Is this for a new customer?',
    detail: 'Create the account now and it is linked here. An existing account with the same name and city is reused.',
    yes: 'Yes, add customer',
  },
};
const CATEGORY_HINT: Record<string, string> = {
  customer: 'Needs a linked customer.',
  tender: 'Needs an open tender — the customer is filled in from the tender.',
  demo: 'Needs a demo, or at least the customer.',
  service: 'Needs a service ticket, or at least the customer.',
};

const MAX_FILES = 10;
const MAX_FILE_MB = 10;
const FILE_EXTS = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'jpg', 'jpeg', 'png'];
const FILE_MIMES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/jpeg',
  'image/png',
];
const FILE_ACCEPT = '.pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png';
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Order used to scroll to the first error; recurrence keys share the builder anchor. */
const FIELD_ORDER = [
  'title',
  'category_id',
  'priority',
  'description',
  'expected_outcome',
  'customer_id',
  'tender_id',
  'demo_id',
  'service_ticket_id',
  'project_id',
  'assignee_ids',
  'recurrence_type',
  'start_date',
  'deadline',
  'recurrence_rule',
  'recurrence_rule.freq',
  'recurrence_rule.interval',
  'recurrence_rule.weekdays',
  'recurrence_rule.month_days',
  'end_date',
  'max_occurrences',
  'due_offset_days',
  'due_time',
  'holiday_policy',
  'leave_policy',
  'evidence_required',
  'approval_required',
  'is_backlog',
  'files',
];
const HANDLED_KEYS = new Set(FIELD_ORDER);
const anchorId = (key: string) =>
  key.startsWith('recurrence_rule') ? 'tf-recurrence' : typeof document !== 'undefined' && !document.getElementById(`tf-${key}`) && key.endsWith('_id') && key !== 'category_id' ? 'tf-links' : `tf-${key}`;
/** The popup's two steps: Task + Assign, then Schedule + Rules + Documents. */
const MODAL_STEP_TITLES = ['Task & people', 'Schedule & rules'];

export interface TaskFormPrefill {
  customer_id?: string | null;
  tender_id?: string | null;
  demo_id?: string | null;
  service_ticket_id?: string | null;
  project_id?: string | null;
  category_id?: string | null;
  frequency?: string | null;
  title?: string | null;
  assignee_id?: string | null;
}

interface FormState {
  title: string;
  description: string;
  expected_outcome: string;
  category_id: string;
  links: Record<LinkField, string>;
  assignee_ids: string[];
  priority: TaskPriority;
  start_date: string;
  deadline: string;
  evidence_required: boolean;
  approval_required: boolean;
  is_backlog: boolean;
  frequency: TaskRecurrenceType;
}

interface RecurrenceState {
  unit: Unit;
  interval: string;
  dailyWeekdays: number[];
  weeklyWeekdays: number[];
  monthDays: number[];
  monthLast: 'none' | 'last_day' | 'last_working_day';
  endMode: EndMode;
  endDate: string;
  maxOccurrences: string;
  dueOffset: string;
  dueTime: string;
  holidayPolicy: TaskHolidayPolicy | null; // null = follow the frequency default
  leavePolicy: TaskLeavePolicy;
}

interface CheckResult {
  errors: Record<string, string>;
  assignees: { assignee_id: string; ok: boolean; scope?: string; reason?: string }[];
  warnings: { field: string; message: string; assignee_id?: string }[];
}

interface Created {
  href: string;
  message: string;
  failures: string[];
}

/** Instant of a DeadlineInput value ('YYYY-MM-DD' = 23:59:59 IST, or 'YYYY-MM-DDTHH:mm' IST). */
function deadlineInstant(v: string): Date | null {
  if (!v) return null;
  const [d, t] = v.split('T');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  const inst = istDateTime(d, t || '23:59:59');
  return Number.isNaN(inst.getTime()) ? null : inst;
}

function rawRule(frequency: TaskRecurrenceType, r: RecurrenceState): Record<string, unknown> | null {
  if (frequency === 'one_time') return null;
  const unit: Unit = frequency === 'custom' ? r.unit : frequency;
  const rule: Record<string, unknown> = { freq: unit, interval: frequency === 'custom' ? (r.interval.trim() === '' ? 0 : Number(r.interval)) : 1 };
  if (unit === 'daily') rule.weekdays = r.dailyWeekdays;
  if (unit === 'weekly') rule.weekdays = r.weeklyWeekdays;
  if (unit === 'monthly') {
    rule.month_days = r.monthDays;
    if (r.monthLast === 'last_day') rule.month_last_day = true;
    if (r.monthLast === 'last_working_day') rule.month_last_working_day = true;
  }
  return rule;
}

const isRecurringType = (v: string | null | undefined): v is TaskRecurrenceType => Boolean(v && (TASK_RECURRENCE_TYPES as string[]).includes(v));
const toggle = (list: number[], n: number) => (list.includes(n) ? list.filter((x) => x !== n) : [...list, n].sort((a, b) => a - b));

// ======================================================================== small presentational pieces
const SectionTitle: React.FC<{ icon: React.ReactNode; title: string; description?: string; right?: React.ReactNode }> = ({ icon, title, description, right }) => (
  <div className="flex flex-wrap items-start justify-between gap-2">
    <div className="flex items-start gap-2.5 min-w-0">
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#E3EFEE] text-[#0F5E63]">{icon}</span>
      <div className="min-w-0">
        <h2 className="font-serif text-lg leading-tight text-[#14213D]">{title}</h2>
        {description && <p className="text-xs text-[#4A5568] mt-0.5">{description}</p>}
      </div>
    </div>
    {right}
  </div>
);

const Chip: React.FC<{ on: boolean; onClick: () => void; children: React.ReactNode; ariaLabel?: string; className?: string; disabled?: boolean }> = ({ on, onClick, children, ariaLabel, className, disabled }) => (
  <button
    type="button"
    aria-pressed={on}
    aria-label={ariaLabel}
    disabled={disabled}
    onClick={onClick}
    className={`inline-flex items-center justify-center rounded-lg border text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-[#0F5E63]/25 disabled:opacity-50 ${
      on ? 'border-[#0F5E63] bg-[#0F5E63] text-white' : 'border-[#C9C4B8] bg-white text-[#14213D] hover:border-[#0F5E63]'
    } ${className || ''}`}
  >
    {children}
  </button>
);

const FieldError: React.FC<{ message?: string }> = ({ message }) => (message ? <p className="text-xs text-[#881337] font-medium mt-1">{message}</p> : null);

const WarnLine: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="flex items-start gap-1.5 text-[11px] font-medium text-[#9A3412] mt-1">
    <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" />
    <span>{children}</span>
  </p>
);

const WeekdayChips: React.FC<{ label: string; value: number[]; onChange: (v: number[]) => void; error?: string; hint?: string }> = ({ label, value, onChange, error, hint }) => (
  <div>
    <span className="block text-xs font-semibold text-[#14213D] mb-1.5">{label}</span>
    <div role="group" aria-label={label} className="grid grid-cols-7 gap-1.5">
      {WEEKDAY_ORDER.map((d) => (
        <Chip key={d} on={value.includes(d)} onClick={() => onChange(toggle(value, d))} className="h-10 sm:h-9" ariaLabel={WEEKDAY_SHORT[d]}>
          {WEEKDAY_SHORT[d]}
        </Chip>
      ))}
    </div>
    {error ? <FieldError message={error} /> : hint ? <p className="text-[11px] text-[#4A5568] mt-1">{hint}</p> : null}
  </div>
);

// ======================================================================== the form
export interface TaskFormProps {
  prefill?: TaskFormPrefill;
  /**
   * 'modal': rendered inside a popup — two steps (Task / Linked work / Assign, then Schedule / Rules /
   * Documents), and after saving the popup closes
   * (onCreated gets the message) instead of navigating away. 'page' (default): the full page form.
   */
  variant?: 'page' | 'modal';
  onClose?: () => void;
  onCreated?: (result: { message: string; href: string }) => void;
  /** Lets the popup ask before an outside click / Esc throws away unsaved input. */
  onDirtyChange?: (dirty: boolean) => void;
}

export const TaskForm: React.FC<TaskFormProps> = ({ prefill, variant = 'page', onClose, onCreated, onDirtyChange }) => {
  const modal = variant === 'modal';
  const router = useRouter();
  const { push, Toaster } = useToaster();
  // In the popup every section is a step with its own heading, so section cards and titles step aside.
  const Panel = useMemo<React.FC<{ className?: string; children?: React.ReactNode }>>(
    () => (modal ? ({ children }) => <div className="space-y-4">{children}</div> : Card),
    [modal],
  );
  const Title = useMemo<typeof SectionTitle>(
    () => (modal ? ({ right }) => (right ? <div className="flex justify-end">{right}</div> : null) : SectionTitle),
    [modal],
  );
  const { categories, loading: categoriesLoading } = useTaskCategories();
  const { summary } = useTaskSummary();
  const { settings } = useTaskSettings();
  const today = useMemo(() => istToday(), []);
  const canBacklog = Boolean(summary?.has_team || summary?.can_view_all);

  const [form, setForm] = useState<FormState>(() => ({
    title: (prefill?.title || '').slice(0, TASK_TEXT_LIMITS.title),
    description: '',
    expected_outcome: '',
    category_id: '',
    links: {
      customer_id: prefill?.customer_id || '',
      tender_id: prefill?.tender_id || '',
      demo_id: prefill?.demo_id || '',
      service_ticket_id: prefill?.service_ticket_id || '',
      project_id: prefill?.project_id || '',
    },
    assignee_ids: prefill?.assignee_id ? [prefill.assignee_id] : [],
    priority: 'medium',
    start_date: today,
    deadline: '',
    evidence_required: false,
    approval_required: false,
    is_backlog: false,
    frequency: isRecurringType(prefill?.frequency) ? prefill!.frequency as TaskRecurrenceType : 'one_time',
  }));
  const [rec, setRec] = useState<RecurrenceState>(() => {
    const wd = isoWeekday(today);
    return {
      unit: 'weekly',
      interval: '2',
      dailyWeekdays: [1, 2, 3, 4, 5, 6],
      weeklyWeekdays: [wd === 0 ? 1 : wd],
      monthDays: [1],
      monthLast: 'none',
      endMode: 'never',
      endDate: '',
      maxOccurrences: '',
      dueOffset: '0',
      dueTime: '18:00',
      holidayPolicy: null,
      leavePolicy: 'skip',
    };
  });
  // Start the leave policy from the admin default once settings load (the user can still change it).
  const leaveDefault = settings?.default_leave_policy;
  useEffect(() => {
    if (leaveDefault === 'skip' || leaveDefault === 'keep') setRec((r) => ({ ...r, leavePolicy: leaveDefault }));
  }, [leaveDefault]);
  const [evidenceTouched, setEvidenceTouched] = useState(false);
  // "Create a new demo / ticket / customer for this task?" — which popup is open, and which offer the user turned down
  const [creatingLink, setCreatingLink] = useState<CreatableLink | null>(null);
  const [declinedCreate, setDeclinedCreate] = useState<CreatableLink | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [fileProblems, setFileProblems] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formMessage, setFormMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [phase, setPhase] = useState<string | null>(null);
  const [created, setCreated] = useState<Created | null>(null);

  const [assigneeOptions, setAssigneeOptions] = useState<AssigneeOption[]>([]);
  const [assigneesLoading, setAssigneesLoading] = useState(true);
  const [check, setCheck] = useState<CheckResult | null>(null);
  const [preview, setPreview] = useState<OccurrencePreviewRow[] | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<Record<string, string>>({});

  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const previewSeq = useRef(0);
  const checkSeq = useRef(0);

  const recurring = form.frequency !== 'one_time';
  const unit: Unit = form.frequency === 'custom' ? rec.unit : form.frequency === 'one_time' ? 'weekly' : form.frequency;
  // Daily work skips holidays; weekly/monthly follow the admin default (Task Settings) unless the user picks one.
  const holidayPolicy = rec.holidayPolicy ?? (unit === 'daily' ? 'skip' : ((settings?.default_holiday_policy as TaskHolidayPolicy | undefined) ?? defaultHolidayPolicy(unit)));
  const category: TaskCategory | undefined = categories.find((c) => c.id === form.category_id);
  const requiredTypes = category?.requires_link_type ? REQUIRED_LINKS[category.requires_link_type] || [] : [];
  const links = form.links;
  const linked = Boolean(links.customer_id || links.tender_id || links.demo_id || links.service_ticket_id);
  const offerType = category?.requires_link_type as CreatableLink | undefined;
  const createOffer: CreatableLink | null =
    offerType && offerType in CREATE_OFFER && !links[CREATE_OFFER[offerType].field] && declinedCreate !== offerType && !created ? offerType : null;
  // demo / service tasks also accept just the customer
  const linkSatisfied = !category?.requires_link_type || requiredTypes.length === 0 || (requiredTypes.length > 1 ? requiredTypes.some((t) => links[LINK_FIELD[t]]) : Boolean(links[LINK_FIELD[requiredTypes[0]]]));
  const pickerTypes: LinkType[] = !linkSatisfied && !createOffer ? requiredTypes : [];
  const linkedTypes = LINK_TYPES.filter((t) => links[LINK_FIELD[t]] && !pickerTypes.includes(t));
  const linkError = (['customer_id', 'tender_id', 'demo_id', 'service_ticket_id'] as const).map((k) => errors[k]).find(Boolean);
  const selectedAssignees = useMemo(() => form.assignee_ids.map((id) => assigneeOptions.find((o) => o.id === id)).filter((o): o is AssigneeOption => Boolean(o)), [form.assignee_ids, assigneeOptions]);
  const nameOf = useCallback((id: string) => assigneeOptions.find((o) => o.id === id)?.full_name || 'Assignee', [assigneeOptions]);
  const count = form.assignee_ids.length;
  const dirty = !created && Boolean(form.title.trim() || form.description.trim() || form.expected_outcome.trim() || files.length);

  // ------------------------------------------------------------------ state helpers
  const clearErrors = (...keys: string[]) =>
    setErrors((prev) => {
      if (!keys.some((k) => prev[k])) return prev;
      const next = { ...prev };
      for (const k of keys) delete next[k];
      return next;
    });
  const update = (patch: Partial<FormState>) => {
    setForm((f) => ({ ...f, ...patch }));
    clearErrors(...Object.keys(patch));
  };
  const updateRec = (patch: Partial<RecurrenceState>, errorKeys: string[] = []) => {
    setRec((r) => ({ ...r, ...patch }));
    clearErrors(...errorKeys, 'recurrence_rule', 'recurrence_rule.freq', 'recurrence_rule.interval', 'recurrence_rule.weekdays', 'recurrence_rule.month_days');
  };
  const setLink = (t: LinkType, id: string) => {
    const field = LINK_FIELD[t];
    setForm((f) => ({ ...f, links: { ...f.links, [field]: id } }));
    // A demo / service task accepts either picker, so clear both errors.
    clearErrors(field, 'demo_id', 'service_ticket_id', 'customer_id');
  };
  /** A record created from the offer: link it, and its customer too when the task has none yet. */
  const linkCreated = (t: CreatableLink, id: string, organisationId?: string | null) => {
    setLink(t, id);
    if (t !== 'customer' && organisationId && !form.links.customer_id) setLink('customer', organisationId);
  };
  const setCategory = useCallback(
    (id: string) => {
      const cat = categories.find((c) => c.id === id);
      setForm((f) => ({ ...f, category_id: id, evidence_required: evidenceTouched ? f.evidence_required : Boolean(cat?.default_evidence_required) }));
      clearErrors('category_id', 'customer_id', 'tender_id', 'demo_id', 'service_ticket_id');
    },
    [categories, evidenceTouched],
  );
  const setFrequency = (freq: TaskRecurrenceType) => {
    setForm((f) => ({ ...f, frequency: freq, start_date: freq !== 'one_time' && (!f.start_date || f.start_date < today) ? today : f.start_date }));
    clearErrors('recurrence_type', 'start_date', 'deadline');
  };

  // Default category once categories load: from the deep-link (tender → Tender-related …) or General.
  useEffect(() => {
    if (!categories.length || form.category_id) return;
    const byLink = (t: string) => categories.find((c) => c.requires_link_type === t);
    const wanted =
      (prefill?.category_id && categories.find((c) => c.id === prefill.category_id)) ||
      (prefill?.tender_id && byLink('tender')) ||
      (prefill?.demo_id && byLink('demo')) ||
      (prefill?.service_ticket_id && byLink('service')) ||
      (prefill?.customer_id && byLink('customer')) ||
      categories.find((c) => c.code === 'GENERAL') ||
      null;
    if (wanted) setCategory(wanted.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categories]);

  // Warn before leaving with unsaved input.
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
    if (dirty && !window.confirm('Discard this task? Nothing has been saved yet.')) return;
    if (modal && onClose) onClose();
    else router.push(href);
  };

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  // ------------------------------------------------------------------ assignee options (leave on the deadline / series start)
  const deadlineDate = form.deadline.split('T')[0];
  const onDate = recurring ? form.start_date : deadlineDate;
  useEffect(() => {
    const t = window.setTimeout(() => {
      setAssigneesLoading(true);
      api
        .get<AssigneeOption[]>('/tasks/lookups/assignees', /^\d{4}-\d{2}-\d{2}$/.test(onDate || '') ? { on_date: onDate } : undefined)
        .then(setAssigneeOptions)
        .catch(() => setAssigneeOptions([]))
        .finally(() => setAssigneesLoading(false));
    }, 300);
    return () => window.clearTimeout(t);
  }, [onDate]);

  // ------------------------------------------------------------------ recurrence: client rules (shared with the API) + live preview
  const ruleCheck = useMemo(() => validateRecurrenceRule(form.frequency, rawRule(form.frequency, rec)), [form.frequency, rec]);
  const scheduleErrors = useMemo(() => {
    const e: Record<string, string> = {};
    if (!recurring) return e;
    if (!form.start_date) e.start_date = 'Series start date is required.';
    else if (form.start_date < today) e.start_date = 'A recurring series cannot start in the past.';
    if (rec.endMode === 'on_date') {
      if (!rec.endDate) e.end_date = 'Pick the date the series ends.';
      else if (form.start_date && rec.endDate < form.start_date) e.end_date = 'End date must be on or after the start date.';
    }
    if (rec.endMode === 'after') {
      const n = Number(rec.maxOccurrences);
      if (rec.maxOccurrences.trim() === '' || !Number.isInteger(n) || n < 1 || n > 1000) e.max_occurrences = 'Enter a whole number between 1 and 1000.';
    }
    const off = Number(rec.dueOffset);
    if (rec.dueOffset.trim() === '' || !Number.isInteger(off) || off < 0 || off > 60) e.due_offset_days = 'Due after must be a whole number between 0 and 60.';
    if (!TIME_RE.test(rec.dueTime)) e.due_time = 'Due time must be HH:mm.';
    return e;
  }, [recurring, form.start_date, rec, today]);
  const liveErrors = useMemo(() => (recurring ? { ...ruleCheck.errors, ...scheduleErrors } : {}), [recurring, ruleCheck.errors, scheduleErrors]);
  const fe = (key: string): string | undefined => errors[key] || (liveErrors as Record<string, string>)[key];

  const scheduleFields = useMemo(
    () =>
      recurring && ruleCheck.rule
        ? {
            recurrence_type: form.frequency,
            recurrence_rule: ruleCheck.rule,
            start_date: form.start_date,
            end_date: rec.endMode === 'on_date' ? rec.endDate : null,
            max_occurrences: rec.endMode === 'after' ? Number(rec.maxOccurrences) : null,
            due_offset_days: Number(rec.dueOffset),
            due_time: rec.dueTime,
            holiday_policy: holidayPolicy,
            leave_policy: rec.leavePolicy,
          }
        : null,
    [recurring, ruleCheck.rule, form.frequency, form.start_date, rec, holidayPolicy],
  );
  const previewBody = scheduleFields && !Object.keys(scheduleErrors).length ? { ...scheduleFields, assignee_id: form.assignee_ids[0] || undefined, count: 10 } : null;
  const previewKey = previewBody ? JSON.stringify(previewBody) : '';

  useEffect(() => {
    const seq = ++previewSeq.current;
    if (!previewKey) {
      setPreview(null);
      setPreviewLoading(false);
      setPreviewError({});
      return;
    }
    setPreviewLoading(true);
    const t = window.setTimeout(async () => {
      try {
        const rows = await api.post<OccurrencePreviewRow[]>('/task-templates/preview', JSON.parse(previewKey));
        if (seq !== previewSeq.current) return;
        setPreview(rows);
        setPreviewError({});
      } catch (e) {
        if (seq !== previewSeq.current) return;
        setPreview(null);
        const errs = fieldErrors(e);
        setPreviewError(Object.keys(errs).length ? errs : { _: errorMessage(e, 'Could not preview the schedule.') });
      } finally {
        if (seq === previewSeq.current) setPreviewLoading(false);
      }
    }, 400);
    return () => window.clearTimeout(t);
  }, [previewKey]);

  // ------------------------------------------------------------------ pre-flight (scope per assignee, leave / holiday warnings)
  const checkKey = count
    ? JSON.stringify({
        assignee_ids: form.assignee_ids,
        start_date: form.start_date || undefined,
        deadline: recurring ? undefined : form.deadline || undefined,
        customer_id: links.customer_id || undefined,
        tender_id: links.tender_id || undefined,
        demo_id: links.demo_id || undefined,
        service_ticket_id: links.service_ticket_id || undefined,
      })
    : '';
  useEffect(() => {
    const seq = ++checkSeq.current;
    if (!checkKey) {
      setCheck(null);
      return;
    }
    const t = window.setTimeout(() => {
      api
        .post<CheckResult>('/tasks/check', JSON.parse(checkKey))
        .then((r) => seq === checkSeq.current && setCheck(r))
        .catch(() => seq === checkSeq.current && setCheck(null));
    }, 500);
    return () => window.clearTimeout(t);
  }, [checkKey]);

  const scopeProblems = (check?.assignees || []).filter((a) => !a.ok && form.assignee_ids.includes(a.assignee_id));
  // Start-date warning is shown inline; leave on the deadline is shown under the assignee picker.
  const checkWarnings = (check?.warnings || []).filter((w) => w.field !== 'start_date' && !(w.assignee_id && /leave/i.test(w.message) && selectedAssignees.some((s) => s.id === w.assignee_id && s.on_leave)));

  // ------------------------------------------------------------------ files
  const addFiles = (list: FileList | File[] | null) => {
    if (!list) return;
    const problems: string[] = [];
    const ok: File[] = [];
    for (const f of Array.from(list)) {
      const ext = (f.name.split('.').pop() || '').toLowerCase();
      if (!FILE_EXTS.includes(ext) && !FILE_MIMES.includes(f.type)) problems.push(`${f.name}: only PDF, Word, Excel, JPG or PNG files are accepted.`);
      else if (f.size > MAX_FILE_MB * 1024 * 1024) problems.push(`${f.name} is larger than ${MAX_FILE_MB} MB.`);
      else ok.push(f);
    }
    const room = Math.max(0, MAX_FILES - files.length);
    if (ok.length > room) problems.push(`At most ${MAX_FILES} files per task — ${ok.length - room} not added.`);
    setFiles((prev) => [...prev, ...ok.slice(0, room)]);
    setFileProblems(problems.length ? problems.join(' ') : null);
    clearErrors('files');
  };

  // ------------------------------------------------------------------ validation (mirrors the API; the server stays authoritative)
  const validate = (): Record<string, string> => {
    const e: Record<string, string> = {};
    const title = form.title.trim();
    if (!title) e.title = 'Title is required.';
    else if (title.length > TASK_TEXT_LIMITS.title) e.title = `Title must be at most ${TASK_TEXT_LIMITS.title} characters.`;
    if (form.description.length > TASK_TEXT_LIMITS.description) e.description = `Description must be at most ${TASK_TEXT_LIMITS.description} characters.`;
    if (form.expected_outcome.length > TASK_TEXT_LIMITS.expected_outcome) e.expected_outcome = `Expected outcome must be at most ${TASK_TEXT_LIMITS.expected_outcome} characters.`;
    if (!category) e.category_id = 'Choose a category.';
    switch (category?.requires_link_type) {
      case 'customer':
        if (!links.customer_id) e.customer_id = `A ${category.name} task needs a customer.`;
        break;
      case 'tender':
        if (!links.tender_id) e.tender_id = `A ${category.name} task needs a tender.`;
        break;
      case 'demo':
        if (!links.demo_id && !links.customer_id) e.demo_id = `A ${category.name} task needs a demo (or at least the customer).`;
        break;
      case 'service':
        if (!links.service_ticket_id && !links.customer_id) e.service_ticket_id = `A ${category.name} task needs a service ticket (or at least the customer).`;
        break;
    }
    if (!count) e.assignee_ids = 'Choose at least one assignee.';
    else if (count > TASK_MAX_BULK_ASSIGNEES) e.assignee_ids = `You can assign to at most ${TASK_MAX_BULK_ASSIGNEES} people at once.`;
    if (!recurring) {
      const inst = deadlineInstant(form.deadline);
      if (!form.deadline) e.deadline = 'Deadline is required.';
      else if (!inst) e.deadline = 'Deadline must be a valid date or date-time.';
      else if (form.start_date && deadlineDate < form.start_date) e.deadline = 'Deadline must be on or after the start date.';
      else if (inst.getTime() < Date.now() && !(canBacklog && form.is_backlog)) {
        e.deadline = canBacklog ? 'Deadline is in the past. Pick a future deadline, or tick "Backlog entry" to record already-late work.' : 'Deadline is in the past. Pick a future deadline.';
      }
    } else {
      Object.assign(e, ruleCheck.errors, scheduleErrors);
    }
    return e;
  };

  const scrollToFirst = (errs: Record<string, string>) => {
    const key = FIELD_ORDER.find((k) => errs[k]);
    const el = document.getElementById(key ? anchorId(key) : 'tf-form-message');
    if (!el) return;
    const reveal = () => {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const focusable = el.querySelector<HTMLElement>('input:not([type=hidden]):not(.sr-only), textarea, button');
      focusable?.focus({ preventScroll: true });
    };
    // In the two-step popup the first error can sit on the step that is not open. FormSteps opens the
    // step holding an invalid field, so flag the field's anchor, then scroll once that step is shown.
    if (el.closest('[hidden]')) {
      el.dispatchEvent(new Event('invalid', { cancelable: true }));
      window.requestAnimationFrame(reveal);
    } else reveal();
  };

  // ------------------------------------------------------------------ submit
  // Synchronous guard: a double-click fires two submits before `submitting` re-renders the button, which created two
  // identical tasks (QA BUG-022). Held from the request until it fails; after a success the form is done.
  const submitInFlight = useRef(false);
  const submit = async (ev?: React.FormEvent) => {
    ev?.preventDefault();
    if (submitting || created || submitInFlight.current) return;
    setFormMessage(null);
    const clientErrors = validate();
    setErrors(clientErrors);
    if (Object.keys(clientErrors).length) {
      window.setTimeout(() => scrollToFirst(clientErrors), 0);
      return;
    }
    submitInFlight.current = true;
    setSubmitting(true);
    setPhase(recurring ? 'Creating the series…' : count > 1 ? `Creating ${count} tasks…` : 'Creating the task…');
    const body: Record<string, unknown> = {
      title: form.title.trim(),
      description: form.description.trim() || null,
      expected_outcome: form.expected_outcome.trim() || null,
      category_id: form.category_id,
      customer_id: links.customer_id || null,
      tender_id: links.tender_id || null,
      demo_id: links.demo_id || null,
      service_ticket_id: links.service_ticket_id || null,
      project_id: links.project_id || null,
      assignee_ids: form.assignee_ids,
      priority: form.priority,
      start_date: form.start_date || null,
      evidence_required: form.evidence_required,
      approval_required: form.approval_required,
      recurrence_type: form.frequency,
    };
    if (recurring && scheduleFields) Object.assign(body, scheduleFields);
    else {
      body.deadline = form.deadline;
      body.is_backlog = canBacklog && form.is_backlog;
    }
    try {
      if (recurring) {
        const res = await api.post<{ data: { id: string; title: string }[]; generated: number; kind: 'recurring' }>('/tasks', body);
        notifyTasksChanged();
        const n = res.data.length;
        push('success', `${n > 1 ? `${n} recurring series created` : 'Recurring series created'} — ${res.generated} upcoming task${res.generated === 1 ? '' : 's'} generated.`);
        setCreated({ href: `/tasks/templates/${res.data[0]?.id}`, message: 'Series created.', failures: [] });
        const seriesHref = res.data[0] ? `/tasks/templates/${res.data[0].id}` : '/tasks?section=recurring';
        if (modal) {
          onDirtyChange?.(false);
          onCreated?.({ message: `${n > 1 ? `${n} recurring series created` : 'Recurring series created'} — ${res.generated} upcoming task${res.generated === 1 ? '' : 's'} generated.`, href: seriesHref });
          onClose?.();
        } else router.push(seriesHref);
        return;
      }
      const res = await api.post<{ data: { id: string; task_number: string; title: string }[]; group_id: string | null; warnings: { field: string; message: string }[] }>('/tasks', body);
      const tasks = res.data || [];
      const failures: string[] = [];
      if (files.length && tasks.length) {
        for (let i = 0; i < tasks.length; i++) {
          setPhase(tasks.length > 1 ? `Attaching files (${i + 1}/${tasks.length})…` : 'Attaching files…');
          const failed = await uploadTaskFiles(tasks[i].id, files, 'supporting_doc');
          failures.push(...failed.map((f) => (tasks.length > 1 ? `${tasks[i].task_number} — ${f}` : f)));
        }
      }
      notifyTasksChanged();
      const href = tasks.length === 1 ? `/tasks/${tasks[0].id}` : res.group_id ? `/tasks/team?group_id=${res.group_id}` : '/tasks/team';
      const message = tasks.length === 1 ? `${tasks[0].task_number} created.` : `${tasks.length} tasks created — one per person.`;
      if (failures.length) {
        setCreated({ href, message, failures });
        push('error', 'Some supporting documents could not be attached.');
        window.setTimeout(() => document.getElementById('tf-created')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 0);
      } else {
        setCreated({ href, message, failures: [] });
        if (modal) {
          onDirtyChange?.(false);
          onCreated?.({ message, href });
          onClose?.();
        } else {
          push('success', message);
          router.push(href);
        }
      }
    } catch (err) {
      submitInFlight.current = false;
      const errs = { ...fieldErrors(err) };
      if ((err as any)?.data?.code === 'NO_APPROVER') errs.approval_required = errorMessage(err);
      setErrors(errs);
      const unhandled = Object.keys(errs).filter((k) => !HANDLED_KEYS.has(k));
      if (!Object.keys(errs).length || unhandled.length) setFormMessage(Object.keys(errs).length ? 'Please correct the highlighted fields.' : errorMessage(err));
      window.setTimeout(() => scrollToFirst(errs), 0);
    } finally {
      setSubmitting(false);
      setPhase(null);
    }
  };

  // ------------------------------------------------------------------ render helpers
  const linkHelper = (t: LinkType) =>
    t === 'tender' || t === 'demo' || t === 'service' ? `The customer is filled in automatically from the ${LINK_NAME[t].toLowerCase()}.` : t === 'project' ? 'Optional internal project.' : undefined;
  const linkPicker = (t: LinkType, required = true) => {
    const field = LINK_FIELD[t];
    const eitherOr = category?.requires_link_type === 'demo' || category?.requires_link_type === 'service';
    return (
      <div key={t} id={`tf-${field}`} className="relative">
        <LinkPicker
          type={t}
          value={links[field]}
          onChange={(id) => setLink(t, id)}
          required={required && !eitherOr}
          error={errors[field]}
          helperText={eitherOr && required ? (t === 'customer' ? `Or just the customer, if there is no ${category?.requires_link_type === 'demo' ? 'demo' : 'ticket'} yet.` : `${linkHelper(t)} Pick this or the customer.`) : linkHelper(t)}
        />
      </div>
    );
  };

  // Recurrence errors not rendered next to a specific control for the current unit are listed under the builder.
  const renderedRuleKeys = new Set<string>([
    ...(form.frequency === 'custom' ? ['recurrence_rule.interval'] : []),
    ...(unit === 'monthly' ? ['recurrence_rule.month_days'] : ['recurrence_rule.weekdays']),
  ]);
  const ruleErrorList = recurring ? Object.entries({ ...liveErrors, ...errors }).filter(([k]) => k.startsWith('recurrence_rule') && !renderedRuleKeys.has(k)) : [];
  const otherErrors = Object.entries(errors).filter(([k]) => !HANDLED_KEYS.has(k));
  const submitLabel = recurring ? (count > 1 ? `Create ${count} recurring series` : 'Create recurring task') : count > 1 ? `Assign ${count} tasks` : 'Create task';
  // Phones: the footer buttons share the width, so the long recurring labels get a short form.
  const submitShort = recurring ? (count > 1 ? `Create ${count} series` : 'Create series') : submitLabel;
  const disabled = submitting || Boolean(created);

  // `page`: which step of the popup the section sits on (0 = what & who, 1 = when & rules). The full page ignores it.
  const sections: { title: string; icon: React.ReactNode; description?: string; page: number; node: React.ReactNode }[] = [
    {
      title: 'Task',
      page: 0,
      icon: <ListChecks />,
      description: 'What needs to be done — title, details and category.',
      node: (
          <Panel className="p-4 sm:p-5 space-y-4 overflow-visible">
            <Title icon={<ListChecks className="h-4 w-4" />} title="What needs to be done" />
            <div id="tf-title">
              <Input
                id="tf-title-input"
                label="Title *"
                value={form.title}
                maxLength={TASK_TEXT_LIMITS.title}
                placeholder="e.g. Submit pre-bid queries for the CRPF tender"
                onChange={(e) => update({ title: e.target.value })}
                error={errors.title}
                helperText={`${form.title.length}/${TASK_TEXT_LIMITS.title}`}
                disabled={disabled}
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
              <div id="tf-category_id">
                <Select
                  id="tf-category-select"
                  label="Category *"
                  value={form.category_id}
                  onChange={(e) => setCategory(e.target.value)}
                  disabled={disabled || categoriesLoading}
                  options={[{ value: '', label: categoriesLoading ? 'Loading categories…' : 'Choose a category…' }, ...categories.map((c) => ({ value: c.id, label: c.name }))]}
                  error={errors.category_id}
                  helperText={category ? (category.requires_link_type ? CATEGORY_HINT[category.requires_link_type] : 'No link required.') + (category.default_evidence_required ? ' Evidence is required by default.' : '') : undefined}
                />
              </div>
              <div id="tf-priority">
                <Select
                  id="tf-priority-select"
                  label="Priority"
                  value={form.priority}
                  onChange={(e) => update({ priority: e.target.value as TaskPriority })}
                  disabled={disabled}
                  searchable={false}
                  options={TASK_PRIORITIES.map((p) => ({ value: p, label: TASK_PRIORITY_LABELS[p] }))}
                  error={errors.priority}
                />
              </div>
            </div>
            {/* What the task is linked to: set from where it was opened, or created on the spot. A picker shows
                only when the category needs a link that is still missing. */}
            {(linkedTypes.length > 0 || createOffer || pickerTypes.length > 0 || linkError) && (
              <div id="tf-links" className="space-y-3">
                {linkedTypes.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs font-semibold text-[#4A5568]">Linked to</span>
                    {linkedTypes.map((t) => (
                      <LinkedChip key={t} type={t} id={links[LINK_FIELD[t]]} onRemove={disabled ? undefined : () => setLink(t, '')} />
                    ))}
                  </div>
                )}
                {createOffer && (
                  <div className="flex flex-col gap-3 rounded-lg border border-[#D0E5E3] bg-[#E3EFEE] p-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-[#0B4A4E]">{CREATE_OFFER[createOffer].question}</p>
                      <p className="text-[11px] text-[#4A5568]">{CREATE_OFFER[createOffer].detail}</p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <Button type="button" size="xs" variant="ghost" onClick={() => setDeclinedCreate(createOffer)}>
                        No
                      </Button>
                      <Button type="button" size="xs" variant="primary" leftIcon={<Plus className="h-3 w-3" />} onClick={() => setCreatingLink(createOffer)}>
                        {CREATE_OFFER[createOffer].yes}
                      </Button>
                    </div>
                  </div>
                )}
                {pickerTypes.length > 0 && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">{pickerTypes.map((t) => linkPicker(t))}</div>
                )}
                {linkError && pickerTypes.length === 0 && <p className="text-xs font-medium text-[#881337]">{linkError}</p>}
              </div>
            )}
            {/* The popups are portalled out of this form in the DOM, but React still bubbles their submit up the
                component tree — stop it here so creating a demo / ticket / customer never also submits the task. */}
            <div className="contents" onSubmit={(e) => e.stopPropagation()}>
              <CreateDemoModal
                isOpen={creatingLink === 'demo'}
                onClose={() => setCreatingLink(null)}
                prefill={{ organisation_id: links.customer_id || null, tender_id: links.tender_id || null, purpose: form.title.trim() || null }}
                onCreated={(d) => {
                  linkCreated('demo', d.id, d.organisation_id);
                  push('success', `Demo ${d.demo_no} requested and linked to this task.`);
                }}
              />
              <CreateServiceTicketModal
                isOpen={creatingLink === 'service'}
                onClose={() => setCreatingLink(null)}
                prefill={{ organisation_id: links.customer_id || null, issue: form.description.trim() || form.title.trim() || null }}
                onCreated={(t) => {
                  linkCreated('service', t.id, t.organisation_id);
                  push('success', `Service ticket ${t.ticket_no || ''} logged and linked to this task.`.replace('  ', ' '));
                }}
              />
              <QuickCustomerModal
                isOpen={creatingLink === 'customer'}
                onClose={() => setCreatingLink(null)}
                onCreated={(org) => {
                  linkCreated('customer', org.id);
                  push('success', `${org.name} linked to this task.`);
                }}
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
              <div id="tf-description">
                <Textarea
                  id="tf-description-input"
                  label="Description"
                  rows={4}
                  value={form.description}
                  maxLength={TASK_TEXT_LIMITS.description}
                  placeholder="Context, instructions, people to contact…"
                  onChange={(e) => update({ description: e.target.value })}
                  error={errors.description}
                  disabled={disabled}
                />
              </div>
              <div id="tf-expected_outcome">
                <Textarea
                  id="tf-expected-outcome-input"
                  label="Expected outcome"
                  rows={4}
                  value={form.expected_outcome}
                  maxLength={TASK_TEXT_LIMITS.expected_outcome}
                  placeholder="What does “done” look like? e.g. Queries uploaded on GeM and acknowledgement saved."
                  onChange={(e) => update({ expected_outcome: e.target.value })}
                  error={errors.expected_outcome}
                  helperText="Used by the approver to judge completion."
                  disabled={disabled}
                />
              </div>
            </div>
          </Panel>
      ),
    },
    {
      title: 'Assign',
      page: 0,
      icon: <Users />,
      description: 'Who should do it.',
      node: (
          <Panel className="p-4 sm:p-5 space-y-4 overflow-visible">
            <Title
              icon={<Users className="h-4 w-4" />}
              title="Assign to"
              right={assigneesLoading ? <Spinner size="sm" /> : undefined}
            />
            <div id="tf-assignee_ids">
              <AssigneePicker value={form.assignee_ids} onChange={(v) => update({ assignee_ids: v })} options={assigneeOptions} allowPeers={linked} error={errors.assignee_ids} />
              {!linked && <p className="text-[11px] text-[#4A5568] mt-1">Colleagues outside your team can be chosen once the task is linked to a customer, tender, demo or service ticket.</p>}
            </div>

            {count > 1 && (
              <InfoCallout variant="info" title={recurring ? `Creates ${count} separate recurring series` : `Creates ${count} separate tasks`}>
                {recurring ? 'One series per person, each generating its own tasks.' : 'Creates one separate task per person, tracked independently.'}
              </InfoCallout>
            )}

            {selectedAssignees.length === 1 && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Input id="tf-manager" label="Reporting manager" value={selectedAssignees[0].manager_name || 'No manager set'} readOnly disabled helperText="Filled in from the employee record." />
                <Input id="tf-department" label="Department" value={selectedAssignees[0].department_name || 'Not set'} readOnly disabled />
              </div>
            )}

            {selectedAssignees.some((s) => s.on_leave) && (
              <InfoCallout variant="warning" title="Approved leave">
                <ul className="space-y-1 text-xs">
                  {selectedAssignees
                    .filter((s) => s.on_leave)
                    .map((s) => (
                      <li key={s.id}>
                        <span className="font-semibold">{s.full_name}</span> is on approved {s.on_leave!.leave_type.replace(/_/g, ' ')} leave {formatTaskDate(s.on_leave!.from_date)} → {formatTaskDate(s.on_leave!.to_date)}
                        {recurring ? ' (on the series start date). Occurrences during leave follow the leave policy below.' : ', covering the deadline.'}
                      </li>
                    ))}
                </ul>
              </InfoCallout>
            )}

            {scopeProblems.length > 0 && (
              <InfoCallout variant="danger" title="Cannot assign to everyone selected">
                <ul className="space-y-1 text-xs">
                  {scopeProblems.map((p) => (
                    <li key={p.assignee_id}>
                      <span className="font-semibold">{nameOf(p.assignee_id)}:</span> {p.reason}
                    </li>
                  ))}
                </ul>
              </InfoCallout>
            )}
          </Panel>
      ),
    },
    {
      title: 'Schedule',
      page: 1,
      icon: <CalendarClock />,
      description: 'When it is due. Dates and times are IST.',
      node: (
          <Panel className="p-4 sm:p-5 space-y-4 overflow-visible">
            <Title icon={<CalendarClock className="h-4 w-4" />} title="Schedule" description="Dates and times are IST." />

            <fieldset id="tf-recurrence_type">
              <legend className="block text-xs font-semibold text-[#14213D] mb-1.5">Frequency</legend>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                {TASK_RECURRENCE_TYPES.map((t, i) => (
                  <label
                    key={t}
                    className={`flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors sm:min-h-0 ${
                      form.frequency === t ? 'border-[#0F5E63] bg-[#E3EFEE] text-[#0F5E63]' : 'border-[#C9C4B8] bg-white text-[#14213D] hover:border-[#0F5E63]'
                    } ${i === TASK_RECURRENCE_TYPES.length - 1 ? 'col-span-2 sm:col-span-1' : ''}`}
                  >
                    <input type="radio" name="frequency" value={t} aria-label={TASK_RECURRENCE_LABELS[t]} checked={form.frequency === t} onChange={() => setFrequency(t)} disabled={disabled} className="accent-[#0F5E63]" />
                    {t !== 'one_time' && <Repeat className="h-3.5 w-3.5 shrink-0" aria-hidden />}
                    <span className="truncate">{TASK_RECURRENCE_LABELS[t]}</span>
                  </label>
                ))}
              </div>
              <FieldError message={errors.recurrence_type} />
            </fieldset>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
              <div id="tf-start_date">
                <Input
                  id="tf-start-date-input"
                  type="date"
                  label={recurring ? 'Series starts on *' : 'Start date'}
                  value={form.start_date}
                  min={recurring ? today : undefined}
                  onChange={(e) => update({ start_date: e.target.value })}
                  error={fe('start_date')}
                  disabled={disabled}
                />
                {!recurring && form.start_date && form.start_date < today && <WarnLine>Start date is in the past.</WarnLine>}
              </div>
              {!recurring && (
                <div id="tf-deadline">
                  <DeadlineInput
                    label="Deadline"
                    required
                    value={form.deadline}
                    min={form.start_date || undefined}
                    onChange={(v) => update({ deadline: v })}
                    error={errors.deadline}
                    helperText={(() => {
                      const inst = deadlineInstant(form.deadline);
                      if (inst && inst.getTime() < Date.now() && !form.is_backlog)
                        return canBacklog ? 'This deadline has already passed — tick “Backlog entry” below to record already-late work.' : 'This deadline has already passed.';
                      return undefined;
                    })()}
                  />
                </div>
              )}
            </div>

            {recurring && (
              <div id="tf-recurrence" className="rounded-[14px] border border-[#DCD8CE] bg-[#FBFAF7] p-3 sm:p-4 space-y-4">
                {form.frequency === 'custom' && (
                  <div className="grid grid-cols-2 gap-3 items-start">
                    <Input
                      id="tf-interval"
                      label="Repeat every *"
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={rec.unit === 'daily' ? 365 : rec.unit === 'weekly' ? 52 : 12}
                      value={rec.interval}
                      onChange={(e) => updateRec({ interval: e.target.value.replace(/[^\d]/g, '') })}
                      error={fe('recurrence_rule.interval')}
                      disabled={disabled}
                    />
                    <Select
                      id="tf-unit"
                      label="Unit"
                      value={rec.unit}
                      searchable={false}
                      onChange={(e) => updateRec({ unit: e.target.value as Unit })}
                      disabled={disabled}
                      options={[
                        { value: 'daily', label: Number(rec.interval) === 1 ? 'Day' : 'Days' },
                        { value: 'weekly', label: Number(rec.interval) === 1 ? 'Week' : 'Weeks' },
                        { value: 'monthly', label: Number(rec.interval) === 1 ? 'Month' : 'Months' },
                      ]}
                    />
                  </div>
                )}

                {unit === 'daily' && (
                  <WeekdayChips
                    label="On these days"
                    value={rec.dailyWeekdays}
                    onChange={(v) => updateRec({ dailyWeekdays: v })}
                    error={fe('recurrence_rule.weekdays')}
                    hint={rec.dailyWeekdays.length === 0 || rec.dailyWeekdays.length === 7 ? 'Every day of the week.' : 'Only on the highlighted days. Clear all to repeat every day.'}
                  />
                )}
                {unit === 'weekly' && (
                  <WeekdayChips label="On *" value={rec.weeklyWeekdays} onChange={(v) => updateRec({ weeklyWeekdays: v })} error={fe('recurrence_rule.weekdays')} hint="Pick one or more weekdays." />
                )}
                {unit === 'monthly' && (
                  <div>
                    <span className="block text-xs font-semibold text-[#14213D] mb-1.5">On day(s) of the month *</span>
                    <div role="group" aria-label="Days of the month" className="grid grid-cols-7 gap-1.5">
                      {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                        <Chip key={d} on={rec.monthDays.includes(d)} onClick={() => updateRec({ monthDays: toggle(rec.monthDays, d) })} className="h-9 font-mono sm:h-8" ariaLabel={`Day ${d}`} disabled={disabled}>
                          {d}
                        </Chip>
                      ))}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Chip on={rec.monthLast === 'last_day'} onClick={() => updateRec({ monthLast: rec.monthLast === 'last_day' ? 'none' : 'last_day' })} className="h-10 px-3 sm:h-8" disabled={disabled}>
                        Last day
                      </Chip>
                      <Chip on={rec.monthLast === 'last_working_day'} onClick={() => updateRec({ monthLast: rec.monthLast === 'last_working_day' ? 'none' : 'last_working_day' })} className="h-10 px-3 sm:h-8" disabled={disabled}>
                        Last working day
                      </Chip>
                    </div>
                    {fe('recurrence_rule.month_days') ? (
                      <FieldError message={fe('recurrence_rule.month_days')} />
                    ) : (
                      <p className="text-[11px] text-[#4A5568] mt-1">Days 29–31 fall back to the last day of shorter months. “Last working day” skips weekly offs and holidays.</p>
                    )}
                  </div>
                )}

                {ruleCheck.rule && <p className="text-xs font-semibold text-[#0F5E63]">{describeRecurrence(form.frequency, ruleCheck.rule)}</p>}
                {ruleErrorList.length > 0 && (
                  <ul className="space-y-0.5">
                    {ruleErrorList.map(([k, v]) => (
                      <li key={k} className="text-xs text-[#881337] font-medium">
                        {v}
                      </li>
                    ))}
                  </ul>
                )}

                <fieldset id="tf-end_date" className="space-y-2">
                  <legend className="block text-xs font-semibold text-[#14213D] mb-1.5">Ends</legend>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {(
                      [
                        ['never', 'Never'],
                        ['on_date', 'On a date'],
                        ['after', 'After N occurrences'],
                      ] as [EndMode, string][]
                    ).map(([m, label]) => (
                      <label
                        key={m}
                        className={`flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold sm:min-h-0 ${rec.endMode === m ? 'border-[#0F5E63] bg-[#E3EFEE] text-[#0F5E63]' : 'border-[#C9C4B8] bg-white text-[#14213D]'}`}
                      >
                        <input type="radio" name="end_mode" value={m} aria-label={label} checked={rec.endMode === m} onChange={() => updateRec({ endMode: m }, ['end_date', 'max_occurrences'])} disabled={disabled} className="accent-[#0F5E63]" />
                        {label}
                      </label>
                    ))}
                  </div>
                  {rec.endMode === 'on_date' && (
                    <Input
                      id="tf-end-date-input"
                      type="date"
                      label="Last date *"
                      min={form.start_date || today}
                      value={rec.endDate}
                      onChange={(e) => updateRec({ endDate: e.target.value }, ['end_date'])}
                      error={fe('end_date')}
                      disabled={disabled}
                    />
                  )}
                  {rec.endMode !== 'on_date' && fe('end_date') && <FieldError message={fe('end_date')} />}
                  {rec.endMode === 'after' && (
                    <div id="tf-max_occurrences">
                      <Input
                        id="tf-max-occurrences-input"
                        type="number"
                        inputMode="numeric"
                        label="Number of occurrences *"
                        min={1}
                        max={1000}
                        value={rec.maxOccurrences}
                        onChange={(e) => updateRec({ maxOccurrences: e.target.value.replace(/[^\d]/g, '') }, ['max_occurrences'])}
                        error={fe('max_occurrences')}
                        helperText="Skipped occurrences (holidays, leave) count towards this number."
                        disabled={disabled}
                      />
                    </div>
                  )}
                  {rec.endMode !== 'after' && fe('max_occurrences') && <FieldError message={fe('max_occurrences')} />}
                </fieldset>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
                  <div id="tf-due_offset_days">
                    <Input
                      id="tf-due-offset-input"
                      type="number"
                      inputMode="numeric"
                      label="Due after (days)"
                      min={0}
                      max={60}
                      value={rec.dueOffset}
                      onChange={(e) => updateRec({ dueOffset: e.target.value.replace(/[^\d]/g, '') }, ['due_offset_days'])}
                      error={fe('due_offset_days')}
                      helperText={Number(rec.dueOffset) > 0 ? `${rec.dueOffset} day(s) after each occurrence` : 'Same day'}
                      disabled={disabled}
                    />
                  </div>
                  <div id="tf-due_time">
                    <Input
                      id="tf-due-time-input"
                      type="time"
                      label="Due time (IST)"
                      value={rec.dueTime}
                      onChange={(e) => updateRec({ dueTime: e.target.value }, ['due_time'])}
                      error={fe('due_time')}
                      disabled={disabled}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-start">
                  <div id="tf-holiday_policy">
                    <Select
                      id="tf-holiday-policy"
                      label="If it falls on a holiday / weekly off"
                      value={holidayPolicy}
                      searchable={false}
                      onChange={(e) => updateRec({ holidayPolicy: e.target.value as TaskHolidayPolicy }, ['holiday_policy'])}
                      options={TASK_HOLIDAY_POLICIES.map((p) => ({ value: p, label: TASK_HOLIDAY_POLICY_LABELS[p] }))}
                      error={errors.holiday_policy}
                      helperText={rec.holidayPolicy ? undefined : `Default for ${unit === 'daily' ? 'daily' : 'weekly / monthly'} work.`}
                      disabled={disabled}
                    />
                  </div>
                  <div id="tf-leave_policy">
                    <Select
                      id="tf-leave-policy"
                      label="If the assignee is on approved leave"
                      value={rec.leavePolicy}
                      searchable={false}
                      onChange={(e) => updateRec({ leavePolicy: e.target.value as TaskLeavePolicy }, ['leave_policy'])}
                      options={(['skip', 'keep'] as TaskLeavePolicy[]).map((p) => ({ value: p, label: TASK_LEAVE_POLICY_LABELS[p] }))}
                      error={errors.leave_policy}
                      helperText="Skipped occurrences are recorded and never counted as missed."
                      disabled={disabled}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-[#14213D]">Next 10 occurrences{form.assignee_ids.length ? ` for ${nameOf(form.assignee_ids[0])}` : ''}</span>
                    {previewLoading && <Spinner size="sm" />}
                  </div>
                  {!previewBody ? (
                    <p className="text-xs text-[#6B7280]">Fix the schedule above to see the upcoming dates.</p>
                  ) : Object.keys(previewError).length ? (
                    <ul className="space-y-0.5">
                      {Object.entries(previewError).map(([k, v]) => (
                        <li key={k} className="text-xs text-[#881337] font-medium">
                          {v}
                        </li>
                      ))}
                    </ul>
                  ) : preview ? (
                    <div className={previewLoading ? 'opacity-60 transition-opacity' : ''}>
                      <OccurrenceList rows={preview} />
                    </div>
                  ) : (
                    <p className="text-xs text-[#6B7280]">Calculating…</p>
                  )}
                  {count > 1 && <p className="text-[11px] text-[#4A5568]">Holidays and leave can differ per person — each series follows its own assignee’s calendar.</p>}
                </div>
              </div>
            )}
          </Panel>
      ),
    },
    {
      title: 'Rules',
      page: 1,
      icon: <ShieldCheck />,
      description: 'What is needed before the task can be closed.',
      node: (
          <Panel className="p-4 sm:p-5 space-y-4 overflow-visible">
            <Title icon={<ShieldCheck className="h-4 w-4" />} title="Completion rules" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
              <div id="tf-evidence_required">
                <Checkbox
                  id="tf-evidence-checkbox"
                  checked={form.evidence_required}
                  onChange={(e) => {
                    setEvidenceTouched(true);
                    update({ evidence_required: e.target.checked });
                  }}
                  disabled={disabled}
                  label="Evidence required"
                  description="To complete, the assignee must attach proof (photo, signed document…) and write remarks."
                />
                <FieldError message={errors.evidence_required} />
              </div>
              <div id="tf-approval_required">
                <Checkbox
                  id="tf-approval-checkbox"
                  checked={form.approval_required}
                  onChange={(e) => update({ approval_required: e.target.checked })}
                  disabled={disabled}
                  label="Approval required"
                  description="Completion goes to the assignee’s manager to approve before it counts as done."
                />
                <FieldError message={errors.approval_required} />
              </div>
              {canBacklog && !recurring && (
                <div id="tf-is_backlog" className="md:col-span-2">
                  <Checkbox
                    id="tf-backlog-checkbox"
                    checked={form.is_backlog}
                    onChange={(e) => update({ is_backlog: e.target.checked, deadline: form.deadline })}
                    disabled={disabled}
                    label="Backlog entry"
                    description="Records already-late work; excluded from compliance metrics. Allows a deadline in the past."
                  />
                  <FieldError message={errors.is_backlog} />
                </div>
              )}
            </div>
          </Panel>
      ),
    },
    {
      title: 'Documents',
      page: 1,
      icon: <Paperclip />,
      description: recurring ? undefined : `PDF, Word, Excel, JPG or PNG · up to ${MAX_FILE_MB} MB each, ${MAX_FILES} files.`,
      node: (
          <Panel className="p-4 sm:p-5 space-y-3 overflow-visible">
            <Title icon={<Paperclip className="h-4 w-4" />} title="Supporting documents" description={recurring ? undefined : `PDF, Word, Excel, JPG or PNG · up to ${MAX_FILE_MB} MB each, ${MAX_FILES} files.`} />
            {recurring ? (
              <p className="text-xs text-[#4A5568]">Files are attached to individual tasks. Once the series is created, open a generated task to attach documents to it.</p>
            ) : (
              <div
                id="tf-files"
                className={`rounded-[14px] border border-dashed p-3 sm:p-4 space-y-3 ${drag ? 'border-[#0F5E63] bg-[#E3EFEE]/40' : 'border-[#C9C4B8] bg-[#FBFAF7]'}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDrag(true);
                }}
                onDragLeave={() => setDrag(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDrag(false);
                  if (!disabled) addFiles(e.dataTransfer.files);
                }}
              >
                <input
                  ref={fileRef}
                  type="file"
                  multiple
                  accept={FILE_ACCEPT}
                  className="hidden"
                  aria-label="Choose supporting documents"
                  onChange={(e) => {
                    addFiles(e.target.files);
                    e.target.value = '';
                  }}
                />
                <input
                  ref={cameraRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  aria-label="Take a photo"
                  onChange={(e) => {
                    addFiles(e.target.files);
                    e.target.value = '';
                  }}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" size="sm" variant="secondary" className="h-10 sm:h-8" leftIcon={<Upload className="h-4 w-4" />} onClick={() => fileRef.current?.click()} disabled={disabled || files.length >= MAX_FILES}>
                    Attach files
                  </Button>
                  <Button type="button" size="sm" variant="secondary" className="h-10 sm:hidden" leftIcon={<Camera className="h-4 w-4" />} onClick={() => cameraRef.current?.click()} disabled={disabled || files.length >= MAX_FILES}>
                    Take photo
                  </Button>
                  <span className="hidden sm:inline text-[11px] text-[#6B7280]">or drop files here</span>
                  {files.length > 0 && <span className="ml-auto text-[11px] font-mono text-[#4A5568]">{files.length}/{MAX_FILES}</span>}
                </div>
                {files.length > 0 && (
                  <ul className="divide-y divide-[#ECE9E2] rounded-lg border border-[#ECE9E2] bg-white">
                    {files.map((f, i) => (
                      <li key={`${f.name}-${i}`} className="flex items-center gap-2 px-3 py-2">
                        <Paperclip className="h-3.5 w-3.5 shrink-0 text-[#4A5568]" />
                        <span className="min-w-0 flex-1 truncate text-xs text-[#14213D]">{f.name}</span>
                        <span className="text-[11px] font-mono text-[#6B7280]">{fileSize(f.size)}</span>
                        <button
                          type="button"
                          aria-label={`Remove ${f.name}`}
                          disabled={disabled}
                          onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                          className="-my-1 p-2 text-[#6B7280] hover:text-[#881337] sm:my-0 sm:p-1"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {count > 1 && files.length > 0 && <p className="text-[11px] text-[#4A5568]">The same files are attached to each of the {count} tasks.</p>}
                {fileProblems && <FieldError message={fileProblems} />}
                <FieldError message={errors.files} />
              </div>
            )}
          </Panel>
      ),
    },
  ];

  const submitButton = (
    <Button type="submit" isLoading={submitting} disabled={disabled} leftIcon={recurring ? <Repeat className="h-4 w-4" /> : <Send className="h-4 w-4" />}>
      <span className="sm:hidden">{submitShort}</span>
      <span className="hidden sm:inline">{submitLabel}</span>
    </Button>
  );
  const createdCallout = (
    <>
      {created && created.failures.length > 0 && (
        <div id="tf-created">
          <InfoCallout variant="warning" title={`${created.message} Some files were not attached.`}>
            <ul className="list-disc pl-4 space-y-0.5 text-xs">
              {created.failures.map((f, i) => (
                <li key={i}>{f}</li>
              ))}
            </ul>
            <p className="text-xs mt-2">You can attach them again from the task page.</p>
            <div className="mt-3">
              <Button type="button" size="sm" onClick={() => router.push(created.href)}>
                {created.href.startsWith('/tasks/team') ? 'Open the tasks' : 'Open the task'}
              </Button>
            </div>
          </InfoCallout>
        </div>
      )}
    </>
  );
  const messages = (
    <>
      {/* ---------------------------------------------------------------- pre-flight warnings */}
      {checkWarnings.length > 0 && (
        <InfoCallout variant="warning" title="Before you assign">
          <ul className="space-y-1 text-xs">
            {checkWarnings.map((w, i) => (
              <li key={i}>{w.message}</li>
            ))}
          </ul>
          <p className="text-[11px] mt-2">These are warnings only — you can still create the task.</p>
        </InfoCallout>
      )}

      {(formMessage || otherErrors.length > 0) && (
        <div id="tf-form-message">
          <InfoCallout variant="danger" title={formMessage || 'Please correct the highlighted fields.'}>
            {otherErrors.length > 0 && (
              <ul className="space-y-0.5 text-xs">
                {otherErrors.map(([k, v]) => (
                  <li key={k}>{v}</li>
                ))}
              </ul>
            )}
          </InfoCallout>
        </div>
      )}
    </>
  );

  if (modal) {
    const hasBanner = Boolean((created && created.failures.length > 0) || checkWarnings.length > 0 || formMessage || otherErrors.length > 0 || phase);
    return (
      <form onSubmit={submit} noValidate aria-busy={submitting}>
        <FormSteps
          steps={sections.map((sec) => ({ title: sec.title, icon: sec.icon, description: sec.description, page: sec.page, content: sec.node }))}
          stepTitles={MODAL_STEP_TITLES}
          banner={
            hasBanner ? (
              <>
                {createdCallout}
                {messages}
                {phase && <p className="text-xs text-[#4A5568]" aria-live="polite">{phase}</p>}
              </>
            ) : undefined
          }
          onCancel={() => leave('/tasks')}
          busy={submitting}
          submit={submitButton}
        />
        <Toaster />
      </form>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-5" aria-busy={submitting}>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="ghost" size="sm" leftIcon={<ArrowLeft className="h-4 w-4" />} onClick={() => leave('/tasks')}>
          Back
        </Button>
        <h2 className="font-serif text-xl text-[#14213D]">{recurring ? 'New recurring task' : 'New task'}</h2>
      </div>

      {createdCallout}

      {sections.map((s) => (
        <React.Fragment key={s.title}>{s.node}</React.Fragment>
      ))}

      {messages}

      {/* ---------------------------------------------------------------- actions (sticky on phones) */}
      <div className="sticky md:static bottom-0 z-30 -mx-4 sm:-mx-6 md:mx-0 border-t md:border-0 border-[#DCD8CE] bg-white/95 md:bg-transparent backdrop-blur md:backdrop-blur-none pl-4 sm:pl-6 pr-20 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] md:p-0 flex items-center gap-2 justify-end">
        <span className="mr-auto min-w-0 truncate text-xs text-[#4A5568]" aria-live="polite">
          {phase || (count > 1 ? `${count} people selected` : '')}
        </span>
        <Button type="button" variant="ghost" onClick={() => leave('/tasks')} disabled={submitting}>
          Cancel
        </Button>
        {submitButton}
      </div>
      <Toaster />
    </form>
  );
};

/** One thing the task is linked to (customer, demo …), named by a lookup of its id. */
const LinkedChip: React.FC<{ type: LinkType; id: string; onRemove?: () => void }> = ({ type, id, onRemove }) => {
  const [option, setOption] = useState<LinkOption | null>(null);
  useEffect(() => {
    let alive = true;
    api
      .get<LinkOption[]>('/tasks/lookups/links', { type, id })
      .then((r) => alive && setOption(r[0] || null))
      .catch(() => alive && setOption(null));
    return () => {
      alive = false;
    };
  }, [type, id]);
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-full border border-[#D0E5E3] bg-[#E3EFEE] py-1 pl-2.5 pr-1.5 text-[11px] font-semibold text-[#0F5E63]">
      <span className="font-medium text-[#4A5568]">{LINK_NAME[type]}:</span>
      <span className="truncate">{option ? option.label : '…'}</span>
      {onRemove && (
        <button type="button" onClick={onRemove} aria-label={`Unlink ${LINK_NAME[type]}`} className="rounded-full p-0.5 text-[#4A5568] hover:text-[#881337]">
          <X className="h-3 w-3" />
        </button>
      )}
    </span>
  );
};
