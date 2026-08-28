import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AllocationReservationSheet } from "./AllocationReservationSheet";
import { makeRepo, renderWithProviders } from "@/test/renderWithProviders";

async function draft() {
  const user = userEvent.setup();
  const dialog = await screen.findByRole("dialog", { name: "New reservation" });
  await user.selectOptions(within(dialog).getByLabelText("Product"), "shirt-l");
  await user.click(within(dialog).getByRole("button", { name: "Add product" }));
  await user.selectOptions(
    within(dialog).getAllByLabelText("Product")[1]!,
    "doctor-token",
  );
  await user.selectOptions(
    within(dialog).getAllByLabelText("Purpose")[1]!,
    "giveaway",
  );
  return { user, dialog };
}

describe("AllocationReservationSheet recovery", () => {
  it("focuses the footer alert beside Reserve for repeated multi-line over-stock submissions", async () => {
    const repo = makeRepo();
    const reserve = vi.spyOn(repo, "reserveBatch");
    renderWithProviders(<AllocationReservationSheet onClose={vi.fn()} />, { repo });
    const { user, dialog } = await draft();
    fireEvent.change(within(dialog).getAllByLabelText("Quantity")[0]!, { target: { value: "99999" } });
    const commit = within(dialog).getByRole("button", { name: "Reserve" });
    for (let attempt = 0; attempt < 2; attempt++) {
      await user.click(commit);
      const alert = await within(dialog).findByRole("alert");
      expect(alert).toHaveTextContent(/99999/);
      expect(alert).toHaveFocus();
      expect(alert.parentElement).toContainElement(commit);
    }
    expect(reserve).not.toHaveBeenCalled();
  });

  it.each(["in flight", "unknown"])("does not overwrite a newer tab's command when the old command is %s", async (state) => {
    const repo = makeRepo();
    const original = repo.reserveBatch.bind(repo);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const reserve = vi.spyOn(repo, "reserveBatch").mockImplementationOnce(async (input) => {
      if (state === "unknown") throw new Error("Response lost");
      await gate;
      return original(input);
    });
    const onClose = vi.fn();
    renderWithProviders(<AllocationReservationSheet onClose={onClose} />, { repo });
    const { user, dialog } = await draft();
    await user.click(within(dialog).getByRole("button", { name: "Reserve" }));
    await waitFor(() => expect(reserve).toHaveBeenCalledTimes(1));
    const key = Object.keys(localStorage).find((key) => key.startsWith("warehouse.reservation.v1:"))!;
    const newer = JSON.stringify({ ...JSON.parse(localStorage.getItem(key)!), idempotencyKey: "reservation-newer-tab-0001" });
    localStorage.setItem(key, newer);
    if (state === "unknown") {
      await user.click(await within(dialog).findByRole("button", { name: "Recover reservation" }));
      expect(reserve).toHaveBeenCalledTimes(1);
    } else {
      await act(async () => { release(); });
      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    }
    expect(localStorage.getItem(key)).toBe(newer);
  });

  it.each([true, false])(
    "replays the original immutable command after response loss (committed=%s), including remount",
    async (committed) => {
      const repo = makeRepo();
      const original = repo.reserveBatch.bind(repo);
      const before = await repo.getData();
      const reserve = vi
        .spyOn(repo, "reserveBatch")
        .mockImplementationOnce(async (input) => {
          if (committed) await original(input);
          throw new Error("Connection lost");
        });
      const onClose = vi.fn();
      const view = renderWithProviders(
        <AllocationReservationSheet onClose={onClose} />,
        { repo, role: "warehouse_operator" },
      );
      const { user, dialog } = await draft();
      await user.click(within(dialog).getByRole("button", { name: "Reserve" }));
      expect(await within(dialog).findByRole("alert")).toHaveTextContent(
        /not confirmed/i,
      );
      expect(within(dialog).getAllByLabelText("Quantity")[0]).toBeDisabled();
      expect(
        within(dialog).getByRole("button", { name: "Add product" }),
      ).toBeDisabled();
      expect(within(dialog).getAllByLabelText("Product")).toHaveLength(2);
      const savedCommand = reserve.mock.calls[0]![0];
      view.unmount();
      renderWithProviders(
        <AllocationReservationSheet
          selectedEventId="evt-cebu"
          onClose={onClose}
        />,
        { repo, role: "warehouse_operator" },
      );
      const recovered = await screen.findByRole("dialog");
      expect(within(recovered).getByLabelText("Event")).toHaveValue(
        savedCommand.eventId,
      );
      expect(within(recovered).getAllByLabelText("Product")[0]).toHaveValue(
        "shirt-l",
      );
      await user.click(
        within(recovered).getByRole("button", { name: "Recover reservation" }),
      );
      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
      expect(reserve.mock.calls[1]![0]).toEqual(savedCommand);
      expect((await repo.getData()).allocations).toHaveLength(
        before.allocations.length + 2,
      );
      expect(
        Object.keys(window.localStorage).filter((key) =>
          key.startsWith("warehouse.reservation.v1:"),
        ),
      ).toHaveLength(0);
    },
  );

  it("allows an edited fresh intent only after a confirmed atomic rejection", async () => {
    const repo = makeRepo();
    const reserve = vi
      .spyOn(repo, "reserveBatch")
      .mockResolvedValueOnce({ status: "rejected", error: "Stock changed." });
    const onClose = vi.fn();
    renderWithProviders(<AllocationReservationSheet onClose={onClose} />, {
      repo,
      role: "marketing",
    });
    const { user, dialog } = await draft();
    await user.click(within(dialog).getByRole("button", { name: "Reserve" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      /nothing was reserved/i,
    );
    const quantity = within(dialog).getAllByLabelText("Quantity")[0]!;
    expect(quantity).toBeEnabled();
    fireEvent.change(quantity, { target: { value: "2" } });
    await user.click(within(dialog).getByRole("button", { name: "Reserve" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(reserve.mock.calls[0]![0].idempotencyKey).not.toBe(
      reserve.mock.calls[1]![0].idempotencyKey,
    );
    expect(reserve.mock.calls[1]![0].lines[0]!.quantity).toBe(2);
  });

  it("does not dispatch without durable recovery storage", async () => {
    const repo = makeRepo();
    const reserve = vi.spyOn(repo, "reserveBatch");
    renderWithProviders(<AllocationReservationSheet onClose={vi.fn()} />, {
      repo,
      role: "warehouse_operator",
    });
    const { user, dialog } = await draft();
    const storage = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("Storage unavailable");
      });
    try {
      await user.click(within(dialog).getByRole("button", { name: "Reserve" }));
      expect(await within(dialog).findByRole("alert")).toHaveTextContent(
        /storage unavailable/i,
      );
      expect(reserve).not.toHaveBeenCalled();
    } finally {
      storage.mockRestore();
    }
  });

  it("does not recover another user's pending intent", async () => {
    const repo = makeRepo();
    vi.spyOn(repo, "reserveBatch").mockRejectedValueOnce(
      new Error("Response lost"),
    );
    const view = renderWithProviders(
      <AllocationReservationSheet onClose={vi.fn()} />,
      { repo, role: "warehouse_operator" },
    );
    const { user, dialog } = await draft();
    await user.click(within(dialog).getByRole("button", { name: "Reserve" }));
    await within(dialog).findByRole("alert");
    view.unmount();
    renderWithProviders(<AllocationReservationSheet onClose={vi.fn()} />, {
      repo,
      role: "marketing",
    });
    const fresh = await screen.findByRole("dialog");
    expect(
      within(fresh).queryByRole("button", { name: "Recover reservation" }),
    ).not.toBeInTheDocument();
    expect(within(fresh).getByLabelText("Product")).toHaveValue("");
  });
});
