import { act, fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import type { SessionValue } from "@intra/auth";
import { PurchaseOrdersPage } from "./PurchaseOrdersPage";
import {
  certifiedTestLearning,
  renderWithProviders,
  makeRepo,
} from "@/test/renderWithProviders";

const auth = vi.hoisted(() => ({ overrides: {} as Partial<SessionValue> }));
vi.mock("@intra/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@intra/auth")>();
  return {
    ...actual,
    useSession: () => ({ ...actual.useSession(), ...auth.overrides }),
  };
});

beforeEach(() => {
  auth.overrides = {
    mode: "supabase",
    roleCapabilities: { procurement: ["cancel_purchase_order", "author_po"] },
  };
});

async function open(learning = certifiedTestLearning, repo = makeRepo()) {
  // Memory records expose the legacy detail sheet; session overrides exercise live grants.
  const rendered = renderWithProviders(<PurchaseOrdersPage />, {
    role: "warehouse_admin",
    repo,
    learning,
  });
  const user = userEvent.setup();
  const list = await screen.findByLabelText("Purchase orders");
  await user.click(
    within(list).getAllByRole("button", { name: /MetroPrint Apparel/i })[0]!,
  );
  return {
    ...rendered,
    user,
    detail: await screen.findByRole("dialog", { name: /MetroPrint Apparel/i }),
  };
}

it.each([{ grants: [] }, { grants: ["author_po"] }])(
  "does not substitute Warehouse read access or author_po for the SQL cancellation grant (%j)",
  async ({ grants }) => {
    auth.overrides.roleCapabilities = { procurement: grants };
    const { detail } = await open();
    expect(
      within(detail).queryByRole("button", { name: /cancel po/i }),
    ).not.toBeInTheDocument();
    expect(within(detail).getByLabelText("PO lines")).toBeInTheDocument();
    expect(
      within(detail).getByRole("button", { name: /receive and inspect/i }),
    ).toBeEnabled();
  },
);

it("does not treat the SQL cancellation grant as author_po role authority", async () => {
  auth.overrides.roleCapabilities = { procurement: ["cancel_purchase_order"] };
  const { detail } = await open();
  expect(
    within(detail).getByText("This action is not assigned to your role"),
  ).toBeInTheDocument();
  expect(
    within(detail).queryByRole("button", { name: /cancel po/i }),
  ).not.toBeInTheDocument();
});

it("shows exact training recovery without blocking PO read or receiving", async () => {
  const requirement = {
    id: "po-author-check",
    version: 1,
    audience: "internal" as const,
    kind: "orientation" as const,
    title: "PO authoring requirements",
    mandatory: true,
    prerequisiteIds: [],
    capabilityOutcomes: [],
  };
  const { detail } = await open({
    ...certifiedTestLearning,
    snapshot: {
      ...certifiedTestLearning.snapshot!,
      curricula: [
        {
          curriculum: {
            id: "po-author",
            version: 1,
            personaId: "procurement",
            audience: "internal",
            requirementIds: [requirement.id],
          },
          requirements: [requirement],
          source: "role",
        },
      ],
    },
    isLiveCapability: () => false,
    lockedReason: () => ({
      capability: { module: "procurement", capability: "author_po" },
      reason: "missing_certification",
      requirementIds: [requirement.id],
      canRequestEmergencyException: false,
    }),
  });
  expect(within(detail).getByText(requirement.title)).toBeInTheDocument();
  expect(
    within(detail).getByRole("link", { name: "Resume onboarding" }),
  ).toHaveAttribute(
    "href",
    expect.stringContaining("/onboarding?requirement=po-author-check"),
  );
  expect(
    within(detail).getByRole("button", { name: /receive and inspect/i }),
  ).toBeEnabled();
  expect(within(detail).getByLabelText("PO lines")).toBeInTheDocument();
});

it("confirms once and disables cancellation controls while pending", async () => {
  const repo = makeRepo();
  let release!: () => void;
  const original = repo.cancelPurchaseOrder.bind(repo);
  const command = vi
    .spyOn(repo, "cancelPurchaseOrder")
    .mockImplementation(async (input) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return original(input);
    });
  const { detail, user } = await open(certifiedTestLearning, repo);
  await user.click(within(detail).getByRole("button", { name: "Cancel PO" }));
  const confirm = within(detail).getByRole("button", {
    name: "Confirm cancel",
  });
  fireEvent.click(confirm);
  fireEvent.click(confirm);
  expect(command).toHaveBeenCalledTimes(1);
  expect(confirm).toBeDisabled();
  expect(
    within(detail).getByRole("button", { name: "Keep PO" }),
  ).toBeDisabled();
  await act(async () => release());
});

it.each([false, true])(
  "uses only canonical Procurement roles for the memory fallback (author: %s)",
  async (author) => {
    auth.overrides = {
      mode: "memory",
      userRoles: { procurement: author ? ["procurement_officer"] : [] },
      roleCapabilities: { procurement: ["cancel_purchase_order", "author_po"] },
    };
    const { detail } = await open();
    const button = within(detail).queryByRole("button", { name: "Cancel PO" });
    if (author) expect(button).toBeEnabled();
    else expect(button).not.toBeInTheDocument();
  },
);
