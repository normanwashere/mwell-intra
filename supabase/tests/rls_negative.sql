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
--   5) A PO for an UN-ACCREDITED vendor cannot transition to approved/issued
--      (the `purchase_orders_accreditation_gate` trigger fires even for a
--      superuser/service_role update — Step 3d backstop).
--   6) A caller WITHOUT `procurement.approve_award` cannot call
--      `procurement.approve_purchase_order` (capability gate).
--   7) Vendor A cannot read vendor B's `legal.accreditation_cases` or
--      checklist items (vendor-tier RLS on the legal schema).
--   8) A warehouse-only user cannot read `procurement.requests` or
--      `legal.accreditation_cases` (module read isolation).
--   9) A caller whose role does not map to the NEXT pending tier cannot
--      `procurement.decide_request_step` out of turn.
--  10) An approval without a signature payload is rejected by
--      `procurement.decide_request_step` (RA 8792 e-signature guard).
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
  '00000000-0000-0000-0000-0000000A0003'::uuid as vendor_c_id,          -- NOT accredited
  '00000000-0000-0000-0000-0000000B0001'::uuid as vendor_a_user_id,
  '00000000-0000-0000-0000-0000000B0002'::uuid as warehouse_user_id,    -- warehouse-only staff
  '00000000-0000-0000-0000-0000000B0003'::uuid as approver_user_id,     -- procurement:approver (dept_head tier)
  '00000000-0000-0000-0000-0000000B0004'::uuid as finance_user_id,      -- procurement:finance (finance tier)
  '00000000-0000-0000-0000-0000000C0001'::uuid as po_unaccredited_id,
  '00000000-0000-0000-0000-0000000D0001'::uuid as doc_for_vendor_b_id,
  '00000000-0000-0000-0000-0000000E0001'::uuid as case_for_vendor_a_id,
  '00000000-0000-0000-0000-0000000E0002'::uuid as case_for_vendor_b_id,
  '00000000-0000-0000-0000-0000000E0003'::uuid as checklist_for_vendor_b_id,
  '00000000-0000-0000-0000-0000000F0001'::uuid as request_id;

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

-- Vendor C is NOT accredited (still 'submitted') — award gate must refuse it.
insert into core.vendors (id, legal_name, category, accreditation_status, owner_module)
select vendor_c_id, '_rls_test_vendor_c', 'test', 'submitted', 'legal'
from _rls_fixtures
on conflict (id) do nothing;

-- Three employee-kind auth users: warehouse-only staff, a procurement
-- approver (dept_head tier), and procurement finance (finance tier).
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  is_sso_user, is_anonymous
)
select
  '00000000-0000-0000-0000-000000000000',
  u.id,
  'authenticated', 'authenticated',
  u.email,
  crypt('_rls_test_password!42', gen_salt('bf')),
  now(), now(), now(),
  jsonb_build_object(
    'provider', 'email',
    'providers', jsonb_build_array('email'),
    'kind', 'employee',
    'roles', u.roles
  ),
  '{}'::jsonb,
  '', '', '', '',
  false, false
from _rls_fixtures f,
lateral (values
  (f.warehouse_user_id, '_rls_test_warehouse@mwell.test',
   jsonb_build_object('warehouse', jsonb_build_array('operations'))),
  (f.approver_user_id,  '_rls_test_approver@mwell.test',
   jsonb_build_object('procurement', jsonb_build_array('approver'))),
  (f.finance_user_id,   '_rls_test_finance@mwell.test',
   jsonb_build_object('procurement', jsonb_build_array('finance')))
) as u(id, email, roles)
on conflict (id) do nothing;

insert into core.profiles (id, email, full_name, kind, status)
select u.id, u.email, u.full_name, 'employee', 'active'
from _rls_fixtures f,
lateral (values
  (f.warehouse_user_id, '_rls_test_warehouse@mwell.test', '_rls_test_warehouse'),
  (f.approver_user_id,  '_rls_test_approver@mwell.test',  '_rls_test_approver'),
  (f.finance_user_id,   '_rls_test_finance@mwell.test',   '_rls_test_finance')
) as u(id, email, full_name)
on conflict (id) do update set kind = excluded.kind, status = excluded.status;

