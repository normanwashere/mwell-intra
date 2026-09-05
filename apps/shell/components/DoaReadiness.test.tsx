// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ToastProvider } from "@intra/ui";
import { useSession } from "@intra/auth";
import DoaAdministrationPage from "../app/admin/doa/page";

vi.mock("@intra/auth", () => ({ useSession: vi.fn(), useCan: () => true }));

type Result = { data: unknown[]; error: { message: string } | null };
function deferred() {
  let resolve!: (result: Result) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<Result>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function mount() {
  const workspace = deferred();
  const policy = deferred();
  const client = {
    schema: () => ({
      from: (table: string) => {
        const query = {
          select: () => query,
          eq: () => query,
          order: () => table.startsWith("policy_") ? policy.promise : workspace.promise,
        };
        return query;
      },
      rpc: () => policy.promise,
    }),
  };
  vi.mocked(useSession).mockReturnValue({ loading: false, mode: "supabase", supabaseClient: client } as unknown as ReturnType<typeof useSession>);
  await act(async () => root.render(<ToastProvider><DoaAdministrationPage /></ToastProvider>));
  const policyRegion = container.querySelector('[aria-labelledby="procurement-policy-heading"]')!;
  const workspaceRegion = policyRegion.parentElement!;
  return { workspace, policy, workspaceRegion, policyRegion };
}

it("keeps each visible DOA region busy until its independent reads settle", async () => {
  const { workspace, policy, workspaceRegion, policyRegion } = await mount();
  expect(workspaceRegion.getAttribute("aria-busy")).toBe("true");
  expect(policyRegion.getAttribute("aria-busy")).toBe("true");
  await act(async () => workspace.resolve({ data: [], error: null }));
  expect(workspaceRegion.getAttribute("aria-busy")).toBe("false");
  expect(policyRegion.getAttribute("aria-busy")).toBe("true");
  expect(container.querySelectorAll('[aria-busy="true"]')).toHaveLength(1);
  await act(async () => policy.resolve({ data: [], error: null }));
  expect(policyRegion.getAttribute("aria-busy")).toBe("false");
  expect(container.querySelectorAll('[aria-busy="true"]')).toHaveLength(0);
});

it("does not report workspace readiness when only policy reads have settled", async () => {
  const { workspace, policy, workspaceRegion, policyRegion } = await mount();
  await act(async () => policy.resolve({ data: [], error: null }));
  expect(policyRegion.getAttribute("aria-busy")).toBe("false");
  expect(workspaceRegion.getAttribute("aria-busy")).toBe("true");
  await act(async () => workspace.resolve({ data: [], error: { message: "Workspace unavailable" } }));
  expect(workspaceRegion.getAttribute("aria-busy")).toBe("false");
});

it.each(["response", "rejection"])("clears policy busy state after a %s error", async (failure) => {
  const { workspace, policy, policyRegion } = await mount();
  await act(async () => {
    workspace.resolve({ data: [], error: null });
    if (failure === "rejection") policy.reject(new Error("Policy unavailable"));
    else policy.resolve({ data: [], error: { message: "Policy unavailable" } });
  });
  expect(policyRegion.getAttribute("aria-busy")).toBe("false");
  expect(policyRegion.textContent).toContain("Policy unavailable");
});
