begin;

lock table warehouse.receipts in share row exclusive mode;
lock table warehouse.quality_inspections in share row exclusive mode;
lock table warehouse.movements in share row exclusive mode;
lock table warehouse.inventory_holds in share row exclusive mode;

update warehouse.receipts target
set evidence_urls = coalesce((
  select pg_catalog.jsonb_agg(item.value order by item.ordinality)
  from pg_catalog.jsonb_array_elements_text(target.evidence_urls)
    with ordinality as item(value, ordinality)
  where item.value !~* '^http://'
), '[]'::jsonb)
where exists (
  select 1
  from pg_catalog.jsonb_array_elements_text(target.evidence_urls) as item(value)
  where item.value ~* '^http://'
);

update warehouse.quality_inspections target
set evidence_urls = coalesce((
  select pg_catalog.jsonb_agg(item.value order by item.ordinality)
  from pg_catalog.jsonb_array_elements_text(target.evidence_urls)
    with ordinality as item(value, ordinality)
  where item.value !~* '^http://'
), '[]'::jsonb)
where exists (
  select 1
  from pg_catalog.jsonb_array_elements_text(target.evidence_urls) as item(value)
  where item.value ~* '^http://'
);

update warehouse.movements target
set evidence_urls = coalesce((
  select pg_catalog.jsonb_agg(item.value order by item.ordinality)
  from pg_catalog.jsonb_array_elements_text(target.evidence_urls)
    with ordinality as item(value, ordinality)
  where item.value !~* '^http://'
), '[]'::jsonb)
where exists (
  select 1
  from pg_catalog.jsonb_array_elements_text(target.evidence_urls) as item(value)
  where item.value ~* '^http://'
);

update warehouse.inventory_holds target
set evidence_urls = coalesce((
      select pg_catalog.jsonb_agg(item.value order by item.ordinality)
      from pg_catalog.jsonb_array_elements_text(target.evidence_urls)
        with ordinality as item(value, ordinality)
      where item.value !~* '^http://'
    ), '[]'::jsonb),
    release_evidence_urls = coalesce((
      select pg_catalog.jsonb_agg(item.value order by item.ordinality)
      from pg_catalog.jsonb_array_elements_text(target.release_evidence_urls)
        with ordinality as item(value, ordinality)
      where item.value !~* '^http://'
    ), '[]'::jsonb)
where exists (
  select 1
  from pg_catalog.jsonb_array_elements_text(
    target.evidence_urls || target.release_evidence_urls
  ) as item(value)
  where item.value ~* '^http://'
);

alter table warehouse.receipts
  add constraint warehouse_receipts_secure_evidence_urls_check
  check (not pg_catalog.jsonb_path_exists(
    evidence_urls,
    '$[*] ? (@ like_regex "^http://" flag "i")'
  )) not valid;

alter table warehouse.quality_inspections
  add constraint warehouse_quality_secure_evidence_urls_check
  check (not pg_catalog.jsonb_path_exists(
    evidence_urls,
    '$[*] ? (@ like_regex "^http://" flag "i")'
  )) not valid;

alter table warehouse.movements
  add constraint warehouse_movements_secure_evidence_urls_check
  check (not pg_catalog.jsonb_path_exists(
    evidence_urls,
    '$[*] ? (@ like_regex "^http://" flag "i")'
  )) not valid;

alter table warehouse.inventory_holds
  add constraint warehouse_holds_secure_evidence_urls_check
  check (
    not pg_catalog.jsonb_path_exists(
      evidence_urls,
      '$[*] ? (@ like_regex "^http://" flag "i")'
    )
    and not pg_catalog.jsonb_path_exists(
      release_evidence_urls,
      '$[*] ? (@ like_regex "^http://" flag "i")'
    )
  ) not valid;

alter table warehouse.receipts
  validate constraint warehouse_receipts_secure_evidence_urls_check;
alter table warehouse.quality_inspections
  validate constraint warehouse_quality_secure_evidence_urls_check;
alter table warehouse.movements
  validate constraint warehouse_movements_secure_evidence_urls_check;
alter table warehouse.inventory_holds
  validate constraint warehouse_holds_secure_evidence_urls_check;

commit;
