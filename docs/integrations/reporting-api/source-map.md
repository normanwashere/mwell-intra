# Reporting Source Mapping (Draft Only)

## Boundary

- Checkout: `.codex-worktrees/reporting-security-foundation`, branch `codex/reporting-security-foundation`, base `96f75f9`.
- Contract basis: [design sections 4 and 5](../../superpowers/specs/2026-09-20-reporting-api-design.md) and the unchanged [30-ID catalog](../../../apps/shell/lib/reporting/catalog.ts).
- **No dataset is ready or authorized.** Every dictionary entry has `status: draft`, `availability: not-ready`, `export_authorized: false`; runtime catalog entries remain `unavailable`. Proposed fields are review artifacts, not permission to export.
- Infrastructure/provider selection is still pending. This change creates no projection, migration, grants, API, capture job or deployment. The primary task continues DB authority work independently.
- No production connection, business-row query, secret query, RPC execution or row sample was used. RLS flags/view options are metadata evidence, not a least-privilege, role, policy or disclosure audit.

## Evidence And Fingerprint

UAT only: Supabase project `kkoitlvydytdhlpxhuah`, via `execute_sql`. Initial Warehouse/Procurement relation-name inventory was followed by three targeted catalog queries, all wrapped in `BEGIN READ ONLY` / `ROLLBACK`.

- First targeted review: `2026-09-23T02:47:15.171620Z`.
- Last targeted review: `2026-09-23T02:51:19.316058Z`.
- 42 reviewed relation descriptors, including 5 view definitions, with column types/nullability, primary/unique/foreign/check constraints, and RLS/view options.
- Fingerprint: `713cbd164ce3968a7cff8b2eb0419d6178d43e91093babb4c1588c874ed3f081`.
- Algorithm: `sha256-jcs-relations-v1`, SHA-256 of UTF-8 RFC 8785 canonical JSON of the `relations` array, retaining its stored array ordering. Parser/tests recalculate it. This is a scoped drift fingerprint, **not a signature or authorization decision**.
- Exact targeted SQL and metadata: [source-schema.json](source-schema.json). The fingerprint excludes provenance and repository-only child contracts; it does not cover all schemas, policies, grants, triggers, indexes, function bodies or business values.
- Queries were separate transactions, not a consistent business capture. Metadata may drift after review. Re-review current schema and DB authority before implementing projections. Repository evidence is tied to the stated base, not proof that every migration/function is deployed.

Eight child contracts come from `packages/data-kit/src/domain/{types,wms}.ts`, `modules/procurement/src/types.ts`, the shipment-history migration and the legacy-receipt backfill named in `child_contracts`. Database JSON array checks do not establish element types or requiredness. These are explicitly `runtime_shape_verified: false`; child scalars are conservatively nullable. Missing keys become null only in a future approved projection; malformed types must fail capture, not be silently coerced. No live child payload was inspected.

## Machine Contract

[dictionary.json](dictionary.json) has all 30 IDs, 269 explicitly proposed top-level business properties across primary/alternate projections, plus seven common envelope fields. This count includes collection containers, not their leaves.

Each scalar declares its exact source relation/column/path, transport type, nullability, semantic meaning, sensitivity, unit/currency, and optional target reference. References distinguish catalog-enforced foreign keys, unconstrained persisted IDs and repository-only JSON contracts. A null target dataset means a referential ID only, not permission to expand another module. IDs are opaque strings; labels are never joins.

The `exclusions` list explicitly enumerates every nonprojected column of each primary/alternate source. For a collection, only its named `properties` may be projected; `additional_properties: false` and the global recursive exclusions apply to every other child property, including future keys. Named `excluded_properties` highlight known child exclusions but are not an exhaustive denylist. No raw JSON, arbitrary record map, document/PDF, PII/contact, bank/tax data, signed URL, secret or unreviewed narrative is a public field.

