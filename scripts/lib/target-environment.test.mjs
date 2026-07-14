import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  assertApprovedMutationTarget,
  projectRefFromSupabaseUrl,
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
        expectedProjectRef: "uat-ref",
        productionProjectRef: "production-ref",
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
    /does not match SUPABASE_PROJECT_REF/i,
  );
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
