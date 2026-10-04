-- =====================================================================
-- Migration: 019_tender_management_enterprise.sql
-- Module 4: Tender Management Enterprise Schema & Integrations
-- =====================================================================

-- 1. Sequences & Generator for internal_ref (format TND-YYYY-00001)
create sequence if not exists tender_internal_ref_seq start with 1 increment by 1;

create or replace function generate_tender_internal_ref()
returns text as $$
declare
  curr_year text := to_char(current_date, 'YYYY');
  next_val bigint;
begin
  next_val := nextval('tender_internal_ref_seq');
  return 'TND-' || curr_year || '-' || lpad(next_val::text, 5, '0');
end;
$$ language plpgsql;

-- 2. Master Table: tender_portals
create table if not exists tender_portals (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  code text unique not null,
  base_url text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into tender_portals (name, code, base_url, is_active) values
  ('GeM', 'gem', 'https://gem.gov.in', true),
  ('CPPP', 'cppp', 'https://eprocure.gov.in/eprocure/app', true),
  ('State e-Procurement', 'state_eproc', null, true),
  ('Organisation Website', 'org_website', null, true),
  ('Offline/Physical', 'offline', null, true),
  ('Other', 'other', null, true)
on conflict (code) do update set
  name = excluded.name,
  base_url = excluded.base_url,
  is_active = excluded.is_active;

-- 3. Master Table: competitors
create table if not exists competitors (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  code text,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into competitors (name, code, description) values
  ('Godrej Security Solutions', 'GODREJ', 'Security equipment and safe vaults manufacturer'),
  ('Zicom Electronic Security', 'ZICOM', 'Electronic security systems and perimeter protection'),
  ('Hikvision India', 'HIKVISION', 'Video surveillance and access control solutions'),
  ('Honeywell India', 'HONEYWELL', 'Defence, aerospace, and physical security equipment'),
  ('CP PLUS (Aditya Infotech)', 'CPPLUS', 'Surveillance equipment and tactical communication'),
  ('Unknown / Unspecified', 'UNKNOWN', 'Unidentified portal competitor or consortium')
on conflict (name) do nothing;

-- 4. Master Table: region_mapping (state/city -> region -> zone)
create table if not exists region_mapping (
  id uuid primary key default gen_random_uuid(),
  state text not null,
  city text,
  region_id uuid references regions(id),
  zone_id uuid references zones(id),
  effective_from date not null default current_date,
  effective_to date,
  created_at timestamptz not null default now()
);

-- Seed region_mapping with defaults
insert into region_mapping (state, city, region_id, zone_id)
select 'Delhi', null, r.id, r.zone_id from regions r where r.name = 'Delhi NCR'
on conflict do nothing;

insert into region_mapping (state, city, region_id, zone_id)
select 'Punjab', null, r.id, r.zone_id from regions r where r.name = 'Punjab & Chandigarh'
on conflict do nothing;

insert into region_mapping (state, city, region_id, zone_id)
select 'Chandigarh', null, r.id, r.zone_id from regions r where r.name = 'Punjab & Chandigarh'
on conflict do nothing;

insert into region_mapping (state, city, region_id, zone_id)
select 'Haryana', null, r.id, r.zone_id from regions r where r.name = 'Haryana'
on conflict do nothing;

insert into region_mapping (state, city, region_id, zone_id)
select 'Rajasthan', null, r.id, r.zone_id from regions r where r.name = 'Rajasthan'
on conflict do nothing;

insert into region_mapping (state, city, region_id, zone_id)
select 'Uttar Pradesh', null, r.id, r.zone_id from regions r where r.name = 'Uttar Pradesh'
on conflict do nothing;

insert into region_mapping (state, city, region_id, zone_id)
select 'Assam', null, r.id, r.zone_id from regions r where r.name = 'Assam'
on conflict do nothing;

insert into region_mapping (state, city, region_id, zone_id)
select 'Meghalaya', null, r.id, r.zone_id from regions r where r.name = 'Meghalaya'
on conflict do nothing;

insert into region_mapping (state, city, region_id, zone_id)
select 'Mizoram', null, r.id, r.zone_id from regions r where r.name = 'Mizoram'
on conflict do nothing;

insert into region_mapping (state, city, region_id, zone_id)
select 'West Bengal', null, r.id, r.zone_id from regions r where r.name = 'West Bengal'
on conflict do nothing;

insert into region_mapping (state, city, region_id, zone_id)
select 'Bihar', null, r.id, r.zone_id from regions r where r.name = 'Bihar'
on conflict do nothing;

insert into region_mapping (state, city, region_id, zone_id)
select 'Maharashtra', null, r.id, r.zone_id from regions r where r.name = 'Maharashtra'
on conflict do nothing;

insert into region_mapping (state, city, region_id, zone_id)
select 'Karnataka', null, r.id, r.zone_id from regions r where r.name = 'Karnataka'
on conflict do nothing;

-- 5. Extend tender_statuses with missing lifecycle codes
insert into tender_statuses (code, label, sort_order, is_terminal, color) values
  ('PQ_NOT_QUALIFIED', 'PQ Not Qualified', 7, true, 'danger'),
  ('TECHNICALLY_DISQUALIFIED', 'Technically Disqualified', 10, true, 'danger'),
  ('REVERSE_AUCTION', 'Reverse Auction', 11, false, 'warning'),
  ('PARTIALLY_WON', 'Partially Won', 12, true, 'success'),
  ('ON_HOLD', 'On Hold', 14, false, 'warning'),
  ('NOT_SUBMITTED', 'Not Submitted', 15, true, 'danger')
on conflict (code) do update set
  label = excluded.label,
  sort_order = excluded.sort_order,
  is_terminal = excluded.is_terminal,
  color = excluded.color;

-- Ensure general and mha exist in tender_categories
insert into tender_categories (code, name, requires_pq, active, sort_order) values
  ('general', 'General Tender', false, true, 2),
  ('mha', 'MHA Tender', false, true, 3)
on conflict (code) do update set
  name = excluded.name,
  active = excluded.active,
  requires_pq = excluded.requires_pq;

-- 6. Document Checklist Templates per Category
create table if not exists document_checklist_templates (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references tender_categories(id) on delete cascade,
  category_code text,
  document_type text not null,
  is_mandatory boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

insert into document_checklist_templates (category_code, document_type, is_mandatory, sort_order) values
  ('pq', 'Tender Document / NIT', true, 1),
  ('pq', 'Eligibility & Financial Statements', true, 2),
  ('pq', 'Experience Certificates', true, 3),
  ('pq', 'OEM Authorisation', true, 4),
  ('pq', 'Compliance Sheet', true, 5),
  ('pq', 'EMD Proof / Exemption Certificate', true, 6),
  ('pq', 'GST / PAN Certificate', true, 7),
  ('pq', 'Signed Undertakings', true, 8),
  ('pq', 'Submission Receipt', true, 9),
  ('general', 'Tender Document / NIT', true, 1),
  ('general', 'Technical Bid', true, 2),
  ('general', 'Commercial Bid / BOQ', true, 3),
  ('general', 'OEM Authorisation', true, 4),
  ('general', 'Compliance Sheet', true, 5),
  ('general', 'EMD Proof', true, 6),
  ('general', 'Submission Receipt', true, 7),
  ('mha', 'Tender Document / NIT', true, 1),
  ('mha', 'MHA Compliance Undertaking', true, 2),
  ('mha', 'Technical Bid', true, 3),
  ('mha', 'OEM Authorisation', true, 4),
  ('mha', 'Security Clearance Documents', true, 5),
  ('mha', 'Submission Receipt', true, 6)
on conflict do nothing;

-- 7. Approval Rules & SLA Configuration
create table if not exists approval_rules (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references tender_categories(id),
  zone_id uuid references zones(id),
  min_value numeric not null default 0,
  max_value numeric,
  approver_role text not null default 'management',
  approver_id uuid references users(id),
  level integer not null default 1,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- 8. Approver User Delegations (Out-of-office delegation)
create table if not exists tender_user_delegations (
  id uuid primary key default gen_random_uuid(),
  delegator_id uuid not null references users(id) on delete cascade,
  delegatee_id uuid not null references users(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  reason text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- 9. Add columns to tenders table
alter table tenders add column if not exists internal_ref text;
alter table tenders add column if not exists portal_id uuid references tender_portals(id);
alter table tenders add column if not exists tender_portal_url text;
alter table tenders add column if not exists buyer_contact_id uuid references contacts(id);
alter table tenders add column if not exists tender_title text;
alter table tenders add column if not exists tender_category_id uuid references tender_categories(id);
alter table tenders add column if not exists tender_type text not null default 'Open';
alter table tenders add column if not exists zone_snapshot text;
alter table tenders add column if not exists region_snapshot text;
alter table tenders add column if not exists salesperson_id uuid references users(id);
alter table tenders add column if not exists original_submission_deadline timestamptz;
alter table tenders add column if not exists pre_bid_meeting_date timestamptz;
alter table tenders add column if not exists query_submission_deadline timestamptz;
alter table tenders add column if not exists technical_opening_date timestamptz;
alter table tenders add column if not exists commercial_opening_date timestamptz;
alter table tenders add column if not exists bid_validity_days integer;
alter table tenders add column if not exists emd_required boolean not null default false;
alter table tenders add column if not exists emd_amount numeric;
alter table tenders add column if not exists emd_mode text default 'Online';
alter table tenders add column if not exists emd_exemption_reason text;
alter table tenders add column if not exists tender_fee_amount numeric;
alter table tenders add column if not exists current_stage text default 'IDENTIFIED';
alter table tenders add column if not exists previous_stage text;
alter table tenders add column if not exists linked_pq_tender_id uuid references tenders(id);
alter table tenders add column if not exists priority text not null default 'Medium';
alter table tenders add column if not exists source text not null default 'Manual Entry';
alter table tenders add column if not exists custom_fields jsonb default '{}'::jsonb;

-- Backfill internal_ref for existing tenders
with numbered as (
  select id, 'TND-' || to_char(coalesce(created_at, now()), 'YYYY') || '-' || lpad((row_number() over (order by created_at))::text, 5, '0') as new_ref
  from tenders
)
update tenders
set internal_ref = numbered.new_ref
from numbered
where tenders.id = numbered.id and (tenders.internal_ref is null or tenders.internal_ref = '');

-- Add unique constraint on internal_ref
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'uq_tenders_internal_ref') then
    alter table tenders add constraint uq_tenders_internal_ref unique (internal_ref);
  end if;
end $$;

-- 10. Table: tender_line_items
create table if not exists tender_line_items (
  id uuid primary key default gen_random_uuid(),
  tender_id uuid not null references tenders(id) on delete cascade,
  product_id uuid references products(id) on delete set null,
  product_description text,
  quantity numeric not null default 1,
  unit text not null default 'Nos',
  specification_summary text,
  is_compliant text not null default 'Not Checked' check (is_compliant in ('Yes', 'No', 'Partial', 'Not Checked')),
  compliance_remarks text,
  quoted_unit_price numeric,
  quoted_total numeric,
  awarded boolean not null default false,
  awarded_quantity numeric,
  awarded_unit_price numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_tender_line_items_tid on tender_line_items(tender_id);

-- 11. Table: tender_documents
create table if not exists tender_documents (
  id uuid primary key default gen_random_uuid(),
  tender_id uuid not null references tenders(id) on delete cascade,
  document_type text not null,
  is_mandatory boolean not null default false,
  status text not null default 'Not Started' check (status in ('Not Started', 'In Progress', 'Ready', 'Not Applicable')),
  file_url text,
  file_name text,
  file_size bigint,
  mime_type text,
  version integer not null default 1,
  owner_id uuid references users(id),
  due_date date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_tender_documents_tid on tender_documents(tender_id);

-- 12. Table: tender_corrigenda
create table if not exists tender_corrigenda (
  id uuid primary key default gen_random_uuid(),
  tender_id uuid not null references tenders(id) on delete cascade,
  corrigendum_number text not null,
  issued_date date not null default current_date,
  summary text,
  old_deadline timestamptz not null,
  new_deadline timestamptz not null,
  attachment_url text,
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_tender_corrigenda_tid on tender_corrigenda(tender_id, created_at desc);

-- 13. Table: tender_financial_instruments (EMD, PBG, Fees)
create table if not exists tender_financial_instruments (
  id uuid primary key default gen_random_uuid(),
  tender_id uuid not null references tenders(id) on delete cascade,
  instrument_type text not null check (instrument_type in ('EMD', 'Tender Fee', 'PBG', 'Security Deposit')),
  amount numeric not null default 0,
  mode text not null default 'Online',
  reference_number text,
  bank text,
  issue_date date,
  expiry_date date,
  status text not null default 'Requested' check (status in ('Requested', 'Approved', 'Issued', 'Submitted', 'Refund Due', 'Refunded', 'Forfeited', 'Released', 'Expired')),
  finance_owner_id uuid references users(id),
  remarks text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_tender_fin_instruments_tid on tender_financial_instruments(tender_id);
create index if not exists idx_tender_fin_instruments_status on tender_financial_instruments(status);

-- 14. Table: tender_comments (replaces WhatsApp discussions)
create table if not exists tender_comments (
  id uuid primary key default gen_random_uuid(),
  tender_id uuid not null references tenders(id) on delete cascade,
  author_id uuid references users(id),
  body text not null,
  mentions jsonb not null default '[]'::jsonb,
  is_internal boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_tender_comments_tid on tender_comments(tender_id, created_at desc);

-- 15. Table: tender_assignment_history
create table if not exists tender_assignment_history (
  id uuid primary key default gen_random_uuid(),
  tender_id uuid not null references tenders(id) on delete cascade,
  role_type text not null,
  from_user_id uuid references users(id),
  to_user_id uuid references users(id),
  reason text,
  changed_by uuid references users(id),
  changed_at timestamptz not null default now()
);

create index if not exists idx_tender_assignment_history_tid on tender_assignment_history(tender_id, changed_at desc);

-- 16. Table: tender_approvals additions
alter table tender_approvals add column if not exists approval_round integer not null default 1;
alter table tender_approvals add column if not exists submitted_by uuid references users(id);
alter table tender_approvals add column if not exists submitted_at timestamptz not null default now();
alter table tender_approvals add column if not exists submission_note text;
alter table tender_approvals add column if not exists delegated_from_id uuid references users(id);
alter table tender_approvals add column if not exists decision text not null default 'Pending';
alter table tender_approvals add column if not exists decision_reason text;
alter table tender_approvals add column if not exists decided_at timestamptz;
alter table tender_approvals add column if not exists approval_conditions text;

-- 17. Table: tender_results additions
alter table tender_results add column if not exists result text;
alter table tender_results add column if not exists awarded_value numeric;
alter table tender_results add column if not exists awarded_line_items jsonb not null default '[]'::jsonb;
alter table tender_results add column if not exists order_number text;
alter table tender_results add column if not exists loa_number text;
alter table tender_results add column if not exists po_number text;
alter table tender_results add column if not exists loa_date date;
alter table tender_results add column if not exists pbg_required boolean not null default false;
alter table tender_results add column if not exists pbg_amount numeric;
alter table tender_results add column if not exists pbg_due_date date;
alter table tender_results add column if not exists loss_reason_detail text;
alter table tender_results add column if not exists competitor_id uuid references competitors(id);
alter table tender_results add column if not exists winning_price numeric;
alter table tender_results add column if not exists our_price numeric;
alter table tender_results add column if not exists our_rank text;
alter table tender_results add column if not exists lessons_learned text;
alter table tender_results add column if not exists recorded_by uuid references users(id);
alter table tender_results add column if not exists recorded_at timestamptz not null default now();

-- 18. Table: tender_portal_issues additions
alter table tender_portal_issues add column if not exists portal_id uuid references tender_portals(id);
alter table tender_portal_issues add column if not exists issue_description text;
alter table tender_portal_issues add column if not exists issue_category text;
alter table tender_portal_issues add column if not exists external_ticket_reference text;
alter table tender_portal_issues add column if not exists resolution_notes text;
alter table tender_portal_issues add column if not exists deadline_impact text not null default 'None';

-- 19. Table: products additions (GeM listing attributes)
alter table products add column if not exists gem_listed boolean not null default false;
alter table products add column if not exists gem_catalogue_id text;

-- 20. Update trigger function to auto-maintain snapshots, internal_ref, and auto-derive zone/region from state/city
create or replace function trg_tender_integrity_sync()
returns trigger as $$
declare
  matched_zone uuid;
  cat_code text;
  z_name text;
  r_name text;
  derived_region uuid;
  derived_zone uuid;
begin
  -- 1. Auto-generate internal_ref if missing
  if new.internal_ref is null or trim(new.internal_ref) = '' then
    new.internal_ref := generate_tender_internal_ref();
  end if;

  -- 2. Trim strings & handle empty strings
  if new.tender_number is not null then
    new.tender_number := trim(new.tender_number);
    if new.tender_number = '' then
      raise exception 'Tender number cannot be blank or whitespace only';
    end if;
  end if;

  if new.tender_no is not null then
    new.tender_no := trim(new.tender_no);
    if new.tender_no = '' then
      new.tender_no := new.tender_number;
    end if;
  end if;

  if new.tender_number is null and new.tender_no is not null then
    new.tender_number := new.tender_no;
  elsif new.tender_no is null and new.tender_number is not null then
    new.tender_no := new.tender_number;
  end if;

  if new.tender_title is null or trim(new.tender_title) = '' then
    new.tender_title := coalesce(new.requirement_text, new.tender_number, 'GeM Security Procurement');
  end if;

  if new.organisation is not null then
    new.organisation := trim(new.organisation);
    if new.organisation = '' then
      raise exception 'Organisation cannot be blank or whitespace only';
    end if;
  end if;

  if new.department is not null and trim(new.department) = '' then
    new.department := null;
  end if;

  if new.city is not null and trim(new.city) = '' then
    new.city := null;
  end if;

  if new.state is not null and trim(new.state) = '' then
    new.state := null;
  end if;

  -- Auto-derive region and zone from region_mapping if missing
  if (new.region_id is null or new.zone_id is null) and (new.state is not null or new.city is not null) then
    select rm.region_id, rm.zone_id into derived_region, derived_zone
    from region_mapping rm
    where (new.city is not null and lower(rm.city) = lower(new.city))
       or (rm.city is null and new.state is not null and lower(rm.state) = lower(new.state))
    order by (case when rm.city is not null then 1 else 2 end)
    limit 1;

    if derived_region is not null and new.region_id is null then
      new.region_id := derived_region;
    end if;
    if derived_zone is not null and new.zone_id is null then
      new.zone_id := derived_zone;
    end if;
  end if;

  -- 3. Sync category and category_id
  if new.category_id is not null and new.category is null then
    select code into cat_code from tender_categories where id = new.category_id;
    if cat_code in ('pq', 'general_mha', 'other') then
      new.category := cat_code::tender_category;
    end if;
  elsif new.category is not null and new.category_id is null then
    select id into new.category_id from tender_categories where code = new.category::text limit 1;
  end if;

  if new.tender_category_id is null and new.category_id is not null then
    new.tender_category_id := new.category_id;
  elsif new.category_id is null and new.tender_category_id is not null then
    new.category_id := new.tender_category_id;
  end if;

  -- 4. Sync owner and tender_owner_id
  if new.owner is not null and new.tender_owner_id is null then
    new.tender_owner_id := new.owner;
  elsif new.tender_owner_id is not null and new.owner is null then
    new.owner := new.tender_owner_id;
  end if;

  if new.assigned_person_id is null and new.assigned_to is not null then
    new.assigned_person_id := new.assigned_to;
  elsif new.assigned_to is null and new.assigned_person_id is not null then
    new.assigned_to := new.assigned_person_id;
  end if;

  if new.owner is null then
    new.owner := coalesce(new.created_by, new.assigned_to);
    new.tender_owner_id := new.owner;
  end if;

  -- 5. Zone and Region validation
  if new.region_id is not null then
    if new.zone_id is null then
      raise exception 'Region without zone is rejected. Please select the zone for this region.';
    end if;
    select zone_id into matched_zone from regions where id = new.region_id;
    if matched_zone is null or matched_zone <> new.zone_id then
      raise exception 'Selected region does not belong to the selected zone.';
    end if;
  end if;

  -- 6. Freeze snapshots at creation
  if TG_OP = 'INSERT' then
    if new.original_submission_deadline is null then
      new.original_submission_deadline := new.submission_deadline;
    end if;

    if new.zone_id is not null and (new.zone_snapshot is null or trim(new.zone_snapshot) = '') then
      select name into z_name from zones where id = new.zone_id;
      new.zone_snapshot := z_name;
    end if;

    if new.region_id is not null and (new.region_snapshot is null or trim(new.region_snapshot) = '') then
      select name into r_name from regions where id = new.region_id;
      new.region_snapshot := r_name;
    end if;
  end if;

  -- 7. Publication date vs submission deadline check
  if new.publication_date is not null and new.submission_deadline is not null then
    if (TG_OP = 'INSERT' or new.publication_date is distinct from old.publication_date or new.submission_deadline is distinct from old.submission_deadline) then
      if new.publication_date > new.submission_deadline::date then
        raise exception 'Submission deadline cannot be earlier than publication date';
      end if;
    end if;
  end if;

  -- 8. Block past deadline on insert unless historical/import
  if TG_OP = 'INSERT' and new.submission_deadline is not null then
    if new.submission_deadline < now() and (new.extra_fields is null or coalesce((new.extra_fields->>'is_historical')::boolean, false) = false) then
      raise exception 'Cannot create a tender with a submission deadline already in the past';
    end if;
  end if;

  -- 9. Status normalization & current_stage sync
  if new.status is not null then
    new.status := lower(trim(new.status));
    new.current_stage := upper(new.status);
  elsif new.current_stage is not null then
    new.current_stage := upper(trim(new.current_stage));
    new.status := lower(new.current_stage);
  else
    new.status := 'identified';
    new.current_stage := 'IDENTIFIED';
  end if;

  new.last_activity_at := now();
  return new;
end;
$$ language plpgsql;

-- 21. Trigger to log tender status changes automatically
create or replace function trg_tender_status_history_logger()
returns trigger as $$
begin
  if TG_OP = 'UPDATE' and old.status is distinct from new.status then
    insert into tender_status_history (
      tender_id,
      from_status,
      to_status,
      changed_by,
      remarks,
      created_at,
      changed_at
    ) values (
      new.id,
      upper(old.status),
      upper(new.status),
      coalesce(new.created_by, null),
      'Status transitioned from ' || upper(old.status) || ' to ' || upper(new.status),
      now(),
      now()
    );
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_tender_status_history_logger on tenders;
create trigger trg_tender_status_history_logger
after update on tenders
for each row execute function trg_tender_status_history_logger();