Quantities/amounts use decimal strings with documented units; source integer counts/version numbers may remain integers. View nullability is not strengthened without evidence. Timestamps require UTC RFC 3339; date-only meanings are documented. `source_updated_at` uses an actual mapped `updated_at` or null, never a created/decision time or the inventory view's epoch. No currency is fabricated from UI formatting: money candidates have `currency: unresolved`, commercial sensitivity and a release blocker. Costs lacking an approved source/currency contract are excluded.

[Typed parser/accessor](../../../apps/shell/lib/reporting/dictionary.ts):
- `parseReportingDictionary(input, metadata?)` validates strict Zod 4 metadata shapes, 30-ID coverage, fingerprint binding, source references/types/nullability, field exclusions, child contracts, restriction gates and draft-only state.
- `getDatasetDictionary(id)` returns deeply frozen proposed metadata or undefined, using a Map rather than object-property lookup.
- `reviewedSourceSchema` and `reportingDictionary` are immutable. No parser result changes catalog readiness or constitutes export authority.
- This is a **dictionary parser, not a business-record serializer, sanitizer, authorization engine or ready API schema**. DB projections and data validation still require implementation and review.

The common envelope owns `source_id`; the inspection's polymorphic origin is separately named `inspection_source_id`. Approval steps have disjoint source-qualified projections for request and amendment steps. They are a proposed union, not a join or an assertion that all fields occur in both branches. Their record identities must include the source relation.

## Dataset Map

Every row below remains not-ready. Precise, machine-readable reasons are in each dictionary entry's `blockers`.

