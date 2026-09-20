// @vitest-environment jsdom
import * as React from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { HandbookLanding } from "./HandbookLanding";
import { KNOWLEDGE_CONTENT } from "../../lib/knowledge/content";
import { searchKnowledge } from "../../lib/knowledge/search";
import { knowledgeRoleIdsForAssignments } from "../../lib/knowledge/roles";

const userRoles = { warehouse: ["warehouse_operator"] };
vi.mock("@intra/auth", () => ({
  useSession: () => ({
    userRoles,
    profile: { id: "operator", kind: "employee" },
  }),
}));
vi.mock("next/link", () => ({
  default: (props: React.ComponentProps<"a">) => <a {...props} />,
}));
let root: ReturnType<typeof createRoot>;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await React.act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function render(
  overrides: Partial<React.ComponentProps<typeof HandbookLanding>> = {},
) {
  const onSetParams = vi.fn();
  const onOpenResult = vi.fn();
  await React.act(() =>
    root.render(
      <HandbookLanding
        content={KNOWLEDGE_CONTENT}
        results={searchKnowledge(KNOWLEDGE_CONTENT, "", {
          audience: "internal",
          userRoles,
        })}
        query=""
        mode="task"
        module="all"
        roleId=""
        availability="all"
        resultLimit={12}
        recommendedRoleIds={knowledgeRoleIdsForAssignments(userRoles)}
        userId="operator"
        rolesById={
          new Map(KNOWLEDGE_CONTENT.roles.map((role) => [role.id, role]))
        }
        onSetParams={onSetParams}
        onOpenResult={onOpenResult}
        onOpenHref={vi.fn()}
        {...overrides}
      />,
    ),
  );
  return { onSetParams, onOpenResult };
}
it("uses a single Task Role Reference navigation with a visible role-relevance filter", async () => {
  await render();
  expect(
    [...host.querySelectorAll("[aria-pressed]")].map((button) =>
      button.getAttribute("aria-label"),
    ),
  ).toEqual(["Task", "Role", "Reference"]);
  expect(
    host.querySelector('[aria-label="Knowledge Base sections"]'),
  ).toBeNull();
  expect(host.querySelector('[aria-label="Guidance scope"]')).not.toBeNull();
  expect(
    host.querySelector('[aria-labelledby="handbook-results-title"]'),
  ).not.toBeNull();
  expect(host.querySelector("#kb-help")).not.toBeNull();
});
it("preserves the search query when changing navigation modes", async () => {
  const { onSetParams } = await render({ query: "pick and pack" });
  await React.act(() =>
    host.querySelector<HTMLButtonElement>('[aria-label="Role"]')?.click(),
  );
  expect(onSetParams).toHaveBeenCalledWith({ mode: "role", limit: null });
});
it("shows task guidance and its scoped task action together in search results", async () => {
  const results = searchKnowledge(KNOWLEDGE_CONTENT, "pick and pack", {
    audience: "internal",
    userRoles,
  });
  const { onOpenResult } = await render({ query: "pick and pack", results });
  const guide = [
    ...host.querySelectorAll<HTMLButtonElement>(
      '[aria-labelledby="handbook-results-title"] button',
    ),
  ].find((button) => /pick.*pack/i.test(button.textContent ?? ""));
  expect(guide).toBeDefined();
  const row = guide!.closest("li");
  expect(row).not.toBeNull();
  expect(row?.querySelector('a[href*="task="]')).toBeTruthy();
  await React.act(() => guide!.click());
  expect(onOpenResult.mock.calls[0]?.[0].href).toContain("/knowledge?");
});
it("keeps unrelated role guidance out of the default browse results without hiding search matches", async () => {
  const allResults = searchKnowledge(KNOWLEDGE_CONTENT, "", {
    audience: "internal",
    userRoles,
  });
  const unrelated = allResults.find(
    (result) =>
      result.type === "procedure" &&
      result.roleIds.length > 0 &&
      !result.roleIds.some((role) =>
        knowledgeRoleIdsForAssignments(userRoles).includes(role),
      ),
  )!;
  await render({ results: [unrelated] });
  expect(
    host.querySelector('[aria-labelledby="handbook-results-title"]'),
  ).not.toBeNull();
  expect(
    host.querySelector('[aria-labelledby="handbook-results-title"]')
      ?.textContent,
  ).not.toContain(unrelated.title);
  await render({ results: [unrelated], query: unrelated.title });
  expect(
    host.querySelector('[aria-labelledby="handbook-results-title"]')
      ?.textContent,
  ).toContain(unrelated.title);
  expect(
    host.querySelector(
      '[aria-labelledby="handbook-results-title"] a[href*="task="]',
    ),
  ).toBeNull();
});
