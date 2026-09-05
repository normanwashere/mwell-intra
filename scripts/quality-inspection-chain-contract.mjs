// Reviewed Aug26 custody + Aug28 return routing, with the repaired v2 fallback.
// Fingerprints pin complete guarded bodies, not permissive delegate-name matches.
// Only CRLF/LF encoding is normalized. A body change requires explicit review.
export const QUALITY_CHAIN_CONTRACT_SQL = `
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
`;
