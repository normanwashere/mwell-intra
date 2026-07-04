-- Mwell Intra — RLS + write-lockdown negative tests
--
-- Verifies that the security posture from spec §5/§6.2/§6.6 is actually
-- enforced by the DB, not just documented:
--
--   1) `authenticated` CANNOT insert into `core.vendors` directly (all
--      vendor writes go through `core.upsert_vendor` / definer RPCs).
--   2) `authenticated` CANNOT update `core.role_capabilities` (the RBAC
--      catalogue is locked down — no API grants, no policies).
--   3) A vendor-kind session CANNOT `select` other vendors' documents
--      (vendor-tier RLS is scoped to `core.current_vendor_id()`).
--   4) Warehouse tables reject direct writes to `warehouse.inventory_units`
--      and `warehouse.movements` (v4 + v6 write lockdown: RPC-only).
--
-- HOW TO RUN
--   Run against a LOCAL Supabase Postgres instance (spec §6.8: idempotent,
--   forward-only migrations already applied). The script wraps everything in
--   a single transaction and always rolls back, so it never mutates the DB:
--
--     psql "postgres://postgres:postgres@127.0.0.1:54322/postgres" \
--          -v ON_ERROR_STOP=1 -f supabase/tests/rls_negative.sql
--
--   ON_ERROR_STOP=1 makes psql exit non-zero on the first failed assertion
--   (each `raise exception` on unexpected success aborts). See
--   supabase/README.md for full setup instructions.

\set ON_ERROR_STOP on
\echo '---'
\echo 'RLS negative test suite — every case must REJECT the forbidden op.'
\echo '---'

begin;

-- ---------------------------------------------------------------------------
-- Fixtures — two vendors + one vendor-kind profile that owns vendor A only.
-- Wrapped in the outer BEGIN..ROLLBACK so nothing survives the test run.
-- ---------------------------------------------------------------------------

create temp table _rls_fixtures on commit drop as
select
  '00000000-0000-0000-0000-0000000A0001'::uuid as vendor_a_id,
  '00000000-0000-0000-0000-0000000A0002'::uuid as vendor_b_id,
  '00000000-0000-0000-0000-0000000B0001'::uuid as vendor_a_user_id,
  '00000000-0000-0000-0000-0000000D0001'::uuid as doc_for_vendor_b_id;

-- The identity FK requires a matching auth.users row (spec §5). Running as
-- postgres/superuser lets us seed it directly for the negative tests. The
-- column set mirrors the demo-users migration so the row is well-formed
-- across Supabase Auth versions (some fields NOT NULL without defaults).
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  is_sso_user, is_anonymous
)
select
  '00000000-0000-0000-0000-000000000000',
  vendor_a_user_id,
  'authenticated', 'authenticated',
  '_rls_test_vendor_a@mwell.test',
  crypt('_rls_test_password!42', gen_salt('bf')),
  now(), now(), now(),
  jsonb_build_object(
    'provider', 'email',
    'providers', jsonb_build_array('email'),
    'kind', 'vendor',
    'roles', jsonb_build_object('core', jsonb_build_array('vendor_portal'))
  ),
  '{}'::jsonb,
  '', '', '', '',
  false, false
from _rls_fixtures
on conflict (id) do nothing;

insert into core.vendors (id, legal_name, category, accreditation_status, owner_module)
select vendor_a_id, '_rls_test_vendor_a', 'test', 'approved', 'legal'
from _rls_fixtures
on conflict (id) do nothing;

insert into core.vendors (id, legal_name, category, accreditation_status, owner_module)
select vendor_b_id, '_rls_test_vendor_b', 'test', 'approved', 'legal'
from _rls_fixtures
on conflict (id) do nothing;

insert into core.profiles (id, email, full_name, kind, vendor_id, status)
select vendor_a_user_id, '_rls_test_vendor_a@mwell.test', '_rls_test_vendor_a', 'vendor', vendor_a_id, 'active'
from _rls_fixtures
on conflict (id) do update set kind = excluded.kind, vendor_id = excluded.vendor_id;

