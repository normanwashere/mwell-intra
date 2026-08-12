import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const publisherPath = new URL(
  "./publish-warehouse-operator-receiving-certification.mjs",
  import.meta.url,
);
const verifierPath = new URL(
  "./verify-warehouse-operator-receiving-certification-applied.mjs",
  import.meta.url,
);

test("publisher is transactional, serialized, independently reviewed, and idempotent", async () => {
  const source = await readFile(publisherPath, "utf8");

  assert.match(source, /begin isolation level read committed/i);
  assert.match(source, /pg_advisory_xact_lock/i);
  assert.match(source, /MWELL_LEARNING_OWNER_EMAIL/);
  assert.match(source, /MWELL_LEARNING_REVIEWER_EMAIL/);
  assert.match(
    source,
    /ownerEmail\.toLowerCase\(\) === reviewerEmail\.toLowerCase\(\)/,
  );
  assert.match(source, /on conflict \(requirement_key\) do nothing/i);
  assert.match(source, /on conflict \(requirement_id, version\) do nothing/i);
  assert.match(source, /on conflict \(curriculum_id, version\) do nothing/i);
  assert.match(source, /on conflict \(requirement_version_id\) do nothing/i);
  assert.match(source, /status = 'in_review'/i);
  assert.match(source, /status = 'approved'/i);
  assert.match(source, /status = 'published'/i);
  assert.match(
    source,
    /await assertAppliedGraph\(curriculumVersion\.id\);[\s\S]+await advanceVersion\("learning\.curriculum_versions"/,
  );
  assert.doesNotMatch(source, /delete\s+from\s+learning\./i);
});

test("publisher writes assessment answers only to the private answer-key table", async () => {
  const source = await readFile(publisherPath, "utf8");

  assert.match(source, /private\.learning_assessment_answer_keys/);
  assert.doesNotMatch(source, /assessment_settings[^;]+privateAnswerKey/s);
  assert.doesNotMatch(source, /pass_rules[^;]+privateAnswerKey/s);
});

test("applied verifier checks composition, prerequisites, private answers, mapping, and immutability", async () => {
  const source = await readFile(verifierPath, "utf8");

  assert.match(source, /learning\.curriculum_requirements/);
  assert.match(source, /learning\.curriculum_requirement_prerequisites/);
  assert.match(source, /private\.learning_assessment_answer_keys/);
  assert.match(source, /learning\.role_curricula/);
  assert.match(source, /learning\.resolve_assignments\(\)/);
  assert.match(source, /Published curriculum composition accepted a mutation/);
});
