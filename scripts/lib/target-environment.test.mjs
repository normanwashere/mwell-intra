import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  assertApprovedMutationTarget,
  projectRefFromSupabaseUrl,
  verifyDeployedTargetIdentity,
} from "./target-environment.mjs";

test("projectRefFromSupabaseUrl accepts only exact Supabase project hosts", () => {
  assert.equal(
    projectRefFromSupabaseUrl("https://uatref123.supabase.co/rest/v1"),
    "uatref123",
  );
  assert.equal(projectRefFromSupabaseUrl("not a URL"), null);
  assert.equal(
    projectRefFromSupabaseUrl("https://uatref123.supabase.co.example.com"),
    null,
  );
  assert.equal(
    projectRefFromSupabaseUrl("https://supabase.co.example.com/uatref123"),
    null,
  );
});

test("rejects malformed Supabase URLs", () => {
  assert.throws(
    () =>
      assertApprovedMutationTarget({
        appEnv: "uat",
        supabaseUrl: "not a URL",
        expectedProjectRef: "uatref",
        productionProjectRef: "productionref",
        mutationsRequested: false,
        mutationsApproved: false,
      }),
    /valid Supabase project URL/i,
  );
});

test("rejects an exact project-ref mismatch", () => {
  assert.throws(
    () =>
      assertApprovedMutationTarget({
        appEnv: "uat",
        supabaseUrl: "https://uatref.supabase.co",
        expectedProjectRef: "anotherref",
        productionProjectRef: "productionref",
        mutationsRequested: false,
        mutationsApproved: false,
      }),
    /does not match SUPABASE_PROJECT_REF/i,
  );
});

test("compares configured project refs exactly", () => {
  assert.throws(
    () =>
      assertApprovedMutationTarget({
        appEnv: "uat",
        supabaseUrl: "https://uatref.supabase.co",
        expectedProjectRef: "UATREF",
        productionProjectRef: "productionref",
        mutationsRequested: false,
        mutationsApproved: false,
      }),
    /SUPABASE_PROJECT_REF must be a canonical project ref/i,
  );
});

test("rejects whitespace and malformed configured project refs", () => {
  for (const expectedProjectRef of [" uatref", "uatref ", "uat-ref"]) {
    assert.throws(
      () =>
        assertApprovedMutationTarget({
          appEnv: "uat",
          supabaseUrl: "https://uatref.supabase.co",
          expectedProjectRef,
          productionProjectRef: "productionref",
          mutationsRequested: false,
          mutationsApproved: false,
        }),
      /SUPABASE_PROJECT_REF must be a canonical project ref/i,
    );
  }

  for (const productionProjectRef of [
    " productionref",
    "productionref ",
    "production-ref",
  ]) {
    assert.throws(
      () =>
        assertApprovedMutationTarget({
          appEnv: "uat",
          supabaseUrl: "https://uatref.supabase.co",
          expectedProjectRef: "uatref",
          productionProjectRef,
          mutationsRequested: false,
          mutationsApproved: false,
        }),
      /PRODUCTION_SUPABASE_PROJECT_REF must be a canonical project ref/i,
    );
  }
});

test("rejects mutations when the production project ref is missing", () => {
  assert.throws(
    () =>
      assertApprovedMutationTarget({
        appEnv: "uat",
        supabaseUrl: "https://uatref.supabase.co",
        expectedProjectRef: "uatref",
        productionProjectRef: "",
        mutationsRequested: true,
        mutationsApproved: true,
      }),
    /PRODUCTION_SUPABASE_PROJECT_REF is required/i,
  );
});

test("rejects mutations against the production Supabase project", () => {
  assert.throws(
    () =>
      assertApprovedMutationTarget({
        appEnv: "uat",
        supabaseUrl: "https://productionref.supabase.co",
        expectedProjectRef: "productionref",
        productionProjectRef: "productionref",
        mutationsRequested: true,
        mutationsApproved: true,
      }),
    /production Supabase project/i,
  );
});

test("rejects mutations whenever APP_ENV is production", () => {
  assert.throws(
    () =>
      assertApprovedMutationTarget({
        appEnv: "production",
        supabaseUrl: "https://uatref.supabase.co",
        expectedProjectRef: "uatref",
        productionProjectRef: "productionref",
        mutationsRequested: true,
        mutationsApproved: true,
      }),
    /APP_ENV=production/i,
  );
});

test("rejects mutations for missing or unknown APP_ENV values", () => {
  for (const appEnv of [undefined, "", "staging", " uat "]) {
    assert.throws(
      () =>
        assertApprovedMutationTarget({
          appEnv,
          supabaseUrl: "https://uatref.supabase.co",
          expectedProjectRef: "uatref",
          productionProjectRef: "productionref",
          mutationsRequested: true,
          mutationsApproved: true,
        }),
      /APP_ENV must be uat or local for mutation runs/i,
    );
  }
});

