-- =====================================================================
-- Migration 049: client categories master (Blueprint §2 / RBAC spec §3.8: admin-maintained master records)
--
-- The sector a customer organisation belongs to (Defence, Police / Paramilitary, Railways …) was a fixed list in the
-- web app. It becomes a master list the System Administrator maintains: `name` is the value stored on
-- organisations.sector (unchanged, so existing customers keep their sector), `label` is what pickers show.
-- A category in use is deactivated rather than deleted; renaming one renames it on its customers too.
-- Seeded with the list the app used until now. Idempotent: safe to re-run.
-- =====================================================================

create table if not exists client_categories (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  label      text,
  sort_order integer not null default 0,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into client_categories (name, label, sort_order) values
  ('Defence', 'Defence (Army / Navy / Air Force)', 10),
  ('Police / Paramilitary', 'Police / Paramilitary (CRPF, BSF, CISF, ITBP, SSB)', 20),
  ('State Police', 'State Police & Special Forces', 30),
  ('Railways', 'Railways & Metro Transit', 40),
  ('Security / Intelligence', 'Intelligence & Security Agencies', 50),
  ('Nuclear & Energy', 'Nuclear, Power & Critical Infrastructure', 60),
  ('Aviation & Airports', 'Aviation & Airport Security', 70),
  ('Prisons & Correctional', 'Prisons & Correctional Services', 80),
  ('PSU / Government', 'Public Sector Undertaking (PSU) / Govt', 90),
  ('Corporate Security', 'Corporate & Industrial Security', 100),
  ('Other', 'Other Sector', 1000)
on conflict (name) do nothing;
