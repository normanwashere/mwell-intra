# September 11 UAT Update

The update is live at https://mwell-intra-uat.vercel.app. Existing tabs may need a reload to pick up the new version.

## What Changed

- Marketing can acknowledge an issued department request directly from Department requests. The existing reference, evidence and independent-recipient checks still apply.
- Warehouse conflict details are clickable. Return cases show the original order reference, and order details provide more context.
- Desktop order counters and detail layouts are clearer. Notifications support unread filtering and sorting.
- Error messages explain the problem and what to do next in simpler language.
- Stock-action checks fetch fewer unrelated datasets. Notifications pause periodic checks in hidden tabs.
- The audit-history query has a supporting index. Three database access checks were optimized without changing permissions or removing existing indexes.

Receiving, approvals, picking, packing, release and acknowledgment remain the same workflow.

## Deployment Receipt

- Application commit: `e411a7e6eec5c03694990866833d63388865f048`
- Vercel deployment: `dpl_FPaXJTUfz7UMyZZb1pQgjm3Sxi6n`
- UAT Supabase project: `kkoitlvydytdhlpxhuah`
- Database migration: `20260911035750_loading_query_performance`
- Public health endpoint confirmed the exact commit, reachable Supabase and reachable static assets.
- Main production was not changed.

## Checks After Deployment

All six read-only checks passed: Marketing, Operations Associate and Administrator at desktop 1440 px and mobile 390 px. No uncaught page errors or server 500 responses were captured.

Marketing showed two eligible acknowledgment actions in each viewport. The form opened correctly, with confirmation disabled until required information is supplied. No acknowledgment was submitted. Operations order counters and Admin audit/notification controls were checked. Screenshots were captured; the mobile acknowledgment form and desktop Operations queue were visually reviewed.

Tester stock and transactions were left untouched. This was a deployment smoke test, not a new full transaction certification, all-role audit or peak-load test.

## Evidence

- Results: `outputs/sep11-uat-deployment/results.json`
- Desktop Operations: `outputs/sep11-uat-deployment/operations-1440.png`
- Mobile acknowledgment: `outputs/sep11-uat-deployment/marketing-acknowledgment-390.png`
- Additional Marketing, Operations, Admin and notification screenshots are in the same evidence folder.
- Database measurements and pre-deployment regression scope: `docs/audits/2026-09-11-LOADING-PERFORMANCE.md`

The handbook, training material and technical specification have been updated to reflect this release. Broader initial-load optimization, representative concurrency testing and index review remain separate scaling work.

