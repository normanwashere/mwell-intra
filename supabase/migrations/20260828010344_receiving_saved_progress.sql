-- Unfinished receiving work only. These commands never create receipts, units,
-- movements, or stock. A cleared row retains its revision to prevent ABA writes.
create or replace function private.valid_receiving_draft_body(p_body jsonb)
returns boolean
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v_node record;
  v_count integer := 0;
  v_key text;
begin
  if p_body is null or pg_catalog.jsonb_typeof(p_body) <> 'object'
     or p_body->'version' is distinct from '1'::jsonb
     or pg_catalog.octet_length(p_body::text) > 65536 then
    return false;
  end if;
  for v_node in
    with recursive nodes(value, depth) as (
      select p_body, 0
      union all
      select child.value, nodes.depth + 1
      from nodes
      cross join lateral (
        select item.value from pg_catalog.jsonb_each(
          case when pg_catalog.jsonb_typeof(nodes.value) = 'object'
            then nodes.value else '{}'::jsonb end
        ) item
        union all
        select item.value from pg_catalog.jsonb_array_elements(
          case when pg_catalog.jsonb_typeof(nodes.value) = 'array'
            then nodes.value else '[]'::jsonb end
        ) item
      ) child
      where nodes.depth <= 16
    ) select * from nodes
  loop
    v_count := v_count + 1;
    if v_count > 10000 or v_node.depth > 16 then return false; end if;
    if pg_catalog.jsonb_typeof(v_node.value) = 'array' then
      if pg_catalog.jsonb_array_length(v_node.value) > 1000 then return false; end if;
    elsif pg_catalog.jsonb_typeof(v_node.value) = 'object' then
      if (select count(*) from pg_catalog.jsonb_object_keys(v_node.value)) > 128 then
        return false;
      end if;
      for v_key in select pg_catalog.jsonb_object_keys(v_node.value) loop
        if pg_catalog.octet_length(v_key) > 128
           or pg_catalog.regexp_replace(pg_catalog.lower(v_key), '[^a-z0-9]', '', 'g')
             = any(array['password', 'passwd', 'pwd', 'accesstoken', 'refreshtoken',
               'secret', 'clientsecret', 'apikey', 'authorization', 'servicerolekey']) then
          return false;
        end if;
      end loop;
    elsif pg_catalog.jsonb_typeof(v_node.value) = 'string'
      and pg_catalog.octet_length(v_node.value #>> '{}') > 8192 then
      return false;
    end if;
  end loop;
  return true;
end;
$$;

create table warehouse.receiving_drafts (
  actor_id uuid not null references auth.users(id) on delete cascade,
  po_id text not null references procurement.purchase_orders(id) on delete cascade,
  body jsonb,
  version integer not null check (version > 0),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (actor_id, po_id),
  constraint receiving_draft_body_valid check (
    body is null or private.valid_receiving_draft_body(body)
  )
);
create index receiving_drafts_po_id_idx on warehouse.receiving_drafts(po_id);

alter table warehouse.receiving_drafts enable row level security;
revoke all on warehouse.receiving_drafts from public, anon, authenticated, service_role;
grant select on warehouse.receiving_drafts to authenticated;

create policy receiving_drafts_read_own on warehouse.receiving_drafts
  for select to authenticated
  using (
    actor_id = (select auth.uid())
    and core.has_live_cap('warehouse', 'receive_stock')
    and exists (
      select 1 from procurement.purchase_orders po
      where po.id = receiving_drafts.po_id and po.status = 'issued'
        and private.is_goods_procurement_request(po.request_id)
    )
  );

-- Invoker-side check observes the PO's actual RLS policy before entering the
-- private writer. The writer repeats the current goods-receiver read predicate.
create or replace function private.assert_receiving_draft_read_scope(p_po_id text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication is required for receiving drafts' using errcode = '28000';
  end if;
  if p_po_id is null or pg_catalog.btrim(p_po_id) = ''
     or pg_catalog.octet_length(p_po_id) > 256 then
    raise exception 'Invalid receiving draft PO identifier' using errcode = '22023';
  end if;
  if not coalesce(core.has_live_cap('warehouse', 'receive_stock'), false)
     or not exists (
       select 1 from procurement.purchase_orders po
       where po.id = p_po_id and po.status = 'issued'
         and private.is_goods_procurement_request(po.request_id)
     ) then
    raise exception 'Receiving draft PO is unavailable or not authorized' using errcode = '42501';
  end if;
end;
$$;

-- The last receipt may close a PO and remove its normal warehouse read scope.
-- Permit only clearing an already-owned snapshot in that state, not reading it.
create or replace function private.can_discard_closed_receiving_draft(p_po_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and coalesce(core.has_live_cap('warehouse', 'receive_stock'), false)
    and coalesce(core.has_cap('warehouse', 'receive_stock'), false)
    and exists (
      select 1 from warehouse.receiving_drafts draft
      join procurement.purchase_orders po on po.id = draft.po_id
      where draft.actor_id = auth.uid() and draft.po_id = p_po_id
        and po.status = 'closed'
        and private.is_goods_procurement_request(po.request_id)
    );
$$;

create or replace function private.receiving_draft_command(
  p_operation text, p_po_id text, p_body jsonb, p_expected_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_draft warehouse.receiving_drafts;
  v_version integer;
begin
  if p_operation <> 'delete'
     or not private.can_discard_closed_receiving_draft(p_po_id) then
    perform private.assert_receiving_draft_read_scope(p_po_id);
  end if;
  -- has_cap is also required by the existing PO goods-receiver SELECT policy;
  -- has_live_cap alone must not grant a definer-only path around that policy.
  if not coalesce(core.has_cap('warehouse', 'receive_stock'), false) then
    raise exception 'Receiving draft PO is unavailable or not authorized' using errcode = '42501';
  end if;
  if p_operation is null or p_operation not in ('load', 'save', 'delete') then
    raise exception 'Invalid receiving draft operation' using errcode = '22023';
  end if;
  if p_operation <> 'load' and (
    p_expected_version is null or p_expected_version < 0 or p_expected_version = 2147483647
  ) then
    raise exception 'A valid expected receiving draft version is required' using errcode = '22023';
  end if;
  if p_operation = 'save' and not private.valid_receiving_draft_body(p_body) then
    raise exception 'Invalid or oversized receiving draft document; credentials are forbidden'
      using errcode = '22023';
  end if;

  -- Lock the PO against closure, then serialize this operator/PO even when no
  -- draft exists yet. Hash collisions only serialize unrelated draft commands.
  perform 1 from procurement.purchase_orders po
  where po.id = p_po_id and (
    po.status = 'issued'
    or (p_operation = 'delete' and po.status = 'closed'
      and private.can_discard_closed_receiving_draft(p_po_id))
  )
    and private.is_goods_procurement_request(po.request_id)
  for share;
  if not found then
    raise exception 'Receiving draft PO is unavailable or not authorized' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_actor::text || ':' || p_po_id, 0)
  );
  select * into v_draft from warehouse.receiving_drafts
  where actor_id = v_actor and po_id = p_po_id for update;
  v_version := coalesce(v_draft.version, 0);

  if p_operation <> 'load' then
    if p_expected_version <> v_version then
      return pg_catalog.jsonb_build_object('status', 'conflict', 'current_version', v_version);
    end if;
    insert into warehouse.receiving_drafts(actor_id, po_id, body, version, updated_at)
    values (v_actor, p_po_id, case when p_operation = 'save' then p_body else null end,
      v_version + 1, pg_catalog.clock_timestamp())
    on conflict (actor_id, po_id) do update
      set body = excluded.body, version = excluded.version, updated_at = excluded.updated_at
    returning * into v_draft;
  end if;
  return pg_catalog.jsonb_build_object(
    'status', 'ok', 'po_id', p_po_id, 'body', v_draft.body,
    'version', coalesce(v_draft.version, 0), 'updated_at', v_draft.updated_at
  );
end;
$$;

create or replace function warehouse.load_receiving_draft(p_po_id text)
returns jsonb language plpgsql security invoker set search_path = ''
as $$
begin
  perform private.assert_receiving_draft_read_scope(p_po_id);
  return private.receiving_draft_command('load', p_po_id, null, null);
end;
$$;

create or replace function warehouse.save_receiving_draft(
  p_po_id text, p_body jsonb, p_expected_version integer
)
returns jsonb language plpgsql security invoker set search_path = ''
as $$
begin
  perform private.assert_receiving_draft_read_scope(p_po_id);
  return private.receiving_draft_command('save', p_po_id, p_body, p_expected_version);
end;
$$;

create or replace function warehouse.delete_receiving_draft(p_po_id text, p_expected_version integer)
returns jsonb language plpgsql security invoker set search_path = ''
as $$
begin
  if not private.can_discard_closed_receiving_draft(p_po_id) then
    perform private.assert_receiving_draft_read_scope(p_po_id);
  end if;
  return private.receiving_draft_command('delete', p_po_id, null, p_expected_version);
end;
$$;

alter function private.receiving_draft_command(text, text, jsonb, integer) owner to postgres;
alter function private.can_discard_closed_receiving_draft(text) owner to postgres;
revoke all on function private.valid_receiving_draft_body(jsonb),
  private.assert_receiving_draft_read_scope(text),
  private.can_discard_closed_receiving_draft(text),
  private.receiving_draft_command(text, text, jsonb, integer),
  warehouse.load_receiving_draft(text), warehouse.save_receiving_draft(text, jsonb, integer),
  warehouse.delete_receiving_draft(text, integer)
  from public, anon, authenticated, service_role;
grant execute on function private.assert_receiving_draft_read_scope(text),
  private.can_discard_closed_receiving_draft(text),
  private.receiving_draft_command(text, text, jsonb, integer),
  warehouse.load_receiving_draft(text), warehouse.save_receiving_draft(text, jsonb, integer),
  warehouse.delete_receiving_draft(text, integer) to authenticated;

comment on table warehouse.receiving_drafts is
  'Per-operator unfinished receiving snapshots, never inventory authority. NULL body is a discard tombstone.';
notify pgrst, 'reload schema';
