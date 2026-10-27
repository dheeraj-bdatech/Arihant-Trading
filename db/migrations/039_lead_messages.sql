-- =====================================================================
-- Migration 039: Module 1 — Conversation thread on a lead
--
-- The team's running conversation on a lead (the owner, their Regional Manager, Management and the teams working it).
-- Append-only: a message is never edited or deleted, so the thread is its own record of who said what and when.
-- Idempotent: safe to re-run.
-- =====================================================================

CREATE TABLE IF NOT EXISTS lead_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  author_id uuid REFERENCES users(id),
  body text NOT NULL CHECK (length(btrim(body)) > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lead_messages_lead ON lead_messages(lead_id, created_at);
