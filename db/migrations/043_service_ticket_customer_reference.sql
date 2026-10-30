-- =====================================================================
-- Migration 043: the customer's own reference sits beside the system ticket number
--
-- The desk's "Ticket Ref" field is the customer's own reference (a GeM incident id, a unit's letter number …), but
-- it used to replace the TCK-YYYY-NNNNNN number. Every ticket now always gets its TCK number, and the customer's
-- reference is kept in its own column, searchable alongside it. Existing tickets are left as they are.
-- Idempotent: safe to re-run.
-- =====================================================================

alter table service_tickets add column if not exists customer_reference text;
