-- Mwell Intra — core.documents (versioned, expiring document registry, spec §4.4)
--
-- Generalizes the warehouse single `evidence` bucket (docs/LLD.md §5.4/§11.2)
-- into a shared, RLS-scoped document service with versioning + expiry.
--
-- Per ADR-002 #1 (spec §11): warehouse photo FILES stay in the `evidence`
-- Storage bucket, but each is REGISTERED here (entity_type='receipt'/'return',
-- storage_path points at the evidence object) so all documents are queryable /
-- RLS-governed in one place — NO file migration. Legal/Procurement files live in
-- the `documents` bucket. Registration goes through core.register_document()
-- (RPC migration); vendor-tier callers may only register against their own
-- vendor record (enforced in the RPC + RLS).
--
-- Re-runnable: create table if not exists + guarded FK.

create table if not exists core.documents (
  id           uuid primary key default gen_random_uuid(),
  entity_type  text not null,        -- 'vendor'|'purchase_order'|'accreditation'|'receipt'|'return'|...
  entity_id    uuid not null,
  doc_type     text not null,        -- 'business_permit'|'contract'|'evidence'|...
  storage_path text not null,        -- Storage object path (bucket: 'documents' or 'evidence')
  version      int  not null default 1,
  status       text not null default 'submitted', -- 'submitted'|'approved'|'rejected'|'expired'
  expires_at   date,
  uploaded_by  uuid,
  created_at   timestamptz not null default now()
);

create index if not exists documents_entity_idx on core.documents (entity_type, entity_id);
create index if not exists documents_expiry_idx on core.documents (expires_at);
create index if not exists documents_uploader_idx on core.documents (uploaded_by);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'documents_uploader_fk') then
    alter table core.documents
      add constraint documents_uploader_fk foreign key (uploaded_by)
      references core.profiles(id) on delete set null;
  end if;
end $$;

alter table core.documents enable row level security;

grant select on core.documents to authenticated;
grant all on core.documents to service_role;