-- Authoritative scoped roles (what core.has_cap()/the tier mapping read).
-- Vendor A also gets the external legal:vendor tier so assertion 7's
-- precondition (vendor A CAN see its OWN case) is non-vacuous.
insert into core.user_roles (user_id, module, role)
select r.user_id, r.module, r.role
from _rls_fixtures f,
lateral (values
  (f.warehouse_user_id, 'warehouse',   'operations'),
  (f.approver_user_id,  'procurement', 'approver'),
  (f.finance_user_id,   'procurement', 'finance'),
  (f.vendor_a_user_id,  'legal',       'vendor')
) as r(user_id, module, role)
on conflict (user_id, module, role) do nothing;

-- Draft PO for the UN-accredited vendor C (insert as draft is allowed; the
-- gate fires on the transition INTO approved/issued).
insert into procurement.purchase_orders (id, core_vendor_id, status, origin, actor_id)
select po_unaccredited_id, vendor_c_id, 'draft', 'procurement', approver_user_id
from _rls_fixtures
on conflict (id) do nothing;

-- Legal accreditation cases: one for vendor A (assertion 7 precondition) and
-- one for vendor B with a checklist item (assertion 7 negatives).
insert into legal.accreditation_cases (id, vendor_id, status, notes)
select case_for_vendor_a_id, vendor_a_id, 'under_review', '_rls_test_case_a'
from _rls_fixtures
on conflict (id) do nothing;

insert into legal.accreditation_cases (id, vendor_id, status, notes)
select case_for_vendor_b_id, vendor_b_id, 'under_review', '_rls_test_case_b'
from _rls_fixtures
on conflict (id) do nothing;

insert into legal.requirement_checklist_items (id, case_id, requirement_code, label, status)
select checklist_for_vendor_b_id, case_for_vendor_b_id, '_rls_test_req', '_rls_test_requirement', 'pending'
from _rls_fixtures
on conflict (id) do nothing;

-- Submitted procurement request + its pending ladder (dept_head is next).
-- Requester = vendor A user so neither the warehouse user (assertion 8) nor
-- the approver/finance users own it.
insert into procurement.requests (id, title, requester_id, status, estimated_amount)
select request_id, '_rls_test_request', vendor_a_user_id, 'submitted', 50000
from _rls_fixtures
on conflict (id) do nothing;

insert into procurement.approval_steps (request_id, step_order, tier, status, label)
select f.request_id, s.step_order, s.tier, 'pending', s.label
from _rls_fixtures f,
lateral (values
  (1, 'dept_head',        'Department Head'),
  (2, 'procurement_head', 'Procurement Head'),
  (3, 'final_approver',   'Final Approver (DOA)')
) as s(step_order, tier, label)
on conflict (request_id, step_order) do nothing;

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
-- Assertion 5 — a PO whose vendor is NOT accredited cannot reach
-- approved/issued. The `purchase_orders_accreditation_gate` trigger is the
-- backstop: even this superuser update must fail with check_violation.
-- ---------------------------------------------------------------------------
do $$
declare v_po uuid;
begin
  select po_unaccredited_id into v_po from _rls_fixtures;
  begin
    update procurement.purchase_orders set status = 'approved' where id = v_po;
    raise exception 'FAIL[5a]: PO for un-accredited vendor transitioned to approved (no error raised)';
  exception
    when check_violation then
      raise notice 'PASS[5a]: un-accredited award to approved blocked (%)', sqlerrm;
  end;
  begin
    update procurement.purchase_orders set status = 'issued' where id = v_po;
    raise exception 'FAIL[5b]: PO for un-accredited vendor transitioned to issued (no error raised)';
  exception
    when check_violation then
      raise notice 'PASS[5b]: un-accredited award to issued blocked (%)', sqlerrm;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- Assertion 6 — a caller WITHOUT procurement.approve_award cannot call
