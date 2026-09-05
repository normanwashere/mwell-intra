-- Explicit end-user authority: has_live_cap includes current RBAC/certification
-- for authenticated sessions, but separately admits service-role JWTs. Drafts
-- intentionally admit only authenticated actors, including closed-PO cleanup.
create or replace function private.can_discard_closed_receiving_draft(p_po_id text)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null
    and coalesce(auth.role(), '') = 'authenticated'
    and coalesce(core.has_live_cap('warehouse', 'receive_stock'), false)
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
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_draft warehouse.receiving_drafts;
  v_version integer;
begin
  if v_actor is null then
    raise exception 'Authentication is required for receiving drafts' using errcode = '28000';
  end if;
  if coalesce(auth.role(), '') <> 'authenticated'
     or not coalesce(core.has_live_cap('warehouse', 'receive_stock'), false) then
    raise exception 'Receiving draft PO is unavailable or not authorized' using errcode = '42501';
  end if;
  if p_operation <> 'delete'
     or not private.can_discard_closed_receiving_draft(p_po_id) then
    perform private.assert_receiving_draft_read_scope(p_po_id);
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

  -- Preserve PO-then-actor/PO lock order and issued-goods read scope. Only an
  -- already-owned draft on a closed goods PO may take the cleanup exception.
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

-- CREATE OR REPLACE preserves the installed owner, signatures and EXECUTE ACLs.
