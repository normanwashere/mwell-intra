# September 7 Open Items Remediation

Target: UAT only (`mwell-intra-uat.vercel.app`, Supabase `kkoitlvydytdhlpxhuah`). This is a working verification record, not a completion certificate.

## Acceptance Gates

| Item | Required behavior | Required evidence | Status |
| --- | --- | --- | --- |
| Requester identity | Authorized request reviewers see the requester display name without broader profile access. Unrelated users cannot enumerate names. | Scoped projection positive/negative tests and cross-role UAT screenshot. | In progress |
| Mobile metadata | Long product attributes and identifiers remain readable without horizontal clipping; quantity remains visible. | Long-value regression plus desktop/mobile rendered screenshots. | Source fix and focused tests complete; live check pending |
| Actual delivery date | Governed receiving captures the actual calendar date, validates it and persists it on the receipt; it is not replaced by expected arrival or posting time. | UI validation, command/persistence regression, UAT receipt readback. | In progress |
| Durable evidence | Authenticated live capture stores private objects, persists their paths, and opens them after reload for authorized handover roles. Failed uploads do not become inline-success evidence. | Upload/retry tests, storage RLS positive/negative checks, real UAT upload and independent readback. | In progress |

## Data Protection

Preserve all six shared tester POs and their current progress. Use only the separately labelled VERIFY records for controlled transactions. Do not backfill unknown historical dates, invent physical inspection evidence, or reset completed stock movements.

## Root Cause Identified

The evidence capture component called the repository's configuration-based `resolveDataSource()` without supplying configuration. That resolves to memory mode even when the application has an authenticated Supabase repository. Tests that mocked the helper to return Supabase did not exercise this integration mismatch. The replacement must use the actual authenticated session and fail closed when a live client is unavailable.

The existing private evidence bucket also needs a bounded handover policy: an independent authorized reviewer must be able to read registered evidence without being granted arbitrary access to other users' unregistered objects.

## Coverage Boundaries

Synthetic browser evidence can verify file upload, persistence, authorization and rendered preview. It cannot certify a physical delivery, camera hardware, actual signature or human usability pilot. These remain distinct from the software defects above.
