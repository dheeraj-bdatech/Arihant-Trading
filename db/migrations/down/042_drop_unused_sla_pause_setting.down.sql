-- Reverts 042_drop_unused_sla_pause_setting.sql: restores the setting row as migration 018 seeded it.

insert into service_settings (key, value, description)
values ('sla_pause_statuses', '["awaiting_customer", "awaiting_part"]'::jsonb, 'Statuses that pause the SLA calculation clock')
on conflict (key) do nothing;
