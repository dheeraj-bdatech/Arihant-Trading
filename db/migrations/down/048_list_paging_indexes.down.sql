-- Reverts 048_list_paging_indexes.sql: drops the indexes it added. No data changes.

drop index if exists idx_leads_created_at;
drop index if exists idx_follow_ups_lead_pending_due;
drop index if exists idx_tenders_submission_deadline;
drop index if exists idx_tenders_organisation_id;
drop index if exists idx_tender_fin_instruments_type_created;
drop index if exists idx_tender_portal_issues_created;
drop index if exists idx_service_tickets_created_live;
drop index if exists idx_service_tickets_organisation_id;
drop index if exists idx_demos_register_date;
drop index if exists idx_demos_lead_id;
drop index if exists idx_proposals_last_activity;
drop index if exists idx_expense_claims_updated_live;
drop index if exists idx_visits_open_planned;
drop index if exists idx_trips_trip_date;
drop index if exists idx_notifications_user_created;
drop index if exists idx_audit_log_actor_created;
drop index if exists idx_audit_log_entity_id;
drop index if exists idx_interactions_employee_id;
drop index if exists idx_users_full_name;
drop index if exists idx_users_zone_id;
drop index if exists idx_organisations_zone_id;
