import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ExternalPOEvidence,
  uploadExternalPOEvidence,
} from "./ExternalPOEvidence";

const mocks = vi.hoisted(() => ({
  upload: vi.fn(),
  createSignedUrl: vi.fn(),
  from: vi.fn(),
  mode: "supabase",
}));
const profileId = "11111111-1111-4111-8111-111111111111";
const storageClient = { storage: { from: mocks.from } };
vi.mock("@/auth/session", () => ({
  useSession: () => ({
    mode: mocks.mode,
    profile: { id: profileId },
    supabaseClient: storageClient,
  }),
}));
const session = () =>
  ({
    mode: mocks.mode,
    profile: { id: profileId },
    supabaseClient: { storage: { from: mocks.from } },
  }) as unknown as Parameters<typeof uploadExternalPOEvidence>[1];
const pdf = () =>
  new File(["%PDF-1.7\nbody\n%%EOF"], "email.html.pdf", {
    type: "application/pdf",
  });
const path = `warehouse-po-evidence/${profileId}/22222222-2222-4222-8222-222222222222/document.pdf`;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.mode = "supabase";
  mocks.from.mockReturnValue({
    upload: mocks.upload,
    createSignedUrl: mocks.createSignedUrl,
  });
  mocks.upload.mockResolvedValue({ error: null });
  mocks.createSignedUrl.mockResolvedValue({
    data: { signedUrl: "https://storage.example/signed/document.pdf" },
    error: null,
  });
});

describe("private PO documents", () => {
  it("uploads PDF to the dedicated bucket with an opaque non-upsert path", async () => {
    const stored = await uploadExternalPOEvidence(pdf(), session());
    expect(stored).toMatch(
      new RegExp(
        `^warehouse-po-evidence/${profileId}/[a-f0-9-]+/document\\.pdf$`,
      ),
    );
    expect(mocks.from).toHaveBeenCalledWith("warehouse-po-evidence");
    expect(mocks.upload).toHaveBeenCalledWith(
      stored.replace("warehouse-po-evidence/", ""),
      expect.any(Uint8Array),
      { contentType: "application/pdf", upsert: false },
    );
    expect(stored).not.toContain("email");
  });
  it.each(["image/svg+xml", "text/html", "message/rfc822", "image/gif"])(
    "rejects %s before upload",
    async (type) => {
      await expect(
        uploadExternalPOEvidence(
          new File(["<svg/>"], "evidence", { type }),
          session(),
        ),
      ).rejects.toThrow(/PDF, PNG, JPEG or WebP/);
      expect(mocks.upload).not.toHaveBeenCalled();
    },
  );
  it("checks signatures, size, and live authentication", async () => {
    await expect(
      uploadExternalPOEvidence(
        new File(["<html>"], "fake.pdf", { type: "application/pdf" }),
        session(),
      ),
    ).rejects.toThrow(/signature/i);
    const oversized = pdf();
    Object.defineProperty(oversized, "size", { value: 8 * 1024 * 1024 + 1 });
    await expect(
      uploadExternalPOEvidence(oversized, session()),
    ).rejects.toThrow(/8 MiB/);
    mocks.mode = "memory";
    await expect(uploadExternalPOEvidence(pdf(), session())).rejects.toThrow(
      /signed-in/i,
    );
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it.each([
    ["image/png", [137, 80, 78, 71, 13, 10, 26, 10]],
    ["image/jpeg", [255, 216, 255, 224]],
    ["image/webp", [82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80]],
  ] as const)(
    "accepts the %s signature and rejects a disguised HTML document",
    async (type, signature) => {
      await expect(
        uploadExternalPOEvidence(
          new File([new Uint8Array(signature)], "photo", { type }),
          session(),
        ),
      ).resolves.toMatch(/^warehouse-po-evidence\//);
      mocks.upload.mockClear();
      await expect(
        uploadExternalPOEvidence(
          new File(["<html>"], "photo", { type }),
          session(),
        ),
      ).rejects.toThrow(/signature/i);
      expect(mocks.upload).not.toHaveBeenCalled();
    },
  );
  it("does not attach a late upload to an unmounted record", async () => {
    let resolve!: (value: unknown) => void;
    mocks.upload.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const onChange = vi.fn();
    const view = render(<ExternalPOEvidence value={[]} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Attach PO documents"), {
      target: { files: [pdf()] },
    });
    await waitFor(() => expect(mocks.upload).toHaveBeenCalledOnce());
    view.unmount();
    resolve({ error: null });
    await Promise.resolve();
    expect(onChange).not.toHaveBeenCalled();
  });
  it("uses signed links for PDFs and never renders arbitrary URLs or HTML", async () => {
    render(
      <ExternalPOEvidence value={[path, "https://evil.example/doc.html"]} />,
    );
    expect(
      await screen.findByRole("link", { name: "Open PO document 1 (PDF)" }),
    ).toHaveAttribute("href", "https://storage.example/signed/document.pdf");
    expect(mocks.createSignedUrl).toHaveBeenCalledExactlyOnceWith(
      path.replace("warehouse-po-evidence/", ""),
      300,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Document unavailable");
    expect(document.querySelector("iframe,object,embed")).toBeNull();
  });
  it("disables uploads while pending and reports storage errors without fake attachments", async () => {
    let resolve!: (value: unknown) => void;
    mocks.upload.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const onChange = vi.fn();
    render(<ExternalPOEvidence value={[]} onChange={onChange} />);
    const input = screen.getByLabelText("Attach PO documents");
    fireEvent.change(input, { target: { files: [pdf()] } });
    await waitFor(() => expect(input).toBeDisabled());
    resolve({ error: { message: "Storage unavailable" } });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Storage unavailable",
    );
    expect(onChange).not.toHaveBeenCalled();
    await waitFor(() => expect(input).toBeEnabled());
  });
});
