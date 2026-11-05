// @vitest-environment jsdom
import * as React from "react";
import { act, useLayoutEffect, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { KNOWLEDGE_CONTENT } from "../../lib/knowledge/content";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(useSyncExternalStore(
    callback => {
      window.addEventListener("popstate", callback);
      return () => window.removeEventListener("popstate", callback);
    },
    () => window.location.search,
  )),
}));
vi.mock("@intra/auth", () => ({
  useSession: () => ({ profile: { id: "reviewer", kind: "employee" }, loading: false, userRoles: { procurement: ["procurement_officer"] } }),
}));
vi.mock("./HandbookLanding", () => ({
  HandbookLanding: ({ mode, onSetParams }: {
    mode: string;
    onSetParams: (changes: Record<string, string>, options?: { replace?: boolean; scroll?: "preserve" }) => void;
  }) => {
    useLayoutEffect(() => {
      // A shorter destination clamps the browser before passive effect cleanup.
      if (mode === "role") {
        vi.stubGlobal("scrollY", Math.min(window.scrollY, 957));
        window.dispatchEvent(new Event("scroll"));
      }
    }, [mode]);
    return <>
      <button onClick={() => onSetParams({ mode: "role" })}>Open shorter page</button>
      <button onClick={() => onSetParams({ q: "receiving" }, { replace: true, scroll: "preserve" })}>Filter in place</button>
    </>;
  },
}));
import { KnowledgeBase } from "./KnowledgeBase";

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let frames: Map<number, FrameRequestCallback>;
let frameId: number;
const landingKey = "knowledge-scroll:/knowledge";

beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("scrollY", 0);
  vi.stubGlobal("scrollTo", vi.fn((options: ScrollToOptions) => { vi.stubGlobal("scrollY", options.top ?? 0); }));
  frames = new Map(); frameId = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  sessionStorage.clear();
  window.history.replaceState(null, "", "/knowledge");
  const push = window.history.pushState.bind(window.history);
  vi.spyOn(window.history, "pushState").mockImplementation((...args) => {
    push(...args); window.dispatchEvent(new PopStateEvent("popstate"));
  });
  const replace = window.history.replaceState.bind(window.history);
  vi.spyOn(window.history, "replaceState").mockImplementation((...args) => {
    replace(...args); window.dispatchEvent(new PopStateEvent("popstate"));
  });
  host = document.createElement("div"); document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(() => root.unmount()); host.remove();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});
async function flushFrames() {
  await act(() => {
    const pending = [...frames.values()]; frames.clear();
    for (const callback of pending) callback(0);
  });
}
async function renderAt(y: number) {
  await act(() => root.render(<KnowledgeBase content={KNOWLEDGE_CONTENT} />));
  await flushFrames();
  vi.stubGlobal("scrollY", y);
  window.dispatchEvent(new Event("scroll"));
}

it.each([1689, 2057])("preserves outgoing scroll %i across destination reflow and browser Back", async (y) => {
  await renderAt(y);
  await act(() => host.querySelectorAll("button")[0]!.click());
  expect(sessionStorage.getItem(landingKey)).toBe(String(y));
  await flushFrames();
  expect(window.scrollY).toBe(0);
  expect(sessionStorage.getItem("knowledge-scroll:/knowledge?mode=role")).toBe("0");
  await act(async () => {
    const popped = new Promise(resolve => window.addEventListener("popstate", resolve, { once: true }));
    window.history.back(); await popped;
  });
  await flushFrames();
  expect(window.scrollY).toBe(y);
  expect(sessionStorage.getItem(landingKey)).toBe(String(y));
});

it("still records same-route scroll and pagehide positions", async () => {
  await renderAt(700);
  expect(sessionStorage.getItem(landingKey)).toBe("700");
  vi.stubGlobal("scrollY", 850);
  window.dispatchEvent(new Event("pagehide"));
  expect(sessionStorage.getItem(landingKey)).toBe("850");
});

it("preserves scroll for in-place search replacement", async () => {
  await renderAt(700);
  await act(() => host.querySelectorAll("button")[1]!.click());
  await flushFrames();
  expect(window.location.search).toBe("?q=receiving");
  expect(window.scrollY).toBe(700);
  expect(sessionStorage.getItem("knowledge-scroll:/knowledge?q=receiving")).toBe("700");
});
