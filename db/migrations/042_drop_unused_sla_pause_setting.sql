-- =====================================================================
-- Migration 042: drop the unused `sla_pause_statuses` service setting
--
-- Migration 018 seeded it as ["awaiting_customer", "awaiting_part"], but nothing ever read it: the SLA clock
-- pauses on the shared SERVICE_SLA_PAUSE_STATUSES (awaiting_part, awaiting_customer, on_hold), which the desk's
-- filters, KPIs and sweeps all use. A setting that looks editable but changes nothing (and disagrees with the
-- code on on_hold) only misleads, so it goes.
-- Idempotent: safe to re-run.
-- =====================================================================

delete from service_settings where key = 'sla_pause_statuses';
