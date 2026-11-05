-- Mwell Intra - emergency lockdown for the legacy public procurement table.
--
-- The live audit proved that public.procurement_requests still had a blanket
-- "auth.uid() is not null" ALL policy, allowing warehouse-only users to create
-- procurement records. The current intra app does not use this legacy public
-- table directly; procurement ownership is moving to procurement.*. Until that
-- migration is live, restrict the legacy table to the older public.app_role
-- allow-list and remove the all-authenticated write path.

do $$
begin
  if to_regclass('public.procurement_requests') is null then
    return;
  end if;

  alter table public.procurement_requests enable row level security;

  drop policy if exists "authenticated users can manage procurement" on public.procurement_requests;
  drop policy if exists procurement_requests_role_select on public.procurement_requests;
  drop policy if exists procurement_requests_procurement_insert on public.procurement_requests;
  drop policy if exists procurement_requests_procurement_update on public.procurement_requests;
  drop policy if exists procurement_requests_procurement_delete on public.procurement_requests;

  create policy procurement_requests_role_select
    on public.procurement_requests
    for select
    to authenticated
    using (
      private.current_app_role() = any (
        array[
          'procurement-consultant'::app_role,
          'operations-manager'::app_role,
          'finance-manager'::app_role,
          'manager'::app_role,
          'admin'::app_role
        ]
      )
    );

  create policy procurement_requests_procurement_insert
    on public.procurement_requests
    for insert
    to authenticated
    with check (
      private.current_app_role() = any (
        array[
          'procurement-consultant'::app_role,
          'manager'::app_role,
          'admin'::app_role
        ]
      )
    );

  create policy procurement_requests_procurement_update
    on public.procurement_requests
    for update
    to authenticated
    using (
      private.current_app_role() = any (
        array[
          'procurement-consultant'::app_role,
          'manager'::app_role,
          'admin'::app_role
        ]
      )
    )
    with check (
      private.current_app_role() = any (
        array[
          'procurement-consultant'::app_role,
          'manager'::app_role,
          'admin'::app_role
        ]
      )
    );

  create policy procurement_requests_procurement_delete
    on public.procurement_requests
    for delete
    to authenticated
    using (
      private.current_app_role() = any (
        array[
          'procurement-consultant'::app_role,
          'admin'::app_role
        ]
      )
    );
end $$;

notify pgrst, 'reload schema';