| Dataset | Reviewed primary/alternate source | Proposed grain | Specific blockers |
| --- | --- | --- | --- |
| `warehouse.products` | `warehouse.products` | One persisted product. | `active_state_absent`, `cost_fields_excluded` |
| `warehouse.locations` | `warehouse.locations` | One persisted location. | Common authority/disclosure gates only; not approved. |
| `warehouse.bins` | `warehouse.storage_areas` | One persisted storage area. | Common authority/disclosure gates only; not approved. |
| `warehouse.lots` | `warehouse.lots` | One persisted lot, not one supplier delivery. | `supplier_alias_missing`, `receipt_link_absent` |
| `warehouse.inventory_units` | `warehouse.inventory_units` | One persisted physical serialized inventory unit. | `personal_custody_excluded` |
| `warehouse.inventory_positions` | `warehouse.inventory_position_v1` | Candidate product/location/bin balance, not a movement journal. | `position_semantics_unapproved`, `position_identity_unapproved`, `source_time_synthetic` |
| `warehouse.movements` | `warehouse.movements` | One persisted movement journal entry. | `movement_reference_ambiguous` |
| `warehouse.receipts` | `warehouse.receipts` | One canonical physical Warehouse receipt with parent-owned lines. | `receipt_reconciliation_required` |
| `warehouse.inspections` | `warehouse.quality_inspections` | One persisted inspection; not one inspection/hold join row. | `inspection_source_union`, `quality_view_fanout` |
| `warehouse.holds` | `warehouse.inventory_holds` | One persisted inventory hold. | Common authority/disclosure gates only; not approved. |
| `warehouse.allocations` | `warehouse.allocations` | One persisted event allocation. | `request_reference_absent` |
| `warehouse.department_requests` | `warehouse.department_stock_requests` | One non-private request with parent-owned requested lines. | Common authority/disclosure gates only; not approved. |
| `warehouse.fulfillment_orders` | `warehouse.fulfillment_orders` | One fulfillment order with parent-owned operational lines. | `order_reference_privacy` |
| `warehouse.shipment_events` | `warehouse.fulfillment_orders` | One parent order-owned shipment-event collection, not one indexed event record. | `event_identity_absent`, `carrier_not_allowlisted` |
| `warehouse.return_cases` | `warehouse.customer_return_cases` | One customer-return case, not a physical receipt or vendor return. | `case_quantity_absent` |
| `warehouse.vendor_returns` | `warehouse.vendor_returns` | One persisted vendor return, distinct from customer cases. | `vendor_po_link_absent` |
| `warehouse.cycle_counts` | `warehouse.cycle_counts` | One count with a replaceable parent-owned count-line collection. | `view_index_ids_rejected` |
| `warehouse.kit_definitions` | `warehouse.kit_definitions` | One persisted versioned recipe with parent-owned components. | Common authority/disclosure gates only; not approved. |
| `warehouse.rekit_work_orders` | `warehouse.rekit_work_orders` | One return-case-based re-kit work order using a persisted recipe. | `component_identity_unresolved`, `unsupported_source_type` |
| `procurement.suppliers` | `core.vendors` | One approved reporting vendor-master identity; no automatic Warehouse supplier alias. | `supplier_alias_missing`, `vendor_identity_review` |
| `procurement.requests` | `procurement.requests` | One submitted-or-later request; never a saved private draft. | Common authority/disclosure gates only; not approved. |
| `procurement.approvals` | `procurement.approval_steps`, `procurement.purchase_order_amendment_steps` | Disjoint source-qualified union: one persisted request step OR amendment step. | `approval_union_contract`, `actor_pseudonymization_pending`, `approval_parent_gate` |
| `procurement.sourcing_events` | `procurement.sourcing_events` | One disclosed sourcing event with explicit route ID; no bid payload. | `route_projection_pending`, `opening_interlock_unverified` |
| `procurement.quotations` | `procurement.sourcing_responses` | One disclosed supplier response; all fields remain withheld pending opening authority. | `commercial_shape_unreviewed`, `opening_interlock_unverified` |
| `procurement.purchase_orders` | `procurement.purchase_orders` | One canonical Procurement PO, not a Warehouse legacy duplicate. | `po_authority` |
| `procurement.purchase_order_lines` | `procurement.purchase_order_lines` | One persisted normalized PO line. | `tax_treatment_absent`, `parent_po_disclosure` |
| `procurement.amendments` | `procurement.purchase_order_amendments` | One governed quantity amendment against one canonical PO line. | `approved_value_semantics`, `snapshot_excluded` |
| `procurement.receipts` | `procurement.receipts` | One legacy Procurement receipt, not a second physical delivery. | `legacy_receipt_not_current_feed`, `receipt_status_grain_mismatch`, `receipt_measure_sources_unresolved` |
| `procurement.payment_readiness` | `procurement.payment_readiness_packs` | One readiness pack with persisted current staleness indicators; never proof of payment. | `readiness_staleness_authority`, `acceptance_set_incomplete`, `not_payment` |
| `reference.links` | `procurement.purchase_orders` | Candidate explicit PO-to-request edge only; full cross-system relation registry remains unresolved. | `link_registry_incomplete`, `link_identity_unapproved`, `no_label_joins` |

## Identity And Semantics

- Embedded lines/components/shipment events are parent-owned, ordered collections, replaced atomically on parent upsert. They have no invented durable child ID, array-index ID, label-based identity or child-level deduplication. Procurement request JSON contains an application ID, but DB-enforced uniqueness/stability has not been established; it is not exported as a durable child key here.
- `warehouse.bi_cycle_counts_v1.id` concatenates the count ID with JSON ordinality. It is expressly rejected. Count expected/counted remain separate; variance is their difference on the same child, not a fabricated stock adjustment.
- `warehouse.inventory_position_v1` assigns all product commitments to the first sorted position, counts returned units as unavailable, omits positions without on-hand source rows, uses delimiter-concatenated IDs and returns a fixed epoch timestamp. Identity, overlap, location attribution and completeness need review. Measures stay separate; no claim of accurate per-bin reservation is made.
- `warehouse.bi_quality_v1` can fan out inspections through multiple holds. The inspection mapping uses the base inspection table. Movement mapping also uses persisted base movements and omits free-text source references.
- Canonical supplier identity is `core.vendors`. The reviewed `warehouse.suppliers` has no `core_vendor_id`; targeted `core.vendor_aliases` is absent. A migration candidate is not current-schema evidence. No supplier-name match, ID cast or guessed alias is allowed.
- Normalized PO lines have a real `warehouse_product_id` FK. Description, SKU and PO-number joins are forbidden. Tax treatment and currency are not established.
- Warehouse receipts are canonical physical receipts. Procurement receipts are legacy archived history under the repository's single-receipt-authority migration. Explicit reconciliation is required before combining them. The receipt-status view is PO grain and invokes a private function not reviewed here; its totals must not be copied onto each receipt.
- The customer-return case has no quantity column; quantity one is not assumed. Re-kit source is specifically `source_return_case_id`, not a generalized source mode. Component serial JSON is withheld pending structured linkage.
- Readiness is not payment. Persisted staleness flags and evidence versions must be checked against current PO authority in the same authorized snapshot. No release amount, bank data or private acceptance/payment document is disclosed.

