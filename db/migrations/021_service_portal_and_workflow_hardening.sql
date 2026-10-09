-- Migration 021: Service module hardening + public customer intake portal

-- 1. Collision-free ticket numbers (TCK-YYYY-NNNNNN is built from this sequence)
CREATE SEQUENCE IF NOT EXISTS service_ticket_no_seq START WITH 100001;

-- 2. Workflow / SLA bookkeeping columns
ALTER TABLE service_tickets
  ADD COLUMN IF NOT EXISTS intake_request_id uuid,
  ADD COLUMN IF NOT EXISTS claimed_organisation_name text,
  ADD COLUMN IF NOT EXISTS sla_pause_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS sla_breach_notified_at timestamptz,
  ADD COLUMN IF NOT EXISTS auto_escalated_at timestamptz,
  ADD COLUMN IF NOT EXISTS reopened_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reopened_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_service_tickets_status ON service_tickets(status);
CREATE INDEX IF NOT EXISTS idx_service_tickets_sla_resolution ON service_tickets(sla_resolution_due_at);

-- 3. Reserved holding organisation for portal tickets whose customer cannot be matched yet.
INSERT INTO organisations (id, name, sector, is_govt)
VALUES ('00000000-0000-4000-8000-0000000000a1', 'Unverified Portal Customer (Triage Required)', 'Unverified', false)
ON CONFLICT (id) DO NOTHING;

-- 4. Public intake log: every customer submission, matched or not
CREATE TABLE IF NOT EXISTS service_intake_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference text NOT NULL UNIQUE,
  ticket_id uuid REFERENCES service_tickets(id) ON DELETE SET NULL,
  organisation_id uuid REFERENCES organisations(id) ON DELETE SET NULL,
  match_method text NOT NULL DEFAULT 'none',          -- serial | name_city | name | none
  match_confidence numeric NOT NULL DEFAULT 0,
  claimed_organisation text NOT NULL,
  claimed_department text,
  claimed_city text,
  claimed_state text,
  location text,
  contact_name text NOT NULL,
  contact_designation text,
  contact_phone text NOT NULL,
  contact_email text,
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  product_text text,
  equipment_serial text,
  problem_category text NOT NULL DEFAULT 'Breakdown',
  complaint text NOT NULL,
  urgency text NOT NULL,
  preferred_visit_date date,
  site_access_notes text,
  consent boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'received',           -- received | converted | duplicate | rejected
  duplicate_of uuid,
  tracking_token_hash text NOT NULL,
  ip_hash text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_intake_ip_created ON service_intake_requests(ip_hash, created_at);
CREATE INDEX IF NOT EXISTS idx_intake_phone_created ON service_intake_requests(contact_phone, created_at);
CREATE INDEX IF NOT EXISTS idx_intake_ticket ON service_intake_requests(ticket_id);

ALTER TABLE service_tickets
  DROP CONSTRAINT IF EXISTS service_tickets_intake_fk;
ALTER TABLE service_tickets
  ADD CONSTRAINT service_tickets_intake_fk FOREIGN KEY (intake_request_id) REFERENCES service_intake_requests(id) ON DELETE SET NULL;

-- 5. SLA rules for every priority x coverage (previously only in_warranty was seeded)
INSERT INTO sla_rules (priority, warranty_type, response_hours, resolution_hours, business_hours_only)
SELECT p.priority, w.warranty_type, p.response_hours, p.resolution_hours + w.extra_resolution, p.business_hours_only
FROM (VALUES
  ('critical', 2, 8, false),
  ('high', 4, 24, true),
  ('medium', 8, 48, true),
  ('low', 24, 72, true)
) AS p(priority, response_hours, resolution_hours, business_hours_only)
CROSS JOIN (VALUES ('amc', 0), ('out_of_warranty', 8)) AS w(warranty_type, extra_resolution)
WHERE NOT EXISTS (
  SELECT 1 FROM sla_rules r WHERE r.priority = p.priority AND r.warranty_type = w.warranty_type
);

-- 6. Portal settings
INSERT INTO service_settings (key, value, description) VALUES
  ('portal_enabled', 'true'::jsonb, 'Master switch for the public customer service-request form'),
  ('portal_rate_limit_per_hour', '8'::jsonb, 'Max portal submissions per IP per hour'),
  ('portal_rate_limit_per_phone_per_day', '10'::jsonb, 'Max portal submissions per contact phone per day'),
  ('portal_duplicate_window_minutes', '30'::jsonb, 'Identical submissions inside this window return the existing ticket'),
  ('auto_assign_portal_tickets', 'false'::jsonb, 'Auto-assign portal tickets to the least-loaded engineer in the customer region'),
  ('business_day_start_hour', '9'::jsonb, 'Business day start (IST) used by business-hours SLA'),
  ('business_day_end_hour', '18'::jsonb, 'Business day end (IST) used by business-hours SLA')
ON CONFLICT (key) DO NOTHING;
