import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type User } from "jsr:@supabase/supabase-js@2";

interface InviteBody {
  invite_id?: string;
  email?: string;
  company_name?: string;
  category?: string;
  profile?: Record<string, unknown>;
  origin_country?: string;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

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
  let email = body?.email?.trim().toLowerCase();
  let companyName = body?.company_name?.trim();
  let invite: Record<string, unknown>;

  if (body?.invite_id) {
    const { data: existing, error } = await userClient
      .from("vendor_invites")
      .select("*")
      .eq("id", body.invite_id)
      .single();
    if (error || !existing)
      return json({ error: error?.message ?? "Vendor invite not found." }, 404);
    if (existing.status === "accepted" || existing.status === "expired")
      return json(
        { error: `A ${existing.status} invite cannot be retried.` },
        409,
      );
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
    const { data, error } = await userClient.rpc("invite_vendor", {
      payload: {
        email,
        company_name: companyName,
        category: body?.category,
        actor: verifiedUser.email,
        profile: body?.profile,
        origin_country: body?.origin_country,
      },
    });
    if (error) return json({ error: error.message }, 403);
    invite = data as Record<string, unknown>;
  }

  if (!email || !companyName)
    return json({ error: "Vendor invite is missing delivery details." }, 422);
  const { data: profile, error: profileError } = await admin
    .schema("core")
    .from("profiles")
    .select("kind")
    .eq("email", email)
    .maybeSingle();
  if (profileError) return json({ error: profileError.message }, 502);
  if (profile?.kind === "employee") {
    return json(
      {
        error:
          "This email belongs to an employee account and cannot be invited as a vendor.",
      },
      409,
    );
  }

  const inviteRow = (invite.invite ?? invite) as { id?: string };
  const inviteId = inviteRow.id;
  if (!inviteId)
    return json({ error: "Invitation service returned no invite id." }, 502);
  const markDelivery = async (payload: Record<string, unknown>) => {
    const { error } = await admin
      .schema("legal")
      .rpc("finalize_vendor_invite_delivery", { payload });
    if (error) throw error;
  };

  try {
    let authUser: User | null = null;
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
    const redirectTo =
      "https://mwell-intra.vercel.app/reset-password?next=/vendor";
    if (authUser) {
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
    }
    if (!authUser)
      throw new Error("Supabase Auth did not return the invited user.");

    const currentRoles =
      authUser.app_metadata?.roles &&
      typeof authUser.app_metadata.roles === "object"
        ? (authUser.app_metadata.roles as Record<string, string[]>)
        : {};
    const coreRoles = [
      ...new Set([...(currentRoles.core ?? []), "vendor_portal"]),
    ];
    const { error: metadataError } = await admin.auth.admin.updateUserById(
      authUser.id,
      {
        app_metadata: {
          ...authUser.app_metadata,
          roles: { ...currentRoles, core: coreRoles },
        },
      },
    );
    if (metadataError) throw metadataError;
    await markDelivery({
      invite_id: inviteId,
      status: "sent",
      auth_user_id: authUser.id,
    });
    return json(
      { ...invite, delivery_status: "sent" },
      body?.invite_id ? 200 : 201,
    );
  } catch (cause) {
    const message =
      cause instanceof Error
        ? cause.message
        : "Vendor invitation delivery failed.";
    await markDelivery({
      invite_id: inviteId,
      status: "delivery_failed",
      error: message,
    }).catch(() => undefined);
    return json(
      {
        ...invite,
        delivery_status: "delivery_failed",
        delivery_error:
          "The case was opened, but the invitation email was not delivered. Verify the address and retry delivery.",
      },
      202,
    );
  }
});
