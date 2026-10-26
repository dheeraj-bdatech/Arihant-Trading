-- Reverts 037_drop_tender_status_history_trigger.sql: restores the 019 trigger as it was.

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
