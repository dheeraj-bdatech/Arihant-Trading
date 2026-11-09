# Graph Report - arihant-bos  (2026-11-04)

## Corpus Check
- Large corpus: 580 files · ~736,735 words. Semantic extraction will be expensive (many Claude tokens). Consider running on a subfolder.

## Summary
- 6608 nodes · 23412 edges · 237 communities (155 shown, 82 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 1026 edges (avg confidence: 0.85)
- Token cost: 638,700 input · 0 output

## Community Hubs (Navigation)
- Web Shared UI Helpers
- Deliveries UI & Status Flow
- Audit Log & Calendar UI
- Admin Forms & User Invite
- Accounts & Expense Redirect Pages
- Database & Domain Events
- Tenders Controller
- App Module & E2E Tests
- Shared DB Table Types
- Territory & Expense Reports
- Tenders Service
- Notification Listener
- Lead & Proposal Lanes UI
- Accountability & Evidence API
- Performance Evidence UI
- Pagination & List Queries
- JWT Auth & Role Guards
- API Bootstrap & Migrations
- Expense Booking Form UI
- Deliveries Controller
- File Upload & Attachments
- Task Productivity Schema (025)
- API Dependencies
- Dashboard Metrics Rules
- Tender DTOs
- Role Dashboards UI
- Expense Approval Queues API
- Audit API & Search
- Service Tickets Service
- Proposals Service & Outbox
- Proposal DTOs
- Dashboard Metrics Service
- JWT Secret & JWKS
- Leads Controller
- Task Accountability Service
- Task Attachments Service
- Proposal Schema Migrations
- Cloudinary Uploads
- Service SLA Engine
- Command Palette & Layouts
- Task Jobs & Escalation
- Command Records Queries
- Service Controller
- Masters Lookup API
- Service DTOs
- Shared Enums
- Command Records Service
- Expense Decision Rules
- Task Access Control
- Tender Enterprise Schema (019)
- Demos Controller
- Demos Service
- Demo DTOs
- Access Matrix API
- Nest HTTP Decorators
- Lead DTOs
- Demo Schema Migrations
- Visits Service
- Contacts API
- Expense Filters
- Task Store & Delay SQL
- Service Schema Migrations
- Expense Claims Service
- Recurring Task Generator
- Product Images (Mismatched)
- Expense Schema (024)
- System Guide Buttons & RBAC
- Public Service Portal
- Products & Deployments UI
- Expense CSV Import
- Base DB Schema
- Seed Data (Tasks/Expenses)
- Root Workspace Config
- Task Config & Approvers
- Public Routes & Dashboard Module
- Visits Controller & DTOs
- Legacy Schema Dump
- Lead & Interaction Schema
- Dashboard Performance
- Notifications API
- Bulk Import Wizard
- Dev Innovations Doc
- Task PDF Renderer
- Tender Outbox Schema (007)
- Interactions API
- Service Portal Dedupe
- Users & Roles Schema
- Design System Doc
- Cron Deadline Jobs
- New Task Modal
- Docker Multi Compose
- API TS Config
- Antigravity Build Prompt
- Build Blueprint Plan
- Expense Claim DTOs
- Masters Admin API
- Performance Reviews
- Docker Compose (Dev)
- API Flow Spec Engines
- Web Dev Dependencies
- Web Dependencies
- Web TS Config
- Scope Freeze Spec
- Shared Package Config
- Expense Workflow Rules
- Agent Architecture Rules
- Dashboard Controller
- Evidence Snapshots
- User DTOs
- Root Layout & Theme
- Delivery Schema
- API Scripts
- Expense Masters
- Follow-ups API
- Organisations API
- Proposal Approval Bands
- UI Component Catalog
- Nest Controller Decorators
- Public Page Layouts
- Layout Primitives
- Operational Blueprint Concepts
- Trips & Activities Schema
- CI/CD Jobs
- CI/CD Build Steps
- Shared Filter DTOs
- Shared TS Config
- Audit Listener
- Lead Workflow
- List Paging Indexes
- Deployment Guide
- Design Token Rules
- Lead Chat
- Users Service
- Docker Compose (Prod)
- Scope PDF: Roles
- Scope PDF: Demo Module
- Verification Contract
- Product Image Categories
- Path Redirects
- Proposal Pipeline Doc
- Scope PDF: Vision
- Scope PDF: Leads & Command
- Scope PDF: Tenders
- CI/CD Workflow
- Expense Attachments
- Follow-up DTOs
- Lead Chat Public API
- Web Scripts
- Expense & Task Spec
- CI/CD Triggers
- CI/CD E2E Env
- CI/CD Publish
- Build Module Recipe
- Proposal Scheduler
- Reports Controller
- CI/CD Steps
- CI/CD Services
- Typography
- misc (minor)
- formatters.ts (minor)
- icon-512.png (minor)
- tailwind.config.js (minor)
- Arihant Trading Corporation BOS Scope Blueprint.pdf (minor)
- SKILL.md (minor)
- dev.js (minor)
- database.module.ts (minor)
- expense-import.service.ts (minor)
- misc (minor)
- page.tsx (minor)
- 012_tender_portal_issues_alignment.sql (minor)
- Arihant Trading Corporation BOS Scope Blueprint.pdf (minor)
- Arihant Trading Corporation BOS Scope Blueprint.pdf (minor)
- misc (minor)
- service.scheduler.ts (minor)
- check-colors.mjs (minor)
- arihant_bos_build_blueprint.html (minor)
- ci-cd.yml (minor)
- start-all.sh (minor)
- tsconfig.build.json (minor)
- generate_collection.py (minor)
- ci-cd.yml (minor)
- ci-cd.yml (minor)
- pnpm-workspace.yaml (minor)
- misc (minor)
- demos.controller.ts (minor)
- next.config.mjs (minor)
- safety_monitoring_band.png (minor)
- 010_tender_win_loss_issues.sql (minor)
- 028_tenders_qa_fixes.sql (minor)
- e2e-db-guard.ts (minor)
- bomb_locator_magnetometer.png (minor)
- portable_solar_charger.png (minor)

## God Nodes (most connected - your core abstractions)
1. `AuthUser` - 839 edges
2. `CurrentUser` - 383 edges
3. `Roles()` - 281 edges
4. `Button` - 206 edges
5. `@nestjs/common` - 178 edges
6. `react` - 160 edges
7. `Database` - 146 edges
8. `todayInKolkata()` - 145 edges
9. `InfoCallout()` - 132 edges
10. `Badge()` - 121 edges

## Surprising Connections (you probably didn't know these)
- `Standard Component Library Catalog` --semantically_similar_to--> `Component Library @/components/ui`  [INFERRED] [semantically similar]
  .agents/rules/design-system.md → AGENTS.md
- `Goal-Driven Execution` --semantically_similar_to--> `Verification Protocol (tsc --noEmit)`  [INFERRED] [semantically similar]
  .claude/skills/karpathy-guidelines/SKILL.md → AGENTS.md
- `Design Tokens Reference` --semantically_similar_to--> `Design Tokens`  [INFERRED] [semantically similar]
  .agents/rules/design-system.md → AGENTS.md
- `7-Gate Verification Protocol` --semantically_similar_to--> `7 Verification Gates`  [INFERRED] [semantically similar]
  .agents/rules/business-verification-contract.md → ARIHANT_BOS_OPERATIONAL_BLUEPRINT_SPEC.md
- `Dark Defence-Obsidian Theme` --conceptually_related_to--> `Light Executive Aesthetic Directive`  [AMBIGUOUS]
  README.md → .agents/rules/design-system.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **7-Gate Verification Contract across governance docs** — agents_verification_contract_7_gates, arihant_bos_operational_blueprint_spec_7_verification_gates, _agents_rules_business_verification_contract_7_gate_verification_protocol, arihant_bos_operational_blueprint_spec_mandatory_verification_contract_rule_0 [INFERRED 0.85]
- **Design system rule documents (tokens + component catalog)** — agents_design_tokens, _agents_rules_design_system_design_tokens_reference, _agent_rules_design_system_legacy_design_tokens_reference, agents_component_library_components_ui, _agents_rules_design_system_standard_component_library_catalog, _agent_rules_design_system_component_library_catalog [INFERRED 0.85]
- **Enter Once Use Everywhere propagation** — arihant_bos_operational_blueprint_spec_enter_once_use_everywhere, arihant_bos_api_flow_visual_specification_unified_system_spine, arihant_bos_api_flow_visual_specification_customer_360_timeline, arihant_bos_operational_blueprint_spec_immutable_audit_trail, arihant_bos_operational_blueprint_spec_module_10_management_command_dashboard [INFERRED 0.75]
- **Two-Stage Expense Approval (RM then Accounts) with self-approval block** — docs_scope_freeze_and_frozen_specifications_two_stage_expense_approval_hierarchy, docs_system_explanation_and_dev_innovations_two_stage_expense_sign_off, docs_arihant_bos_build_blueprint_two_stage_expense_approval_workflow, docs_arihant_bos_complete_system_guide_stage_1_rm_signoff_button, docs_arihant_bos_complete_system_guide_stage_2_settle_claim_button, docs_arihant_bos_complete_system_guide_assertnotselfapproval [INFERRED 0.85]
- **Tender participation approval and outcome lifecycle** — docs_scope_freeze_and_frozen_specifications_frozen_tender_stages_workflow, docs_arihant_bos_build_blueprint_tender_approval_workflow, docs_arihant_bos_complete_system_guide_participation_signoff_button, docs_arihant_bos_complete_system_guide_mark_bid_as_submitted_button, docs_arihant_bos_complete_system_guide_record_won_lost_button, docs_scope_freeze_and_frozen_specifications_tender_win_loss_analysis_reasons [INFERRED 0.85]
- **Event bus driving audit log, notifications and websocket pushes** — docs_arihant_bos_antigravity_prompt_event_driven_bus_nestjs_event_emitter, docs_arihant_bos_antigravity_prompt_domain_events_tender_status_changed_expense_submitted_etc, docs_arihant_bos_antigravity_prompt_audit_listener_audit_log, docs_arihant_bos_antigravity_prompt_socket_io_websocket_gateway, docs_arihant_bos_antigravity_prompt_cron_jobs_deadline_reminders_recurring_tasks [EXTRACTED 1.00]
- **Module lifecycle status workflows** — docs_arihant_trading_corporation_bos_scope_blueprint_demo_status_lifecycle, docs_arihant_trading_corporation_bos_scope_blueprint_tender_status_lifecycle, docs_arihant_trading_corporation_bos_scope_blueprint_proposal_workflow, docs_arihant_trading_corporation_bos_scope_blueprint_service_workflow, docs_arihant_trading_corporation_bos_scope_blueprint_expense_approval_workflow, docs_arihant_trading_corporation_bos_scope_blueprint_task_status_lifecycle [INFERRED 0.85]
- **Demo request to equipment reservation to outcome analysis** — docs_arihant_trading_corporation_bos_scope_blueprint_demo_request, docs_arihant_trading_corporation_bos_scope_blueprint_demo_team_assignment, docs_arihant_trading_corporation_bos_scope_blueprint_demo_equipment_reservation, docs_arihant_trading_corporation_bos_scope_blueprint_demo_equipment_availability, docs_arihant_trading_corporation_bos_scope_blueprint_demo_outcome_and_failure_analysis [EXTRACTED 1.00]
- **Cross-cutting supporting controls** — docs_arihant_trading_corporation_bos_scope_blueprint_notifications_and_escalations, docs_arihant_trading_corporation_bos_scope_blueprint_audit_trail, docs_arihant_trading_corporation_bos_scope_blueprint_role_based_access, docs_arihant_trading_corporation_bos_scope_blueprint_mobile_first_field_experience [INFERRED 0.75]
- **Arihant BOS app icon set (PWA, maskable, Apple, favicon) sharing one teal shield 'A' mark** — apps_web_public_icons_icon_192_image, apps_web_public_icons_icon_512_image, apps_web_public_icons_maskable_192_image, apps_web_public_icons_maskable_512_image, apps_web_src_app_apple_icon_image, apps_web_src_app_icon_image [INFERRED 0.95]
- **Product images whose content does not match filename (needs replacement)** — apps_web_public_products_anti_drone_tunnel_image, apps_web_public_products_ballistic_goggles_image, apps_web_public_products_ballistic_tshirt_image [AMBIGUOUS 0.30]
- **Handheld metal detector image set** — apps_web_public_products_nms20_hhmd_image, apps_web_public_products_nms30_hhmd_image, apps_web_public_products_pointer_detector_image [INFERRED 0.85]
- **Images whose content mismatches filename** — apps_web_public_products_injured_personnel_carrier_image, apps_web_public_products_ip68_search_light_image, apps_web_public_products_nij4_shield_system_image, apps_web_public_products_non_linear_junction_evaluator_image, apps_web_public_products_pointer_detector_image [AMBIGUOUS 0.30]
- **Product images mismatched with filename** — apps_web_public_products_pole_detector_image, apps_web_public_products_portable_solar_charger_image, apps_web_public_products_test_alpha_image, apps_web_public_products_unmanned_ground_vehicle_ugv_image [AMBIGUOUS 0.30]

## Communities (237 total, 82 thin omitted)

### Community 0 - "Web Shared UI Helpers"
Cohesion: 0.02
Nodes (333): errorMessage(), fieldErrors(), isConflict(), useToaster(), ImportModal(), ReviewEditor(), FlagList(), ApprovalQueuePage() (+325 more)

### Community 1 - "Deliveries UI & Status Flow"
Cohesion: 0.02
Nodes (219): allowedDeliveryStatuses(), BadgeVariant, CLOSED_DELIVERY, DELIVERY_BADGE, DELIVERY_FLOW, DELIVERY_STATUSES, deliveryBadge(), DeliveryMetrics (+211 more)

### Community 2 - "Audit Log & Calendar UI"
Cohesion: 0.04
Nodes (172): actionOf(), AuditLogsPage(), Change, changesOf(), DayColumns(), daysOf(), fmtDay(), fmtStamp() (+164 more)

### Community 3 - "Admin Forms & User Invite"
Cohesion: 0.03
Nodes (164): AdminDepartment, AdminProduct, AdminRegion, AdminUser, AdminZone, BulkInviteModal(), ConfirmModal(), DepartmentFormModal() (+156 more)

### Community 4 - "Accounts & Expense Redirect Pages"
Cohesion: 0.02
Nodes (124): AccountsQueueRedirect(), ExpenseApprovalsRedirect(), ExpenseClaimRedirect(), BadgeCounts, MultiSelect(), AppLayout(), SECTOR_OPTIONS, CATEGORY_META (+116 more)

### Community 5 - "Database & Domain Events"
Cohesion: 0.04
Nodes (30): KYSELY_DB, AppEvents, DomainEventEnvelope, OutboxService, EventsGateway, DeadlineRemindersJob, PRE_SUBMISSION_STATUSES, AuditTrailListener (+22 more)

### Community 7 - "App Module & E2E Tests"
Cohesion: 0.05
Nodes (39): AppModule, configureApp(), trustProxySetting(), JobsModule, VisitsModule, istDay(), purgeTaskModule(), advanceTicket() (+31 more)

### Community 8 - "Shared DB Table Types"
Cohesion: 0.02
Nodes (107): ApprovalRulesTable, AttachmentsTable, AuditLogTable, CompetitorsTable, ContactsTable, DashboardLayoutsTable, DeadLetterEventsTable, DeliveriesTable (+99 more)

### Community 9 - "Territory & Expense Reports"
Cohesion: 0.04
Nodes (70): orgTerritory(), Territory, CLOSED, ExpenseReportService, GROUPS, money(), PENDING, REVIEWED (+62 more)

### Community 10 - "Tenders Service"
Cohesion: 0.05
Nodes (5): rmTenderScope(), sqlList(), tenderReportScope(), TendersService, TendersWorkflowService

### Community 11 - "Notification Listener"
Cohesion: 0.07
Nodes (3): NotificationListener, ExpenseNotificationsListener, ProposalNotificationConsumer

### Community 12 - "Lead & Proposal Lanes UI"
Cohesion: 0.04
Nodes (101): PROPOSAL_LANES, BadgeVariant, categoryBadge(), formatLeadCategory(), getCategoryTone(), LEAD_LANES, leadCategoryKey(), pctOrNoData() (+93 more)

### Community 13 - "Accountability & Evidence API"
Cohesion: 0.08
Nodes (14): AccountabilityController, Body_, PerformanceEvidenceController, PerformanceReviewsController, sendFile(), TaskAttachmentsController, TaskBlockersController, TaskCalendarController (+6 more)

### Community 14 - "Performance Evidence UI"
Cohesion: 0.05
Nodes (96): ADMIN_LIKE, Evidence(), FrozenView, initials(), KEYS, PerformanceEvidencePage(), PERIOD_PRESETS, periodLabel() (+88 more)

### Community 15 - "Pagination & List Queries"
Cohesion: 0.05
Nodes (46): buildPaginatedResult(), getPaginationParams(), PaginationOptions, CLOSED_STATUS_LIST, FOLLOWUP_DUE_OPERATOR, LEAD_OWNER_ROLES, LEAD_RM_ROLES, LEAD_STAGE_ALIASES (+38 more)

### Community 16 - "JWT Auth & Role Guards"
Cohesion: 0.07
Nodes (23): JwtAuthGuard, ROLES_KEY, RolesGuard, HttpExceptionFilter, assertNotSelfApproval(), assertRegionScope(), checkRegionScope(), ScopeContext (+15 more)

### Community 17 - "API Bootstrap & Migrations"
Cohesion: 0.04
Nodes (48): bcryptjs@^3.0.2, dotenv@^16.4.7, pg@^8.13.3, runAutoMigrations(), bootstrap(), EXPENSE_CONFIG, loadExpenseConfig(), num() (+40 more)

### Community 18 - "Expense Booking Form UI"
Cohesion: 0.07
Nodes (75): categoryIcon(), ChipGroup(), ChipOption, FieldTile(), RevealButton(), StepCard(), StepDot(), Stepper() (+67 more)

### Community 19 - "Deliveries Controller"
Cohesion: 0.09
Nodes (3): CurrentUser, DeliveriesController, ProposalsController

### Community 20 - "File Upload & Attachments"
Cohesion: 0.10
Nodes (41): readText(), sanitizeFileName(), PURPOSES, conflict(), EXT_MIME, FieldErrors, readBool(), readComment() (+33 more)

### Community 21 - "Task Productivity Schema (025)"
Cohesion: 0.05
Nodes (67): employee_leaves, holidays, holidays_date_region_key, idx_employee_leaves_employee, idx_performance_reviews_employee, idx_performance_reviews_reviewer, idx_performance_snapshots_employee, idx_task_assignment_history_from (+59 more)

### Community 22 - "API Dependencies"
Cohesion: 0.04
Nodes (68): dependencies, @arihant/shared@workspace:*, class-transformer@^0.5.1, class-validator@^0.14.1, cloudinary@^2.5.1, exceljs@4.4.0, jsonwebtoken@^9.0.2, kysely@^0.27.6 (+60 more)

### Community 23 - "Dashboard Metrics Rules"
Cohesion: 0.05
Nodes (64): Cond, DEMO_DAY, FIELD_ROLES, istDay(), LEAD_ACTIVE, LEAD_CLOSED_STATUSES, LEAD_VALUE, LeadPipeline (+56 more)

### Community 24 - "Tender DTOs"
Cohesion: 0.13
Nodes (53): AddApproverDto, ApproveTenderDto, ChangeDeadlineDto, ChangeTenderStatusDto, CreateApprovalRuleDto, CreateCompetitorDto, CreateLinkedTenderDto, CreateLossReasonDto (+45 more)

### Community 25 - "Role Dashboards UI"
Cohesion: 0.08
Nodes (61): A(), accounts(), admin(), bars(), countdown(), demo(), DeskRole, DESKS (+53 more)

### Community 26 - "Expense Approval Queues API"
Cohesion: 0.09
Nodes (8): UploadedFile, TransitionDto, ExpenseAttachmentsController, ExpenseCategoriesController, ExpenseClaimsController, ExpenseReportsController, ProjectsController, toCategory()

### Community 27 - "Audit API & Search"
Cohesion: 0.05
Nodes (23): containsPattern(), AuditController, toAuditQuery(), AuditModule, AUDIT_EXPORT_LIMIT, AuditQuery, AuditService, csvCell() (+15 more)

### Community 28 - "Service Tickets Service"
Cohesion: 0.13
Nodes (6): cleanText(), detectRepeatComplaint(), ServiceService, allowedNextServiceStatuses(), canTransitionService(), normalizeServiceStatus()

### Community 29 - "Proposals Service & Outbox"
Cohesion: 0.15
Nodes (4): nextMinorVersion(), ProposalsService, hasQuotedValue(), proposalDisplayNo()

### Community 30 - "Proposal DTOs"
Cohesion: 0.14
Nodes (34): idempotencyCache, ApproveProposalDto, BulkReassignDto, ChangeProposalStatusDto, CloseProposalDto, CreateProposalDto, CreateProposalFollowupDto, CreateProposalVersionDto (+26 more)

### Community 31 - "Dashboard Metrics Service"
Cohesion: 0.11
Nodes (20): DashboardMetricsService, num(), round2(), teamIds(), teamScope(), tenderClosingWithin(), tenderScopeFor(), tenderTerritory() (+12 more)

### Community 32 - "JWT Secret & JWKS"
Cohesion: 0.08
Nodes (17): getJwtSecret(), getJwksKey(), jwksCache, logger, verifyAccessToken(), RealtimeModule, AuthController, signInContext() (+9 more)

### Community 33 - "Leads Controller"
Cohesion: 0.08
Nodes (3): LeadsController, LeadsService, LeadChatLinkDto

### Community 34 - "Task Accountability Service"
Cohesion: 0.08
Nodes (32): EvidenceQuery, istStart(), istStart(), TaskAccountabilityService, UploadedFile, ACCEPTED, blockerSummary(), ClassifiedTask (+24 more)

### Community 35 - "Task Attachments Service"
Cohesion: 0.07
Nodes (6): TaskAttachmentsService, TaskBlockersService, readPage(), DB, TaskWorkflowService, TaskTransitionRule

### Community 36 - "Proposal Schema Migrations"
Cohesion: 0.08
Nodes (43): idx_proposal_activities_proposal_id, idx_proposal_followups_proposal_id, idx_proposals_followup_owner_id, idx_proposals_next_followup, idx_proposals_org_id, idx_proposals_product_id, idx_proposals_proposal_number, idx_proposals_request_date (+35 more)

### Community 37 - "Cloudinary Uploads"
Cohesion: 0.06
Nodes (11): CloudinaryModule, ALLOWED_UPLOAD_FORMATS, cleanSetting(), CloudinaryCredentialCheck, CloudinaryService, CloudinarySignedParams, UploadsController, AttachFileDto (+3 more)

### Community 38 - "Service SLA Engine"
Cohesion: 0.06
Nodes (39): addBusinessHours(), businessDay(), businessMsBetween(), computeSla(), Db, FALLBACK_SLA, normalizeWarranty(), slaIsBusinessHours() (+31 more)

### Community 39 - "Command Palette & Layouts"
Cohesion: 0.07
Nodes (35): intOr(), Lister, DashboardLayoutService, CommandPage(), DeckItem, Tone, DATE_MODE, DECK_TONE (+27 more)

### Community 41 - "Command Records Queries"
Cohesion: 0.07
Nodes (40): Cond, Ctx, DEMO_RESULT, EXPENSE_STAGE, Page, Paged, PROPOSAL_OUTCOME, PROPOSAL_PENDING (+32 more)

### Community 44 - "Service DTOs"
Cohesion: 0.15
Nodes (23): AssignEngineerDto, CheckInVisitDto, CheckOutVisitDto, CloseTicketDto, CreatePartRequestDto, CreateTicketCommentDto, CreateTicketDto, CreateVisitDto (+15 more)

### Community 45 - "Shared Enums"
Cohesion: 0.05
Nodes (39): FOLLOW_UP_STATUSES, INTERACTION_TYPES, InteractionType, LEAD_CATEGORIES, LEAD_LOSS_REASONS, LEAD_STATUSES, LEAD_TYPES, PROPOSAL_CLOSURE_REASONS (+31 more)

### Community 46 - "Command Records Service"
Cohesion: 0.20
Nodes (17): DashboardCommandRecordsService, joined(), actionTone(), claimsHref(), DashboardCommandService, day(), href(), human() (+9 more)

### Community 47 - "Expense Decision Rules"
Cohesion: 0.08
Nodes (25): applyItemDecisions(), DECISION_STATUSES, DecisionItem, DecisionResult, finalStatus(), ItemUpdate, CategoryRule, FieldErrors (+17 more)

### Community 48 - "Task Access Control"
Cohesion: 0.08
Nodes (4): isRm(), TaskAccessService, TaskMastersService, WorkingCalendar

### Community 49 - "Tender Enterprise Schema (019)"
Cohesion: 0.09
Nodes (25): tender_categories, trg_tender_integrity_sync(), approval_rules, competitors, document_checklist_templates, idx_tender_assignment_history_tid, idx_tender_comments_tid, idx_tender_corrigenda_tid (+17 more)

### Community 51 - "Demos Service"
Cohesion: 0.15
Nodes (5): assertNotPastDemoDate(), DemosService, dmy(), formatDateOnly(), toDay()

### Community 52 - "Demo DTOs"
Cohesion: 0.21
Nodes (21): AllocateAnotherUnitDto, ApproveReservationDto, AssignTeamDto, CancelDemoDto, ConfirmDemoDto, CreateDemoDto, CreateEquipmentDto, DemoQueryDto (+13 more)

### Community 53 - "Access Matrix API"
Cohesion: 0.08
Nodes (12): AccessController, AccessModule, ModuleAccessInterceptor, accessEntityId(), ModuleAccessService, ACCESS_MODULE_KEYS, ACCESS_MODULES, AccessModule (+4 more)

### Community 55 - "Lead DTOs"
Cohesion: 0.16
Nodes (18): AddProductInterestDto, AssignLeadDto, ChangeLeadStatusDto, CreateLeadDto, CreateLeadMessageDto, LeadChatPostDto, LeadChatQueryDto, LeadFilterQueryDto (+10 more)

### Community 56 - "Demo Schema Migrations"
Cohesion: 0.09
Nodes (26): demo_reschedule_history, idx_demo_equipment_serial_no, idx_demo_outcomes_demo_id_unique, idx_demo_reschedule_history_demo_id, idx_demo_reservations_demo_id, idx_demo_reservations_equipment_dates, idx_demos_assigned_to, idx_demos_confirmed_date (+18 more)

### Community 57 - "Visits Service"
Cohesion: 0.17
Nodes (5): calendarDay(), dmy(), normaliseSerials(), dmy(), VisitsService

### Community 58 - "Contacts API"
Cohesion: 0.09
Nodes (4): ContactsController, CreateContactDto, UpdateContactDto, ContactsService

### Community 59 - "Expense Filters"
Cohesion: 0.11
Nodes (16): amount(), claimFilterExpressions(), decidedDateIst, ExpenseFilters, hasItemLevelFilter(), itemFilterExpressions(), parseExpenseFilters(), processedDateIst (+8 more)

### Community 60 - "Task Store & Delay SQL"
Cohesion: 0.12
Nodes (7): TaskSettings, TaskStore, parseTaskFilters(), TasksService, uuids(), allowedTaskActions(), isIsoDateString()

### Community 61 - "Service Schema Migrations"
Cohesion: 0.10
Nodes (29): idx_part_requests_status, idx_part_requests_ticket_id, idx_service_reports_report_status, idx_service_reports_visit_id, idx_service_tickets_assigned_engineer, idx_service_tickets_customer_id, idx_service_tickets_deleted_at, idx_service_tickets_region_id (+21 more)

### Community 62 - "Expense Claims Service"
Cohesion: 0.19
Nodes (7): conflict(), ExpenseClaimsService, money(), readVersion(), serializeClaim(), serializeItem(), staleVersion()

### Community 63 - "Recurring Task Generator"
Cohesion: 0.11
Nodes (6): horizonDays(), parseRule(), TaskGeneratorService, TemplateRow, TaskTemplatesService, TaskRecurrenceRule

### Community 64 - "Product Images (Mismatched)"
Cohesion: 0.08
Nodes (32): AMBIGUOUS: anti_drone_tunnel.png actually shows a tracked EOD/bomb-disposal robot with blue multi-joint manipulator arm and cameras, not an anti-drone tunnel, Arihant Trading Corp (ATC) Brand, AMBIGUOUS: ballistic_goggles.png is a phone screenshot of 'Corporate_Equipment_Brochure' page showing ballistic goggles (polycarbonate mono-lens, wrap-around fit), a concealable ballistic T-shirt and a ballistic vest, Ballistic Protection (body armour, goggles, shields), AMBIGUOUS: ballistic_tshirt.png is a phone brochure screenshot showing an 'ATC Full Body' riot protection suit and camouflage folding BP (bulletproof) shields with Arihant Trading Corp logo, not a T-shirt, Ballistic Vest - grey concealable soft-armour vest with shoulder pads and velcro side straps, plus neck collar, Bomb Locator Magnetometer (deep-seeking detector with control box & headphones), BP Morcha image (actually brochure phone screenshot: ballistic goggles, concealable vest, body armour) (+24 more)

### Community 65 - "Expense Schema (024)"
Cohesion: 0.12
Nodes (30): expense_approval_history, expense_attachments, expense_categories, expense_claims, expense_history_immutable(), expense_items, idx_expense_attachments_item, idx_expense_attachments_sha (+22 more)

### Community 66 - "System Guide Buttons & RBAC"
Cohesion: 0.08
Nodes (31): Self-Approval Blocked, Also-Meet Directive Button, assertNotSelfApproval, Complete System Architecture Button Guide & RBAC Matrix, Customer Tour & Fiscal Settlement Flow, Depot Fleet Reservation & Trial Analysis Flow, Equipment Breakdown & Maintenance Desk Flow, Flag Blocker Button (+23 more)

### Community 67 - "Public Service Portal"
Cohesion: 0.13
Nodes (6): clientIp(), ServicePortalController, PortalCommentDto, PortalFeedbackDto, PortalServiceRequestDto, PortalTrackQueryDto

### Community 68 - "Products & Deployments UI"
Cohesion: 0.12
Nodes (22): DEPLOYMENT_ROWS, DeploymentRow, DeploymentStatus, SORT_FIELDS, SortField, STATUS_META, Equipment3DViewer(), Equipment3DViewerProps (+14 more)

### Community 69 - "Expense CSV Import"
Cohesion: 0.11
Nodes (26): ExpenseConfig, cellText(), ImportRowError, toIsoDate(), addDays(), AnomalyLine, assertNoFutureDates(), DatedLine (+18 more)

### Community 70 - "Base DB Schema"
Cohesion: 0.21
Nodes (28): attachments, audit_log, contacts, demo_equipment, demo_outcomes, demo_reservations, demos, employee_activities (+20 more)

### Community 71 - "Seed Data (Tasks/Expenses)"
Cohesion: 0.12
Nodes (28): act(), attach(), backdate(), blocker(), call(), day(), decide(), detail() (+20 more)

### Community 72 - "Root Workspace Config"
Cohesion: 0.07
Nodes (29): devDependencies, typescript@^5.7.3, typescript, name, pnpm, onlyBuiltDependencies, private, scripts (+21 more)

### Community 73 - "Task Config & Approvers"
Cohesion: 0.15
Nodes (19): REVIEW_EVENTS, ApproverResolution, AssignScope, TaskAuthorityRow, loadTaskConfig(), num(), TASK_CONFIG, TaskConfig (+11 more)

### Community 74 - "Public Routes & Dashboard Module"
Cohesion: 0.10
Nodes (12): express@^4.22.3, IS_PUBLIC_KEY, Public(), DashboardModule, ExpenseManagementModule, LeadChatController, LeadsModule, ProposalsModule (+4 more)

### Community 75 - "Visits Controller & DTOs"
Cohesion: 0.21
Nodes (15): VisitIdPipe, AddVisitToTripDto, CancelVisitDto, ChangeDestinationDto, ChangeVisitStatusDto, CreateTripDto, CreateVisitDto, IsPostgresUUID() (+7 more)

### Community 76 - "Legacy Schema Dump"
Cohesion: 0.22
Nodes (26): attachments, audit_log, contacts, demo_equipment, demo_outcomes, demo_reservations, demos, expenses (+18 more)

### Community 77 - "Lead & Interaction Schema"
Cohesion: 0.11
Nodes (23): idx_interactions_visit_id_unique, idx_interactions_demo_id_unique, follow_ups, idx_follow_ups_assigned_status, idx_follow_ups_lead, idx_follow_ups_org_status, idx_interaction_attachments_interaction, idx_interactions_org_occurred (+15 more)

### Community 78 - "Dashboard Performance"
Cohesion: 0.10
Nodes (13): Ctx, DashboardPerformanceService, num(), rate(), PerformanceDemoFigures, PerformanceFigures, PerformanceGroupBy, PerformanceLeadFigures (+5 more)

### Community 79 - "Notifications API"
Cohesion: 0.11
Nodes (3): NotificationsController, categorySql(), NotificationsService

### Community 80 - "Bulk Import Wizard"
Cohesion: 0.10
Nodes (25): ACTION_BADGE, buildRows(), BulkImportWizardModalProps, DATE_FIELDS, DelimitedParse, FIELD_LABELS, formatRupees(), HEADER_ALIASES (+17 more)

### Community 81 - "Dev Innovations Doc"
Cohesion: 0.10
Nodes (13): Two-Stage Expense Approval Workflow, Cmd+K Command Palette, Depot Barcode QR Chain-of-Custody, Developer Innovation Roadmap Phases A-D, Financial Anomaly Detection Anti-Fraud Shield, GeM PDF Tender Parser & MHA QR Compliance Scanner, OCR Expense Scanner & GSTIN Validator, Offline-First Mobile PWA (+5 more)

### Community 82 - "Task PDF Renderer"
Cohesion: 0.23
Nodes (7): esc(), n(), PDF_COLORS, PdfBuilder, pdfSafe(), RGB, textWidth()

### Community 83 - "Tender Outbox Schema (007)"
Cohesion: 0.13
Nodes (21): idx_outbox_events_status, idx_processed_events_key, idx_tender_activities_tid, idx_tender_approvals_tid, idx_tender_portal_issues_tid, idx_tenders_assigned, idx_tenders_category_status, idx_tenders_owner (+13 more)

### Community 84 - "Interactions API"
Cohesion: 0.10
Nodes (4): InteractionsController, CreateInteractionDto, InteractionAttachmentDto, InteractionsService

### Community 85 - "Service Portal Dedupe"
Cohesion: 0.17
Nodes (6): generateTicketNo(), nameSimilarity(), normalizePhone(), orgTokens(), ServicePortalService, sha256()

### Community 86 - "Users & Roles Schema"
Cohesion: 0.08
Nodes (18): app_users, departments, role_permissions, loss_reasons, tender_approvers, tender_deadline_changes, tender_notifications_log, tender_results (+10 more)

### Community 87 - "Design System Doc"
Cohesion: 0.11
Nodes (21): Arihant BOS Design System & Component Library, Border Primary DCD8CE, Brand Primary Teal 0F5E63, Button, Canvas Background F6F5F1, Card, Checkbox, components ui Library (+13 more)

### Community 88 - "Cron Deadline Jobs"
Cohesion: 0.16
Nodes (4): assertNotPast(), FollowUpsService, todayInKolkata(), isoDaysBetween()

### Community 89 - "New Task Modal"
Cohesion: 0.12
Nodes (19): NewTaskButton(), NewTaskModal(), TaskFormPrefill, customerOf(), day(), join(), Loaded, RelatedRecordsProps (+11 more)

### Community 90 - "Docker Multi Compose"
Cohesion: 0.09
Nodes (22): build, container_name, env_file, networks, ports, restart, driver, context (+14 more)

### Community 91 - "API TS Config"
Cohesion: 0.09
Nodes (21): compilerOptions, allowSyntheticDefaultImports, baseUrl, declaration, emitDecoratorMetadata, experimentalDecorators, forceConsistentCasingInFileNames, incremental (+13 more)

### Community 92 - "Antigravity Build Prompt"
Cohesion: 0.12
Nodes (19): Antigravity BOS Build Prompt, arihant_bos_build_blueprint.html, Audit Listener audit_log, Cloudinary Chunked Signed Uploads, Cron Jobs Deadline Reminders Recurring Tasks, Domain Events tender.status_changed expense.submitted etc, Edge Case Catalogue, Guardrails (+11 more)

### Community 93 - "Build Blueprint Plan"
Cohesion: 0.10
Nodes (15): Per-Module Recipe build-module.md, 8-Day Plan, Architecture Stack NestJS Next.js Supabase, Arihant BOS Build Blueprint, Eight Roles, Folder Structure bos-api bos-web, Frontend Design References Linear Attio Stripe HubSpot, Interactions Unified Timeline (+7 more)

### Community 94 - "Expense Claim DTOs"
Cohesion: 0.19
Nodes (16): DateWindow, DB, ClaimHeaderDto, ExpenseCategoryDto, ExpenseItemDto, ImportClaimDto, ItemDecisionDto, ReassignApproverDto (+8 more)

### Community 97 - "Docker Compose (Dev)"
Cohesion: 0.10
Nodes (19): POSTGRES_DB, POSTGRES_PASSWORD, POSTGRES_USER, interval, retries, test, timeout, container_name (+11 more)

### Community 98 - "API Flow Spec Engines"
Cohesion: 0.13
Nodes (15): Core Business Tenets, API Flow Visual Specification, assertSubmissionReadiness, Command Exception Engine, Demo Conflict Engine (409), Demo Failure Auto Service Ticket, Feedback Hub /feedback, Service SLA Clock (+7 more)

### Community 99 - "Web Dev Dependencies"
Cohesion: 0.15
Nodes (18): devDependencies, autoprefixer@^10.4.20, postcss@^8.5.3, tailwindcss@^3.4.17, @types/node@^22.13.10, @types/react@^18.3.18, @types/react-dom@^18.3.5, typescript@^5.7.3 (+10 more)

### Community 100 - "Web Dependencies"
Cohesion: 0.11
Nodes (19): dependencies, @arihant/shared@workspace:*, canvas-confetti@^1.9.4, clsx@^2.1.1, lucide-react@^0.475.0, next@^14.2.24, react@^18.3.1, react-dom@^18.3.1 (+11 more)

### Community 101 - "Web TS Config"
Cohesion: 0.11
Nodes (18): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+10 more)

