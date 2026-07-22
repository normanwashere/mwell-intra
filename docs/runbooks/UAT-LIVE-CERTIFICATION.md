# UAT Live Certification

This runbook defines the evidence required before an mWell Intra UAT build can
be promoted. It intentionally contains no passwords, tokens, or mailbox
credentials.

## Required GitHub environment

Configure these values in the repository's `uat` environment, not in source or
workflow YAML:

- `UAT_BASE_URL`: the protected UAT deployment origin.
- `UAT_EXPECTED_COMMIT_SHA`: the exact commit deployed for certification.
- `UAT_AUDIT_PASSWORD`: the vaulted shared password for temporary UAT personas.
- `UAT_VENDOR_AUDIT_EMAIL`: a controlled mailbox template containing the
  literal `{marker}`, for example `intra-uat+{marker}@company-test.example`.
- Supabase URL, publishable key, and service-role credential for the UAT project.
- Vercel protection bypass values scoped to the UAT origin.

The mailbox must support automated retrieval by unique marker. A catch-all
address that cannot prove receipt is not sufficient.

## Vendor invitation proof

For every desktop and mobile certification run:

1. Send a new invitation to the marker-specific mailbox address through the
   Legal user interface.
2. Poll the controlled mailbox and retain provider message id, recipient,
   delivery timestamp, subject, and the received link.
3. Open the received link in a fresh browser context.
4. Set the vendor password through the real reset-password screen.
5. Sign in, accept the invitation, complete required accreditation evidence,
   submit, correct a returned application, and receive a Legal decision.
6. Prove that replay, expired, and superseded links are rejected.
7. Read back every persisted status and actor handoff after refresh.
8. Remove the generated Auth identity, mailbox message, and run-scoped database
   records. Verify zero residue independently.

Generating a link with an administrative API, replacing an acceptance-token
hash, or setting the password with the service role does not certify delivery.

## Release decision

Promotion requires all of the following on the same commit:

- lint, typecheck, complete unit/integration suite, and production build pass;
- desktop and mobile transaction shards pass independently;
- the bundle proves both required transaction viewports and every declared
  scenario actor, negative case, checkpoint, and cleanup assertion;
- all six responsive route/visual shards pass;
- no serious accessibility, control-obstruction, dead-end, console, or network
  finding remains;
- independent cleanup reports zero residue.

Missing infrastructure is a failed certification, never a skipped pass.
