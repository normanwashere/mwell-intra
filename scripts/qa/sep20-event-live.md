# Bounded First Smoke

Preparation only. Do not execute `run` until the release owner approves the exact
run after deployment, raw-read isolation, seller login and actual onboarding UI.
The native reports are local fixtures, not evidence that UAT migrations ran.

## Required Order

1. Parent pins the hosted UAT health commit/project and verifies exact installed
   definitions for the listed migrations, including the 36-table raw-read guard.
   Retain that read-only catalog evidence separately; a local source hash alone
   does not prove installation.
2. Parent provisions `intra.seller.uat.sep20@mwell.com.ph` as an active named
   Marketing member, department `7e55e54e-86cd-4157-9fdb-7616be83e340`, with
   ONLY `events.seller`. No staff, Warehouse or external-user exception.
3. Publish independently approved seller learning; complete the actual seller UI
   onboarding and retain evidence. Wait for the Sign in button to be enabled
   before filling login fields. Do not seed certificates or use a bypass.
4. Run offline preparation with Node 24 and a NEW external directory:

   `node scripts/qa/sep20-event-live.mjs prepare <absolute-output-directory> <full-deployed-commit> <https-candidate.vercel.app> <YYYY-MM-DD>`

   This generates exact new event/item IDs, four planned authenticated commands
   and a release-evidence template with every approval false. No network calls.
   The date is the actual execution date in Asia/Manila; do not extend expiry.
5. Parent creates only the two planned NEW products, each with
   `attributes.sep20_event_run` equal to the manifest run ID. Existing product
   substitutions are rejected. Stock is not needed for this first demand smoke;
   genuine shortages are allowed and no procurement/receiving proof is claimed.
   Extra serial/location IDs are reservations for a later separately approved
   journey, not instructions to create stock or fabricate lineage.
6. Parent completes `release-evidence.json` from the template, with references to
   actual installed-definition, raw RLS, seller UI/learning and new-product
   evidence. The runner treats these as owner attestations, not independent proof.
7. ONLY following separate exact-run authorization, supply `APP_ENV=uat`,
   `AUDIT_MUTATIONS=true`, `SEP20_EVENT_LIVE_APPROVED=<manifest-run-id>` and
   `AUDIT_PASSWORD` securely, then execute:

   `node scripts/qa/sep20-event-live.mjs run <absolute-output-directory>`

## Boundary

Uses current Marketing account `intra.test.marketing.events@mwell.com.ph` and the
new seller; no service key, grants, provisioning, SQL, SMTP or cleanup. Checks
current live capabilities, exact seller department/roles, raw seller isolation,
new product tags, new event ID and runtime schema/capability/learning readiness.
Creates event, explicitly enables custody, assigns seller, submits ONE two-line
demand and retries that same demand key. Requires one pending request and seller
readback with zero issued allocation/outcome entries.

Every command is saved before dispatch. An uncertain reply leaves a pending
record. STOP for authorized readback; do not delete the report or generate new
keys. There is intentionally no blind resume or automatic cleanup. Preserve all
partial history. A second `run` refuses to overwrite the saved result.

Approval, allocation, pick/pack/release/acknowledgment, sale/giveaway/reversal,
return/Quality, Product-approved conversion/recovery and Finance settlement are
NOT executed. `fullChainComplete` remains false even if this smoke passes. The
separate conversion contract requires actual receipt/QC/kit/readiness and exact
same-unit forward/return lineage; this smoke creates none of those prerequisites.

## Local Checks

`node --test --test-isolation=none scripts/qa/sep20-event-live.test.mjs`

Native verification requires `SEP20_PG_BIN` pointing to native PostgreSQL 17
binaries and `SEP20_NATIVE_OUTPUT` pointing outside this checkout. Both scripts
create and stop their own fresh loopback-only password-protected scratch cluster:

`node scripts/qa/sep20-native-concurrency.mjs`

`node scripts/qa/sep20-native-rls.mjs`

Neither accepts a UAT/production database URL. Certification and surrounding
fixtures remain synthetic. Contention requires distinct backend PIDs and an
observed PostgreSQL lock blocker, not elapsed time or queued PGlite calls.
