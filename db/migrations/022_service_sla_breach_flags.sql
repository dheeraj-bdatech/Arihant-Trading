-- Migration 022: separate notification flags so response and resolution SLA breaches each alert once
ALTER TABLE service_tickets
  ADD COLUMN IF NOT EXISTS sla_response_breach_notified_at timestamptz,
  ADD COLUMN IF NOT EXISTS sla_resolution_breach_notified_at timestamptz;
UPDATE service_tickets SET sla_resolution_breach_notified_at = sla_breach_notified_at WHERE sla_breach_notified_at IS NOT NULL AND sla_resolution_breach_notified_at IS NULL;
