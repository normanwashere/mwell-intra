# Task 5: Legal and vendor experience

## Delivered

- Added authenticated, RLS-scoped private document access at `POST /api/legal/documents/access`. The route looks up the Legal document record with the caller's server client before issuing an eight-minute signed URL from the private `documents` bucket.
- Added the Legal document access adapter and replaced direct local-preview links with governed open/download controls for stored documents. Demo documents remain local previews.
- Added a versioned correction presentation and memory-mode correction request transition. Submitted and under-review applications are read-only; a Legal correction request records its source version, requested revision, actor, note, and timeline event. Resubmission is presented as a correction resubmission.
- Added deterministic stale draft recovery: a version/conflict response reloads the newest server snapshot and asks the vendor to review it before editing again. It does not retry a potentially stale mutation.
- Normalized lifecycle presentation for renewal, suspension, offboarding, and reinstatement. Reinstatement is shown as unavailable because the existing lifecycle RPC does not support it; no unsupported mutation was added.
- Preserved existing capability gates: invitation uses `legal.manage_checklist`, review/reminder uses `legal.review_accreditation`, accreditation decisions use `legal.approve_accreditation`, vendor draft edits use `core.manage_own_accreditation_draft`, and document access remains server/RLS governed.
- Retained the reminder action because `legal.send_accreditation_reminder` already exists in the current backend contract.

## TDD evidence

- RED: `vendorCaseWorkflow.test.ts` initially failed because the workflow module did not exist; the correction transition test then failed because `canRequestCorrection` did not exist.
- GREEN: 9 workflow tests now cover read-only submitted/under-review states, correction revisions, stale recovery, lifecycle wording, and valid correction origins.
- RED: `legal-document-access.test.ts` initially failed because the signed-access route did not exist.
- GREEN: 3 API tests cover anonymous denial, RLS-scoped cross-vendor denial, and the bounded signed-download URL.

## Verification

- `pnpm.cmd --filter @intra/legal test` - 144 passed.
- `pnpm.cmd --filter @intra/legal lint` - passed.
- `pnpm.cmd --filter @intra/legal typecheck` - passed.
- `pnpm.cmd --filter @intra/shell test -- tests/api/legal-document-access.test.ts tests/api/health.test.ts` - 4 passed.
- `pnpm.cmd --filter @intra/shell typecheck` remains blocked by the pre-existing, out-of-scope Warehouse error in `modules/warehouse/src/pages/ProductDetailPage.tsx`: missing `pending_inspection` in `Record<UnitStatus, Tone>`.

## Scope

Only `modules/legal`, `apps/shell/app/api/legal`, legal API tests, and this report were changed. No migrations, Knowledge Base files, role fixtures, Learning code, or other product modules were edited.
