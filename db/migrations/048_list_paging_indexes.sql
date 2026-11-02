-- =====================================================================
-- Migration 048: indexes for lists paged in the database
--
-- Every register, queue and dashboard list now loads a page at a time (LIMIT/OFFSET with a count over the same
-- filter), so each list's ORDER BY and its common filters need an index, or every page still sorts the whole table.
-- Each index below names the list it serves. Columns that already had a usable index (tasks.deadline on open
-- statuses, task_blockers.status, follow_ups by assignee, demo_reservations by unit, …) are left alone.
--
-- Plain CREATE INDEX (the runner applies all pending files in one transaction, so CONCURRENTLY is not possible). On a
-- large production table, create the same index CONCURRENTLY by hand first; `if not exists` then makes this a no-op.
-- Idempotent: safe to re-run.
-- =====================================================================

-- Leads register: default order created_at desc (with id as the tiebreak)
create index if not exists idx_leads_created_at on leads (created_at desc, id desc);

-- Lead follow-ups: the open follow-up of a lead by due day (Leads "follow-up overdue" filter, Management Command)
create index if not exists idx_follow_ups_lead_pending_due on follow_ups (lead_id, due_date) where status = 'pending';

-- Tenders register: default order and the deadline windows (closing within 48 h / 7 days, deadline centre, calendar)
create index if not exists idx_tenders_submission_deadline on tenders (submission_deadline);
-- Tenders by customer (customer history, Customer 360)
create index if not exists idx_tenders_organisation_id on tenders (organisation_id);

-- Tender finance: EMD / PBG tracking, newest first, by instrument type
create index if not exists idx_tender_fin_instruments_type_created on tender_financial_instruments (instrument_type, created_at desc);
-- Tender portal issues list, newest first
create index if not exists idx_tender_portal_issues_created on tender_portal_issues (created_at desc);

-- Service desk ticket list: newest first among live tickets
create index if not exists idx_service_tickets_created_live on service_tickets (created_at desc, id desc) where deleted_at is null;
-- Service tickets by customer (customer service history)
create index if not exists idx_service_tickets_organisation_id on service_tickets (organisation_id);

-- Demos register: ordered (and date-filtered) on the register date — confirmed, else requested
create index if not exists idx_demos_register_date on demos ((coalesce(confirmed_date, requested_date)) desc, created_at desc, id desc);
create index if not exists idx_demos_lead_id on demos (lead_id);

-- Proposals register: default order last_activity_at desc among live proposals
create index if not exists idx_proposals_last_activity on proposals (last_activity_at desc, id) where is_deleted = false;

-- Expense claims list: default order updated_at desc among live claims
create index if not exists idx_expense_claims_updated_live on expense_claims (updated_at desc, id) where deleted_at is null;

-- Visits still to be made, by planned day (upcoming visits, field activity, trips to combine)
create index if not exists idx_visits_open_planned on visits (planned_date) where status in ('planned', 'modified', 'rescheduled');
-- Trips list: newest first across people (managers' view)
create index if not exists idx_trips_trip_date on trips (trip_date desc, id);

-- Notifications inbox: one person's notifications, newest first
create index if not exists idx_notifications_user_created on notifications (user_id, created_at desc, id desc);

-- Audit log: by actor (the actor filter), and by record id alone (record audit tabs that do not pass entity_type)
create index if not exists idx_audit_log_actor_created on audit_log (actor_id, created_at desc);
create index if not exists idx_audit_log_entity_id on audit_log (entity_id);

-- Interactions by employee (sales scope of a customer's interactions)
create index if not exists idx_interactions_employee_id on interactions (employee_id);

-- Users list: alphabetical (admin users, pickers), and the zone filter
create index if not exists idx_users_full_name on users (full_name, id);
create index if not exists idx_users_zone_id on users (zone_id);

-- Organisations by zone (customer list zone filter, regional scoping)
create index if not exists idx_organisations_zone_id on organisations (zone_id);
