export type UserRole =
  | 'management'
  | 'regional_manager'
  | 'sales'
  | 'tender_team'
  | 'demo_team'
  | 'service_team'
  | 'accounts'
  | 'admin';

export const USER_ROLES: UserRole[] = [
  'management',
  'regional_manager',
  'sales',
  'tender_team',
  'demo_team',
  'service_team',
  'accounts',
  'admin',
];

export type LeadCategory = 'new_lead' | 'active' | 'expected' | 'follow_up';
export const LEAD_CATEGORIES: LeadCategory[] = ['new_lead', 'active', 'expected', 'follow_up'];
export type LeadProbability = 'high' | 'medium' | 'low';
export type ChannelType = 'direct' | 'partner';

export type LeadType = 'fresh' | 're_approached';
export const LEAD_TYPES: LeadType[] = ['fresh', 're_approached'];

export type LeadStatus =
  | 'new'
  | 'contacted'
  | 'qualified'
  | 'follow_up'
  | 'demo'
  | 'proposal'
  | 'tender_discussion'
  | 'negotiation'
  | 'converted'
  | 'lost'
  | 'on_hold'
  | 'open'
  | 'quoted'
  | 'dropped'
  | 'won';

export const LEAD_STATUSES: LeadStatus[] = [
  'new',
  'contacted',
  'qualified',
  'follow_up',
  'demo',
  'proposal',
  'tender_discussion',
  'negotiation',
  'converted',
  'lost',
  'on_hold',
  'open',
  'quoted',
  'dropped',
  'won',
];

export type LeadLossReason =
  | 'price'
  | 'competitor'
  | 'no_response'
  | 'not_interested'
  | 'eligibility'
  | 'timing'
  | 'other';

export const LEAD_LOSS_REASONS: LeadLossReason[] = [
  'price',
  'competitor',
  'no_response',
  'not_interested',
  'eligibility',
  'timing',
  'other',
];

export type InteractionType =
  | 'call'
  | 'email'
  | 'whatsapp'
  | 'physical_visit'
  | 'demo'
  | 'proposal'
  | 'follow_up'
  | 'tender_discussion'
  | 'service_discussion'
  | 'other';

export const INTERACTION_TYPES: InteractionType[] = [
  'call',
  'email',
  'whatsapp',
  'physical_visit',
  'demo',
  'proposal',
  'follow_up',
  'tender_discussion',
  'service_discussion',
  'other',
];

export type FollowUpStatus = 'pending' | 'completed' | 'cancelled';
export const FOLLOW_UP_STATUSES: FollowUpStatus[] = ['pending', 'completed', 'cancelled'];

export type TenderCategory = 'pq' | 'general_mha' | 'other';

export type TenderStatus =
  | 'identified'
  | 'awaiting_approval'
  | 'rejected_internally'
  | 'under_preparation'
  | 'pq_submitted'
  | 'pq_qualified'
  | 'submitted'
  | 'technical_eval'
  | 'commercial_eval'
  | 'won'
  | 'lost'
  | 'cancelled'
  | 'on_hold';

export const TENDER_STATUSES: TenderStatus[] = [
  'identified',
  'awaiting_approval',
  'rejected_internally',
  'under_preparation',
  'pq_submitted',
  'pq_qualified',
  'submitted',
  'technical_eval',
  'commercial_eval',
  'won',
  'lost',
  'cancelled',
  'on_hold',
];

export const TENDER_UPCOMING_DAYS = 7;
export const TENDER_URGENT_HOURS = 48;

export type TenderPortalIssueStatus = 'OPEN' | 'IN_PROGRESS' | 'ESCALATED' | 'RESOLVED' | 'CLOSED';
export const TENDER_PORTAL_ISSUE_STATUSES: TenderPortalIssueStatus[] = [
  'OPEN',
  'IN_PROGRESS',
  'ESCALATED',
  'RESOLVED',
  'CLOSED',
];

export type TenderApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
export const TENDER_APPROVAL_STATUSES: TenderApprovalStatus[] = [
  'PENDING',
  'APPROVED',
  'REJECTED',
];

export type TenderLossReason =
  | 'PRICE'
  | 'COMPETITOR'
  | 'TECHNICAL'
  | 'ELIGIBILITY'
  | 'DOCUMENTATION'
  | 'CUSTOMER_DECISION'
  | 'OTHER';
