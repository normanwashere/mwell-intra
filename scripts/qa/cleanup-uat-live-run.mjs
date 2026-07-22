import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { assertApprovedMutationTarget } from "../lib/target-environment.mjs";
import { createAuditDatabaseClient } from "./live-e2e-db-verify.mjs";
import { assertDeterministicAuditRunId } from "./uat-ci-run-id.mjs";

const TRANSACTION_VIEWPORTS = new Set(["desktop-1440", "mobile-390"]);

function unique(values) {
  return [
    ...new Set(values.filter((value) => value !== null && value !== undefined)),
  ];
}

function apply(query, configure) {
  return configure(query);
}

export function buildRunScope(runId, viewport) {
  assertDeterministicAuditRunId(runId);
  if (!TRANSACTION_VIEWPORTS.has(viewport))
    throw new Error(`Unsupported transaction viewport: ${viewport}.`);
  const marker = `${runId}-${viewport}`;
  return {
    runId,
    viewport,
    marker,
    authEmail: `audit.vendor.${marker.toLowerCase()}@example.com`,
    eventNames: [
      `${marker} Event`,
      `${marker} Intra Event`,
      `${marker} Hold ATP event`,
    ],
    departments: [`${marker} Department`, `${marker} Receipt Department`],
    vendorNames: [
      `${marker} Vendor`,
      `${marker} Receipt Vendor`,
      `${marker} Expired Vendor`,
    ],
  };
}

export function assertZeroResidue(report) {
  const failures = (report?.results ?? []).filter(
    (item) => item.error || item.remaining !== 0,
  );
  if (!report?.complete || failures.length) {
    const summary = failures
      .map(
        (item) =>
          `${item.entity}: ${item.error ?? `${item.remaining} remaining`}`,
      )
      .join("; ");
    throw new Error(`Run-scoped cleanup certification failed. ${summary}`);
  }
  return report;
}

