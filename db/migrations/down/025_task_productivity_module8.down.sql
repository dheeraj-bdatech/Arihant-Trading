-- Reverts migration 025 (Module 8 — Task & Productivity Management).
-- Run manually:  docker exec -i arihant_bos_db psql -U postgres -d postgres < db/migrations/down/025_task_productivity_module8.down.sql
-- `tasks` and `task_blockers` keep their rows and v1 columns; deadlines go back to DATE (IST calendar day),
-- statuses/blocker types go back to the v1 vocabulary. Task attachment / snapshot files on disk are not removed.
BEGIN;
SET LOCAL arihant.allow_task_purge = 'on';

DROP TRIGGER IF EXISTS trg_users_deactivation ON users;
DROP TRIGGER IF EXISTS trg_tasks_before_insert ON tasks;
DROP TRIGGER IF EXISTS trg_tasks_guard_update ON tasks;
DROP TRIGGER IF EXISTS trg_task_blockers_updated ON task_blockers;

DROP TABLE IF EXISTS performance_evidence_snapshots;
DROP TABLE IF EXISTS performance_reviews;
DROP TABLE IF EXISTS task_notification_log;
DROP TABLE IF EXISTS task_escalations;
DROP TABLE IF EXISTS task_assignment_history;
DROP TABLE IF EXISTS task_deadline_changes;
DROP TABLE IF EXISTS task_attachments;
DROP TABLE IF EXISTS task_updates;
DROP TABLE IF EXISTS task_template_skips;

-- Blockers back to v1
DROP INDEX IF EXISTS task_blockers_one_open_per_task;
DROP INDEX IF EXISTS idx_task_blockers_status;
DROP INDEX IF EXISTS idx_task_blockers_task;
DROP INDEX IF EXISTS idx_task_blockers_dependency_user;
DROP INDEX IF EXISTS idx_task_blockers_raised_by;
ALTER TABLE task_blockers DROP CONSTRAINT IF EXISTS task_blockers_type_chk;
ALTER TABLE task_blockers DROP CONSTRAINT IF EXISTS task_blockers_status_chk;
ALTER TABLE task_blockers DROP CONSTRAINT IF EXISTS task_blockers_decision_chk;
UPDATE task_blockers SET manager_decision = CASE status
    WHEN 'accepted' THEN 'accepted' WHEN 'rejected' THEN 'rejected' WHEN 'resolved' THEN coalesce(manager_decision, 'accepted') ELSE manager_decision END;
UPDATE task_blockers SET blocker_type = CASE blocker_type
    WHEN 'management_approval' THEN 'mgmt_approval' WHEN 'customer_dependency' THEN 'customer' WHEN 'vendor_dependency' THEN 'vendor'
    WHEN 'another_employee' THEN 'other_employee' WHEN 'missing_information' THEN 'missing_info' WHEN 'external_portal_issue' THEN 'portal'
    WHEN 'technical_issue' THEN 'technical' WHEN 'approved_leave' THEN 'leave' ELSE blocker_type END;
ALTER TABLE task_blockers ALTER COLUMN blocker_type DROP NOT NULL;
ALTER TABLE task_blockers ALTER COLUMN description DROP NOT NULL;
ALTER TABLE task_blockers
  DROP COLUMN IF EXISTS status, DROP COLUMN IF EXISTS dependency_user_id, DROP COLUMN IF EXISTS dependency_customer_id,
  DROP COLUMN IF EXISTS vendor_name, DROP COLUMN IF EXISTS portal_name, DROP COLUMN IF EXISTS approval_pending_from,
  DROP COLUMN IF EXISTS leave_id, DROP COLUMN IF EXISTS expected_resolution_date, DROP COLUMN IF EXISTS requested_new_deadline,
  DROP COLUMN IF EXISTS raised_after_deadline, DROP COLUMN IF EXISTS previous_task_status, DROP COLUMN IF EXISTS decision,
  DROP COLUMN IF EXISTS decided_at, DROP COLUMN IF EXISTS decision_comment, DROP COLUMN IF EXISTS resolved_at,
  DROP COLUMN IF EXISTS resolved_by, DROP COLUMN IF EXISTS resolution_note, DROP COLUMN IF EXISTS deadline_at_raise,
  DROP COLUMN IF EXISTS excused_minutes, DROP COLUMN IF EXISTS updated_at;

