-- Mwell Intra — warehouse DEMO Supabase Auth users  (OPTIONAL / NON-PRODUCTION)
--
-- ############################################################################
-- ## DEMO SEED — DISABLED BY DEFAULT. DO NOT APPLY TO PRODUCTION AS-IS.      ##
-- ##                                                                        ##
-- ## This provisions one real Supabase Auth account per warehouse demo role ##
-- ## (role-tile login), all sharing the demo password `mWell-Demo-2026!`,   ##
-- ## and wires each into the AUTHORITATIVE monorepo RBAC (core.profiles +    ##
-- ## core.user_roles). Because it seeds a shared, well-known password it is  ##
-- ## gated behind a runtime flag and is a NO-OP unless explicitly enabled.   ##
-- ##                                                                        ##
-- ## To seed (local / preview ONLY), set the flag in the SAME session that   ##
-- ## applies this migration, e.g.:                                          ##
-- ##     set mwell.seed_demo = 'on';   -- then run `supabase db push`        ##
-- ## or persist it for a dev database:                                      ##
-- ##     alter database postgres set mwell.seed_demo = 'on';                 ##
-- ## Leave it unset in production; the block below simply does nothing.      ##
-- ##                                                                        ##
-- ## Security is NOT weakened: no policies/grants change here, authorization ##
-- ## is still core.has_cap() reading core.user_roles, and the accounts are   ##
-- ## normal authenticated users with only warehouse demo roles + core:staff. ##
-- ############################################################################
--
-- RBAC model: unlike the source warehouse migration (which stored a single
-- app_metadata.role string), the monorepo carries scoped roles in
-- app_metadata.roles = {"warehouse":[...],"core":["staff"]} for client gating,
-- and the AUTHORITATIVE assignments live in core.user_roles. Each demo user gets
-- its warehouse role + the baseline core:staff role (per the seed_rbac note, so
-- has_any_cap() reads for shared master data resolve). Idempotent: existing
-- emails are reused; profile + role rows are upserted.

create extension if not exists "pgcrypto";

do $$
declare
  u jsonb;
  uid uuid;
  accounts jsonb := '[
    {"email":"marco.reyes@mwell.com.ph","role":"logistics_supervisor","name":"Marco Reyes","title":"Warehouse Supervisor"},
    {"email":"joana.cruz@mwell.com.ph","role":"operations","name":"Joana Cruz","title":"eCommerce Operations Manager"},
    {"email":"liza.tan@mwell.com.ph","role":"finance","name":"Liza Tan","title":"Finance Manager"},
    {"email":"kevin.uy@mwell.com.ph","role":"bi_analyst","name":"Kevin Uy","title":"BI Analyst"},
    {"email":"patricia.lim@mwell.com.ph","role":"business_unit","name":"Patricia Lim","title":"Business Unit Head"},
    {"email":"miguel.santos@mwell.com.ph","role":"marketing","name":"Miguel Santos","title":"Marketing Lead"},
    {"email":"grace.velasco@mwell.com.ph","role":"procurement","name":"Grace Velasco","title":"Procurement Officer"},
    {"email":"daniel.co@mwell.com.ph","role":"pricing","name":"Daniel Co","title":"Pricing Analyst"}
  ]'::jsonb;
begin
  -- Guard: no-op unless the operator explicitly opts in for this session/db.
  if coalesce(current_setting('mwell.seed_demo', true), '') <> 'on' then
    raise notice 'warehouse demo users skipped (set mwell.seed_demo=''on'' to seed).';
    return;
  end if;

  for u in select * from jsonb_array_elements(accounts)
  loop
    -- 1) Resolve (or create) the Supabase Auth user.
    select id into uid from auth.users where email = u->>'email';
    if uid is null then
      uid := gen_random_uuid();
      insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password,
        email_confirmed_at, created_at, updated_at, last_sign_in_at,
        raw_app_meta_data, raw_user_meta_data,
        confirmation_token, recovery_token, email_change_token_new, email_change,
        is_sso_user, is_anonymous
      ) values (
        '00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated',
        u->>'email', crypt('mWell-Demo-2026!', gen_salt('bf')),
        now(), now(), now(), null,
        jsonb_build_object(
          'provider','email',
          'providers', jsonb_build_array('email'),
          'kind','employee',
          -- Scoped roles snapshot for client gating (authoritative check is core.has_cap).
          'roles', jsonb_build_object(
            'warehouse', jsonb_build_array(u->>'role'),
            'core', jsonb_build_array('staff')
          )
        ),
        jsonb_build_object('name', u->>'name', 'title', u->>'title'),
        '', '', '', '',
        false, false
      );
      insert into auth.identities (
        provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
      ) values (
        uid::text, uid,
        jsonb_build_object('sub', uid::text, 'email', u->>'email', 'email_verified', true, 'phone_verified', false),
        'email', now(), now(), now()
      );
    else
      -- Keep the scoped-roles claim current for pre-existing demo users.
      update auth.users
        set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
          || jsonb_build_object(
               'kind','employee',
               'roles', jsonb_build_object(
                 'warehouse', jsonb_build_array(u->>'role'),
                 'core', jsonb_build_array('staff')
               )
             )
      where id = uid;
    end if;

    -- 2) core.profiles (authoritative identity; id = auth.users.id).
    insert into core.profiles (id, email, full_name, title, kind, status)
    values (uid, u->>'email', u->>'name', u->>'title', 'employee', 'active')
    on conflict (id) do update set
      email     = excluded.email,
      full_name = excluded.full_name,
      title     = excluded.title,
      kind      = 'employee',
      status    = 'active';

    -- 3) core.user_roles — the authoritative scoped assignments (what has_cap reads).
    insert into core.user_roles (user_id, module, role)
    values (uid, 'warehouse', u->>'role')
    on conflict (user_id, module, role) do nothing;
    insert into core.user_roles (user_id, module, role)
    values (uid, 'core', 'staff')
    on conflict (user_id, module, role) do nothing;
  end loop;
end $$;
