'use client';

/**
 * Module 8 web helpers: response types, data hooks (summary/badges, categories, settings) and small
 * formatters. Rules, labels and the transition map come from @arihant/shared so the UI and API agree.
 */
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { getSocket } from '@/lib/socket';
import { minutesToDays } from '@arihant/shared';
import type {
  TaskBlockerStatus,
  TaskBlockerType,
  TaskDelayClass,
  TaskDisplayStatus,
  TaskPriority,
  TaskStatus,
} from '@arihant/shared';

export { errorMessage, fieldErrors, isConflict, saveBlob } from '../../expenses/_lib/expense-lib';

export interface TaskRow {
  id: string;
  task_number: string;
  title: string;
  description: string | null;
  expected_outcome: string | null;
  status: TaskStatus;
  display_status: TaskDisplayStatus;
  display_status_label: string;
  priority: TaskPriority;
  progress_percent: number;
  start_date: string | null;
  deadline: string | null;
  original_deadline: string | null;
  completed_at: string | null;
  approved_at: string | null;
  last_update_at: string | null;
  first_overdue_at: string | null;
  assigned_to: string | null;
  assignee_name: string | null;
  assignee_active: boolean | null;
  assigned_by: string | null;
  assigned_by_name: string | null;
  reporting_manager_name: string | null;
  department_id: string | null;
  department_name: string | null;
  category_id: string;
  category_code: string;
  category_name: string;
  customer_id: string | null;
  customer_name: string | null;
  tender_id: string | null;
  tender_no: string | null;
  demo_id: string | null;
  demo_no: string | null;
  service_ticket_id: string | null;
  ticket_no: string | null;
  project_id: string | null;
  template_id: string | null;
  occurrence_date: string | null;
  recurrence_type: string | null;
  group_id: string | null;
  evidence_required: boolean;
  approval_required: boolean;
  reopen_count: number;
  rework_count: number;
  extension_count: number;
  reassign_count: number;
  is_backlog: boolean;
  generated_late: boolean;
  source: string;
  /** Originating record for workflow-created tasks, e.g. 'proposal' for proposal follow-ups. */
  related_entity_type: string | null;
  related_entity_id: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  cancelled_reason: string | null;
  completion_remarks: string | null;
  delay_reason: string | null;
  progress_at_completion: number | null;
  open_blocker: { id: string; status: TaskBlockerStatus; blocker_type: TaskBlockerType; raised_at: string; raised_after_deadline: boolean; raised_by: string; dependency_user_id: string | null } | null;
  is_overdue: boolean;
  delay_class: TaskDelayClass | null;
  total_delay_days: number;
  excused_delay_days: number;
  unexcused_delay_days: number;
  no_update: boolean;
  due_label: string | null;
}

export interface TaskUpdate {
  id: string;
  task_id: string;
  author_id: string | null;
  author_name: string | null;
  author_role: string | null;
  kind: string;
  comment: string | null;
  progress_percent: number | null;
  status_from: string | null;
  status_to: string | null;
  metadata: Record<string, any> | null;
  created_at: string;
}

export interface TaskAttachment {
  id: string;
  purpose: 'supporting_doc' | 'evidence' | 'blocker_evidence' | 'update';
  related_id: string | null;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  uploaded_at: string;
  uploaded_by: string;
  uploaded_by_name: string | null;
}

export interface TaskBlocker {
  id: string;
  task_id: string;
  blocker_type: TaskBlockerType;
  description: string;
  status: TaskBlockerStatus;
  raised_by: string;
  raised_by_name: string | null;
  created_at: string;
  raised_after_deadline: boolean;
  dependency_user_id: string | null;
  dependency_user_name: string | null;
  dependency_customer_id: string | null;
  dependency_customer_name: string | null;
  vendor_name: string | null;
  portal_name: string | null;
  approval_pending_from: string | null;
  leave_id: string | null;
  leave_from: string | null;
  leave_to: string | null;
  expected_resolution_date: string | null;
  requested_new_deadline: string | null;
  decision: string | null;
  decided_by_name: string | null;
  decided_at: string | null;
  decision_comment: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
  excused_minutes: number;
  open: boolean;
}

export interface TaskDetail extends TaskRow {
  created_by: string | null;
  updates: TaskUpdate[];
  attachments: TaskAttachment[];
  blockers: TaskBlocker[];
  deadline_changes: { id: string; old_deadline: string | null; new_deadline: string; reason: string; source: string; excused_minutes: number; locked_unexcused_minutes: number; changed_by_name: string | null; created_at: string }[];
  assignment_history: { id: string; from_name: string | null; to_name: string | null; reason: string; reason_type: string; was_overdue: boolean; changed_by_name: string | null; created_at: string }[];
  escalations: { id: string; escalated_by_name: string | null; escalated_to: string; escalated_to_name: string | null; reason: string; status: string; outcome_comment: string | null; created_at: string }[];
  template: { id: string; title: string; recurrence_type: string; status: string } | null;
  approvers: { id: string; full_name: string }[];
  approver_via_fallback: boolean;
  viewer: { kinds: string[] };
  allowed_actions: string[];
  repeated_blocker_types: { type: string; count: number; flagged: boolean }[];
}

