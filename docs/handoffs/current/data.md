# Data Handoff

Read the [current release manifest](release-status.json) before relying on a build, export or test result. The [September Data pack](../2026-09-22/data.md) is historical context, not current release certification. Remediation deployment and retest remain pending.

The operational app and governed CSV exports are separate from the Reporting API. The API and recipient connector remain undelivered and disabled. Follow the [separate implementation phase](../../integrations/reporting-api/SEPARATE-IMPLEMENTATION-PHASE.md), [delivery gates](../../integrations/reporting-api/RELEASE-READINESS.md) and [proposed Data setup](../../integrations/reporting-api/DATA-TEAM-QUICKSTART.md). No named recipient owner, provider profile or field dictionary approval is inferred from those documents.

For the pending Procurement/Finance CSV correction, an unknown ordered or received quantity is a blank numeric cell with the matching `Ordered Units Availability` or `Received Units Availability` value `unknown`. A verified zero remains `0` with `available`. Do not coerce blanks to zero, sum a partially known total or treat `NaN` as a valid quantity. Existing numeric columns retain their positions; the two availability columns are appended. Check downstream imports by header and retain unknown state. This is a candidate contract, awaiting live download/readback evidence.

Finance's committed-PO and net-received totals use their displayed period when available. Inventory value is a current balance; needs-review, payment reviews, Finance close and activity remain all time. Do not reconcile all-time detail directly to monthly totals without matching scope. Inventory report product-wide availability repeats by product and must not be summed across position rows. Viewing or downloading a report does not establish daily reconciliation, payment, business acceptance or API delivery.

Handoff uses approved secret-manager references only. No Supabase service-role key, direct operational database access, private attachment link or live record dump is a connection workaround. SMTP is not required or certified.
