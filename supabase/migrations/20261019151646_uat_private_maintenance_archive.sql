-- PREPARED ONLY. Parent review, then Supabase apply_migration with a parent-chosen migration name.
-- Additive private backup only. No source-row cleanup, import or Storage access.
create table private.uat_admin_reset_archives (
  batch_id text primary key,
  operation text not null check (operation in ('reset550','seed')),
  plan_sha256 text not null check (plan_sha256 ~ '^[0-9a-f]{64}$'),
  row_images jsonb not null check (jsonb_typeof(row_images)='array'),
  preservation_before jsonb not null,
  planned_inserts jsonb,
  created_at timestamptz not null default now(),
  database_actor text not null default session_user
);
alter table private.uat_admin_reset_archives owner to postgres;
alter table private.uat_admin_reset_archives enable row level security;
alter table private.uat_admin_reset_archives force row level security;
revoke all on table private.uat_admin_reset_archives from public, anon, authenticated, service_role;
-- No RLS policies and no client RPC: only the database maintenance administrator can archive/read.
create function private.guard_uat_admin_reset_archive() returns trigger
language plpgsql set search_path='' as $$
begin raise exception 'UAT reset archives are immutable'; end;
$$;
alter function private.guard_uat_admin_reset_archive() owner to postgres;
revoke all on function private.guard_uat_admin_reset_archive() from public, anon, authenticated, service_role;
create trigger uat_admin_archive_immutable_rows before update or delete
  on private.uat_admin_reset_archives for each row execute function private.guard_uat_admin_reset_archive();
create trigger uat_admin_archive_no_truncate before truncate
  on private.uat_admin_reset_archives for each statement execute function private.guard_uat_admin_reset_archive();
comment on table private.uat_admin_reset_archives is
  'Private immutable full row images for reviewed UAT maintenance; never exposed to application clients; retain independently of active queues.';
