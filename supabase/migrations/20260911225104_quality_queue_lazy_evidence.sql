-- Read-only queue metadata; the caller's existing inspection RLS still applies.
create or replace view warehouse.quality_inspection_queue
with (security_invoker = true) as
select id, source_type, source_id, product_id, procurement_po_line_id,
       bin_id, lot_id, serial_number, quantity, disposition, reason,
       inspected_by, inspected_at,
       case when jsonb_typeof(evidence_urls) = 'array'
         then jsonb_array_length(evidence_urls) else 0 end as evidence_count
from warehouse.quality_inspections;

revoke all on warehouse.quality_inspection_queue from public, anon, authenticated;
grant select on warehouse.quality_inspection_queue to authenticated, service_role;
comment on view warehouse.quality_inspection_queue is
  'Inspection queue without photo payloads. Exact evidence is read from the original RLS-protected inspection when visible.';
notify pgrst, 'reload schema';
