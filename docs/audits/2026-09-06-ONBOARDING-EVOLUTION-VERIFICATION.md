# Shared onboarding evolution: verification

Date: 2026-09-06. Status: local implementation candidate, not a live UAT certification or deployment.

## Implemented model

One onboarding center, checklist model, progress calculation, recovery panel, and training engine serve the eleven operating personas and combined-role accounts. Requirements are derived from assigned curricula and audience. The UI groups exact equivalent requirement definitions; it does not infer authority from similar titles. Vendor and employee scope remain separate.

Authorized module exploration no longer redirects users to onboarding merely because orientation is pending. Policy, assessment, simulation, current role, DOA, record ownership, and server authorization continue to govern the relevant transaction. This does not invent read access for pages that require a certified management capability.

Requirement recovery opens the exact assigned learning in a separate tab. The originating form stays open. Users return and explicitly refresh access before reviewing and submitting the transaction. Stale or unavailable learning state does not grant permission.

## Changes verified

| Area | Change | Evidence |
| --- | --- | --- |
| Module navigation | Removed blanket orientation redirects while preserving session and role boundaries | Eleven personas at desktop 1440 and mobile 390; unauthorized administration and vendor curriculum checks |
| Embedded modules | Warehouse, Procurement, and Legal routers wait for the host navigation commit | Actual module-entry browser checks, Warehouse and Legal regressions |
| Multi-role checklist | Combined requirements with explicit assigned module/role context | Finance and combined employee screenshots; exact identity/version and scope unit tests |
| Role presentation | Actual assigned roles replace misleading persona-derived authority labels; Product contributors are not labelled owners | Center regressions and refreshed Operations screenshots |
| Vendor identity | Company/profile name is visible in mobile onboarding | Vendor browser assertion and screenshot |
| Vendor learning | Added a local evidence-responsibility exercise that cannot act as a signature, upload, submission, or accreditation | Both vendor learning requirements complete in the local browser without business writes; third submission practice remains pending in the capture |
| Action recovery | Exact requirement, safe return path, separate learning tab, explicit access refresh | Uncertified receipt remains denied and original form data remains present |
| Legacy PO cancellation | Candidate SQL requires the existing cancellation grant and certified PO-authoring authority | Actual SQL denies pending/expired or unrelated-role credit and retains existing business checks |
| Vendor PO acknowledgement | Candidate SQL and UI require the existing certified submission capability | Actual SQL retains ownership, invitation identity, hash, and revision checks; UI preserves reference draft |
| KB task guidance | Maintained role/task destinations replace guessed keyword destinations | Mapping and rendered-component tests; actual app task and reference navigation |
| KB controls | Section navigation opens collapsed ancestors; screenshot zoom and hotspot controls retain 44px targets | Strict desktop/mobile geometry and accessibility checks, focused component tests |
| Documentation | User manual, training manual, technical specification, handover content, release note, and standalone HTML updated | HTML regenerated from 36 sources and freshness check passed |

## Test results

| Verification | Result |
| --- | --- |
| Final application production build, including TypeScript | Passed |
| Learning package unit/component suite | 207 passed |
| Procurement package suite | 224 passed |
| Focused Warehouse router, PO receipt, and cancellation suite | 50 passed |
| Shell navigation, KB mapping/content, outline, and layout-contract suite | 152 passed |
| Local SQL authority lifecycle and immutable publication guard | 9 passed |
| Documentation release contracts | 6 passed |
| Targeted application ESLint | No errors; repository configuration excludes browser test files |
| Standalone HTML freshness | Passed |
| Desktop/mobile onboarding and KB browser matrix | 52 passed in the final full run; two vendor cases failed an obsolete label assertion |
| Vendor label, company identity, completion, and isolation retest | 4 passed, including both previously failing cases |

All 54 distinct browser cases have passing results across the final full run and targeted retest. This is not a claim that the full suite completed in a single green invocation. No timeout was increased and no authorization, geometry, or completion assertion was removed to achieve these results.

