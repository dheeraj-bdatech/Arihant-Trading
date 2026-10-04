import type { ColumnType, Generated } from 'kysely';
import type {
  UserRole,
  LeadCategory,
  LeadProbability,
  ChannelType,
  LeadType,
  LeadStatus,
  FollowUpStatus,
  InteractionType,
  TenderCategory,
  TenderStatus,
  VisitStatus,
  TripStatus,
  DemoStatus,
  DemoEquipmentAvailability,
  DemoResult,
  DemoFailureReason,
  DemoCancellationReason,
  ProposalStatus,
  ServiceTicketStatus,
  ServicePriority,
  WarrantyStatus,
  ExpenseStatus,
  ExpenseCategory,
  TaskStatus,
  TaskBlockerType,
  TaskBlockerDecision,
} from './enums.js';

export interface ZonesTable {
  id: Generated<string>;
  code: string;
  name: string;
  active?: Generated<boolean>;
  created_at: Generated<Date>;
}

export interface RegionsTable {
  id: Generated<string>;
  name: string;
  zone_id: string | null;
  active?: Generated<boolean>;
  created_at: Generated<Date>;
}

export interface ProductsTable {
  id: Generated<string>;
  name: string;
  category: string | null;
  make: string | null;
  is_mha_qr: Generated<boolean>;
  spec_ref: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface UsersTable {
  id: string; // uuid
  full_name: string;
  email: string;
  phone: string | null;
  role: Generated<UserRole>;
  region_id: string | null;
  zone_id: string | null;
  reporting_manager_id: string | null;
  is_active: Generated<boolean>;
  password_hash?: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface OrganisationsTable {
  id: Generated<string>;
  name: string;
  sector: string | null;
  department: string | null;
  is_govt: Generated<boolean>;
  city: string | null;
  state: string | null;
  address: string | null;
  zone_id: string | null;
  region_id: string | null;
  created_by: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface ContactsTable {
  id: Generated<string>;
  organisation_id: string;
  full_name: string;
  designation: string | null;
  mobile: string | null;
  email: string | null;
  is_primary: Generated<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface LeadsTable {
  id: Generated<string>;
  organisation_id: string;
  primary_contact_id: string | null;
  product_id: string | null;
  department: string | null;
  source: string | null;
  category: Generated<LeadCategory>;
  probability: Generated<LeadProbability>;
  channel: ChannelType | null;
  status: Generated<string>;
  lead_type: Generated<LeadType>;
  lead_status: Generated<LeadStatus>;
  loss_reason: string | null;
  last_interaction_at: Date | null;
  next_followup_at: Date | null;
  assigned_to: string | null;
  regional_manager_id: string | null;
  bill_qtr: string | null;
  last_contact_date: string | null; // date
  next_followup_date: string | null; // date
  qty: number | null;
  quot_price: number | null;
  order_price: number | null;
  value_lakh: number | null;
  booking_month: string | null;
  billing_month: string | null;
  order_status: string | null;
  remarks: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface LeadProductInterestsTable {
  id: Generated<string>;
  lead_id: string;
  product_id: string;
  created_at: Generated<Date>;
  created_by: string | null;
}

export interface LeadAssignmentHistoryTable {
  id: Generated<string>;
  lead_id: string;
  previous_salesperson_id: string | null;
  new_salesperson_id: string;
  previous_regional_manager_id: string | null;
  new_regional_manager_id: string | null;
  changed_by: string;
  changed_at: Generated<Date>;
  reason: string | null;
}

export interface FollowUpsTable {
  id: Generated<string>;
  organisation_id: string;
  contact_id: string | null;
  lead_id: string | null;
  interaction_id: string | null;
  assigned_to: string;
  due_date: string; // date
  status: Generated<FollowUpStatus>;
  remarks: string | null;
  outcome: string | null;
  completed_at: Date | null;
  completed_by: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface InteractionAttachmentsTable {
  id: Generated<string>;
  interaction_id: string;
  file_url: string;
  file_name: string;
  file_size: number | null;
  mime_type: string | null;
  created_at: Generated<Date>;
}

export interface InteractionsTable {
  id: Generated<string>;
  organisation_id: string;
  contact_id: string | null;
  lead_id: string | null;
  visit_id: string | null;
  demo_id: string | null;
  type: string;
  employee_id: string | null;
  occurred_on: Generated<string>;
  remarks: string | null;
  outcome: string | null;
  next_action: string | null;
  followup_date: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface TripsTable {
  id: Generated<string>;
  employee_id: string;
  trip_date: string;
  base_location: string;
  status: Generated<TripStatus>;
  notes: string | null;
  created_by: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface VisitsTable {
  id: Generated<string>;
  trip_id: string | null;
  organisation_id: string;
  contact_id: string | null;
  product_id: string | null;
  planned_by: string | null;
  assigned_to: string | null;
  assigned_by_manager: string | null;
  manager_assigned: Generated<boolean>;
  location: string | null;
  latitude: number | null;
  longitude: number | null;
  planned_date: string; // date
  start_time: string | null;
  end_time: string | null;
  purpose: string | null;
  demo_required: Generated<boolean>;
  travel_required: Generated<boolean>;
  expected_outcome: string | null;
  status: Generated<VisitStatus>;
  change_reason: string | null;
  rescheduled_from: string | null;
  remarks: string | null;
  contact_person: string | null;
  version: Generated<number>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface VisitUpdatesTable {
  id: Generated<string>;
  visit_id: string;
  met_completed: Generated<boolean>;
  person_met: string | null;
  discussion: string | null;
  product_discussed: string | null;
  outcome: string | null;
  opportunity: string | null;
  tender_opportunity: string | null;
  demo_required: Generated<boolean>;
  next_action: string | null;
  followup_date: string | null;
  remarks: string | null;
  contact_unavailable?: Generated<boolean>;
  contact_unavailable_reason?: string | null;
  updated_by: string | null;
  created_at: Generated<Date>;
}

export interface EmployeeActivitiesTable {
  id: Generated<string>;
  employee_id: string;
  activity_type: Generated<string>;
  entity_type: Generated<string>;
  entity_id: string;
  activity_date: string;
  title: string;
  status: string;
  outcome: string | null;
  next_action: string | null;
  followup_date: string | null;
  details: unknown | null;
  created_at: Generated<Date>;
}

export interface DemoEquipmentTable {
  id: Generated<string>;
  product_id: string | null;
  model: string | null;
  serial_no: string | null;
  current_location: string | null;
  responsible_person: string | null;
  availability_status: Generated<DemoEquipmentAvailability>;
  condition: string | null;
  reserved_until: string | null;
  remarks: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface DemosTable {
  id: Generated<string>;
  demo_no: Generated<string>;
  organisation_id: string;
  lead_id: string | null;
  tender_id?: string | null;
  deal_value?: number | string | null;
  product_id: string | null;
  requested_by: string | null;
  coordinator_id: string | null;
  assigned_to: string | null;
  location: string | null;
  requested_date: string | null;
  confirmed_date: string | null;
  expected_audience: string | null;
  equipment_required: string | null;
  special_requirements: string | null;
  status: Generated<DemoStatus>;
  purpose: string | null;
  remarks: string | null;
  visit_id: string | null;
  reschedule_reason: string | null;
  rescheduled_from: string | null;
  cancellation_reason: string | null;
  travel_required: Generated<boolean>;
  travel_from: string | null;
  travel_to: string | null;
  travel_date: string | null;
  travel_remarks: string | null;
  version: Generated<number>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface DemoReservationsTable {
  id: Generated<string>;
  demo_id: string;
  equipment_id: string;
  reserved_from: string | null;
  reserved_to: string | null;
  status: Generated<string>;
  approved_by: string | null;
  alternative_equipment_id: string | null;
  alternative_reason: string | null;
  remarks: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface DemoOutcomesTable {
  id: Generated<string>;
  demo_id: string;
  completed: Generated<boolean>;
  customer_response: string | null;
  technical_performance: string | null;
  product_suitability: string | null;
  decision_maker_present: boolean | null;
  competitor_involved: string | null;
  next_step: string | null;
  opportunity_stage: string | null;
  result: string | null; // success / fail
  failure_reason: string | null;
  remarks: string | null;
  submitted_by: string | null;
  created_at: Generated<Date>;
}

export interface DemoRescheduleHistoryTable {
  id: Generated<string>;
  demo_id: string;
  old_date: string | null;
  new_date: string;
  reason: string;
  changed_by: string | null;
  created_at: Generated<Date>;
}


export interface TendersTable {
  id: Generated<string>;
  tender_no: string | null;
  tender_number?: string | null;
  organisation_id: string | null;
  organisation?: string | null;
  department: string | null;
  product_id: string | null;
  requirement_text: string | null;
  city: string | null;
  state: string | null;
  zone_id: string | null;
  region_id: string | null;
  category: Generated<TenderCategory>;
  category_id?: string | null;
  quantity: number | null;
  bidder_turnover: string | null;
  oem_turnover: string | null;
  emd_fee: number | null;
  publish_date: string | null;
  publication_date?: string | null;
  bid_start_date: string | null;
  bid_closing_date: string | null; // timestamptz
  submission_deadline?: string | null; // timestamptz
  prebid_date: string | null;
  corrigendum_date: string | null;
  participated_date: string | null;
  department_id?: string | null;
  assigned_to: string | null;
  assigned_person_id?: string | null;
  tender_owner_id: string | null;
  owner?: string | null;
  status: Generated<TenderStatus>;
  on_hold?: Generated<boolean>;
  status_before_hold?: string | null;
  prep_checklist_done?: Generated<boolean>;
  remarks: string | null;
  rejection_reason?: string | null;
  portal?: string | null;
  reference_number?: string | null;
  tender_url?: string | null;
  parent_tender_id?: string | null;
  estimated_value?: number | null;
  tender_value?: number | null;
  submission_date?: string | null;
  result_date?: string | null;
  loss_reason?: string | null;
  competitor?: string | null;
  loss_notes?: string | null;
  approval_date?: Date | null;
  internal_approval_by?: string | null;
  internal_approval_at?: Date | null;
  is_deleted?: Generated<boolean>;
  deleted_at?: Date | null;
  deleted_by?: string | null;
  created_by?: string | null;
  updated_by?: string | null;
  last_activity_at?: Generated<Date>;
  version?: Generated<number>;
  extra_fields?: Generated<any>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface TenderCategoriesTable {
  id: Generated<string>;
  code: string;
  name: string;
  description: string | null;
  requires_pq?: Generated<boolean>;
  active?: Generated<boolean>;
  sort_order?: Generated<number>;
  is_active: Generated<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface TenderStatusesTable {
  code: string;
  label: string;
  sort_order: number;
  is_terminal: Generated<boolean>;
  color: Generated<string>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface TenderSettingsTable {
  id: number;
  upcoming_days: Generated<number>;
  approaching_days: Generated<number>;
  approval_sla_hours: Generated<number>;
  result_followup_days: Generated<number>;
  allow_self_approval: Generated<boolean>;
  require_won_value: Generated<boolean>;
  escalation_user_ids: Generated<any>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface TenderApproversTable {
  id: Generated<string>;
  user_id: string;
  created_at: Generated<Date>;
}

export interface LossReasonsTable {
  id: Generated<string>;
  code: string;
  label: string;
  active: Generated<boolean>;
  sort_order: Generated<number>;
  created_at: Generated<Date>;
}

export interface TenderDeadlineChangesTable {
  id: Generated<string>;
  tender_id: string;
  old_deadline: Date;
  new_deadline: Date;
  reason: string;
  changed_by: string | null;
  changed_at: Generated<Date>;
}

export interface TenderResultsTable {
  id: Generated<string>;
  tender_id: string;
  outcome: string;
  result_date: string;
  value: number | null;
  loss_reasons: Generated<string[]>;
  other_reason_text: string | null;
  competitor: string | null;
  notes: string | null;
  zone_id: string | null;
  region_id: string | null;
  assigned_to: string | null;
  category_id: string | null;
  product_id: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface TenderNotificationsLogTable {
  id: Generated<string>;
  tender_id: string;
  alert_type: string;
  sent_at: Generated<Date>;
  created_at: Generated<Date>;
}

export interface TenderApprovalsTable {
  id: Generated<string>;
  tender_id: string;
  requested_by: string | null;
  approver_id: string | null;
  status: Generated<string>;
  requested_at: Generated<Date>;
  responded_at: Date | null;
  remarks: string | null;
  rejection_reason: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface TenderPortalIssuesTable {
  id: Generated<string>;
  tender_id: string;
  portal?: string | null;
  issue: string;
  issue_date?: string | null;
  reported_date: string;
  reported_by: string | null;
  responsible_user?: string | null;
  responsible_person_id: string | null;
  escalated_to: string | null;
  escalated_at?: Date | null;
  escalation_date: Date | null;
  status?: Generated<string>;
  resolution_status: Generated<string>;
  resolution: string | null;
  resolved_by?: string | null;
  resolved_at: Date | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface TenderActivitiesTable {
  id: Generated<string>;
  tender_id: string;
  event_type: string;
  description: string;
  performed_by: string | null;
  metadata: Generated<any>;
  created_at: Generated<Date>;
}

export interface OutboxEventsTable {
  id: Generated<string>;
  event_id: string;
  event_type: string;
  event_version?: Generated<string>;
  aggregate_type: Generated<string>;
  aggregate_id: string;
  aggregate_sequence?: Generated<number>;
  correlation_id?: string | null;
  causation_id?: string | null;
  tenant_id?: string | null;
  suppress_notifications?: Generated<boolean>;
  payload: any;
  status: Generated<string>;
  attempts: Generated<number>;
  max_attempts: Generated<number>;
  available_at: Generated<Date>;
  processed_at: Date | null;
  error_message: string | null;
  created_at: Generated<Date>;
}

export interface ProcessedEventsTable {
  id: Generated<string>;
  event_id: string;
  handler_name: string;
  processed_at: Generated<Date>;
}

export interface DeadLetterEventsTable {
  id: Generated<string>;
  event_id: string;
  event_type: string;
  aggregate_type: Generated<string>;
  aggregate_id: string;
  payload: any;
  error_message: string | null;
  attempts: Generated<number>;
  failed_at: Generated<Date>;
  replayed_at: Date | null;
  replayed_by: string | null;
}

export interface SchedulerDedupeTable {
  id: Generated<string>;
  dedupe_key: string;
  event_type: string;
  proposal_id: string;
  business_date: string;
  created_at: Generated<Date>;
}

export interface TenderStatusHistoryTable {
  id: Generated<string>;
  tender_id: string;
  from_status: string | null;
  to_status: string;
  changed_by: string | null;
  note?: string | null;
  remarks: string | null;
  changed_at?: Generated<Date>;
  created_at: Generated<Date>;
}

export interface TenderOutcomesTable {
  id: Generated<string>;
  tender_id: string;
  result: string; // won / lost
  reason: string | null;
  competitor: string | null;
  value_lakh: number | null;
  result_date: string | null;
  technical_issue: string | null;
  pricing_issue: string | null;
  eligibility_issue: string | null;
  documentation_issue: string | null;
  other_reason: string | null;
  notes: string | null;
  created_at: Generated<Date>;
}

export interface ProposalsTable {
  id: Generated<string>;
  proposal_number: Generated<string>;
  proposal_no?: Generated<string>;
  organisation_id: string;
  customer_id?: string | null;
  lead_id: string | null;
  product_id: string | null;
  sector_id?: string | null;
  sector: string | null;
  requested_by: string | null;
  requested_by_id?: string | null;
  created_by_id?: string | null;
  responsible_id: string | null;
  responsible_person_id?: string | null;
  followup_owner_id: string | null;
  follow_up_owner_id?: string | null;
  request_date: string | null;
  required_date: string | null;
  sent_date: string | null;
  approved_at: Date | null;
  approved_by: string | null;
  approved_by_id?: string | null;
  version: string | null;
  current_version?: Generated<number>;
  reference: string | null;
  email_reference?: string | null;
  status: Generated<ProposalStatus>;
  last_followup: string | null;
  last_follow_up_at?: Date | null;
  next_followup: string | null;
  next_follow_up_date?: string | null;
  next_follow_up_time?: string | null;
  review_cycle_count?: Generated<number>;
  is_urgent?: Generated<boolean>;
  sent_late?: Generated<boolean>;
  outcome: string | null;
  outcome_date?: string | null;
  lost_reason: string | null;
  lost_reason_code?: string | null;
  lost_reason_text?: string | null;
  lost_to_competitor?: string | null;
  lost_remarks: string | null;
  closure_reason_code?: string | null;
  closure_reason_text?: string | null;
  converted_to: string | null;
  converted_reference: string | null;
  conversion_reference?: string | null;
  status_before_terminal?: string | null;
  related_proposal_id?: string | null;
  last_activity_at?: Generated<Date>;
  follow_up_count?: Generated<number>;
  postpone_count?: Generated<number>;
  owner_inactive_flag?: Generated<boolean>;
  source?: Generated<string>;
  external_ref?: string | null;
  row_version?: Generated<number>;
  remarks: string | null;
  created_by: string | null;
  updated_by: string | null;
  is_deleted: Generated<boolean>;
  deleted_at: Date | null;
  deleted_by: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface ProposalProductsTable {
  id: Generated<string>;
  proposal_id: string;
  product_id: string;
  is_primary: Generated<boolean>;
  created_at: Generated<Date>;
}

export interface ProposalVersionsTable {
  id: Generated<string>;
  proposal_id: string;
  version_no: Generated<number>;
  change_summary: string | null;
  email_references: Generated<any>;
  document_links: Generated<any>;
  sent_date: string | null;
  sent_by: string | null;
  created_by: string | null;
  created_at: Generated<Date>;
}

export interface ProposalStatusHistoryTable {
  id: Generated<string>;
  proposal_id: string;
  from_status: string | null;
  to_status: string;
  reason: string | null;
  actor_id: string | null;
  occurred_at: Generated<Date>;
  event_id: string | null;
}

export interface ProposalFollowupsTable {
  id: Generated<string>;
  proposal_id: string;
  followup_date: string;
  contact_date?: Generated<string>;
  mode?: Generated<string>;
  contact_person?: string | null;
  owner_id?: string;
  logged_by?: string | null;
  summary?: string;
  remarks: string;
  outcome: string | null;
  response?: Generated<string>;
  next_followup_date: string | null;
  next_follow_up_date?: string | null;
  is_postpone?: Generated<boolean>;
  postpone_reason?: string | null;
  created_by: string | null;
  created_at: Generated<Date>;
  edited_at?: Date | null;
}

export interface ProposalFollowUpsTable {
  id: Generated<string>;
  proposal_id: string;
  contact_date: Generated<string>;
  mode: Generated<string>;
  contact_person: string | null;
  summary: string;
  response: Generated<string>;
  next_follow_up_date: string | null;
  is_postpone: Generated<boolean>;
  postpone_reason: string | null;
  logged_by: string | null;
  created_at: Generated<Date>;
  edited_at: Date | null;
}

export interface ProposalTimelineTable {
  id: Generated<string>;
  proposal_id: string;
  event_type: string;
  category: Generated<string>;
  title: string;
  description: string | null;
  actor_id: string | null;
  metadata: Generated<any>;
  occurred_at: Generated<Date>;
}

export interface ProposalSettingsTable {
  id: Generated<number>;
  business_timezone: Generated<string>;
  default_follow_up_days: Generated<number>;
  no_follow_up_after_days: Generated<number>;
  escalate_after_overdue_days: Generated<number>;
  stale_requested_days: Generated<number>;
  stale_preparation_days: Generated<number>;
  stale_review_days: Generated<number>;
  stale_approved_days: Generated<number>;
  stale_followup_days: Generated<number>;
  required_date_warning_days: Generated<number>;
  urgent_days: Generated<number>;
  max_follow_up_horizon_days: Generated<number>;
  max_postpones_before_flag: Generated<number>;
  suggest_closure_after_days: Generated<number>;
  duplicate_window_days: Generated<number>;
  reopen_window_days: Generated<number>;
  allow_self_approval: Generated<boolean>;
  allow_fast_track: Generated<boolean>;
  digest_time: Generated<string>;
  proposal_number_format: Generated<string>;
  lost_reason_codes: Generated<any>;
  closure_reason_codes: Generated<any>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface ProposalActivitiesTable {
  id: Generated<string>;
  proposal_id: string;
  action: string;
  old_value: string | null;
  new_value: string | null;
  performed_by: string | null;
  metadata: Record<string, any> | null;
  created_at: Generated<Date>;
}


export interface ServiceTicketsTable {
  id: Generated<string>;
  ticket_no: string | null;
  organisation_id: string;
  contact_id: string | null;
  product_id: string | null;
  equipment_serial: string | null;
  location: string | null;
  complaint: string | null;
  received_date: Generated<string>;
  priority: Generated<ServicePriority>;
  warranty_status: WarrantyStatus | null;
  assigned_to: string | null;
  planned_visit_date: string | null;
  status: Generated<ServiceTicketStatus>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface ServiceReportsTable {
  id: Generated<string>;
  ticket_id: string;
  problem_identified: string | null;
  action_taken: string | null;
  parts_replaced: string | null;
  warranty_status: string | null;
  customer_confirmation: boolean | null;
  further_work_required: boolean | null;
  next_visit_date: string | null;
  report_url: string | null;
  submitted_by: string | null;
  created_at: Generated<Date>;
}

export interface ExpensesTable {
  id: Generated<string>;
  employee_id: string;
  visit_id: string | null;
  organisation_id: string | null;
  expense_date: string;
  category: ExpenseCategory;
  amount: number;
  purpose: string | null;
  receipt_url: string | null;
  status: Generated<ExpenseStatus>;
  manager_id: string | null;
  manager_remarks: string | null;
  remarks: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface TasksTable {
  id: Generated<string>;
  title: string;
  description: string | null;
  assigned_to: string | null;
  reporting_manager_id: string | null;
  department: string | null;
  priority: Generated<string>;
  task_type: Generated<string>;
  related_entity_type: string | null;
  related_entity_id: string | null;
  start_date: string | null;
  deadline: string | null;
  expected_outcome: string | null;
  evidence_url: string | null;
  status: Generated<TaskStatus>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface TaskBlockersTable {
  id: Generated<string>;
  task_id: string;
  blocker_type: TaskBlockerType | null;
  description: string | null;
  raised_by: string | null;
  manager_decision: TaskBlockerDecision | null;
  decided_by: string | null;
  created_at: Generated<Date>;
}

export interface AttachmentsTable {
  id: Generated<string>;
  entity_type: string;
  entity_id: string;
  file_url: string;
  file_name: string | null;
  uploaded_by: string | null;
  created_at: Generated<Date>;
}

export interface NotificationsTable {
  id: Generated<string>;
  user_id: string;
  type: string;
  title: string;
  body: string | null;
  entity_type: string | null;
  entity_id: string | null;
  is_read: Generated<boolean>;
  created_at: Generated<Date>;
}

export interface AuditLogTable {
  id: Generated<string>;
  actor_id: string | null;
  entity_type: string;
  entity_id: string;
  action: string;
  previous_value: unknown | null;
  new_value: unknown | null;
  created_at: Generated<Date>;
}

export interface DepartmentsTable {
  id: Generated<string>;
  code: string;
  name: string;
  description: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface RolePermissionsTable {
  id: Generated<string>;
  role: UserRole;
  module: string;
  can_view: boolean;
  can_create: boolean;
  can_edit: boolean;
  can_delete: boolean;
  can_approve: boolean;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface AppUsersTable {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  role: UserRole;
  region_id: string | null;
  zone_id: string | null;
  reporting_manager_id: string | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export type DeliveryStatus =
  | 'scheduled'
  | 'dispatched'
  | 'in_transit'
  | 'delivered'
  | 'installed'
  | 'handover_completed'
  | 'cancelled';

export interface DeliveriesTable {
  id: Generated<string>;
  delivery_no: string;
  organisation_id: string;
  product_id: string | null;
  model: string | null;
  equipment_serial: string | null;
  delivery_date: string;
  delivery_location: string;
  assigned_to: string | null;
  tender_id: string | null;
  order_reference: string | null;
  status: Generated<DeliveryStatus>;
  installation_required: Generated<boolean>;
  installation_date: string | null;
  installed_by: string | null;
  installation_notes: string | null;
  remarks: string | null;
  document_url: string | null;
  version: Generated<number>;
  created_by: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface Database {
  zones: ZonesTable;
  regions: RegionsTable;
  deliveries: DeliveriesTable;
  products: ProductsTable;
  users: UsersTable;
  app_users: AppUsersTable;
  departments: DepartmentsTable;
  role_permissions: RolePermissionsTable;
  organisations: OrganisationsTable;
  contacts: ContactsTable;
  leads: LeadsTable;
  lead_product_interests: LeadProductInterestsTable;
  lead_assignment_history: LeadAssignmentHistoryTable;
  follow_ups: FollowUpsTable;
  interactions: InteractionsTable;
  interaction_attachments: InteractionAttachmentsTable;
  trips: TripsTable;
  visits: VisitsTable;
  visit_updates: VisitUpdatesTable;
  employee_activities: EmployeeActivitiesTable;
  demo_equipment: DemoEquipmentTable;
  demos: DemosTable;
  demo_reservations: DemoReservationsTable;
  demo_outcomes: DemoOutcomesTable;
  demo_reschedule_history: DemoRescheduleHistoryTable;
  tenders: TendersTable;
  tender_categories: TenderCategoriesTable;
  tender_statuses: TenderStatusesTable;
  tender_settings: TenderSettingsTable;
  tender_approvers: TenderApproversTable;
  loss_reasons: LossReasonsTable;
  tender_deadline_changes: TenderDeadlineChangesTable;
  tender_results: TenderResultsTable;
  tender_notifications_log: TenderNotificationsLogTable;
  tender_approvals: TenderApprovalsTable;
  tender_portal_issues: TenderPortalIssuesTable;
  tender_activities: TenderActivitiesTable;
  tender_status_history: TenderStatusHistoryTable;
  tender_outcomes: TenderOutcomesTable;
  outbox_events: OutboxEventsTable;
  processed_events: ProcessedEventsTable;
  dead_letter_events: DeadLetterEventsTable;
  scheduler_dedupe: SchedulerDedupeTable;
  proposals: ProposalsTable;
  proposal_products: ProposalProductsTable;
  proposal_versions: ProposalVersionsTable;
  proposal_status_history: ProposalStatusHistoryTable;
  proposal_followups: ProposalFollowupsTable;
  proposal_follow_ups: ProposalFollowUpsTable;
  proposal_timeline: ProposalTimelineTable;
  proposal_settings: ProposalSettingsTable;
  proposal_activities: ProposalActivitiesTable;
  service_tickets: ServiceTicketsTable;
  service_reports: ServiceReportsTable;
  expenses: ExpensesTable;
  tasks: TasksTable;
  task_blockers: TaskBlockersTable;
  attachments: AttachmentsTable;
  notifications: NotificationsTable;
  audit_log: AuditLogTable;
}

