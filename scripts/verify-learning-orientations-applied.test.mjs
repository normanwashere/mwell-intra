import assert from "node:assert/strict";
import test from "node:test";
import { assertOrientationSnapshot } from "./verify-learning-orientations-applied.mjs";
import { ORIENTATION_CATALOG } from "./learning-orientation-catalog.mjs";

const expected = ORIENTATION_CATALOG.find(
  (item) =>
    item.simulationId === "internal.platform_administrator.orientation.v1",
);
const snapshot = () => ({
  curricula: [
    {
      curriculum: { id: expected.curriculumKey, version: expected.version },
      source: "role",
      requirements: [
        {
          id: expected.requirementKey,
          version: expected.version,
          mandatory: true,
          simulationId: expected.simulationId,
        },
      ],
    },
  ],
});

test("current public curricula/simulationId contract proves the exact mandatory role orientation", () => {
  assertOrientationSnapshot(snapshot());
});

test("missing, legacy and malformed snapshots fail closed without treating an empty result as success", () => {
  for (const value of [
    undefined,
    null,
    {},
    { assignments: [] },
    { curricula: null },
    { curricula: {} },
    { curricula: [] },
    { curricula: [null] },
    { curricula: [{ curriculum: {}, requirements: null }] },
  ]) {
    assert.throws(
      () => assertOrientationSnapshot(value),
      assert.AssertionError,
    );
  }
});

test("wrong assignment identity, optional requirement, stale version and snake-case simulation cannot pass", () => {
  for (const mutate of [
    (item) => {
      item.curriculum.id = "other";
    },
    (item) => {
      item.curriculum.version = 0;
    },
    (item) => {
      item.source = "assignment";
    },
    (item) => {
      item.requirements[0].id = "other";
    },
    (item) => {
      item.requirements[0].version = 0;
    },
    (item) => {
      item.requirements[0].mandatory = false;
    },
    (item) => {
      item.requirements[0].simulationId = "other";
    },
    (item) => {
      item.requirements[0].simulation_id = item.requirements[0].simulationId;
      delete item.requirements[0].simulationId;
    },
  ]) {
    const value = snapshot();
    mutate(value.curricula[0]);
    assert.throws(
      () => assertOrientationSnapshot(value),
      assert.AssertionError,
    );
  }
});
