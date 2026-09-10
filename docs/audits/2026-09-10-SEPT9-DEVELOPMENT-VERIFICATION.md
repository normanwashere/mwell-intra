# September 9 Feedback: Development Verification

Scope: pages 1-5 of `wms comments (6).pdf`, September 9 feedback only. Earlier receiving, fulfillment and return regressions were rerun where affected; this is not a fresh certification of every historical feedback date.

Environment: local Next.js candidate at `http://localhost:3021`, in-memory fixtures, plus component/repository tests and isolated PGlite SQL checks. No UAT database writes, seed deletion, deployment or production changes were performed for this review.

## Evidence Boundaries

- The barcode `MW-JCKT-333354` was absent from the reviewed source/seed mapping. This does not prove the live database mapping is wrong. Exact product/variant validation remains enabled.
- Local fixtures prove interaction and state behavior, not physical camera scanning, real carrier delivery or a customer's acceptance.
- The initial receiving browser attempt showed a 404 while the local development server was being corrected. That capture is invalid evidence and is not counted as a successful receipt check.
- The replacement SQL tests use isolated database scaffolding. Tests of actual predecessor function bodies are not a full migration replay or live Supabase certification.
- Old screenshot approval metadata in the handbook is historical evidence. This release does not recertify every handbook screenshot.

## Browser Evidence Reviewed

The maintained test is `apps/shell/tests/e2e/sep09-feedback-local.spec.ts` with `apps/shell/playwright.sep09.config.ts`.

At 1440x1000 and 390x844, the local checks covered inventory, returns guidance, fulfillment navigation, document overflow, uncaught page errors, relocation serial removal, closing/reopening, reload/resume and discard. All four tests passed.

The relocation screenshots were opened and visually reviewed. Desktop uses a constrained centered dialog; mobile uses a bottom sheet. Source/destination labels, the retained serial, individual removal and the Move stock action fit the captured viewport without horizontal clipping. The local Next.js development indicator is not a production app control.

Raw captures are in `apps/shell/test-results/sep09-feedback-local-reloc-be0fd-rrection-and-draft-recovery-desktop/relocation-corrected-desktop.png` and the matching `mobile/relocation-corrected-mobile.png` directory. Test-results files are replaceable local output, not permanent live certification assets.

## Release Instructions

Latest parent verification: all 337 data-kit tests passed; 214 targeted warehouse/component tests passed; 42 KB checks passed; 87 handbook checks passed; 13 actual-predecessor replacement SQL regressions passed; 15 acknowledgment SQL checks passed; four operational-flow source contracts passed. These counts describe separate suites, not additional unique user journeys. The broader operational-flow check initially failed on a pre-existing adjacent-column string assertion; it now checks membership of all four required fulfillment projection fields rather than requiring them to be adjacent. An existing onboarding-link test was also corrected to validate the route, requirement and safe return destination using a URL parser instead of rejecting a valid extra return parameter.

A separate final run passed 21 additional warehouse tests covering the action-specific acknowledgment store gate, nested evidence dialogs and onboarding recovery links (235 targeted warehouse tests across the two disjoint runs). The fulfillment reviewer also passed 32 PGlite tests across acknowledgment, backorder and picked-bin suites; 15 overlap the parent acknowledgment run above. Data-kit, Warehouse and Shell typechecks passed. Scoped data-layer lint and repository diff checks passed.

Additional fulfillment browser evidence is under `tmp/fulfillment-sept9-final/`. The capture README lists exact steps. Parent review opened desktop/mobile relocation, mobile recipient upload, desktop/mobile replacement-address entry, and desktop POD-after-close images. These are local synthetic control-state captures. The initial POD fixture intentionally contained proof on a not-yet-packed order to exercise the evidence viewer; that fixture is not certification of a realistic completed-shipment journey.

Updated desktop/mobile POD-after-close captures were also opened and reviewed: the parent Close control is visible, and the reviewer verified it is clickable after the preview closes. The stress-fixture limitation remains; no real delivery is claimed.

See [the feedback response and tester instructions](../releases/2026-09-10-SEPT9-WMS-FEEDBACK.md). The standalone handbook is rebuilt from the maintained documentation, and KB receiving, relocation, delivery evidence and returns guidance has been updated in the app source.

Apply reviewed UAT migrations before the matching frontend, then rerun the listed transactions using actual UAT identities and uploaded test evidence. Do not use the local results as proof that the deployed UAT site already contains these changes.
