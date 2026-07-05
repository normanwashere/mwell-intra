-- Mwell Intra — `documents` + `procurement-requests` Storage buckets + object RLS
--
-- Closes the audited CRITICAL gap: core.register_document() records metadata
-- pointing at a `documents` bucket, and 20260706190000_procurement_policy_
-- alignment.sql:153 says request attachments land in a `procurement-requests`
-- bucket — but neither bucket was ever created and zero storage.objects
-- policies existed for them. This migration mirrors the `evidence` bucket
-- pattern from 20260706092300_warehouse_evidence_storage.sql:
--
--   * both buckets are PRIVATE (`public = false`); rows in core.documents /
--     procurement.request_attachments carry the object PATH, and end users
--     view files exclusively through short-lived signed URLs.
--   * SIGNED-URL TTL GUIDANCE: keep `createSignedUrl` expirations SHORT —
--     5–15 minutes (300–900 s) for `documents` and `procurement-requests`.
--     Signed URLs bypass RLS for their lifetime, so a long TTL converts a
--     one-time authorized read into a shareable bearer link.
--   * vendor self-scope path convention: vendor-owned objects live under
--     `vendor/{vendor_id}/…` — the second path segment is matched against
--     core.current_vendor_id() so a vendor session can only see (and upload
--     into) its own folder.
--   * NO UPDATE/DELETE policies for `authenticated`: uploaded documents are
--     immutable evidence. A correction is a NEW upload registered as a new
--     version in core.documents — never an overwrite or a delete. (This is
--     intentionally stricter than the `evidence` bucket, which allows
--     uploader-delete; document trails are audit/accreditation evidence.)
--
-- Re-runnable: on-conflict-do-nothing bucket inserts; drop policy if exists.

insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('procurement-requests', 'procurement-requests', false)
on conflict (id) do nothing;

-- ===========================================================================
-- `documents` bucket — vendor accreditation / legal / cross-module documents
-- (register_document() writes the metadata row; the file lands here).
-- ===========================================================================

-- READ: the uploader, an internal reader holding view_documents (any module),
-- or a vendor session reading its own `vendor/{vendor_id}/…` folder.
drop policy if exists documents_auth_read on storage.objects;
create policy documents_auth_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'documents'
    and (
      owner = auth.uid()
      or core.has_any_cap('view_documents')
      or (
        (storage.foldername(name))[1] = 'vendor'
        and (storage.foldername(name))[2] = core.current_vendor_id()::text
      )
    )
  );

-- WRITE: internal document managers OR vendor-tier submitters. Vendor-kind
-- sessions must additionally stay inside their own vendor/{vendor_id}/ folder
-- (mirrors the register_document() self-scope guard at the metadata layer).
drop policy if exists documents_auth_write on storage.objects;
create policy documents_auth_write on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'documents'
    and (
      core.has_any_cap('manage_documents')
      or core.has_any_cap('submit_documents')
    )
    and (
      not core.is_vendor()
      or (
        (storage.foldername(name))[1] = 'vendor'
        and (storage.foldername(name))[2] = core.current_vendor_id()::text
      )
    )
  );

-- ===========================================================================
-- `procurement-requests` bucket — request attachment files
-- (procurement.request_attachments carries the metadata + provenance).
-- ===========================================================================

-- READ: the uploader, procurement staff (view_dashboard admits every
-- procurement role, mirroring the request_attachments table RLS), or a vendor
-- session reading its own `vendor/{vendor_id}/…` folder.
drop policy if exists procurement_requests_auth_read on storage.objects;
create policy procurement_requests_auth_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'procurement-requests'
    and (
      owner = auth.uid()
      or core.has_cap('procurement', 'view_dashboard')
      or (
        (storage.foldername(name))[1] = 'vendor'
        and (storage.foldername(name))[2] = core.current_vendor_id()::text
      )
    )
  );

-- WRITE: only users who can raise requests may upload attachments.
drop policy if exists procurement_requests_auth_write on storage.objects;
create policy procurement_requests_auth_write on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'procurement-requests'
    and core.has_cap('procurement', 'create_request')
  );

-- NOTE: no UPDATE and no DELETE policies are created for either bucket, so
-- `authenticated` cannot mutate or remove objects (default-deny). Retention
-- purges run under service_role / the retention job, which bypasses RLS.
