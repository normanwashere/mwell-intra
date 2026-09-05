import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { headerPopoverBounds as accountMenuBounds } from "./headerPopoverBounds";

describe("account menu viewport recovery", () => {
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
    const source = readFileSync(new URL("../components/UserMenu.tsx", import.meta.url), "utf8");
    expect(source).toContain("overflow-y-auto overscroll-contain");
    expect(source).toContain("[overflow-wrap:anywhere]");
    expect(source).not.toContain("truncate");
    expect(source).toContain('e.key === "Escape"');
    expect(source).toContain("triggerRef.current?.focus()");
    expect(source).toContain('document.addEventListener("pointerdown", onPointerDown)');
    expect(source).toContain('role="menuitem"');
    const hook = readFileSync(new URL("./useHeaderPopoverBounds.ts", import.meta.url), "utf8");
    expect(hook).toContain("observer.disconnect()");
    expect(hook).toContain("previous.maxHeight === next.maxHeight ? previous : next");
  });
  it("preserves Notifications' existing 20rem preferred desktop width", () => {
    expect(accountMenuBounds({ anchorRight: 1300, anchorBottom: 56, anchorHeight: 44,
      viewportWidth: 1440, viewportBottom: 900, rootFontSize: 16, preferredWidthRem: 20,
    }).width).toBe(320);
  });
  it("bounds the whole Notifications panel and removes its nested list scroller", () => {
    const source = readFileSync(new URL("../components/NotificationBell.tsx", import.meta.url), "utf8");
    expect(source).toContain("useHeaderPopoverBounds(open && !disabled, triggerRef, 20)");
    expect(source).toContain("overflow-y-auto overscroll-contain");
    expect(source).not.toContain("max-h-96");
    expect(source).toContain("event.key === 'Escape'");
    expect(source).toContain("triggerRef.current?.focus()");
    expect(source).toContain("client.rpc('mark_notification_read'");
    expect(source).toContain("min-h-11 min-w-11 max-w-full whitespace-normal");
    expect(source).toContain("flex min-w-0 flex-wrap items-start gap-3");
  });
});
