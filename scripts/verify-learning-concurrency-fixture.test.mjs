import assert from "node:assert/strict";
import test from "node:test";
import {
  seedFixture,
  cleanupFixture,
  verifyMissingCompletionEvidence,
} from "./verify-learning-concurrency.mjs";

function recorder(implementation = async () => ({ rows: [] })) {
  const calls = [];
  return {
    calls,
    query: async (sql, parameters) => {
      calls.push({ sql, parameters });
      return implementation(sql, parameters);
    },
  };
}

test("six race fixtures carry exact owned valid attempts; missing-evidence case stays deliberately incomplete", async () => {
  const client = recorder();
  await seedFixture(client);
  const attempts = client.calls.filter((call) =>
    /insert into learning\.attempts\(/.test(call.sql),
  );
  assert.equal(attempts.length, 6);
  for (let index = 0; index < 6; index++) {
    const suffix = String(index + 1).padStart(12, "0");
    assert.deepEqual(attempts[index].parameters.slice(0, 3), [
      `91000000-0000-4000-8000-${suffix}`,
      `71000000-0000-4000-8000-${suffix}`,
      `60000000-0000-4000-8000-${suffix}`,
    ]);
    assert.match(attempts[index].sql, /'attestation', 'passed', 'valid'/);
  }
  assert.equal(
    client.calls.filter((call) =>
      /insert into learning\.assignment_requirements\(/.test(call.sql),
    ).length,
    7,
  );
  assert.equal(
    client.calls.at(-1).sql,
    "set session_replication_role = origin",
  );
});

test("scoped attempts are removed before their parent requirements", async () => {
  const client = recorder();
  await cleanupFixture(client);
  const attemptIndex = client.calls.findIndex((call) =>
    /delete from learning\.attempts /.test(call.sql),
  );
  const requirementIndex = client.calls.findIndex((call) =>
    /delete from learning\.assignment_requirements /.test(call.sql),
  );
  assert.ok(attemptIndex > 0 && attemptIndex < requirementIndex);
  assert.equal(
    client.calls[attemptIndex].sql,
    "delete from learning.attempts where id = any($1::uuid[])",
  );
  assert.equal(client.calls[attemptIndex].parameters[0].length, 8);
  assert.ok(
    client.calls[attemptIndex].parameters[0].every((id) =>
      /^91000000-0000-4000-8000-00000000000[1-8]$/.test(id),
    ),
  );
  assert.equal(
    client.calls.at(-1).sql,
    "set session_replication_role = origin",
  );
});

test("fixture failure always restores normal trigger behavior", async () => {
  for (const prepare of [seedFixture, cleanupFixture]) {
    const client = recorder(async (sql) => {
      if (/learning\.attempts/.test(sql)) throw new Error("fixture failure");
      return { rows: [] };
    });
    await assert.rejects(prepare(client), /fixture failure/);
    assert.equal(
      client.calls.at(-1).sql,
      "set session_replication_role = origin",
    );
  }
});

test("negative proof requires the real missing-evidence rejection and always rolls back", async () => {
  for (const [message, shouldPass] of [
    ["Certification completion lacks authoritative evidence", true],
    ["unrelated database error", false],
  ]) {
    const client = recorder(async (sql) => {
      if (/insert into learning\.certifications/.test(sql))
        throw new Error(message);
      return { rows: [] };
    });
    if (shouldPass) await verifyMissingCompletionEvidence(client);
    else
      await assert.rejects(
        verifyMissingCompletionEvidence(client),
        assert.AssertionError,
      );
    assert.equal(client.calls.at(-1).sql, "rollback");
  }
  const client = recorder();
  await assert.rejects(verifyMissingCompletionEvidence(client));
  assert.equal(client.calls.at(-1).sql, "rollback");
});
