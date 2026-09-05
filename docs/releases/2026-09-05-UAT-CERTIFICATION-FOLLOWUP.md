# September 5 UAT Certification Follow-Up

Target: https://mwell-intra-uat.vercel.app and Supabase kkoitlvydytdhlpxhuah only. Main production is not promoted.

## Corrections

- Restrict Procurement payment-document lookup to the same effective employee capabilities enforced by the server. Operations PO viewers keep their authorized acceptance workflow without a predictably denied private-document request. Ignore stale asynchronous evidence after actor or scope changes; retain genuine reviewer errors.
- Remove the duplicate putaway task description while retaining selected stock identity and eligible quantity.
- Update Procurement, Legal, Finance, Product and Insights operating guidance, the standalone HTML handbook, technical specification, and training material.
- Apply reviewed forward receiving/return authority and quality-verifier migrations. Do not replay already-installed historical migrations solely because tool-assigned versions differ from repository filenames.
- Pin Browserslist to patched 4.28.7; the production dependency audit reports zero advisories after the update.
- Second acceptance pass: isolate Finance source recovery, correct mixed legacy/exact Quality accounting, replace the vendor upload-only count with requirement wording, and provide 44px Product permalinks with accurate labels. These follow-up changes require their next matching deployment.
- Stabilize real-route and focus assertions without increasing timeouts or removing authority/focus checks. Correct hidden-disclosure audit targeting and wait for meaningful queue readiness while preserving actual obstruction failures.
- Replace Legal's oversized introductory summary with a compact heading and actionable count filters. The deployed mobile review found the first case below the viewport; the corrected layout must pass a fresh check above the fixed bottom navigation before acceptance.
- Reflow Event custody metrics when text is enlarged. The live 320px/200% root-text probe reproduced overlapping labels; the candidate must preserve Reserved, Issued and Returned without clipping and receive its own new deployed visual check.
- The f764ee8 Event metric retest confirms stacked, readable labels; it separately exposed a shared-header overflow at enlarged text. A bounded, wrapping header is the follow-up correction, with new deployed geometry acceptance still required.
- Preserve procurement-line identity and its remaining quantity in the local training repository. Same-SKU/same-bin A/B tests now cover the previously omitted field. This is not represented as a newly discovered Supabase write vulnerability.
- Retain Warehouse task status through fixed, validated source/back URLs, and add task-specific accessible names to My Work source links. Receipt correction links now use structured field targets instead of focusing a generic line-selection checkbox; the summary remains accessible and announces on blur.
- Continue enlarged-text acceptance beyond the original component: a shared page-title icon and fixed event outcome columns still crowded text at 320px/root32. Reflow these without hiding content or reducing text size; validate normal desktop/mobile and enlarged text after deployment.

## Verification Boundary

Application/security/documentation changes through UAT commit 7dd30cb209480615d2c219453e39b3c220984c4c are deployed to the verified UAT database; main production is unchanged. That candidate passed all 45 workspace test/lint/typecheck tasks, including 678 Warehouse tests in 84 files, plus 83 handbook checks. Earlier audit/browser contracts passed 114 with one explicit skip. Procurement passes 210 tests. Security-verifier tests pass 24; receiving/return boundary tests pass 51. Actual UAT read-only verifier checks return raw_boundaries=0, examples=[], missing_objects=[], missing_grants=[], qualityChain=true. These suites overlap and are not summed as unique test cases. The subsequent title/outcome reflow needs its own regression and deployed verification.

All 11 desktop roles signed in during the earlier audit. The Operations Lead payment-evidence retest passes on desktop and mobile with zero network or console errors. On 7dd30cb, actual expanded Quality controls open the correct serial dialog, Close works, and Product links measure 44px high at 1440x900 and 390x844. Employee task-specific accessible names and exact event destinations pass at 1440/390/320. The existing 400-entry PO draft's correction links focus its actual quantity and serial fields on desktop/mobile without saving. Valid task source deep links retain Blocked/Completed on return and reload; those queues were empty, so a populated non-Due handoff is not claimed. Captures were opened and reviewed. These checks do not prove transaction completion, real-device camera behavior, external email receipt, or concurrent database races.

Keep tester sample data. Use isolated run-scoped records and the CI-only vaulted credential for governed transaction verification and cleanup. Do not call the release fully accepted until its commit-bound evidence bundle passes.

CI run 33947512758 passed dependency, deployed-schema, lint, typecheck, unit/contract and build stages for d0c98a8. It was intentionally cancelled during CodeQL, before persona reconciliation and orientation, because the deeper acceptance pass reproduced additional defects. It is not a completed certification. The deployed Operations Lead retest confirmed zero payment-evidence network/console failures on desktop and mobile; separate Quality disclosure-targeting and Product mobile target-size findings were retained for correction rather than ignored.
