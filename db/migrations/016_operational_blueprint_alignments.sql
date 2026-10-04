-- =====================================================================
-- ARIHANT BOS — OPERATIONAL BLUEPRINT & MEETING ALIGNMENT MIGRATION
-- (016_operational_blueprint_alignments.sql)
-- =====================================================================

-- 1. Demo Management: Tender Value & Strategic Allocation fields
alter table demos add column if not exists tender_id uuid references tenders(id) on delete set null;
alter table demos add column if not exists deal_value numeric(15,2);

create index if not exists idx_demos_tender_id on demos(tender_id);
create index if not exists idx_demos_deal_value on demos(deal_value);

-- 2. Visit Management: Contact Unavailable fields
alter table visit_updates add column if not exists contact_unavailable boolean default false;
alter table visit_updates add column if not exists contact_unavailable_reason text;

-- 3. Expenses: Optimization Indexes for Tally Export and Aggregates
create index if not exists idx_expenses_expense_date on expenses(expense_date);
create index if not exists idx_expenses_category on expenses(category);
create index if not exists idx_expenses_status on expenses(status);
create index if not exists idx_expenses_employee_status on expenses(employee_id, status);
create index if not exists idx_expenses_org_id on expenses(organisation_id);
