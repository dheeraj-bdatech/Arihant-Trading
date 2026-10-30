-- =====================================================================
-- Migration 047: service reports filed before report review existed are not drafts
--
-- Migration 018 added service_reports.report_status with DEFAULT 'Draft', so every report already on file was labelled a
-- draft. The app never creates drafts: filing a report sets 'Submitted' and a manager's review sets 'Approved' or
-- 'Returned for Correction'. A row here is a filed report, so:
--   * a legacy 'Draft' on a closed ticket was accepted when the ticket was closed → 'Approved';
--   * any other legacy 'Draft' → 'Submitted', dated when it was written;
--   * new rows default to 'Submitted'.
-- Idempotent: safe to re-run.
-- =====================================================================

update service_reports r
set report_status = 'Approved',
    submitted_at = coalesce(r.submitted_at, r.created_at),
    approved_at = coalesce(r.approved_at, t.closed_at, r.updated_at, r.created_at),
    updated_at = now()
from service_tickets t
where t.id = r.ticket_id and r.report_status = 'Draft' and t.status = 'closed';

update service_reports
set report_status = 'Submitted',
    submitted_at = coalesce(submitted_at, created_at),
    updated_at = now()
where report_status = 'Draft' or report_status is null;

alter table service_reports alter column report_status set default 'Submitted';
