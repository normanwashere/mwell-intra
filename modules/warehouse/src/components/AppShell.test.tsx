import { describe, it, expect, vi } from "vitest";
import { act, screen, within } from "@testing-library/react";
import { _resetMemoryQueue, enqueue, markConflict } from '@intra/data-kit';
import userEvent from "@testing-library/user-event";
import { useLocation } from "react-router-dom";
import { AppShell } from "./AppShell";
import { renderWithProviders } from "@/test/renderWithProviders";

function LocationProbe() {
  const location = useLocation();
  return <output aria-label="Current route">{location.pathname}</output>;
}

describe("AppShell navigation", () => {
  it('keeps the desktop home target spacious without increasing the brand row height', async () => {
    renderWithProviders(<AppShell>content</AppShell>);
    const home = await screen.findByRole('link', { name: 'Mwell Intra home' });
    expect(home).toHaveAttribute('href', '/');
    expect(home).toHaveClass('flex', 'min-h-11');
    expect(home.parentElement).toHaveClass('py-3');
    expect(home.parentElement).not.toHaveClass('py-5');
    expect(within(home).getByRole('img', { name: 'mWell' })).toHaveClass('h-7');
  });
  it('names active Warehouse alerts consistently and exposes the main keyboard scroller', async () => {
    renderWithProviders(<AppShell>Read-only exceptions</AppShell>);
    const main = await screen.findByRole('main', { name: 'Warehouse workspace' });
    expect(main).toHaveAttribute('tabindex', '0');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /^Warehouse alerts \(\d+ active\)$/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Warehouse alerts' });
    expect(dialog).toHaveTextContent('Highest priority first');
    expect(dialog).toHaveTextContent('not unread notifications');
  });
  it('opens actor-owned conflict details with keyboard and does not discard on inspection', async () => {
    _resetMemoryQueue();
    const entry = await enqueue('relocate', { actor: 'logistics_supervisor@mwell', idempotencyKey: 'local-conflict', fromBinId: 'RACK-A', toBinId: 'RACK-B', quantity: 2 });
    await markConflict(entry.id, 'Insufficient stock');
    const rendered = renderWithProviders(<AppShell>content</AppShell>);
    try {
      const user = userEvent.setup();
      const trigger = await screen.findByRole('button', { name: /1 conflict.*View details/ });
      trigger.focus();
      await user.keyboard('{Enter}');
      const dialog = await screen.findByRole('dialog', { name: 'Sync conflicts' });
      expect(dialog).toHaveTextContent('Move stock between bins');
      expect(dialog).toHaveTextContent('RACK-A');
      expect(dialog).toHaveTextContent('RACK-B');
      await user.keyboard('{Escape}');
      expect(trigger).toHaveFocus();
      expect(trigger).toHaveTextContent('1 conflict');
    } finally { rendered.unmount(); _resetMemoryQueue(); }
  });
  it('keeps metadata-only legacy recovery visible beyond toast expiry without exposing queue payloads', async () => {
    _resetMemoryQueue();
    await enqueue('transfer', { secret: 'unowned payload' });
    const legacy = await enqueue('transfer', { actor: 'other', secret: 'foreign legacy payload' });
    await markConflict(legacy.id, 'private legacy error');
    const foreign = await enqueue('transfer', { actor: 'other', idempotencyKey: 'foreign', secret: 'foreign payload' });
    await markConflict(foreign.id, 'private foreign error');
    const rendered = renderWithProviders(<AppShell>content</AppShell>);
    try {
      const notice = await screen.findByRole('status', { name: 'Unresolved legacy queue' });
      expect(notice).toHaveTextContent('2 unresolved legacy queued actions on this device.');
      expect(notice).toHaveTextContent(/account administrator.*reconcil/i);
      expect(notice).toHaveTextContent(/not.*automatically assigned, replayed, or deleted/);
      expect(within(notice).queryByRole('button')).not.toBeInTheDocument();
      expect(document.body).not.toHaveTextContent(/unowned payload|foreign legacy payload|private legacy error|foreign payload|private foreign error/);
      vi.useFakeTimers();
      await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
      expect(notice).toBeVisible();
    } finally {
      vi.useRealTimers();
      rendered.unmount();
      _resetMemoryQueue();
    }
  });
  it.each([
    ["warehouse_operator", "Receive and inspect"],
    ["warehouse_supervisor", "Receiving"],
  ] as const)(
    "renders canonical %s navigation without an undefined role lookup",
    async (role, expectedLink) => {
      renderWithProviders(<AppShell>content</AppShell>, { role });
      const sidebar = await screen.findByRole("navigation", {
        name: "Primary",
      });
      expect(
        within(sidebar).getByRole("link", { name: expectedLink }),
      ).toBeInTheDocument();
      expect(
        screen.getAllByText(/warehouse (operator|supervisor)/i).length,
      ).toBeGreaterThan(0);
    },
  );

  it("renders the Operator desktop experience with every floor recovery route", async () => {
    renderWithProviders(<AppShell>content</AppShell>, {
      role: "warehouse_operator",
    });
    const sidebar = await screen.findByRole("navigation", { name: "Primary" });
    for (const label of [
      "Receive and inspect",
      "Put away",
      "Pick & Pack",
      "Returns and counts",
    ]) {
      expect(
        within(sidebar).getByRole("link", { name: label }),
      ).toBeInTheDocument();
    }
    for (const label of [
      "Scan",
      "Tasks",
      "Inventory",
      "Allocations",
      "Cycle Counts",
      "Quality Control",
      "Exceptions",
    ]) {
      expect(
        within(sidebar).getByRole("link", { name: label }),
      ).toBeInTheDocument();
    }
    for (const label of [
      "Replenishment",
      "Pricing",
      "Data & Reports",
      "Events",
      "Suppliers",
    ]) {
      expect(
        within(sidebar).queryByRole("link", { name: label }),
      ).not.toBeInTheDocument();
    }
    expect(
      within(sidebar).getByRole("link", { name: "Pick & Pack" }),
    ).toHaveAttribute("href", "/fulfillment?filter=floor_work");
  });

  it("presents Warehouse as an Mwell Intra workspace on desktop and mobile", async () => {
    renderWithProviders(<AppShell>content</AppShell>, {
      role: "warehouse_admin",
    });

    const home = await screen.findByRole("link", { name: "Mwell Intra home" });
    expect(home).toHaveTextContent(/Intra/);
    expect(home).toHaveTextContent(/Warehouse/);
    const mobileBrand = screen.getByLabelText("Mwell Intra Warehouse");
    expect(within(mobileBrand).getByRole("img", { name: "mWell" }))
      .toBeInTheDocument();
    expect(mobileBrand).toHaveTextContent(
      /^Intra · WarehouseAdministrator$/,
    );
  });
  it("shows logistics modules including Receiving", async () => {
    renderWithProviders(<AppShell>content</AppShell>, {
      role: "logistics_supervisor",
    });
    const sidebar = await screen.findByRole("navigation", { name: "Primary" });
    expect(
      within(sidebar).getByRole("link", { name: /receiving/i }),
    ).toBeInTheDocument();
    expect(
      within(sidebar).getByRole("link", { name: /cycle counts/i }),
    ).toBeInTheDocument();
    for (const group of [
      "Operate",
      "Plan",
      "Control",
      "Analyze",
      "Configure",
    ]) {
      const toggle = within(sidebar).getByRole("button", { name: group });
      expect(toggle).toHaveAttribute("aria-expanded");
    }
  });

  it("keeps Warehouse operations scoped and leaves Finance to the Intra shell", async () => {
    renderWithProviders(<AppShell>content</AppShell>, { role: "finance" });
    const sidebar = await screen.findByRole("navigation", { name: "Primary" });
    expect(
      within(sidebar).queryByRole("link", { name: /receiving/i }),
    ).not.toBeInTheDocument();
    expect(
      within(sidebar).queryByRole("link", { name: /^finance$/i }),
    ).not.toBeInTheDocument();
  });

  it("intersects live Operator capabilities with the canonical routine projection", async () => {
    renderWithProviders(<AppShell>content</AppShell>, {
      role: "warehouse_operator",
      source: "supabase",
      capabilities: ["view_dashboard", "view_pricing", "set_pricing"],
    });

    const sidebar = await screen.findByRole("navigation", { name: "Primary" });
    expect(
      within(sidebar).queryByRole("link", { name: "Pricing" }),
    ).not.toBeInTheDocument();
    expect(
      within(sidebar).queryByRole("link", { name: "Receive and inspect" }),
    ).not.toBeInTheDocument();
    expect(
      within(sidebar).queryByRole("link", { name: "Receiving" }),
    ).not.toBeInTheDocument();
    expect(
      within(sidebar).getByRole("link", { name: "Home" }),
    ).toBeInTheDocument();
  });

  it("opens the account menu with a sign-out action", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AppShell>content</AppShell>, {
      role: "logistics_supervisor",
    });
    await screen.findByRole("navigation", { name: "Primary" });

    await user.click(screen.getByRole("button", { name: /account/i }));
    const dialog = await screen.findByRole("dialog", { name: /account/i });
    expect(
      within(dialog).getByRole("button", { name: /log out/i }),
    ).toBeInTheDocument();
  });

  it("shows the demo data-source badge for the in-memory repo", async () => {
    renderWithProviders(<AppShell>content</AppShell>);
    expect(await screen.findByText("Demo")).toBeInTheDocument();
  });

  it("uses the exact mobile primary order and keeps More available", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AppShell>content</AppShell>, {
      role: "logistics_supervisor",
    });
    const mobile = await screen.findByRole("navigation", {
      name: "Primary mobile",
    });
    expect(
      within(mobile)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["Home", "Scan", "Tasks", "Inventory"]);
    expect(
      within(mobile).getByRole("button", { name: "More" }),
    ).toBeInTheDocument();

    await user.click(within(mobile).getByRole("button", { name: "More" }));
    const drawer = await screen.findByRole("dialog", { name: /all tools/i });
    expect(within(drawer).getAllByText(/returns/i).length).toBeGreaterThan(0);
    expect(within(drawer).queryByText(/^Scan$/)).not.toBeInTheDocument();
    expect(within(drawer).queryByText(/^Tasks$/)).not.toBeInTheDocument();
  });

  it("keeps More reachable for roles without Scan or Tasks", async () => {
    renderWithProviders(<AppShell>content</AppShell>, {
      role: "business_unit",
    });
    const mobile = await screen.findByRole("navigation", {
      name: "Primary mobile",
    });
    expect(
      within(mobile).queryByRole("link", { name: "Scan" }),
    ).not.toBeInTheDocument();
    expect(
      within(mobile).queryByRole("link", { name: "Tasks" }),
    ).not.toBeInTheDocument();
    expect(
      within(mobile).getByRole("button", { name: "More" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Quick scan" }),
    ).not.toBeInTheDocument();
  });

  it("opens the module alerts drawer", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AppShell>content</AppShell>);
    await screen.findByRole("navigation", { name: "Primary" });

    const alertsButton = screen.getByTitle("Warehouse alerts");
    expect(alertsButton).toHaveAttribute(
      "aria-label",
      expect.stringMatching(/^Warehouse alerts \(\d+ active\)$/),
    );
    const alertCount = Number(
      alertsButton.getAttribute("aria-label")?.match(/\((\d+) active\)/)?.[1] ?? 0,
    );
    const countBadge = within(alertsButton).queryByText(/^\d+$/);
    if (alertCount > 0) {
      expect(countBadge).toHaveTextContent(String(alertCount));
      expect(countBadge).toHaveClass("bg-rose-700");
    } else {
      expect(countBadge).not.toBeInTheDocument();
    }

    await user.click(alertsButton);
    expect(
      await screen.findByRole("dialog", { name: 'Warehouse alerts' }),
    ).toBeInTheDocument();
  });

  it("shows red pending-work counts beside actionable modules", async () => {
    renderWithProviders(<AppShell>content</AppShell>, {
      role: "warehouse_operator",
    });
    const sidebar = await screen.findByRole("navigation", { name: "Primary" });
    const allocations = within(sidebar).getByRole("link", {
      name: "Allocations",
    });
    expect(allocations.querySelector('[title$="pending"]')).toHaveClass(
      "bg-rose-600",
    );
  });

  it("asks for confirmation before resetting demo data (WH-6)", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AppShell>content</AppShell>, {
      role: "logistics_supervisor",
    });
    await screen.findByRole("navigation", { name: "Primary" });

    await user.click(
      screen.getAllByRole("button", { name: /reset demo data/i })[0]!,
    );
    const dialog = await screen.findByRole("dialog", {
      name: /reset demo data\?/i,
    });
    expect(within(dialog).getByText(/cannot be undone/i)).toBeInTheDocument();
    // Cancel keeps the data (no reload).
    await user.click(within(dialog).getByRole("button", { name: /cancel/i }));
  });

  it("opens the dedicated scan route from the header shortcut", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <AppShell>
        <LocationProbe />
      </AppShell>,
    );
    await screen.findByRole("navigation", { name: "Primary" });

    const quickScan = screen.getAllByRole("button", { name: /quick scan/i })[0];
    expect(quickScan).toBeDefined();
    await user.click(quickScan!);
    expect(
      await screen.findByRole("status", { name: /current route/i }),
    ).toHaveTextContent("/scan");
  });
});