### Community 102 - "Scope Freeze Spec"
Cohesion: 0.12
Nodes (15): Tender Approval Workflow, RBAC Master Route Matrix, 8-Role RBAC Matrix, Expense Categories, Formal Scope Freeze & Frozen Specifications ARH-BOS-SPEC-FREEZE-2026-V1, Frozen Tender Stages Workflow, GeM Bid Number Format, Lead Matrix Category Probability Channel (+7 more)

### Community 103 - "Shared Package Config"
Cohesion: 0.13
Nodes (18): dependencies, kysely@^0.27.5, zod@^3.24.2, devDependencies, tsup@^8.3.5, typescript@^5.7.3, kysely, typescript (+10 more)

### Community 104 - "Expense Workflow Rules"
Cohesion: 0.12
Nodes (15): ConveyanceDetails, EXPENSE_ACTION_LABELS, EXPENSE_EDITABLE_STATUSES, EXPENSE_IMPORT_TEMPLATE_COLUMNS, EXPENSE_INACTIVE_FOR_DUPLICATES, EXPENSE_ITEM_STATUS_LABELS, EXPENSE_TERMINAL_STATUSES, ExpenseActorKind (+7 more)

### Community 105 - "Agent Architecture Rules"
Cohesion: 0.14
Nodes (17): Service Layer with Region Scoping and IDOR Block, AGENTS Workspace Guidelines, Domain Events via EventEmitter2, Kysely Query Builder, RBAC and Territorial Scoping, Shared Package @arihant/shared, Typography Standard (Source Serif 4 / IBM Plex), Verification Protocol (tsc --noEmit) (+9 more)

