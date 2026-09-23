-- Inactive, private authority metadata only. No source access, credentials,
-- PostgREST configuration, operational ACL changes, or seeded principals.
begin;
set local createrole_self_grant = '';

-- Deliberately fail on a name collision instead of adopting a pre-existing role.
create role reporting_authority_owner nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
create role reporting_authority_reader nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
create role reporting_authority_admin nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
do $$ begin
  execute format('grant reporting_authority_owner to %I with set true', current_user);
end $$;
create schema reporting_authority authorization reporting_authority_owner;
set local role reporting_authority_owner;

revoke all on schema reporting_authority from public, anon, authenticated, service_role;
grant usage on schema reporting_authority to reporting_authority_reader, reporting_authority_admin;
alter default privileges revoke execute on functions from public;
alter default privileges in schema reporting_authority revoke all on tables from public, anon, authenticated, service_role;
alter default privileges in schema reporting_authority revoke all on sequences from public, anon, authenticated, service_role;

create domain reporting_authority.opaque_id as text collate "C" not null
  check (value ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$');
create domain reporting_authority.client_key as text collate "C" not null
  check (length(value) between 1 and 256 and value ~ '^[!-~]+$');
-- An intentionally conservative HTTPS issuer subset. Exact-match identity only;
-- no discovery, URL fetching, normalization, userinfo, ports, queries or fragments.
create domain reporting_authority.issuer_key as text collate "C" not null
  check (length(value) between 9 and 2048 and
    value ~ '^https://[A-Za-z0-9][A-Za-z0-9.-]*(/[A-Za-z0-9._~!$&''()*+,;=:%/-]*)?$');

create function reporting_authority._valid_ids(ids text[], maximum integer, pattern text)
returns boolean language sql immutable security definer set search_path = pg_catalog, pg_temp as $$
  select coalesce(array_ndims(ids) = 1 and array_lower(ids,1) = 1
    and cardinality(ids) between 1 and maximum
    and not exists(select 1 from unnest(ids) v where v is null or v collate "C" !~ pattern)
    and cardinality(ids) = (select count(distinct v collate "C") from unnest(ids) v), false)
$$;

create table reporting_authority.principals (
  principal_id uuid primary key default gen_random_uuid(),
  issuer reporting_authority.issuer_key not null,
  client_id reporting_authority.client_key not null,
  environment reporting_authority.opaque_id not null,
  active boolean not null default false,
  created_at timestamptz not null default clock_timestamp(),
  unique (issuer, client_id, environment)
);
create table reporting_authority.current_grants (
  principal_id uuid primary key references reporting_authority.principals(principal_id),
  dataset_ids text[] not null,
  consumer_ids text[] not null,
  bundle_version reporting_authority.opaque_id not null,
  scope_epoch uuid not null default gen_random_uuid(),
  disclosure_epoch uuid not null default gen_random_uuid(),
  constraint dataset_ids_bounded check (reporting_authority._valid_ids(dataset_ids,30,'^[a-z_]+\.[a-z_]+$')),
  constraint dataset_ids_catalog check (dataset_ids <@ array[
    'warehouse.products','warehouse.locations','warehouse.bins','warehouse.lots',
    'warehouse.inventory_units','warehouse.inventory_positions','warehouse.movements',
    'warehouse.receipts','warehouse.inspections','warehouse.holds','warehouse.allocations',
    'warehouse.department_requests','warehouse.fulfillment_orders','warehouse.shipment_events',
    'warehouse.return_cases','warehouse.vendor_returns','warehouse.cycle_counts',
    'warehouse.kit_definitions','warehouse.rekit_work_orders','procurement.suppliers',
    'procurement.requests','procurement.approvals','procurement.sourcing_events',
    'procurement.quotations','procurement.purchase_orders','procurement.purchase_order_lines',
    'procurement.amendments','procurement.receipts','procurement.payment_readiness','reference.links'
  ]::text[]),
  constraint consumer_ids_bounded check (reporting_authority._valid_ids(consumer_ids,100,'^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'))
);
-- Compromise applies to the issuer/client pair across all environments, including
-- identities not registered yet. No FK or cascading deletion can erase the deny.
create table reporting_authority.denied_clients (
  issuer reporting_authority.issuer_key not null,
  client_id reporting_authority.client_key not null,
  denied_at timestamptz not null default clock_timestamp(),
  change_ref reporting_authority.opaque_id not null,
  primary key (issuer, client_id)
);
create table reporting_authority.admin_audit (
  audit_id uuid primary key default gen_random_uuid(),
  recorded_at timestamptz not null default clock_timestamp(),
  session_actor name not null,
  action text not null check (action in ('register_principal','set_grant','set_active','rotate_disclosure','deny_client')),
  principal_id uuid,
  change_ref reporting_authority.opaque_id not null,
  before_state jsonb,
  after_state jsonb
);
alter table reporting_authority.principals enable row level security;
alter table reporting_authority.current_grants enable row level security;
alter table reporting_authority.denied_clients enable row level security;
alter table reporting_authority.admin_audit enable row level security;
-- No RLS policies and no caller table grants. Only the NOLOGIN owner, through
-- these fixed functions, bypasses RLS. The database superuser remains trust root.
revoke all on all tables in schema reporting_authority from public, anon, authenticated, service_role, reporting_authority_reader, reporting_authority_admin;

create function reporting_authority._lock_authority()
returns void language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Authority requires a fresh read committed transaction' using errcode = '25000';
  end if;
  -- Rare control-plane changes serialize here, including absent identities.
  -- Readers do not take this lock; no operational relation is touched.
  lock table reporting_authority.principals in share row exclusive mode;
end $$;

create function reporting_authority._reject_mutation()
returns trigger language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
begin
  raise exception 'Authority identity and history are immutable / append-only' using errcode = '23000';
end $$;

create function reporting_authority._guard_principal()
returns trigger language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
begin
  if tg_op = 'UPDATE' and (new.principal_id,new.issuer,new.client_id,new.environment,new.created_at)
    is distinct from (old.principal_id,old.issuer,old.client_id,old.environment,old.created_at) then
    raise exception 'Principal identity is immutable' using errcode = '23000';
  end if;
  perform reporting_authority._lock_authority();
  if (tg_op = 'INSERT' or new.active) and exists (
    select 1 from reporting_authority.denied_clients d where d.issuer=new.issuer and d.client_id=new.client_id
  ) then
    raise exception 'Client identity permanently denied' using errcode = '23000';
  end if;
  if new.active and not exists (select 1 from reporting_authority.current_grants g where g.principal_id=new.principal_id) then
    raise exception 'An explicit grant is required before activation' using errcode = '23000';
  end if;
  if tg_op = 'UPDATE' and new.active is distinct from old.active then
    update reporting_authority.current_grants set scope_epoch=gen_random_uuid() where principal_id=new.principal_id;
  end if;
  return new;
end $$;

create function reporting_authority._guard_grant()
returns trigger language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
begin
  if tg_op = 'UPDATE' and new.principal_id is distinct from old.principal_id then
    raise exception 'Grant identity is immutable' using errcode = '23000';
  end if;
  if tg_op = 'UPDATE' and (new.dataset_ids,new.consumer_ids,new.bundle_version)
    is distinct from (old.dataset_ids,old.consumer_ids,old.bundle_version) then
    new.scope_epoch := gen_random_uuid();
  end if;
  return new;
end $$;

create function reporting_authority._apply_deny()
returns trigger language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
begin
  perform reporting_authority._lock_authority();
  update reporting_authority.principals set active=false where issuer=new.issuer and client_id=new.client_id;
  update reporting_authority.current_grants g set scope_epoch=gen_random_uuid(), disclosure_epoch=gen_random_uuid()
    from reporting_authority.principals p where p.principal_id=g.principal_id and p.issuer=new.issuer and p.client_id=new.client_id;
  return new;
end $$;

create trigger principal_guard before insert or update on reporting_authority.principals
  for each row execute function reporting_authority._guard_principal();
create trigger principal_no_delete before delete on reporting_authority.principals
  for each row execute function reporting_authority._reject_mutation();
create trigger principal_no_truncate before truncate on reporting_authority.principals
  for each statement execute function reporting_authority._reject_mutation();
create trigger grant_guard before update on reporting_authority.current_grants
  for each row execute function reporting_authority._guard_grant();
create trigger grant_no_delete before delete on reporting_authority.current_grants
  for each row execute function reporting_authority._reject_mutation();
create trigger grant_no_truncate before truncate on reporting_authority.current_grants
  for each statement execute function reporting_authority._reject_mutation();
create trigger deny_apply after insert on reporting_authority.denied_clients
  for each row execute function reporting_authority._apply_deny();
create trigger deny_immutable before update or delete on reporting_authority.denied_clients
  for each row execute function reporting_authority._reject_mutation();
create trigger deny_no_truncate before truncate on reporting_authority.denied_clients
  for each statement execute function reporting_authority._reject_mutation();
create trigger audit_immutable before update or delete on reporting_authority.admin_audit
  for each row execute function reporting_authority._reject_mutation();
create trigger audit_no_truncate before truncate on reporting_authority.admin_audit
  for each statement execute function reporting_authority._reject_mutation();

create function reporting_authority._snapshot(id uuid)
returns jsonb language sql volatile security definer set search_path = pg_catalog, pg_temp as $$
  select jsonb_build_object('principal',to_jsonb(p),'grant',to_jsonb(g))
    from reporting_authority.principals p left join reporting_authority.current_grants g using(principal_id)
    where p.principal_id=id
$$;

create function reporting_authority._audit(event text, id uuid, ref text, previous jsonb, next_state jsonb)
returns void language sql volatile security definer set search_path = pg_catalog, pg_temp as $$
  insert into reporting_authority.admin_audit(session_actor,action,principal_id,change_ref,before_state,after_state)
    values(session_user,event,id,ref,previous,next_state)
$$;

create function reporting_authority.register_principal(issuer_value text, client_value text, environment_value text, change_ref text)
returns uuid language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare id uuid;
begin
  perform reporting_authority._lock_authority();
  insert into reporting_authority.principals(issuer,client_id,environment)
    values(issuer_value,client_value,environment_value) returning principal_id into id;
  perform reporting_authority._audit('register_principal',id,change_ref,null,reporting_authority._snapshot(id));
  return id;
end $$;

create function reporting_authority.set_grant(id uuid, datasets text[], consumers text[], bundle text, change_ref text)
returns void language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare previous jsonb;
begin
  perform reporting_authority._lock_authority();
  previous := reporting_authority._snapshot(id);
  if previous is null then raise exception 'Unknown principal' using errcode = '22023'; end if;
  if exists(select 1 from reporting_authority.principals p join reporting_authority.denied_clients d using(issuer,client_id)
    where p.principal_id=id) then raise exception 'Client identity permanently denied' using errcode = '23000'; end if;
  -- Validate before canonicalization: duplicate/NULL/multidimensional inputs must
  -- never be silently repaired into a different authority request.
  if not reporting_authority._valid_ids(datasets,30,'^[a-z_]+\.[a-z_]+$') or
    not reporting_authority._valid_ids(consumers,100,'^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$') then
    raise exception 'Invalid explicit grant arrays' using errcode = '22023';
  end if;
  insert into reporting_authority.current_grants(principal_id,dataset_ids,consumer_ids,bundle_version)
    values(id,array(select v from unnest(datasets) v order by v collate "C"),
      array(select v from unnest(consumers) v order by v collate "C"),bundle)
    on conflict (principal_id) do update set dataset_ids=excluded.dataset_ids,
      consumer_ids=excluded.consumer_ids,bundle_version=excluded.bundle_version;
  perform reporting_authority._audit('set_grant',id,change_ref,previous,reporting_authority._snapshot(id));
end $$;

create function reporting_authority.set_active(id uuid, enabled boolean, change_ref text)
returns void language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare previous jsonb;
begin
  perform reporting_authority._lock_authority();
  previous := reporting_authority._snapshot(id);
  if previous is null then raise exception 'Unknown principal' using errcode = '22023'; end if;
  update reporting_authority.principals set active=enabled where principal_id=id;
  perform reporting_authority._audit('set_active',id,change_ref,previous,reporting_authority._snapshot(id));
end $$;

create function reporting_authority.rotate_disclosure(id uuid, change_ref text)
returns void language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare previous jsonb;
begin
  perform reporting_authority._lock_authority();
  previous := reporting_authority._snapshot(id);
  update reporting_authority.current_grants set disclosure_epoch=gen_random_uuid() where principal_id=id;
  if not found then raise exception 'An explicit grant is required' using errcode = '22023'; end if;
  perform reporting_authority._audit('rotate_disclosure',id,change_ref,previous,reporting_authority._snapshot(id));
end $$;

create function reporting_authority.deny_client(issuer_value text, client_value text, change_ref text)
returns void language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare previous jsonb; next_state jsonb;
begin
  perform reporting_authority._lock_authority();
  select to_jsonb(d) into previous from reporting_authority.denied_clients d where issuer=issuer_value and client_id=client_value;
  insert into reporting_authority.denied_clients(issuer,client_id,change_ref)
    values(issuer_value,client_value,change_ref) on conflict (issuer,client_id) do nothing;
  select to_jsonb(d) into next_state from reporting_authority.denied_clients d where issuer=issuer_value and client_id=client_value;
  perform reporting_authority._audit('deny_client',null,change_ref,previous,next_state);
end $$;

create function reporting_authority.read_current_grant(issuer_value text, client_value text, environment_value text)
returns jsonb language plpgsql volatile security definer set search_path = pg_catalog, pg_temp as $$
declare result jsonb;
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Authority requires a fresh read committed transaction' using errcode = '25000';
  end if;
  if issuer_value is null or length(issuer_value) > 2048 or client_value is null or length(client_value) > 256
    or environment_value is null or length(environment_value) > 128 then return null; end if;
  select jsonb_build_object('principal_id',p.principal_id,'issuer',p.issuer,'client_id',p.client_id,
    'environment',p.environment,'active',p.active,'permanently_denied',d.client_id is not null,
    'scope_epoch',g.scope_epoch,'disclosure_epoch',g.disclosure_epoch,'bundle_version',g.bundle_version,
    'dataset_ids',g.dataset_ids,'consumer_ids',g.consumer_ids) into result
    from reporting_authority.principals p join reporting_authority.current_grants g using(principal_id)
    left join reporting_authority.denied_clients d on d.issuer=p.issuer and d.client_id=p.client_id
    where p.issuer=issuer_value and p.client_id=client_value and p.environment=environment_value;
  return result;
end $$;

-- List every signature explicitly. Internal helpers/trigger functions have no
-- delegated EXECUTE; the reader has exactly one scalar identity lookup.
revoke all on function reporting_authority._valid_ids(text[],integer,text),
  reporting_authority._lock_authority(), reporting_authority._reject_mutation(),
  reporting_authority._guard_principal(), reporting_authority._guard_grant(), reporting_authority._apply_deny(),
  reporting_authority._snapshot(uuid), reporting_authority._audit(text,uuid,text,jsonb,jsonb),
  reporting_authority.register_principal(text,text,text,text), reporting_authority.set_grant(uuid,text[],text[],text,text),
  reporting_authority.set_active(uuid,boolean,text), reporting_authority.rotate_disclosure(uuid,text),
  reporting_authority.deny_client(text,text,text), reporting_authority.read_current_grant(text,text,text)
  from public, anon, authenticated, service_role, reporting_authority_reader, reporting_authority_admin;
grant execute on function reporting_authority.read_current_grant(text,text,text) to reporting_authority_reader;
grant execute on function reporting_authority.register_principal(text,text,text,text),
  reporting_authority.set_grant(uuid,text[],text[],text,text), reporting_authority.set_active(uuid,boolean,text),
  reporting_authority.rotate_disclosure(uuid,text), reporting_authority.deny_client(text,text,text)
  to reporting_authority_admin;

reset role;
-- Remove our temporary SET membership. PG17's bootstrap-granted ADMIN OPTION
-- memberships for a non-superuser creator remain (SET/INHERIT both false).
-- Only a superuser can revoke those; the migration operator is a trust root.
do $$ begin
  execute format('revoke reporting_authority_owner from %I', current_user);
end $$;
commit;
