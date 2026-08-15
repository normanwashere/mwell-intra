-- Require every atomic cycle count to be tied to a signed-in, certified actor.
-- This forward migration removes the deprecated role-based service bypass
-- without rewriting the reviewed operations launch migration.

create or replace function warehouse.create_and_submit_cycle_count(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_started jsonb;
  v_command_id uuid;
  v_count jsonb := coalesce(payload->'cycle_count', '{}'::jsonb);
  v_lines jsonb := coalesce(payload->'cycle_count'->'lines', '[]'::jsonb);
  v_evidence jsonb := coalesce(payload->'evidence_urls', '[]'::jsonb);
  v_count_id text;
  v_response jsonb;
begin
  v_started := private.begin_idempotent_command(
    'create_and_submit_cycle_count', payload->>'idempotency_key', payload
  );
  if (v_started->>'replayed')::boolean then
    return v_started->'response';
  end if;
  v_command_id := (v_started->>'command_id')::uuid;

  if auth.uid() is null then
    raise exception 'An attributable cycle-count actor is required';
  end if;
  if not core.has_live_cap('warehouse', 'cycle_count') then
    raise exception 'Not authorized: warehouse.cycle_count';
  end if;
  if jsonb_typeof(v_count) <> 'object' then
    raise exception 'Cycle count must be an object';
  end if;
  if nullif(pg_catalog.btrim(v_count->>'location_id'), '') is null then
    raise exception 'A cycle-count location is required';
  end if;
  if jsonb_typeof(v_lines) <> 'array' or jsonb_array_length(v_lines) = 0 then
    raise exception 'A cycle count must contain at least one line';
  end if;
  if jsonb_typeof(v_evidence) <> 'array' then
    raise exception 'Evidence must be an array';
  end if;
  if jsonb_array_length(v_evidence) = 0 then
    raise exception 'Cycle-count evidence is required';
  end if;

  v_count_id := coalesce(
    nullif(pg_catalog.btrim(v_count->>'id'), ''),
    'cc-' || pg_catalog.replace(gen_random_uuid()::text, '-', '')
  );

  insert into warehouse.cycle_counts(
    id, location_id, bin_id, category, lines, status,
    requested_by, actor, created_at
  ) values (
    v_count_id,
    v_count->>'location_id',
    nullif(v_count->>'bin_id', ''),
    nullif(v_count->>'category', ''),
    v_lines,
    'draft',
    auth.uid(),
    warehouse.authoritative_actor(),
    now()
  );

  v_response := private.warehouse_submit_cycle_count(jsonb_build_object(
    'idempotency_key', 'atomic-' || v_command_id::text,
    'cycle_count_id', v_count_id,
    'reason', payload->>'reason',
    'evidence_urls', v_evidence
  ));

  return private.finish_idempotent_command(v_command_id, v_response);
end;
$$;

revoke all on function warehouse.create_and_submit_cycle_count(jsonb)
  from public, anon;
grant execute on function warehouse.create_and_submit_cycle_count(jsonb)
  to authenticated, service_role;
