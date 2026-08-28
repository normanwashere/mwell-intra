// Delayed uploads must reconcile with the current attachment selection.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EvidenceCapture } from "@/components/camera/EvidenceCapture";

const { upload } = vi.hoisted(() => ({ upload: vi.fn() }));
vi.mock("@/data/createRepository", () => ({
  resolveDataSource: () => "supabase",
}));
vi.mock("@/data/supabase/evidence", () => ({
  uploadEvidence: upload,
  resolveEvidenceUrl: async () => "data:image/png;base64,eA==",
}));

describe("Evidence upload races", () => {
  beforeEach(() => upload.mockReset());
  it("keeps a removed photo removed when another upload completes", async () => {
    const onChange = vi.fn();
    let resolveSecond!: (value: string) => void;
    const second = new Promise<string>((resolve) => {
      resolveSecond = resolve;
    });
    upload
      .mockResolvedValueOnce("audit/old.png")
      .mockImplementationOnce(() => second);
    const user = userEvent.setup();
    render(<EvidenceCapture onChange={onChange} />);
    const input = screen.getByLabelText("Capture photo evidence", {
      selector: "input",
    });
    await user.upload(
      input,
      new File(["old"], "old.png", { type: "image/png" }),
    );
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith(["audit/old.png"]),
    );
    await user.upload(
      input,
      new File(["new"], "new.png", { type: "image/png" }),
    );
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(2));
    await user.click(screen.getByRole("button", { name: "Remove photo" }));
    expect(onChange).toHaveBeenLastCalledWith([]);
    await act(async () => {
      resolveSecond("audit/new.png");
      await second;
    });
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith(["audit/new.png"]),
    );
  });

  it("ignores uploads after a record reference changes without unmounting", async () => {
    const onChange = vi.fn();
    const onBusyChange = vi.fn();
    let complete!: (value: string) => void;
    const pending = new Promise<string>((resolve) => {
      complete = resolve;
    });
    upload.mockReturnValueOnce(pending);
    const user = userEvent.setup();
    const view = render(
      <EvidenceCapture
        reference="record-A"
        onChange={onChange}
        onBusyChange={onBusyChange}
      />,
    );
    await user.upload(
      screen.getByLabelText("Capture photo evidence", { selector: "input" }),
      new File(["a"], "a.png", { type: "image/png" }),
    );
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    expect(onBusyChange).toHaveBeenLastCalledWith(true);
    view.rerender(
      <EvidenceCapture
        reference="record-B"
        onChange={onChange}
        onBusyChange={onBusyChange}
      />,
    );
    await act(async () => {
      complete("record-A/photo.png");
      await pending;
    });
    expect(onChange).not.toHaveBeenCalled();
    expect(onBusyChange).toHaveBeenLastCalledWith(false);
  });

  it("retains successful files from a partially failed batch and allows retry", async () => {
    upload
      .mockResolvedValueOnce("audit/a.png")
      .mockRejectedValueOnce(new Error("Upload unavailable"))
      .mockResolvedValueOnce("audit/b.png");
    const onChange = vi.fn();
    const busy = vi.fn();
    const user = userEvent.setup();
    render(<EvidenceCapture onChange={onChange} onBusyChange={busy} />);
    const input = screen.getByLabelText("Capture photo evidence", {
      selector: "input",
    });
    const a = new File(["a"], "a.png", { type: "image/png" });
    const b = new File(["b"], "b.png", { type: "image/png" });
    await user.upload(input, [a, b]);
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith(["audit/a.png"]),
    );
    expect(screen.getByRole("alert")).toHaveTextContent("1 upload(s) failed");
    expect(busy).toHaveBeenLastCalledWith(false);
    await user.upload(input, b);
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith(["audit/a.png", "audit/b.png"]),
    );
  });

  it("does not publish after unmounting", async () => {
    let complete!: (value: string) => void;
    const pending = new Promise<string>((resolve) => {
      complete = resolve;
    });
    upload.mockReturnValueOnce(pending);
    const onChange = vi.fn();
    const user = userEvent.setup();
    const view = render(<EvidenceCapture onChange={onChange} />);
    await user.upload(
      screen.getByLabelText("Capture photo evidence", { selector: "input" }),
      new File(["a"], "a.png", { type: "image/png" }),
    );
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    view.unmount();
    await act(async () => {
      complete("record-A/a.png");
      await pending;
    });
    expect(onChange).not.toHaveBeenCalled();
  });
});
