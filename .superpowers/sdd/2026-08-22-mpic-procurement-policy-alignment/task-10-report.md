# Task 10: Vendor Probation, Eligibility, and Payment Evidence

## Delivered

- Added pure Procurement eligibility and payment-evidence projections. They use the request-bound policy profile, define `approved`, `probation`, `provisional`, `expired`, `suspended`, `rejected`, and `temporary_clearance`, and never turn a client assertion into transaction authority.
- Added Legal/VMO display projection for six-month probation metrics: PO win rate >= 20%, delivery commitment = 100%, zero returns/rejections, and document timeliness = 100%. The panel surfaces evidence/notice references and labels Procurement consumption as read-only.
- Added an itemized Finance evidence panel with the active PHP 50,000 Mwell profile threshold, invoice/OR/SI, PO/agreement, acceptance, match, tax/withholding, and foreign-vendor controls. Existing finalized-evidence staleness history remains visible.
- Added governed migration controls for Legal/VMO eligibility decisions, revision/exact replay, maker/decision separation, pass/extend/revoke/suspend evidence and notice, automatic six-month probation creation on accreditation approval, sample custody, private helpers, forced RLS, grants, and private-helper revocations.
- Replaced invitation, PO issue, and payment-readiness public wrappers with server-side eligibility/evidence checks. Scoped temporary clearance requires an active date window and exact request scope. Payment evidence is recomputed from governed records; stale-evidence invalidation stays in the existing payment lifecycle.
- Added a disposable PGlite Task 10 role matrix for anon, unrelated authenticated, Legal authority, direct table write denial, private-helper revocation, evidence/notice decision requirements, sample custody, and exact Legal decision replay.

## Verification

- Node runtime: `C:\Users\NormanArisDeocareza\.cache\node-runtimes\node-v22.17.0-win-x64\node.exe` (`v22.17.0`) with Corepack `dist\pnpm.js`; child `PATH` prepended the same Node 22 directory.
- `pnpm --filter @intra/procurement test -- vendorEligibility.test.ts PaymentReadinessPanel.test.ts`: passed, 27 files / 187 tests.
- `pnpm --filter @intra/legal test -- VendorLifecyclePanel.test.tsx`: passed, 20 files / 157 tests.
- `pnpm --filter @intra/procurement typecheck`, `pnpm --filter @intra/legal typecheck`, and `pnpm --filter @intra/shell typecheck`: passed.
- `node scripts/verify-mpic-procurement-policy-alignment.mjs`: passed.
- `pnpm exec node --test scripts/verify-mpic-procurement-policy-alignment.test.mjs`: passed, 21/21 tests. This includes PGlite parse smoke and the disposable Task 10 public RPC/RLS/negative matrix.
- `git diff --check`: passed before commit.

## Gates And Limits

- Legal/VMO remains the authoritative write boundary. Procurement may read the projection and has no direct decision, sample-custody, eligibility, or payment-readiness assertion authority.
- Temporary clearance is valid only when Legal/VMO approved it, it is current, and its scope equals the request category. Expired, suspended, and rejected vendors are blocked.
- A pass requires the exact 20%/100%/zero/100% probation metric set plus evidence and issued notice. Extend, revoke, and suspend also require evidence and notice, are revision-bound, and reject changed retries.
- Mwell-requested samples require purpose, custodian, evaluation, disposition, evidence, and a PO link. Sample evaluation does not accredit or award a vendor.
- No migration, deployment, remote UAT, production mutation, `.codex-tmp`, `apps/shell/artifacts`, `deliverables`, or `outputs` path was touched.
- Controlled desktop/mobile browser certification did not pass. The memory role flow reached the payment surface and rendered the itemized evidence panel, but the current closed seed PO has no acceptance editor required by the existing recovery scenario; Legal/Vendor fixtures also rely on an outdated form action. Browser evidence therefore remains a release gate and is not claimed by this report.

## Fix Round 1

