-- Mwell Intra — vendor-tier RBAC reconciliation (Step 3, ADR-002 #3 finish)
--
-- The provisional Step-3 RBAC left the external vendor tier defined in TWO
-- places: (a) core:vendor_portal with submit_documents (what core RPCs actually
-- gate on), and (b) legal:vendor with upload_document/submit_accreditation
-- (a placeholder never wired to any RPC). This migration collapses (b) into
-- (a) so there is ONE authoritative vendor tier — core:vendor_portal.
--
-- Also grants the vendor_portal role the new view_own_accreditation cap so the
-- LegalApp vendor-mode read path lands in core (not legal). Kept @intra/rbac
-- documentation in sync via the module file (packages/rbac/src/modules/*).
--
-- Idempotent: uses on conflict + delete-then-insert.

-- ---------------------------------------------------------------------------
-- 1) Add the new core caps (idempotent) + grant to vendor_portal
-- ---------------------------------------------------------------------------
insert into core.capabilities (module, cap) values
  ('core', 'submit_accreditation'),
  ('core', 'view_own_accreditation')
on conflict (module, cap) do nothing;

insert into core.role_capabilities (module, role, cap) values
  ('core', 'vendor_portal', 'submit_accreditation'),
  ('core', 'vendor_portal', 'view_own_accreditation')
on conflict (module, role, cap) do nothing;

-- ---------------------------------------------------------------------------
-- 2) Retire the duplicated legal vendor tier — drop caps + role
-- ---------------------------------------------------------------------------
delete from core.role_capabilities
 where module = 'legal'
   and role = 'vendor';

delete from core.role_capabilities
 where module = 'legal'
   and cap in ('upload_document', 'submit_accreditation', 'view_own_accreditation');

delete from core.capabilities
 where module = 'legal'
   and cap in ('upload_document', 'submit_accreditation', 'view_own_accreditation');

delete from core.roles where module = 'legal' and role = 'vendor';

-- ---------------------------------------------------------------------------
-- 3) Update legal accreditation RPCs: gate vendor writes on core:submit_accreditation
--    (server-side; legal.create_accreditation_case's vendor branch previously
--    checked has_cap('legal','submit_accreditation') — which no longer exists).
--    Recreate the two RPCs with the new gate. Kept minimal + faithful to the
--    original body; only the gate check changes.
-- ---------------------------------------------------------------------------
create or replace function legal.create_accreditation_case(payload jsonb)
returns jsonb language plpgsql security definer set search_path = legal, core, public as $$
declare v legal.accreditation_cases;
begin
  -- Vendor tier uses core:submit_accreditation (reconciled 2026-07-05).
  -- Internal path still uses legal:manage_checklist for opening cases.
  if not (core.has_any_cap('submit_accreditation')
          or core.has_cap('legal', 'manage_checklist')) then
    raise exception 'Not authorized: legal.create_accreditation_case';
  end if;
  -- Vendor callers may only open a case for their own vendor record.
  if core.is_vendor() then
    if (payload->>'vendor_id')::uuid is distinct from core.current_vendor_id() then
      raise exception 'Vendors may only create accreditation cases for their own vendor.';
    end if;
  end if;
  insert into legal.accreditation_cases (
    vendor_id, status, opened_by, note
  ) values (
    (payload->>'vendor_id')::uuid,
    coalesce(nullif(payload->>'status',''), 'draft'),
    auth.uid(),
    nullif(payload->>'note','')
  ) returning * into v;
  insert into core.activity_log (module, entity_type, entity_id, action, actor, detail)
  values ('legal', 'accreditation_case', v.id, 'created', auth.uid(),
          jsonb_build_object('vendor_id', v.vendor_id, 'status', v.status));
  return to_jsonb(v);
end; $$;

create or replace function legal.submit_accreditation_case(payload jsonb)
returns jsonb language plpgsql security definer set search_path = legal, core, public as $$
declare v legal.accreditation_cases; v_id uuid;
begin
  if not core.has_any_cap('submit_accreditation') then
    raise exception 'Not authorized: submit_accreditation';
  end if;
  v_id := (payload->>'id')::uuid;
  if v_id is null then raise exception 'accreditation_case id is required'; end if;
  select * into v from legal.accreditation_cases where id = v_id for update;
  if not found then raise exception 'Case not found'; end if;
  if core.is_vendor() and v.vendor_id is distinct from core.current_vendor_id() then
    raise exception 'Vendors may only submit their own accreditation case.';
  end if;
  if v.status <> 'draft' then raise exception 'Only draft cases can be submitted (was %)', v.status; end if;
  update legal.accreditation_cases
     set status = 'submitted', submitted_at = now()
   where id = v_id
   returning * into v;
  insert into core.activity_log (module, entity_type, entity_id, action, actor, detail)
  values ('legal', 'accreditation_case', v.id, 'submitted', auth.uid(), '{}'::jsonb);
  return to_jsonb(v);
end; $$;

-- ---------------------------------------------------------------------------
-- 4) Refresh grants + notify PostgREST
-- ---------------------------------------------------------------------------
revoke all on function legal.create_accreditation_case(jsonb) from public, anon;
grant execute on function legal.create_accreditation_case(jsonb) to authenticated, service_role;
revoke all on function legal.submit_accreditation_case(jsonb) from public, anon;
grant execute on function legal.submit_accreditation_case(jsonb) to authenticated, service_role;

notify pgrst, 'reload schema';