export const TENDER_LOSS_REASONS: TenderLossReason[] = [
  'PRICE',
  'COMPETITOR',
  'TECHNICAL',
  'ELIGIBILITY',
  'DOCUMENTATION',
  'CUSTOMER_DECISION',
  'OTHER',
];

export const TENDER_STATUS_LABELS: Record<string, string> = {
  identified: 'Identified',
  IDENTIFIED: 'Identified',
  awaiting_approval: 'Awaiting Internal Approval',
  AWAITING_INTERNAL_APPROVAL: 'Awaiting Internal Approval',
  rejected_internally: 'Rejected Internally',
  REJECTED_INTERNALLY: 'Rejected Internally',
  under_preparation: 'Under Preparation',
  UNDER_PREPARATION: 'Under Preparation',
  pq_submitted: 'PQ Submitted',
  PQ_SUBMITTED: 'PQ Submitted',
  pq_qualified: 'PQ Qualified',
  PQ_QUALIFIED: 'PQ Qualified',
  submitted: 'Tender Submitted',
  TENDER_SUBMITTED: 'Tender Submitted',
  technical_eval: 'Technical Evaluation',
  TECHNICAL_EVALUATION: 'Technical Evaluation',
  commercial_eval: 'Commercial Evaluation',
  COMMERCIAL_EVALUATION: 'Commercial Evaluation',
  won: 'Won',
  WON: 'Won',
  lost: 'Lost',
  LOST: 'Lost',
  cancelled: 'Cancelled',
  CANCELLED: 'Cancelled',
  on_hold: 'On Hold',
  ON_HOLD: 'On Hold',
};

export type VisitStatus =
  | 'planned'
  | 'modified'
  | 'cancelled'
  | 'completed'
  | 'not_completed'
  | 'rescheduled';

export type TripStatus = 'planned' | 'active' | 'completed' | 'cancelled';

export type DemoStatus =
  | 'requested'
  | 'under_planning'
  | 'confirmed'
  | 'equipment_reserved'
  | 'team_assigned'
  | 'completed'
  | 'cancelled'
  | 'rescheduled';

export type DemoEquipmentAvailability = 'available' | 'reserved' | 'in_use' | 'maintenance';

export type DemoResult = 'success' | 'fail' | 'partial';

export type DemoFailureReason =
  | 'PRODUCT_LIMITATION'
  | 'EQUIPMENT_ISSUE'
  | 'TECHNICAL_FAILURE'
  | 'CUSTOMER_REQUIREMENT_MISMATCH'
  | 'PRICING_CONCERN'
  | 'DECISION_MAKER_UNAVAILABLE'
  | 'COMPETITOR_PREFERENCE'
  | 'DEMO_PREPARATION_ISSUE'
  | 'OTHER';

export type DemoCancellationReason =
  | 'customer_cancelled'
  | 'equipment_unavailable'
  | 'team_unavailable'
  | 'date_conflict'
  | 'commercial_issue'
  | 'other';

export type ProposalStatus =
  | 'REQUESTED'
  | 'PROPOSAL_REQUESTED'
  | 'UNDER_PREPARATION'
  | 'READY_FOR_REVIEW'
  | 'APPROVED'
  | 'SENT_TO_CUSTOMER'
  | 'FOLLOW_UP_REQUIRED'
  | 'CONVERTED'
  | 'CLOSED'
  | 'LOST'
  | 'requested'
  | 'under_preparation'
  | 'ready_for_review'
  | 'approved'
  | 'sent'
  | 'followup_required'
  | 'converted'
  | 'closed'
  | 'lost';

export const PROPOSAL_STATUS_LABELS: Record<string, string> = {
  REQUESTED: 'Proposal Requested',
  PROPOSAL_REQUESTED: 'Proposal Requested',
  UNDER_PREPARATION: 'Under Preparation',
  READY_FOR_REVIEW: 'Ready for Review',
  APPROVED: 'Approved',
  SENT_TO_CUSTOMER: 'Sent to Customer',
  FOLLOW_UP_REQUIRED: 'Follow-up Required',
  CONVERTED: 'Converted',
  CLOSED: 'Closed',
  LOST: 'Lost',
  requested: 'Proposal Requested',
  under_preparation: 'Under Preparation',
  ready_for_review: 'Ready for Review',
  approved: 'Approved',
  sent: 'Sent to Customer',
  followup_required: 'Follow-up Required',
  converted: 'Converted',
  closed: 'Closed',
  lost: 'Lost',
};

