import { expect, test, type Page } from "@playwright/test";
import {
  LEARNING_CATALOG,
  ROLE_CURRICULA,
} from "../../../../modules/learning/src/catalog";
import type { SimulationStepDefinition } from "../../../../modules/learning/src/types";

interface RoleSimulationCase {
  personaId: string;
  profileId: string;
  roles: Record<string, readonly string[]>;
  target: { module: string; role: string };
  route?: "/onboarding" | "/vendor/onboarding";
}

const CASES: readonly RoleSimulationCase[] = [
  {
    personaId: "platform_administrator",
    profileId: "demo-admin",
    roles: { core: ["platform_admin", "staff"] },
    target: { module: "core", role: "platform_admin" },
  },
  {
    personaId: "general_employee",
    profileId: "demo-operations",
    roles: {
      core: ["staff"],
      warehouse: ["business_unit"],
      procurement: ["requester"],
      events: ["requester"],
      product: ["contributor"],
    },
    target: { module: "procurement", role: "requester" },
  },
  {
    personaId: "operations_lead",
    profileId: "demo-logistics",
    roles: {
      core: ["staff"],
      warehouse: ["warehouse_supervisor", "logistics_supervisor"],
      procurement: ["approver"],
      product: ["operations_partner"],
    },
    target: { module: "warehouse", role: "warehouse_supervisor" },
  },
  {
    personaId: "procurement_lead",
    profileId: "demo-procurement",
    roles: {
      core: ["staff"],
      procurement: ["procurement_officer", "admin"],
      warehouse: ["procurement"],
    },
    target: { module: "procurement", role: "procurement_officer" },
  },
  {
    personaId: "finance_controller",
    profileId: "demo-finance",
    roles: {
      core: ["staff"],
      warehouse: ["finance"],
      procurement: ["finance"],
      events: ["finance_reviewer"],
    },
    target: { module: "procurement", role: "finance" },
  },
  {
    personaId: "legal_compliance_lead",
    profileId: "demo-legal",
    roles: {
      core: ["staff"],
      legal: ["legal_reviewer", "compliance", "admin"],
    },
    target: { module: "legal", role: "legal_reviewer" },
  },
  {
    personaId: "marketing_events_lead",
    profileId: "demo-marketing",
    roles: {
      core: ["staff"],
      warehouse: ["marketing"],
      events: ["coordinator", "admin"],
    },
    target: { module: "events", role: "coordinator" },
  },
  {
    personaId: "product_owner",
    profileId: "demo-product-owner",
    roles: {
      core: ["staff"],
      product: ["product_owner"],
      events: ["viewer"],
    },
    target: { module: "product", role: "product_owner" },
  },
  {
    personaId: "leadership_insights",
    profileId: "demo-bi",
    roles: {
      core: ["staff"],
      warehouse: ["bi_analyst"],
      insights: ["analyst", "manager", "executive"],
    },
    target: { module: "insights", role: "analyst" },
  },
  {
    personaId: "vendor_representative",
    profileId: "demo-vendor",
    roles: { core: ["vendor_portal"] },
    target: { module: "core", role: "vendor_portal" },
    route: "/vendor/onboarding",
  },
];

function practiceFor(roleCase: RoleSimulationCase) {
  const curriculum = ROLE_CURRICULA.find(
    (item) =>
      item.module === roleCase.target.module &&
      item.role === roleCase.target.role,
  );
  if (!curriculum)
    throw new Error(`Missing curriculum for ${roleCase.personaId}.`);
  const requirementId = curriculum.requirementIds.find(
    (id) =>
      id.endsWith(".capability-practice.v1") ||
      id.endsWith(".guided-practice.v1"),
  );
  const requirement = LEARNING_CATALOG.requirements.find(
    (item) => item.id === requirementId,
  );
  const simulation = LEARNING_CATALOG.simulations.find(
    (item) => item.id === requirement?.simulationId,
  );
  if (!requirement || !simulation?.embeddedSteps?.length) {
    throw new Error(`Missing embedded practice for ${roleCase.personaId}.`);
  }
  return { requirement, steps: simulation.embeddedSteps };
}

