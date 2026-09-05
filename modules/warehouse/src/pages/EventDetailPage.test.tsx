import { describe, it, expect, vi } from "vitest";
import { Route, Routes } from "react-router-dom";
import { screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EventDetailPage } from "./EventDetailPage";
import type { WarehouseUiRole } from "@/app/modules";
import { makeRepo, renderWithProviders } from "@/test/renderWithProviders";

vi.mock("@/components/camera/scanEngine", () => ({
  createScanEngine: () => ({
    start: vi.fn().mockRejectedValue(new Error("Camera denied")),
    stop: vi.fn(),
  }),
}));

function renderEvent(role: WarehouseUiRole = "finance") {
  return renderWithProviders(
    <Routes>
      <Route path="/events/:id" element={<EventDetailPage />} />
    </Routes>,
    { route: "/events/evt-makati", role },
  );
}

describe("EventDetailPage", () => {
  it("renders event summary and costing for a seeded event", async () => {
    renderEvent("finance");
    expect(
      await screen.findByRole("heading", { name: /Makati Corporate/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/event costing/i)).toBeInTheDocument();
    expect(screen.getByText("Outstanding custody")).toBeInTheDocument();
    expect(screen.queryByText("Sold / used")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Event allocations")).toBeInTheDocument();
  });

  it("hides the reserve CTA for roles without reserve_allocate", async () => {
    renderEvent("finance");
    await screen.findByRole("heading", { name: /Makati Corporate/i });
    expect(
      screen.queryByRole("button", { name: /reserve for this event/i }),
    ).not.toBeInTheDocument();
  });

  it("reserves stock for the event via the CTA", async () => {
    const user = userEvent.setup();
    renderEvent("warehouse_operator");
    await screen.findByRole("heading", { name: /Makati Corporate/i });

    await user.click(
      screen.getByRole("button", { name: /reserve for this event/i }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: /new reservation/i,
    });
    expect(within(dialog).getByLabelText("Event")).toHaveValue("evt-makati");
    expect(within(dialog).getByLabelText("Event")).toBeDisabled();
    await user.click(
      within(dialog).getByRole("button", { name: "Add product" }),
    );
    expect(within(dialog).getAllByLabelText("Product")).toHaveLength(2);
    await user.selectOptions(
      within(dialog).getAllByLabelText("Product")[1]!,
      "shirt-l",
    );
    await user.selectOptions(
      within(dialog).getAllByLabelText("Purpose")[1]!,
      "giveaway",
    );
    await user.selectOptions(
      within(dialog).getAllByLabelText("Product")[0]!,
      "doctor-token",
    );
    await user.click(
      within(dialog).getByRole("button", { name: /^reserve$/i }),
    );

    await waitFor(() => {
      expect(screen.getByText(/reserved 2 product lines/i)).toBeInTheDocument();
    });
  });

  it("sends one intent on a pending double click", async () => {
    const repo = makeRepo();
    const original = repo.reserveBatch.bind(repo);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const reserve = vi
      .spyOn(repo, "reserveBatch")
      .mockImplementation(async (input) => {
        await gate;
        return original(input);
      });
    const user = userEvent.setup();
    renderWithProviders(
      <Routes>
        <Route path="/events/:id" element={<EventDetailPage />} />
      </Routes>,
      {
        route: "/events/evt-makati",
        role: "warehouse_operator",
        repo,
      },
    );
    await user.click(
      await screen.findByRole("button", { name: "Reserve for this event" }),
    );
    const dialog = screen.getByRole("dialog", { name: "New reservation" });
    await user.selectOptions(
      within(dialog).getByLabelText("Product"),
      "doctor-token",
    );
    try {
      await user.dblClick(
        within(dialog).getByRole("button", { name: "Reserve" }),
      );
      expect(reserve).toHaveBeenCalledTimes(1);
    } finally {
      release();
    }
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("requires validated serial scans and recovers from wrong identity, duplicates, unknown codes and camera denial", async () => {
    const seed = await makeRepo().getData();
    seed.allocations = [
      {
        id: "scan-allocation",
        eventId: "evt-makati",
        productId: "smart-watch",
        quantity: 2,
        status: "reserved",
        createdAt: "2026-08-28",
      },
    ];
    const template = seed.units.find(
      (unit) => unit.productId === "smart-watch",
    )!;
    seed.units = [
      {
        ...template,
        id: "scan-1",
        serialNumber: "WATCH-1",
        locationId: "loc-wh",
        binId: "bin-pasig-a1",
        status: "in_stock",
      },
      {
        ...template,
        id: "scan-2",
        serialNumber: "WATCH-2",
        locationId: "loc-wh",
        binId: "bin-pasig-a1",
        status: "in_stock",
      },
      {
        ...template,
        id: "scan-3",
        serialNumber: "WRONG-BIN",
        locationId: "loc-wh",
        binId: undefined,
        status: "in_stock",
      },
      {
        ...template,
        id: "scan-4",
        serialNumber: "WRONG-LOCATION",
        locationId: "loc-other",
        binId: undefined,
        status: "in_stock",
      },
    ];
    const repo = makeRepo(seed);
    const issue = vi.spyOn(repo, "issue");
    const user = userEvent.setup();
    renderWithProviders(
      <Routes>
        <Route path="/events/:id" element={<EventDetailPage />} />
      </Routes>,
      {
        route: "/events/evt-makati",
        role: "warehouse_operator",
        repo,
      },
    );
    await user.click(await screen.findByRole("button", { name: "Issue" }));
    const dialog = screen.getByRole("dialog", { name: "Issue allocation" });
    const confirm = within(dialog).getByRole("button", {
      name: "Confirm issue",
    });
    expect(confirm).toBeDisabled();
    expect(within(dialog).queryByRole("checkbox")).not.toBeInTheDocument();
    await user.click(
      within(dialog).getByRole("button", { name: "Scan issue serial" }),
    );
    expect(
      await within(dialog).findByText(/needs camera access/i),
    ).toBeInTheDocument();
    const scan = async (value: string) => {
      await user.type(
        within(dialog).getByLabelText("Scan or enter issue serial"),
        `${value}{Enter}`,
      );
    };
    for (const [code, message] of [
      ["unknown-code", /not recognized/i],
      ["doctor-token", /does not match the product/i],
      ["WRONG-BIN", /required source bin/i],
      ["WRONG-LOCATION", /required location/i],
    ] as const) {
      await scan(code);
      expect(within(dialog).getByText(message)).toBeInTheDocument();
      expect(confirm).toBeDisabled();
    }
    await scan("WATCH-1");
    await scan("watch-1");
    expect(within(dialog).getByText(/already scanned/i)).toBeInTheDocument();
    expect(confirm).toBeDisabled();
    await user.selectOptions(
      within(dialog).getByLabelText("Issue from bin"),
      "",
    );
    expect(
      within(dialog).queryByLabelText("Accepted scans"),
    ).not.toBeInTheDocument();
    await scan("WATCH-1");
    expect(
      within(dialog).getByText(/required source bin/i),
    ).toBeInTheDocument();
    await user.selectOptions(
      within(dialog).getByLabelText("Issue from bin"),
      "bin-pasig-a1",
    );
    await scan("WATCH-1");
    await scan("WATCH-2");
    expect(confirm).toBeEnabled();
    await user.click(confirm);
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(issue).toHaveBeenCalledTimes(1);
    expect(issue).toHaveBeenCalledWith(
      expect.objectContaining({
        serialNumbers: ["WATCH-1", "WATCH-2"],
        sourceLocationId: "loc-wh",
        sourceBinId: "bin-pasig-a1",
      }),
    );
  });
});
