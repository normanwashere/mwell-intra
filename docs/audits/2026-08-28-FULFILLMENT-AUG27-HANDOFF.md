# August 27 Fulfillment Feedback Handoff

Scope: FulfillmentPage orders and department requests. This is a source-based handoff, not live screenshot evidence. No deployment, commit, or live database mutation was performed.

## Changes

- Orders and events has actionable counters: Active work, Waiting allocation, Picking, Packing, Ready for release. Picking includes allocated and picking orders. Selecting a counter clears search/channel filters so the displayed queue matches its count.
- Department requests has actionable counters: All requests, Awaiting decision, Approved, Allocated, Issued. Counts refresh after successful decisions.
- Request cards expose View request. Approval and rejection are available only inside the detail modal for authorized users and pending requests. Every item name, SKU and quantity is rendered before a decision.
- Split backorder accepts zero for an individual fulfill-now quantity. At least one quantity must be positive and at least one quantity must be deferred. Blank, fractional, negative and over-demand values cannot be submitted.
- The in-memory split validates the entire payload before changing the order, removes zero-quantity retained lines and preserves deferred demand in the linked child. The additive migration changes only the equivalent split branch and keeps the existing permission, row-lock, and idempotency machinery.

## Exact UI Labels for Screenshot Regression

All labels below come from `modules/warehouse/src/pages/FulfillmentPage.tsx`. Use the actual record purpose/reference and catalog product names in dynamic selectors.

### View Request

- Route: `/fulfillment?tab=requests`; tab accessible name: `Department requests`.
- Entry button: `View request` on the chosen request card.
- Dialog title: `View request / ${request.purpose}`.
- Metadata labels: `Department`, `Cost center`, `Required date`, `Expense treatment`, `Requested by`, `Requested at`, `Request ID`.
- Conditional metadata labels: `Approved by`, `Fulfillment order`.
- Table accessible name: `Requested items`.
- Column headings: `Item`, `Quantity`. Each item includes the catalog name and SKU, falling back to the product ID when unavailable.
- Pending-request footer for warehouse supervisor, logistics supervisor, or warehouse admin: `Reject`, `Approve`.
- Shared dialog dismiss button: `Close`.
- Requesters can view the same item table without decision controls. Already-decided requests do not expose decision controls.
- Success toast: `Request approved.` or `Request rejected.`

Screenshot states: pending multi-line request as warehouse supervisor; same request as Marketing without approval actions; approved request after refresh. Include a long product name and enough lines to exercise scrolling on mobile. The table must not omit later lines, and the footer must remain usable.

### Split Backorder

- Route: `/fulfillment?tab=orders`; tab accessible name: `Orders and events`.
- Entry button for received demand and an operator with issue authority: `Split backorder`.
- Dialog title: `Split backorder / ${order.externalReference}`.
- Description: `Keep the quantity Warehouse can fulfill now. The remainder stays visible as a linked backorder.`
- Quantity labels: exact catalog product names, falling back to product IDs. There is no literal `Fulfill now` field label.
- Quantity input IDs: `backorder-${productId}`; minimum `0`, step `1`, maximum original line quantity.
- Per-line hint: `Original demand: ${quantity}; deferred: ${remainder}`. Invalid quantities show `-` for deferred quantity.
- Invalid quantity status: `Enter a whole fulfill-now quantity from zero to the original demand for every item.`
- All-zero status: `At least one item must have a fulfill-now quantity.`
- Nothing-deferred status: `At least one item must have a deferred quantity.`
- Submit button: `Create backorder`; saving label: `Splitting...`; dismiss button: `Close`.
- Success toast: `Available demand retained and the remainder moved to a backorder.`

Screenshot states: mixed positive/zero quantities with enabled submit; all zero with disabled submit; all original quantities with disabled submit; fractional/blank/negative/over-demand input. Validate a successful mixed split only after the parent applies the migration to its intended test database.

### Counter Selectors

- Group accessible names: `Order counters`, `Request counters`.
- Every counter button has accessible name `${label}: ${count}` and `aria-pressed` for its active state.
- Order dropdown labels remain `Status` and `Channel`; search label is `Search orders`.
- Combined picking dropdown option: `Allocated and picking` (value `pick_queue`).
- A zero-count counter stays selectable and displays the existing empty queue state.

## Documentation Wording

In Fulfillment, select a queue counter to show matching orders or department requests. Open View request to review every requested item and quantity before approving or rejecting. When splitting received demand, enter zero for an item that must be deferred entirely; retain a positive fulfill-now quantity on at least one item and a deferred quantity on at least one item. The original order retains only positive fulfill-now lines, and the linked backorder retains the remaining demand.

The split wording is ready for release only after `20260828011200_fulfillment_zero_line_backorder.sql` is applied by the parent. The migration is currently local source only.

## Verification and Remaining Work

- Red phase: four counter/request-review regressions failed against the original UI; seven split-form regressions failed against the original form. Repository regressions exposed zero rejection and partial mutation. Local PostgreSQL regressions exposed zero rejection and permissive malformed selections.
- Green phase: 11 targeted FulfillmentPage UI tests; 33 tests across fulfillmentBackorder and wmsRepository; four local PGlite tests covering zero/deferred lines, invalid-payload rollback, positive splits, replay, permission and status checks.
- The full FulfillmentPage baseline passed its 23 existing tests. An intermediate full rerun hit an existing 15-second intake-test timeout and a following test was affected by unfinished user-event activity; the final targeted run passed. No timeout setting was changed.
- Runner warning: local PATH uses Node 20.18.1 / pnpm 9.15.9, below the repository's Node 22+ / pnpm 10.23.0 declarations.
- Parent owns live database migration/application checks and desktop/mobile screenshot verification. Neither was performed here.
