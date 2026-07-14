import { describe, it, expect } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CycleCountsPage } from "./CycleCountsPage";
import { renderWithProviders } from "@/test/renderWithProviders";

describe("CycleCountsPage", () => {
  it("never prefills counted quantities with the expected number (WH-18)", async () => {
    renderWithProviders(<CycleCountsPage />, { role: "finance" });
    await screen.findByText(/count sheet/i);

    // Inputs start EMPTY; expected shows as a placeholder reference only.
    const shirtInput = screen.getByLabelText(/Counted Event Shirt \(L\)/i);
    expect(shirtInput).toHaveValue(null);
    expect(shirtInput).toHaveAttribute(
      "placeholder",
      expect.stringMatching(/^Exp\./),
    );

    // No fake "balanced" state and no submit before a real entry.
    expect(screen.queryByText("balanced")).not.toBeInTheDocument();
    expect(screen.getByText("not started")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /submit count/i }),
    ).toBeDisabled();
  });

  it("flags variances once a real value is entered", async () => {
    const user = userEvent.setup();
    renderWithProviders(<CycleCountsPage />, { role: "finance" });
    await screen.findByText(/count sheet/i);

    const shirtInput = screen.getByLabelText(/Counted Event Shirt \(L\)/i);
    await user.type(shirtInput, "100");

    // shirt-l expected 120 -> counted 100 -> variance -20 (desktop + mobile).
    expect((await screen.findAllByText("-20")).length).toBeGreaterThan(0);
    expect(screen.getByText(/variance\(s\)/i)).toBeInTheDocument();
  });

  it('shows "balanced" only after a matching entry', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CycleCountsPage />, { role: "finance" });
    await screen.findByText(/count sheet/i);

    const shirtInput = screen.getByLabelText(/Counted Event Shirt \(L\)/i);
    await user.type(shirtInput, "120"); // matches expected
    expect(screen.getByText("balanced")).toBeInTheDocument();
    expect((await screen.findAllByText("±0")).length).toBeGreaterThan(0);
  });

  it("blind count blanks expected values and records only entered rows", async () => {
    const user = userEvent.setup();
    renderWithProviders(<CycleCountsPage />, { role: "finance" });
    await screen.findByText(/count sheet/i);

    await user.click(screen.getByRole("button", { name: /blind count/i }));
    const shirt = screen.getByLabelText(/Counted Event Shirt \(L\)/i);
    expect(shirt).toHaveValue(null);
    expect(
      screen.getByRole("button", { name: /submit count/i }),
    ).toBeDisabled();

    await user.type(shirt, "100");
    expect(screen.getByText(/1\/9 counted/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /submit count/i })).toBeEnabled();
  });

  it("asks for confirmation when rows are left uncounted, then routes variances for approval", async () => {
    const user = userEvent.setup();
    renderWithProviders(<CycleCountsPage />, { role: "finance" });
    await screen.findByText(/count sheet/i);

    await user.type(screen.getByLabelText(/Counted Event Shirt \(L\)/i), "100");
    await user.click(screen.getByRole("button", { name: /submit count/i }));

    // 8 of 9 rows untouched → explicit confirmation before recording.
    const confirm = await screen.findByRole("alertdialog", {
      name: /confirm uncounted rows/i,
    });
    expect(confirm).toHaveTextContent(/8 rows not counted/i);

    await user.click(screen.getByRole("button", { name: /submit anyway/i }));
    await waitFor(() =>
      expect(
        screen.getByText(/awaiting warehouse supervisor/i),
      ).toBeInTheDocument(),
    );
  });

  it("routes a blind-count variance for supervisor approval", async () => {
    const user = userEvent.setup();
    renderWithProviders(<CycleCountsPage />, { role: "finance" });
    await screen.findByText(/count sheet/i);

    await user.click(screen.getByRole("button", { name: /blind count/i }));
    await user.type(screen.getByLabelText(/Counted Event Shirt \(L\)/i), "100");
    await user.click(screen.getByRole("button", { name: /submit count/i }));
    await waitFor(() =>
      expect(
        screen.getByText(/awaiting warehouse supervisor/i),
      ).toBeInTheDocument(),
    );
  });

  it("counts serialized devices by presence and blocks unexpected serials", async () => {
    const user = userEvent.setup();
    renderWithProviders(<CycleCountsPage />, { role: "finance" });
    await screen.findByText(/count sheet/i);
    await user.selectOptions(screen.getByLabelText("Category"), "device");

    const serials = screen.getByLabelText(
      /Scanned serials ECG Ring \(Size 6\)/i,
    );
    await user.type(serials, "NOT-IN-THIS-BIN");
    expect(await screen.findByText(/unexpected serial/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /submit count/i }),
    ).toBeDisabled();

    await user.clear(serials);
    await user.type(serials, "ECG-RING-6-SN0003");
    expect(await screen.findByText(/1 missing/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /submit count/i })).toBeEnabled();
  }, 10_000);

  it("adds an eligible device to the count through the shared scanner", async () => {
    const user = userEvent.setup();
    renderWithProviders(<CycleCountsPage />, { role: "finance" });
    await screen.findByText(/count sheet/i);
    await user.selectOptions(screen.getByLabelText("Category"), "device");

    const manual = screen.getByLabelText("Enter barcode manually");
    await user.type(manual, "ECG-RING-6-SN0003");
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      /scan accepted/i,
    );
    expect(
      screen.getByLabelText(/Scanned serials ECG Ring \(Size 6\)/i),
    ).toHaveValue("ECG-RING-6-SN0003");
  });
});
