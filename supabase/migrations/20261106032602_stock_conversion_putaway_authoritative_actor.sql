-- Prospective actor correction only. Existing origins, putaways and QC stay untouched.
begin;

select pg_catalog.set_config('lock_timeout',
  (case when setting::bigint=0 then 5000 else least(setting::bigint,5000) end)::text || 'ms',true)
from pg_catalog.pg_settings where name='lock_timeout';
select pg_catalog.set_config('statement_timeout',
  (case when setting::bigint=0 then 60000 else least(setting::bigint,60000) end)::text || 'ms',true)
from pg_catalog.pg_settings where name='statement_timeout';

do $$
declare
  target_oid oid:=to_regprocedure('private.stock_conversion_capture_putaway()');
  original_body text;
  original_metadata jsonb;
  definition text;
  old_guard constant text:='m.actor is distinct from new.actor_id';
  new_guard constant text:='m.actor is distinct from warehouse.authoritative_actor()';
begin
  select prosrc,to_jsonb(p)-'prosrc',pg_get_functiondef(p.oid)
    into original_body,original_metadata,definition from pg_proc p where p.oid=target_oid;
  if md5(replace(original_body,chr(13),'')) is distinct from '6b06c2077da5a460353f45e686d96377' then
    raise exception 'QC putaway actor predecessor drift; review the exact live function';
  end if;
  if (length(original_body)-length(replace(original_body,old_guard,'')))/length(old_guard)<>1 then
    raise exception 'QC putaway actor guard must occur exactly once';
  end if;
  -- Transfer stamps this server-resolved profile email (or UUID fallback).
  -- Receipt/auth/history UUID checks and all same-transaction xmin guards stay exact.
  execute replace(definition,old_guard,new_guard);
  if (select to_jsonb(p)-'prosrc' from pg_proc p where p.oid=target_oid) is distinct from original_metadata
    or (select prosrc from pg_proc where oid=target_oid) is distinct from replace(original_body,old_guard,new_guard)
    or to_regprocedure('private.stock_conversion_capture_putaway()')::oid is distinct from target_oid then
    raise exception 'QC putaway actor replacement changed more than the reviewed body guard';
  end if;
end $$;

commit;