### Community 108 - "User DTOs"
Cohesion: 0.24
Nodes (3): BulkInviteUserItemDto, CreateUserDto, UpdateUserDto

### Community 109 - "Root Layout & Theme"
Cohesion: 0.15
Nodes (13): geist@^1.7.2, metadata, RootLayout(), CUSTOMER_ROUTES, isCustomerRoute(), PersonaSwitcherFab(), PersonaSwitcherPanel(), ROLE_CAPABILITY_TAGS (+5 more)

### Community 110 - "Delivery Schema"
Cohesion: 0.15
Nodes (11): deliveries, idx_deliveries_assigned_to, idx_deliveries_delivery_date, idx_deliveries_organisation_id, idx_deliveries_status, idx_deliveries_tender_id, uq_organisations_name_city_normalised, idx_deliveries_proposal_id (+3 more)

### Community 111 - "API Scripts"
Cohesion: 0.12
Nodes (16): scripts, build, dev, lint, migrate, migrate:prod, repair:visit-trips, seed (+8 more)

### Community 112 - "Expense Masters"
Cohesion: 0.19
Nodes (5): ProjectDto, ExpenseMastersService, optionalBool(), optionalMoney(), ExpenseValidationException

### Community 115 - "Proposal Approval Bands"
Cohesion: 0.18
Nodes (8): approvalBandOf(), DEFAULT_MANAGEMENT_APPROVAL_THRESHOLD, managementApprovalThreshold(), ProposalSettingsConfig, ProposalsWorkflowService, TERMINAL_PROPOSAL_STATUSES, TransitionContext, ProposalStatus

