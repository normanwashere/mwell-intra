# September 9 Fixes: Live UAT Deployment

- Promoted September 10, 2026, 14:32 UTC (22:32 Singapore/Philippines).
- Site: https://mwell-intra-uat.vercel.app.
- Deployed revision: `044ee26507a8cc661387049394ffa2fc810b7734`.
- Deployment: `dpl_vgxU9y86eADiB8SQrsAKQQmYLWWC` (Ready).
- Source: clean Git archive. Unrelated local drafts, optional learning migration and temporary files excluded.
- Vercel project: `mwell-intra-uat`, `prj_tYR1vpcOlxkAF6jja3meH9L5nL2y`.
- Supabase: `kkoitlvydytdhlpxhuah`. Production app and database were not modified.

## Database Changes

Installed `20260910133142_replacement_delivery_confirmation.sql` and `20260910140118_fulfillment_handover_acknowledgment_guard.sql`. The migration service initially assigned execution timestamps; history versions were aligned to the exact source filenames after successful installation, without rerunning the SQL.

Verified the new JSONB column, preserved predecessor resolution chain and handover-only guard. Authenticated callers retain the public entry; anonymous execution and authenticated access to the private predecessor remain denied. Functions retain an empty search path. An unauthenticated resolution call returned Authentication required, as expected.

Counts immediately before and after migration: 46 products, 44 fulfillment orders, 9 return cases and 12 stock rows. No tester stock was consumed and no seed records were deleted. Security advisor returned 13 informational RLS-enabled/no-policy notices, with no warning/error-level findings; these tables were not opened up to clear the notices.

## Verification

- Remote optimized build and TypeScript passed.
- Exact revision, UAT environment, correct Supabase reference, configured authentication, reachable database and stylesheet HTTP 200 confirmed on the public UAT health endpoint.
- 28 focused replacement/acknowledgment database regression tests passed locally before migration.
- 87 handbook tests and release-documentation synchronization passed before deployment.
- Operations Associate signed in through the actual UAT login. Session restoration and the available-client-update Reload action completed.
- Expanded live return-flow guidance and confirmed the allocation versus physical-intake clarification.
- Opened seeded PO `UAT-SEP08-TESTER2-PO-0005` without submitting or saving a receipt. Expanded the compact requirement summary; selecting the delivery-date requirement focused the date input. Confirm remained disabled while requirements were missing.
- Visually reviewed the desktop receiving modal and the settled 390x844 mobile sheet. Save progress and Confirm were visible, grouped on desktop and stacked on mobile. The initial frame immediately after resizing was transitional and was not accepted as mobile evidence.
- Opened the live Pick & Pack queue. Operations Associate actions for allocation, picking and packing were present, with second-operator release restrictions retained where applicable. No transaction was submitted.
- Deployment-scoped error-log lookup returned no matching logs in the sampled window. This is not proof of whole-app error absence.

## Still Open

These were deployment smoke checks, not a full multi-role live transaction certificate. Replacement persistence/replay, acknowledgment uploads, completed-order proof retrieval and every September 9 journey still need their corresponding live transaction checks. Local tests are retained separately in the development verification report.

Live product lookup found no barcode `MW-JCKT-333354`. Seeded Jacket-S products have distinct set-specific mappings. The reported physical label still needs matching to its actual PO before any data correction; no barcode was guessed or rewritten.

The response and offline handbook were updated after promotion to state the actual rollout status. Their post-deployment status wording is an offline documentation follow-up; the deployed app remains revision `044ee26` and includes the updated KB instructions.
