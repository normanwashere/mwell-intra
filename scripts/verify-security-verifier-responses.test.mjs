import assert from "node:assert/strict";
import test from "node:test";
import { verifySecurityDatabaseLaunchBlockers, verifyLaunchRpcContracts } from "./verify-security-database-launch-blockers.mjs";

const boundary = { raw_boundaries: 0, examples: [] };
const objects = { missing_objects: [] };
const grants = { missing_grants: [] };
const queryWith = (first, ...remaining) => {
  const second = remaining.length ? remaining[0] : { rows: [objects] };
  let calls = 0;
  return async () => ++calls === 1 ? first : second;
};
const clientWith = (data = { ...boundary, ...objects }, readData = grants, error = null, readError = null) => ({
  schema: name => {
    assert.equal(name, "core");
    return { rpc: async name => name === "verify_security_database_launch_blockers"
      ? { data, error } : { data: readData, error: readError } };
  },
});

test("query verifier requires exactly one object row from each metadata query", async () => {
  for (const result of [undefined, null, {}, { rows: null }, { rows: [] }, { rows: [null] }, { rows: [[]] }, { rows: [boundary, boundary] }]) {
    await assert.rejects(verifySecurityDatabaseLaunchBlockers(queryWith(result)), /Invalid .*verification response/);
    await assert.rejects(verifySecurityDatabaseLaunchBlockers(queryWith({ rows: [boundary] }, result)), /Invalid .*verification response/);
  }
});

test("query and RPC paths reject missing, null, coercible and invalid counts", async () => {
  for (const raw_boundaries of [undefined, null, true, false, "", " ", "0x0", "0e0", "NaN", "Infinity", "-1", -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, [], {}]) {
    const data = { ...boundary, raw_boundaries };
    await assert.rejects(verifySecurityDatabaseLaunchBlockers(queryWith({ rows: [data] })), /Invalid raw-boundary/);
    await assert.rejects(verifyLaunchRpcContracts(clientWith({ ...data, ...objects })), /Invalid raw-boundary/);
  }
});

test("every list is required and must contain only nonempty string entries", async () => {
  for (const value of [undefined, null, "", "null", "false", "0", "\"[]\"", "not-json", {}, 0, false, [null], [1], [{}], [[]], [""], ["   "]]) {
    await assert.rejects(verifySecurityDatabaseLaunchBlockers(queryWith({ rows: [{ ...boundary, examples: value }] })), /Invalid .*verification response/);
    await assert.rejects(verifySecurityDatabaseLaunchBlockers(queryWith({ rows: [boundary] }, { rows: [{ missing_objects: value }] })), /Invalid missing_objects/);
    await assert.rejects(verifyLaunchRpcContracts(clientWith({ ...boundary, ...objects, examples: value })), /Invalid .*verification response/);
    await assert.rejects(verifyLaunchRpcContracts(clientWith({ ...boundary, missing_objects: value })), /Invalid missing_objects/);
    await assert.rejects(verifyLaunchRpcContracts(clientWith({ ...boundary, ...objects }, { missing_grants: value })), /Invalid missing_grants/);
  }
});

test("RPC verifier rejects absent or non-object data and propagates both RPC errors", async () => {
  for (const data of [null, [], "{}", 0, false, {}]) {
    await assert.rejects(verifyLaunchRpcContracts(clientWith(data)), /Invalid .*verification response/);
    await assert.rejects(verifyLaunchRpcContracts(clientWith({ ...boundary, ...objects }, data)), /Invalid .*verification response/);
  }
  await assert.rejects(verifyLaunchRpcContracts(clientWith(null, grants, { message: "metadata unavailable" })), /RPC failed: metadata unavailable/);
  await assert.rejects(verifyLaunchRpcContracts(clientWith({ ...boundary, ...objects }, null, null, { message: "read contract unavailable" })), /RPC failed: read contract unavailable/);
});

test("valid numeric/string counts and database array encodings normalize consistently", async () => {
  for (const raw_boundaries of [0, "0", " 0 "]) {
    for (const list of [[], "[]", "{}", " [] "]) {
      const data = { raw_boundaries, examples: list };
      assert.deepEqual(await verifySecurityDatabaseLaunchBlockers(queryWith({ rows: [data] }, { rows: [{ missing_objects: list }] })), { rawBoundaries: 0, missingObjects: [] });
      assert.deepEqual(await verifyLaunchRpcContracts(clientWith({ ...data, missing_objects: list }, { missing_grants: list })), { rawBoundaries: 0, missingObjects: [], missingGrants: [] });
    }
  }
});

test("valid negative findings and contradictory summaries never pass", async () => {
  await assert.rejects(verifyLaunchRpcContracts(clientWith({ raw_boundaries: "1", examples: '["warehouse.bad(jsonb)"]', ...objects })), /1 authenticated raw-cap.*warehouse.bad/);
  await assert.rejects(verifySecurityDatabaseLaunchBlockers(queryWith({ rows: [{ raw_boundaries: 0, examples: ["unexpected"] }] })), /Invalid raw-boundary/);
  await assert.rejects(verifyLaunchRpcContracts(clientWith({ ...boundary, missing_objects: '["missing object"]' })), /Critical launch objects are missing: missing object/);
  await assert.rejects(verifyLaunchRpcContracts(clientWith({ ...boundary, ...objects }, { missing_grants: ["missing grant"] })), /Critical launch grants are missing: missing grant/);
});