- The locally used `procurement.prepare_invoice_payment_readiness(jsonb)` is now the sole public invoice-preparation entry point. It delegates to `private.policy_prepare_invoice_payment_readiness(jsonb)`; the former public implementation is renamed and revoked. The private command locks and recomputes the issued PO, request, current Legal/VMO eligibility, request-bound active operating profile, itemized invoice amount, accepted unpaid value, PO match, tax/withholding, foreign-vendor evidence, and acceptance-version staleness. Client booleans are ignored.
- Core expiry is fail-closed. `core.vendors.accreditation_expires_at` blocks invitation, issue, and payment unless a separate Legal/VMO, maker-decider, revision-bound temporary clearance is approved for the exact request/category, amount, effective window, evidence, and notice. Existing approved `legal.accreditation_dispositions.temporary_clearance` data is deterministically imported as immutable legacy evidence.
- Legal/VMO now has a reachable authority workspace in the Legal cases route for six-month review metrics, governed pass/extend/revoke/suspend decisions, clearance opening/independent approval or revocation, and sample custody. Procurement continues to render only the authority projection. Exact replay validates the original metrics/evidence/notice instead of accepting a changed retry.
- The Finance UI now collects a separate foreign-vendor tax/payment-control reference and forwards it solely as evidence. The server persists it with the payment pack and decides whether it is required.
- The real-role PGlite matrix now covers anon and unrelated denial, private-helper/direct-DML denial, review maker/decider separation, exact replay and stale retry rejection, expired core accreditation, wrong/future/expired/active clearance, the actual invoice endpoint, foreign-evidence recovery, and acceptance-version invalidation. It does not apply the migration.
- The stale browser fixture now starts from an issued ECG PO. It executes requester/Warehouse acceptance, Procurement evidence, Finance acceptance, two payment releases, verifies that payment does not close the PO, and retains desktop/mobile screenshots at `docs/qa/evidence/task-10-finance-recovery-desktop-1280.png` and `docs/qa/evidence/task-10-finance-recovery-mobile-390.png`. Trace-enabled runs are retained in the Playwright test results directory.

### Fix Round Verification

- Node `22.17.0` was used explicitly through `C:\Users\NormanArisDeocareza\.cache\node-runtimes\node-v22.17.0-win-x64\node.exe`, Corepack `dist\pnpm.js`, and a child `PATH` prefixed with that Node directory.
- `pnpm --filter @intra/legal test`: passed, 158 tests.
- Procurement, Legal, and Shell `typecheck`: passed.
- `node scripts/verify-mpic-procurement-policy-alignment.mjs`: passed.
- `pnpm exec node --test --test-name-pattern "Task 10 vendor|PGlite parse smoke" scripts/verify-mpic-procurement-policy-alignment.test.mjs`: passed.
- Trace-enabled Playwright `policy-payment-readiness.spec.ts`: passed on `desktop-1280` and `mobile-390`.

### Migration Status Ruling

The shared-target migration-status ruling remains the Task 12 stop gate. This workspace is intentionally unlinked: `20260822110000_mpic_procurement_policy_alignment.sql` was not applied locally or remotely, and no shared target was queried. Before Task 12/UAT proceeds, retain a read-only linked-target status artifact proving this migration is pending and the remote chain has not drifted; stop UAT if it is already applied or drift is found.

## Fix Round 2

- Effective public Finance acceptance and release now call a private revoked assertion that fails closed on `evidence_stale`, acceptance-evidence version drift, or acceptance-set mismatch. The invoice endpoint preserves finalized-stale `corrected_from` recovery.
- The Node 22 disposable matrix passed (2/2): real Finance acceptance, governed acceptance-change staleness, denied Finance accept/release, and corrected-pack acceptance/release; anon, unrelated, Procurement, Legal maker/decider, Finance, vendor, and service roles cover public endpoints, direct DML/private-helper denials, replay, expiry, clearance scope/window, invitation/issue, and foreign evidence.
- Controlled browser/RPC evidence passed (2/2) at `desktop-1440` and `mobile-390`. The fixture owns authority state without localStorage mutation: Legal maker then independent decider restores eligibility; Procurement invites/issues; requester accepts; Procurement prepares; Finance accepts/releases; Procurement requests closure; independent department head approves.
- Retained evidence: `docs/qa/evidence/task-10-controlled-authority-desktop-1440.png`, `docs/qa/evidence/task-10-controlled-authority-mobile-390.png`, and matching `.trace.json` traces.
- Verification: `node scripts/verify-mpic-procurement-policy-alignment.mjs`; focused PGlite/parse test; Shell TypeScript; and `playwright ... task-10-controlled-authority-journey.spec.ts --project=desktop-1440 --project=mobile-390 --timeout=30000` all passed with Node `v22.17.0` and pinned Corepack.
- The Task 12 linked-target status ruling above is unchanged. No migration was applied or deployed.
