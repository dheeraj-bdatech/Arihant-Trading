-- Migration 025: Module 8 — Task & Productivity Management
-- Evolves the v1 `tasks` / `task_blockers` tables in place (other modules already write to them) and adds
-- categories, recurring templates, progress log, attachments, deadline/assignment history, escalations,
-- settings, performance reviews and immutable evidence snapshots.
-- Also adds the minimum supporting masters this module needs and the BOS did not have yet:
--   users.department_id / users.deactivated_at, departments.head_user_id, holidays, employee_leaves.
-- Reverse with db/migrations/down/025_task_productivity_module8.down.sql
--
-- Conventions: stored values are lowercase snake_case (matching the existing tasks.status values);
-- OVERDUE is never stored — it is derived from deadline + status. Timestamps are timestamptz (UTC);
-- a date-only deadline means 23:59:59 Asia/Kolkata on that date.

-- ---------------------------------------------------------------------------
-- 0. Supporting masters
-- ---------------------------------------------------------------------------
ALTER TABLE users ADD COLUMN IF NOT EXISTS department_id uuid REFERENCES departments(id);
ALTER TABLE users ADD COLUMN IF NOT EXISTS deactivated_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_users_department ON users (department_id);

-- Stamp existing deactivations first (before any update below bumps users.updated_at).
UPDATE users SET deactivated_at = updated_at WHERE is_active = false AND deactivated_at IS NULL;

-- Best-effort department from role (admin can correct it later).
UPDATE users u
SET department_id = d.id
FROM departments d
WHERE u.department_id IS NULL
  AND d.code = CASE u.role::text
    WHEN 'management' THEN 'management'
    WHEN 'regional_manager' THEN 'sales'
    WHEN 'sales' THEN 'sales'
    WHEN 'tender_team' THEN 'tenders'
    WHEN 'demo_team' THEN 'demos'
    WHEN 'service_team' THEN 'service'
    WHEN 'accounts' THEN 'accounts'
    WHEN 'admin' THEN 'admin'
  END;

-- Metrics freeze at deactivation, so the moment is stamped by the database whoever flips the flag.
CREATE OR REPLACE FUNCTION users_stamp_deactivation() RETURNS trigger AS $$
BEGIN
  IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
    NEW.deactivated_at := CASE WHEN NEW.is_active THEN NULL ELSE now() END;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- No FK on purpose: masters must survive the dev seed's `TRUNCATE users … CASCADE` (validated in the app).
ALTER TABLE departments ADD COLUMN IF NOT EXISTS head_user_id uuid;