### Community 116 - "UI Component Catalog"
Cohesion: 0.13
Nodes (15): Badge, Button, Card, Component Library @/components/ui, EmptyState, FilterBar, InfoCallout, Input (+7 more)

### Community 118 - "Public Page Layouts"
Cohesion: 0.21
Nodes (11): LeadChatLayout(), metadata, ServiceRequestLayout(), AppearanceMenu(), SIZES, APP_THEMES, AppSize, AppTheme (+3 more)

### Community 119 - "Layout Primitives"
Cohesion: 0.15
Nodes (12): Container, ContainerProps, DividerProps, Grid, GridProps, HStack, SpacerProps, spacingMap (+4 more)

### Community 120 - "Operational Blueprint Concepts"
Cohesion: 0.14
Nodes (14): Customer 360 Timeline, 13-Stage Tender State Machine, Also-Meet Directive, Demo Depots Delhi Patna Kolkata, Demo Failure Categories, External Portal Issues Tracker, Module 1 Lead and Customer Management, Module 2 Visit and Field Planning (+6 more)

### Community 121 - "Trips & Activities Schema"
Cohesion: 0.20
Nodes (12): employee_activities, idx_employee_activities_date, idx_employee_activities_emp_date, idx_trips_employee_date, idx_trips_status, idx_visit_updates_visit_id_unique, idx_visits_assigned_date, idx_visits_org_date (+4 more)

