-- Migration 023: optional time-of-day for follow-up touchpoints
ALTER TABLE follow_ups ADD COLUMN IF NOT EXISTS due_time time;