The eleven persona entry checks include the canonical combined-role accounts. They are not an exhaustive enumeration of every possible role combination or every transaction in Intra. The vendor browser case completes orientation and the evidence-responsibility review, not the entire accreditation submission curriculum.

Procurement and Legal exact contextual-help browser cases use explicitly labelled controlled API responses because the memory environment has no server-authenticated actor. Separate unmocked cases verify the generic memory fallback. These tests are not evidence of live Supabase contextual authorization.

## Evidence locations

- Final full browser run: `outputs/onboarding-evolution/acceptance-clean`.
- Vendor correction and isolation retest: `outputs/onboarding-evolution/acceptance-vendor`.
- Internal workspace and checklist captures exist for every internal persona at both viewports in the final full-run directory.
- Vendor portal, initial checklist, and two-requirement-complete captures exist at both viewports in the vendor retest directory.
- Earlier failed runs remain under `outputs/onboarding-evolution`; they are diagnostic evidence, not acceptance results.

Representative captures:

- [Finance combined-role checklist, desktop](../../outputs/onboarding-evolution/acceptance-clean/e2e-onboarding-center-nonb-1dda3-orkspace-before-orientation-desktop-1440/demo-finance-checklist-desktop-1440.png)
- [Operations Associate checklist, mobile](../../outputs/onboarding-evolution/acceptance-clean/e2e-onboarding-center-nonb-7a0e7-orkspace-before-orientation-mobile-390/demo-warehouse-operator-checklist-mobile-390.png)
- [Vendor learning progress, mobile](../../outputs/onboarding-evolution/acceptance-vendor/e2e-onboarding-center-nonb-f759b-ore-its-isolated-curriculum-mobile-390/onboarding-vendor-complete-mobile-390.png)

An independent reviewer inspected 24 earlier captures covering all eleven personas on desktop/mobile plus the vendor workspace. The main review then checked refreshed Operations, Finance, Operations Associate mobile, and vendor mobile captures after label and identity corrections. No concrete content clipping was found in those reviewed captures. Full-page captures place fixed navigation at the viewport boundary; this is not evidence of a mid-document navigation bar. Local Next.js development controls remain visible in some captures.

## Rollout boundaries

1. Apply and verify the reviewed migration `20260906043800_gate_legacy_po_cancel_and_vendor_acknowledgement.sql` with the application release. It has not been applied to UAT in this work. No new capability grants are introduced.
2. The new vendor evidence exercise has no matching published UAT requirement. Publish a separately reviewed, versioned requirement/curriculum before claiming it is live. Do not overwrite immutable published content. The publication-guard test verifies that unsafe in-place changes are rejected.
3. Existing server-side title/simulation-based orientation sharing remains unchanged. The UI's exact-identity grouping is not a migration of that server policy. Explicit versioned equivalence remains the safer future sharing model.
4. Run live UAT certification after deployment, using actual published curricula and governed test records. This turn did not change UAT or production, reset passwords, seed/delete records, or certify live email delivery.
5. Existing manual screenshots retain their own provenance and age limits; this candidate does not recertify all historical handbook evidence.

Nonblocking presentation follow-up: some legacy curriculum titles still repeat module names, such as "Legal Legal Reviewer". A controlled display-name map can improve wording without changing curriculum IDs or published requirements. The vendor portal's detached help icon remains a separate page-layout improvement.

## Reproduction notes

Use the repository's memory simulation environment at `http://localhost:3020`, not `127.0.0.1`, for origin-sensitive assessment requests. Keep the existing CSRF checks. Run the production build before starting the memory dev server: the build clears `.next`, including the nested memory simulation output, and invalidates an already-running server. One diagnostic run was stopped for that environment failure and was excluded from acceptance evidence.

Browser command: `pnpm --filter @intra/shell exec playwright test onboarding-center.spec.ts onboarding-assessment-and-lock.spec.ts knowledge-contextual-help.spec.ts knowledge-guides-regression.spec.ts --project=desktop-1440 --project=mobile-390 --workers=2` with the existing reuse-server and base-URL environment variables. The vendor retest selects `vendor can browse|employee cannot open` and runs both projects with one worker.