-- Document owned by vendor B (should NEVER be visible to vendor A's session).
insert into core.documents (id, entity_type, entity_id, doc_type, storage_path, version, status)
select doc_for_vendor_b_id, 'vendor', vendor_b_id, 'business_permit',
       '_rls_test/vendor_b/business_permit.pdf', 1, 'submitted'
from _rls_fixtures
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Assertion 1 — `authenticated` CANNOT insert into core.vendors directly
--   Guard: `revoke insert on core.vendors from authenticated` (core RLS
--   migration) + RLS enabled. Expected: 42501 insufficient_privilege.
--   We only catch insufficient_privilege — an unexpected success falls
--   through to `raise exception 'FAIL[…]'` which propagates and aborts.
-- ---------------------------------------------------------------------------
do $$
begin
  set local role authenticated;
  begin
    insert into core.vendors (legal_name, category) values ('_rls_should_fail', 'test');
    -- Restore role BEFORE re-raising, so the outer psql can print the
    -- notice under the superuser context (authenticated may lack log privs).
    reset role;
    raise exception 'FAIL[1]: authenticated inserted into core.vendors directly (no error raised)';
  exception
    when insufficient_privilege then
      raise notice 'PASS[1]: core.vendors direct insert blocked (%)', sqlerrm;
  end;
  reset role;
end $$;

-- ---------------------------------------------------------------------------
-- Assertion 2 — `authenticated` CANNOT update core.role_capabilities
--   Guard: the catalogue table has RLS enabled, NO policies, and privileges
--   were revoked from authenticated. Only SECURITY DEFINER helpers touch it.
-- ---------------------------------------------------------------------------
do $$
begin
  set local role authenticated;
  begin
    update core.role_capabilities set cap = cap where module = 'core';
    reset role;
    raise exception 'FAIL[2]: authenticated updated core.role_capabilities (no error raised)';
  exception
    when insufficient_privilege then
      raise notice 'PASS[2]: core.role_capabilities update blocked (%)', sqlerrm;
  end;
  reset role;
end $$;

-- ---------------------------------------------------------------------------
-- Assertion 3 — vendor-kind session CANNOT see other vendors' documents
--   Guard: `read_documents` policy grants SELECT only when (a) the caller
--   holds `view_documents`, (b) is the uploader, or (c) is the vendor whose
--   `vendor_id` matches the document's `entity_id`. Vendor A's session fails
--   all three for a vendor B document → 0 rows visible.
-- ---------------------------------------------------------------------------
do $$
declare
  cnt        int;
  v_user     uuid;
  v_vendor_a uuid;
  v_doc      uuid;
  claims     text;
begin
  select vendor_a_user_id, vendor_a_id, doc_for_vendor_b_id
    into v_user, v_vendor_a, v_doc
  from _rls_fixtures;

  claims := format(
    '{"sub":"%s","role":"authenticated","aud":"authenticated","app_metadata":{"kind":"vendor","roles":{"core":["vendor_portal"]}}}',
    v_user
  );
  perform set_config('request.jwt.claims', claims, true);
  set local role authenticated;

  -- Sanity: our vendor A session sees its OWN vendor record (RLS is not
  -- accidentally blocking everything — the negative test would be vacuous).
  select count(*) into cnt from core.vendors where id = v_vendor_a;
  if cnt <> 1 then
    reset role;
    perform set_config('request.jwt.claims', '', true);
    raise exception 'PRECOND[3]: vendor A session cannot see its OWN vendor row (got %)', cnt;
  end if;

  -- Negative: vendor A must NOT see vendor B's document.
  select count(*) into cnt from core.documents where id = v_doc;
  if cnt <> 0 then
    reset role;
    perform set_config('request.jwt.claims', '', true);
    raise exception 'FAIL[3]: vendor A session saw % vendor-B document row(s)', cnt;
  end if;

  raise notice 'PASS[3]: cross-vendor document read blocked (0 rows visible)';
  reset role;
  perform set_config('request.jwt.claims', '', true);
end $$;

-- ---------------------------------------------------------------------------
-- Assertion 4 — `authenticated` CANNOT write warehouse.inventory_units or
-- warehouse.movements directly (v4/v6 write lockdown; RPCs are the only path).
-- ---------------------------------------------------------------------------
do $$
begin
  set local role authenticated;
  begin
    insert into warehouse.inventory_units
      (id, product_id, serial_number, location_id, status)
    values
      ('_rls_should_fail_unit', 'prod-x', 'SN-RLS-1', 'loc-x', 'available');
    reset role;
    raise exception 'FAIL[4a]: authenticated inserted into warehouse.inventory_units (no error raised)';
  exception
    when insufficient_privilege then
      raise notice 'PASS[4a]: warehouse.inventory_units insert blocked (%)', sqlerrm;
  end;

  begin
    insert into warehouse.movements
      (id, type, product_id, quantity, from_location_id, to_location_id)
    values
      ('_rls_should_fail_move', 'transfer', 'prod-x', 1, 'loc-a', 'loc-b');
    reset role;
    raise exception 'FAIL[4b]: authenticated inserted into warehouse.movements (no error raised)';
  exception
    when insufficient_privilege then
      raise notice 'PASS[4b]: warehouse.movements insert blocked (%)', sqlerrm;
  end;
  reset role;
end $$;

-- ---------------------------------------------------------------------------
-- Reaching this point means every negative expectation was met (each
-- assertion above `raise exception`s on unexpected success and would have
-- aborted the script under `ON_ERROR_STOP=1`).
-- ---------------------------------------------------------------------------
do $$
begin
  raise notice '';
  raise notice '===============================================================';
  raise notice '  RLS negative test suite: ALL ASSERTIONS PASSED (4/4).';
  raise notice '===============================================================';
end $$;

-- Never commit test fixtures.
rollback;
