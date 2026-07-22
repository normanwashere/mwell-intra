import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type User } from "jsr:@supabase/supabase-js@2";

interface InviteBody {
  action?: "dispatch" | "accept";
  invite_id?: string;
  expected_generation?: number;
  acceptance_token?: string;
  idempotency_key?: string;
  email?: string;
  company_name?: string;
  category?: string;
  profile?: Record<string, unknown>;
  origin_country?: string;
  redirect_origin?: string;
}

type JsonRecord = Record<string, unknown>;

function inviteRedirectOrigin(value?: string): string {
  const configured = (Deno.env.get("INVITE_REDIRECT_ORIGINS") ?? "")
    .split(",")
    .map((origin) => origin.trim().replace(/\/$/, ""))
    .filter(Boolean);
  const allowed = new Set([
    "https://mwell-intra.vercel.app",
    "https://mwell-intra-uat.vercel.app",
    ...configured,
  ]);
  try {
    const candidate = new URL(value ?? "");
    const local =
      candidate.protocol === "http:" &&
      ["localhost", "127.0.0.1"].includes(candidate.hostname);
    if (allowed.has(candidate.origin) || local) return candidate.origin;
  } catch {
    // Fall through to the production origin for malformed or absent input.
  }
  return "https://mwell-intra.vercel.app";
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

function rejectionMessage(code: unknown): string {
  switch (code) {
    case "expired":
      return "This invitation has expired. Ask your Mwell contact to send a new invitation.";
    case "superseded":
    case "superseded_generation":
      return "This invitation was replaced by a newer email. Use the latest invitation.";
    case "replayed":
    case "accepted":
      return "This invitation has already been used.";
    case "identity_mismatch":
      return "This invitation belongs to a different signed-in account.";
    case "not_delivered":
      return "This invitation is not ready for acceptance.";
    default:
      return "This vendor invitation could not be accepted.";
  }
}

function metadataRoles(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const roles: Record<string, string[]> = {};
  for (const [module, assigned] of Object.entries(value)) {
    if (Array.isArray(assigned)) {
      roles[module] = assigned.filter(
        (role): role is string => typeof role === "string",
      );
    }
  }
  return roles;
}

Deno.serve(async (request) => {
  if (request.method !== "POST")
    return json({ error: "Method not allowed." }, 405);
  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const authorization = request.headers.get("authorization");
  if (!url || !anon || !service || !authorization) {
    return json({ error: "Invitation service is not configured." }, 503);
  }

  const userClient = createClient(url, anon, {
    global: { headers: { authorization } },
    db: { schema: "legal" },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const accessToken = authorization.replace(/^Bearer\s+/i, "");
  const verifiedResponse = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: anon, authorization: `Bearer ${accessToken}` },
  });
  const verifiedUser = verifiedResponse.ok
    ? ((await verifiedResponse.json()) as User)
    : null;
  if (!verifiedUser) return json({ error: "Authentication required." }, 401);

  const body = (await request.json().catch(() => null)) as InviteBody | null;
  const admin = createClient(url, service, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  if (body?.action === "accept") {
    if (
      !body.invite_id ||
      !Number.isInteger(body.expected_generation) ||
      Number(body.expected_generation) < 1 ||
      !body.acceptance_token ||
      body.acceptance_token.length < 32
    ) {
      return json(
        {
          error:
            "invite_id, expected_generation, and acceptance_token are required.",
        },
        400,
      );
    }
    const { data, error } = await userClient.rpc(
      "accept_current_vendor_invite",
      {
        payload: {
          invite_id: body.invite_id,
          expected_generation: body.expected_generation,
          acceptance_token: body.acceptance_token,
        },
      },
    );
    if (error) return json({ error: error.message }, 403);
    const acceptance = (data ?? {}) as JsonRecord;
    if (acceptance.accepted !== true) {
      return json(
        {
          ...acceptance,
          error: rejectionMessage(acceptance.rejection_code),
        },
        409,
      );
    }

    const currentMetadata = (verifiedUser.app_metadata ?? {}) as JsonRecord;
    const currentRoles = metadataRoles(currentMetadata.roles);
    const coreRoles = [
      ...new Set([...(currentRoles.core ?? []), "vendor_portal"]),
    ];
    const { pending_vendor_invite: _pending, ...metadataWithoutPending } =
      currentMetadata;
    const { error: metadataError } = await admin.auth.admin.updateUserById(
      verifiedUser.id,
      {
        app_metadata: {
          ...metadataWithoutPending,
          kind: "vendor",
          vendor_id: acceptance.vendor_id,
          roles: { ...currentRoles, core: coreRoles },
        },
      },
    );
    if (metadataError) {
      await admin.schema("legal").rpc("rollback_vendor_invite_acceptance", {
        payload: {
          invite_id: acceptance.invite_id,
          acceptance_nonce: acceptance.acceptance_nonce,
        },
      });
      return json(
        {
          error:
            "Vendor access could not be activated. Please try the invitation again.",
        },
        502,
      );
    }
    return json(acceptance, 200);
  }

  let email = body?.email?.trim().toLowerCase();
  let companyName = body?.company_name?.trim();
  let invite: JsonRecord;

  if (body?.invite_id) {
    const { data: existing, error } = await userClient
      .from("vendor_invites")
      .select("*")
      .eq("id", body.invite_id)
      .single();
    if (error || !existing)
      return json({ error: error?.message ?? "Vendor invite not found." }, 404);
    email = existing.email?.trim().toLowerCase();
    companyName = existing.company_name?.trim();
    invite = {
      invite: existing,
      case: { id: existing.case_id },
      vendor: { id: existing.vendor_id },
    };
  } else {
    if (!email || !/^\S+@\S+\.\S+$/.test(email))
      return json({ error: "A valid vendor email is required." }, 400);
    if (!companyName) return json({ error: "Company name is required." }, 400);
    if (
      !body?.idempotency_key ||
      !/^[A-Za-z0-9_-]{12,128}$/.test(body.idempotency_key)
    ) {
      return json({ error: "A valid idempotency key is required." }, 400);
    }
    const { data: existingProfile, error: profileError } = await admin
      .schema("core")
      .from("profiles")
      .select("kind,status")
      .eq("email", email)
      .maybeSingle();
    if (profileError) return json({ error: profileError.message }, 502);
    if (
      existingProfile?.kind === "employee" ||
      existingProfile?.status === "active"
    ) {
      return json(
        {
          error:
            "This email already belongs to an active account and cannot receive this vendor invitation.",
        },
        409,
      );
    }
    const { data, error } = await userClient.rpc("invite_vendor", {
      payload: {
        email,
        company_name: companyName,
        category: body?.category,
        actor: verifiedUser.email,
        profile: body?.profile,
        origin_country: body?.origin_country,
        idempotency_key: body?.idempotency_key,
      },
    });
    if (error) return json({ error: error.message }, 403);
    invite = data as JsonRecord;
  }

  if (!email || !companyName)
    return json({ error: "Vendor invite is missing delivery details." }, 422);
  const inviteRow = (invite.invite ?? invite) as JsonRecord;
  const inviteId = typeof inviteRow.id === "string" ? inviteRow.id : null;
  if (!inviteId)
    return json({ error: "Invitation service returned no invite id." }, 502);

  const { data: prepared, error: prepareError } = await admin
    .schema("legal")
    .rpc("prepare_vendor_invite_delivery", {
      payload: {
        invite_id: inviteId,
        ...(body?.invite_id
          ? {}
          : {
              creation_idempotency_key: body?.idempotency_key,
              actor_id: verifiedUser.id,
            }),
      },
    });
  if (prepareError) return json({ error: prepareError.message }, 502);
  const preparedInvite = (prepared ?? {}) as JsonRecord;
  if (preparedInvite.prepared !== true) {
    if (preparedInvite.rejection_code === "already_claimed") {
      const status = preparedInvite.status;
      const deliveryStatus =
        status === "delivery_failed"
          ? "delivery_failed"
          : status === "pending_delivery"
            ? "pending_delivery"
            : "sent";
      return json(
        {
          ...invite,
          invite: preparedInvite,
          delivery_status: deliveryStatus,
          idempotent_replay: true,
        },
        deliveryStatus === "sent" ? 200 : 202,
      );
    }
    return json(
      {
        error: rejectionMessage(preparedInvite.rejection_code),
        rejection_code: preparedInvite.rejection_code,
      },
      409,
    );
  }
  const expectedGeneration = Number(preparedInvite.link_generation);
  if (!Number.isInteger(expectedGeneration) || expectedGeneration < 1) {
    return json({ error: "Invitation generation was not prepared." }, 502);
  }
  if (typeof preparedInvite.expires_at !== "string") {
    return json({ error: "Invitation expiry policy was not applied." }, 502);
  }
  if (typeof preparedInvite.acceptance_token !== "string") {
    return json(
      { error: "Invitation acceptance evidence was not prepared." },
      502,
    );
  }

  const markDelivery = async (payload: JsonRecord): Promise<JsonRecord> => {
    const { data, error } = await admin
      .schema("legal")
      .rpc("finalize_vendor_invite_delivery", { payload });
    if (error) throw error;
    return (data ?? {}) as JsonRecord;
  };

  let authUser: User | null = null;
  try {
    for (let page = 1; page <= 20 && !authUser; page += 1) {
      const { data, error } = await admin.auth.admin.listUsers({
        page,
        perPage: 1000,
      });
      if (error) throw error;
      authUser =
        data.users.find(
          (candidate) => candidate.email?.toLowerCase() === email,
        ) ?? null;
      if (data.users.length < 1000) break;
    }

    const vendorQuery = new URLSearchParams({
      invite_id: inviteId,
      generation: String(expectedGeneration),
      acceptance_token: preparedInvite.acceptance_token,
    });
    const redirectQuery = new URLSearchParams({
      next: `/vendor?${vendorQuery}`,
    });
    const redirectTo = `${inviteRedirectOrigin(body?.redirect_origin)}/reset-password?${redirectQuery}`;
    if (authUser) {
      const appMetadata = (authUser.app_metadata ?? {}) as JsonRecord;
      const roles = metadataRoles(appMetadata.roles);
      const coreRoles = (roles.core ?? []).filter(
        (role) => role !== "vendor_portal",
      );
      const {
        kind: _kind,
        vendor_id: _vendorId,
        pending_vendor_invite: _previousPending,
        ...metadataWithoutVendorAuthority
      } = appMetadata;
      const { error: pendingError } = await admin.auth.admin.updateUserById(
        authUser.id,
        {
          app_metadata: {
            ...metadataWithoutVendorAuthority,
            roles: { ...roles, core: coreRoles },
            pending_vendor_invite: {
              invite_id: inviteId,
              link_generation: expectedGeneration,
              expires_at: preparedInvite.expires_at,
            },
          },
        },
      );
      if (pendingError) throw pendingError;
      const { error } = await admin.auth.resetPasswordForEmail(email, {
        redirectTo,
      });
      if (error) throw error;
    } else {
      const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
        redirectTo,
        data: { company_name: companyName },
      });
      if (error) throw error;
      authUser = data.user;
      if (!authUser)
        throw new Error("Supabase Auth did not return the invited user.");
      const { error: pendingError } = await admin.auth.admin.updateUserById(
        authUser.id,
        {
          app_metadata: {
            ...authUser.app_metadata,
            pending_vendor_invite: {
              invite_id: inviteId,
              link_generation: expectedGeneration,
              expires_at: preparedInvite.expires_at,
            },
          },
        },
      );
      if (pendingError) throw pendingError;
    }
    if (!authUser)
      throw new Error("Supabase Auth did not return the invited user.");

    const deliveredInvite = await markDelivery({
      invite_id: inviteId,
      status: "sent",
      auth_user_id: authUser.id,
      expected_generation: expectedGeneration,
    });
    if (deliveredInvite.updated !== true) {
      throw new Error("The prepared invitation generation was not finalized.");
    }
    return json(
      {
        ...invite,
        invite: deliveredInvite,
        delivery_status: "sent",
      },
      body?.invite_id ? 200 : 201,
    );
  } catch (cause) {
    const message =
      cause instanceof Error
        ? cause.message
        : "Vendor invitation delivery failed.";
    const failedInvite = await markDelivery({
      invite_id: inviteId,
      status: "delivery_failed",
      auth_user_id: authUser?.id,
      expected_generation: expectedGeneration,
      error: message,
    }).catch(() => null);
    return json(
      {
        ...invite,
        ...(failedInvite ? { invite: failedInvite } : {}),
        delivery_status: "delivery_failed",
        delivery_error:
          "The case was opened, but the invitation email was not delivered. Verify the address and retry delivery.",
      },
      202,
    );
  }
});
