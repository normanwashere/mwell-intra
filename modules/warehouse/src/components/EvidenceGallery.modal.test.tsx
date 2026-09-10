import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { Sheet } from "@intra/ui";
import { EvidenceGallery } from "./EvidenceGallery";

vi.mock("@intra/auth", () => ({
  useSession: () => ({ mode: "memory", supabaseClient: null, profile: null }),
}));

function SheetEvidence({ size }: { size: "grid" | "thumb" }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Order details</button>
      <Sheet open={open} onOpenChange={setOpen} title="Order evidence">
        <EvidenceGallery urls={["data:image/png;base64,eA=="]} size={size} />
        <button>Other order action</button>
      </Sheet>
    </>
  );
}

describe("EvidenceGallery nested modal", () => {
  it.each(["grid", "thumb"] as const)(
    "keeps %s preview interactive, focus-contained and independently dismissible inside Sheet",
    async (size) => {
      const user = userEvent.setup();
      render(<SheetEvidence size={size} />);
      const opener = screen.getByRole("button", { name: "Order details" });
      await user.click(opener);
      const sheet = await screen.findByRole("dialog", {
        name: "Order evidence",
      });
      await within(sheet).findByRole("img", { name: "Evidence" });
      const trigger = within(sheet).getByRole("button", {
        name: /view.*evidence photo/i,
      });

      for (const dismissal of ["close", "escape", "backdrop"] as const) {
        await user.click(trigger);
        const preview = await screen.findByRole("dialog", {
          name: "Evidence photo",
        });
        const close = within(preview).getByRole("button", { name: "Close" });
        await waitFor(() => expect(close).toHaveFocus());
        expect((await axe(preview)).violations).toHaveLength(0);
        expect(
          screen.queryByRole("button", { name: "Other order action" }),
        ).not.toBeInTheDocument();
        await user.tab();
        expect(close).toHaveFocus();
        await user.tab({ shift: true });
        expect(close).toHaveFocus();
        await user.click(within(preview).getByRole("img"));
        expect(preview).toBeVisible();
        if (dismissal === "close") await user.click(close);
        else if (dismissal === "escape") await user.keyboard("{Escape}");
        else
          await user.click(
            within(preview).getByTestId("evidence-lightbox-backdrop"),
          );
        await waitFor(() =>
          expect(
            screen.queryByRole("dialog", { name: "Evidence photo" }),
          ).not.toBeInTheDocument(),
        );
        expect(sheet).toBeVisible();
        await waitFor(() => expect(trigger).toHaveFocus());
      }
      await user.keyboard("{Escape}");
      await waitFor(() => expect(sheet).not.toBeInTheDocument());
      await waitFor(() => expect(opener).toHaveFocus());
      expect(document.body.style.pointerEvents).not.toBe("none");
    },
  );
});
