-- Reverts 044_repeat_complaint_window_90_days.sql: back to the 30-day seed (only where 044 set 90).

update service_settings
   set value = '30'::jsonb, updated_at = now()
 where key = 'repeat_complaint_window_days' and value = '90'::jsonb;
