// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import * as React from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { ContextualHelpLink } from "../../../../packages/ui/src/ContextualHelpLink";
import { ContextualTaskHelp } from "./ContextualTaskHelp";

vi.mock("@intra/auth", () => ({ useSession: () => ({ profile: { id: "one", kind: "employee" }, userRoles: {} }) }));
vi.mock("@intra/ui", async () => {
  const context = await import("../../../../packages/ui/src/TaskHelpContext");
  return { ...context,
    Button: ({ children, icon: _icon, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon?: string }) => <button type="button" {...props}>{children}</button>,
    Sheet: ({ open, children, title, onOpenChange }: { open: boolean; children: ReactNode; title: string; onOpenChange(open: boolean): void }) => open ? <div role="dialog" aria-label={title}><button onClick={() => onOpenChange(false)}>Close sheet</button>{children}</div> : null,
  };
});

afterEach(() => vi.unstubAllGlobals());

it.each([true, false])("keeps drafts mounted and ignores late responses (wide=%s)", async (wide) => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("React", React);
  vi.stubGlobal("matchMedia", () => ({ matches: wide, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 0; });
  let respond!: (value: Response) => void;
  const fetcher = vi.fn(() => new Promise<Response>((resolve) => { respond = resolve; }));
  vi.stubGlobal("fetch", fetcher);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const submit = vi.fn();
  try {
    await act(async () => root.render(<ContextualTaskHelp><form onSubmit={submit}>
      <input aria-label="Receipt serial" defaultValue="SERIAL-001" />
      <input aria-label="PO reference" defaultValue="PO-42" />
      <input aria-label="Quantity" defaultValue="3" />
      <input aria-label="Camera input" type="file" />
      <ContextualHelpLink articleId="feature-warehouse-receiving" title="Receiving" />
    </form></ContextualTaskHelp>));
    const serial = container.querySelector<HTMLInputElement>('input[aria-label="Receipt serial"]')!;
    serial.value = "UNSAVED-SCAN";
    const file = container.querySelector('input[type="file"]');
    const link = container.querySelector<HTMLAnchorElement>("a")!;
    await act(async () => link.click());
    expect(container.querySelector(wide ? 'aside[aria-label="Task help"]' : '[role="dialog"]')).not.toBeNull();
    expect(serial.value).toBe("UNSAVED-SCAN");
    expect(container.querySelector('input[type="file"]')).toBe(file);
    expect(fetcher).toHaveBeenCalledWith("/api/knowledge/context?article=feature-warehouse-receiving", expect.objectContaining({ credentials: "same-origin", cache: "no-store" }));
    if (wide) await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    else await act(async () => container.querySelector<HTMLButtonElement>('[role="dialog"] button')!.click());
    await act(async () => respond(new Response(JSON.stringify({ guide: { title: "Late secret" } }), { status: 200 })));
    expect(container.textContent).not.toContain("Late secret");
    expect(container.querySelector("aside")).toBeNull();
    expect(document.activeElement).toBe(link);
    expect(serial.value).toBe("UNSAVED-SCAN");
    expect(container.querySelector<HTMLInputElement>('input[aria-label="PO reference"]')?.value).toBe("PO-42");
    expect(submit).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