export const PROPOSAL_INACTIVITY_DAYS = 7;

export type ProposalLostReason =
  | 'Price'
  | 'Price Too High'
  | 'Competitor'
  | 'Competitor Chosen'
  | 'Customer Cancelled'
  | 'Specification Mismatch'
  | 'Customer Budget Withdrawn'
  | 'Procurement Delayed'
  | 'No Response'
  | 'Other';

export const PROPOSAL_LOST_REASONS: string[] = [
  'Price Too High',
  'Competitor Chosen',
  'Specification Mismatch',
  'Customer Budget Withdrawn',
  'Procurement Delayed',
  'Other',
];

export const PROPOSAL_CLOSURE_REASONS: string[] = [
  'Cancelled by requester',
  'Customer withdrew enquiry',
  'Duplicate',
  'No response/expired',
  'Superseded by new proposal',
  'Other',
];

export const PROPOSAL_FOLLOW_UP_MODES = [
  'Call',
  'Email',
  'Visit',
  'Meeting',
  'Message',
  'Other',
] as const;
export type ProposalFollowUpMode = typeof PROPOSAL_FOLLOW_UP_MODES[number];

export const PROPOSAL_FOLLOW_UP_RESPONSES = [
  'Positive',
  'Neutral',
  'Negative',
  'No response',
  'Revision requested',
  'Decision pending',
] as const;
export type ProposalFollowUpResponse = typeof PROPOSAL_FOLLOW_UP_RESPONSES[number];

export type ServiceTicketStatus =
  | 'received'
  | 'created'
  | 'assigned'
  | 'visit_scheduled'
  | 'in_progress'
  | 'awaiting_part'
  | 'awaiting_customer'
  | 'escalated'
  | 'revisit'
  | 'resolved'
  | 'closed';

export type ServicePriority = 'low' | 'medium' | 'high' | 'critical';
export type WarrantyStatus = 'in_warranty' | 'out_of_warranty' | 'amc';

export type ExpenseStatus =
  | 'submitted'
  | 'manager_approved'
  | 'rejected'
  | 'clarification_required'
  | 'accounts_processed';

export type ExpenseCategory =
  | 'travel'
  | 'hotel'
  | 'local_conveyance'
  | 'food'
  | 'demo'
  | 'service'
  | 'other';

export type TaskStatus =
  | 'not_started'
  | 'in_progress'
  | 'completed'
  | 'blocked'
  | 'awaiting_approval'
  | 'overdue';

export type TaskBlockerType =
  | 'mgmt_approval'
  | 'customer'
  | 'vendor'
  | 'other_employee'
  | 'missing_info'
  | 'portal'
  | 'technical'
  | 'leave';

export type TaskBlockerDecision =
  | 'accepted'
  | 'rejected'
  | 'extended'
  | 'reassigned'
  | 'escalated';

export type BosModuleKey =
  | 'dashboard'
  | 'regional'
  | 'tenders'
  | 'leads'
  | 'visits'
  | 'demos'
  | 'proposals'
  | 'deliveries'
  | 'service'
  | 'expenses'
  | 'tasks'
  | 'notifications'
  | 'admin';

export interface RolePermissionProfile {
  role: UserRole;
  title: string;
  department: string;
  scopeSummary: string;
  responsibilities: string[];
  territorialScope: 'all_india' | 'regional' | 'assigned_accounts';
  allowedModules: BosModuleKey[];
  capabilities: {
    canViewAllIndia: boolean;
    canSwitchZones: boolean;
    canApproveTenders: boolean;
    canSubmitTenderBids: boolean;
    canManageDemos: boolean;
    canManageService: boolean;
    canEndorseExpensesStage1: boolean;
    canDisburseExpensesStage2: boolean;
    canUnblockTasks: boolean;
    canManageUsersAndMasters: boolean;
  };
}

