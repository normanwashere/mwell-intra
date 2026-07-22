import { describe, expect, it, vi } from "vitest";
import {
  acceptPendingVendorInvitation,
  hasVendorInvitationLinkEvidence,
  readPendingVendorInvitation,
  readVendorInvitationEvidence,
} from "./vendorInviteAuthority";

describe("vendor invitation authority client", () => {
  it("reads only a complete positive pending invitation generation", () => {
    expect(
      readPendingVendorInvitation({
        pending_vendor_invite: { invite_id: "inv-1", link_generation: 3 },
      }),
    ).toEqual({ inviteId: "inv-1", linkGeneration: 3 });
    expect(
      readPendingVendorInvitation({
        pending_vendor_invite: { invite_id: "inv-1", link_generation: 0 },
      }),
    ).toBeNull();
    expect(
      readPendingVendorInvitation({ pending_vendor_invite: "inv-1" }),
    ).toBeNull();
  });

  it("requires link-bound evidence that matches the pending generation", () => {
    const pending = { inviteId: "inv-1", linkGeneration: 3 };
    const token = "a".repeat(64);
    expect(
      readVendorInvitationEvidence(
        `?invite_id=inv-1&generation=3&acceptance_token=${token}`,
        pending,
      ),
    ).toEqual({
      ...pending,
      acceptanceToken: token,
    });
    expect(
      readVendorInvitationEvidence(
        `?invite_id=inv-1&generation=2&acceptance_token=${token}`,
        pending,
      ),
    ).toBeNull();
    expect(
      readVendorInvitationEvidence("?invite_id=inv-1&generation=3", pending),
    ).toBeNull();
  });

  it("distinguishes an invitation link from an ordinary vendor route visit", () => {
    const token = "a".repeat(64);
    expect(hasVendorInvitationLinkEvidence("")).toBe(false);
    expect(
      hasVendorInvitationLinkEvidence("?invite_id=inv-1&generation=3"),
    ).toBe(false);
    expect(
      hasVendorInvitationLinkEvidence(
        `?invite_id=inv-1&generation=3&acceptance_token=${token}`,
      ),
    ).toBe(true);
  });

  it("accepts the exact pending generation and refreshes trusted claims", async () => {
    const token = "b".repeat(64);
    const getUser = vi.fn(async () => ({
      data: {
        user: {
          app_metadata: {
            pending_vendor_invite: { invite_id: "inv-1", link_generation: 4 },
          },
        },
      },
      error: null,
    }));
    const refreshSession = vi.fn(async () => ({
      data: { session: {} },
      error: null,
    }));
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            accepted: true,
            invite_id: "inv-1",
            case_id: "case-1",
            vendor_id: "vendor-1",
            link_generation: 4,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );

    await expect(
      acceptPendingVendorInvitation({
        client: { auth: { getUser, refreshSession } },
        fetcher,
        locationSearch: `?invite_id=inv-1&generation=4&acceptance_token=${token}`,
      }),
    ).resolves.toMatchObject({ accepted: true, caseId: "case-1" });

    expect(fetcher).toHaveBeenCalledWith(
      "/api/legal/vendor-invites",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          action: "accept",
          invite_id: "inv-1",
          expected_generation: 4,
          acceptance_token: token,
        }),
      }),
    );
    expect(refreshSession).toHaveBeenCalledOnce();
  });

  it("surfaces expired, superseded, and replayed rejection messages", async () => {
    const token = "c".repeat(64);
    const client = {
      auth: {
        getUser: vi.fn(async () => ({
          data: {
            user: {
              app_metadata: {
                pending_vendor_invite: {
                  invite_id: "inv-1",
                  link_generation: 2,
                },
              },
            },
          },
          error: null,
        })),
        refreshSession: vi.fn(),
      },
    };
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: "This invitation has expired.",
            rejection_code: "expired",
          }),
          { status: 409, headers: { "content-type": "application/json" } },
        ),
    );

    await expect(
      acceptPendingVendorInvitation({
        client,
        fetcher,
        locationSearch: `?invite_id=inv-1&generation=2&acceptance_token=${token}`,
      }),
    ).rejects.toThrow("This invitation has expired.");
    expect(client.auth.refreshSession).not.toHaveBeenCalled();
  });

  it("does not call acceptance without opaque link evidence", async () => {
    const client = {
      auth: {
        getUser: vi.fn(async () => ({
          data: {
            user: {
              app_metadata: {
                pending_vendor_invite: {
                  invite_id: "inv-1",
                  link_generation: 2,
                },
              },
            },
          },
          error: null,
        })),
        refreshSession: vi.fn(),
      },
    };
    const fetcher = vi.fn();
    await expect(
      acceptPendingVendorInvitation({
        client,
        fetcher,
        locationSearch: "",
      }),
    ).resolves.toEqual({ accepted: false });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
