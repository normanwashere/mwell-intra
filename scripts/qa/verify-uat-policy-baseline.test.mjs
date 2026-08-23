import assert from "node:assert/strict";
import test from "node:test";

import {
  validateUatPolicyBaselineInputs,
  verifyUatPolicyBaseline,
} from "./verify-uat-policy-baseline.mjs";

const valid = {
  url: "https://uatref.supabase.co",
  serviceKey: "service-key",
  appEnv: "uat",
  expectedProjectRef: "uatref",
  productionProjectRef: "productionref",
  now: new Date("2026-08-23T00:00:00.000Z"),
};

const maker = "10000000-0000-4000-8000-000000000001";
const checker = "10000000-0000-4000-8000-000000000002";
const parentId = "10000000-0000-4000-8000-000000000003";
const operatingId = "10000000-0000-4000-8000-000000000004";
const controlSources = Object.fromEntries(
  [
    "formalBidAmount", "inviteTargetMin", "inviteTargetMax", "sealedBidMinimumResponses",
    "bidWindowWorkingDays", "maxExtensionCalendarDays", "vendorAcknowledgementHours",
    "clarificationHours", "tabulationHours", "technicalEvaluationWorkingDays",
    "poAcknowledgementHours", "repeatOrderMaxAmount", "repeatOrderMaxAgeDays",
    "pettyCashMaxAmount", "poInvoiceThreshold", "vendorProbationMonths",
  ].map((key) => [key, "controlled-source.docx"]),
);

const operating = {
  id: operatingId,
  code: "MWELL-PROCUREMENT-OPERATING",
  version: "2026-08-UAT",
  relationship: "mwell_operating",
  source_profile_id: parentId,
  source_filename: "mWell Procurement Policy and Procedures - Revised Modern Visual - Word Updated.docx",
  source_document_status: "approved",
  control_sources: controlSources,
  formal_bid_amount: 1_000_000,
  invite_target_min: 3,
  invite_target_max: 4,
  sealed_bid_minimum_responses: 3,
  bid_window_working_days: 7,
  max_extension_calendar_days: 7,
  vendor_acknowledgement_hours: 24,
  clarification_hours: 48,
  tabulation_hours: 48,
  technical_evaluation_working_days: 5,
  po_acknowledgement_hours: 48,
  repeat_order_max_amount: 250_000,
  repeat_order_max_age_days: 365,
  petty_cash_max_amount: 2_000,
  po_invoice_threshold: 50_000,
  vendor_probation_months: 6,
  status: "active",
  effective_from: "2026-08-01T00:00:00.000Z",
  effective_to: null,
  document_hash: "51f4e381cf7dec6a1950867c4839750078db08d603a5de8aa54b63d12f6d1239",
  created_by: maker,
  last_modified_by: maker,
  activated_by: checker,
  activated_at: "2026-08-22T00:00:00.000Z",
};

const parent = {
  id: parentId,
  code: "MPIC-PROCUREMENT-2025-02",
  version: "2025-02",
  relationship: "parent_source",
  source_filename: "MPIC Procurement Policy February2025.docx",
  source_document_status: "approved",
  status: "active",
  document_hash: "538c6c7cd25449a55b1608559af83c2c7aaaafdd5e8be1cc2580392cf46ec996",
};

function response(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function fixtureFetch({ profiles = [operating], activationEvents = [{
  event_type: "activated",
  actor_id: checker,
  profile_actor_id: maker,
  profile_revision: 1,
  event_at: "2026-08-22T00:00:00.000Z",
}] } = {}) {
  return async (input) => {
    const url = new URL(input);
    if (url.pathname.endsWith("/policy_profile_events")) return response(activationEvents);
    if (url.searchParams.get("relationship") === "eq.mwell_operating") return response(profiles);
    return response([parent]);
  };
}

test("rejects non-UAT and production targets before querying", () => {
  assert.throws(
    () => validateUatPolicyBaselineInputs({ ...valid, appEnv: "production", expectedProjectRef: "productionref", url: "https://productionref.supabase.co" }),
    /production|uat/i,
  );
});

test("verifies the exact active UAT policy lineage, controls, and activation evidence", async () => {
  const result = await verifyUatPolicyBaseline({ ...valid, fetchImpl: fixtureFetch() });
  assert.equal(result.profileId, operatingId);
  assert.equal(result.parentProfileId, parentId);
});

test("fails closed when no effective Mwell profile exists", async () => {
  await assert.rejects(
    () => verifyUatPolicyBaseline({ ...valid, fetchImpl: fixtureFetch({ profiles: [] }) }),
    /expected one effective/i,
  );
});

test("fails closed when maker and checker are the same user", async () => {
  await assert.rejects(
    () => verifyUatPolicyBaseline({ ...valid, fetchImpl: fixtureFetch({ profiles: [{ ...operating, activated_by: maker }] }) }),
    /maker and checker/i,
  );
});
