insert into warehouse.role_capabilities (role, capability) values ('logistics_supervisor', 'manage_locations') on conflict (role, capability) do nothing;

drop policy if exists locations_insert on warehouse.locations;
drop policy if exists locations_update on warehouse.locations;
drop policy if exists locations_delete on warehouse.locations;
create policy locations_insert on warehouse.locations for insert to authenticated with check (warehouse.has_cap('manage_locations'));
create policy locations_update on warehouse.locations for update to authenticated using (warehouse.has_cap('manage_locations')) with check (warehouse.has_cap('manage_locations'));
create policy locations_delete on warehouse.locations for delete to authenticated using (warehouse.has_cap('manage_locations'));

notify pgrst, 'reload schema';
