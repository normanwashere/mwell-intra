-- Forward-only verifier repair. Inspection runtime implementations are unchanged.
-- Pin the fully reviewed Aug26/Aug28 chain, not just a delegate name:
-- public live-cap + return-intake routing -> v3 exact provisional custody -> v2
-- non-procurement fallback. Hashes include every guard and normalize CRLF only.
create or replace function private.quality_inspection_chain_is_current()
returns boolean language sql stable security definer set search_path='' as $chain$
with expected(signature, source_sha256, public_entry) as (
  values
    ('warehouse.inspect_quality(jsonb)', '57efa280ad133f60174f1aad55d0d5c6c84497bb447e7d19e18b82db627cfa36', true),
    ('private.warehouse_inspect_quality_v3(jsonb)', '0976b8ae08e6fde7ea7a32933cfde3b18ecf9f49adb923a1182a29fdb3d648c7', false),
    ('private.warehouse_inspect_quality_v2(jsonb)', '95c3b4c38f4666cc7f0a66e3d2f78729e09d3c60544aa6fa22c570b732eee119', false),
    ('private.inspect_return_intake(jsonb)', '53c512e6a70ad8d2dfca59e5b03c55742569d84f7ace18d58025546b7ac47ae8', false)
)
select coalesce(count(p.oid) = 4 and bool_and(
  p.prokind = 'f' and p.prosecdef
  and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
  and p.proconfig @> array['search_path=""']::text[]
  and p.prorettype = 'jsonb'::pg_catalog.regtype
  and p.proargnames = array['payload']::text[]
  and pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    pg_catalog.replace(p.prosrc, pg_catalog.chr(13) || pg_catalog.chr(10), pg_catalog.chr(10)),
    'UTF8')), 'hex') = expected.source_sha256
  and not pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
  and pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE') = expected.public_entry
), false)
from expected
left join pg_catalog.pg_proc p on p.oid = pg_catalog.to_regprocedure(expected.signature)
$chain$;
alter function private.quality_inspection_chain_is_current() owner to postgres;
revoke all on function private.quality_inspection_chain_is_current() from public,anon,authenticated;
grant execute on function private.quality_inspection_chain_is_current() to service_role;

-- Retain the installed raw-boundary and unrelated object checks verbatim.
alter function core.verify_security_database_launch_blockers()
rename to verify_security_database_launch_blockers_pre_quality_chain;
revoke all on function core.verify_security_database_launch_blockers_pre_quality_chain()
from public,anon,authenticated,service_role;

create or replace function core.verify_security_database_launch_blockers()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role is required for launch verification' using errcode='42501';
  end if;
  result:=core.verify_security_database_launch_blockers_pre_quality_chain();
  if jsonb_typeof(result->'raw_boundaries') is distinct from 'number'
    or jsonb_typeof(result->'examples') is distinct from 'array'
    or jsonb_typeof(result->'missing_objects') is distinct from 'array' then
    raise exception 'Invalid prior launch verification response';
  end if;
  if not private.quality_inspection_chain_is_current() then
    result:=jsonb_set(result,'{missing_objects}',
      (result->'missing_objects')||'["warehouse.inspect_quality exact PO-line delegate"]'::jsonb);
  end if;
  return result;
end; $$;
alter function core.verify_security_database_launch_blockers() owner to postgres;
revoke all on function core.verify_security_database_launch_blockers() from public,anon,authenticated;
grant execute on function core.verify_security_database_launch_blockers() to service_role;

-- The CLI also calls the read-contract RPC. Replace only its obsolete direct-v2
-- condition; preserve grant, acceptance, identity-precedence and DOA checks.
do $repair$
declare
  definition text:=replace(pg_get_functiondef('core.verify_launch_read_contracts()'::regprocedure),chr(13)||chr(10),chr(10));
  old_condition text:=$old$if v_quality_definition !~
       'private[.]warehouse_inspect_quality_v2[[:space:]]*[(][[:space:]]*payload[[:space:]]*[)]'
     or v_quality_definition ~
       'private[.]warehouse_inspect_quality[[:space:]]*[(][[:space:]]*payload[[:space:]]*[)]' then$old$;
begin
  if strpos(definition,old_condition)=0 then
    raise exception 'Unexpected read-contract verifier: review before replacing direct-v2 condition';
  end if;
  execute replace(definition,old_condition,
    'if not private.quality_inspection_chain_is_current() then');
end; $repair$;
alter function core.verify_launch_read_contracts() owner to postgres;
revoke all on function core.verify_launch_read_contracts() from public,anon,authenticated;
grant execute on function core.verify_launch_read_contracts() to service_role;
notify pgrst, 'reload schema';
