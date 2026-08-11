import { useRef, useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { DataTable, Modal, Sheet } from "@intra/ui";

function SheetHarness() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open stock editor
      </button>
      <a href="#outside">Outside destination</a>
      <Sheet open={open} onOpenChange={setOpen} title="Edit stock">
        <label htmlFor="stock-reference">Reference</label>
        <input id="stock-reference" />
        <button type="button">Save stock</button>
      </Sheet>
    </>
  );
}

function ModalHarness() {
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open command palette
      </button>
      <a href="#outside">Outside destination</a>
      <Modal
        open={open}
        onOpenChange={setOpen}
        title="Command palette"
        initialFocusRef={inputRef}
      >
        <input ref={inputRef} aria-label="Search commands" />
        <button type="button">Run command</button>
      </Modal>
    </>
  );
}

describe("shared dialog accessibility", () => {
  it("keeps Sheet focus inside and restores it after Escape", async () => {
    const user = userEvent.setup();
    render(<SheetHarness />);
    const opener = screen.getByRole("button", { name: "Open stock editor" });

    await user.click(opener);
    const dialog = await screen.findByRole("dialog", { name: "Edit stock" });
    expect((await axe(dialog)).violations).toHaveLength(0);
    expect(dialog.className).toContain("max-h-[92dvh]");
    expect(dialog.className).toContain("inset-x-0");
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByLabelText("Reference")),
    );

    for (let index = 0; index < 6; index += 1) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Edit stock" })).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("contains Modal focus and restores the opener after its close button", async () => {
    const user = userEvent.setup();
    render(<ModalHarness />);
    const opener = screen.getByRole("button", { name: "Open command palette" });

    await user.click(opener);
    const dialog = await screen.findByRole("dialog", {
      name: "Command palette",
    });
    expect((await axe(dialog)).violations).toHaveLength(0);
    expect(dialog.className).toContain("w-[min(calc(100vw-2rem),32rem)]");
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("textbox", { name: "Search commands" }),
      ),
    );

    for (let index = 0; index < 6; index += 1) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }

    await user.click(
      screen.getByRole("button", { name: "Close Command palette" }),
    );
    expect(
      screen.queryByRole("dialog", { name: "Command palette" }),
    ).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("keeps DataTable row actions keyboard reachable without nested interactive controls", async () => {
    const { container } = render(
      <DataTable
        ariaLabel="Vendor records"
        columns={[
          {
            key: "name",
            header: "Vendor",
            primary: true,
            render: (row: { id: string; name: string }) => (
              <a href={`/vendor/${row.id}`}>{row.name}</a>
            ),
          },
        ]}
        rows={[{ id: "vendor-1", name: "Example vendor" }]}
        keyOf={(row) => row.id}
        onRowClick={() => undefined}
        rowActionLabel={(row) => `Open ${row.name}`}
      />,
    );

    expect(
      (await axe(container)).violations.filter(
        (item) => item.id === "nested-interactive",
      ),
    ).toHaveLength(0);
    for (const action of screen.getAllByRole("button", {
      name: "Open Example vendor",
    })) {
      expect(action.className).toContain("min-h-11");
      expect(action.className).toContain("min-w-11");
    }
  });
});