test("allows a read-only production smoke run", () => {
  assert.doesNotThrow(() =>
    assertApprovedMutationTarget({
      appEnv: "production",
      supabaseUrl: "https://productionref.supabase.co",
      expectedProjectRef: "productionref",
      productionProjectRef: "productionref",
      mutationsRequested: false,
      mutationsApproved: false,
    }),
  );
});

test("rejects UAT mutations without explicit approval", () => {
  assert.throws(
    () =>
      assertApprovedMutationTarget({
        appEnv: "uat",
        supabaseUrl: "https://uatref.supabase.co",
        expectedProjectRef: "uatref",
        productionProjectRef: "productionref",
        mutationsRequested: true,
        mutationsApproved: false,
      }),
    /POLICY_ALLOW_TEST_MUTATIONS=true/i,
  );
});

test("allows explicitly approved UAT mutations", () => {
  assert.doesNotThrow(() =>
    assertApprovedMutationTarget({
      appEnv: "uat",
      supabaseUrl: "https://uatref.supabase.co",
      expectedProjectRef: "uatref",
      productionProjectRef: "productionref",
      mutationsRequested: true,
      mutationsApproved: true,
    }),
  );
});

test("allows explicitly approved local mutations", () => {
  assert.doesNotThrow(() =>
    assertApprovedMutationTarget({
      appEnv: "local",
      supabaseUrl: "https://localref.supabase.co",
      expectedProjectRef: "localref",
      productionProjectRef: "productionref",
      mutationsRequested: true,
      mutationsApproved: true,
    }),
  );
});

test("verifies the deployed health identity and forwards a Vercel bypass", async () => {
  let requestUrl;
  let requestHeaders;
  await verifyDeployedTargetIdentity({
    baseUrl: "https://uat.example.com",
    appEnv: "uat",
    expectedProjectRef: "uatref",
    productionProjectRef: "productionref",
    mutationsRequested: true,
    protectionBypass: "bypass-secret",
    fetchImpl: async (url, init) => {
      requestUrl = String(url);
      requestHeaders = new Headers(init?.headers);
      return Response.json({
        deployment: { appEnv: "uat", supabaseProjectRef: "uatref" },
      });
    },
  });

  assert.equal(requestUrl, "https://uat.example.com/api/health");
  assert.equal(
    requestHeaders.get("x-vercel-protection-bypass"),
    "bypass-secret",
  );
});

test("rejects a deployed health identity for a different project", async () => {
  await assert.rejects(
    () =>
      verifyDeployedTargetIdentity({
        baseUrl: "https://uat.example.com",
        appEnv: "uat",
        expectedProjectRef: "uatref",
        productionProjectRef: "productionref",
        mutationsRequested: true,
        fetchImpl: async () =>
          Response.json({
            deployment: { appEnv: "uat", supabaseProjectRef: "otherref" },
          }),
      }),
    /deployed Supabase project.*does not match/i,
  );
});

test("rejects missing, malformed, and unavailable deployed identities", async () => {
  for (const response of [
    Response.json({}),
    Response.json({
      deployment: { appEnv: "uat", supabaseProjectRef: " uatref" },
    }),
    new Response("protected", { status: 401 }),
  ]) {
    await assert.rejects(
      () =>
        verifyDeployedTargetIdentity({
          baseUrl: "https://uat.example.com",
          appEnv: "uat",
          expectedProjectRef: "uatref",
          productionProjectRef: "productionref",
          mutationsRequested: true,
          fetchImpl: async () => response,
        }),
      /deployed target identity|health endpoint/i,
    );
  }
});

test("both live runners use the shared mutation-target preflight", async () => {
  const runnerUrls = [
    new URL("../qa/policy-aligned-live-e2e.mjs", import.meta.url),
    new URL("../qa/full-intra-live-e2e.mjs", import.meta.url),
  ];
  const sources = await Promise.all(
    runnerUrls.map((runnerUrl) => readFile(runnerUrl, "utf8")),
  );

  for (const source of sources) {
    assert.match(source, /\.\.\/lib\/target-environment\.mjs/);
    assert.match(source, /assertApprovedMutationTarget\(\{/);
    for (const variable of [
      "APP_ENV",
      "SUPABASE_PROJECT_REF",
      "PRODUCTION_SUPABASE_PROJECT_REF",
      "NEXT_PUBLIC_SUPABASE_URL",
      "AUDIT_MUTATIONS",
      "POLICY_ALLOW_TEST_MUTATIONS",
    ]) {
      assert.match(source, new RegExp(`process\\.env\\.${variable}`));
    }
  }

  assert.doesNotMatch(
    sources[0],
    /NEXT_PUBLIC_SUPABASE_URL\.includes\(/,
  );
});
