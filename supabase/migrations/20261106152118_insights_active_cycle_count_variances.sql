-- The Warehouse variance metric must omit archived fixtures, not erase history.
-- Run inside the migration transaction; preserve the entire public wrapper chain.
set local lock_timeout = '3s';
set local statement_timeout = '30s';

do $patch$
declare
  expected record;
  function_oid oid;
  definition text;
  before_metadata jsonb;
  after_metadata jsonb;
  old_reference constant text := 'from warehouse.cycle_counts c';
begin
  -- Live normalized prosrc fingerprints, independently read on 2026-11-06.
  for expected in select * from (values
    ('core.insights_snapshot_pre_task1()', 'fa11cc6b30b98b799032c773cbe4c7eb'),
    ('core.insights_snapshot_pre_leadership_launch()', '482536a5098a69a7b3dc68192f055c4e'),
    ('core.insights_snapshot()', 'f40d7ede7ef5f322aa0cbb30239065dc')
  ) chain(signature, body_md5) loop
    if not exists(select 1 from pg_catalog.pg_proc p
      where p.oid=pg_catalog.to_regprocedure(expected.signature)
        and pg_catalog.md5(pg_catalog.replace(p.prosrc,chr(13),''))=expected.body_md5) then
      raise exception 'Insights active variance predecessor drift: %', expected.signature;
    end if;
  end loop;

  if not exists(select 1 from pg_catalog.pg_class c
    where c.oid=pg_catalog.to_regclass('warehouse.active_cycle_counts')
      and c.relkind='v' and 'security_invoker=true'=any(c.reloptions)) then
    raise exception 'Expected invoker-security active cycle-count view is missing';
  end if;

  function_oid := 'core.insights_snapshot_pre_task1()'::regprocedure;
  select pg_catalog.pg_get_functiondef(p.oid),to_jsonb(p)-'prosrc'
    into definition,before_metadata from pg_catalog.pg_proc p where p.oid=function_oid;
  if (length(definition)-length(replace(definition,old_reference,'')))/length(old_reference)<>1 then
    raise exception 'Insights active variance relation anchor drift';
  end if;
  execute replace(definition,old_reference,'from warehouse.active_cycle_counts c');
  select to_jsonb(p)-'prosrc' into after_metadata from pg_catalog.pg_proc p where p.oid=function_oid;
  if before_metadata is distinct from after_metadata then
    raise exception 'Insights active variance metadata changed';
  end if;
end;
$patch$;
