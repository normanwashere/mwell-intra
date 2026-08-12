-- Learning certifications must not survive loss of their live RBAC source.
-- Supported isolation: READ COMMITTED only.
-- Lock order matches core.upsert_role_bundle: role, assignment, capability,
-- then the curriculum graph locked by the issuance validator.

alter table learning.certifications
  add column if not exists revocation_reason text;

create or replace function private.lock_certification_role_authority()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_learning_read_committed();

  perform 1
  from core.roles role_definition
  where role_definition.module = new.module
    and role_definition.role = new.source_role
    and role_definition.is_active
  for share;
  if not found then
    raise exception 'Certification source role is not active';
  end if;

  perform 1
  from core.user_roles role_assignment
  where role_assignment.id = new.source_role_assignment_id
    and role_assignment.user_id = new.user_id
    and role_assignment.module = new.module
    and role_assignment.role = new.source_role
  for key share;
  if not found then
    raise exception 'Certification source role assignment is not active';
  end if;

  perform 1
  from core.role_capabilities role_capability
  where role_capability.module = new.module
    and role_capability.role = new.source_role
    and role_capability.cap = new.capability
  for share;
  if not found then
    raise exception 'Certification capability is not granted by the source role';
  end if;

  return new;
end;
$$;

create or replace function private.revoke_certifications_for_role_authority_loss()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_learning_read_committed();

  if tg_table_schema <> 'core' then
    raise exception 'Role-authority revocation trigger has an invalid source table';
  end if;

  if tg_table_name = 'roles' then
    if tg_op <> 'UPDATE' then
      raise exception 'Role-authority revocation trigger has an invalid operation';
    end if;

    if exists (
      select 1
      from core.roles final_role
      where final_role.module = old.module
        and final_role.role = old.role
        and final_role.is_active
    ) then
      return null;
    end if;

    update learning.certifications
    set status = 'revoked',
        revoked_at = pg_catalog.clock_timestamp(),
        revocation_reason = 'system:source_role_inactive'
    where module = old.module
      and source_role = old.role
      and status = 'active';
    return null;
  end if;

  if tg_table_name = 'role_capabilities' then
    if tg_op not in ('DELETE', 'UPDATE') then
      raise exception 'Role-capability revocation trigger has an invalid operation';
    end if;

    if exists (
      select 1
      from core.role_capabilities final_capability
      where final_capability.module = old.module
        and final_capability.role = old.role
        and final_capability.cap = old.cap
    ) then
      return null;
    end if;

    update learning.certifications
    set status = 'revoked',
        revoked_at = pg_catalog.clock_timestamp(),
        revocation_reason = 'system:source_role_capability_missing'
    where module = old.module
      and source_role = old.role
      and capability = old.cap
      and status = 'active';
    return null;
  end if;

  raise exception 'Role-authority revocation trigger has an invalid source table';
end;
$$;

create or replace function private.revoke_certifications_for_role_assignment_v2()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_learning_read_committed();

  update learning.certifications
  set status = 'revoked',
      revoked_at = pg_catalog.clock_timestamp(),
      revocation_reason = 'system:source_role_assignment_removed'
  where source_role_assignment_id = old.id
    and status = 'active';
  return old;
end;
$$;

create or replace function learning.guard_certification_lifecycle_v2()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform private.assert_learning_read_committed();

  if tg_op = 'DELETE' then
    raise exception 'Certification evidence cannot be deleted';
  end if;
  if old.status <> 'active' then
    raise exception 'Finalized certification evidence is immutable';
  end if;
  if (to_jsonb(new) - array['status', 'revoked_at', 'superseded_at', 'revocation_reason'])
     is distinct from
     (to_jsonb(old) - array['status', 'revoked_at', 'superseded_at', 'revocation_reason']) then
    raise exception 'Certification issuance evidence is immutable';
  end if;
  if new.status not in ('active', 'expired', 'revoked', 'superseded') then
    raise exception 'Invalid certification lifecycle transition';
  end if;
  if new.status = 'revoked'
     and nullif(pg_catalog.btrim(new.revocation_reason), '') is null then
    raise exception 'Certification revocation requires an attributable reason';
  end if;
  if new.status <> 'revoked' and new.revocation_reason is not null then
    raise exception 'Certification revocation reason requires revoked status';
  end if;
  return new;