### Community 122 - "CI/CD Jobs"
Cohesion: 0.13
Nodes (15): env, environment, if, name, needs, runs-on, timeout-minutes, DEPLOY_DIR (+7 more)

### Community 123 - "CI/CD Build Steps"
Cohesion: 0.13
Nodes (15): with, cache, cache-from, cache-to, context, labels, node-version, password (+7 more)

### Community 124 - "Shared Filter DTOs"
Cohesion: 0.20
Nodes (14): DashboardMetricsDto, DeliveryFilterDto, ExpenseFilterDto, LEAD_CUSTOMER_CHAT_ROLES, LeadChatMessageDto, LeadFilterDto, PaginationQueryDto, ProposalDashboardStatsDto (+6 more)

### Community 125 - "Shared TS Config"
Cohesion: 0.13
Nodes (14): compilerOptions, declaration, declarationMap, esModuleInterop, forceConsistentCasingInFileNames, module, moduleResolution, outDir (+6 more)

### Community 126 - "Audit Listener"
Cohesion: 0.15
Nodes (5): AuditEventPayload, AuditListener, NO_RECORD_ID, SINGLETON_RECORD_ID, AppEventsModule

### Community 127 - "Lead Workflow"
Cohesion: 0.19
Nodes (10): LeadWorkflowService, InviteRow, AuthContextType, AppUsersTable, RoleModuleBlocksTable, RolePermissionsTable, UsersTable, DashboardWorkspaceDto (+2 more)