-- Tasks back to v1 (cancelled has no v1 equivalent → completed is wrong, not_started keeps it visible)
ALTER TABLE tasks DISABLE TRIGGER USER;
DROP INDEX IF EXISTS tasks_task_number_key;
DROP INDEX IF EXISTS tasks_template_occurrence_key;
DROP INDEX IF EXISTS idx_tasks_reporting_manager;
DROP INDEX IF EXISTS idx_tasks_department;
DROP INDEX IF EXISTS idx_tasks_category;
DROP INDEX IF EXISTS idx_tasks_priority;
DROP INDEX IF EXISTS idx_tasks_customer;
DROP INDEX IF EXISTS idx_tasks_tender;
DROP INDEX IF EXISTS idx_tasks_demo;
DROP INDEX IF EXISTS idx_tasks_service_ticket;
DROP INDEX IF EXISTS idx_tasks_template;
DROP INDEX IF EXISTS idx_tasks_last_update;
DROP INDEX IF EXISTS idx_tasks_assigned_by;
DROP INDEX IF EXISTS idx_tasks_group;
DROP INDEX IF EXISTS idx_tasks_open_deadline;
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_status_chk;
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_priority_chk;
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_progress_chk;
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_counters_chk;
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_cancel_chk;
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_source_chk;
UPDATE tasks SET status = 'not_started' WHERE status = 'cancelled';
ALTER TABLE tasks ALTER COLUMN status DROP NOT NULL;
ALTER TABLE tasks ALTER COLUMN priority DROP NOT NULL;
ALTER TABLE tasks ALTER COLUMN deadline TYPE date USING ((deadline AT TIME ZONE 'Asia/Kolkata')::date);
ALTER TABLE tasks
  DROP COLUMN IF EXISTS task_number, DROP COLUMN IF EXISTS template_id, DROP COLUMN IF EXISTS occurrence_date,
  DROP COLUMN IF EXISTS group_id, DROP COLUMN IF EXISTS category_id, DROP COLUMN IF EXISTS customer_id,
  DROP COLUMN IF EXISTS tender_id, DROP COLUMN IF EXISTS demo_id, DROP COLUMN IF EXISTS service_ticket_id,
  DROP COLUMN IF EXISTS project_id, DROP COLUMN IF EXISTS assigned_by, DROP COLUMN IF EXISTS department_id,
  DROP COLUMN IF EXISTS original_deadline, DROP COLUMN IF EXISTS progress_percent, DROP COLUMN IF EXISTS progress_at_completion,
  DROP COLUMN IF EXISTS evidence_required, DROP COLUMN IF EXISTS approval_required, DROP COLUMN IF EXISTS completion_remarks,
  DROP COLUMN IF EXISTS delay_reason, DROP COLUMN IF EXISTS started_at, DROP COLUMN IF EXISTS completed_at,
  DROP COLUMN IF EXISTS approved_at, DROP COLUMN IF EXISTS approved_by, DROP COLUMN IF EXISTS last_update_at,
  DROP COLUMN IF EXISTS first_overdue_at, DROP COLUMN IF EXISTS reopen_count, DROP COLUMN IF EXISTS rework_count,
  DROP COLUMN IF EXISTS extension_count, DROP COLUMN IF EXISTS reassign_count, DROP COLUMN IF EXISTS excused_delay_minutes,
  DROP COLUMN IF EXISTS unexcused_locked_minutes, DROP COLUMN IF EXISTS cancelled_reason, DROP COLUMN IF EXISTS cancelled_by,
  DROP COLUMN IF EXISTS cancelled_at, DROP COLUMN IF EXISTS is_backlog, DROP COLUMN IF EXISTS generated_late,
  DROP COLUMN IF EXISTS source, DROP COLUMN IF EXISTS version, DROP COLUMN IF EXISTS created_by, DROP COLUMN IF EXISTS updated_by;
ALTER TABLE tasks ENABLE TRIGGER USER;
DROP SEQUENCE IF EXISTS task_number_seq;

DROP TABLE IF EXISTS task_templates;
DROP TABLE IF EXISTS task_settings;
DROP TABLE IF EXISTS task_categories;
DROP TABLE IF EXISTS employee_leaves;
DROP TABLE IF EXISTS holidays;

DROP FUNCTION IF EXISTS tasks_before_insert();
DROP FUNCTION IF EXISTS tasks_guard_update();
DROP FUNCTION IF EXISTS task_append_only();
DROP FUNCTION IF EXISTS performance_reviews_guard();
DROP FUNCTION IF EXISTS users_stamp_deactivation();
DROP FUNCTION IF EXISTS user_subordinate_ids(uuid, integer);
DROP FUNCTION IF EXISTS user_manager_chain(uuid, integer);

ALTER TABLE departments DROP COLUMN IF EXISTS head_user_id;
DROP INDEX IF EXISTS idx_users_department;
ALTER TABLE users DROP COLUMN IF EXISTS department_id;
ALTER TABLE users DROP COLUMN IF EXISTS deactivated_at;

DELETE FROM _schema_migrations WHERE name = '025_task_productivity_module8.sql';
COMMIT;
