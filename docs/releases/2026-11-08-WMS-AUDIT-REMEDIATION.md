# WMS audit fixes - November 8, 2026

This release addresses the five findings from the November 8 read-only WMS audit. It is an application-only change based on UAT commit e328394efd07b3cbe7537e4799e271a4cc04818d.

## What changed

1. New receiving, storage and cycle-count work requires an explicit warehouse choice when several eligible sites exist. The app no longer chooses the first site returned by the database. Saved count recovery and exact receipt/task links keep their recorded context.
2. Warehouse alerts and dashboard stock summaries use verified inventory availability. Unknown quantities are identified for review and never presented as confirmed zero stock or automatic replenishment work. A verified zero remains a shortage.
3. Staging tasks identify the product, SKU and receiving area. Associates see the Operations Lead handoff for restricted stock-variance review without gaining adjustment or review authority.
4. Emailed PO registration keeps Save PO record and Cancel in the form footer on desktop and mobile. Required fields, evidence, independent confirmation and posting rules are unchanged.
5. Empty PO lists explain that there are no receivable POs and point to Closed history or Emailed POs. Closed history has its own accurate empty state.

## What stays the same

Procurement-issued POs and emailed POs remain separate, supported receiving paths. Existing approval, receipt, Quality, hold, putaway and stock-ledger commands are unchanged. This release contains no database migration or data cleanup. SMTP and the database password are untouched.

## Verification boundary

Automated component tests cover explicit warehouse selection, saved/source context, unknown versus zero inventory, task handoff, PO footer actions and unchanged receipt/Quality contracts. Disposable database transaction tests do not connect to UAT. Live verification is guarded read-only inspection through the existing Warehouse and Operations Lead accounts, including the Lead's existing Quality access; it does not submit receipts, decisions, stock movements or counts.

The deployment identity, exact results, desktop/mobile captures and before/after data-preservation checks are recorded in the November 8 WMS audit-fix release report. This source note is not a claim of full CI, live transaction certification, independent Quality-persona testing or department acceptance.
