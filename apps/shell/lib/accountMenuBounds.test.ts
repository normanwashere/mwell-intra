// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { URL as FileURL } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { headerPopoverBounds as accountMenuBounds } from "./headerPopoverBounds";
import { NotificationBell } from "../components/NotificationBell";

vi.mock("@intra/auth", () => ({ useSession: () => ({ mode: "memory", profile: null }) }));
vi.mock("@shell/lib/supabase/env", () => ({ ENABLE_NOTIFICATIONS: false }));

describe("account menu viewport recovery", () => {
  beforeEach(() => vi.stubGlobal("React", React));
  afterEach(() => vi.unstubAllGlobals());
  it("bounds enlarged mobile content above actual bottom navigation", () => {
    expect(accountMenuBounds({ anchorRight: 288, anchorBottom: 268, anchorHeight: 88,
      viewportWidth: 320, viewportBottom: 900, navigationTop: 726, rootFontSize: 32,
    })).toEqual({ top: 96, width: 280, maxHeight: 442 });
  });
  it("retains desktop preferred width without reserving hidden mobile navigation", () => {
    expect(accountMenuBounds({ anchorRight: 1416, anchorBottom: 56, anchorHeight: 44,
      viewportWidth: 1440, viewportBottom: 900, rootFontSize: 16,
    })).toEqual({ top: 52, width: 352, maxHeight: 828 });
  });
  it("responds to a shortened visual viewport without negative available space", () => {
    expect(accountMenuBounds({ anchorRight: 304, anchorBottom: 56, anchorHeight: 44,
      viewportWidth: 320, viewportBottom: 400, navigationTop: 820, rootFontSize: 16,
    }).maxHeight).toBe(328);
  });
  it("keeps wrapping, scrolling, Escape focus return and outside dismissal", () => {
    const source = readFileSync(new FileURL("../components/UserMenu.tsx", import.meta.url), "utf8");
    expect(source).toContain("overflow-y-auto overscroll-contain");
    expect(source).toContain("[overflow-wrap:anywhere]");
    expect(source).not.toContain("truncate");
    expect(source).toContain('e.key === "Escape"');
    expect(source).toContain("triggerRef.current?.focus()");
    expect(source).toContain('document.addEventListener("pointerdown", onPointerDown)');
    expect(source).toContain('role="menuitem"');
    const hook = readFileSync(new FileURL("./useHeaderPopoverBounds.ts", import.meta.url), "utf8");
    expect(hook).toContain("observer.disconnect()");
    expect(hook).toContain("previous.maxHeight === next.maxHeight ? previous : next");
  });
  it("supports a 20rem preferred width for a header popover", () => {
    expect(accountMenuBounds({ anchorRight: 1300, anchorBottom: 56, anchorHeight: 44,
      viewportWidth: 1440, viewportBottom: 900, rootFontSize: 16, preferredWidthRem: 20,
    }).width).toBe(320);
  });
  it("retains a non-shrinking 44px Inbox trigger with a visible mobile label", () => {
    const container = document.createElement("div");
    container.innerHTML = renderToStaticMarkup(React.createElement(NotificationBell));
    const trigger = container.querySelector("button")!;
    const label = [...trigger.querySelectorAll("span")].find(span => span.textContent === "Inbox")!;
    expect(trigger.getAttribute("aria-label")).toBe("Inbox unavailable in demo mode");
    expect(trigger.getAttribute("aria-haspopup")).toBe("dialog");
    expect(trigger.classList.contains("h-11")).toBe(true);
    expect(trigger.classList.contains("w-11")).toBe(true);
    expect(trigger.classList.contains("shrink-0")).toBe(true);
    expect(label).toBeDefined();
    for (let element: Element | null = label; element && element !== container; element = element.parentElement) {
      expect(element.getAttribute("aria-hidden")).not.toBe("true");
      expect(element.hasAttribute("hidden")).toBe(false);
      expect(element.className).not.toMatch(/(?:^|\s)(?:\S+:)?(?:hidden|sr-only|invisible)(?:\s|$)/);
    }
  });
  it("bounds the whole Inbox panel and removes its nested list scroller", () => {
    const source = readFileSync(new FileURL("../components/NotificationBell.tsx", import.meta.url), "utf8");
    const sheet = readFileSync(new FileURL("../../../packages/ui/src/Sheet.tsx", import.meta.url), "utf8");
    expect(source).toContain('<Sheet open={open && !disabled} onOpenChange={setOpen} side="right"');
    expect(sheet).toContain('Dialog.Root open={open} onOpenChange={onOpenChange}');
    expect(sheet).toContain('Dialog.Content');
    expect(sheet).toContain("overflow-y-auto overscroll-contain");
    expect(source).not.toContain("max-h-96");
    expect(sheet).toContain('Dialog.Close');
    expect(sheet).toContain('onCloseAutoFocus');
    expect(sheet).toContain('returnFocusRef.current.focus()');
    expect(source).toContain('aria-haspopup="dialog"');
    expect(source).toContain("client.rpc('mark_notification_read'");
    expect(source).toContain("min-h-11 min-w-11 max-w-full whitespace-normal");
    expect(source).toContain("flex min-w-0 flex-wrap items-start gap-3");
  });
});
