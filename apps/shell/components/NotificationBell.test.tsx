import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@intra/auth", () => ({ useSession: vi.fn() }));
vi.mock("@shell/lib/supabase/env", () => ({ ENABLE_NOTIFICATIONS: false }));

import { NotificationItem, NotificationResults, notificationSummary } from "./NotificationBell";

describe("NotificationItem local rendered fixture", () => {
  beforeEach(() => vi.stubGlobal("React", React));
  afterEach(() => vi.unstubAllGlobals());
  const row = {
    id: "local-unread-fixture",
    kind: "approval_pending",
    entity_type: "local-test-entity",
    entity_id: "local-test-id",
    read_at: null,
    created_at: "2026-09-05T00:00:00Z",
  };
  it("renders the unread action with a wrapping minimum-size target without invoking it", () => {
    const onMarkRead = vi.fn(async () => undefined);
    const markup = renderToStaticMarkup(<NotificationItem row={row} busy={false} onMarkRead={onMarkRead} />);
    expect(markup).toContain("Mark read");
    expect(markup).toContain("min-h-11 min-w-11 max-w-full whitespace-normal");
    expect(markup).toContain("[overflow-wrap:anywhere]");
    expect(markup).not.toContain("truncate");
    expect(markup).toContain('role="menuitem"');
    expect(onMarkRead).not.toHaveBeenCalled();
  });
  it("retains disabled busy state and omits the mutation action for read notifications", () => {
    const onMarkRead = vi.fn(async () => undefined);
    expect(renderToStaticMarkup(<NotificationItem row={row} busy onMarkRead={onMarkRead} />)).toContain('disabled=""');
    expect(renderToStaticMarkup(<NotificationItem row={{ ...row, read_at: row.created_at }} busy={false} onMarkRead={onMarkRead} />)).not.toContain('role="menuitem"');
    expect(onMarkRead).not.toHaveBeenCalled();
  });
  it("shows first-fetch failure and Retry without false all-read or empty success", () => {
    const markup = renderToStaticMarkup(<NotificationResults rows={[]} initialFetch loadFailed refreshing={false}
      busyId={null} onMarkRead={vi.fn()} onRetry={vi.fn()} />);
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("Notifications are unavailable. Try again.");
    expect(markup).toContain("Retry");
    expect(markup).not.toContain("caught up");
    expect(notificationSummary(true, true, 0)).toBe("Unavailable");
    expect(notificationSummary(false, false, 0)).toBe("Loading");
  });
  it("preserves previously loaded rows with a stale warning and disables repeated Retry while pending", () => {
    const markup = renderToStaticMarkup(<NotificationResults rows={[row]} initialFetch loadFailed refreshing
      busyId={null} onMarkRead={vi.fn()} onRetry={vi.fn()} />);
    expect(markup).toContain("Previously loaded alerts may be out of date.");
    expect(markup).toContain("Approval waiting on you");
    expect(markup).toContain("Retrying...");
    expect(markup).toContain('disabled=""');
    expect(notificationSummary(true, true, 1)).toBe("Unavailable");
  });
  it("shows a successful empty response distinctly from a failure", () => {
    const markup = renderToStaticMarkup(<NotificationResults rows={[]} initialFetch loadFailed={false} refreshing={false}
      busyId={null} onMarkRead={vi.fn()} onRetry={vi.fn()} />);
    expect(markup).toContain("caught up");
    expect(markup).not.toContain('role="alert"');
    expect(notificationSummary(true, false, 0)).toBe("All read");
  });
});
