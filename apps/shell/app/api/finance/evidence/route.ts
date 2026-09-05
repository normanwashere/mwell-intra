import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@shell/lib/supabase/server";
import { createSupabaseAdminClient } from "@shell/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const reply = (body: unknown, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin)
    return reply({ error: "Same-origin request required" }, 403);
  if (request.headers.get("content-type")?.split(";")[0] !== "application/json")
    return reply({ error: "JSON required" }, 400);
  const reader = request.body?.getReader();
  if (!reader) return reply({ error: "Entry identity required" }, 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4096) {
        await reader.cancel();
        return reply({ error: "Request too large" }, 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let body;
  try {
    body = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return reply({ error: "Invalid request" }, 400);
  }
  if (
    !body ||
    typeof body.entryId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
      body.entryId,
    )
  )
    return reply({ error: "Entry identity required" }, 400);
  try {
    const client = await createSupabaseServerClient("core");
    if (!client) return reply({ error: "Evidence service unavailable" }, 503);
    const user = await client.auth.getUser();
    if (user.error || !user.data.user)
      return reply({ error: "Authentication required" }, 401);
    const result = await client
      .schema("core")
      .rpc("platform_close_evidence", { p_entry: body.entryId });
    if (result.error)
      return reply(
        { error: "Evidence unavailable or source access restricted" },
        403,
      );
    let resolved = result.data as {
      bucket?: string;
      storage_path?: string;
      filename?: string;
      href?: string;
      reference?: string;
    };
    if (
      resolved.reference &&
      /^evidence:\/\/[0-9a-f-]{36}$/.test(resolved.reference)
    ) {
      const access = await client
        .schema("core")
        .rpc("action_evidence_access", {
          payload: { reference: resolved.reference },
        });
      if (access.error || !access.data)
        return reply({ error: "Evidence access restricted" }, 403);
      resolved = {
        ...(access.data as { storage_path: string; filename: string }),
        bucket: "documents",
      };
    }
    if (
      resolved.href &&
      /^\/(procurement\/purchase-orders\/|warehouse\/receiving\?receipt=)[A-Za-z0-9_-]+$/.test(
        resolved.href,
      )
    )
      return reply({ url: new URL(resolved.href, request.url).href });
    const invalidPath =
      !resolved.storage_path ||
      /(^\/|\.\.|:\/\/)/.test(resolved.storage_path) ||
      Array.from(resolved.storage_path).some(
        (character) => character.charCodeAt(0) < 32,
      );
    if (
      !resolved.bucket ||
      !resolved.storage_path ||
      !["documents", "evidence", "procurement-requests"].includes(
        resolved.bucket,
      ) ||
      invalidPath
    )
      return reply({ error: "Registered evidence delivery unavailable" }, 403);
    const admin = createSupabaseAdminClient();
    if (!admin) return reply({ error: "Private delivery unavailable" }, 503);
    const signed = await admin.storage
      .from(resolved.bucket)
      .createSignedUrl(resolved.storage_path, 300, {
        download: resolved.filename || "finance-evidence",
      });
    if (signed.error || !signed.data?.signedUrl)
      return reply({ error: "Evidence preview unavailable" }, 502);
    return reply({ url: signed.data.signedUrl });
  } catch {
    return reply({ error: "Evidence service unavailable" }, 503);
  }
}
