-- Bind certification evidence to one immutable role-assignment identity.
-- Supported role changes remain revoke/delete followed by assign/insert.

create or replace function private.guard_role_assignment_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform private.assert_learning_read_committed();

  if new.id is distinct from old.id
     or new.user_id is distinct from old.user_id
     or new.module is distinct from old.module
     or new.role is distinct from old.role then
    raise exception 'Role assignment identity is immutable';
  end if;

  return new;
end;
$$;

revoke all on function private.guard_role_assignment_identity()
  from public, anon, authenticated, service_role;

drop trigger if exists learning_guard_role_assignment_identity
  on core.user_roles;
create trigger learning_guard_role_assignment_identity
before update of id, user_id, module, role on core.user_roles
for each row execute function private.guard_role_assignment_identity();

-- CREATE TRIGGER holds role-assignment writes until this migration commits, so
-- reconciliation and the ongoing identity guard become visible atomically.
update learning.certifications certification
set status = 'revoked',
    revoked_at = pg_catalog.clock_timestamp(),
    revocation_reason = case
      when not exists (
        select 1
        from core.user_roles source_assignment
        where source_assignment.id = certification.source_role_assignment_id
      ) then 'system:source_role_assignment_missing'
      else 'system:source_role_assignment_identity_mismatch'
    end
where certification.status = 'active'
  and not exists (
    select 1
    from core.user_roles source_assignment
    where source_assignment.id = certification.source_role_assignment_id
      and source_assignment.user_id = certification.user_id
      and source_assignment.module = certification.module
      and source_assignment.role = certification.source_role
  );
