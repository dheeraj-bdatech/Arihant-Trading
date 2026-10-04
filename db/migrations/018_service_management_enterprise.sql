-- Migration 018: Enterprise Service & After-Sales Management (Module 6)

-- 1. Enhance service_tickets table
ALTER TABLE service_tickets
  ADD COLUMN IF NOT EXISTS ticket_number text,
  ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES organisations(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS site_location_id uuid,
  ADD COLUMN IF NOT EXISTS equipment_id uuid REFERENCES products(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS serial_number text,
  ADD COLUMN IF NOT EXISTS equipment_unverified boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS problem_category text DEFAULT 'Breakdown',
  ADD COLUMN IF NOT EXISTS complaint_description text,
  ADD COLUMN IF NOT EXISTS complaint_source text DEFAULT 'Phone',
  ADD COLUMN IF NOT EXISTS date_received timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS warranty_status_snapshot text,
  ADD COLUMN IF NOT EXISTS warranty_override boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS override_reason text,
  ADD COLUMN IF NOT EXISTS override_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS coverage_details jsonb DEFAULT '{"parts_covered": false, "labour_covered": false, "travel_covered": false}'::jsonb,
  ADD COLUMN IF NOT EXISTS is_chargeable boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS assigned_engineer_id uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS additional_engineer_ids jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS status_reason text,
  ADD COLUMN IF NOT EXISTS sla_response_due_at timestamptz,
  ADD COLUMN IF NOT EXISTS sla_resolution_due_at timestamptz,
  ADD COLUMN IF NOT EXISTS sla_paused_minutes integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS first_response_at timestamptz,
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS parent_ticket_id uuid REFERENCES service_tickets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_repeat_complaint boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS branch_id uuid,
  ADD COLUMN IF NOT EXISTS region_id uuid REFERENCES regions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS linked_quotation_id uuid,
  ADD COLUMN IF NOT EXISTS linked_invoice_id uuid,
  ADD COLUMN IF NOT EXISTS linked_sales_order_id uuid,
  ADD COLUMN IF NOT EXISTS billing_status text DEFAULT 'not_chargeable',
  ADD COLUMN IF NOT EXISTS billing_waived boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS billing_waived_reason text,
  ADD COLUMN IF NOT EXISTS billing_waived_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- Synchronize legacy columns with new standard columns for backward compatibility
UPDATE service_tickets SET
  ticket_number = COALESCE(ticket_number, ticket_no),
  customer_id = COALESCE(customer_id, organisation_id),
  equipment_id = COALESCE(equipment_id, product_id),
  serial_number = COALESCE(serial_number, equipment_serial),
  complaint_description = COALESCE(complaint_description, complaint),
  assigned_engineer_id = COALESCE(assigned_engineer_id, assigned_to),
  warranty_status_snapshot = COALESCE(warranty_status_snapshot, warranty_status)
WHERE ticket_number IS NULL OR customer_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_service_tickets_ticket_number ON service_tickets(ticket_number) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_service_tickets_customer_id ON service_tickets(customer_id);
CREATE INDEX IF NOT EXISTS idx_service_tickets_assigned_engineer ON service_tickets(assigned_engineer_id);
CREATE INDEX IF NOT EXISTS idx_service_tickets_serial_number ON service_tickets(serial_number);
CREATE INDEX IF NOT EXISTS idx_service_tickets_region_id ON service_tickets(region_id);
CREATE INDEX IF NOT EXISTS idx_service_tickets_deleted_at ON service_tickets(deleted_at);

-- 2. service_visits table
CREATE TABLE IF NOT EXISTS service_visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES service_tickets(id) ON DELETE CASCADE,
  visit_number integer NOT NULL DEFAULT 1,
  engineer_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  scheduled_start timestamptz,
  scheduled_end timestamptz,
  actual_check_in timestamptz,
  actual_check_out timestamptz,
  check_in_lat numeric,
  check_in_lng numeric,
  visit_outcome text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_service_visits_ticket_id ON service_visits(ticket_id);

-- 3. Enhance service_reports table
ALTER TABLE service_reports
  ADD COLUMN IF NOT EXISTS visit_id uuid REFERENCES service_visits(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS root_cause text,
  ADD COLUMN IF NOT EXISTS warranty_status_confirmed text,
  ADD COLUMN IF NOT EXISTS customer_confirmation_type text DEFAULT 'Signature',
  ADD COLUMN IF NOT EXISTS customer_signature text,
  ADD COLUMN IF NOT EXISTS customer_name_signed text,
  ADD COLUMN IF NOT EXISTS customer_feedback_rating integer,
  ADD COLUMN IF NOT EXISTS customer_remarks text,
  ADD COLUMN IF NOT EXISTS confirmation_not_obtained_reason text,
  ADD COLUMN IF NOT EXISTS further_work_description text,
  ADD COLUMN IF NOT EXISTS attachments jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS report_status text DEFAULT 'Draft',
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS return_reason text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_service_reports_visit_id ON service_reports(visit_id);
CREATE INDEX IF NOT EXISTS idx_service_reports_report_status ON service_reports(report_status);

-- 4. ticket_status_history table
CREATE TABLE IF NOT EXISTS ticket_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES service_tickets(id) ON DELETE CASCADE,
  from_status text,
  to_status text NOT NULL,
  reason text,
  changed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  sla_impact text DEFAULT 'none'
);

CREATE INDEX IF NOT EXISTS idx_ticket_status_history_ticket_id ON ticket_status_history(ticket_id);

-- 5. ticket_assignment_history table
CREATE TABLE IF NOT EXISTS ticket_assignment_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES service_tickets(id) ON DELETE CASCADE,
  from_engineer uuid REFERENCES users(id) ON DELETE SET NULL,
  to_engineer uuid REFERENCES users(id) ON DELETE SET NULL,
  reason text,
  changed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ticket_assignment_history_ticket_id ON ticket_assignment_history(ticket_id);

-- 6. ticket_comments table
CREATE TABLE IF NOT EXISTS ticket_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES service_tickets(id) ON DELETE CASCADE,
  author_id uuid REFERENCES users(id) ON DELETE SET NULL,
  body text NOT NULL,
  is_internal boolean NOT NULL DEFAULT true,
  mentions jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ticket_comments_ticket_id ON ticket_comments(ticket_id);

-- 7. part_requests table
CREATE TABLE IF NOT EXISTS part_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES service_tickets(id) ON DELETE CASCADE,
  part_id uuid REFERENCES products(id) ON DELETE SET NULL,
  part_name text,
  quantity integer NOT NULL DEFAULT 1,
  requested_by uuid REFERENCES users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'Requested',
  expected_date date,
  store_remarks text,
  serial_issued text,
  serial_returned text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_part_requests_ticket_id ON part_requests(ticket_id);
CREATE INDEX IF NOT EXISTS idx_part_requests_status ON part_requests(status);

-- 8. Configuration tables: sla_rules & service_settings
CREATE TABLE IF NOT EXISTS sla_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  priority text NOT NULL,
  warranty_type text NOT NULL,
  response_hours integer NOT NULL,
  resolution_hours integer NOT NULL,
  business_hours_only boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS service_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text UNIQUE NOT NULL,
  value jsonb NOT NULL,
  description text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Seed default SLA rules if empty
INSERT INTO sla_rules (priority, warranty_type, response_hours, resolution_hours, business_hours_only)
SELECT 'critical', 'in_warranty', 2, 8, false
WHERE NOT EXISTS (SELECT 1 FROM sla_rules WHERE priority = 'critical' AND warranty_type = 'in_warranty');

INSERT INTO sla_rules (priority, warranty_type, response_hours, resolution_hours, business_hours_only)
SELECT 'high', 'in_warranty', 4, 24, true
WHERE NOT EXISTS (SELECT 1 FROM sla_rules WHERE priority = 'high' AND warranty_type = 'in_warranty');

INSERT INTO sla_rules (priority, warranty_type, response_hours, resolution_hours, business_hours_only)
SELECT 'medium', 'in_warranty', 8, 48, true
WHERE NOT EXISTS (SELECT 1 FROM sla_rules WHERE priority = 'medium' AND warranty_type = 'in_warranty');

INSERT INTO sla_rules (priority, warranty_type, response_hours, resolution_hours, business_hours_only)
SELECT 'low', 'in_warranty', 24, 72, true
WHERE NOT EXISTS (SELECT 1 FROM sla_rules WHERE priority = 'low' AND warranty_type = 'in_warranty');

-- Seed default service settings
INSERT INTO service_settings (key, value, description)
VALUES 
  ('repeat_complaint_window_days', '30'::jsonb, 'Days window to detect repeat complaint on same equipment'),
  ('reopen_window_days', '7'::jsonb, 'Days window after closure within which ticket can be reopened'),
  ('auto_escalation_critical_unassigned_hours', '1'::jsonb, 'Hours after which critical unassigned ticket auto-escalates'),
  ('sla_pause_statuses', '["awaiting_customer", "awaiting_part"]'::jsonb, 'Statuses that pause the SLA calculation clock')
ON CONFLICT (key) DO NOTHING;