export const ROLE_PROFILES: Record<UserRole, RolePermissionProfile> = {
  management: {
    role: 'management',
    title: 'Managing Director & Top Management',
    department: 'Executive Management',
    scopeSummary: 'Full operational and reporting visibility.',
    responsibilities: [
      'Full operational and reporting visibility across all 4 zones',
      'Final tender bidding approvals and commercial risk governance',
      'Stage 1 & Stage 2 reimbursement signoffs and expense oversight',
      'Cross-department task milestone tracking and blocker resolution',
    ],
    territorialScope: 'all_india',
    allowedModules: [
      'dashboard',
      'regional',
      'tenders',
      'leads',
      'visits',
      'demos',
      'proposals',
      'deliveries',
      'service',
      'expenses',
      'tasks',
      'notifications',
      'admin',
    ],
    capabilities: {
      canViewAllIndia: true,
      canSwitchZones: true,
      canApproveTenders: true,
      canSubmitTenderBids: true,
      canManageDemos: true,
      canManageService: true,
      canEndorseExpensesStage1: true,
      canDisburseExpensesStage2: true,
      canUnblockTasks: true,
      canManageUsersAndMasters: true,
    },
  },
  regional_manager: {
    role: 'regional_manager',
    title: 'Regional Manager',
    department: 'Regional Operations & Sales',
    scopeSummary: 'Regional sales, visits, leads, tender pipeline and employee performance.',
    responsibilities: [
      'Territory sales revenue pipeline and quota achievement',
      'Client tour planning with one-click "Also Meet" manager directives',
      'Territory leads qualification and client interactions monitoring',
      'Regional GeM tender identification, EMD tracking, and bid review',
      'Employee performance tracking & Blueprint §4 evidence scorecard (no auto-deductions)',
    ],
    territorialScope: 'regional',
    allowedModules: [
      'dashboard',
      'regional',
      'tenders',
      'leads',
      'visits',
      'demos',
      'proposals',
      'deliveries',
      'service',
      'expenses',
      'tasks',
      'notifications',
    ],
    capabilities: {
      canViewAllIndia: false,
      canSwitchZones: false,
      canApproveTenders: true,
      canSubmitTenderBids: false,
      canManageDemos: true,
      canManageService: true,
      canEndorseExpensesStage1: true,
      canDisburseExpensesStage2: false,
      canUnblockTasks: true,
      canManageUsersAndMasters: false,
    },
  },
  sales: {
    role: 'sales',
    title: 'Senior Sales Executive',
    department: 'Sales & Business Development',
    scopeSummary: 'Leads, customer interactions, visits, demos, proposals and personal tasks.',
    responsibilities: [
      'Lead generation, prospect tracking, and client interactions',
      'Field tour planner schedule, client visits & meeting logging',
      'Demo trial requests & equipment coordination with demo depot',
      'Client commercial proposals & price quote preparation',
      'Personal milestone tasks & blocker escalation',
    ],
    territorialScope: 'assigned_accounts',
    allowedModules: [
      'dashboard',
      'leads',
      'visits',
      'demos',
      'proposals',
      'deliveries',
      'tasks',
      'expenses',
      'notifications',
    ],
    capabilities: {
      canViewAllIndia: false,
      canSwitchZones: false,
      canApproveTenders: false,
      canSubmitTenderBids: false,
      canManageDemos: true,
      canManageService: false,
      canEndorseExpensesStage1: false,
      canDisburseExpensesStage2: false,
      canUnblockTasks: false,
      canManageUsersAndMasters: false,
    },
  },
  tender_team: {
    role: 'tender_team',
    title: 'Tender Operations Lead',
    department: 'GeM Tender Operations',
    scopeSummary: 'Tender identification, approval, submission, deadlines and results.',
    responsibilities: [
      'GeM portal tender identification & RFP requirement scrutiny',
      'Internal management bidding approval requests & commercial risk notes',
      'Bid preparation, PQ document compliance, technical envelope & EMD processing',
      'Critical deadline tracking (≤ 7-day closing countdowns)',
      'Tender financial results, bid awards, and L1/L2 post-bid analysis',
    ],
    territorialScope: 'all_india',
    allowedModules: [
      'dashboard',
      'tenders',
      'proposals',
      'tasks',
      'expenses',
      'notifications',
    ],
    capabilities: {
      canViewAllIndia: true,
      canSwitchZones: true,
      canApproveTenders: false,
      canSubmitTenderBids: true,
      canManageDemos: false,
      canManageService: false,
      canEndorseExpensesStage1: false,
      canDisburseExpensesStage2: false,
      canUnblockTasks: false,
      canManageUsersAndMasters: false,
    },
  },
  demo_team: {
    role: 'demo_team',
    title: 'Demo & Trials Specialist',
    department: 'Field Demonstrations & Depot Fleet',
    scopeSummary: 'Demo planning, equipment coordination, execution and outcome tracking.',
    responsibilities: [
      'Client demo planning and live equipment trial coordination',
      'Depot inventory matrix, serial reservation & gate-pass dispatch',
      'Field demo execution with defence & police procurement officers',
      'Outcome tracking, demonstration certificates & customer feedback closure',
    ],
    territorialScope: 'regional',
    allowedModules: [
      'dashboard',
      'demos',
      'visits',
      'tasks',
      'expenses',
      'notifications',
    ],
    capabilities: {
      canViewAllIndia: false,
      canSwitchZones: false,
      canApproveTenders: false,
      canSubmitTenderBids: false,
      canManageDemos: true,
      canManageService: false,
      canEndorseExpensesStage1: false,
      canDisburseExpensesStage2: false,
      canUnblockTasks: false,
      canManageUsersAndMasters: false,
    },
  },
  service_team: {
    role: 'service_team',
    title: 'Chief Service Engineer',
    department: 'Service & Maintenance Depot',
    scopeSummary: 'Customer complaints, service tickets, field visits and closure.',
    responsibilities: [
      'Customer complaint logging & SLA priority classification',
      'Breakdown service ticket dispatch & spare parts coordination',
      'On-site technical field visits and diagnostic maintenance',
      'Warranty/AMC verification, service report generation & final closure',
    ],
    territorialScope: 'regional',
    allowedModules: [
      'dashboard',
      'service',
      'deliveries',
      'visits',
      'tasks',
      'expenses',
      'notifications',
    ],
    capabilities: {
      canViewAllIndia: false,
      canSwitchZones: false,
      canApproveTenders: false,
      canSubmitTenderBids: false,
      canManageDemos: false,
      canManageService: true,
      canEndorseExpensesStage1: false,
      canDisburseExpensesStage2: false,
      canUnblockTasks: false,
      canManageUsersAndMasters: false,
    },
  },
  accounts: {
    role: 'accounts',
    title: 'Head of Finance & Billing',
    department: 'Finance & Accounts',
    scopeSummary: 'Expense submission, verification and approval status.',
    responsibilities: [
      'Field expense claim verification, GST invoice audit & policy checks',
      'Stage 2 finance signoff & payout disbursement processing',
      'Direct reimbursement approval status reporting',
      'Tender EMD/PBG bank guarantee tracking & accounting',
    ],
    territorialScope: 'all_india',
    allowedModules: [
      'dashboard',
      'expenses',
      'tasks',
      'notifications',
    ],
    capabilities: {
      canViewAllIndia: true,
      canSwitchZones: false,
      canApproveTenders: false,
      canSubmitTenderBids: false,
      canManageDemos: false,
      canManageService: false,
      canEndorseExpensesStage1: false,
      canDisburseExpensesStage2: true,
      canUnblockTasks: false,
      canManageUsersAndMasters: false,
    },
  },
  admin: {
    role: 'admin',
    title: 'System Administrator',
    department: 'IT & System Administration',
    scopeSummary: 'Users, departments, master records and permissions.',
    responsibilities: [
      'User provisioning, credentials, status toggling & reporting lines',
      'Department definitions and organizational hierarchy',
      'Master records: zones, regions, equipment, MHA QRs, client categories',
      'Configurable role permissions matrix and security audit trail',
    ],
    territorialScope: 'all_india',
    allowedModules: [
      'dashboard',
      'regional',
      'tenders',
      'leads',
      'visits',
      'demos',
      'proposals',
      'deliveries',
      'service',
      'expenses',
      'tasks',
      'notifications',
      'admin',
    ],
    capabilities: {
      canViewAllIndia: true,
      canSwitchZones: true,
      canApproveTenders: true,
      canSubmitTenderBids: true,
      canManageDemos: true,
      canManageService: true,
      canEndorseExpensesStage1: true,
      canDisburseExpensesStage2: true,
      canUnblockTasks: true,
      canManageUsersAndMasters: true,
    },
  },
};

