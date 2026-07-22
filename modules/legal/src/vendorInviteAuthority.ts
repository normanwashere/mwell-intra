interface PendingVendorInvitation {
  inviteId: string;
  linkGeneration: number;
}

interface VendorInvitationEvidence extends PendingVendorInvitation {
  acceptanceToken: string;
}

interface AuthUserResult {
  data: { user: { app_metadata?: Record<string, unknown> } | null };
  error: { message: string } | null;
}

interface RefreshSessionResult {
  data: { session: unknown | null };
  error: { message: string } | null;
}

export interface VendorInviteAuthorityClient {
  auth: {
    getUser(): Promise<AuthUserResult>;
    refreshSession(): Promise<RefreshSessionResult>;
  };
}

interface AcceptanceResponse {
  accepted?: boolean;
  invite_id?: string;
  case_id?: string;
  vendor_id?: string;
  link_generation?: number;
  error?: string;
  rejection_code?: string;
}

export interface VendorInvitationAcceptance {
  accepted: boolean;
  caseId?: string;
  inviteId?: string;
  vendorId?: string;
  linkGeneration?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function readPendingVendorInvitation(
  appMetadata: Record<string, unknown> | null | undefined,
): PendingVendorInvitation | null {
  const pending = appMetadata?.pending_vendor_invite;
  if (!isRecord(pending)) return null;
  const inviteId = pending.invite_id;
  const linkGeneration = pending.link_generation;
  if (
    typeof inviteId !== "string" ||
    inviteId.length === 0 ||
    typeof linkGeneration !== "number" ||
    !Number.isInteger(linkGeneration) ||
    linkGeneration < 1
  )
    return null;
  return { inviteId, linkGeneration };
}

export function readVendorInvitationEvidence(
  locationSearch: string,
  pending: PendingVendorInvitation,
): VendorInvitationEvidence | null {
  const params = new URLSearchParams(locationSearch);
  const inviteId = params.get("invite_id");
  const linkGeneration = Number(params.get("generation"));
  const acceptanceToken = params.get("acceptance_token");
  if (
    inviteId !== pending.inviteId ||
    linkGeneration !== pending.linkGeneration ||
    !acceptanceToken ||
    acceptanceToken.length < 32
  )
    return null;
  return { inviteId, linkGeneration, acceptanceToken };
}

export function hasVendorInvitationLinkEvidence(
  locationSearch: string,
): boolean {
  const params = new URLSearchParams(locationSearch);
  const inviteId = params.get("invite_id");
  const linkGeneration = Number(params.get("generation"));
  const acceptanceToken = params.get("acceptance_token");
  return Boolean(
    inviteId &&
    Number.isInteger(linkGeneration) &&
    linkGeneration > 0 &&
    acceptanceToken &&
    acceptanceToken.length >= 32,
  );
}

export async function acceptPendingVendorInvitation(options: {
  client: VendorInviteAuthorityClient;
  fetcher?: typeof fetch;
  locationSearch?: string;
}): Promise<VendorInvitationAcceptance> {
  const { data, error: userError } = await options.client.auth.getUser();
  if (userError) throw new Error(userError.message);
  const pending = readPendingVendorInvitation(data.user?.app_metadata);
  if (!pending) return { accepted: false };
  const evidence = readVendorInvitationEvidence(
    options.locationSearch ??
      (typeof window === "undefined" ? "" : window.location.search),
    pending,
  );
  if (!evidence) return { accepted: false };

  const response = await (options.fetcher ?? fetch)(
    "/api/legal/vendor-invites",
    {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "accept",
        invite_id: evidence.inviteId,
        expected_generation: evidence.linkGeneration,
        acceptance_token: evidence.acceptanceToken,
      }),
    },
  );
  const result = (await response
    .json()
    .catch(() => ({}))) as AcceptanceResponse;
  if (!response.ok || result.accepted !== true) {
    throw new Error(
      result.error ?? "This vendor invitation could not be accepted.",
    );
  }

  const { error: refreshError } = await options.client.auth.refreshSession();
  if (refreshError) throw new Error(refreshError.message);
  return {
    accepted: true,
    caseId: result.case_id,
    inviteId: result.invite_id,
    vendorId: result.vendor_id,
    linkGeneration: result.link_generation,
  };
}
