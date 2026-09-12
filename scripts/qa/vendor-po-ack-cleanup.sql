-- Delete only the two disposable acknowledgment fixtures, refusing unexpected dependencies.
begin;
do $$
declare
  ids text[] := array['QA-SEP12-VENDOR-ACK-175-D','QA-SEP12-VENDOR-ACK-175-M'];
  v_requests text[] := array['QA-SEP12-VENDOR-ACK-175-D-REQUEST','QA-SEP12-VENDOR-ACK-175-M-REQUEST'];
  dependency record; matches bigint;
begin
  if (select count(*) from procurement.purchase_orders where id=any(ids)
      and notes='Disposable QA-SEP12-VENDOR-ACK-175 fixture. No real purchase, payment or delivery.') <> 2
    or (select count(*) from procurement.requests where id=any(v_requests)
      and description='Disposable QA-SEP12-VENDOR-ACK-175 fixture. No real purchase, payment or delivery.') <> 2 then
    raise exception 'Fixture ownership did not match; no cleanup performed';
  end if;
  perform 1 from procurement.purchase_orders where id=any(ids) for update;
  perform 1 from procurement.requests where id=any(v_requests) for update;
  for dependency in
    select c.conrelid::regclass child, a.attname column_name, c.confrelid parent
    from pg_constraint c join pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1]
    where c.contype='f' and c.confrelid in ('procurement.purchase_orders'::regclass,'procurement.requests'::regclass)
      and c.conrelid not in ('procurement.purchase_order_lifecycle_state'::regclass,
        'procurement.purchase_order_lifecycle_events'::regclass,'procurement.purchase_orders'::regclass)
  loop
    execute format('select count(*) from %s where %I=any($1)',dependency.child,dependency.column_name)
      into matches using case when dependency.parent='procurement.purchase_orders'::regclass then ids else v_requests end;
    if matches>0 then raise exception 'Unexpected dependency in %, leaving fixtures for review',dependency.child; end if;
  end loop;
  if exists(select 1 from procurement.purchase_orders where request_id=any(v_requests) and not (id=any(ids))) then
    raise exception 'Unexpected linked purchase order';
  end if;
  delete from procurement.purchase_order_lifecycle_events where purchase_order_id=any(ids);
  delete from procurement.purchase_order_lifecycle_state where purchase_order_id=any(ids);
  delete from procurement.purchase_orders where id=any(ids);
  delete from procurement.requests where id=any(v_requests);
end $$;
commit;
select
  (select count(*) from procurement.purchase_orders where id in ('QA-SEP12-VENDOR-ACK-175-D','QA-SEP12-VENDOR-ACK-175-M')) as orders_remaining,
  (select count(*) from procurement.requests where id in ('QA-SEP12-VENDOR-ACK-175-D-REQUEST','QA-SEP12-VENDOR-ACK-175-M-REQUEST')) as requests_remaining,
  (select count(*) from procurement.purchase_order_lifecycle_state where purchase_order_id in ('QA-SEP12-VENDOR-ACK-175-D','QA-SEP12-VENDOR-ACK-175-M')) as states_remaining,
  (select count(*) from procurement.purchase_order_lifecycle_events where purchase_order_id in ('QA-SEP12-VENDOR-ACK-175-D','QA-SEP12-VENDOR-ACK-175-M')) as events_remaining;
