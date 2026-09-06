import { createHmac } from "node:crypto";
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@shell/lib/supabase/server";
import { createSupabaseAdminClient } from "@shell/lib/supabase/admin";
import { validateExperienceEvent } from "@shell/lib/knowledge/experienceEvents";
import { knowledgeContentForAudience } from "@shell/lib/knowledge/audience";
import { KNOWLEDGE_GUIDE_CONTENT } from "@shell/lib/knowledge/guideContent";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const reply = (status: number, state: string) => NextResponse.json({ state }, { status, headers: { "cache-control": "no-store" } });

export async function POST(request: Request) {
  if (process.env.KNOWLEDGE_EXPERIENCE_ENABLED !== "true" ||
    process.env.KNOWLEDGE_EXPERIENCE_POLICY_APPROVED !== "true") return reply(202, "disabled");
  const key = process.env.KNOWLEDGE_EXPERIENCE_HMAC_KEY;
  if (!key || key.length < 64) return reply(503, "unavailable");
  if (request.headers.get("origin") !== new URL(request.url).origin) return reply(403, "rejected");
  if (request.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json") return reply(415, "rejected");
  if (Number(request.headers.get("content-length")) > 1024) return reply(413, "rejected");
  try {
    const client = await createSupabaseServerClient("core");
    if (!client) return reply(503, "unavailable");
    const { data, error } = await client.auth.getUser();
    if (error || !data.user) return reply(401, "rejected");
    const profile = await client.from("profiles").select("kind,status").eq("id", data.user.id).single();
    const kind = profile.data?.kind;
    if (profile.error || profile.data?.status !== "active" ||
      (kind !== "employee" && kind !== "vendor")) return reply(403, "rejected");
    const audience = kind;
    // Bound the stream itself; Content-Length is optional and attacker controlled.
    const reader = request.body?.getReader();
    if (!reader) return reply(400, "rejected");
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let size = 0; let text = "";
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > 1024) { await reader.cancel(); return reply(413, "rejected"); }
        text += decoder.decode(chunk.value, { stream: true });
      }
      text += decoder.decode();
    } finally { reader.releaseLock(); }
    let input: unknown;
    try { input = JSON.parse(text); } catch { return reply(400, "rejected"); }
    const event = validateExperienceEvent(input);
    if (!event.ok) return reply(400, "rejected");
    if (event.value.articleId && !knowledgeContentForAudience(KNOWLEDGE_GUIDE_CONTENT, audience)
      .articles.some(article => article.id === event.value.articleId)) return reply(400, "rejected");
    const limit = await client.rpc("check_rate_limit", { p_bucket: "knowledge.experience", p_max_per_hour: 120 });
    if (limit.error) return reply(limit.error.code === "42501" ? 429 : 503, "unavailable");
    const admin = createSupabaseAdminClient();
    if (!admin) return reply(503, "unavailable");
    const actor = createHmac("sha256", key).update(`knowledge-experience:v1:${data.user.id}`).digest("hex");
    const result = await admin.schema("core").rpc("record_knowledge_experience", {
      p_event_id: event.value.eventId, p_actor_ref: actor, p_audience: audience,
      p_name: event.value.name, p_article_id: event.value.articleId ?? null,
      p_result: event.value.result ?? null, p_viewport: event.value.viewport,
    });
    return result.error ? reply(503, "unavailable") : reply(202, "accepted");
  } catch { return reply(503, "unavailable"); }
}
