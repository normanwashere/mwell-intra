import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@shell/lib/supabase/server";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@shell/lib/supabase/env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: NextRequest) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return jsonError("Supabase is not configured.", 503);
  }

  const userClient = await createSupabaseServerClient("legal");
  if (!userClient) return jsonError("Supabase is not configured.", 503);
  const [{ data: verified, error: authError }, { data: sessionData }] =
    await Promise.all([
      userClient.auth.getUser(),
      userClient.auth.getSession(),
    ]);
  if (authError || !verified.user || !sessionData.session?.access_token) {
    return jsonError("Authentication required.", 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON request.", 400);
  }

  const response = await fetch(
    `${SUPABASE_URL}/functions/v1/vendor-invite-delivery`,
    {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        authorization: `Bearer ${sessionData.session.access_token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    },
  );
  const payload = (await response.json().catch(() => ({
    error: "Vendor invitation delivery returned an invalid response.",
  }))) as Record<string, unknown>;
  return NextResponse.json(payload, { status: response.status });
}
