import type { UserRole } from './enums.js';

export interface AuthUser {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  region_id: string | null;
  zone_id: string | null;
  reporting_manager_id: string | null;
  is_active: boolean;
}

export interface LoginResponseDto {
  token: string;
  accessToken?: string;
  user: AuthUser;
}

export interface PaginationQueryDto {
  page?: number;
  limit?: number;
  search?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface TenderFilterDto extends PaginationQueryDto {
  zone_id?: string;
  region_id?: string;
  status?: string;
  category?: string;
  closingSoonOnly?: boolean;
}

export interface LeadFilterDto extends PaginationQueryDto {
  category?: string;
  probability?: string;
  status?: string;
  assigned_to?: string;
}

/** Longest message a lead's conversation accepts, in characters. */
export const LEAD_MESSAGE_MAX_LENGTH = 2000;

/** Who sees a lead message: the team only, or the customer too (over the lead's chat link). */
export type LeadMessageAudience = 'team' | 'customer';

/** Roles that may share a lead's chat link with the customer and write to them (the roles that edit leads). */
export const LEAD_CUSTOMER_CHAT_ROLES: UserRole[] = ['management', 'regional_manager', 'sales', 'admin'];

/** A message in a lead's conversation thread, as GET / POST /leads/:id/messages return it. */
export interface LeadMessageDto {
  id: string;
  lead_id: string;
  author_id: string | null;
  author_name: string | null;
  author_role: UserRole | null;
  body: string;
  audience: LeadMessageAudience;
  from_customer: boolean;
  customer_name: string | null;
  created_at: string;
}

/** The lead's customer chat link as the team sees it; `url_path` only in the answer that made the link. */
export interface LeadChatLinkDto {
  active: boolean;
  created_at: string | null;
  created_by_name: string | null;
  url_path?: string;
}

/** A customer-facing message, as the public chat page shows it. */
export interface LeadChatMessageDto {
  id: string;
  body: string;
  from_customer: boolean;
  sender_name: string;
  created_at: string;
}

/** What the public chat page loads with a valid link. */
export interface LeadChatViewDto {
  organisation_name: string;
  product_name: string | null;
  owner_name: string | null;
  customer_name: string | null;
  messages: LeadChatMessageDto[];
}

export interface VisitFilterDto extends PaginationQueryDto {
  status?: string;
  assigned_to?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface ExpenseFilterDto extends PaginationQueryDto {
  status?: string;
  employee_id?: string;
  category?: string;
  organisation_id?: string;
  customer_id?: string;
  from_date?: string;
  to_date?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface TaskFilterDto extends PaginationQueryDto {
  status?: string;
  assigned_to?: string;
  department?: string;
  priority?: string;
  overdueOnly?: boolean;
  dateFrom?: string;
  dateTo?: string;
}

export interface DeliveryFilterDto extends PaginationQueryDto {
  status?: string;
  organisation_id?: string;
  customer_id?: string;
  assigned_to?: string;
  product_id?: string;
  tender_id?: string;
  dateFrom?: string;
  dateTo?: string;
}

/**
 * GET /dashboard/workspace — the role's own home screen. Every number and list is computed for the
 * caller's role and territory (all-India for management / admin / tender / accounts desks, the zone
 * for a regional manager, the caller's own records for field roles), so two roles never see the same
 * dashboard. Keys inside `numbers` / `lists` / `bars` depend on `role`.
 */
export type WorkspaceTone = 'critical' | 'warning' | 'info' | 'success' | 'neutral';

export interface WorkspaceItem {
  id: string;
  title: string;
  subtitle?: string | null;
  /** ISO date or instant that drives a countdown / "when" label. */
  date?: string | null;
  status?: string | null;
  tone?: WorkspaceTone;
  /** Rupees. */
  amount?: number | null;
  /** Short extra line: owner, location, depot… */
  meta?: string | null;
  /** Named figures for scorecard rows (team members, engineers). */
  figures?: Record<string, number>;
  href: string;
}

export interface WorkspaceBar {
  key: string;
  label: string;
  value: number;
  /** Optional second measure drawn beside the first (e.g. open tenders next to pipeline value). */
  secondary?: number;
}

export interface DashboardWorkspaceDto {
  role: UserRole;
  /** "All India", "North Zone", "Your accounts"… */
  scopeLabel: string;
  generatedAt: string;
  numbers: Record<string, number>;
  lists: Record<string, WorkspaceItem[]>;
  bars: Record<string, WorkspaceBar[]>;
}

export interface DashboardMetricsDto {
  tendersCount: {
    total: number;
    closingSoon: number;
    underPreparation: number;
    awaitingApproval: number;
    won: number;
    lost: number;
  };
  leadsCount: {
    total: number;
    active: number;
    expected: number;
    followUp: number;
    totalValueLakh: number;
  };
  tasksCount: {
    total: number;
    pending: number;
    blocked: number;
    overdue: number;
  };
  expensesCount: {
    pendingManager: number;
    pendingAccounts: number;
    processed: number;
    pendingAmount: number;
  };
  serviceTicketsCount: {
    total: number;
    open: number;
    critical: number;
  };
  deliveriesCount?: {
    total: number;
    scheduled: number;
    inTransit: number;
    delivered: number;
    installed: number;
  };
  visitsCount?: {
    total: number;
    planned: number;
    completed: number;
  };
  proposalsCount?: {
    total: number;
    draft: number;
    submitted: number;
    won: number;
    lost: number;
  };
  recentExceptions: Array<{
    id: string;
    type: 'tender_deadline' | 'task_blocked' | 'expense_approval' | 'task_overdue' | 'tender_approval';
    title: string;
    description: string;
    entityId: string;
    severity: 'critical' | 'warning' | 'info';
    timestamp: string;
  }>;
}

export interface ProposalFilterDto extends PaginationQueryDto {
  status?: string;
  sector?: string;
  sectorId?: string;
  responsible_id?: string;
  responsiblePersonId?: string;
  followup_owner_id?: string;
  followUpOwnerId?: string;
  followup?: 'all' | 'due_today' | 'overdue' | 'upcoming' | 'no_followup' | 'old_inactivity';
  followUp?: 'all' | 'due_today' | 'overdue' | 'upcoming' | 'no_followup' | 'old_inactivity';
  from_date?: string;
  to_date?: string;
  date_field?: 'request_date' | 'required_date' | 'sent_date' | 'next_followup';
}

export interface ProposalDashboardStatsDto {
  total_proposals: number;
  proposal_requested: number;
  pending_preparation: number;
  ready_for_review: number;
  approved: number;
  sent_to_customer: number;
  followup_required: number;
  converted: number;
  closed: number;
  lost: number;
  due_today: number;
  overdue: number;
  no_followup: number;
  old_no_movement: number;
}
