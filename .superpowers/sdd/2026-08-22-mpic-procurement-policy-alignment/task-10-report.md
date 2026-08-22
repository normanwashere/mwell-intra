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