-- procurement.approve_purchase_order. Vendor A's session holds only
-- core:vendor_portal + legal:vendor — the capability gate must raise.
-- ---------------------------------------------------------------------------
do $$
declare v_user uuid; v_po uuid; claims text;
begin
  select vendor_a_user_id, po_unaccredited_id into v_user, v_po from _rls_fixtures;
  claims := format(
    '{"sub":"%s","role":"authenticated","aud":"authenticated","app_metadata":{"kind":"vendor","roles":{"core":["vendor_portal"]}}}',
    v_user
  );
  perform set_config('request.jwt.claims', claims, true);
  set local role authenticated;
  begin
    perform procurement.approve_purchase_order(jsonb_build_object('id', v_po));
    reset role;
    raise exception 'FAIL[6]: non-approver called approve_purchase_order (no error raised)';
  exception
    when raise_exception then
      if sqlerrm like 'FAIL[6]%' then raise; end if;
      if sqlerrm not like 'Not authorized%' then
        reset role;
        raise exception 'FAIL[6]: approve_purchase_order raised the WRONG error: %', sqlerrm;
      end if;
      raise notice 'PASS[6]: approve_purchase_order capability gate held (%)', sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
end $$;

-- ---------------------------------------------------------------------------
-- Assertion 7 — vendor A cannot read vendor B's legal.accreditation_cases or
-- checklist items. Precondition: vendor A (holding legal:vendor) sees its OWN
-- case, so the negative isn't vacuous.
-- ---------------------------------------------------------------------------
do $$
declare
  cnt int; v_user uuid; v_case_a uuid; v_case_b uuid; v_item_b uuid; claims text;
begin
  select vendor_a_user_id, case_for_vendor_a_id, case_for_vendor_b_id, checklist_for_vendor_b_id
    into v_user, v_case_a, v_case_b, v_item_b
  from _rls_fixtures;
  claims := format(
    '{"sub":"%s","role":"authenticated","aud":"authenticated","app_metadata":{"kind":"vendor","roles":{"core":["vendor_portal"],"legal":["vendor"]}}}',
    v_user
  );
  perform set_config('request.jwt.claims', claims, true);
  set local role authenticated;

  select count(*) into cnt from legal.accreditation_cases where id = v_case_a;
  if cnt <> 1 then
    reset role;
    perform set_config('request.jwt.claims', '', true);
    raise exception 'PRECOND[7]: vendor A session cannot see its OWN accreditation case (got %)', cnt;
  end if;

  select count(*) into cnt from legal.accreditation_cases where id = v_case_b;
  if cnt <> 0 then
    reset role;
    perform set_config('request.jwt.claims', '', true);
    raise exception 'FAIL[7a]: vendor A session saw % vendor-B accreditation case row(s)', cnt;
  end if;
  raise notice 'PASS[7a]: cross-vendor accreditation case read blocked (0 rows visible)';

  select count(*) into cnt from legal.requirement_checklist_items where id = v_item_b;
  if cnt <> 0 then
    reset role;
    perform set_config('request.jwt.claims', '', true);
    raise exception 'FAIL[7b]: vendor A session saw % vendor-B checklist item row(s)', cnt;
  end if;
  raise notice 'PASS[7b]: cross-vendor checklist item read blocked (0 rows visible)';

  reset role;
  perform set_config('request.jwt.claims', '', true);
end $$;

