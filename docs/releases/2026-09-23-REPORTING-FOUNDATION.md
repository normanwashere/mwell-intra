# Reporting Foundation Update

## What Changed

We have started building the secure connection for the Data team's dashboard. This release adds strict token and request validation, record-integrity checks, a draft Warehouse/Procurement field dictionary and the private access-control foundation. Known inherited dependency advisories are tracked in the remediation ledger. Vercel installs from the frozen lockfile.

The Data, Technical and Tester handoffs now separate implemented components, current UAT evidence and the work still needed before a dashboard can connect.

## What Testers Need to Know

Warehouse, Procurement, approvals and other business processes are unchanged by this work. Continue using the existing UAT accounts and normal flows. There is no new Reporting API screen or dashboard connection to test yet. SMTP is unchanged and remains outside this release's testing scope.

## Evidence and Limits

Use `docs/handoffs/2026-09-22/release-status.json` for the exact deployed commit, observation time and CI result. Detailed engineering evidence is in `docs/integrations/reporting-api/FOUNDATION-PROGRESS.md`, `AUTHORITY-FOUNDATION.md`, `DEPENDENCY-REMEDIATION.md` and `source-map.md`.

No reporting endpoint, machine credential, scheduled extraction or recipient connector is delivered. All 30 dataset IDs remain unavailable. Managed identity, field disclosure approval, private storage, atomic capture/publication, shared quotas, withdrawal/quarantine and end-to-end synchronization remain release gates. Neither a clean dependency scan nor unit tests are a penetration test or production acceptance.
