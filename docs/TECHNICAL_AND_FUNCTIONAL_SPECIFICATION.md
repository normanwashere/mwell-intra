# Mwell Intra Technical and Functional Specification

**Reviewed:** August 21, 2026  
**Current UAT application reference:** `f88c9916c253546ae6960bd19ffd608b99fdd791`

## Product boundary

Mwell Intra is the shared operating platform for cross-department workflows. Warehouse, Procurement, Legal, Finance, Product, Marketing, Operations, Customer Service, and platform administration use scoped modules over a shared Supabase authority model. Warehouse is a component of Intra, not a separate application.

## Runtime architecture

- Next.js shell deployed on Vercel.
- Modular React workspaces under `modules/`.
- Supabase Auth for identity and session management.
- PostgreSQL schemas, row-level security, guarded functions, and immutable activity records for live authority.
- Role and capability resolution controls routes, commands, records, and onboarding curricula.
- The standalone operating handbook is packaged with each certified release and maps guidance to current routes, roles, process diagrams and governing references.

## Warehouse fulfillment contract

### Ecommerce order intake

- Orders may be entered in the UI or imported with the controlled CSV template.
- Controlled values are used for sales channel and payment method.
- Payment reference and Maya status are retained when applicable.
- Address presets populate province, postal code, and service area; operators confirm the final address.
- Product owns the selling price. Warehouse receives a read-only assigned price and cannot override it.
- CSV export emits one row per order line with order, customer, address, payment, product, commercial, dispatch, handover, and audit data.

### Bundles

- Bundle status is explicit and is not inferred from quantity.
- Every bundle quantity receives its own generated set ID.
- Every serialized component is scanned and associated with the correct set before release.

### Pick, pack, and dispatch

- Operators scan the required rack or bin before stock units.
- Serialized products require exact unit scans; duplicate, wrong-product, wrong-location, and unavailable units are rejected.
- Packaging supplies, waybill, courier, dispatch state, proof, and generated handover reference remain attached to the order.
- Navigation surfaces pending Fulfillment and Allocation counts on desktop and mobile.

### Returns

- Camera and manual serial capture are supported.
- A recognized serial resolves to its original picked release and order.
- An unmatched serial remains unresolved and must be quarantined for investigation.
- Downstream replacement, refund, supplier, Finance, and customer-closure evidence remains governed by role.

### Receiving

- PO and delivery-receipt references are visible operational inputs.
- Serialized and bulk items follow distinct quantity and identity validation.
- Inspection evidence and disposition govern putaway eligibility.
- Delivery-status writes use the released Supabase schema and scoped command permissions.

## Security and authority

- The browser receives only public Supabase configuration; service-role credentials remain in vaulted CI or server-only environments.
- Live mutations require authenticated capabilities and database enforcement.
- Test mutations are restricted to the approved UAT project and deterministic run IDs.
- Audit automation independently verifies persistence, handoff state, and cleanup.
- Vendor invitation delivery requires production-grade custom SMTP and monitored rate limits.

## Release and documentation controls

Every operational release must update:

1. Standalone operating handbook content and diagrams.
2. User manual.
3. Training and operations manual.
4. This technical and functional specification.
5. Training and handover content.
6. A dated release note.

CI compares operational source changes with this documentation set. `pnpm docs:build` compiles the maintained sources and embedded screenshots into the searchable, printable, self-contained `docs/manual/index.html`. `pnpm verify:release-documentation` rejects a release when that HTML no longer matches its sources. UAT certification generates a commit-bound manifest and bundles the consolidated HTML with current desktop/mobile audit screenshots. Production deployment is blocked when required documentation is stale.
