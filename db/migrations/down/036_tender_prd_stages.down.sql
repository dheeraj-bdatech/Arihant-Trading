-- Reverts 036_tender_prd_stages.sql.
-- Tenders mapped onto PRD stages keep their new stage (the original is on the DATA_CORRECTION activity entry).
-- Only the stage lookup is restored to its 011/019 shape.

INSERT INTO tender_statuses (code, label, sort_order, is_terminal, color) VALUES
  ('PQ_NOT_QUALIFIED', 'PQ Not Qualified', 7, true, 'danger'),
  ('TECHNICALLY_DISQUALIFIED', 'Technically Disqualified', 10, true, 'danger'),
  ('REVERSE_AUCTION', 'Reverse Auction', 11, false, 'warning'),
  ('PARTIALLY_WON', 'Partially Won', 12, true, 'success'),
  ('NOT_SUBMITTED', 'Not Submitted', 15, true, 'danger')
ON CONFLICT (code) DO NOTHING;

UPDATE tender_statuses SET is_terminal = true, updated_at = now() WHERE code = 'REJECTED_INTERNALLY';
