// @vitest-environment jsdom
import * as React from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { GuideOutline } from "@shell/components/knowledge/GuideOutline";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const container = document.createElement("div");
document.body.append(container);
let root: ReturnType<typeof createRoot>;

afterEach(async () => {
  await React.act(() => root?.unmount());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

it("opens collapsed ancestors and preserves host navigation state when jumping to guidance", async () => {
  window.history.replaceState({ hostRouter: "preserved" }, "", "/knowledge?article=example");
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
  const scroll = vi.fn();
  root = createRoot(container);
  await React.act(() => root.render(<>
    <GuideOutline items={[{ id: "policy", label: "Policy basis" }]} />
    <details><summary>Reference</summary><section id="policy">Exact policy</section></details>
  </>));
  const target = document.getElementById("policy")!;
  target.scrollIntoView = scroll;
  const button = container.querySelector("button")!;
  expect(button.className).toContain("min-h-11");
  await React.act(() => button.click());
  expect(container.querySelector("details")!.open).toBe(true);
  expect(scroll).toHaveBeenCalledWith({ behavior: "auto", block: "start" });
  expect(window.location.search).toBe("?article=example");
  expect(window.location.hash).toBe("#policy");
  expect(window.history.state).toEqual({ hostRouter: "preserved" });
});

it("does not create a dead destination when the referenced section is missing", async () => {
  root = createRoot(container);
  await React.act(() => root.render(<GuideOutline items={[{ id: "missing", label: "Missing" }]} />));
  await React.act(() => container.querySelector("button")!.click());
  expect(window.location.hash).toBe("");
});
