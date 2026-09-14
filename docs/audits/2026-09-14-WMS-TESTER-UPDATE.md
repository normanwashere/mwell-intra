# Warehouse Update - September 14

UAT is on **53e2599**, checked at 04:38 UTC. Here's what's ready and what we're still checking. Please leave marked synthetic audit records in place.

## What's Live

- Clearer Returns/Quality summaries and forms that keep Close and Save within reach.
- **Retry access**, authorized home-screen exports, and Procurement request completion after replenishment acceptance.
- Receiving-practice checkpoints, clearer onboarding progress, corrected role labels and local-time sourcing deadlines.

## What We Checked

- All seven isolated accounts completed their assigned learning, including Multi **11/11** and fresh receiving practice checked in the database. Shared credit wasn't counted as another practice.
- The synthetic Operations request passed approval, allocation, pick/pack, independent release and mobile receipt acknowledgement. Stock reconciled **7 to 5**. The packer's release action was withheld in the UI; no backend denial probe was run.
- Desktop/mobile unchanged Save preserved the sourcing deadline: **09:00 UTC / 17:00 Singapore**, one draft, no invitations or responses.
- These were controlled tests, not physical delivery. Completed handoff records and its synthetic receipt image remain retained.

## Still Being Tested

- **Finish review:** reviewed, not live yet. Confirmed receiving completion will return to the checklist without replaying a receipt. In-progress controls stay unchanged.
- **Pricing:** reviewed, not live yet. Read-only price context hands off to Product only with permission. **Load more products** exposes later rows; incomplete bundles show **Unavailable**, not partial totals. Cost-based percentages say **markup**; actual margin is unchanged.
- The reviewed pick-location fix is not live yet: show saved line-bin codes when the order has no source location, without changing allocation.
- **Blind counts:** the evidence gate blocked submission in our live check; no count or photo was submitted. The pending fix hides balance/variance clues until successful submission, keeping evidence and serial checks intact.
- CI 192 stopped on stale handbook HTML. Regeneration checks now pass, but skipped tests remain unproven. Vendor-test preflight, remaining journeys and real-user/device checks are still open. SMTP is outside this work.

**Full WMS certification remains open.**

[Release details](../releases/2026-09-14-RECEIVING-PRACTICE-CHECKPOINT.md) | [Retained handoff evidence](../../outputs/wms-signoff/sep14-isolated-onboarding-observation/operations-multirole-handoff-live.json)