### Community 128 - "List Paging Indexes"
Cohesion: 0.15
Nodes (10): idx_audit_log_actor_created, idx_audit_log_entity_id, idx_expense_claims_updated_live, idx_notifications_user_created, idx_proposals_last_activity, idx_tenders_organisation_id, idx_tenders_submission_deadline, idx_trips_trip_date (+2 more)

### Community 129 - "Deployment Guide"
Cohesion: 0.15
Nodes (13): apps web next.config.mjs, apps web src lib api.ts Relative API, ecosystem.config.js PM2 Config, NestJS Backend Port 4000, Next.js API Rewrite to NestJS, Next.js Frontend Port 3000, Nginx Reverse Proxy, PaaS Deployment Railway Render (+5 more)

### Community 130 - "Design Token Rules"
Cohesion: 0.18
Nodes (12): Component Library Catalog, Legacy Design System Rules (.agent), Legacy Design Tokens Reference, Legacy Light Enterprise Blue Theme, Design System Rules (.agents), Design Tokens Reference, Standard Component Library Catalog, Dark Navy Panel #14213D (+4 more)

### Community 131 - "Lead Chat"
Cohesion: 0.23
Nodes (3): LeadChatService, sha256(), LeadChatViewDto

### Community 133 - "Docker Compose (Prod)"
Cohesion: 0.15
Nodes (12): build, container_name, env_file, environment, image, ports, restart, context (+4 more)

### Community 134 - "Scope PDF: Roles"
Cohesion: 0.15
Nodes (12): Admin Role, Demo Team Role, Management Role, Regional Manager Role, Sales Team Role, Service and After-Sales Management Module, Service Management Dashboard, Service Report (+4 more)

### Community 135 - "Scope PDF: Demo Module"
Cohesion: 0.23
Nodes (12): Audit Trail, Demo Equipment Availability, Demo Equipment Reservation, Demo Management Module, Demo Request, Demo Status Lifecycle, Demo Team Assignment, End-to-End BOS Flow (+4 more)

### Community 136 - "Verification Contract"
Cohesion: 0.23
Nodes (9): 7-Gate Verification Protocol, Business Verification Contract, Founding Alignment Meeting Nuances, 7 Verification Gates, Arihant Trading Corporation BOS Scope Blueprint PDF, B2G Enterprise Model, Module 9 Regional and Rep Scorecards, Operational Blueprint Specification (+1 more)

### Community 137 - "Product Image Categories"
Cohesion: 0.20
Nodes (11): Brand & Marketing Assets, Emergency Splint (arm immobilization splint), Environmental / Air Quality Monitoring, Field Shelter & Infrastructure, India Installation Map (blank 3D state-boundary map of India), Inflatable Tent (olive field shelter + orange inflatable frame shelter), Injured Personnel Carrier image (shows Make in India lion logo), IP68 Search Light image (shows Noron solar water heater panel) (+3 more)

### Community 138 - "Path Redirects"
Cohesion: 0.35
Nodes (6): PathRedirect(), Redirect(), Page(), Page(), Page(), Page()

