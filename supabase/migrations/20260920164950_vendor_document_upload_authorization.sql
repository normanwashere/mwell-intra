-- CI202: the raw-capability convergence mistook an alternative Legal review
-- branch for a prerequisite to a vendor's own document upload. Keep the raw
-- implementation and its ACL intact; submit_accreditation remains separate.
do $migration$
declare
  v_source text;
  v_delegate text;
  v_delegate_oid regprocedure;
begin
  select prosrc into strict v_source
  from pg_catalog.pg_proc
  where oid = 'legal.upload_accreditation_doc(jsonb)'::regprocedure;

  -- The convergence suffix depends on the database OID. Retain the delegate
  -- actually called by the installed wrapper, not another matching function.
  v_delegate := (pg_catalog.regexp_match(v_source,
    'return[[:space:]]+legal[.](upload_accreditation_doc_rawcap_20260816_impl_[0-9a-f]{6})[(]payload[)]',
    'i'))[1];
  if v_delegate is null then
    raise exception 'Unexpected accreditation upload wrapper; review its delegate before migrating';
  end if;
  v_delegate_oid := pg_catalog.to_regprocedure(pg_catalog.format('legal.%I(jsonb)', v_delegate));
  if v_delegate_oid is null then
    raise exception 'Accreditation upload delegate is missing';
  end if;
  if pg_catalog.has_function_privilege('anon', v_delegate_oid, 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated', v_delegate_oid, 'EXECUTE') then
    raise exception 'Accreditation upload delegate must remain unavailable to API callers';
  end if;

  execute pg_catalog.format($wrapper$
    create or replace function legal.upload_accreditation_doc(payload jsonb)
    returns jsonb
    language plpgsql
    security definer
    set search_path = ''
    as $body$
    declare
      v_vendor_id uuid;
      v_requirement_id text;
    begin
      if coalesce(auth.role() = 'service_role', false)
         or core.has_live_cap('legal', 'review_accreditation') then
        return legal.%1$I(payload);
      end if;

      -- Upload is onboarding write authority, not a certification gate.
      if not coalesce(core.is_vendor(), false)
         or not coalesce(core.has_live_cap('core', 'submit_documents'), false) then
        raise exception 'Not authorized: core.submit_documents';
      end if;

      select accreditation_case.vendor_id into v_vendor_id
      from legal.accreditation_cases accreditation_case
      where accreditation_case.id = payload->>'case_id'
        and accreditation_case.vendor_id = core.current_vendor_id();
      if not found then
        raise exception 'Accreditation case not found or not accessible';
      end if;

      if nullif(payload->>'vendor_id', '') is not null
         and (payload->>'vendor_id')::uuid is distinct from v_vendor_id then
        raise exception 'Vendor mismatch for accreditation document';
      end if;
      v_requirement_id := nullif(payload->>'requirement_id', '');
      if v_requirement_id is not null and not exists (
        select 1 from legal.requirement_checklist_items requirement
        where requirement.id = v_requirement_id
          and requirement.case_id = payload->>'case_id'
      ) then
        raise exception 'Accreditation requirement not found or not accessible';
      end if;

      return legal.%1$I(payload);
    end;
    $body$;
  $wrapper$, v_delegate);
end;
$migration$;

-- CREATE OR REPLACE preserves the wrapper owner and existing EXECUTE ACL.
-- No role grants, raw implementation changes, or later submission changes.
