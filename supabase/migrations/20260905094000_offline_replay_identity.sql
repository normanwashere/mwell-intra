-- Wrap the latest public certification/hold chain, never an earlier implementation.
begin;

create table private.warehouse_offline_receipts (
  actor_id text not null,
  method text not null check (method in ('issue', 'transfer')),
  intent_key text not null,
  command_input jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (actor_id, method, intent_key)
);
alter table private.warehouse_offline_receipts enable row level security;
revoke all on private.warehouse_offline_receipts from public, anon, authenticated;

alter function warehouse.issue(jsonb) rename to issue_pre_offline_identity;
alter function warehouse.transfer(jsonb) rename to transfer_pre_offline_identity;
revoke all on function warehouse.issue_pre_offline_identity(jsonb), warehouse.transfer_pre_offline_identity(jsonb)
  from public, anon, authenticated;

create function private.warehouse_offline_action(action_name text, payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
<<intent>>
declare
  capability text;
  actor_id text;
  intent_key text := nullif(payload->>'idempotency_key', '');
  saved private.warehouse_offline_receipts%rowtype;
  result jsonb;
begin
  capability := case action_name when 'issue' then 'issue_items' when 'transfer' then 'transfer_stock' end;
  if capability is null then raise exception 'Unsupported offline action'; end if;
  -- Recheck current certification even when only returning an old receipt.
  if auth.role() is distinct from 'service_role' and not coalesce(core.has_live_cap('warehouse', capability), false) then
    raise exception 'Not authorized: warehouse.%', capability;
  end if;
  actor_id := auth.uid()::text;
  if actor_id is null and auth.role() = 'service_role' then actor_id := 'service_role'; end if;
  if actor_id is null then raise exception 'Authenticated actor required'; end if;

  if intent_key is not null then
    if intent_key !~ '^[A-Za-z0-9_-]{12,128}$' or jsonb_typeof(payload->'command_input') is distinct from 'object' then
      raise exception 'Valid offline key and command input required';
    end if;
    -- The lock covers both the business mutation and its receipt in one transaction.
    perform pg_advisory_xact_lock(hashtextextended(actor_id || ':' || action_name || ':' || intent_key, 0));
    select r.* into saved from private.warehouse_offline_receipts r
      where r.actor_id = intent.actor_id
        and r.method = action_name and r.intent_key = intent.intent_key;
    if found then
      if saved.command_input is distinct from payload->'command_input' then
        raise exception 'Idempotency key was reused with a different payload';
      end if;
      return saved.result;
    end if;
  end if;
  if coalesce((payload->>'replay_only')::boolean, false) then
    if intent_key is null then raise exception 'Replay lookup requires a key'; end if;
    return null;
  end if;

  if action_name = 'issue' then
    result := warehouse.issue_pre_offline_identity(payload);
  else
    result := warehouse.transfer_pre_offline_identity(payload);
  end if;
  if intent_key is not null then
    insert into private.warehouse_offline_receipts(actor_id, method, intent_key, command_input, result)
      values(actor_id, action_name, intent_key, payload->'command_input', result);
  end if;
  return result;
end;
$$;
revoke all on function private.warehouse_offline_action(text,jsonb) from public, anon, authenticated;

create function warehouse.issue(payload jsonb) returns jsonb
language sql security definer set search_path = '' as $$
  select private.warehouse_offline_action('issue', payload);
$$;
create function warehouse.transfer(payload jsonb) returns jsonb
language sql security definer set search_path = '' as $$
  select private.warehouse_offline_action('transfer', payload);
$$;
revoke all on function warehouse.issue(jsonb), warehouse.transfer(jsonb) from public, anon;
grant execute on function warehouse.issue(jsonb), warehouse.transfer(jsonb) to authenticated, service_role;

commit;