CREATE TABLE IF NOT EXISTS holidays (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  holiday_date date NOT NULL,
  name         text NOT NULL,
  region_id    uuid REFERENCES regions(id),          -- NULL = applies to everyone
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid,                                -- audit only (no FK: survives dev reseeds)
  updated_by   uuid
);
CREATE UNIQUE INDEX IF NOT EXISTS holidays_date_region_key
  ON holidays (holiday_date, coalesce(region_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- Approved-leave register (the BOS has no leave-application workflow; managers/admin record approved leave).
CREATE TABLE IF NOT EXISTS employee_leaves (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id  uuid NOT NULL REFERENCES users(id),
  leave_type   text NOT NULL DEFAULT 'casual',
  from_date    date NOT NULL,
  to_date      date NOT NULL,
  status       text NOT NULL DEFAULT 'approved',
  reason       text,
  approved_by  uuid REFERENCES users(id),
  cancelled_at timestamptz,
  cancelled_by uuid REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid REFERENCES users(id),
  updated_by   uuid REFERENCES users(id),
  CONSTRAINT employee_leaves_dates_chk CHECK (from_date <= to_date),
  CONSTRAINT employee_leaves_type_chk CHECK (leave_type IN ('casual', 'sick', 'earned', 'comp_off', 'other')),
  CONSTRAINT employee_leaves_status_chk CHECK (status IN ('approved', 'cancelled'))
);
CREATE INDEX IF NOT EXISTS idx_employee_leaves_employee ON employee_leaves (employee_id, from_date, to_date) WHERE status = 'approved';

-- ---------------------------------------------------------------------------
-- 1. Categories (admin-extendable master) and settings
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS task_categories (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                      text NOT NULL UNIQUE,
  name                      text NOT NULL,
  is_active                 boolean NOT NULL DEFAULT true,
  requires_link_type        text,
  default_evidence_required boolean NOT NULL DEFAULT false,
  display_order             integer NOT NULL DEFAULT 0,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  created_by                uuid,   -- audit only (no FK: masters survive dev reseeds)
  updated_by                uuid,
  CONSTRAINT task_categories_link_chk CHECK (requires_link_type IS NULL OR requires_link_type IN ('customer', 'tender', 'demo', 'service'))
);

INSERT INTO task_categories (code, name, requires_link_type, default_evidence_required, display_order) VALUES
  ('GENERAL',  'General',          NULL,       false, 1),
  ('CUSTOMER', 'Customer-related', 'customer', false, 2),
  ('TENDER',   'Tender-related',   'tender',   true,  3),
  ('DEMO',     'Demo-related',     'demo',     true,  4),
  ('SERVICE',  'Service-related',  'service',  true,  5)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS task_settings (
  id                            smallint PRIMARY KEY DEFAULT 1,
  no_update_days_critical       integer NOT NULL DEFAULT 1,
  no_update_days_high           integer NOT NULL DEFAULT 2,
  no_update_days_medium         integer NOT NULL DEFAULT 3,
  no_update_days_low            integer NOT NULL DEFAULT 5,
  repeated_delay_threshold      integer NOT NULL DEFAULT 3,
  repeated_delay_window_days    integer NOT NULL DEFAULT 30,
  max_extensions_before_flag    integer NOT NULL DEFAULT 2,
  repeated_blocker_threshold    integer NOT NULL DEFAULT 3,
  blocker_review_sla_hours      integer NOT NULL DEFAULT 24,
  approval_sla_hours            integer NOT NULL DEFAULT 48,
  reminder_hours_before_deadline integer NOT NULL DEFAULT 24,
  allow_self_tasks              boolean NOT NULL DEFAULT true,
  allow_indirect_reports        boolean NOT NULL DEFAULT true,
  allow_peer_linked_assignment  boolean NOT NULL DEFAULT true,
  auto_accept_leave_blockers    boolean NOT NULL DEFAULT true,
  evidence_period_basis         text NOT NULL DEFAULT 'deadline',
  review_rating_scale           integer NOT NULL DEFAULT 5,
  weekly_off_days               integer[] NOT NULL DEFAULT '{0}',   -- 0 = Sunday … 6 = Saturday
  default_holiday_policy        text NOT NULL DEFAULT 'shift_after',
  default_leave_policy          text NOT NULL DEFAULT 'skip',
  fallback_approver_role        text NOT NULL DEFAULT 'management',
  horizon_days_daily            integer NOT NULL DEFAULT 7,
  horizon_days_weekly           integer NOT NULL DEFAULT 14,
  horizon_days_monthly          integer NOT NULL DEFAULT 35,
  hard_delete_window_minutes    integer NOT NULL DEFAULT 15,
  updated_at                    timestamptz NOT NULL DEFAULT now(),
  updated_by                    uuid,   -- audit only (no FK)
  CONSTRAINT task_settings_singleton_chk CHECK (id = 1),
  CONSTRAINT task_settings_positive_chk CHECK (
    no_update_days_critical > 0 AND no_update_days_high > 0 AND no_update_days_medium > 0 AND no_update_days_low > 0
    AND repeated_delay_threshold > 0 AND repeated_delay_window_days > 0 AND max_extensions_before_flag >= 0
    AND repeated_blocker_threshold > 0 AND blocker_review_sla_hours > 0 AND approval_sla_hours > 0
    AND reminder_hours_before_deadline > 0 AND review_rating_scale BETWEEN 3 AND 10
    AND horizon_days_daily BETWEEN 1 AND 60 AND horizon_days_weekly BETWEEN 1 AND 120 AND horizon_days_monthly BETWEEN 1 AND 400
    AND hard_delete_window_minutes BETWEEN 0 AND 120),
  CONSTRAINT task_settings_basis_chk CHECK (evidence_period_basis IN ('deadline', 'completion')),
  CONSTRAINT task_settings_holiday_chk CHECK (default_holiday_policy IN ('skip', 'shift_before', 'shift_after', 'keep')),
  CONSTRAINT task_settings_leave_chk CHECK (default_leave_policy IN ('skip', 'keep')),
  CONSTRAINT task_settings_fallback_chk CHECK (fallback_approver_role IN ('management', 'admin'))
);
INSERT INTO task_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Recurring task templates
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS task_templates (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title               text NOT NULL,
  description         text,
  expected_outcome    text,
  category_id         uuid NOT NULL REFERENCES task_categories(id),
  customer_id         uuid REFERENCES organisations(id),
  tender_id           uuid REFERENCES tenders(id),
  demo_id             uuid REFERENCES demos(id),
  service_ticket_id   uuid REFERENCES service_tickets(id),
  project_id          uuid REFERENCES projects(id),
  assigned_to         uuid NOT NULL REFERENCES users(id),
  assigned_by         uuid REFERENCES users(id),
  priority            text NOT NULL DEFAULT 'medium',
  evidence_required   boolean NOT NULL DEFAULT false,
  approval_required   boolean NOT NULL DEFAULT false,
  recurrence_type     text NOT NULL,
  recurrence_rule     jsonb NOT NULL,
  start_date          date NOT NULL,
  end_date            date,
  max_occurrences     integer,
  due_offset_days     integer NOT NULL DEFAULT 0,
  due_time            time NOT NULL DEFAULT '18:00',
  holiday_policy      text NOT NULL DEFAULT 'shift_after',
  leave_policy        text NOT NULL DEFAULT 'skip',
  status              text NOT NULL DEFAULT 'active',
  status_reason       text,
  needs_reassignment  boolean NOT NULL DEFAULT false,
  last_generated_until date,
  version             integer NOT NULL DEFAULT 1,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid REFERENCES users(id),
  updated_by          uuid REFERENCES users(id),
  CONSTRAINT task_templates_priority_chk CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  CONSTRAINT task_templates_recurrence_chk CHECK (recurrence_type IN ('daily', 'weekly', 'monthly', 'custom')),
  CONSTRAINT task_templates_holiday_chk CHECK (holiday_policy IN ('skip', 'shift_before', 'shift_after', 'keep')),
  CONSTRAINT task_templates_leave_chk CHECK (leave_policy IN ('skip', 'keep')),
  CONSTRAINT task_templates_status_chk CHECK (status IN ('active', 'paused', 'ended')),
  CONSTRAINT task_templates_dates_chk CHECK (end_date IS NULL OR end_date >= start_date),
  CONSTRAINT task_templates_max_chk CHECK (max_occurrences IS NULL OR max_occurrences > 0),
  CONSTRAINT task_templates_offset_chk CHECK (due_offset_days BETWEEN 0 AND 60)
);
CREATE INDEX IF NOT EXISTS idx_task_templates_assignee ON task_templates (assigned_to);
CREATE INDEX IF NOT EXISTS idx_task_templates_active ON task_templates (status) WHERE status = 'active';

-- Occurrences that were deliberately not generated (holiday / approved leave) — recorded so they are never "missed".
CREATE TABLE IF NOT EXISTS task_template_skips (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id     uuid NOT NULL REFERENCES task_templates(id),
  occurrence_date date NOT NULL,
  reason          text NOT NULL,
  detail          text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT task_template_skips_reason_chk CHECK (reason IN ('skipped_holiday', 'skipped_leave', 'skipped_collision')),
  CONSTRAINT task_template_skips_key UNIQUE (template_id, occurrence_date)
);

-- ---------------------------------------------------------------------------
-- 3. Tasks — evolve the v1 table
-- ---------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS task_number_seq START 1;

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS task_number            text,
  ADD COLUMN IF NOT EXISTS template_id            uuid REFERENCES task_templates(id),
  ADD COLUMN IF NOT EXISTS occurrence_date        date,
  ADD COLUMN IF NOT EXISTS group_id               uuid,
  ADD COLUMN IF NOT EXISTS category_id            uuid REFERENCES task_categories(id),
  ADD COLUMN IF NOT EXISTS customer_id            uuid REFERENCES organisations(id),
  ADD COLUMN IF NOT EXISTS tender_id              uuid REFERENCES tenders(id),
  ADD COLUMN IF NOT EXISTS demo_id                uuid REFERENCES demos(id),
  ADD COLUMN IF NOT EXISTS service_ticket_id      uuid REFERENCES service_tickets(id),
  ADD COLUMN IF NOT EXISTS project_id             uuid REFERENCES projects(id),
  ADD COLUMN IF NOT EXISTS assigned_by            uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS department_id          uuid REFERENCES departments(id),
  ADD COLUMN IF NOT EXISTS original_deadline      timestamptz,
  ADD COLUMN IF NOT EXISTS progress_percent       integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS progress_at_completion integer,
  ADD COLUMN IF NOT EXISTS evidence_required      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS approval_required      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS completion_remarks     text,
  ADD COLUMN IF NOT EXISTS delay_reason           text,
  ADD COLUMN IF NOT EXISTS started_at             timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at           timestamptz,   -- when the assignee finished the work
  ADD COLUMN IF NOT EXISTS approved_at            timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by            uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS last_update_at         timestamptz,
  ADD COLUMN IF NOT EXISTS first_overdue_at       timestamptz,
  ADD COLUMN IF NOT EXISTS reopen_count           integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rework_count           integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS extension_count        integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reassign_count         integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS excused_delay_minutes  integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unexcused_locked_minutes integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cancelled_reason       text,
  ADD COLUMN IF NOT EXISTS cancelled_by           uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS cancelled_at           timestamptz,
  ADD COLUMN IF NOT EXISTS is_backlog             boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS generated_late         boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS source                 text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS version                integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS created_by             uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS updated_by             uuid REFERENCES users(id);

-- Back-fills below must not rewrite updated_at on legacy rows.
ALTER TABLE tasks DISABLE TRIGGER USER;

-- Date-only deadlines become 23:59:59 IST on that day.
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns WHERE table_name = 'tasks' AND column_name = 'deadline') = 'date' THEN
    ALTER TABLE tasks ALTER COLUMN deadline TYPE timestamptz USING ((deadline + time '23:59:59') AT TIME ZONE 'Asia/Kolkata');
  END IF;
END $$;

-- Legacy values → new vocabulary. OVERDUE was a stored status in v1; it is derived now.
UPDATE tasks SET status = 'not_started' WHERE status IS NULL OR status NOT IN ('not_started', 'in_progress', 'blocked', 'awaiting_approval', 'completed', 'cancelled');
UPDATE tasks SET priority = CASE lower(coalesce(priority, '')) WHEN 'urgent' THEN 'critical' WHEN 'low' THEN 'low' WHEN 'high' THEN 'high' WHEN 'critical' THEN 'critical' ELSE 'medium' END
WHERE priority IS NULL OR priority NOT IN ('low', 'medium', 'high', 'critical');

-- Human-readable numbers for existing rows, in creation order.
WITH numbered AS (
  SELECT id, created_at FROM tasks WHERE task_number IS NULL ORDER BY created_at, id
)
UPDATE tasks t
SET task_number = 'TSK-' || to_char(n.created_at AT TIME ZONE 'Asia/Kolkata', 'YYYY') || '-' || lpad(nextval('task_number_seq')::text, 6, '0')
FROM numbered n
WHERE t.id = n.id;

-- Links from the v1 polymorphic reference where we can resolve them.
UPDATE tasks t SET customer_id = l.organisation_id
FROM leads l
WHERE t.related_entity_type = 'lead' AND t.related_entity_id = l.id AND t.customer_id IS NULL;
UPDATE tasks t SET customer_id = coalesce(p.customer_id, p.organisation_id)
FROM proposals p
WHERE t.related_entity_type = 'proposal' AND t.related_entity_id = p.id AND t.customer_id IS NULL;
UPDATE tasks SET tender_id = related_entity_id WHERE related_entity_type = 'tender' AND tender_id IS NULL AND EXISTS (SELECT 1 FROM tenders x WHERE x.id = related_entity_id);
UPDATE tasks SET demo_id = related_entity_id WHERE related_entity_type = 'demo' AND demo_id IS NULL AND EXISTS (SELECT 1 FROM demos x WHERE x.id = related_entity_id);
UPDATE tasks SET service_ticket_id = related_entity_id WHERE related_entity_type IN ('service_ticket', 'service') AND service_ticket_id IS NULL AND EXISTS (SELECT 1 FROM service_tickets x WHERE x.id = related_entity_id);

UPDATE tasks t SET category_id = c.id
FROM task_categories c
WHERE t.category_id IS NULL
  AND c.code = CASE
    WHEN t.tender_id IS NOT NULL THEN 'TENDER'
    WHEN t.demo_id IS NOT NULL THEN 'DEMO'
    WHEN t.service_ticket_id IS NOT NULL THEN 'SERVICE'
    WHEN t.customer_id IS NOT NULL THEN 'CUSTOMER'
    ELSE 'GENERAL'
  END;

UPDATE tasks t SET department_id = u.department_id FROM users u WHERE t.assigned_to = u.id AND t.department_id IS NULL;
UPDATE tasks SET
  original_deadline = coalesce(original_deadline, deadline),
  last_update_at    = coalesce(last_update_at, updated_at, created_at),
  started_at        = CASE WHEN status IN ('in_progress', 'blocked', 'awaiting_approval', 'completed') THEN coalesce(started_at, created_at) ELSE started_at END,
  completed_at      = CASE WHEN status = 'completed' THEN coalesce(completed_at, updated_at) ELSE completed_at END,
  progress_percent  = CASE WHEN status = 'completed' THEN 100 ELSE progress_percent END,
  source            = CASE WHEN related_entity_type = 'proposal' THEN 'proposal_followup' WHEN related_entity_type = 'lead' THEN 'lead_workflow' ELSE source END;

ALTER TABLE tasks ENABLE TRIGGER USER;

ALTER TABLE tasks ALTER COLUMN task_number SET DEFAULT ('TSK-' || to_char(now() AT TIME ZONE 'Asia/Kolkata', 'YYYY') || '-' || lpad(nextval('task_number_seq')::text, 6, '0'));
ALTER TABLE tasks ALTER COLUMN task_number SET NOT NULL;
ALTER TABLE tasks ALTER COLUMN status SET NOT NULL;
ALTER TABLE tasks ALTER COLUMN priority SET NOT NULL;
ALTER TABLE tasks ALTER COLUMN category_id SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS tasks_task_number_key ON tasks (task_number);
CREATE UNIQUE INDEX IF NOT EXISTS tasks_template_occurrence_key ON tasks (template_id, occurrence_date) WHERE template_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_status_chk') THEN
    ALTER TABLE tasks ADD CONSTRAINT tasks_status_chk CHECK (status IN ('not_started', 'in_progress', 'blocked', 'awaiting_approval', 'completed', 'cancelled'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_priority_chk') THEN
    ALTER TABLE tasks ADD CONSTRAINT tasks_priority_chk CHECK (priority IN ('low', 'medium', 'high', 'critical'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_progress_chk') THEN
    ALTER TABLE tasks ADD CONSTRAINT tasks_progress_chk CHECK (progress_percent BETWEEN 0 AND 100);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_counters_chk') THEN
    ALTER TABLE tasks ADD CONSTRAINT tasks_counters_chk CHECK (
      reopen_count >= 0 AND rework_count >= 0 AND extension_count >= 0 AND reassign_count >= 0
      AND excused_delay_minutes >= 0 AND unexcused_locked_minutes >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_cancel_chk') THEN
    ALTER TABLE tasks ADD CONSTRAINT tasks_cancel_chk CHECK (status <> 'cancelled' OR cancelled_reason IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_source_chk') THEN
    ALTER TABLE tasks ADD CONSTRAINT tasks_source_chk CHECK (source IN ('manual', 'recurring', 'proposal_followup', 'lead_workflow', 'system'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tasks_reporting_manager ON tasks (reporting_manager_id);
CREATE INDEX IF NOT EXISTS idx_tasks_department ON tasks (department_id);
CREATE INDEX IF NOT EXISTS idx_tasks_category ON tasks (category_id);
CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks (priority);
CREATE INDEX IF NOT EXISTS idx_tasks_customer ON tasks (customer_id);
CREATE INDEX IF NOT EXISTS idx_tasks_tender ON tasks (tender_id);
CREATE INDEX IF NOT EXISTS idx_tasks_demo ON tasks (demo_id);
CREATE INDEX IF NOT EXISTS idx_tasks_service_ticket ON tasks (service_ticket_id);
CREATE INDEX IF NOT EXISTS idx_tasks_template ON tasks (template_id);
CREATE INDEX IF NOT EXISTS idx_tasks_last_update ON tasks (last_update_at);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_by ON tasks (assigned_by);
CREATE INDEX IF NOT EXISTS idx_tasks_group ON tasks (group_id) WHERE group_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_open_deadline ON tasks (deadline) WHERE status IN ('not_started', 'in_progress', 'blocked');

-- Fills snapshots for every insert path (API, recurring generator, other modules' direct inserts).
CREATE OR REPLACE FUNCTION tasks_before_insert() RETURNS trigger AS $$
BEGIN
  IF NEW.category_id IS NULL THEN
    SELECT id INTO NEW.category_id FROM task_categories WHERE code = 'GENERAL';
  END IF;
  IF NEW.original_deadline IS NULL THEN
    NEW.original_deadline := NEW.deadline;
  END IF;
  IF NEW.last_update_at IS NULL THEN
    NEW.last_update_at := coalesce(NEW.created_at, now());
  END IF;
  IF NEW.assigned_to IS NOT NULL AND (NEW.department_id IS NULL OR NEW.reporting_manager_id IS NULL) THEN
    SELECT coalesce(NEW.department_id, u.department_id), coalesce(NEW.reporting_manager_id, u.reporting_manager_id)
      INTO NEW.department_id, NEW.reporting_manager_id
      FROM users u WHERE u.id = NEW.assigned_to;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- original_deadline is written once and never changes — the honest baseline for every delay measurement.
CREATE OR REPLACE FUNCTION tasks_guard_update() RETURNS trigger AS $$
BEGIN
  IF OLD.original_deadline IS NOT NULL AND NEW.original_deadline IS DISTINCT FROM OLD.original_deadline THEN
    RAISE EXCEPTION 'tasks.original_deadline cannot be changed' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.original_deadline IS NULL AND NEW.deadline IS NOT NULL THEN
    NEW.original_deadline := NEW.deadline;
  END IF;
  IF NEW.task_number IS DISTINCT FROM OLD.task_number THEN
    RAISE EXCEPTION 'tasks.task_number cannot be changed' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- 4. Blockers — evolve the v1 table
-- ---------------------------------------------------------------------------
ALTER TABLE task_blockers
  ADD COLUMN IF NOT EXISTS status                   text NOT NULL DEFAULT 'pending_review',
  ADD COLUMN IF NOT EXISTS dependency_user_id       uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS dependency_customer_id   uuid REFERENCES organisations(id),
  ADD COLUMN IF NOT EXISTS vendor_name              text,
  ADD COLUMN IF NOT EXISTS portal_name              text,
  ADD COLUMN IF NOT EXISTS approval_pending_from    text,
  ADD COLUMN IF NOT EXISTS leave_id                 uuid REFERENCES employee_leaves(id),
  ADD COLUMN IF NOT EXISTS expected_resolution_date date,
  ADD COLUMN IF NOT EXISTS requested_new_deadline   timestamptz,
  ADD COLUMN IF NOT EXISTS raised_after_deadline    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS previous_task_status     text,
  ADD COLUMN IF NOT EXISTS decision                 text,
  ADD COLUMN IF NOT EXISTS decided_at               timestamptz,
  ADD COLUMN IF NOT EXISTS decision_comment         text,
  ADD COLUMN IF NOT EXISTS resolved_at              timestamptz,
  ADD COLUMN IF NOT EXISTS resolved_by              uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS resolution_note          text,
  ADD COLUMN IF NOT EXISTS deadline_at_raise        timestamptz,
  ADD COLUMN IF NOT EXISTS excused_minutes          integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at               timestamptz NOT NULL DEFAULT now();

UPDATE task_blockers SET blocker_type = CASE blocker_type
    WHEN 'mgmt_approval' THEN 'management_approval'
    WHEN 'customer' THEN 'customer_dependency'
    WHEN 'vendor' THEN 'vendor_dependency'
    WHEN 'other_employee' THEN 'another_employee'
    WHEN 'missing_info' THEN 'missing_information'
    WHEN 'portal' THEN 'external_portal_issue'
    WHEN 'technical' THEN 'technical_issue'
    WHEN 'leave' THEN 'approved_leave'
    ELSE blocker_type END
WHERE blocker_type IN ('mgmt_approval', 'customer', 'vendor', 'other_employee', 'missing_info', 'portal', 'technical', 'leave');
UPDATE task_blockers SET blocker_type = 'missing_information' WHERE blocker_type IS NULL OR blocker_type NOT IN (
  'management_approval', 'customer_dependency', 'vendor_dependency', 'another_employee', 'missing_information',
  'external_portal_issue', 'technical_issue', 'approved_leave');
UPDATE task_blockers SET description = 'Legacy blocker (no description recorded)' WHERE description IS NULL OR trim(description) = '';

UPDATE task_blockers b SET
  status = CASE
    WHEN b.manager_decision IN ('accepted', 'extended') THEN 'accepted'
    WHEN b.manager_decision = 'rejected' THEN 'rejected'
    WHEN b.manager_decision IN ('reassigned', 'escalated') THEN 'resolved'
    ELSE 'pending_review' END,
  decided_at = CASE WHEN b.manager_decision IS NOT NULL THEN b.created_at END,
  previous_task_status = coalesce(b.previous_task_status, 'in_progress'),
  deadline_at_raise = coalesce(b.deadline_at_raise, (SELECT t.deadline FROM tasks t WHERE t.id = b.task_id))
WHERE b.decided_at IS NULL;

-- Only one open blocker per task: older duplicates (legacy data) are withdrawn.
UPDATE task_blockers b SET status = 'withdrawn', resolution_note = 'Superseded by a newer blocker during migration'
WHERE b.status IN ('pending_review', 'accepted')
  AND EXISTS (
    SELECT 1 FROM task_blockers n
    WHERE n.task_id = b.task_id AND n.status IN ('pending_review', 'accepted')
      AND (n.created_at > b.created_at OR (n.created_at = b.created_at AND n.id > b.id)));
-- A blocker on a task that is no longer BLOCKED is not open any more.
UPDATE task_blockers b SET status = 'resolved', resolved_at = coalesce(b.resolved_at, now()), resolution_note = 'Closed during migration (task no longer blocked)'
WHERE b.status IN ('pending_review', 'accepted')
  AND EXISTS (SELECT 1 FROM tasks t WHERE t.id = b.task_id AND t.status <> 'blocked');

ALTER TABLE task_blockers ALTER COLUMN blocker_type SET NOT NULL;
ALTER TABLE task_blockers ALTER COLUMN description SET NOT NULL;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'task_blockers_type_chk') THEN
    ALTER TABLE task_blockers ADD CONSTRAINT task_blockers_type_chk CHECK (blocker_type IN (
      'management_approval', 'customer_dependency', 'vendor_dependency', 'another_employee', 'missing_information',
      'external_portal_issue', 'technical_issue', 'approved_leave'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'task_blockers_status_chk') THEN
    ALTER TABLE task_blockers ADD CONSTRAINT task_blockers_status_chk CHECK (status IN ('pending_review', 'accepted', 'rejected', 'resolved', 'withdrawn'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'task_blockers_decision_chk') THEN
    ALTER TABLE task_blockers ADD CONSTRAINT task_blockers_decision_chk CHECK (decision IS NULL OR decision IN ('accept_extend', 'accept_pause', 'auto_accept_leave', 'reject'));
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS task_blockers_one_open_per_task ON task_blockers (task_id) WHERE status IN ('pending_review', 'accepted');
CREATE INDEX IF NOT EXISTS idx_task_blockers_status ON task_blockers (status);
CREATE INDEX IF NOT EXISTS idx_task_blockers_task ON task_blockers (task_id, created_at);
CREATE INDEX IF NOT EXISTS idx_task_blockers_dependency_user ON task_blockers (dependency_user_id) WHERE dependency_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_task_blockers_raised_by ON task_blockers (raised_by);

-- ---------------------------------------------------------------------------
-- 5. Progress log, attachments, deadline & assignment history, escalations
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS task_updates (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id          uuid NOT NULL REFERENCES tasks(id),
  author_id        uuid REFERENCES users(id),             -- NULL = system
  kind             text NOT NULL,
  comment          text,
  progress_percent integer,
  status_from      text,
  status_to        text,
  metadata         jsonb,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_task_updates_task ON task_updates (task_id, created_at);
CREATE INDEX IF NOT EXISTS idx_task_updates_author ON task_updates (author_id, created_at);

CREATE TABLE IF NOT EXISTS task_attachments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id     uuid NOT NULL REFERENCES tasks(id),
  purpose     text NOT NULL,
  related_id  uuid,
  file_name   text NOT NULL,
  storage_key text NOT NULL,
  mime_type   text NOT NULL,
  size_bytes  integer NOT NULL,
  sha256      text NOT NULL,
  uploaded_by uuid NOT NULL REFERENCES users(id),
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz,
  deleted_by  uuid REFERENCES users(id),
  CONSTRAINT task_attachments_purpose_chk CHECK (purpose IN ('supporting_doc', 'evidence', 'blocker_evidence', 'update')),
  CONSTRAINT task_attachments_size_chk CHECK (size_bytes > 0)
);
CREATE INDEX IF NOT EXISTS idx_task_attachments_task ON task_attachments (task_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS task_deadline_changes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id         uuid NOT NULL REFERENCES tasks(id),
  old_deadline    timestamptz,
  new_deadline    timestamptz NOT NULL,
  reason          text NOT NULL,
  source          text NOT NULL,
  blocker_id      uuid REFERENCES task_blockers(id),
  excused_minutes integer NOT NULL DEFAULT 0,
  locked_unexcused_minutes integer NOT NULL DEFAULT 0,
  changed_by      uuid REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT task_deadline_changes_source_chk CHECK (source IN ('blocker_accepted', 'manager_extension', 'reassignment', 'pause_resume', 'linked_reschedule', 'correction'))
);
CREATE INDEX IF NOT EXISTS idx_task_deadline_changes_task ON task_deadline_changes (task_id, created_at);

CREATE TABLE IF NOT EXISTS task_assignment_history (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id          uuid NOT NULL REFERENCES tasks(id),
  from_user_id     uuid REFERENCES users(id),
  to_user_id       uuid NOT NULL REFERENCES users(id),
  reason           text NOT NULL,
  reason_type      text NOT NULL DEFAULT 'other',
  was_overdue      boolean NOT NULL DEFAULT false,
  overdue_minutes  integer NOT NULL DEFAULT 0,
  changed_by       uuid REFERENCES users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT task_assignment_reason_type_chk CHECK (reason_type IN ('workload', 'leave', 'skills', 'non_performance', 'deactivation', 'other'))
);
CREATE INDEX IF NOT EXISTS idx_task_assignment_history_task ON task_assignment_history (task_id, created_at);
CREATE INDEX IF NOT EXISTS idx_task_assignment_history_from ON task_assignment_history (from_user_id);

CREATE TABLE IF NOT EXISTS task_escalations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id         uuid NOT NULL REFERENCES tasks(id),
  blocker_id      uuid REFERENCES task_blockers(id),
  escalated_by    uuid REFERENCES users(id),               -- NULL = system (SLA breach)
  escalated_to    uuid NOT NULL REFERENCES users(id),
  reason          text NOT NULL,
  status          text NOT NULL DEFAULT 'open',
  outcome_comment text,
  acknowledged_at timestamptz,
  closed_at       timestamptz,
  closed_by       uuid REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT task_escalations_status_chk CHECK (status IN ('open', 'acknowledged', 'closed'))
);
CREATE INDEX IF NOT EXISTS idx_task_escalations_task ON task_escalations (task_id);
CREATE INDEX IF NOT EXISTS idx_task_escalations_to ON task_escalations (escalated_to, status);

-- "Sent once" ledger for scheduled reminders / digests (notifications never repeat).
CREATE TABLE IF NOT EXISTS task_notification_log (
  dedupe_key text PRIMARY KEY,
  task_id    uuid,
  user_id    uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_task_notification_log_created ON task_notification_log (created_at);

-- ---------------------------------------------------------------------------
-- 6. Performance reviews & immutable evidence snapshots
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS performance_reviews (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id              uuid NOT NULL REFERENCES users(id),
  reviewer_id              uuid NOT NULL REFERENCES users(id),
  period_from              date NOT NULL,
  period_to                date NOT NULL,
  rating                   integer,
  rating_scale             integer NOT NULL DEFAULT 5,
  strengths                text,
  improvement_areas        text,
  comments                 text,
  employee_response        text,
  employee_responded_at    timestamptz,
  employee_acknowledged_at timestamptz,
  status                   text NOT NULL DEFAULT 'draft',
  submitted_at             timestamptz,
  locked_at                timestamptz,
  supersedes_id            uuid REFERENCES performance_reviews(id),
  superseded_by_id         uuid REFERENCES performance_reviews(id),
  revision_reason          text,
  version                  integer NOT NULL DEFAULT 1,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT performance_reviews_status_chk CHECK (status IN ('draft', 'submitted', 'acknowledged')),
  CONSTRAINT performance_reviews_period_chk CHECK (period_from <= period_to),
  CONSTRAINT performance_reviews_rating_chk CHECK (rating IS NULL OR (rating >= 1 AND rating <= rating_scale)),
  CONSTRAINT performance_reviews_not_self_chk CHECK (employee_id <> reviewer_id)
);
CREATE INDEX IF NOT EXISTS idx_performance_reviews_employee ON performance_reviews (employee_id, period_from);
CREATE INDEX IF NOT EXISTS idx_performance_reviews_reviewer ON performance_reviews (reviewer_id);

-- Once submitted, the reviewer's content is frozen; only the employee's response/acknowledgement may follow.
CREATE OR REPLACE FUNCTION performance_reviews_guard() RETURNS trigger AS $$
BEGIN
  IF OLD.locked_at IS NOT NULL AND (
       NEW.rating IS DISTINCT FROM OLD.rating OR NEW.strengths IS DISTINCT FROM OLD.strengths
    OR NEW.improvement_areas IS DISTINCT FROM OLD.improvement_areas OR NEW.comments IS DISTINCT FROM OLD.comments
    OR NEW.period_from IS DISTINCT FROM OLD.period_from OR NEW.period_to IS DISTINCT FROM OLD.period_to
    OR NEW.employee_id IS DISTINCT FROM OLD.employee_id OR NEW.reviewer_id IS DISTINCT FROM OLD.reviewer_id
    OR NEW.locked_at IS DISTINCT FROM OLD.locked_at OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at) THEN
    RAISE EXCEPTION 'A submitted performance review is locked; create a new version instead' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS performance_evidence_snapshots (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id    uuid NOT NULL REFERENCES users(id),
  period_from    date NOT NULL,
  period_to      date NOT NULL,
  period_basis   text NOT NULL,
  snapshot_no    integer NOT NULL,
  generated_by   uuid NOT NULL REFERENCES users(id),
  generated_at   timestamptz NOT NULL DEFAULT now(),
  data           jsonb NOT NULL,
  data_sha256    text NOT NULL,
  pdf_storage_key  text,
  pdf_sha256       text,
  xlsx_storage_key text,
  xlsx_sha256      text,
  CONSTRAINT performance_snapshots_period_chk CHECK (period_from <= period_to),
  CONSTRAINT performance_snapshots_basis_chk CHECK (period_basis IN ('deadline', 'completion')),
  CONSTRAINT performance_snapshots_no_key UNIQUE (employee_id, period_from, period_to, snapshot_no)
);
CREATE INDEX IF NOT EXISTS idx_performance_snapshots_employee ON performance_evidence_snapshots (employee_id, generated_at DESC);

-- Append-only history tables. A purge is only possible inside a transaction that sets
-- arihant.allow_task_purge = 'on' (the 15-minute "created by mistake" delete and test clean-up).
CREATE OR REPLACE FUNCTION task_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND coalesce(current_setting('arihant.allow_task_purge', true), '') = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- 7. Reporting-line helpers (direct + indirect reports, manager chain)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION user_subordinate_ids(p_manager uuid, p_max_depth integer DEFAULT 10) RETURNS SETOF uuid
LANGUAGE sql STABLE AS $$
  WITH RECURSIVE sub(id, depth) AS (
    SELECT u.id, 1 FROM users u WHERE u.reporting_manager_id = p_manager AND u.id <> p_manager
    UNION
    SELECT u.id, s.depth + 1 FROM users u JOIN sub s ON u.reporting_manager_id = s.id
    WHERE s.depth < p_max_depth AND u.id <> p_manager
  )
  SELECT DISTINCT id FROM sub;
$$;

CREATE OR REPLACE FUNCTION user_manager_chain(p_user uuid, p_max_depth integer DEFAULT 10) RETURNS TABLE (id uuid, depth integer, is_active boolean)
LANGUAGE sql STABLE AS $$
  WITH RECURSIVE chain(id, depth) AS (
    SELECT u.reporting_manager_id, 1 FROM users u WHERE u.id = p_user AND u.reporting_manager_id IS NOT NULL AND u.reporting_manager_id <> p_user
    UNION
    SELECT u.reporting_manager_id, c.depth + 1 FROM users u JOIN chain c ON u.id = c.id
    WHERE u.reporting_manager_id IS NOT NULL AND c.depth < p_max_depth AND u.reporting_manager_id <> p_user
  )
  SELECT c.id, min(c.depth)::integer, bool_and(u.is_active) FROM chain c JOIN users u ON u.id = c.id GROUP BY c.id ORDER BY min(c.depth);
$$;

-- ---------------------------------------------------------------------------
-- 8. Triggers
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_users_deactivation') THEN
    CREATE TRIGGER trg_users_deactivation BEFORE UPDATE OF is_active ON users FOR EACH ROW EXECUTE FUNCTION users_stamp_deactivation();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_tasks_before_insert') THEN
    CREATE TRIGGER trg_tasks_before_insert BEFORE INSERT ON tasks FOR EACH ROW EXECUTE FUNCTION tasks_before_insert();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_tasks_guard_update') THEN
    CREATE TRIGGER trg_tasks_guard_update BEFORE UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION tasks_guard_update();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_task_updates_append_only') THEN
    CREATE TRIGGER trg_task_updates_append_only BEFORE UPDATE OR DELETE ON task_updates FOR EACH ROW EXECUTE FUNCTION task_append_only();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_task_deadline_changes_append_only') THEN
    CREATE TRIGGER trg_task_deadline_changes_append_only BEFORE UPDATE OR DELETE ON task_deadline_changes FOR EACH ROW EXECUTE FUNCTION task_append_only();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_task_assignment_history_append_only') THEN
    CREATE TRIGGER trg_task_assignment_history_append_only BEFORE UPDATE OR DELETE ON task_assignment_history FOR EACH ROW EXECUTE FUNCTION task_append_only();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_performance_snapshots_append_only') THEN
    CREATE TRIGGER trg_performance_snapshots_append_only BEFORE UPDATE OR DELETE ON performance_evidence_snapshots FOR EACH ROW EXECUTE FUNCTION task_append_only();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_performance_reviews_guard') THEN
    CREATE TRIGGER trg_performance_reviews_guard BEFORE UPDATE ON performance_reviews FOR EACH ROW EXECUTE FUNCTION performance_reviews_guard();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_task_categories_updated') THEN
    CREATE TRIGGER trg_task_categories_updated BEFORE UPDATE ON task_categories FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_task_templates_updated') THEN
    CREATE TRIGGER trg_task_templates_updated BEFORE UPDATE ON task_templates FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_task_blockers_updated') THEN
    CREATE TRIGGER trg_task_blockers_updated BEFORE UPDATE ON task_blockers FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_task_escalations_updated') THEN
    CREATE TRIGGER trg_task_escalations_updated BEFORE UPDATE ON task_escalations FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_performance_reviews_updated') THEN
    CREATE TRIGGER trg_performance_reviews_updated BEFORE UPDATE ON performance_reviews FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_holidays_updated') THEN
    CREATE TRIGGER trg_holidays_updated BEFORE UPDATE ON holidays FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_employee_leaves_updated') THEN
    CREATE TRIGGER trg_employee_leaves_updated BEFORE UPDATE ON employee_leaves FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 9. Legacy carry-over
-- ---------------------------------------------------------------------------
-- v1 "recurring" rows (task_type daily/weekly/monthly) become proper templates; the row itself stays a one-time task.
INSERT INTO task_templates (
  title, description, expected_outcome, category_id, customer_id, tender_id, demo_id, service_ticket_id,
  assigned_to, assigned_by, priority, recurrence_type, recurrence_rule, start_date, due_time, holiday_policy, created_by
)
SELECT
  t.title, t.description, t.expected_outcome, t.category_id, t.customer_id, t.tender_id, t.demo_id, t.service_ticket_id,
  t.assigned_to, t.reporting_manager_id, t.priority,
  t.task_type,
  CASE t.task_type
    WHEN 'daily' THEN jsonb_build_object('freq', 'daily', 'interval', 1)
    WHEN 'weekly' THEN jsonb_build_object('freq', 'weekly', 'interval', 1, 'weekdays', jsonb_build_array(extract(dow FROM greatest(coalesce(t.start_date, t.created_at::date), (now() AT TIME ZONE 'Asia/Kolkata')::date))::int))
    ELSE jsonb_build_object('freq', 'monthly', 'interval', 1, 'month_days', jsonb_build_array(extract(day FROM greatest(coalesce(t.start_date, t.created_at::date), (now() AT TIME ZONE 'Asia/Kolkata')::date))::int))
  END,
  greatest(coalesce(t.start_date, t.created_at::date), (now() AT TIME ZONE 'Asia/Kolkata')::date),
  '18:00',
  CASE WHEN t.task_type = 'daily' THEN 'skip' ELSE 'shift_after' END,
  t.reporting_manager_id
FROM tasks t
WHERE t.task_type IN ('daily', 'weekly', 'monthly')
  AND t.assigned_to IS NOT NULL
  AND t.template_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM task_templates x WHERE x.title = t.title AND x.assigned_to = t.assigned_to);
UPDATE tasks SET task_type = 'one_time' WHERE task_type IN ('daily', 'weekly', 'monthly', 'recurring');

INSERT INTO task_updates (task_id, author_id, kind, comment, status_to, created_at)
SELECT t.id, NULL, 'legacy_import', 'Carried over from the v1 task register', t.status, t.created_at
FROM tasks t
WHERE NOT EXISTS (SELECT 1 FROM task_updates u WHERE u.task_id = t.id);