## Disclosure Gates

All gates are proposals with `status: blocked`, not implemented filters.

1. Every dataset requires a current dedicated reporting grant, reviewed field/disclosure approval, audience dependency closure and atomic disclosure-epoch withdrawal. References, IDs, hashes, flags and counts cannot reveal excluded records.
2. Sources with private draft states use explicit positive state allowlists. Unknown/null/new states fail closed. Procurement requests additionally require `submitted_at IS NOT NULL`, recorded as `required_non_null`, so cancelled never-submitted drafts stay private. Explicit submitted-request ancestry gates also apply to approvals, sourcing, quotations, POs, lines, amendments, receipts, readiness and links. Missing/legacy requestless ancestry stays withheld pending a separate approved exception; optional keys are not automatic permission. These entries additionally carry `ancestor_disclosure_unverified`.
3. Sourcing/quotations require authoritative opening **and** reporting-disclosure permission. Neither an elapsed deadline, response receipt, event state nor `response_closed_at` is sufficient. Commercial/technical JSON remains excluded; even response IDs/vendor identities/counts remain withheld until the authoritative gate and withdrawal/purge interlock are verified.
4. Missing mappings are not an empty successful dataset. All incomplete contracts stay not-ready with specific blockers; scope exclusions need explicit acceptance. Metadata alone never promotes readiness.

The dictionary records gates; the primary DB-authority task must prove them with real least-privilege role and negative tests before any future publication.

## Verification

[dictionary.test.ts](../../../apps/shell/lib/reporting/dictionary.test.ts) covers all 30 IDs, strict unknown-key rejection, source/reference/type/nullability validation, per-column inclusion/exclusion, child ownership and allowlists, fingerprint/UAT binding, draft and sealed-bid gates, immutable accessors, envelope boundaries and draft-only state. Tests run locally against metadata; they make no business or database requests.

Local verification on September 23, 2026 used the existing Node 24.19.0 runtime and Vitest 4.1.11 after the parallel dependency task's upgrade. From `apps/shell`:

- `node node_modules/vitest/vitest.mjs run lib/reporting`: 7 files, 174 tests passed, including 39 dictionary tests.
- `node node_modules/vitest/vitest.mjs run`: 85 files passed, 995 tests passed; one existing browser-only test skipped because `KB_TASK_BROWSER` was not enabled (`lib/knowledge/taskGuidance.browser.test.tsx`).
- `node node_modules/typescript/bin/tsc --noEmit --incremental false`: passed.
- `node node_modules/eslint/bin/eslint.js lib/reporting/dictionary.ts lib/reporting/dictionary.test.ts`: passed.

Negative tests were observed failing before their fixes for envelope type/nullability, draft submission predicates and ancestor disclosure. No dependency files were changed by this dictionary task. No live Reporting API or business-record export was exercised or enabled. These local checks do not discharge the documented DB/disclosure release blockers.

Source queries followed PostgreSQL's catalog metadata model: [System Catalogs](https://www.postgresql.org/docs/current/catalogs.html). That reference explains catalog use; only the captured UAT results substantiate this mapping.
