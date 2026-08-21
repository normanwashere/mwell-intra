# Mwell Intra Training and Handover Content

**Reviewed:** August 21, 2026  
**Current UAT application reference:** `f88c9916c253546ae6960bd19ffd608b99fdd791`

This is the maintained source for trainer, developer, and infrastructure handover materials. Presentation exports must use this content and the screenshots from the matching certification artifact.

## Training outcomes

Learners must be able to:

- Identify their role, module, authority, handoffs, and escalation path.
- Complete one role-specific happy path, correction path, denial check, and recovery path.
- Verify persisted state after a successful command.
- Avoid duplicate writes after refresh, timeout, or uncertain network state.
- Use the Knowledge Base to find the current procedure and source route.

## Updated Warehouse demonstration

1. Import or create an ecommerce order with customer, address, channel, payment, and product fields.
2. Explain why selling price is read-only and owned by Product.
3. Compare standalone quantity with an explicit bundle and inspect per-set IDs.
4. Scan the required rack/bin and every serialized unit.
5. Record packaging, waybill, courier, proof, dispatch, and handover reference.
6. Export the current view and reconcile it with the saved order.
7. Scan a returned serial and confirm its original release; quarantine an unmatched serial.
8. Demonstrate pending-work badges on desktop and mobile.

## Negative scenarios

- Invalid CSV headers or controlled values.
- Missing PO/DR reference or receiving evidence.
- Wrong rack/bin, duplicate serial, wrong product, or unavailable unit.
- Warehouse attempt to edit Product-owned price.
- Quantity incorrectly treated as a bundle.
- Return serial with no original release.
- Delivery update without permission.
- Vendor invitation delayed or rate-limited.

## Handover evidence

The release bundle must contain:

- Commit-bound documentation manifest.
- Current manuals, specification, training content, and release note.
- Desktop, tablet, and mobile screenshots from live route audits.
- Governed transaction and database-readback results.
- Cleanup evidence and declared residual blockers.

Screenshots must come from the same deployed commit. Trainers must not use historical screenshots that show retired controls, incorrect labels, or resolved errors.
