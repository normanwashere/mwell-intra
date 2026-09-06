import { describe, expect, it } from "vitest";
import { KNOWLEDGE_CONTENT } from "./content";
import { knowledgeContentForAudience } from "./audience";
import { COMING_SOON_ROLES } from "./roles";
import { ROLE_TASK_GUIDANCE, resolveRoleTasks } from "./taskGuidance";

describe("maintained role task guidance", () => {
  it("rejects unavailable, missing, or wrong-role flows without substituting another guide", () => {
    const role = KNOWLEDGE_CONTENT.roles.find(
      (item) => item.id === "product_owner",
    )!;
    const { features, flows } = KNOWLEDGE_CONTENT;
    for (const candidates of [
      [],
      flows.filter(
        (item) =>
          !["product-launch-governance", "pricing-and-costing"].includes(
            item.id,
          ),
      ),
      flows.map((item) => ({ ...item, availability: "coming_soon" as const })),
      flows.map((item) => ({ ...item, roles: ["vendor_portal"] })),
    ]) {
      expect(
        resolveRoleTasks(role, features, candidates).every(
          (item) => !item.destination,
        ),
      ).toBe(true);
    }
    expect(
      resolveRoleTasks(role, [...features].reverse(), [...flows].reverse()).map(
        (item) => item.destination?.id,
      ),
    ).toEqual(["product-launch-governance", "pricing-and-costing"]);
  });
  for (const role of [...KNOWLEDGE_CONTENT.roles, ...COMING_SOON_ROLES]) {
    it(`accounts for every exact task of ${role.id}`, () => {
      expect(Object.keys(ROLE_TASK_GUIDANCE[role.id] ?? {}).sort()).toEqual(
        [...role.dailyTasks].sort(),
      );
      const tasks = resolveRoleTasks(
        role,
        KNOWLEDGE_CONTENT.features,
        KNOWLEDGE_CONTENT.flows,
      );
      expect(tasks.map((item) => item.task)).toEqual(role.dailyTasks);
      tasks.forEach(({ task, destination, guidance }) => {
        const mapping = ROLE_TASK_GUIDANCE[role.id]![task]!;
        if (mapping.kind === "written") {
          expect(destination).toBeUndefined();
          expect(guidance).toBeTruthy();
        } else {
          expect(destination).toMatchObject({
            kind: mapping.kind,
            id: mapping.id,
          });
          const target =
            mapping.kind === "flow"
              ? KNOWLEDGE_CONTENT.flows.find((item) => item.id === mapping.id)!
              : KNOWLEDGE_CONTENT.features.find(
                  (item) => item.id === mapping.id,
                )!;
          expect(target.availability).not.toBe("coming_soon");
          expect("roleIds" in target ? target.roleIds : target.roles).toContain(
            role.id,
          );
        }
      });
    });
  }

  const role = KNOWLEDGE_CONTENT.roles.find(
    (item) => item.id === "vendor_portal",
  )!;
  it("resolves only supplied audience-scoped content", () => {
    const scoped = knowledgeContentForAudience(KNOWLEDGE_CONTENT, "vendor");
    for (const { destination } of resolveRoleTasks(
      role,
      scoped.features,
      scoped.flows,
    )) {
      expect(destination?.kind).toBe("feature");
      expect(scoped.features.map((item) => item.id)).toContain(destination?.id);
    }
    expect(
      resolveRoleTasks(role, [], []).every((item) => !item.destination),
    ).toBe(true);
  });

  it("never guesses for changed, added, reordered, or unknown tasks", () => {
    const changed = {
      ...role,
      dailyTasks: [...role.dailyTasks]
        .reverse()
        .concat("Review purchase orders with a new responsibility."),
    };
    const resolved = resolveRoleTasks(
      changed,
      KNOWLEDGE_CONTENT.features,
      KNOWLEDGE_CONTENT.flows,
    );
    expect(resolved[0]?.destination?.id).toBe("vendor-purchase-orders");
    expect(resolved.at(-1)?.destination).toBeUndefined();
    expect(resolved.at(-1)?.guidance).toBeTruthy();
    expect(
      resolveRoleTasks(
        { ...role, id: "unknown" },
        KNOWLEDGE_CONTENT.features,
        KNOWLEDGE_CONTENT.flows,
      ).every((item) => !item.destination),
    ).toBe(true);
  });

  it("blocks roadmap roles, roadmap targets, and wrong-role targets", () => {
    const features = KNOWLEDGE_CONTENT.features;
    expect(
      resolveRoleTasks(
        { ...role, availability: "coming_soon" },
        features,
        [],
      ).every((item) => !item.destination),
    ).toBe(true);
    expect(
      resolveRoleTasks(
        role,
        features.map((item) => ({ ...item, availability: "coming_soon" })),
        [],
      ).every((item) => !item.destination),
    ).toBe(true);
    expect(
      resolveRoleTasks(
        role,
        features.map((item) => ({ ...item, roleIds: ["platform_admin"] })),
        [],
      ).every((item) => !item.destination),
    ).toBe(true);
  });
});