### Community 139 - "Proposal Pipeline Doc"
Cohesion: 0.24
Nodes (11): Module 5 Proposal Management, Proposal Workflow, Atomic Proposal Number Sequence, CSV Formula Injection Escaping, docs/MODULE_5_PROPOSAL_MANAGEMENT_PIPELINE.md, Follow-up Cadence Engine, Idempotency-Key Cache, Proposal Pipeline Specification (+3 more)

### Community 140 - "Scope PDF: Vision"
Cohesion: 0.25
Nodes (6): Arihant Trading Corporation, BDA Technologies, BOS Scope Blueprint, Business Operating System, Inputs Required From Arihant, Recommended Implementation Sequence

### Community 141 - "Scope PDF: Leads & Command"
Cohesion: 0.25
Nodes (8): Customer Interaction Timeline, Lead and Customer Management Module, Management Command Dashboard, Performance Indicators, Post-Visit Update, Salesperson and Regional Performance Module, Visit and Field Planning Module, Weekly Visit Planning Cycle

### Community 142 - "Scope PDF: Tenders"
Cohesion: 0.24
Nodes (9): Tender Classification PQ vs General MHA, Tender Identification, Tender Management Module, Tender Reporting, Tender Status Lifecycle, Tender Win Loss Analysis, Vikas, WhatsApp (+1 more)

### Community 143 - "CI/CD Workflow"
Cohesion: 0.18
Nodes (10): name, runs-on, timeout-minutes, env, NEXT_TELEMETRY_DISABLED, NODE_VERSION, PNPM_VERSION, jobs (+2 more)

### Community 145 - "Follow-up DTOs"
Cohesion: 0.42
Nodes (4): CancelFollowUpDto, CompleteFollowUpDto, CreateFollowUpDto, RescheduleFollowUpDto

### Community 147 - "Web Scripts"
Cohesion: 0.20
Nodes (10): scripts, build, build:web, dev, lint, lint:colors, prebuild, prebuild:web (+2 more)

### Community 148 - "Expense & Task Spec"
Cohesion: 0.20
Nodes (7): Tally ERP Export Endpoint, 2-Stage Expense Approval, Blocker Workflow, GeM Government e-Marketplace, Module 7 Field Expense Management, Module 8 Tasks Blockers and Performance Evidence, Tally Excel Export

### Community 149 - "CI/CD Triggers"
Cohesion: 0.20
Nodes (10): default, description, type, e2e, on, pull_request, push, workflow_dispatch (+2 more)

### Community 150 - "CI/CD E2E Env"
Cohesion: 0.20
Nodes (10): env, if, name, runs-on, timeout-minutes, DATABASE_URL, DIRECT_URL, E2E_DATABASE_URL (+2 more)

### Community 151 - "CI/CD Publish"
Cohesion: 0.20
Nodes (10): PUBLISH, env, name, needs, outputs, runs-on, timeout-minutes, image (+2 more)

### Community 152 - "Build Module Recipe"
Cohesion: 0.22
Nodes (9): 5-Step Per-Module Recipe, Build Module Recipe, Controller with JwtAuthGuard and RolesGuard, docs/DESIGN_SYSTEM.md, DTOs with class-validator, Optimistic Locking via updated_at, Realtime WebSocket Notifications Wiring, WS /events Realtime Feed (+1 more)

### Community 155 - "CI/CD Steps"
Cohesion: 0.42
Nodes (9): steps, steps, steps, steps, id, if, name, run (+1 more)

### Community 156 - "CI/CD Services"
Cohesion: 0.22
Nodes (9): services, POSTGRES_DB, POSTGRES_PASSWORD, POSTGRES_USER, env, image, options, ports (+1 more)

### Community 157 - "Typography"
Cohesion: 0.25
Nodes (6): Heading, HeadingProps, KbdProps, LabelProps, Text, TextProps

