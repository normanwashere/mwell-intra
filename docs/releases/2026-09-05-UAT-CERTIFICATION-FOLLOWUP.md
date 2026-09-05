# September 5 UAT Certification Follow-Up

Target: https://mwell-intra-uat.vercel.app and Supabase kkoitlvydytdhlpxhuah only. Main production is not promoted.

## Corrections

- Restrict Procurement payment-document lookup to the same effective employee capabilities enforced by the server. Operations PO viewers keep their authorized acceptance workflow without a predictably denied private-document request. Ignore stale asynchronous evidence after actor or scope changes; retain genuine reviewer errors.
- Remove the duplicate putaway task description while retaining selected stock identity and eligible quantity.
- Update Procurement, Legal, Finance, Product and Insights operating guidance, the standalone HTML handbook, technical specification, and training material.
- Apply reviewed forward receiving/return authority and quality-verifier migrations. Do not replay already-installed historical migrations solely because tool-assigned versions differ from repository filenames.
- Pin Browserslist to patched 4.28.7; the production dependency audit reports zero advisories after the update.

## Verification Boundary

The initial application/security patch is deployed. The next release manifest must identify the exact follow-up commit. The build passed; a new KB test typing failure was corrected and the combined regression gate is being rerun. Procurement passes 210 tests. Security-verifier tests pass 24; receiving/return boundary tests pass 51. Actual UAT read-only verifier checks return raw_boundaries=0, examples=[], missing_objects=[], missing_grants=[], qualityChain=true.

All 11 desktop roles signed in; the original route run remains failed for the Operations Lead payment-evidence HTTP 400 until its deployed retest passes. Read-only captures were reviewed for Operations Associate/Lead receiving, putaway, pick/pack recovery, plus targeted Administrator and Employee surfaces at 1440 and 390 pixels. These do not prove transaction completion, real-device camera behavior, external email receipt, or concurrent database races.

Keep tester sample data. Use isolated run-scoped records and the CI-only vaulted credential for governed transaction verification and cleanup. Do not call the release fully accepted until its commit-bound evidence bundle passes.
