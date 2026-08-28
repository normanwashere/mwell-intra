// Regression coverage for late uploads and inspection evidence ownership.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InspectionSheet } from "@/components/quality/InspectionSheet";
import { renderWithProviders } from "@/test/renderWithProviders";

const { upload } = vi.hoisted(() => ({ upload: vi.fn() }));
vi.mock("@/data/createRepository", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/data/createRepository")>()),
  resolveDataSource: () => "supabase",
}));
vi.mock("@/data/supabase/evidence", () => ({
  uploadEvidence: upload,
  resolveEvidenceUrl: async () => "data:image/png;base64,eA==",
}));

describe("Inspection evidence ownership", () => {
  beforeEach(() => upload.mockReset());
  it("keeps evidence for the same target but prevents submit during an additional upload", async () => {
    const first = { sourceType: "receipt" as const, sourceId: "receipt-A", productId: "shirt-l", productName: "Item A", quantity: 1 };
    let update!: (target: typeof first) => void;
    let complete!: (value: string) => void;
    const pending = new Promise<string>((resolve) => { complete = resolve; });
    upload.mockResolvedValueOnce("receipt-A/a.png").mockReturnValueOnce(pending);
    const submit = vi.fn().mockResolvedValue(true);
    function Harness() {
      const [target, setTarget] = useState(first);
      update = setTarget;
      return <InspectionSheet target={target} requiresEvidence onSubmit={submit} onOpenChange={() => undefined} />;
    }
    renderWithProviders(<Harness />);
    const user = userEvent.setup();
    const input = screen.getByLabelText("Attach inspection evidence", { selector: "input" });
    await user.upload(input, new File(["a"], "a.png", { type: "image/png" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Submit inspection" })).toBeEnabled());
    await act(async () => update({ ...first }));
    expect(screen.getByRole("button", { name: "Submit inspection" })).toBeEnabled();
    await user.upload(input, new File(["b"], "b.png", { type: "image/png" }));
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("button", { name: "Submit inspection" })).toBeDisabled();
    await act(async () => { complete("receipt-A/b.png"); await pending; });
    await user.click(screen.getByRole("button", { name: "Submit inspection" }));
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ sourceId: "receipt-A", evidenceUrls: ["receipt-A/a.png", "receipt-A/b.png"] }));
  });
  it("ignores a completed upload from a previously closed inspection", async () => {
    const first = {
      sourceType: "receipt" as const,
      sourceId: "receipt-A",
      productId: "shirt-l",
      productName: "Item A",
      quantity: 1,
    };
    const second = { ...first, sourceId: "receipt-B", productName: "Item B" };
    const submit = vi.fn().mockResolvedValue(true);
    const close = vi.fn();
    let complete!: (value: string) => void;
    const delayedUpload = new Promise<string>((resolve) => {
      complete = resolve;
    });
    upload.mockImplementationOnce(() => delayedUpload);
    const user = userEvent.setup();
    let changeTarget!: (target: typeof first | null) => void;
    function Harness() {
      const [target, setTarget] = useState<typeof first | null>(first);
      changeTarget = setTarget;
      return (
        <InspectionSheet
          target={target}
          requiresEvidence
          onSubmit={submit}
          onOpenChange={close}
        />
      );
    }
    renderWithProviders(<Harness />);
    await user.upload(
      screen.getByLabelText("Attach inspection evidence", {
        selector: "input",
      }),
      new File(["inspection A"], "inspection-A.png", { type: "image/png" }),
    );
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    await act(async () => changeTarget(null));
    await act(async () => changeTarget(second));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Submit inspection" }),
      ).toBeDisabled(),
    );
    await act(async () => {
      complete("inspection-A/evidence.png");
      await delayedUpload;
    });
    expect(
      screen.getByRole("button", { name: "Submit inspection" }),
    ).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Submit inspection" }));
    expect(submit).not.toHaveBeenCalled();
  });
});
