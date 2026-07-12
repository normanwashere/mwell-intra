-- Mwell Intra - remove REST exposure for legacy public procurement records.
--
-- Release 1 procurement now lives under procurement.* with schema-scoped RLS and
-- controlled RPCs. The old public.procurement_requests table should remain
-- available only to privileged database/service-role callers during cutover.

do $$
begin
  if to_regclass('public.procurement_requests') is null then
    return;
  end if;

  alter table public.procurement_requests enable row level security;
  alter table public.procurement_requests force row level security;

  revoke all privileges on table public.procurement_requests from anon;
  revoke all privileges on table public.procurement_requests from authenticated;
end $$;

notify pgrst, 'reload schema';