function assignedRequirementIds(roleCase: RoleSimulationCase) {
  const roleKeys = new Set(
    Object.entries(roleCase.roles).flatMap(([module, roles]) =>
      roles.map((role) => `${module}:${role}`),
    ),
  );
  return new Set(
    ROLE_CURRICULA.filter((item) =>
      roleKeys.has(`${item.module}:${item.role}`),
    ).flatMap((item) => item.requirementIds),
  );
}

async function installPreparedSession(
  page: Page,
  roleCase: RoleSimulationCase,
  targetRequirementId: string,
) {
  const completedProgress = [...assignedRequirementIds(roleCase)]
    .filter((id) => id !== targetRequirementId)
    .map((requirementId) => {
      const requirement = LEARNING_CATALOG.requirements.find(
        (item) => item.id === requirementId,
      );
      if (!requirement)
        throw new Error(`Missing requirement ${requirementId}.`);
      return {
        assignmentRequirementId: `prepared:${requirement.id}`,
        requirementId: requirement.id,
        requirementVersion: requirement.version,
        state: "passed",
        attemptCount: 1,
        allowsSharedCompletion: requirement.kind === "orientation",
        completedAt: "2026-08-15T00:00:00.000Z",
        updatedAt: "2026-08-15T00:00:00.000Z",
      };
    });
  const learningKey = `intra.demo-learning.v1:${roleCase.profileId}:${JSON.stringify(roleCase.roles)}`;
  await page.addInitScript(
    ({ session, learningKey, completedProgress }) => {
      sessionStorage.setItem(
        "intra.memory-session.v1",
        JSON.stringify(session),
      );
      sessionStorage.setItem(
        learningKey,
        JSON.stringify({
          progress: completedProgress,
          completedCheckpoints: {},
        }),
      );
    },
    {
      session: { profileId: roleCase.profileId, roles: roleCase.roles },
      learningKey,
      completedProgress,
    },
  );
}

function correctChoice(step: SimulationStepDefinition) {
  const result = step.choices?.find((item) => item.correct);
  if (!result)
    throw new Error(`Missing correct choice for ${step.checkpointId}.`);
  return result;
}

function incorrectChoice(step: SimulationStepDefinition) {
  const result = step.choices?.find((item) => !item.correct);
  if (!result)
    throw new Error(`Missing incorrect choice for ${step.checkpointId}.`);
  return result;
}

test.describe("role-specific guided simulations", () => {
  for (const roleCase of CASES) {
    test(`${roleCase.personaId} rejects unsafe choices and completes its governed practice`, async ({
      page,
    }, testInfo) => {
      const { requirement, steps } = practiceFor(roleCase);
      await installPreparedSession(page, roleCase, requirement.id);
      await page.goto(roleCase.route ?? "/onboarding");

      await page
        .getByRole("button", { name: `Start ${requirement.title}` })
        .click();
      const dialog = page.getByRole("dialog");
      await expect(
        dialog.getByText("Practice case", { exact: true }),
      ).toBeVisible();
      await page.screenshot({
        path: testInfo.outputPath(
          `guided-simulation-decision-${roleCase.personaId}-${testInfo.project.name}.png`,
        ),
        fullPage: true,
      });

      const first = steps[0]!;
      const firstUnsafe = incorrectChoice(first);
      await dialog.getByRole("button", { name: firstUnsafe.label }).click();
      await expect(dialog.getByRole("alert")).toContainText(
        firstUnsafe.feedback,
      );
      await expect(
        dialog.getByRole("heading", { name: first.title }),
      ).toBeVisible();
      await page.screenshot({
        path: testInfo.outputPath(
          `guided-simulation-correction-${roleCase.personaId}-${testInfo.project.name}.png`,
        ),
        fullPage: true,
      });

      await dialog
        .getByRole("button", { name: correctChoice(first).label })
        .click();
      const second = steps[1]!;
      await expect(
        dialog.getByRole("heading", { name: second.title }),
      ).toBeVisible();
      await dialog
        .getByRole("button", { name: correctChoice(second).label })
        .click();
      await expect(
        dialog.getByRole("heading", { name: "Guided practice complete" }),
      ).toBeVisible();

      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth,
      );
      expect(overflow).toBe(false);
      await page.screenshot({
        path: testInfo.outputPath(
          `guided-simulation-${roleCase.personaId}-${testInfo.project.name}.png`,
        ),
        fullPage: true,
      });
    });
  }
});
