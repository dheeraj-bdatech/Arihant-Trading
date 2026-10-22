-- =====================================================================
-- Migration 030: Proposals / Tasks / Notifications QA data repair (DEF-104, DEF-105)
--
-- DEF-105  Notifications and proposal follow-up tasks quoted the internal canonical number (PRP-2026-01076)
--          while every screen shows the register number (PROP-2026-1076). New rows use the register number;
--          this rewrites the text of existing rows that reference a proposal.
-- DEF-104  Follow-up tasks of proposals that were already converted / lost / closed stayed open. New outcomes
--          close them automatically; this closes the ones left behind, with the same reason and timeline entry.
--
-- Idempotent: re-running finds nothing left to change.
-- =====================================================================

-- DEF-105: notification text → register number
UPDATE notifications n
SET title = replace(n.title, p.proposal_no, p.proposal_number),
    body  = replace(n.body,  p.proposal_no, p.proposal_number)
FROM proposals p
WHERE n.entity_type = 'proposal'
  AND n.entity_id = p.id
  AND p.proposal_no IS NOT NULL
  AND p.proposal_number IS NOT NULL
  AND p.proposal_no <> p.proposal_number
  AND (strpos(n.title, p.proposal_no) > 0 OR strpos(coalesce(n.body, ''), p.proposal_no) > 0);

-- DEF-105: proposal follow-up task text → register number
UPDATE tasks t
SET title       = replace(t.title, p.proposal_no, p.proposal_number),
    description = replace(t.description, p.proposal_no, p.proposal_number),
    updated_at  = now()
FROM proposals p
WHERE t.related_entity_type = 'proposal'
  AND t.related_entity_id = p.id
  AND p.proposal_no IS NOT NULL
  AND p.proposal_number IS NOT NULL
  AND p.proposal_no <> p.proposal_number
  AND (strpos(t.title, p.proposal_no) > 0 OR strpos(coalesce(t.description, ''), p.proposal_no) > 0);

-- DEF-104: close follow-up tasks left open on concluded proposals
WITH stale AS (
  SELECT t.id AS task_id, t.status AS from_status,
         'Proposal ' || coalesce(p.proposal_number, p.proposal_no, '') || ' was ' ||
           CASE upper(p.status) WHEN 'LOST' THEN 'marked Lost' WHEN 'CONVERTED' THEN 'converted' ELSE 'closed' END ||
           '; follow-up no longer needed.' AS reason
  FROM tasks t
  JOIN proposals p ON p.id = t.related_entity_id
  WHERE t.related_entity_type = 'proposal'
    AND t.status IN ('not_started', 'in_progress', 'blocked')
    AND upper(p.status) IN ('LOST', 'CONVERTED', 'CLOSED')
),
blockers AS (
  UPDATE task_blockers b
  SET status = 'withdrawn', resolved_at = now(), resolution_note = s.reason
  FROM stale s
  WHERE b.task_id = s.task_id AND b.status IN ('pending_review', 'accepted')
  RETURNING b.id
),
closed AS (
  UPDATE tasks t
  SET status = 'cancelled', cancelled_reason = s.reason, cancelled_at = now(), version = t.version + 1, updated_at = now()
  FROM stale s
  WHERE t.id = s.task_id
  RETURNING t.id, s.from_status, s.reason
)
INSERT INTO task_updates (task_id, author_id, kind, status_from, status_to, comment, metadata)
SELECT c.id, NULL, 'cancel', c.from_status, 'cancelled', c.reason, '{"source":"proposal_outcome","migration":"030"}'::jsonb
FROM closed c;
