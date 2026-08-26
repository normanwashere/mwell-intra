import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveEvidenceUrl } from "./evidence";

function signingClient() {
  const createSignedUrl = vi.fn(async (path: string) => ({
    data: { signedUrl: `https://storage.example/${path}?token=signed` },
    error: null,
  }));
  return {
    client: {
      storage: { from: () => ({ createSignedUrl }) },
    } as unknown as SupabaseClient,
    createSignedUrl,
  };
}

describe("resolveEvidenceUrl", () => {
  it("signs plain private Storage object paths", async () => {
    const { client, createSignedUrl } = signingClient();

    await expect(
      resolveEvidenceUrl(client, "fulfillment/order-1/pick/photo.jpg"),
    ).resolves.toBe(
      "https://storage.example/fulfillment/order-1/pick/photo.jpg?token=signed",
    );
    expect(createSignedUrl).toHaveBeenCalledWith(
      "fulfillment/order-1/pick/photo.jpg",
      3600,
    );
  });

  it("allows trusted app evidence and safe HTTPS without signing", async () => {
    const { client, createSignedUrl } = signingClient();

    await expect(
      resolveEvidenceUrl(client, "/uat-evidence/aug24-qc-pending.svg"),
    ).resolves.toBe("/uat-evidence/aug24-qc-pending.svg");
    await expect(
      resolveEvidenceUrl(client, "https://evidence.example/receipt.jpg"),
    ).resolves.toBe("https://evidence.example/receipt.jpg");
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it("rejects insecure and unknown evidence values without a request", async () => {
    const { client, createSignedUrl } = signingClient();

    await expect(
      resolveEvidenceUrl(client, "http://deliverylink.com/not-evidence"),
    ).resolves.toBeNull();
    await expect(resolveEvidenceUrl(client, "not-evidence")).resolves.toBeNull();
    expect(createSignedUrl).not.toHaveBeenCalled();
  });
});
