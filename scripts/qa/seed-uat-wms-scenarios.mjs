#!/usr/bin/env node

import { fileURLToPath } from "node:url";

import { assertApprovedMutationTarget } from "../lib/target-environment.mjs";
import {
  UAT_WMS_ACTOR_EMAILS,
  UAT_WMS_IDS,
  buildUatWmsScenarioFixtures,
  fixtureCounts,
} from "./uat-wms-scenario-fixtures.mjs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function schemaHeaders(serviceKey, schema, prefer) {
  return {
    apikey: serviceKey,
    authorization: `Bearer ${serviceKey}`,
    accept: "application/json",
    "content-type": "application/json",
    "accept-profile": schema,
    "content-profile": schema,
    ...(prefer ? { prefer } : {}),
  };
}

async function readJson(response, label) {
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(
      `${label} failed with HTTP ${response.status}: ${payload?.message ?? text ?? "unknown error"}`,
    );
  }
  return payload;
}

export function validateUatWmsSeedInputs({
  url,
  serviceKey,
  appEnv,
  expectedProjectRef,
  productionProjectRef,
  mutationsApproved,
}) {
  assertApprovedMutationTarget({
    appEnv,
    supabaseUrl: url,
    expectedProjectRef,
    productionProjectRef,
    mutationsRequested: true,
    mutationsApproved,
  });
  assert(
    appEnv === "uat",
    "The WMS scenario seeder only runs against APP_ENV=uat.",
  );
  assert(Boolean(serviceKey), "SUPABASE_SERVICE_ROLE_KEY is required.");
}

async function loadActors({ url, serviceKey, fetchImpl }) {
  const endpoint = new URL("/rest/v1/profiles", url);
  endpoint.searchParams.set("select", "id,email");
  endpoint.searchParams.set(
    "email",
    `in.(${Object.values(UAT_WMS_ACTOR_EMAILS).join(",")})`,
  );
  const rows = await readJson(
    await fetchImpl(endpoint, {
      headers: schemaHeaders(serviceKey, "core"),
      cache: "no-store",
    }),
    "UAT actor lookup",
  );
  const byEmail = new Map(rows.map((row) => [row.email.toLowerCase(), row.id]));
  const actors = Object.fromEntries(
    Object.entries(UAT_WMS_ACTOR_EMAILS).map(([key, email]) => {
      const id = byEmail.get(email);
      assert(
        id,
        `Missing required UAT profile ${email}. Run pnpm provision:test:uat first.`,
      );
      return [key, id];
    }),
  );
  return actors;
}

async function insertMissing({
  url,
  serviceKey,
  schema,
  table,
  conflict,
  rows,
  fetchImpl,
}) {
  if (rows.length === 0) return;
  const endpoint = new URL(`/rest/v1/${table}`, url);
  endpoint.searchParams.set("on_conflict", conflict);
  await readJson(
    await fetchImpl(endpoint, {
      method: "POST",
      headers: schemaHeaders(
        serviceKey,
        schema,
        "resolution=ignore-duplicates,return=minimal",
      ),
      body: JSON.stringify(rows),
    }),
    `${schema}.${table} fixture insert`,
  );
}

async function repairMissingPurchaseOrderRequestLinks({
  url,
  serviceKey,
  purchaseOrders,
  fetchImpl,
}) {
  for (const purchaseOrder of purchaseOrders) {
    const endpoint = new URL("/rest/v1/purchase_orders", url);
    endpoint.searchParams.set("id", `eq.${purchaseOrder.id}`);
    endpoint.searchParams.set("request_id", "is.null");
    await readJson(
      await fetchImpl(endpoint, {
        method: "PATCH",
        headers: schemaHeaders(serviceKey, "procurement", "return=minimal"),
        body: JSON.stringify({ request_id: purchaseOrder.request_id }),
      }),
      `procurement.purchase_orders ${purchaseOrder.id} request link repair`,
    );
  }
}

async function verifySeed({ url, serviceKey, fetchImpl }) {
  const checks = [
    {
      schema: "procurement",
      table: "purchase_orders",
      filter: "po_number=in.(0001,0002,0003)",
      expected: 3,
    },
    {
      schema: "warehouse",
      table: "storage_areas",
      filter: "location_id=eq.uat-aug24-pasig-main",
      expected: 7,
    },
    {
      schema: "warehouse",
      table: "fulfillment_orders",
      filter: "external_reference=like.UAT-AUG24-*",
      expected: 12,
    },
    {
      schema: "warehouse",
      table: "customer_return_cases",
      filter: `source_order_id=eq.${UAT_WMS_IDS.deliveredOrder}`,
      expected: 4,
    },
  ];
  for (const check of checks) {
    const endpoint = new URL(`/rest/v1/${check.table}`, url);
    endpoint.searchParams.set("select", "*");
    const [key, value] = check.filter.split("=");
    endpoint.searchParams.set(key, value);
    const rows = await readJson(
      await fetchImpl(endpoint, {
        headers: schemaHeaders(serviceKey, check.schema),
        cache: "no-store",
      }),
      `${check.schema}.${check.table} verification`,
    );
    assert(
      rows.length >= check.expected,
      `${check.schema}.${check.table} expected at least ${check.expected} UAT rows; found ${rows.length}.`,
    );
  }
}

export async function seedUatWmsScenarios({
  url,
  serviceKey,
  appEnv,
  expectedProjectRef,
  productionProjectRef,
  mutationsApproved,
  fetchImpl = fetch,
  log = console.log,
}) {
  validateUatWmsSeedInputs({
    url,
    serviceKey,
    appEnv,
    expectedProjectRef,
    productionProjectRef,
    mutationsApproved,
  });
  const actors = await loadActors({ url, serviceKey, fetchImpl });
  const fixtures = buildUatWmsScenarioFixtures(actors);
  for (const fixture of fixtures) {
    await insertMissing({ url, serviceKey, fetchImpl, ...fixture });
    log(
      `Seeded ${fixture.schema}.${fixture.table}: ${fixture.rows.length} fixture row(s).`,
    );
  }
  const purchaseOrders = fixtures.find(
    (fixture) =>
      fixture.schema === "procurement" && fixture.table === "purchase_orders",
  )?.rows;
  await repairMissingPurchaseOrderRequestLinks({
    url,
    serviceKey,
    purchaseOrders: purchaseOrders ?? [],
    fetchImpl,
  });
  await verifySeed({ url, serviceKey, fetchImpl });
  return { counts: fixtureCounts(fixtures) };
}

async function main() {
  const result = await seedUatWmsScenarios({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    serviceKey:
      process.env.SUPABASE_SERVICE_ROLE_KEY ??
      process.env.SUPABASE_SECRET_KEY ??
      "",
    appEnv: process.env.APP_ENV ?? "",
    expectedProjectRef: process.env.SUPABASE_PROJECT_REF ?? "",
    productionProjectRef: process.env.PRODUCTION_SUPABASE_PROJECT_REF ?? "",
    mutationsApproved: process.env.POLICY_ALLOW_TEST_MUTATIONS === "true",
  });
  console.log(
    `Verified ${Object.values(result.counts).reduce((sum, count) => sum + count, 0)} deterministic UAT WMS fixture rows.`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
