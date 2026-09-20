-- Finance ledger reads require the same current effective authority as settlement.
-- Preserve the reviewed seller/owner scope, response, function properties and ACLs.
do $migration$
declare
  definition text := pg_get_functiondef('warehouse.event_custody_ledger(jsonb)'::regprocedure);
  prior_check text := 'core.has_cap(''events'',''approve_settlement'')';
  effective_check text := 'core.has_live_cap(''events'',''approve_settlement'')';
begin
  if (length(definition) - length(replace(definition, prior_check, ''))) / length(prior_check) <> 1 then
    raise exception 'Event ledger Finance authority boundary drift; review before migrating';
  end if;
  execute replace(definition, prior_check, effective_check);
end;
$migration$;
