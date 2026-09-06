import { NextResponse } from "next/server";
import { parseUserRolesFromClaims } from "@intra/auth";
import { createSupabaseServerClient } from "@shell/lib/supabase/server";
import { knowledgeAudienceForClaims, knowledgeContentForAudience } from "@shell/lib/knowledge/audience";
import { KNOWLEDGE_GUIDE_CONTENT } from "@shell/lib/knowledge/guideContent";
import { tasksForRoles } from "@shell/lib/knowledge/taskCatalog";
import { DEMO_PROFILES } from "@shell/lib/demoProfiles";

export const dynamic = "force-dynamic";
export async function GET(request?: Request) {
  const headers = { "Cache-Control": "private, no-store" };
  const client = await createSupabaseServerClient("core");
  if (!client) {
    const demoAllowed = process.env.NEXT_PUBLIC_DATA_SOURCE === "memory" &&
      (process.env.NODE_ENV !== "production" || process.env.MWELL_MEMORY_SIMULATION_TEST === "1");
    if (!demoAllowed) return NextResponse.json({ tasks: [], unavailable: true }, { headers });
    const profileId = request ? new URL(request.url).searchParams.get("demoProfile") : null;
    const profile = DEMO_PROFILES.find((item) => item.id === profileId);
    if (!profile) return NextResponse.json({ tasks: [], unavailable: true }, { headers });
    // Read-only local recommendations, never session or capability grants.
    const audience = profile.kind === "vendor" ? "vendor" : "employee";
    const content = knowledgeContentForAudience(KNOWLEDGE_GUIDE_CONTENT, audience);
    return NextResponse.json({ tasks: tasksForRoles(content, profile.roles, audience === "vendor" ? "vendor" : "internal"), demo: true }, { headers });
  }
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return NextResponse.json({ tasks: [] }, { status: 401, headers });
  const audience = knowledgeAudienceForClaims(data.user.app_metadata);
  const content = knowledgeContentForAudience(KNOWLEDGE_GUIDE_CONTENT, audience);
  return NextResponse.json({ tasks: tasksForRoles(content, parseUserRolesFromClaims(data.user.app_metadata), audience === "vendor" ? "vendor" : "internal") }, { headers });
}
