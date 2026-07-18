-- Exception selection orders by creation time and policy evidence must remain
-- chronologically auditable.
alter table procurement.exception_packs
  add column if not exists created_at timestamptz not null default now();

create index if not exists exception_packs_request_created_idx
  on procurement.exception_packs(request_id,created_at desc);
