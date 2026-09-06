import { expect, expectTypeOf, it } from "vitest";
import type { LearningCapability, SelectedLearningTask } from "@intra/learning";
import type { TaskDefinition } from "./taskCatalog";
import { KNOWLEDGE_CONTENT } from "./content";
import { taskCatalog, tasksForRoles } from "./taskCatalog";

it("passes task definitions directly to learning without capability casts", () => {
  expectTypeOf<TaskDefinition>().toMatchTypeOf<SelectedLearningTask>();
  expectTypeOf<TaskDefinition["actionCapabilities"]>().toEqualTypeOf<readonly LearningCapability[]>();
});

it("curates three live task priorities for every operating persona", () => {
  const tasks = [...taskCatalog(KNOWLEDGE_CONTENT), ...taskCatalog(KNOWLEDGE_CONTENT, "vendor")];
  expect(tasks).toHaveLength(33);
  expect(new Set(tasks.flatMap(task => task.personaIds)).size).toBe(11);
});

it("matches actual scoped roles rather than a persona or similarly named role", () => {
  expect(tasksForRoles(KNOWLEDGE_CONTENT, { warehouse: ["warehouse_operator"] }, "internal").map(task => task.id)).toContain("receive-inspect-stock");
  expect(tasksForRoles(KNOWLEDGE_CONTENT, { warehouse: ["operations"] }, "internal").map(task => task.id)).not.toContain("receive-inspect-stock");
});
