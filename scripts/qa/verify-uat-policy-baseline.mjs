#!/usr/bin/env node

import { fileURLToPath } from "node:url";

import { assertApprovedMutationTarget } from "../lib/target-environment.mjs";

const CONTROL_KEYS = [
  "formalBidAmount",
  "inviteTargetMin",
  "inviteTargetMax",
  "sealedBidMinimumResponses",
  "bidWindowWorkingDays",
  "maxExtensionCalendarDays",
  "vendorAcknowledgementHours",
  "clarificationHours",
  "tabulationHours",
  "technicalEvaluationWorkingDays",
  "poAcknowledgementHours",
  "repeatOrderMaxAmount",
  "repeatOrderMaxAgeDays",
  "pettyCashMaxAmount",
  "poInvoiceThreshold",
  "vendorProbationMonths",
];

const EXPECTED = {
  code: "MWELL-PROCUREMENT-OPERATING",
  version: "2026-08-UAT",
  sourceFilename:
    "mWell Procurement Policy and Procedures - Revised Modern Visual - Word Updated.docx",
  documentHash:
    "51f4e381cf7dec6a1950867c4839750078db08d603a5de8aa54b63d12f6d1239",
  parentCode: "MPIC-PROCUREMENT-2025-02",
  parentVersion: "2025-02",
  parentSourceFilename: "MPIC Procurement Policy February2025.docx",
  parentDocumentHash:
    "538c6c7cd25449a55b1608559af83c2c7aaaafdd5e8be1cc2580392cf46ec996",
  controls: {
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
  },
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function schemaHeaders(serviceKey, profile = "procurement") {
  return {
    apikey: serviceKey,
    authorization: `Bearer ${serviceKey}`,
    accept: "application/json",
    "accept-profile": profile,
  };
}

async function readJson(response, label) {
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`${label} did not return JSON.`);
  }
  if (!response.ok) {
    throw new Error(`${label} failed with HTTP ${response.status}: ${payload?.message ?? "unknown error"}`);
  }
  return payload;
}

export function validateUatPolicyBaselineInputs({
  url,
  serviceKey,
  appEnv,
  expectedProjectRef,
  productionProjectRef,
}) {
  assertApprovedMutationTarget({
    appEnv,
    supabaseUrl: url,
    expectedProjectRef,
    productionProjectRef,
    mutationsRequested: true,
    mutationsApproved: true,
  });
  assert(appEnv === "uat", "The policy baseline verifier only runs against APP_ENV=uat.");
  assert(Boolean(serviceKey), "SUPABASE_SERVICE_ROLE_KEY is required for the UAT policy baseline verifier.");
}

