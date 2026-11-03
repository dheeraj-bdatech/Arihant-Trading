-- =====================================================================
-- ARIHANT BOS — MODULE 5: PROPOSAL MANAGEMENT ENHANCEMENTS MIGRATION
-- (006_proposal_management.sql)
-- =====================================================================

-- 1. Create a sequence for human-readable proposal numbers (PROP-2026-1001, etc.)
create sequence if not exists proposal_no_seq start with 1001;

-- 2. Enhance proposals table
alter table proposals add column if not exists proposal_number text unique default ('PROP-2026-' || lpad(nextval('proposal_no_seq')::text, 4, '0'));
alter table proposals add column if not exists approved_at timestamptz;
alter table proposals add column if not exists approved_by uuid references users(id) on delete set null;
alter table proposals add column if not exists last_followup date;
alter table proposals add column if not exists outcome text;
alter table proposals add column if not exists lost_reason text;
alter table proposals add column if not exists lost_remarks text;
alter table proposals add column if not exists converted_to text;
alter table proposals add column if not exists converted_reference text;
alter table proposals add column if not exists created_by uuid references users(id) on delete set null;
alter table proposals add column if not exists updated_by uuid references users(id) on delete set null;
alter table proposals add column if not exists is_deleted boolean not null default false;
alter table proposals add column if not exists deleted_at timestamptz;
alter table proposals add column if not exists deleted_by uuid references users(id) on delete set null;

-- Backfill proposal_number for any existing records
update proposals
  set proposal_number = 'PROP-2026-' || lpad(nextval('proposal_no_seq')::text, 4, '0')
  where proposal_number is null;

-- Standardize status enum values to uppercase
update proposals set status = 'PROPOSAL_REQUESTED' where status in ('requested', 'PROPOSAL_REQUESTED');
update proposals set status = 'UNDER_PREPARATION' where status in ('under_preparation', 'UNDER_PREPARATION');
update proposals set status = 'READY_FOR_REVIEW' where status in ('ready_for_review', 'READY_FOR_REVIEW');
update proposals set status = 'APPROVED' where status in ('approved', 'APPROVED');
update proposals set status = 'SENT_TO_CUSTOMER' where status in ('sent', 'SENT_TO_CUSTOMER');
update proposals set status = 'FOLLOW_UP_REQUIRED' where status in ('followup_required', 'FOLLOW_UP_REQUIRED');
update proposals set status = 'CONVERTED' where status in ('converted', 'CONVERTED');
update proposals set status = 'CLOSED' where status in ('closed', 'CLOSED');
update proposals set status = 'LOST' where status in ('lost', 'LOST');

-- 3. Create proposal_followups table
create table if not exists proposal_followups (
  id                  uuid primary key default gen_random_uuid(),
  proposal_id         uuid not null references proposals(id) on delete cascade,
  followup_date       date not null default current_date,
  owner_id            uuid not null references users(id),
  remarks             text not null,
  outcome             text,
  next_followup_date  date,
  created_by          uuid references users(id) on delete set null,
  created_at          timestamptz not null default now()
);

-- 4. Create proposal_activities table
create table if not exists proposal_activities (
  id                  uuid primary key default gen_random_uuid(),
  proposal_id         uuid not null references proposals(id) on delete cascade,
  action              text not null,
  old_value           text,
  new_value           text,
  performed_by        uuid references users(id) on delete set null,
  metadata            jsonb default '{}'::jsonb,
  created_at          timestamptz not null default now()
);

-- 5. Link interactions to proposals
alter table interactions add column if not exists proposal_id uuid references proposals(id) on delete set null;

-- 6. Indexes for queries, searches, and follow-up alert dashboard
create index if not exists idx_proposals_proposal_number on proposals(proposal_number);
create index if not exists idx_proposals_status on proposals(status);
create index if not exists idx_proposals_org_id on proposals(organisation_id);
create index if not exists idx_proposals_product_id on proposals(product_id);
create index if not exists idx_proposals_responsible_id on proposals(responsible_id);
create index if not exists idx_proposals_followup_owner_id on proposals(followup_owner_id);
create index if not exists idx_proposals_next_followup on proposals(next_followup);
create index if not exists idx_proposals_request_date on proposals(request_date);
create index if not exists idx_proposals_required_date on proposals(required_date);
create index if not exists idx_proposals_updated_at on proposals(updated_at desc);
create index if not exists idx_proposals_status_followup on proposals(status, next_followup) where is_deleted = false;
create index if not exists idx_proposal_followups_proposal_id on proposal_followups(proposal_id, followup_date desc);
create index if not exists idx_proposal_activities_proposal_id on proposal_activities(proposal_id, created_at desc);

