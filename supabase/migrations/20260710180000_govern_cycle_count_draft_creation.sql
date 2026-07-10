-- Cycle-count capture creates an approval-bound draft. Inventory is posted only
-- by warehouse.decide_stock_change after all required approval tiers complete.
create or replace function warehouse.record_cycle_count(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = warehouse, public
as $$
declare
  v_cc warehouse.cycle_counts;
  v_actor text;
  v_cycle_count jsonb;
begin
  if not core.has_cap('warehouse', 'cycle_count') then
    raise exception 'Not authorized: cycle_count';
  end if;
  if jsonb_typeof(payload->'cycle_count') <> 'object' then
    raise exception 'A cycle-count draft is required';
  end if;

  v_actor := warehouse.authoritative_actor();
  v_cycle_count := warehouse.force_actor_on_object(payload->'cycle_count', v_actor);
  v_cycle_count := jsonb_set(v_cycle_count, '{status}', '"draft"'::jsonb, true);
  v_cycle_count := jsonb_set(v_cycle_count, '{requested_by}', to_jsonb(auth.uid()), true);
  v_cycle_count := v_cycle_count - 'submitted_at';

  insert into warehouse.cycle_counts
  select * from jsonb_populate_record(null::warehouse.cycle_counts, v_cycle_count)
  returning * into v_cc;

  insert into core.activity_log(module, entity_type, entity_id, action, actor, detail)
  values (
    'warehouse', 'cycle_count', v_cc.id, 'drafted', auth.uid(),
    jsonb_build_object('line_count', jsonb_array_length(v_cc.lines))
  );

  return to_jsonb(v_cc);
end;
$$;

revoke all on function warehouse.record_cycle_count(jsonb) from public, anon;
grant execute on function warehouse.record_cycle_count(jsonb) to authenticated, service_role;
