create table if not exists warehouse.storage_areas (
  id text primary key,
  location_id text not null,
  code text not null,
  label text,
  zone text,
  active boolean not null default true
);
create unique index if not exists storage_areas_code_uq on warehouse.storage_areas (location_id, code);

alter table warehouse.inventory_units add column if not exists bin_id text;
alter table warehouse.stock_levels add column if not exists bin_id text;
alter table warehouse.movements add column if not exists from_bin_id text;
alter table warehouse.movements add column if not exists to_bin_id text;

drop index if exists warehouse.stock_levels_uq;
create unique index if not exists stock_levels_uq on warehouse.stock_levels (product_id, location_id, bin_id, lot_id) nulls not distinct;

grant all on warehouse.storage_areas to authenticated, service_role;
alter table warehouse.storage_areas enable row level security;
drop policy if exists read_authenticated on warehouse.storage_areas;
create policy read_authenticated on warehouse.storage_areas for select to authenticated using (true);
drop policy if exists storage_areas_insert on warehouse.storage_areas;
drop policy if exists storage_areas_update on warehouse.storage_areas;
drop policy if exists storage_areas_delete on warehouse.storage_areas;
create policy storage_areas_insert on warehouse.storage_areas for insert to authenticated with check (warehouse.has_cap('manage_locations'));
create policy storage_areas_update on warehouse.storage_areas for update to authenticated using (warehouse.has_cap('manage_locations')) with check (warehouse.has_cap('manage_locations'));
create policy storage_areas_delete on warehouse.storage_areas for delete to authenticated using (warehouse.has_cap('manage_locations'));

notify pgrst, 'reload schema';
