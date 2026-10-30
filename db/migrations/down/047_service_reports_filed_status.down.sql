-- Reverts the column default of 047_service_reports_filed_status.sql. The relabelled reports stay filed: they were
-- never drafts, so there is nothing true to restore.

alter table service_reports alter column report_status set default 'Draft';
