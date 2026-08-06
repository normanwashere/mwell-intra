-- Append conditional accreditation requirements as arrays, not scalar text.
-- Patched targets: array_append(v_required, 'PH_PRIVACY_COMPLIANCE')
-- and array_append(v_required, 'PH_CYBERSECURITY_POLICIES').

do $migration$
declare
  definition text;
begin
  select pg_get_functiondef(
    'private.vendor_accreditation_readiness(uuid,text)'::regprocedure
  ) into definition;

  definition := replace(
    definition,
    'v_required := v_required ' || '|| ''PH_PRIVACY_COMPLIANCE'';',
    'v_required := array_append(v_required, ''PH_PRIVACY_COMPLIANCE'');'
  );
  definition := replace(
    definition,
    'v_required := v_required ' || '|| ''PH_CYBERSECURITY_POLICIES'';',
    'v_required := array_append(v_required, ''PH_CYBERSECURITY_POLICIES'');'
  );

  if definition like ('%v_required := v_required ' || '|| ''PH_%') then
    raise exception 'Vendor readiness scalar array append was not fully replaced';
  end if;

  execute definition;
end
$migration$;