export async function verifyUatPolicyBaseline({
  url,
  serviceKey,
  appEnv,
  expectedProjectRef,
  productionProjectRef,
  now = new Date(),
  fetchImpl = fetch,
}) {
  validateUatPolicyBaselineInputs({
    url,
    serviceKey,
    appEnv,
    expectedProjectRef,
    productionProjectRef,
  });

  const profileSelect = [
    "id",
    "code",
    "version",
    "relationship",
    "source_profile_id",
    "source_filename",
    "source_document_status",
    "control_sources",
    "formal_bid_amount",
    "invite_target_min",
    "invite_target_max",
    "sealed_bid_minimum_responses",
    "bid_window_working_days",
    "max_extension_calendar_days",
    "vendor_acknowledgement_hours",
    "clarification_hours",
    "tabulation_hours",
    "technical_evaluation_working_days",
    "po_acknowledgement_hours",
    "repeat_order_max_amount",
    "repeat_order_max_age_days",
    "petty_cash_max_amount",
    "po_invoice_threshold",
    "vendor_probation_months",
    "status",
    "effective_from",
    "effective_to",
    "document_hash",
    "created_by",
    "last_modified_by",
    "activated_by",
    "activated_at",
  ].join(",");
  const operatingUrl = new URL("/rest/v1/policy_profiles", url);
  operatingUrl.searchParams.set("select", profileSelect);
  operatingUrl.searchParams.set("relationship", "eq.mwell_operating");
  operatingUrl.searchParams.set("status", "eq.active");
  const operatingRows = await readJson(
    await fetchImpl(operatingUrl, { headers: schemaHeaders(serviceKey), cache: "no-store" }),
    "Active Mwell policy profile query",
  );
  const timestamp = now.getTime();
  const effectiveRows = operatingRows.filter((row) => {
    const from = Date.parse(row.effective_from);
    const to = row.effective_to ? Date.parse(row.effective_to) : Number.POSITIVE_INFINITY;
    return Number.isFinite(from) && from <= timestamp && timestamp < to;
  });
  assert(effectiveRows.length === 1, `Expected one effective Mwell operating profile; found ${effectiveRows.length}.`);
  const operating = effectiveRows[0];

  assert(operating.code === EXPECTED.code, "The active Mwell policy code does not match the UAT baseline.");
  assert(operating.version === EXPECTED.version, "The active Mwell policy version does not match the UAT baseline.");
  assert(operating.source_filename === EXPECTED.sourceFilename, "The active Mwell policy source filename is incorrect.");
  assert(operating.source_document_status === "approved", "The active Mwell policy source must be approved.");
  assert(operating.document_hash === EXPECTED.documentHash, "The active Mwell policy document hash is incorrect.");
  assert(Boolean(operating.source_profile_id), "The active Mwell policy must inherit from a parent source profile.");
  assert(Boolean(operating.activated_at), "The active Mwell policy must have activation evidence.");
  assert(Boolean(operating.activated_by), "The active Mwell policy must identify its checker.");
  assert(
    operating.created_by !== operating.activated_by && operating.last_modified_by !== operating.activated_by,
    "The active Mwell policy maker and checker must be different users.",
  );
  for (const key of CONTROL_KEYS) {
    assert(
      typeof operating.control_sources?.[key] === "string" && operating.control_sources[key].trim(),
      `The active Mwell policy is missing source attribution for ${key}.`,
    );
  }
  for (const [column, expected] of Object.entries(EXPECTED.controls)) {
    assert(Number(operating[column]) === expected, `The active Mwell policy control ${column} is incorrect.`);
  }

  const parentUrl = new URL("/rest/v1/policy_profiles", url);
  parentUrl.searchParams.set(
    "select",
    "id,code,version,relationship,source_filename,source_document_status,status,document_hash",
  );
  parentUrl.searchParams.set("id", `eq.${operating.source_profile_id}`);
  const parentRows = await readJson(
    await fetchImpl(parentUrl, { headers: schemaHeaders(serviceKey), cache: "no-store" }),
    "Parent policy profile query",
  );
  assert(parentRows.length === 1, "The active Mwell policy parent source profile is missing.");
  const parent = parentRows[0];
  assert(parent.code === EXPECTED.parentCode && parent.version === EXPECTED.parentVersion, "The parent policy identity is incorrect.");
  assert(parent.relationship === "parent_source" && parent.status === "active", "The parent policy source must be active.");
  assert(parent.source_document_status === "approved", "The parent policy source must be approved.");
  assert(parent.source_filename === EXPECTED.parentSourceFilename, "The parent policy source filename is incorrect.");
  assert(parent.document_hash === EXPECTED.parentDocumentHash, "The parent policy document hash is incorrect.");

  const eventsUrl = new URL("/rest/v1/policy_profile_events", url);
  eventsUrl.searchParams.set("select", "event_type,actor_id,profile_actor_id,profile_revision,event_at");
  eventsUrl.searchParams.set("policy_profile_id", `eq.${operating.id}`);
  eventsUrl.searchParams.set("event_type", "eq.activated");
  const events = await readJson(
    await fetchImpl(eventsUrl, { headers: schemaHeaders(serviceKey), cache: "no-store" }),
    "Policy activation evidence query",
  );
  assert(events.length === 1, `Expected one immutable activation event; found ${events.length}.`);
  assert(events[0].actor_id === operating.activated_by, "The activation event checker does not match the active profile.");
  assert(events[0].profile_actor_id === operating.last_modified_by, "The activation event maker does not match the active profile.");

  return {
    profileId: operating.id,
    code: operating.code,
    version: operating.version,
    parentProfileId: parent.id,
    effectiveFrom: operating.effective_from,
    activatedAt: operating.activated_at,
  };
}

async function main() {
  const result = await verifyUatPolicyBaseline({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    appEnv: process.env.APP_ENV ?? "",
    expectedProjectRef: process.env.SUPABASE_PROJECT_REF ?? "",
    productionProjectRef: process.env.PRODUCTION_SUPABASE_PROJECT_REF ?? "",
  });
  console.log(`Verified active UAT procurement policy ${result.code} ${result.version}.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
