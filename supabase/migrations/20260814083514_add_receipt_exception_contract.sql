-- The repository has treated evidenced non-PO and overage receipts as part of
-- the receipt contract since the controlled receiving flow was introduced.
-- Keep the optional audit payload on the receipt itself so the warehouse read
-- model can hydrate every workspace without a schema-dependent failure.
alter table warehouse.receipts
  add column if not exists receipt_exception jsonb;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'warehouse_receipt_exception_shape_check'
       and conrelid = 'warehouse.receipts'::regclass
  ) then
    alter table warehouse.receipts
      add constraint warehouse_receipt_exception_shape_check check (
        receipt_exception is null
        or (
          pg_catalog.jsonb_typeof(receipt_exception) = 'object'
          and receipt_exception->>'type' in ('non_po', 'overage')
          and pg_catalog.length(
            pg_catalog.btrim(coalesce(receipt_exception->>'reason', ''))
          ) between 1 and 2000
          and pg_catalog.jsonb_typeof(receipt_exception->'evidenceUrls') = 'array'
          and pg_catalog.jsonb_array_length(receipt_exception->'evidenceUrls') > 0
        )
      );
  end if;
end
$$;

comment on column warehouse.receipts.receipt_exception is
  'Evidenced non-PO or overage receiving exception: type, reason, and evidenceUrls.';
