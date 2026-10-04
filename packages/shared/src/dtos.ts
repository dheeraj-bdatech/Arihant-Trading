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
