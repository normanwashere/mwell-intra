-- Keep the public Aug13 wrapper and existing workflow, but align its inner
-- implementation's authority and protect snapshots already accepted for handoff.
begin;

do $migration$
declare
  target regprocedure := to_regprocedure('procurement.manage_replenishment_recommendation_uncertified_impl(jsonb)');
  definition text;
  old_guard constant text := $old_guard$  if not (
    core.has_cap('warehouse','view_procurement')
    or core.has_cap('procurement','manage_rfp')
    or core.has_cap('procurement','author_po')
  ) then raise exception 'Procurement authorization is required'; end if;$old_guard$;
  new_guard constant text := $new_guard$  if v_action = 'recommend' then
    if not core.has_live_cap('warehouse', 'recommend_replenishment') then
      raise exception 'Not authorized: warehouse.recommend_replenishment';
    end if;
  elsif not core.has_live_cap('procurement', 'manage_replenishment') then
    raise exception 'Not authorized: procurement.manage_replenishment';
  end if;$new_guard$;
  old_conflict constant text := $old_conflict$      rationale=excluded.rationale,created_at=now()
    returning * into v_row;$old_conflict$;
  new_conflict constant text := $new_conflict$      rationale=excluded.rationale,created_at=now()
    where procurement.replenishment_recommendations.status = 'recommended'
    returning * into v_row;
    if not found then
      raise exception 'Replenishment recommendation was already accepted or handed off. Refresh its status before continuing.';
    end if;$new_conflict$;
begin
  if target is null then
    raise exception 'Expected replenishment implementation is missing';
  end if;
  definition := replace(pg_catalog.pg_get_functiondef(target), E'\r\n', E'\n');
  if (length(definition) - length(replace(definition, old_guard, ''))) / length(old_guard) <> 1
     or (length(definition) - length(replace(definition, old_conflict, ''))) / length(old_conflict) <> 1 then
    raise exception 'Unexpected replenishment implementation; review authority and conflict branches before migration';
  end if;
  definition := replace(replace(definition, old_guard, new_guard), old_conflict, new_conflict);
  execute definition;
end;
$migration$;

revoke all on function procurement.manage_replenishment_recommendation_uncertified_impl(jsonb)
  from public, anon, authenticated;

commit;
