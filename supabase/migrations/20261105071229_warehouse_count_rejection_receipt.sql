-- A confirmed validation rollback is different from an unknown transport result.
-- Only errors after acquiring a fresh idempotent command receive this code.
do $$
declare v_sql text; v_old text;
begin
  v_sql:=replace(pg_get_functiondef('warehouse.create_and_submit_cycle_count(jsonb)'::regprocedure),E'\r','');
  v_old:=E'  return private.finish_idempotent_command(v_command_id, v_response);\nend;';
  if position(v_old in v_sql)=0
    or position('if (v_started->>''replayed'')::boolean then' in v_sql)=0 then
    raise exception 'Atomic count rejection anchors changed';
  end if;
  v_sql:=replace(v_sql,v_old,$patch$  return private.finish_idempotent_command(v_command_id, v_response);
exception when sqlstate 'P0001' or check_violation or foreign_key_violation or invalid_parameter_value or invalid_text_representation or numeric_value_out_of_range then
  if v_command_id is not null then
    raise exception using errcode='PWC01',message=sqlerrm,
      detail='This new count command was fully rolled back. No count, approval request or stock change was saved.';
  end if;
  raise;
end;$patch$);
  execute v_sql;
end $$;
select pg_notify('pgrst','reload schema');