-- ---------------------------------------------------------------------------
-- Assertion 8 — a warehouse-only user (warehouse:operations, no procurement/
-- legal roles) cannot read procurement.requests or legal.accreditation_cases.
-- Precondition (superuser): the fixture rows exist.
-- ---------------------------------------------------------------------------
do $$
declare cnt int; v_user uuid; v_request uuid; v_case uuid; claims text;
begin
  select warehouse_user_id, request_id, case_for_vendor_b_id
    into v_user, v_request, v_case
  from _rls_fixtures;

  select count(*) into cnt from procurement.requests where id = v_request;
  if cnt <> 1 then
    raise exception 'PRECOND[8]: procurement request fixture missing (got %)', cnt;
  end if;

  claims := format(
    '{"sub":"%s","role":"authenticated","aud":"authenticated","app_metadata":{"kind":"employee","roles":{"warehouse":["operations"]}}}',
    v_user
  );
  perform set_config('request.jwt.claims', claims, true);
  set local role authenticated;

  select count(*) into cnt from procurement.requests where id = v_request;
  if cnt <> 0 then
    reset role;
    perform set_config('request.jwt.claims', '', true);
    raise exception 'FAIL[8a]: warehouse-only user saw % procurement request row(s)', cnt;
  end if;
  raise notice 'PASS[8a]: warehouse-only read of procurement.requests blocked (0 rows visible)';

  select count(*) into cnt from legal.accreditation_cases where id = v_case;
  if cnt <> 0 then
    reset role;
    perform set_config('request.jwt.claims', '', true);
    raise exception 'FAIL[8b]: warehouse-only user saw % accreditation case row(s)', cnt;
  end if;
  raise notice 'PASS[8b]: warehouse-only read of legal.accreditation_cases blocked (0 rows visible)';

  reset role;
  perform set_config('request.jwt.claims', '', true);
end $$;

-- ---------------------------------------------------------------------------
-- Assertion 9 — a caller whose role does NOT map to the next pending tier
-- cannot decide_request_step out of turn. Next step is dept_head (maps to
-- procurement:approver); the finance-role user must be refused even with a
-- complete signature payload.
-- ---------------------------------------------------------------------------
do $$
declare v_user uuid; v_request uuid; claims text;
begin
  select finance_user_id, request_id into v_user, v_request from _rls_fixtures;
  claims := format(
    '{"sub":"%s","role":"authenticated","aud":"authenticated","app_metadata":{"kind":"employee","roles":{"procurement":["finance"]}}}',
    v_user
  );
  perform set_config('request.jwt.claims', claims, true);
  set local role authenticated;
  begin
    perform procurement.decide_request_step(jsonb_build_object(
      'request_id', v_request,
      'decision', 'approved',
      'signature', jsonb_build_object(
        'signature_png', 'data:image/png;base64,_rls_test',
        'signer_name', '_rls_test_finance',
        'signature_method', 'typed'
      )
    ));
    reset role;
    raise exception 'FAIL[9]: finance-role user decided the dept_head step out of turn (no error raised)';
  exception
    when raise_exception then
      if sqlerrm like 'FAIL[9]%' then raise; end if;
      if sqlerrm not like '%tier%' then
        reset role;
        raise exception 'FAIL[9]: decide_request_step raised the WRONG error: %', sqlerrm;
      end if;
      raise notice 'PASS[9]: out-of-turn tier decision blocked (%)', sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
end $$;

-- ---------------------------------------------------------------------------
-- Assertion 10 — an APPROVAL without a signature payload is rejected. The
-- approver user DOES hold the dept_head tier, so the only thing standing in
-- the way is the RA 8792 e-signature guard.
-- ---------------------------------------------------------------------------
do $$
declare v_user uuid; v_request uuid; claims text;
begin
  select approver_user_id, request_id into v_user, v_request from _rls_fixtures;
  claims := format(
    '{"sub":"%s","role":"authenticated","aud":"authenticated","app_metadata":{"kind":"employee","roles":{"procurement":["approver"]}}}',
    v_user
  );
  perform set_config('request.jwt.claims', claims, true);
  set local role authenticated;
  begin
    perform procurement.decide_request_step(jsonb_build_object(
      'request_id', v_request,
      'decision', 'approved',
      'note', '_rls_test approval without signature'
    ));
    reset role;
    raise exception 'FAIL[10]: approval without signature was accepted (no error raised)';
  exception
    when raise_exception then
      if sqlerrm like 'FAIL[10]%' then raise; end if;
      if sqlerrm not like '%signature%' then
        reset role;
        raise exception 'FAIL[10]: decide_request_step raised the WRONG error: %', sqlerrm;
      end if;
      raise notice 'PASS[10]: unsigned approval blocked (%)', sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
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
  raise notice '  RLS negative test suite: ALL ASSERTIONS PASSED (10/10).';
  raise notice '===============================================================';
end $$;

-- Never commit test fixtures.
rollback;
