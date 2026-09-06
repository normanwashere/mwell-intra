// @vitest-environment jsdom
import { act } from "react";
import * as React from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { ContextualHelpLink } from "./ContextualHelpLink";
import { TaskHelpProvider } from "./TaskHelpContext";

afterEach(() => vi.unstubAllGlobals());

it("preserves plain and modified links, intercepting only a primary click with a controller", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("React", React);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const controller = { openHelp: vi.fn(), closeHelp: vi.fn() };
  try {
    await act(async () => root.render(<ContextualHelpLink articleId="feature-receiving" title="Receiving" />));
    const plain = container.querySelector("a")!;
    expect(plain.getAttribute("href")).toBe("/knowledge?article=feature-receiving");
    await act(async () => root.render(<TaskHelpProvider controller={controller}><ContextualHelpLink articleId="feature-receiving" title="Receiving" /></TaskHelpProvider>));
    const link = container.querySelector("a")!;
    for (const modifier of ["ctrlKey", "metaKey", "shiftKey", "altKey"]) {
      const event = new MouseEvent("click", { bubbles: true, cancelable: true, [modifier]: true });
      let intercepted = true;
      // Observe after React's root handler, then stop jsdom's unsupported navigation.
      document.addEventListener("click", (click) => {
        intercepted = click.defaultPrevented;
        click.preventDefault();
      }, { once: true });
      await act(async () => { link.dispatchEvent(event); });
      expect(intercepted).toBe(false);
    }
    expect(controller.openHelp).not.toHaveBeenCalled();
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    await act(async () => { link.dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(true);
    expect(controller.openHelp).toHaveBeenCalledWith({ articleId: "feature-receiving", title: "Receiving" }, link);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
