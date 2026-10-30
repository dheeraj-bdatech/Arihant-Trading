-- =====================================================================
-- Migration 044: a repeat complaint is the same machine failing again within 90 days
--
-- The after-sales spec (§5) uses a 90-day window; migration 018 seeded 30. Only the untouched seed value moves: a
-- window management has already changed in Settings stays as they set it.
-- Idempotent: safe to re-run.
-- =====================================================================

update service_settings
   set value = '90'::jsonb, updated_at = now()
 where key = 'repeat_complaint_window_days' and value = '30'::jsonb;
