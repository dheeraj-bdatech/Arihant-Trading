-- =====================================================================
-- Migration 045: modules an administrator has switched off for a role
--
-- Admin → Role Permissions can switch a module (leads, service, expenses …) off for a role and back on; the API
-- refuses that module's routes and the app hides it. A row exists only while the module is off, so a new table
-- starts with everyone keeping exactly the access the code gives them. The code (page rules, @Roles guards,
-- scoping) still sets the most a role can do: a switch never grants. The module keys live in ACCESS_MODULES
-- (@arihant/shared). The older role_permissions seed matrix (migration 002) is not used for enforcement.
-- Idempotent: safe to re-run.
-- =====================================================================

create table if not exists role_module_blocks (
  role       user_role not null,
  module     text not null,
  reason     text,
  blocked_by uuid references users(id) on delete set null,
  blocked_at timestamptz not null default now(),
  primary key (role, module)
);