export interface Paged<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface TaskSummary {
  my_open: number;
  my_overdue: number;
  my_due_today: number;
  my_blocked: number;
  my_awaiting_approval: number;
  my_no_update: number;
  pending_approvals: number;
  pending_blockers: number;
  waiting_on_me: number;
  open_escalations: number;
  needs_reassignment: number;
  has_team: boolean;
  team_size: number;
  can_view_all: boolean;
  can_manage_settings: boolean;
  can_view_evidence: boolean;
  can_snapshot_evidence: boolean;
}

export interface TaskCategory {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
  requires_link_type: 'customer' | 'tender' | 'demo' | 'service' | null;
  default_evidence_required: boolean;
  display_order: number;
}

export interface TaskSettings {
  no_update_days_critical: number;
  no_update_days_high: number;
  no_update_days_medium: number;
  no_update_days_low: number;
  repeated_delay_threshold: number;
  repeated_delay_window_days: number;
  max_extensions_before_flag: number;
  repeated_blocker_threshold: number;
  blocker_review_sla_hours: number;
  approval_sla_hours: number;
  reminder_hours_before_deadline: number;
  allow_self_tasks: boolean;
  allow_indirect_reports: boolean;
  allow_peer_linked_assignment: boolean;
  auto_accept_leave_blockers: boolean;
  evidence_period_basis: 'deadline' | 'completion';
  review_rating_scale: number;
  weekly_off_days: number[];
  default_holiday_policy: string;
  default_leave_policy: string;
  fallback_approver_role: string;
  horizon_days_daily: number;
  horizon_days_weekly: number;
  horizon_days_monthly: number;
  hard_delete_window_minutes: number;
}

export interface AssigneeOption {
  id: string;
  full_name: string;
  role: string;
  department_name: string | null;
  manager_name: string | null;
  scope: 'self' | 'team' | 'peer' | 'all';
  on_leave: { from_date: string; to_date: string; leave_type: string } | null;
}

export interface LinkOption {
  id: string;
  label: string;
  sub: string | null;
  organisation_id?: string | null;
}

/** Pages broadcast this after any mutation so badges and lists refresh. */
export const notifyTasksChanged = () => {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('tasks:changed'));
};

/** Live counts for the sidebar and sub-navigation (refreshes on mutations, socket pushes and every minute). */
export function useTaskSummary(enabled = true) {
  const [summary, setSummary] = useState<TaskSummary | null>(null);
  const load = useCallback(async () => {
    try {
      setSummary(await api.get<TaskSummary>('/tasks/my/summary'));
    } catch {
      /* badges are best-effort */
    }
  }, []);
  useEffect(() => {
    if (!enabled) return;
    load();
    const onChange = () => load();
    window.addEventListener('tasks:changed', onChange);
    const socket = getSocket();
    socket?.on('task:badge_refresh', onChange);
    const timer = window.setInterval(load, 60000);
    return () => {
      window.removeEventListener('tasks:changed', onChange);
      socket?.off('task:badge_refresh', onChange);
      window.clearInterval(timer);
    };
  }, [enabled, load]);
  return { summary, reload: load };
}

export function useTaskCategories(includeInactive = false) {
  const [categories, setCategories] = useState<TaskCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      setCategories(await api.get<TaskCategory[]>('/task-categories', includeInactive ? { include_inactive: true } : undefined));
    } catch {
      setCategories([]);
    } finally {
      setLoading(false);
    }
  }, [includeInactive]);
  useEffect(() => {
    load();
  }, [load]);
  return { categories, loading, reload: load };
}

export function useTaskSettings() {
  const [settings, setSettings] = useState<TaskSettings | null>(null);
  const load = useCallback(async () => {
    try {
      setSettings(await api.get<TaskSettings>('/task-settings'));
    } catch {
      setSettings(null);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  return { settings, reload: load, setSettings };
}

/** Today in IST (YYYY-MM-DD). */
export const istToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

export const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Build a /tasks/team URL for dashboard drill-downs. */
export const teamTasksHref = (params: Record<string, string | undefined>) => {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]).toString();
  return `/tasks/team${qs ? `?${qs}` : ''}`;
};

/** A delay or excused credit: "5 min" or "3 h 20 min" under a day, else "1 day" / "2.5 days". */
export const formatDuration = (minutes: number) => {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} min`;
  if (m < 1440) return `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`;
  const d = minutesToDays(m);
  return `${d} day${d === 1 ? '' : 's'}`;
};

export const fileSize = (bytes: number) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
