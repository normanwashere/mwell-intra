-- Keep service-only Legal control tables explicit to the advisor and ensure
-- their foreign keys remain cheap during governed cleanup.

drop policy if exists vendor_invite_policy_service_only on legal.vendor_invite_policy;
create policy vendor_invite_policy_service_only
on legal.vendor_invite_policy
for all to service_role
using (true)
with check (true);

drop policy if exists vendor_invite_commands_service_only on legal.vendor_invite_commands;
create policy vendor_invite_commands_service_only
on legal.vendor_invite_commands
for all to service_role
using (true)
with check (true);

create index if not exists vendor_invite_policy_updated_by_idx
on legal.vendor_invite_policy(updated_by)
where updated_by is not null;

create index if not exists vendor_invite_commands_invite_id_idx
on legal.vendor_invite_commands(invite_id)
where invite_id is not null;

drop policy if exists legal_invites_read on legal.vendor_invites;
create policy legal_invites_read on legal.vendor_invites
for select to authenticated
using (
  (select core.has_cap('legal', 'manage_checklist'))
  or (
    status = 'accepted'
    and auth_user_id = (select auth.uid())
    and vendor_id = (select core.current_vendor_id())
  )
);

select pg_notify('pgrst', 'reload schema');
