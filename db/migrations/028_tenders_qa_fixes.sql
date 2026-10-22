-- =====================================================================
-- Migration 028: Module 4 — Tender QA fixes (DEF-001, DEF-009, DEF-018, DEF-033, DEF-035, DEF-090)
--
--   1. internal_ref (DEF-001): tender_internal_ref_seq had fallen behind refs back-filled by 019 / imported rows, so
--      every registration hit "Key (internal_ref)=(TND-2026-00001) already exists". The sequence is moved past the
--      highest numeric suffix in use, and generate_tender_internal_ref() now skips any reference already taken, so the
--      trigger fallback can never collide again. (The API also allocates refs from max(internal_ref) and retries.)
--   2. Stale approval requests (DEF-035, DEF-090): tender_approvals rows still PENDING on tenders that are no longer
--      Awaiting Internal Approval (seeded by 007, or left behind before the ledger was kept in step with the stage) are
--      closed as WITHDRAWN, so a won/lost tender never shows an open approval round.
--   3. Money / quantity sanity (DEF-009, DEF-018, DEF-033): CHECK constraints so line items, instruments and tender
--      values can never be negative. Added NOT VALID (enforced for new writes without failing on legacy rows).
--
-- Idempotent: safe to re-run.
-- =====================================================================

-- 1. internal_ref sequence resync + collision-safe generator ------------------------------------------------------
create sequence if not exists tender_internal_ref_seq start with 1 increment by 1;

do $$
declare
  max_used bigint;
begin
  select coalesce(max(substring(internal_ref from '([0-9]+)$')::bigint), 0)
    into max_used
    from tenders
   where internal_ref ~ '^TND-[0-9]{4}-[0-9]+$';

  -- setval(..., true): the next nextval() returns max_used + 1. Never moves the sequence backwards.
  if max_used > 0 then
    perform setval('tender_internal_ref_seq', greatest(max_used, (select last_value from tender_internal_ref_seq)), true);
  end if;
end $$;

create or replace function generate_tender_internal_ref()
returns text as $$
declare
  curr_year text := to_char((now() at time zone 'Asia/Kolkata')::date, 'YYYY');
  candidate text;
  attempts int := 0;
begin
  loop
    candidate := 'TND-' || curr_year || '-' || lpad(nextval('tender_internal_ref_seq')::text, 5, '0');
    exit when not exists (select 1 from tenders where internal_ref = candidate);
    attempts := attempts + 1;
    if attempts > 10000 then
      raise exception 'Could not allocate a free tender internal reference';
    end if;
  end loop;
  return candidate;
end;
$$ language plpgsql;

-- 2. Close approval requests left PENDING on tenders that are not awaiting approval -------------------------------
update tender_approvals a
   set status = 'WITHDRAWN',
       decision = 'Withdrawn',
       decision_reason = coalesce(a.decision_reason, 'Closed without a decision: tender is no longer awaiting approval'),
       responded_at = coalesce(a.responded_at, now()),
       decided_at = coalesce(a.decided_at, now()),
       updated_at = now()
  from tenders t
 where t.id = a.tender_id
   and a.status = 'PENDING'
   and (t.status <> 'awaiting_approval' or t.is_deleted = true);

-- 3. Non-negative money / positive quantities (NOT VALID: new writes only) ----------------------------------------
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'chk_tender_line_items_quantity_positive') then
    alter table tender_line_items add constraint chk_tender_line_items_quantity_positive
      check (quantity is null or quantity >= 1) not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'chk_tender_line_items_prices_non_negative') then
    alter table tender_line_items add constraint chk_tender_line_items_prices_non_negative
      check (
        (quoted_unit_price is null or quoted_unit_price >= 0)
        and (quoted_total is null or quoted_total >= 0)
        and (awarded_quantity is null or awarded_quantity >= 0)
        and (awarded_unit_price is null or awarded_unit_price >= 0)
      ) not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'chk_tender_financial_instruments_amount_positive') then
    alter table tender_financial_instruments add constraint chk_tender_financial_instruments_amount_positive
      check (amount is null or amount > 0) not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'chk_tenders_estimated_value_non_negative') then
    alter table tenders add constraint chk_tenders_estimated_value_non_negative
      check (estimated_value is null or estimated_value >= 0) not valid;
  end if;
end $$;
