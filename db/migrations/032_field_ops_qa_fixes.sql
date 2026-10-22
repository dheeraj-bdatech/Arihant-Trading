-- =====================================================================
-- Migration 032: Field operations QA fixes (Service: DEF-066, DEF-110)
--
-- 1. Ticket numbers (DEF-066): the system series is TCK-YYYY-NNNNNN (6 digits, from service_ticket_no_seq which
--    starts at 100001). Older / seeded tickets carry short numbers such as TCK-2026-167. They are zero-padded to the
--    same 6-digit form (TCK-2026-000167); the padded value can never collide with a sequence number (>= 100001),
--    and a row is skipped if its padded form is somehow already taken. Customer references (GEM-INC-…) are untouched.
--
-- 2. SLA due dates (DEF-110): tickets inserted without SLA deadlines (seed / legacy imports) could never count as
--    "SLA breached". Missing deadlines are filled from the configured sla_rules (priority × coverage, falling back
--    to in_warranty, then to the built-in defaults critical 2/8h, high 4/24h, medium 8/48h, low 24/72h), counted in
--    wall-clock hours from 09:00 IST on the day the complaint was received (or the creation time when that is
--    earlier). Rows that already have deadlines are not changed.
--
-- Idempotent: safe to re-run (both updates only touch rows that still need them).
-- =====================================================================

-- 1. Zero-pad short system ticket numbers
UPDATE service_tickets t
SET ticket_no = sub.padded,
    ticket_number = CASE WHEN t.ticket_number IS NULL OR t.ticket_number = t.ticket_no THEN sub.padded ELSE t.ticket_number END
FROM (
  SELECT id,
         'TCK-' || substring(ticket_no from '^TCK-(\d{4})-') || '-' || lpad(substring(ticket_no from '^TCK-\d{4}-(\d{1,5})$'), 6, '0') AS padded
  FROM service_tickets
  WHERE ticket_no ~ '^TCK-\d{4}-\d{1,5}$'
) sub
WHERE t.id = sub.id
  AND NOT EXISTS (
    SELECT 1 FROM service_tickets o
    WHERE o.id <> t.id AND (o.ticket_no = sub.padded OR o.ticket_number = sub.padded)
  );

-- 2. Backfill missing SLA deadlines
WITH base AS (
  SELECT t.id,
         LEAST(t.created_at, COALESCE((t.received_date::timestamp + interval '9 hours') AT TIME ZONE 'Asia/Kolkata', t.created_at)) AS clock_start,
         COALESCE(r.response_hours, ri.response_hours,
           CASE t.priority WHEN 'critical' THEN 2 WHEN 'high' THEN 4 WHEN 'low' THEN 24 ELSE 8 END) AS response_hours,
         COALESCE(r.resolution_hours, ri.resolution_hours,
           CASE t.priority WHEN 'critical' THEN 8 WHEN 'high' THEN 24 WHEN 'low' THEN 72 ELSE 48 END) AS resolution_hours
  FROM service_tickets t
  LEFT JOIN sla_rules r
    ON r.priority = t.priority::text
   AND r.warranty_type = CASE
         WHEN lower(coalesce(t.warranty_status::text, '')) IN ('amc', 'under_amc') THEN 'amc'
         WHEN lower(coalesce(t.warranty_status::text, '')) IN ('out_of_warranty', 'billable') THEN 'out_of_warranty'
         ELSE 'in_warranty' END
  LEFT JOIN sla_rules ri ON ri.priority = t.priority::text AND ri.warranty_type = 'in_warranty'
  WHERE t.sla_resolution_due_at IS NULL OR t.sla_response_due_at IS NULL
)
UPDATE service_tickets t
SET sla_response_due_at = COALESCE(t.sla_response_due_at, base.clock_start + make_interval(hours => base.response_hours)),
    sla_resolution_due_at = COALESCE(t.sla_resolution_due_at, base.clock_start + make_interval(hours => base.resolution_hours))
FROM base
WHERE t.id = base.id;
