import { describe, it, expect } from "vitest";
import { screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReturnsPage } from "./ReturnsPage";
import { renderWithProviders } from "@/test/renderWithProviders";

describe("ReturnsPage", () => {
  it("keeps the quality handoff only when the live returns bundle can open it", async () => {
    renderWithProviders(<ReturnsPage />, {
      role: "warehouse_operator",
      source: "supabase",
      capabilities: ["manage_returns"],
    });
    await screen.findByText(/recent returns/i);
    expect(
      screen.getByRole("link", { name: /open quality queue/i }),
    ).toHaveAttribute("href", "/quality");
  });

  // The seeded returns list is larger since the 90-day history landed; give
  // the record-and-rerender flow more headroom than the 5s default.
  it(
    "records a customer return and shows it in the list",
    { timeout: 15_000 },
    async () => {
      const user = userEvent.setup();
      renderWithProviders(<ReturnsPage />, { role: "warehouse_operator" });
      await screen.findByText(/recent returns/i);

      await user.selectOptions(screen.getByLabelText("Product"), "shirt-l");
      const qty = screen.getByLabelText("Quantity");
      await user.clear(qty);
      await user.type(qty, "3");
      await user.selectOptions(screen.getByLabelText("Reason"), "wrong size");
      await user.click(screen.getByRole("button", { name: /record return/i }));

      await waitFor(() => {
        const list = screen.getByLabelText("Returns");
        expect(
          within(list).getByText(/Event Shirt \(L\)/i),
        ).toBeInTheDocument();
      });
      expect(
        screen.getByText(/return logged in inspection staging/i),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("link", { name: /open quality queue/i }),
      ).toBeInTheDocument();
      expect(
        within(screen.getByLabelText("Returns")).getAllByText("Restocked")
          .length,
      ).toBeGreaterThan(0);
    },
  );

  it("reveals a serial field and requires it for serialized devices", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ReturnsPage />, { role: "warehouse_operator" });
    await screen.findByText(/recent returns/i);

    expect(screen.queryByLabelText("Serial number")).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Product"), "ecg-ring-10");
    expect(screen.getByLabelText("Serial number")).toBeInTheDocument();
    // submit is blocked until a serial is supplied
    expect(
      screen.getByRole("button", { name: /record return/i }),
    ).toBeDisabled();

    await user.type(
      screen.getByLabelText("Serial number"),
      "ECG-RING-10-SN0001",
    );
    expect(
      screen.getByRole("button", { name: /record return/i }),
    ).toBeEnabled();
  });

  it("accepts only an issued serial for the selected return product and event", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ReturnsPage />, { role: "warehouse_operator" });
    await screen.findByText(/recent returns/i);
    await user.selectOptions(screen.getByLabelText("Product"), "smart-watch");
    await user.selectOptions(
      screen.getByLabelText("Related event (optional)"),
      "evt-vip",
    );
    const manual = screen.getByLabelText("Enter barcode manually");
    await user.type(manual, "SMART-WATCH-SN0001");
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/cannot be returned/i);
    await user.type(manual, "SMART-WATCH-VIP001");
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByRole("status")).toHaveTextContent(/scan accepted/i);
    expect(screen.getByLabelText("Serial number")).toHaveValue(
      "SMART-WATCH-VIP001",
    );
  });
});