export async function cleanupAndVerifyRun({
  runId,
  viewport,
  client,
  env = process.env,
}) {
  assertApprovedMutationTarget({
    appEnv: env.APP_ENV,
    supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL,
    expectedProjectRef: env.SUPABASE_PROJECT_REF,
    productionProjectRef: env.PRODUCTION_SUPABASE_PROJECT_REF,
    mutationsRequested: true,
    mutationsApproved: env.POLICY_ALLOW_TEST_MUTATIONS === "true",
  });
  const scope = buildRunScope(runId, viewport);
  const database = client ?? createAuditDatabaseClient(env);
  const results = [];
  const discovered = {};

  const find = async (key, schema, table, select, configure) => {
    try {
      const { data, error } = await apply(
        database.schema(schema).from(table).select(select),
        configure,
      );
      if (error) throw new Error(error.message);
      const rows = data ?? [];
      discovered[key] = rows;
      return rows;
    } catch (error) {
      results.push({
        entity: `${schema}.${table}:scope-discovery`,
        remaining: null,
        error: error instanceof Error ? error.message : String(error),
      });
      discovered[key] = [];
      return [];
    }
  };

  const remove = async (schema, table, proofColumn, configure, label) => {
    const entity = label ?? `${schema}.${table}`;
    try {
      const beforeQuery = apply(
        database.schema(schema).from(table).select(proofColumn),
        configure,
      );
      const { data: before, error: beforeError } = await beforeQuery;
      if (beforeError) throw new Error(beforeError.message);

      const deleteQuery = apply(
        database.schema(schema).from(table).delete(),
        configure,
      );
      const { error: deleteError } = await deleteQuery;
      if (deleteError) throw new Error(deleteError.message);

      const afterQuery = apply(
        database
          .schema(schema)
          .from(table)
          .select(proofColumn, { count: "exact", head: true }),
        configure,
      );
      const { count, error: afterError } = await afterQuery;
      if (afterError) throw new Error(afterError.message);
      results.push({
        entity,
        removed: before?.length ?? 0,
        remaining: count ?? 0,
      });
    } catch (error) {
      results.push({
        entity,
        removed: 0,
        remaining: null,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const removeWhen = async (values, ...arguments_) => {
    if (values.length) return remove(...arguments_);
    results.push({
      entity: arguments_[4] ?? `${arguments_[0]}.${arguments_[1]}`,
      removed: 0,
      remaining: 0,
    });
  };

  const unionRows = (...groups) => {
    const byIdentity = new Map();
    for (const row of groups.flat()) byIdentity.set(JSON.stringify(row), row);
    return [...byIdentity.values()];
  };

  const [
    inviteRows,
    caseByName,
    caseById,
    vendorRows,
    requestById,
    requestByTitle,
  ] = await Promise.all([
    find("invites", "legal", "vendor_invites", "id,company_name", (query) =>
      query.eq("company_name", `${scope.marker} Vendor`),
    ),
    find(
      "casesByName",
      "legal",
      "accreditation_cases",
      "id,vendor_id,vendor_name",
      (query) => query.in("vendor_name", scope.vendorNames),
    ),
    find(
      "casesById",
      "legal",
      "accreditation_cases",
      "id,vendor_id,vendor_name",
      (query) => query.eq("id", `${scope.marker}-temporary-clearance-case`),
    ),
    find("vendors", "core", "vendors", "id,legal_name", (query) =>
      query.in("legal_name", scope.vendorNames),
    ),
    find("requestsById", "procurement", "requests", "id,title", (query) =>
      query.like("id", `${scope.marker}%`),
    ),
    find("requestsByTitle", "procurement", "requests", "id,title", (query) =>
      query.eq("title", `${scope.marker} Procurement draft`),
    ),
  ]);
  const caseRows = unionRows(caseByName, caseById);
  const inviteIds = unique(inviteRows.map((row) => row.id));
  const requestRows = unionRows(requestById, requestByTitle);
  const caseIds = unique(caseRows.map((row) => row.id));
  const vendorIds = unique([
    ...vendorRows.map((row) => row.id),
    ...caseRows.map((row) => row.vendor_id),
  ]);
  const requestIds = unique(requestRows.map((row) => row.id));

  const [
    matrixRows,
    poRows,
    productRows,
    eventRows,
    departmentRequestRows,
    roleRows,
    profileRows,
  ] = await Promise.all([
    find("matrices", "procurement", "doa_matrices", "id,department", (query) =>
      query.in("department", scope.departments),
    ),
    find(
      "purchaseOrders",
      "procurement",
      "purchase_orders",
      "id,request_id",
      (query) => query.like("id", `${scope.marker}%`),
    ),
    find("products", "warehouse", "products", "id", (query) =>
      query.like("id", `${scope.marker}%`),
    ),
    find("events", "warehouse", "events", "id,name", (query) =>
      query.in("name", scope.eventNames),
    ),
    find(
      "departmentRequests",
      "warehouse",
      "department_stock_requests",
      "id,purpose",
      (query) => query.eq("purpose", `${scope.marker} event fulfillment`),
    ),
    find("roles", "core", "roles", "role,label", (query) =>
      query.like("label", `${scope.marker}%`),
    ),
    find("profiles", "core", "profiles", "id,email", (query) =>
      query.eq("email", scope.authEmail),
    ),
  ]);
  const matrixIds = unique(matrixRows.map((row) => row.id));
  const poIds = unique(poRows.map((row) => row.id));
  const productIds = unique(productRows.map((row) => row.id));
  const eventIds = unique(eventRows.map((row) => row.id));
  const departmentRequestIds = unique(
    departmentRequestRows.map((row) => row.id),
  );
  const runRoles = unique(roleRows.map((row) => row.role));
  const profileIds = unique(profileRows.map((row) => row.id));

  const [receiptRows, amendmentRows, stockRequestRows] = await Promise.all([
    poIds.length
      ? find(
          "receipts",
          "warehouse",
          "receipts",
          "id,procurement_po_id",
          (query) => query.in("procurement_po_id", poIds),
        )
      : [],
    poIds.length
      ? find(
          "amendments",
          "procurement",
          "purchase_order_amendments",
          "id,purchase_order_id",
          (query) => query.in("purchase_order_id", poIds),
        )
      : [],
    find(
      "stockRequests",
      "warehouse",
      "stock_change_requests",
      "id,source_id",
      (query) =>
        query.in("source_id", [
          `${scope.marker}-cycle-count`,
          `${scope.marker}-self-cycle-count`,
        ]),
    ),
  ]);
  const receiptIds = unique(receiptRows.map((row) => row.id));
  const amendmentIds = unique(amendmentRows.map((row) => row.id));
  const stockRequestIds = unique(stockRequestRows.map((row) => row.id));

  const [instrumentRows, applicationRows] = await Promise.all([
    caseIds.length
      ? find(
          "instrumentDocuments",
          "legal",
          "instrument_documents",
          "id,case_id",
          (query) => query.in("case_id", caseIds),
        )
      : [],
    caseIds.length
      ? find(
          "applicationSnapshots",
          "legal",
          "vendor_application_snapshots",
          "id,case_id",
          (query) => query.in("case_id", caseIds),
        )
      : [],
  ]);
  const instrumentIds = unique(instrumentRows.map((row) => row.id));
  const applicationIds = unique(applicationRows.map((row) => row.id));

  const [qualityRows, decisionRows] = await Promise.all([
    receiptIds.length
      ? find(
          "quality",
          "warehouse",
          "quality_inspections",
          "id,source_id",
          (query) => query.in("source_id", receiptIds),
        )
      : [],
    receiptIds.length
      ? find(
          "decisions",
          "warehouse",
          "procurement_receipt_exception_decisions",
          "id,receipt_id",
          (query) => query.in("receipt_id", receiptIds),
        )
      : [],
  ]);
  const qualityIds = unique(qualityRows.map((row) => row.id));
  const decisionIds = unique(decisionRows.map((row) => row.id));
  const holdRows = qualityIds.length
    ? await find(
        "holds",
        "warehouse",
        "inventory_holds",
        "id,inspection_id",
        (query) => query.in("inspection_id", qualityIds),
      )
    : [];
  const holdIds = unique(holdRows.map((row) => row.id));
  const activityEntityIds = unique(
    [
      ...requestIds,
      ...matrixIds,
      ...poIds,
      ...receiptIds,
      ...qualityIds,
      ...holdIds,
      ...decisionIds,
      ...stockRequestIds,
      ...eventIds,
      ...departmentRequestIds,
    ].map(String),
  );

  if (runRoles.length) {
    try {
      const { data: group, error } = await database
        .schema("core")
        .from("approval_groups")
        .select("member_roles")
        .eq("entity_type", "warehouse_stock_change")
        .eq("group_code", "logistics_supervisor")
        .single();
      if (error) throw new Error(error.message);
      const memberRoles = (group?.member_roles ?? []).filter(
        (role) => !runRoles.includes(role),
      );
      const { error: updateError } = await database
        .schema("core")
        .from("approval_groups")
        .update({ member_roles: memberRoles })
        .eq("entity_type", "warehouse_stock_change")
        .eq("group_code", "logistics_supervisor");
      if (updateError) throw new Error(updateError.message);
      results.push({
        entity: "core.approval_groups:run-role-membership",
        removed: runRoles.length,
        remaining: 0,
      });
    } catch (error) {
      results.push({
        entity: "core.approval_groups:run-role-membership",
        removed: 0,
        remaining: null,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  } else {
    results.push({
      entity: "core.approval_groups:run-role-membership",
      removed: 0,
      remaining: 0,
    });
  }

  await removeWhen(
    decisionIds,
    "warehouse",
    "procurement_receipt_excess_custody",
    "decision_id",
    (query) => query.in("decision_id", decisionIds),
  );
  await removeWhen(
    decisionIds,
    "warehouse",
    "unidentified_receipt_custody",
    "decision_id",
    (query) => query.in("decision_id", decisionIds),
  );
  await removeWhen(
    decisionIds,
    "warehouse",
    "procurement_receipt_exception_lines",
    "decision_id",
    (query) => query.in("decision_id", decisionIds),
  );
  await removeWhen(
    amendmentIds,
    "procurement",
    "purchase_order_amendment_steps",
    "amendment_id",
    (query) => query.in("amendment_id", amendmentIds),
  );
  await removeWhen(
    instrumentIds,
    "legal",
    "instrument_lifecycle_events",
    "id",
    (query) => query.in("instrument_document_id", instrumentIds),
  );
  await removeWhen(
    instrumentIds,
    "legal",
    "instrument_signatures",
    "id",
    (query) => query.in("instrument_document_id", instrumentIds),
  );
  await removeWhen(
    applicationIds,
    "legal",
    "vendor_technology_qualifications",
    "id",
    (query) => query.in("application_snapshot_id", applicationIds),
  );
  await removeWhen(
    poIds,
    "procurement",
    "payment_readiness_staleness_events",
    "purchase_order_id",
    (query) => query.in("purchase_order_id", poIds),
  );
  await removeWhen(
    poIds,
    "procurement",
    "payment_readiness_packs",
    "purchase_order_id",
    (query) => query.in("purchase_order_id", poIds),
  );
  await removeWhen(
    poIds,
    "procurement",
    "acceptance_packs",
    "purchase_order_id",
    (query) => query.in("purchase_order_id", poIds),
  );
  await removeWhen(holdIds, "warehouse", "vendor_returns", "hold_id", (query) =>
    query.in("hold_id", holdIds),
  );
  await remove(
    "warehouse",
    "vendor_returns",
    "reference",
    (query) => query.like("reference", `${scope.marker}%`),
    "warehouse.vendor_returns:reference",
  );
  await removeWhen(holdIds, "warehouse", "inventory_holds", "id", (query) =>
    query.in("id", holdIds),
  );
  await removeWhen(
    decisionIds,
    "warehouse",
    "procurement_receipt_exception_decisions",
    "id",
    (query) => query.in("id", decisionIds),
  );
  await removeWhen(
    [...receiptIds, ...stockRequestIds, ...qualityIds],
    "warehouse",
    "exceptions",
    "id",
    (query) =>
      query.in(
        "source_id",
        unique([...receiptIds, ...stockRequestIds, ...qualityIds].map(String)),
      ),
  );
  await removeWhen(stockRequestIds, "core", "approvals", "id", (query) =>
    query
      .eq("entity_type", "warehouse_stock_change")
      .in("entity_id", stockRequestIds),
  );
  await remove("core", "documents", "id", (query) =>
    query.like("storage_path", `audit/${scope.marker}/%`),
  );
  await remove("warehouse", "command_log", "id", (query) =>
    query.like("idempotency_key", `${scope.marker}%`),
  );
  await removeWhen(
    eventIds,
    "warehouse",
    "event_lifecycle_events",
    "id",
    (query) => query.in("event_id", eventIds),
  );
  await removeWhen(eventIds, "warehouse", "allocations", "id", (query) =>
    query.in("event_id", eventIds),
  );
  await removeWhen(productIds, "warehouse", "movements", "id", (query) =>
    query.in("product_id", productIds),
  );
  await removeWhen(
    receiptIds,
    "warehouse",
    "quality_inspections",
    "id",
    (query) => query.in("source_id", receiptIds),
  );
  await removeWhen(receiptIds, "warehouse", "receipts", "id", (query) =>
    query.in("id", receiptIds),
  );
  await removeWhen(
    stockRequestIds,
    "warehouse",
    "stock_change_requests",
    "id",
    (query) => query.in("id", stockRequestIds),
  );
  await remove("warehouse", "cycle_counts", "id", (query) =>
    query.in("id", [
      `${scope.marker}-cycle-count`,
      `${scope.marker}-self-cycle-count`,
    ]),
  );
  await removeWhen(
    productIds,
    "warehouse",
    "stock_levels",
    "product_id",
    (query) => query.in("product_id", productIds),
  );
  await removeWhen(productIds, "warehouse", "inventory_units", "id", (query) =>
    query.in("product_id", productIds),
  );
  await removeWhen(
    amendmentIds,
    "procurement",
    "purchase_order_amendments",
    "id",
    (query) => query.in("id", amendmentIds),
  );
  await removeWhen(
    poIds,
    "procurement",
    "purchase_order_lines",
    "id",
    (query) => query.in("purchase_order_id", poIds),
  );
  await removeWhen(poIds, "procurement", "purchase_orders", "id", (query) =>
    query.in("id", poIds),
  );
  await removeWhen(
    requestIds,
    "procurement",
    "exception_packs",
    "id",
    (query) => query.in("request_id", requestIds),
  );
  await removeWhen(
    requestIds,
    "procurement",
    "policy_evidence",
    "id",
    (query) => query.in("request_id", requestIds),
  );
  await removeWhen(
    requestIds,
    "procurement",
    "route_decisions",
    "id",
    (query) => query.in("request_id", requestIds),
  );
  await removeWhen(
    requestIds,
    "procurement",
    "acceptance_reviewer_assignments",
    "request_id",
    (query) => query.in("request_id", requestIds),
  );
  await removeWhen(matrixIds, "procurement", "doa_assignments", "id", (query) =>
    query.in("matrix_id", matrixIds),
  );
  await removeWhen(
    caseIds,
    "legal",
    "accreditation_decision_reviews",
    "id",
    (query) => query.in("case_id", caseIds),
  );
  await removeWhen(
    caseIds,
    "legal",
    "accreditation_dispositions",
    "id",
    (query) => query.in("case_id", caseIds),
  );
  await removeWhen(caseIds, "legal", "accreditation_docs", "id", (query) =>
    query.in("case_id", caseIds),
  );
  await removeWhen(caseIds, "legal", "case_timeline", "id", (query) =>
    query.in("case_id", caseIds),
  );
  await removeWhen(
    caseIds,
    "legal",
    "requirement_checklist_items",
    "id",
    (query) => query.in("case_id", caseIds),
  );
  await removeWhen(caseIds, "legal", "signed_instruments", "id", (query) =>
    query.in("case_id", caseIds),
  );
  await removeWhen(
    instrumentIds,
    "legal",
    "instrument_documents",
    "id",
    (query) => query.in("id", instrumentIds),
  );
  await removeWhen(
    applicationIds,
    "legal",
    "vendor_application_snapshots",
    "id",
    (query) => query.in("id", applicationIds),
  );
  await removeWhen(
    inviteIds,
    "legal",
    "vendor_invite_commands",
    "id",
    (query) => query.in("invite_id", inviteIds),
  );
  await removeWhen(caseIds, "legal", "vendor_invites", "id", (query) =>
    query.in("case_id", caseIds),
  );
  await remove(
    "legal",
    "vendor_invites",
    "id",
    (query) => query.eq("company_name", `${scope.marker} Vendor`),
    "legal.vendor_invites:company-marker",
  );
  await removeWhen(caseIds, "legal", "accreditation_cases", "id", (query) =>
    query.in("id", caseIds),
  );
  await removeWhen(eventIds, "warehouse", "events", "id", (query) =>
    query.in("id", eventIds),
  );
  await removeWhen(
    departmentRequestIds,
    "warehouse",
    "department_stock_requests",
    "id",
    (query) => query.in("id", departmentRequestIds),
  );
  try {
    const { data, error } = await database
      .schema("product")
      .rpc("cleanup_certification_records", { p_marker: scope.marker });
    if (error) throw new Error(error.message);
    const [readinessVerification, pricingVerification] = await Promise.all([
      database
        .schema("product")
        .from("readiness_packages")
        .select("id", { count: "exact", head: true })
        .eq("title", `${scope.marker} launch readiness`),
      database
        .schema("product")
        .from("price_proposals")
        .select("id", { count: "exact", head: true })
        .eq("reason", `${scope.marker} governed pricing proposal`),
    ]);
    const verificationError =
      readinessVerification.error ?? pricingVerification.error;
    const remaining =
      Number(readinessVerification.count ?? 0) +
      Number(pricingVerification.count ?? 0);
    if (verificationError || remaining !== 0) {
      throw new Error(
        verificationError?.message ??
          `Product certification cleanup left ${remaining} record(s).`,
      );
    }
    results.push({
      entity: "product.certification-records",
      removed: Number(data?.removed ?? 0),
      remaining,
    });
  } catch (error) {
    results.push({
      entity: "product.certification-records",
      removed: 0,
      remaining: null,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  await removeWhen(productIds, "warehouse", "products", "id", (query) =>
    query.in("id", productIds),
  );
  await removeWhen(vendorIds, "warehouse", "suppliers", "id", (query) =>
    query.in(
      "id",
      vendorIds.map((id) => `proc-${id}`),
    ),
  );
  await removeWhen(requestIds, "procurement", "requests", "id", (query) =>
    query.in("id", requestIds),
  );
  await removeWhen(matrixIds, "procurement", "doa_matrices", "id", (query) =>
    query.in("id", matrixIds),
  );
  await removeWhen(activityEntityIds, "core", "activity_log", "id", (query) =>
    query.in("entity_id", activityEntityIds),
  );
  await remove(
    "core",
    "activity_log",
    "id",
    (query) => query.like("entity_id", `${scope.marker}%`),
    "core.activity_log:marker-prefix",
  );
  await removeWhen(runRoles, "core", "user_roles", "role", (query) =>
    query.eq("module", "warehouse").in("role", runRoles),
  );
  await removeWhen(runRoles, "core", "role_capabilities", "role", (query) =>
    query.eq("module", "warehouse").in("role", runRoles),
  );
  await removeWhen(runRoles, "core", "roles", "role", (query) =>
    query.eq("module", "warehouse").in("role", runRoles),
  );
  await removeWhen(
    profileIds,
    "core",
    "user_roles",
    "user_id",
    (query) => query.in("user_id", profileIds),
    "core.user_roles:audit-identity",
  );
  await remove(
    "core",
    "profiles",
    "id",
    (query) => query.eq("email", scope.authEmail),
    "core.profiles:audit-identity",
  );
  await removeWhen(vendorIds, "core", "vendors", "id", (query) =>
    query.in("id", vendorIds),
  );
  await remove("warehouse", "storage_areas", "code", (query) =>
    query.eq("code", scope.marker.toUpperCase()),
  );
  await remove("warehouse", "locations", "id", (query) =>
    query.eq("id", scope.marker),
  );

  try {
    let removed = 0;
    for (let page = 1; page <= 20; page += 1) {
      const { data, error } = await database.auth.admin.listUsers({
        page,
        perPage: 1000,
      });
      if (error) throw new Error(error.message);
      const matches = data.users.filter(
        (user) => user.email?.toLowerCase() === scope.authEmail,
      );
      for (const user of matches) {
        const { error: deleteError } = await database.auth.admin.deleteUser(
          user.id,
        );
        if (deleteError) throw new Error(deleteError.message);
        removed += 1;
      }
      if (data.users.length < 1000) break;
    }
    let remaining = 0;
    for (let page = 1; page <= 20; page += 1) {
      const { data, error } = await database.auth.admin.listUsers({
        page,
        perPage: 1000,
      });
      if (error) throw new Error(error.message);
      remaining += data.users.filter(
        (user) => user.email?.toLowerCase() === scope.authEmail,
      ).length;
      if (data.users.length < 1000) break;
    }
    results.push({ entity: "auth.users:audit-identity", removed, remaining });
  } catch (error) {
    results.push({
      entity: "auth.users:audit-identity",
      removed: 0,
      remaining: null,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const complete = results.every((item) => item.remaining === 0 && !item.error);
  return {
    runId,
    viewport,
    marker: scope.marker,
    completedAt: new Date().toISOString(),
    complete,
    results,
  };
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const runId = argument("--run-id") ?? process.env.AUDIT_RUN_ID;
  const viewport = argument("--viewport") ?? process.env.AUDIT_VIEWPORT;
  const outputPath =
    argument("--output") ??
    process.env.CLEANUP_OUTPUT_PATH ??
    "test-results/cleanup.json";
  let report;
  try {
    report = await cleanupAndVerifyRun({ runId, viewport });
  } catch (error) {
    report = {
      runId: runId ?? null,
      viewport: viewport ?? null,
      completedAt: new Date().toISOString(),
      complete: false,
      results: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  assertZeroResidue(report);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
