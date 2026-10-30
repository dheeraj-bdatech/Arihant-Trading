-- =====================================================================
-- Migration 046: each person's own dashboard layout
--
-- Module 10 (Management Command): a manager picks which sections and figures their command dashboard shows, in
-- which order, and over which results period. The layout is a preference, not business data: a row exists only once
-- someone saves a layout, everyone else gets the default from @arihant/shared (DEFAULT_COMMAND_LAYOUT), and unknown
-- keys are dropped when it is read, so adding or removing a figure later never breaks a saved layout.
-- Idempotent: safe to re-run.
-- =====================================================================

create table if not exists dashboard_layouts (
  user_id    uuid not null references users(id) on delete cascade,
  board      text not null,
  layout     jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, board)
);
