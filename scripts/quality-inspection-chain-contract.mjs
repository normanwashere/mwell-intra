// Reviewed external-PO dispatcher, inspector, evidence validator and hold guard.
// Existing Procurement/return hashes remain unchanged. Normalize CRLF only;
// do not derive expected fingerprints dynamically from the installed bodies.
// Pin argument defaults and the enabled BEFORE ROW UPDATE/DELETE trigger too.
export const QUALITY_CHAIN_CONTRACT_SQL = `
with expected(signature, source_sha256, public_entry, return_type, arg_names, arg_defaults) as (
  values
    ('warehouse.inspect_quality(jsonb)', '22bae64b8503088ddae797188ab31cc65ac9d1f2803cb4610dde2f53053e0e7e', true, 'jsonb', array['payload'], null::text),
    ('private.warehouse_inspect_quality_v3(jsonb)', '0976b8ae08e6fde7ea7a32933cfde3b18ecf9f49adb923a1182a29fdb3d648c7', false, 'jsonb', array['payload'], null),
    ('private.warehouse_inspect_quality_v2(jsonb)', '95c3b4c38f4666cc7f0a66e3d2f78729e09d3c60544aa6fa22c570b732eee119', false, 'jsonb', array['payload'], null),
    ('private.inspect_return_intake(jsonb)', '53c512e6a70ad8d2dfca59e5b03c55742569d84f7ace18d58025546b7ac47ae8', false, 'jsonb', array['payload'], null),
    ('private.external_po_inspect(jsonb)', '528208f18b67ded84867bddda998fe0f4e52b9f2e8fd749dd19cf97a5191755f', false, 'jsonb', array['payload'], null),
    ('private.external_po_check_evidence(jsonb,text,jsonb)', 'a2477d419c83c7ec9b8022b8ef360910404a79fdba41dd3926e4a180bf6b0048', false, 'void', array['values_json','bucket','retained'], '''[]''::jsonb'),
    ('private.guard_external_po_hold()', '7140cf9b4082fe9d2281e385e5f2e30c82e89eae9c71701b073e48ee0e031029', false, 'trigger', null::text[], null)
)
select coalesce(count(p.oid) = 7 and bool_and(
  p.prokind = 'f' and p.prosecdef
  and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
  and coalesce(p.proconfig @> array['search_path=""']::text[], false)
  and p.prorettype = expected.return_type::pg_catalog.regtype
  and p.proargnames is not distinct from expected.arg_names
  and pg_catalog.pg_get_expr(p.proargdefaults, 0) is not distinct from expected.arg_defaults
  and pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    pg_catalog.replace(p.prosrc, pg_catalog.chr(13) || pg_catalog.chr(10), pg_catalog.chr(10)),
    'UTF8')), 'hex') = expected.source_sha256
  and not pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
  and pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE') = expected.public_entry
), false)
and exists (
  select 1 from pg_catalog.pg_trigger t
  where t.tgrelid = pg_catalog.to_regclass('warehouse.inventory_holds')
    and t.tgname = 'guard_external_po_hold'
    and t.tgfoid = pg_catalog.to_regprocedure('private.guard_external_po_hold()')
    and t.tgtype = 27 and t.tgenabled = 'O' and not t.tgisinternal
    and t.tgqual is null and t.tgnargs = 0 and t.tgattr = ''::pg_catalog.int2vector
)
from expected
left join pg_catalog.pg_proc p on p.oid = pg_catalog.to_regprocedure(expected.signature)
`;