-- 7. Seed 20 realistic proposals covering all statuses, due today, overdue, upcoming, missing follow-up, and old inactive proposals
do $$
declare
  org_bsf uuid;
  org_cisf uuid;
  org_crpf uuid;
  org_railway uuid;
  org_apollo uuid;
  org_itbp uuid;

  prod_dfmd uuid;
  prod_hhmd uuid;
  prod_xbis uuid;
  prod_thermal uuid;
  prod_under_vehicle uuid;

  user_mgmt uuid;
  user_rm uuid;
  user_amit uuid;
  user_vikram uuid;
  user_priya uuid;

  p_id uuid;
  prop_count int;
begin
  select count(*) into prop_count from proposals;

  -- Only seed if we currently have the initial baseline (<= 2 proposals) and the customers / products / users the
  -- demo proposals point at (an empty database, e.g. CI building from scratch, has none: the seed script adds them)
  if prop_count <= 2
     and exists (select 1 from organisations)
     and exists (select 1 from products)
     and exists (select 1 from users) then
    -- Retrieve reference organisations
    select id into org_bsf from organisations where name ilike '%BSF%' limit 1;
    select id into org_cisf from organisations where name ilike '%CISF%' limit 1;
    select id into org_crpf from organisations where name ilike '%CRPF%' limit 1;
    select id into org_railway from organisations where name ilike '%Railway%' or name ilike '%Northern%' limit 1;
    select id into org_apollo from organisations where name ilike '%Apollo%' or name ilike '%Hospital%' limit 1;
    select id into org_itbp from organisations where name ilike '%ITBP%' or name ilike '%Police%' limit 1;

    -- Fallbacks if specific orgs not found
    if org_bsf is null then select id into org_bsf from organisations limit 1; end if;
    if org_cisf is null then org_cisf := org_bsf; end if;
    if org_crpf is null then org_crpf := org_bsf; end if;
    if org_railway is null then org_railway := org_cisf; end if;
    if org_apollo is null then org_apollo := org_bsf; end if;
    if org_itbp is null then org_itbp := org_cisf; end if;

    -- Retrieve reference products
    select id into prod_dfmd from products where name ilike '%Door Frame%' or name ilike '%DFMD%' limit 1;
    select id into prod_hhmd from products where name ilike '%Hand Held%' or name ilike '%HHMD%' limit 1;
    select id into prod_xbis from products where name ilike '%X ray%' or name ilike '%Baggage%' limit 1;
    select id into prod_thermal from products where name ilike '%Thermal%' limit 1;
    select id into prod_under_vehicle from products where name ilike '%Vehicle%' or name ilike '%Under%' limit 1;

    if prod_dfmd is null then select id into prod_dfmd from products limit 1; end if;
    if prod_hhmd is null then prod_hhmd := prod_dfmd; end if;
    if prod_xbis is null then prod_xbis := prod_dfmd; end if;
    if prod_thermal is null then prod_thermal := prod_dfmd; end if;
    if prod_under_vehicle is null then prod_under_vehicle := prod_dfmd; end if;

    -- Retrieve reference users
    select id into user_mgmt from users where role = 'management' limit 1;
    select id into user_rm from users where role = 'regional_manager' limit 1;
    select id into user_amit from users where email like 'sales.delhi%' or role = 'sales' limit 1;
    select id into user_vikram from users where role = 'sales' and id != user_amit limit 1;
    select id into user_priya from users where role in ('tender_team', 'sales', 'management') and id != user_amit limit 1;

    if user_mgmt is null then select id into user_mgmt from users limit 1; end if;
    if user_rm is null then user_rm := user_mgmt; end if;
    if user_amit is null then user_amit := user_mgmt; end if;
    if user_vikram is null then user_vikram := user_amit; end if;
    if user_priya is null then user_priya := user_amit; end if;

    -- 1. PROPOSAL_REQUESTED (2 items)
    insert into proposals (
      proposal_number, organisation_id, product_id, sector, requested_by, responsible_id,
      followup_owner_id, request_date, required_date, version, reference, status, remarks,
      created_by, updated_by, created_at, updated_at
    ) values
      ('PROP-2026-1003', org_crpf, prod_dfmd, 'Police / Paramilitary', user_amit, user_amit,
       user_amit, current_date - 2, current_date + 5, 'v1.0', 'CRPF/HQ/PROC/2026/091', 'PROPOSAL_REQUESTED', 'Initial RFP received for 12 multi-zone DFMDs for Srinagar transit camp.',
       user_amit, user_amit, now() - interval '2 days', now() - interval '2 days'),
      ('PROP-2026-1004', org_railway, prod_xbis, 'Infrastructure', user_vikram, user_vikram,
       user_vikram, current_date - 1, current_date + 7, 'v1.0', 'NR/SECURITY/2026/XR-44', 'PROPOSAL_REQUESTED', 'Station modernization proposal request for Anand Vihar Terminal.',
       user_vikram, user_vikram, now() - interval '1 day', now() - interval '1 day')
    on conflict (proposal_number) do nothing;

    -- 2. UNDER_PREPARATION (3 items - including 1 old proposal without movement > 7 days)
    insert into proposals (
      proposal_number, organisation_id, product_id, sector, requested_by, responsible_id,
      followup_owner_id, request_date, required_date, version, reference, status, remarks,
      created_by, updated_by, created_at, updated_at
    ) values
      ('PROP-2026-1005', org_bsf, prod_hhmd, 'Defence', user_amit, user_amit,
       user_amit, current_date - 5, current_date + 3, 'v1.1', 'BSF/SHQ/DEL/2026/112', 'UNDER_PREPARATION', 'Drafting technical compliance sheet per MHA QR Q2 standard.',
       user_amit, user_amit, now() - interval '5 days', now() - interval '1 day'),
      ('PROP-2026-1006', org_apollo, prod_thermal, 'Healthcare', user_priya, user_priya,
       user_priya, current_date - 4, current_date + 4, 'v1.0', 'APOLLO/PUR/SEC/2026/88', 'UNDER_PREPARATION', 'Commercial terms with 2-year comprehensive AMC in review.',
       user_priya, user_priya, now() - interval '4 days', now() - interval '2 days'),
      ('PROP-2026-1007', org_cisf, prod_under_vehicle, 'Police / Paramilitary', user_amit, user_amit,
       user_amit, current_date - 14, current_date - 2, 'v1.0', 'CISF/AVS/2026/009', 'UNDER_PREPARATION', 'Delayed waiting on civil works drawing from CISF engineers (Old Inactive).',
       user_amit, user_amit, now() - interval '14 days', now() - interval '9 days')
    on conflict (proposal_number) do nothing;

    -- 3. READY_FOR_REVIEW (2 items)
    insert into proposals (
      proposal_number, organisation_id, product_id, sector, requested_by, responsible_id,
      followup_owner_id, request_date, required_date, version, reference, status, remarks,
      created_by, updated_by, created_at, updated_at
    ) values
      ('PROP-2026-1008', org_cisf, prod_dfmd, 'Police / Paramilitary', user_amit, user_amit,
       user_amit, current_date - 6, current_date + 1, 'v1.0', 'ATC/CISF/REV/2026/301', 'READY_FOR_REVIEW', 'Completed commercial costing. Submitted to Regional Manager for final discount clearance.',
       user_amit, user_amit, now() - interval '6 days', now() - interval '4 hours'),
      ('PROP-2026-1009', org_bsf, prod_xbis, 'Defence', user_vikram, user_vikram,
       user_vikram, current_date - 7, current_date + 2, 'v1.2', 'BSF/DG/2026/XBIS-09', 'READY_FOR_REVIEW', 'Awaiting management sign-off on payment milestone terms (90/10 vs 80/20).',
       user_vikram, user_vikram, now() - interval '7 days', now() - interval '6 hours')
    on conflict (proposal_number) do nothing;

    -- 4. APPROVED (2 items)
    insert into proposals (
      proposal_number, organisation_id, product_id, sector, requested_by, responsible_id,
      followup_owner_id, request_date, required_date, version, reference, status, approved_at, approved_by, remarks,
      created_by, updated_by, created_at, updated_at
    ) values
      ('PROP-2026-1010', org_railway, prod_dfmd, 'Infrastructure', user_amit, user_amit,
       user_amit, current_date - 8, current_date - 1, 'v1.0', 'NR/HQ/PROP/2026/512', 'APPROVED', now() - interval '1 day', user_rm, 'Approved by Regional Manager with 4% bulk order discount applied.',
       user_amit, user_rm, now() - interval '8 days', now() - interval '1 day'),
      ('PROP-2026-1011', org_crpf, prod_thermal, 'Defence', user_priya, user_priya,
       user_priya, current_date - 5, current_date + 1, 'v1.0', 'CRPF/VALLEY/2026/TH-11', 'APPROVED', now() - interval '3 hours', user_mgmt, 'Management approval granted for special expeditionary dispatch warranty.',
       user_priya, user_mgmt, now() - interval '5 days', now() - interval '3 hours')
    on conflict (proposal_number) do nothing;

    -- 5. SENT_TO_CUSTOMER (4 items - 1 due today, 1 overdue, 1 missing follow-up, 1 upcoming)
    insert into proposals (
      proposal_number, organisation_id, product_id, sector, requested_by, responsible_id,
      followup_owner_id, request_date, required_date, sent_date, approved_at, approved_by,
      version, reference, status, next_followup, last_followup, remarks,
      created_by, updated_by, created_at, updated_at
    ) values
      -- Sent, follow-up DUE TODAY
      ('PROP-2026-1012', org_bsf, prod_hhmd, 'Defence', user_amit, user_amit,
       user_amit, current_date - 10, current_date - 6, current_date - 5, now() - interval '6 days', user_rm,
       'v1.2', 'ATC/BSF/2026/092', 'SENT_TO_CUSTOMER', current_date, current_date - 5, 'Follow-up scheduled for today with Dy. Commandant Stores.',
       user_amit, user_amit, now() - interval '10 days', now() - interval '1 day'),

      -- Sent, follow-up OVERDUE (next_followup was 2 days ago)
      ('PROP-2026-1013', org_cisf, prod_dfmd, 'Police / Paramilitary', user_amit, user_amit,
       user_amit, current_date - 12, current_date - 8, current_date - 7, now() - interval '8 days', user_rm,
       'v1.0', 'ATC/CISF/2026/104', 'SENT_TO_CUSTOMER', current_date - 2, current_date - 7, 'Proposal dispatched by email. Overdue follow-up for committee tender date.',
       user_amit, user_amit, now() - interval '12 days', now() - interval '2 days'),

      -- Sent, MISSING follow-up (next_followup IS NULL)
      ('PROP-2026-1014', org_railway, prod_xbis, 'Infrastructure', user_vikram, user_vikram,
       user_vikram, current_date - 9, current_date - 4, current_date - 3, now() - interval '5 days', user_mgmt,
       'v1.0', 'NR/DIV/2026/XR-08', 'SENT_TO_CUSTOMER', null, null, 'Sent via GeM portal custom bidding quote. Needs follow-up date assigned.',
       user_vikram, user_vikram, now() - interval '9 days', now() - interval '3 days'),

      -- Sent, UPCOMING follow-up
      ('PROP-2026-1015', org_apollo, prod_dfmd, 'Healthcare', user_priya, user_priya,
       user_priya, current_date - 6, current_date - 2, current_date - 1, now() - interval '2 days', user_rm,
       'v1.0', 'APOLLO/DEL/2026/19', 'SENT_TO_CUSTOMER', current_date + 4, current_date - 1, 'Sent commercial offer to Apollo procurement director.',
       user_priya, user_priya, now() - interval '6 days', now() - interval '1 day')
    on conflict (proposal_number) do nothing;

    -- 6. FOLLOW_UP_REQUIRED (3 items - 1 due today, 1 overdue, 1 old inactive)
    insert into proposals (
      proposal_number, organisation_id, product_id, sector, requested_by, responsible_id,
      followup_owner_id, request_date, required_date, sent_date, approved_at, approved_by,
      version, reference, status, next_followup, last_followup, remarks,
      created_by, updated_by, created_at, updated_at
    ) values
      -- Due today
      ('PROP-2026-1016', org_crpf, prod_under_vehicle, 'Police / Paramilitary', user_amit, user_amit,
       user_amit, current_date - 15, current_date - 10, current_date - 8, now() - interval '9 days', user_rm,
       'v1.1', 'CRPF/SEC/2026/UV-03', 'FOLLOW_UP_REQUIRED', current_date, current_date - 3, 'Client requested revised payment milestones. Call scheduled today.',
       user_amit, user_amit, now() - interval '15 days', now() - interval '1 day'),

      -- Overdue (next_followup was 3 days ago)
      ('PROP-2026-1017', org_itbp, prod_hhmd, 'Police / Paramilitary', user_vikram, user_vikram,
       user_vikram, current_date - 18, current_date - 14, current_date - 12, now() - interval '13 days', user_rm,
       'v1.0', 'ITBP/PROC/2026/HH-29', 'FOLLOW_UP_REQUIRED', current_date - 3, current_date - 7, 'Overdue clarification regarding warranty support in Leh/Ladakh.',
       user_vikram, user_vikram, now() - interval '18 days', now() - interval '3 days'),

      -- Old Inactive (> 7 days without update)
      ('PROP-2026-1018', org_railway, prod_dfmd, 'Infrastructure', user_amit, user_amit,
       user_amit, current_date - 25, current_date - 20, current_date - 18, now() - interval '19 days', user_mgmt,
       'v1.0', 'NR/ZONE/2026/DF-40', 'FOLLOW_UP_REQUIRED', current_date - 8, current_date - 14, 'Customer delayed decision pending railway board budget approval. No activity in 8 days.',
       user_amit, user_amit, now() - interval '25 days', now() - interval '8 days')
    on conflict (proposal_number) do nothing;

    -- 7. CONVERTED (2 items)
    insert into proposals (
      proposal_number, organisation_id, product_id, sector, requested_by, responsible_id,
      followup_owner_id, request_date, required_date, sent_date, approved_at, approved_by,
      version, reference, status, outcome, converted_to, converted_reference, next_followup, last_followup, remarks,
      created_by, updated_by, created_at, updated_at
    ) values
      ('PROP-2026-1019', org_bsf, prod_dfmd, 'Defence', user_amit, user_amit,
       user_amit, current_date - 30, current_date - 25, current_date - 22, now() - interval '24 days', user_rm,
       'v1.2', 'ATC/BSF/2026/088', 'CONVERTED', 'CONVERTED', 'Purchase Order #PO-BSF-2026-881', 'GeM Contract GEMC-5116877', null, current_date - 5, 'Client issued firm Purchase Order for 8 DFMDs.',
       user_amit, user_amit, now() - interval '30 days', now() - interval '5 days'),
      ('PROP-2026-1020', org_apollo, prod_hhmd, 'Healthcare', user_priya, user_priya,
       user_priya, current_date - 20, current_date - 16, current_date - 15, now() - interval '15 days', user_mgmt,
       'v1.0', 'APOLLO/PO/2026/012', 'CONVERTED', 'CONVERTED', 'Order #ORD-2026-094', 'Direct Commercial Agreement', null, current_date - 4, 'Converted into 3-year supply and maintenance contract.',
       user_priya, user_priya, now() - interval '20 days', now() - interval '4 days')
    on conflict (proposal_number) do nothing;

    -- 8. CLOSED (1 item)
    insert into proposals (
      proposal_number, organisation_id, product_id, sector, requested_by, responsible_id,
      followup_owner_id, request_date, required_date, sent_date, approved_at, approved_by,
      version, reference, status, outcome, next_followup, last_followup, remarks,
      created_by, updated_by, created_at, updated_at
    ) values
      ('PROP-2026-1021', org_cisf, prod_xbis, 'Police / Paramilitary', user_amit, user_amit,
       user_amit, current_date - 35, current_date - 30, current_date - 28, now() - interval '29 days', user_rm,
       'v1.0', 'CISF/DEL/2026/XB-01', 'CLOSED', 'CLOSED', null, current_date - 10, 'Tender was re-floated with changed technical parameters. Closed to submit fresh proposal.',
       user_amit, user_amit, now() - interval '35 days', now() - interval '10 days')
    on conflict (proposal_number) do nothing;

    -- 9. LOST (1 item with lost_reason and lost_remarks)
    insert into proposals (
      proposal_number, organisation_id, product_id, sector, requested_by, responsible_id,
      followup_owner_id, request_date, required_date, sent_date, approved_at, approved_by,
      version, reference, status, outcome, lost_reason, lost_remarks, next_followup, last_followup, remarks,
      created_by, updated_by, created_at, updated_at
    ) values
      ('PROP-2026-1022', org_itbp, prod_thermal, 'Police / Paramilitary', user_vikram, user_vikram,
       user_vikram, current_date - 28, current_date - 22, current_date - 20, now() - interval '21 days', user_rm,
       'v1.1', 'ITBP/HQ/2026/TH-55', 'LOST', 'LOST', 'Price', 'Competitor Godrej quoted 12% lower on commercial evaluation.', null, current_date - 6, 'L1 bidder selected on price criteria.',
       user_vikram, user_vikram, now() - interval '28 days', now() - interval '6 days')
    on conflict (proposal_number) do nothing;

    -- Seed activities for key proposals
    select id into p_id from proposals where proposal_number = 'PROP-2026-1012';
    if p_id is not null then
      insert into proposal_activities (proposal_id, action, old_value, new_value, performed_by, metadata, created_at)
      values
        (p_id, 'CREATED', null, 'Proposal Created', user_amit, '{"proposal_number":"PROP-2026-1012"}'::jsonb, now() - interval '10 days'),
        (p_id, 'STATUS_CHANGE', 'PROPOSAL_REQUESTED', 'UNDER_PREPARATION', user_amit, '{"reason":"Preparation started"}'::jsonb, now() - interval '8 days'),
        (p_id, 'STATUS_CHANGE', 'UNDER_PREPARATION', 'READY_FOR_REVIEW', user_amit, '{"reason":"Ready for RM review"}'::jsonb, now() - interval '7 days'),
        (p_id, 'STATUS_CHANGE', 'READY_FOR_REVIEW', 'APPROVED', user_rm, '{"approved_by":"Regional Manager"}'::jsonb, now() - interval '6 days'),
        (p_id, 'STATUS_CHANGE', 'APPROVED', 'SENT_TO_CUSTOMER', user_amit, '{"sent_date":"2026-09-16"}'::jsonb, now() - interval '5 days');

      insert into proposal_followups (proposal_id, followup_date, owner_id, remarks, outcome, next_followup_date, created_by, created_at)
      values
        (p_id, current_date - 5, user_amit, 'Confirmed proposal document received by BSF procurement desk.', 'Positive acknowledge', current_date, user_amit, now() - interval '5 days');
    end if;

    select id into p_id from proposals where proposal_number = 'PROP-2026-1019';
    if p_id is not null then
      insert into proposal_activities (proposal_id, action, old_value, new_value, performed_by, metadata, created_at)
      values
        (p_id, 'CREATED', null, 'Proposal Created', user_amit, '{"proposal_number":"PROP-2026-1019"}'::jsonb, now() - interval '30 days'),
        (p_id, 'STATUS_CHANGE', 'APPROVED', 'SENT_TO_CUSTOMER', user_amit, '{"sent_date":"2026-08-30"}'::jsonb, now() - interval '22 days'),
        (p_id, 'STATUS_CHANGE', 'SENT_TO_CUSTOMER', 'CONVERTED', user_amit, '{"converted_to":"PO-BSF-2026-881"}'::jsonb, now() - interval '5 days');

      insert into proposal_followups (proposal_id, followup_date, owner_id, remarks, outcome, next_followup_date, created_by, created_at)
      values
        (p_id, current_date - 15, user_amit, 'Meeting at BSF HQ with procurement committee.', 'Requested sample demo confirmation', current_date - 8, user_amit, now() - interval '15 days'),
        (p_id, current_date - 8, user_amit, 'Final price negotiation completed. Standard discount accepted.', 'PO issue committed', null, user_amit, now() - interval '8 days');
    end if;

  end if;

  -- Ensure sequence is synchronized past any existing proposal numbers
  perform setval('proposal_no_seq', coalesce((select max(substring(proposal_number from 11)::int) from proposals), 1000));
end $$;
