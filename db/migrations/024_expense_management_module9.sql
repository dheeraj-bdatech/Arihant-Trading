-- Migration 024: Module 9 — Standardised Expense Management
-- Claim header + line items + receipts + immutable approval history, admin-managed categories,
-- a minimal projects master and an employee code for the Tally export.
-- Legacy single-line `expenses` rows are copied into the new tables (the legacy table is kept, unused).
-- Reverse with db/migrations/down/024_expense_management_module9.down.sql

-- ---------------------------------------------------------------------------
-- 0. Supporting columns / masters
-- ---------------------------------------------------------------------------
ALTER TABLE users ADD COLUMN IF NOT EXISTS employee_code text;
CREATE UNIQUE INDEX IF NOT EXISTS users_employee_code_key ON users (employee_code) WHERE employee_code IS NOT NULL;

CREATE TABLE IF NOT EXISTS projects (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code            text NOT NULL UNIQUE,
  name            text NOT NULL,
  organisation_id uuid REFERENCES organisations(id),
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid REFERENCES users(id),
  updated_by      uuid REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_projects_org ON projects (organisation_id);

-- ---------------------------------------------------------------------------
-- 1. Categories (admin-managed master)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS expense_categories (
  id                           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                         text NOT NULL UNIQUE,
  name                         text NOT NULL,
  is_active                    boolean NOT NULL DEFAULT true,
  receipt_required_above       numeric(12,2),            -- 0 = always, NULL = never
  max_amount_per_item          numeric(12,2),
  cap_is_hard                  boolean NOT NULL DEFAULT false,
  requires_customer_or_project boolean NOT NULL DEFAULT false,
  requires_remark              boolean NOT NULL DEFAULT false,
  display_order                integer NOT NULL DEFAULT 0,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  updated_at                   timestamptz NOT NULL DEFAULT now(),
  created_by                   uuid REFERENCES users(id),
  updated_by                   uuid REFERENCES users(id),
  CONSTRAINT expense_categories_receipt_threshold_chk CHECK (receipt_required_above IS NULL OR receipt_required_above >= 0),
  CONSTRAINT expense_categories_cap_chk CHECK (max_amount_per_item IS NULL OR max_amount_per_item > 0)
);

INSERT INTO expense_categories (code, name, receipt_required_above, max_amount_per_item, cap_is_hard, requires_customer_or_project, requires_remark, display_order) VALUES
  ('TRAVEL',           'Travel',                  0,    NULL,  false, false, false, 1),
  ('HOTEL',            'Hotel',                   0,    8000,  false, false, false, 2),
  ('LOCAL_CONVEYANCE', 'Local conveyance',        500,  NULL,  false, false, false, 3),
  ('FOOD',             'Food',                    1000, 2000,  false, false, false, 4),
  ('DEMO',             'Demo expenses',           0,    NULL,  false, true,  false, 5),
  ('SERVICE',          'Service expenses',        0,    NULL,  false, true,  false, 6),
  ('OTHER',            'Other approved expenses', 0,    NULL,  false, false, true,  7)
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Claims (header)
-- ---------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS expense_claim_number_seq START 1;

CREATE TABLE IF NOT EXISTS expense_claims (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_number          text NOT NULL UNIQUE,
  employee_id           uuid NOT NULL REFERENCES users(id),
  trip_id               uuid REFERENCES trips(id),
  visit_id              uuid REFERENCES visits(id),
  title                 text NOT NULL,
  remarks               text,
  period_from           date,
  period_to             date,
  region_id             uuid REFERENCES regions(id),     -- snapshot at submission
  manager_id            uuid REFERENCES users(id),       -- approver snapshot at submission
  status                text NOT NULL DEFAULT 'draft',
  total_claimed         numeric(12,2) NOT NULL DEFAULT 0,
  total_approved        numeric(12,2),
  currency              text NOT NULL DEFAULT 'INR',
  submitted_at          timestamptz,
  manager_actioned_at   timestamptz,
  accounts_actioned_at  timestamptz,
  processed_at          timestamptz,
  tally_voucher_ref     text,
  payment_reference     text,
  payment_date          date,
  last_reviewer_comment text,
  copied_from_claim_id  uuid REFERENCES expense_claims(id),
  legacy_expense_id     uuid UNIQUE,
  version               integer NOT NULL DEFAULT 1,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid REFERENCES users(id),
  updated_by            uuid REFERENCES users(id),
  deleted_at            timestamptz,
  CONSTRAINT expense_claims_status_chk CHECK (status IN (
    'draft', 'submitted', 'manager_approved', 'accounts_review', 'accounts_approved',
    'clarification_required', 'rejected', 'processed', 'withdrawn')),
  CONSTRAINT expense_claims_totals_chk CHECK (total_claimed >= 0 AND (total_approved IS NULL OR total_approved >= 0)),
  CONSTRAINT expense_claims_period_chk CHECK (period_from IS NULL OR period_to IS NULL OR period_from <= period_to),
  CONSTRAINT expense_claims_processed_ref_chk CHECK (status <> 'processed' OR tally_voucher_ref IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_expense_claims_employee ON expense_claims (employee_id);
CREATE INDEX IF NOT EXISTS idx_expense_claims_trip ON expense_claims (trip_id);
CREATE INDEX IF NOT EXISTS idx_expense_claims_visit ON expense_claims (visit_id);
CREATE INDEX IF NOT EXISTS idx_expense_claims_region ON expense_claims (region_id);
CREATE INDEX IF NOT EXISTS idx_expense_claims_manager_status ON expense_claims (manager_id, status);
CREATE INDEX IF NOT EXISTS idx_expense_claims_status ON expense_claims (status);
CREATE INDEX IF NOT EXISTS idx_expense_claims_submitted_at ON expense_claims (submitted_at);
CREATE INDEX IF NOT EXISTS idx_expense_claims_active ON expense_claims (created_at DESC) WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- 3. Items (lines)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS expense_items (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id                uuid NOT NULL REFERENCES expense_claims(id),
  expense_date            date NOT NULL,
  category_id             uuid NOT NULL REFERENCES expense_categories(id),
  category_name           text NOT NULL,             -- snapshot so a later rename does not rewrite history
  amount                  numeric(12,2) NOT NULL,
  approved_amount         numeric(12,2),
  purpose                 text NOT NULL,
  customer_id             uuid REFERENCES organisations(id),
  project_id              uuid REFERENCES projects(id),
  remarks                 text,
  late_submission_reason  text,
  item_status             text NOT NULL DEFAULT 'pending',
  reviewer_comment        text,
  category_details        jsonb NOT NULL DEFAULT '{}'::jsonb,
  duplicate_confirmed_at  timestamptz,
  duplicate_of_item_id    uuid REFERENCES expense_items(id),
  manager_approved_amount numeric(12,2),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  created_by              uuid REFERENCES users(id),
  updated_by              uuid REFERENCES users(id),
  deleted_at              timestamptz,
  CONSTRAINT expense_items_amount_chk CHECK (amount > 0),
  CONSTRAINT expense_items_approved_chk CHECK (approved_amount IS NULL OR (approved_amount >= 0 AND approved_amount <= amount)),
  CONSTRAINT expense_items_status_chk CHECK (item_status IN ('pending', 'approved', 'partially_approved', 'rejected'))
);
CREATE INDEX IF NOT EXISTS idx_expense_items_claim ON expense_items (claim_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_expense_items_category ON expense_items (category_id);
CREATE INDEX IF NOT EXISTS idx_expense_items_customer ON expense_items (customer_id);
CREATE INDEX IF NOT EXISTS idx_expense_items_project ON expense_items (project_id);
CREATE INDEX IF NOT EXISTS idx_expense_items_date ON expense_items (expense_date);
CREATE INDEX IF NOT EXISTS idx_expense_items_dup_lookup ON expense_items (expense_date, category_id, amount) WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- 4. Attachments (receipts)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS expense_attachments (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id                    uuid NOT NULL REFERENCES expense_items(id),
  file_name                  text NOT NULL,
  storage_key                text NOT NULL,
  mime_type                  text NOT NULL,
  size_bytes                 integer NOT NULL,
  sha256                     text NOT NULL,
  duplicate_of_attachment_id uuid REFERENCES expense_attachments(id),
  uploaded_by                uuid NOT NULL REFERENCES users(id),
  uploaded_at                timestamptz NOT NULL DEFAULT now(),
  deleted_at                 timestamptz,
  CONSTRAINT expense_attachments_size_chk CHECK (size_bytes > 0)
);
CREATE INDEX IF NOT EXISTS idx_expense_attachments_item ON expense_attachments (item_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_expense_attachments_sha ON expense_attachments (sha256) WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- 5. Approval history (append-only)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS expense_approval_history (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id    uuid NOT NULL REFERENCES expense_claims(id),
  from_status text,
  to_status   text NOT NULL,
  action      text NOT NULL,
  actor_id    uuid REFERENCES users(id),
  actor_role  text,
  comment     text,
  metadata    jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_expense_history_claim ON expense_approval_history (claim_id, created_at);

CREATE OR REPLACE FUNCTION expense_history_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'expense_approval_history is append-only';
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_expense_history_immutable') THEN
    CREATE TRIGGER trg_expense_history_immutable BEFORE UPDATE OR DELETE ON expense_approval_history
      FOR EACH ROW EXECUTE FUNCTION expense_history_immutable();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_expense_claims_updated') THEN
    CREATE TRIGGER trg_expense_claims_updated BEFORE UPDATE ON expense_claims FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_expense_items_updated') THEN
    CREATE TRIGGER trg_expense_items_updated BEFORE UPDATE ON expense_items FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_expense_categories_updated') THEN
    CREATE TRIGGER trg_expense_categories_updated BEFORE UPDATE ON expense_categories FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_projects_updated') THEN
    CREATE TRIGGER trg_projects_updated BEFORE UPDATE ON projects FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 6. Copy legacy single-line expenses into claims (one claim + one item each)
-- ---------------------------------------------------------------------------
WITH legacy AS (
  SELECT e.*,
         CASE e.status
           WHEN 'manager_approved' THEN 'accounts_review'
           WHEN 'accounts_processed' THEN 'processed'
           WHEN 'rejected' THEN 'rejected'
           WHEN 'clarification_required' THEN 'clarification_required'
           ELSE 'submitted'
         END AS new_status,
         u.region_id AS emp_region_id
  FROM expenses e
  JOIN users u ON u.id = e.employee_id
  WHERE NOT EXISTS (SELECT 1 FROM expense_claims c WHERE c.legacy_expense_id = e.id)
),
ins AS (
  INSERT INTO expense_claims (
    claim_number, employee_id, visit_id, title, remarks, period_from, period_to, region_id, manager_id,
    status, total_claimed, total_approved, submitted_at, manager_actioned_at, processed_at,
    tally_voucher_ref, last_reviewer_comment, legacy_expense_id, created_at, created_by
  )
  SELECT
    'EXP-' || to_char(l.created_at AT TIME ZONE 'Asia/Kolkata', 'YYYY') || '-' || lpad(nextval('expense_claim_number_seq')::text, 6, '0'),
    l.employee_id, l.visit_id, coalesce(nullif(trim(l.purpose), ''), 'Legacy expense claim'), l.remarks,
    l.expense_date, l.expense_date, l.emp_region_id, l.manager_id,
    l.new_status, l.amount,
    CASE WHEN l.new_status IN ('accounts_review', 'processed') THEN l.amount WHEN l.new_status = 'rejected' THEN 0 ELSE NULL END,
    l.created_at,
    CASE WHEN l.new_status IN ('accounts_review', 'processed', 'rejected', 'clarification_required') THEN l.updated_at ELSE NULL END,
    CASE WHEN l.new_status = 'processed' THEN l.updated_at ELSE NULL END,
    CASE WHEN l.new_status = 'processed' THEN 'LEGACY-' || left(l.id::text, 8) ELSE NULL END,
    l.manager_remarks, l.id, l.created_at, l.employee_id
  FROM legacy l
  RETURNING id, legacy_expense_id, status
)
INSERT INTO expense_items (
  claim_id, expense_date, category_id, category_name, amount, approved_amount, purpose, customer_id, remarks, item_status, category_details, created_at, created_by
)
SELECT
  ins.id, e.expense_date,
  coalesce(
    (SELECT id FROM expense_categories c WHERE c.code = upper(e.category)),
    (SELECT id FROM expense_categories c WHERE c.code = 'OTHER')
  ),
  coalesce(
    (SELECT name FROM expense_categories c WHERE c.code = upper(e.category)),
    'Other approved expenses'
  ),
  e.amount,
  CASE WHEN ins.status IN ('accounts_review', 'processed') THEN e.amount WHEN ins.status = 'rejected' THEN 0 ELSE NULL END,
  coalesce(nullif(trim(e.purpose), ''), 'Legacy expense'),
  e.organisation_id,
  coalesce(e.remarks, CASE WHEN e.receipt_url IS NOT NULL THEN 'Legacy receipt: ' || e.receipt_url END),
  CASE WHEN ins.status IN ('accounts_review', 'processed') THEN 'approved' WHEN ins.status = 'rejected' THEN 'rejected' ELSE 'pending' END,
  '{}'::jsonb, e.created_at, e.employee_id
FROM ins
JOIN expenses e ON e.id = ins.legacy_expense_id;

INSERT INTO expense_approval_history (claim_id, from_status, to_status, action, actor_id, actor_role, comment, created_at)
SELECT c.id, NULL, c.status, 'legacy_import', NULL, 'system', 'Imported from the legacy single-line expense register', now()
FROM expense_claims c
WHERE c.legacy_expense_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM expense_approval_history h WHERE h.claim_id = c.id AND h.action = 'legacy_import');