end;
$$;

revoke all on function private.lock_certification_role_authority()
  from public, anon, authenticated, service_role;
revoke all on function private.revoke_certifications_for_role_authority_loss()
  from public, anon, authenticated, service_role;
revoke all on function private.revoke_certifications_for_role_assignment_v2()
  from public, anon, authenticated, service_role;
revoke all on function learning.guard_certification_lifecycle_v2()
  from public, anon, authenticated, service_role;

drop trigger if exists learning_certifications_lock_role_authority
  on learning.certifications;
create trigger learning_certifications_lock_role_authority
before insert on learning.certifications
for each row execute function private.lock_certification_role_authority();

drop trigger if exists learning_role_deactivation_revoke on core.roles;
create constraint trigger learning_role_deactivation_revoke
after update of is_active on core.roles
deferrable initially deferred
for each row execute function private.revoke_certifications_for_role_authority_loss();

drop trigger if exists learning_role_capability_removal_revoke
  on core.role_capabilities;
create constraint trigger learning_role_capability_removal_revoke
after delete or update on core.role_capabilities
deferrable initially deferred
for each row execute function private.revoke_certifications_for_role_authority_loss();

-- Replace both the legacy catalog-truncated name and the short source name so
-- fresh installs and already-applied foundations converge on one identifier.
drop trigger if exists learning_curriculum_requirement_prerequisites_read_committed_guard
  on learning.curriculum_requirement_prerequisites;
drop trigger if exists learning_curr_req_prereq_read_committed_guard
  on learning.curriculum_requirement_prerequisites;
create trigger learning_curr_req_prereq_read_committed_guard
before insert or update or delete on learning.curriculum_requirement_prerequisites
for each row execute function learning.guard_authoritative_write_isolation();

-- The ALTER above holds an ACCESS EXCLUSIVE table lock. Replacing the trigger
-- and reconciling evidence therefore cannot expose an unguarded write window.
drop trigger if exists learning_certifications_lifecycle_guard
  on learning.certifications;

update learning.certifications
set revocation_reason = 'system:historical_revocation_backfill'
where status = 'revoked'
  and revocation_reason is null;

update learning.certifications certification
set status = 'revoked',
    revoked_at = pg_catalog.clock_timestamp(),
    revocation_reason = case
      when not exists (
        select 1
        from core.roles source_role
        where source_role.module = certification.module
          and source_role.role = certification.source_role
          and source_role.is_active
      ) then 'system:source_role_inactive'
      else 'system:source_role_capability_missing'
    end
where certification.status = 'active'
  and (
    not exists (
      select 1
      from core.roles source_role
      where source_role.module = certification.module
        and source_role.role = certification.source_role
        and source_role.is_active
    )
    or not exists (
      select 1
      from core.role_capabilities source_capability
      where source_capability.module = certification.module
        and source_capability.role = certification.source_role
        and source_capability.cap = certification.capability
    )
  );

alter table learning.certifications
  add constraint certifications_revocation_reason_check
  check (
    (status = 'revoked') =
      (nullif(pg_catalog.btrim(revocation_reason), '') is not null)
  );

create trigger learning_certifications_lifecycle_guard
before update or delete on learning.certifications
for each row execute function learning.guard_certification_lifecycle_v2();

drop trigger if exists learning_revoke_certifications_on_role_delete
  on core.user_roles;
create trigger learning_revoke_certifications_on_role_delete
before delete on core.user_roles
for each row execute function private.revoke_certifications_for_role_assignment_v2();

-- Supported authority maintenance is row-level so deferred revocation guards
-- always observe final role-bundle state. TRUNCATE is never an application path.
revoke truncate on table core.roles
  from public, anon, authenticated, service_role;
revoke truncate on table core.role_capabilities
  from public, anon, authenticated, service_role;
revoke truncate on table core.user_roles
  from public, anon, authenticated, service_role;

create index learning_active_certifications_role_authority_idx
  on learning.certifications(module, source_role, capability)
  where status = 'active';
