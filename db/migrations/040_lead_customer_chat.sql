-- =====================================================================
-- Migration 040: Module 1 — Customer live chat on a lead
--
-- A lead's owner shares a private chat link with the customer. The customer reads and writes the customer-facing
-- part of the lead's conversation through it, without logging in; team-only messages never reach them.
--   * lead_messages.audience: 'team' (internal, the default) or 'customer' (sent to, or written by, the customer)
--   * lead_messages.from_customer: written by the customer through the link (no author_id)
--   * lead_chat_links: at most one per lead; only the SHA-256 of the link's token is stored, so a link is shown once
--     when it is made and replaced (or turned off) rather than looked up again
-- Idempotent: safe to re-run.
-- =====================================================================

ALTER TABLE lead_messages
  ADD COLUMN IF NOT EXISTS audience text NOT NULL DEFAULT 'team',
  ADD COLUMN IF NOT EXISTS from_customer boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS customer_name text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lead_messages_audience_check') THEN
    ALTER TABLE lead_messages ADD CONSTRAINT lead_messages_audience_check CHECK (audience IN ('team', 'customer'));
  END IF;
  -- A customer's message is customer-facing and has no staff author; a staff message always has one
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lead_messages_customer_author_check') THEN
    ALTER TABLE lead_messages ADD CONSTRAINT lead_messages_customer_author_check
      CHECK ((from_customer AND author_id IS NULL AND audience = 'customer') OR (NOT from_customer));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS lead_chat_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL UNIQUE REFERENCES leads(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_by uuid REFERENCES users(id)
);
