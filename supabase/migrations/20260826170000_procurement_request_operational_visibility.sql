-- Forward-only convergence for Procurement request operational visibility.
-- Requesters remain limited to their own or explicitly shared records. Certified
-- Procurement operators and Finance controllers can read the complete request
-- register required for sourcing, commitment, and financial review.

create or replace function private.can_read_procurement_request(p_request_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    exists (
      select 1
      from procurement.requests request
      where request.id = p_request_id
        and request.requester_id = auth.uid()
    )
    or exists (
      select 1
      from procurement.request_collaborators collaborator
      where collaborator.request_id = p_request_id
        and collaborator.user_id = auth.uid()
        and collaborator.revoked_at is null
    )
    or core.has_live_cap('procurement', 'author_po')
    or core.has_live_cap('procurement', 'manage_rfp')
    or core.has_live_cap('procurement', 'view_finance')
    or core.has_live_cap('procurement', 'admin')
$$;

revoke all on function private.can_read_procurement_request(text) from public, anon;
grant execute on function private.can_read_procurement_request(text) to authenticated, service_role;

select pg_notify('pgrst', 'reload schema');
