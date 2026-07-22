-- Allow the vaulted CI service role to verify Product governance writes while
-- preserving RPC-only mutations and append-only history for application users.

grant select on
  product.readiness_packages,
  product.readiness_events,
  product.price_proposals,
  product.price_events
to service_role;

create or replace function product.reject_history_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if current_user in ('postgres', 'supabase_admin')
    and current_setting('product.certification_cleanup', true) = 'on'
  then
    return old;
  end if;
  raise exception 'Product governance history is append-only';
end;
$$;

create or replace function product.cleanup_certification_records(p_marker text)
returns jsonb
language plpgsql
security definer
set search_path = product, core, pg_catalog
as $$
declare
  v_readiness_ids uuid[] := '{}'::uuid[];
  v_price_ids uuid[] := '{}'::uuid[];
  v_readiness_count integer := 0;
  v_price_count integer := 0;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required';
  end if;
  if p_marker !~ '^QA-[0-9]{8}-[A-F0-9]{8}-(desktop-1440|mobile-390)$' then
    raise exception 'Invalid certification marker';
  end if;

  select coalesce(array_agg(id), '{}'::uuid[])
  into v_readiness_ids
  from product.readiness_packages
  where title = p_marker || ' launch readiness';

  select coalesce(array_agg(id), '{}'::uuid[])
  into v_price_ids
  from product.price_proposals
  where reason = p_marker || ' governed pricing proposal';

  perform set_config('product.certification_cleanup', 'on', true);

  delete from core.notifications
  where entity_type = 'product_readiness'
    and entity_id in (select unnest(v_readiness_ids)::text);
  delete from product.readiness_events where readiness_id = any(v_readiness_ids);
  delete from product.price_events where proposal_id = any(v_price_ids);
  delete from product.readiness_packages where id = any(v_readiness_ids);
  get diagnostics v_readiness_count = row_count;
  delete from product.price_proposals where id = any(v_price_ids);
  get diagnostics v_price_count = row_count;

  return jsonb_build_object(
    'marker', p_marker,
    'readiness_removed', v_readiness_count,
    'pricing_removed', v_price_count,
    'removed', v_readiness_count + v_price_count
  );
end;
$$;

revoke all on function product.cleanup_certification_records(text)
from public, anon, authenticated;
grant execute on function product.cleanup_certification_records(text)
to service_role;

notify pgrst, 'reload schema';
