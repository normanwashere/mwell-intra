-- Mwell Intra — core.vendors (the cross-department vendor master, spec §4.3)
--
-- The single source of truth for vendor identity + accreditation lifecycle.
--   * Legal OWNS accreditation_status (owner_module default 'legal', spec §4.3/§7).
--     Procurement reads it to gate award (award RPC refuses unless 'approved').
--     Warehouse `suppliers` link via a projection column `core_vendor_id`
--     (a reference, NOT a copy — spec §3 rule, ADR-002).
--   * Status transitions go through core.set_accreditation_status() (RPC
--     migration); this table only stores the current state.
--
-- Re-runnable: create table if not exists + guarded FK.

create table if not exists core.vendors (
  id                    uuid primary key default gen_random_uuid(),
  legal_name            text not null,
  trade_name            text,
  tin                   text,
  category              text,
  -- lifecycle: draft|submitted|under_review|approved|rejected|expired|renewal_due
  accreditation_status  text not null default 'draft',
  accreditation_expires_at date,
  owner_module          text not null default 'legal',   -- system of record for status
  created_at            timestamptz not null default now()
);

create index if not exists vendors_status_idx on core.vendors (accreditation_status);
create index if not exists vendors_expiry_idx on core.vendors (accreditation_expires_at);

-- Now that core.vendors exists, wire the profiles.vendor_id projection FK
-- (vendor-kind profiles point at their vendor record). Guarded for re-runs.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_vendor_fk') then
    alter table core.profiles
      add constraint profiles_vendor_fk foreign key (vendor_id)
      references core.vendors(id) on delete set null;
  end if;
end $$;

alter table core.vendors enable row level security;

grant select on core.vendors to authenticated;
grant all on core.vendors to service_role;