### Community 160 - "icon-512.png (minor)"
Cohesion: 0.48
Nodes (7): Arihant BOS Brand Mark (teal #0F5E63 shield with 'A'), PWA Icon 192 - white shield with 'A' monogram on deep teal rounded square, PWA Icon 512 - white shield with 'A' monogram on deep teal rounded square, Maskable PWA Icon 192 - shield 'A' mark on full-bleed teal with safe-zone padding, Maskable PWA Icon 512 - shield 'A' mark on full-bleed teal with safe-zone padding, Apple Touch Icon - shield 'A' mark on full-bleed teal square, Next.js App Icon (favicon) - white shield 'A' on teal rounded square

### Community 161 - "tailwind.config.js (minor)"
Cohesion: 0.29
Nodes (5): green, neutral, ochre, teal, terracotta

### Community 162 - "Arihant Trading Corporation BOS Scope Blueprint.pdf (minor)"
Cohesion: 0.29
Nodes (5): GeM Portal, Proposal Management Module, Proposal Register, Proposal Workflow, Tender External Portal Issues

### Community 164 - "dev.js (minor)"
Cohesion: 0.33
Nodes (3): server, { spawn, execSync }, tsc

### Community 168 - "page.tsx (minor)"
Cohesion: 0.47
Nodes (4): Page(), Redirect(), TaskSectionRedirect(), Page()

### Community 169 - "012_tender_portal_issues_alignment.sql (minor)"
Cohesion: 0.47
Nodes (4): sync_tender_portal_issues_columns(), sync_tender_status_history_columns(), trg_sync_tender_portal_issues_columns, trg_sync_tender_status_history_columns

### Community 170 - "Arihant Trading Corporation BOS Scope Blueprint.pdf (minor)"
Cohesion: 0.33
Nodes (5): Accounts Team Role, Expense Approval Workflow, Expense Categories, Expense Submission and Approval Module, Tally

### Community 171 - "Arihant Trading Corporation BOS Scope Blueprint.pdf (minor)"
Cohesion: 0.47
Nodes (4): Employee Accountability, Task and Productivity Management Module, Task Assignment, Task Status Lifecycle

### Community 176 - "ci-cd.yml (minor)"
Cohesion: 0.50
Nodes (5): permissions, permissions, permissions, contents, packages

### Community 177 - "start-all.sh (minor)"
Cohesion: 0.40
Nodes (4): NODE_ENV, PORT, start-all.sh script, WEB_PORT

### Community 179 - "tsconfig.build.json (minor)"
Cohesion: 0.50
Nodes (3): exclude, extends, ./tsconfig.json

### Community 181 - "ci-cd.yml (minor)"
Cohesion: 0.67
Nodes (4): concurrency, cancel-in-progress, group, concurrency

### Community 182 - "ci-cd.yml (minor)"
Cohesion: 0.50
Nodes (4): GHCR_TOKEN, KNOWN_HOSTS, SSH_KEY, env

### Community 183 - "pnpm-workspace.yaml (minor)"
Cohesion: 0.50
Nodes (3): allowBuilds, esbuild, packages

### Community 187 - "safety_monitoring_band.png (minor)"
Cohesion: 1.00
Nodes (3): Occupational Safety Monitoring, Safety Monitoring Band image (composite: heat-stress meter, wrist band, sound meter, handheld analyzer), Sound Level Meter image (composite: heat-stress meter, wrist band, sound meter, handheld analyzer)

## Ambiguous Edges - Review These
- `Legacy Design System Rules (.agent)` → `Design System Rules (.agents)`  [AMBIGUOUS]
  .agent/rules/design-system.md · relation: conceptually_related_to
- `Warm Linen Canvas #F6F5F1` → `Legacy Light Enterprise Blue Theme`  [AMBIGUOUS]
  .agent/rules/design-system.md · relation: conceptually_related_to
- `Light Executive Aesthetic Directive` → `Dark Defence-Obsidian Theme`  [AMBIGUOUS]
  README.md · relation: conceptually_related_to
- `AMBIGUOUS: anti_drone_tunnel.png actually shows a tracked EOD/bomb-disposal robot with blue multi-joint manipulator arm and cameras, not an anti-drone tunnel` → `Ballistic Protection (body armour, goggles, shields)`  [AMBIGUOUS]
  apps/web/public/products/anti_drone_tunnel.png · relation: conceptually_related_to
- `Ballistic Protection (body armour, goggles, shields)` → `BP Morcha image (actually brochure phone screenshot: ballistic goggles, concealable vest, body armour)`  [AMBIGUOUS]
  apps/web/public/products/bp_morcha.png · relation: conceptually_related_to
- `Ballistic Protection (body armour, goggles, shields)` → `Unmanned Ground Vehicle (UGV) image (shows anti-drone protective cage shelter blueprint)`  [AMBIGUOUS]
  apps/web/public/products/unmanned_ground_vehicle_ugv.png · relation: conceptually_related_to
- `Digital Voice Logger (collage: voice logger unit, body-worn camera, Lotus torch, solar panel)` → `Surveillance & Intelligence`  [AMBIGUOUS]
  apps/web/public/products/digital_voice_logger.png · relation: conceptually_related_to
- `Full Body Scanner image (actually Pexray portable X-ray panel + generator in snow)` → `Detection & Screening`  [AMBIGUOUS]
  apps/web/public/products/full_body_scanner.png · relation: conceptually_related_to
- `Full Body Scanner image (actually Pexray portable X-ray panel + generator in snow)` → `Handheld Backscatter image (actually walk-through body scanner pillar with operator kiosk)`  [AMBIGUOUS]
  apps/web/public/products/handheld_backscatter.png · relation: conceptually_related_to
- `Handheld Backscatter image (actually walk-through body scanner pillar with operator kiosk)` → `Detection & Screening`  [AMBIGUOUS]
  apps/web/public/products/handheld_backscatter.png · relation: conceptually_related_to
- `Detection & Screening` → `NIJ4 Shield System image (shows PoleScan pole concealed-object scanner)`  [AMBIGUOUS]
  apps/web/public/products/nij4_shield_system.png · relation: conceptually_related_to
- `Detection & Screening` → `Non-Linear Junction Evaluator image (shows Foerster ferrous magnetometer locator)`  [AMBIGUOUS]
  apps/web/public/products/non_linear_junction_evaluator.png · relation: conceptually_related_to
- `Detection & Screening` → `Pole Detector image (shows ATC-branded portable ballistic shield wall)`  [AMBIGUOUS]
  apps/web/public/products/pole_detector.png · relation: conceptually_related_to
- `Rescue & Medical` → `Injured Personnel Carrier image (shows Make in India lion logo)`  [AMBIGUOUS]
  apps/web/public/products/injured_personnel_carrier.png · relation: conceptually_related_to
- `Rescue & Medical` → `OmniTrak Station (TSI OmniTrak particle monitor composite with casualty-carry photo)`  [AMBIGUOUS]
  apps/web/public/products/omnitrak_station.png · relation: conceptually_related_to
- `Surveillance & Intelligence` → `Unmanned Ground Vehicle (UGV) image (shows anti-drone protective cage shelter blueprint)`  [AMBIGUOUS]
  apps/web/public/products/unmanned_ground_vehicle_ugv.png · relation: conceptually_related_to
- `Injured Personnel Carrier image (shows Make in India lion logo)` → `OmniTrak Station (TSI OmniTrak particle monitor composite with casualty-carry photo)`  [AMBIGUOUS]
  apps/web/public/products/omnitrak_station.png · relation: semantically_similar_to
- `IP68 Search Light image (shows Noron solar water heater panel)` → `Field Shelter & Infrastructure`  [AMBIGUOUS]
  apps/web/public/products/ip68_search_light.png · relation: conceptually_related_to
- `Pole Detector image (shows ATC-branded portable ballistic shield wall)` → `Test Alpha image (shows POLESCAN pole detector scanning bags, vehicles, packages)`  [AMBIGUOUS]
  apps/web/public/products/test_alpha.png · relation: semantically_similar_to

## Knowledge Gaps
- **150 isolated node(s):** `./tsconfig.json`, `RFC-4180`, `NODE_ENV`, `PORT`, `WEB_PORT` (+145 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 1798 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **82 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `AuthUser` connect `Accountability & Evidence API` to `Accounts & Expense Redirect Pages`, `Database & Domain Events`, `Tenders Controller`, `Territory & Expense Reports`, `Tenders Service`, `Pagination & List Queries`, `JWT Auth & Role Guards`, `API Bootstrap & Migrations`, `Expense Attachments`, `Deliveries Controller`, `File Upload & Attachments`, `Dashboard Metrics Rules`, `Tender DTOs`, `Expense Approval Queues API`, `Audit API & Search`, `Reports Controller`, `Proposals Service & Outbox`, `Proposal DTOs`, `Dashboard Metrics Service`, `JWT Secret & JWKS`, `Leads Controller`, `formatters.ts (minor)`, `Service Tickets Service`, `Task Accountability Service`, `Task Attachments Service`, `Service SLA Engine`, `Command Palette & Layouts`, `Task Jobs & Escalation`, `Command Records Queries`, `Service Controller`, `Cloudinary Uploads`, `Service DTOs`, `Command Records Service`, `Expense Decision Rules`, `Task Access Control`, `misc (minor)`, `Demos Controller`, `Demo DTOs`, `Access Matrix API`, `Demos Service`, `Lead DTOs`, `Nest HTTP Decorators`, `Visits Service`, `Contacts API`, `Expense Filters`, `Task Store & Delay SQL`, `Expense Claims Service`, `Recurring Task Generator`, `Expense CSV Import`, `Task Config & Approvers`, `Visits Controller & DTOs`, `Dashboard Performance`, `Notifications API`, `Interactions API`, `Cron Deadline Jobs`, `Expense Claim DTOs`, `Masters Admin API`, `Performance Reviews`, `Dashboard Controller`, `Evidence Snapshots`, `Expense Masters`, `Follow-ups API`, `Organisations API`, `Proposal Approval Bands`, `Nest Controller Decorators`, `Shared Filter DTOs`, `Lead Workflow`?**
  _High betweenness centrality (0.247) - this node is a cross-community bridge._
- **What connects `./tsconfig.json`, `RFC-4180`, `NODE_ENV` to the rest of the system?**
  _150 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Web Shared UI Helpers` be split into smaller, more focused modules?**
  _Cohesion score 0.018997775323698403 - nodes in this community are weakly interconnected._
- **Why does `Database` connect `Database & Domain Events` to `Lead Chat`, `Users Service`, `App Module & E2E Tests`, `Shared DB Table Types`, `Territory & Expense Reports`, `Tenders Service`, `Pagination & List Queries`, `JWT Auth & Role Guards`, `API Bootstrap & Migrations`, `File Upload & Attachments`, `Dashboard Metrics Rules`, `Tender DTOs`, `Audit API & Search`, `Proposals Service & Outbox`, `Proposal DTOs`, `Dashboard Metrics Service`, `JWT Secret & JWKS`, `Task Attachments Service`, `database.module.ts (minor)`, `Service SLA Engine`, `Command Palette & Layouts`, `Cloudinary Uploads`, `Command Records Queries`, `Masters Lookup API`, `Expense Decision Rules`, `Task Access Control`, `Demos Service`, `Demo DTOs`, `Access Matrix API`, `Visits Service`, `Contacts API`, `Expense Claims Service`, `demos.service.ts (minor)`, `Expense CSV Import`, `Task Config & Approvers`, `Dashboard Performance`, `Expense Claim DTOs`, `Expense Masters`, `Proposal Approval Bands`, `Audit Listener`?**
  _High betweenness centrality (0.044) - this node is a cross-community bridge._
- **Should `Deliveries UI & Status Flow` be split into smaller, more focused modules?**
  _Cohesion score 0.02182419213384605 - nodes in this community are weakly interconnected._

### Low-confidence Hints
_AMBIGUOUS edges — the extractor was unsure. Verify before acting on these._

- **What is the exact relationship between `Legacy Design System Rules (.agent)` and `Design System Rules (.agents)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `Warm Linen Canvas #F6F5F1` and `Legacy Light Enterprise Blue Theme`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._