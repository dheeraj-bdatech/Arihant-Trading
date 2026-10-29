-- Reverts 041_tender_deadline_ist_day.sql: restores the trigger function as migration 019 defined it.

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
