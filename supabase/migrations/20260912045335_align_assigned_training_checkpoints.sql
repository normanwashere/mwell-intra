-- Project the assigned version's rules, not the latest client-side catalog.
do $migration$
declare
  definition text := pg_catalog.pg_get_functiondef('learning.my_learning_snapshot_base()'::regprocedure);
  marker text := $old$'simulationId', requirement_version.simulation_id,$old$;
begin
  if (length(definition) - length(replace(definition, marker, ''))) / length(marker) <> 1 then
    raise exception 'Unexpected learning snapshot shape; review before migration';
  end if;
  if strpos(definition, '''requiredCheckpointIds''') > 0 then
    raise exception 'Assigned checkpoints already projected';
  end if;
  execute replace(definition, marker, marker || $new$
            'requiredCheckpointIds', requirement_version.pass_rules->'required_checkpoints',$new$);
end;
$migration$;
