// @vitest-environment jsdom
import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ register: vi.fn() }));
vi.mock("@serwist/turbopack/react", () => ({
  SerwistProvider: ({ children, register, reloadOnOnline }: { children: React.ReactNode; register: boolean; reloadOnOnline: boolean }) => {
    expect(register).toBe(false);
    expect(reloadOnOnline).toBe(false);
    return children;
  },
  useSerwist: () => ({ serwist: state }),
}));
import { SafeServiceWorker } from "./SafeServiceWorker";

afterEach(() => vi.restoreAllMocks());
it.each(["success", "rejection"])("keeps online content mounted on registration %s", async outcome => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  state.register.mockReset();
  if (outcome === "rejection") state.register.mockRejectedValue(new Error("Registration blocked"));
  else state.register.mockResolvedValue({});
  const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    await act(async () => { root.render(<SafeServiceWorker><p>Online workspace</p></SafeServiceWorker>); });
    expect(host.textContent).toBe("Online workspace");
    expect(state.register).toHaveBeenCalledOnce();
    expect(warning).toHaveBeenCalledTimes(outcome === "rejection" ? 1 : 0);
  } finally { await act(async () => root.unmount()); }
});
