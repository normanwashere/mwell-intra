import { NextResponse } from "next/server";
import { featureGuideForPathname } from "@shell/lib/knowledge/context";
import { CONTEXTUAL_FEATURE_GUIDES } from "@shell/lib/knowledge/contextIndex";
import { createSupabaseServerClient } from "@shell/lib/supabase/server";
import {
  knowledgeAudienceForClaims,
  knowledgeContentForAudience,
} from "@shell/lib/knowledge/audience";
import { KNOWLEDGE_GUIDE_CONTENT } from "@shell/lib/knowledge/guideContent";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const client = await createSupabaseServerClient("core");
  if (!client) return NextResponse.json({ guide: null }, { status: 503 });
  const { data, error } = await client.auth.getUser();
  if (error || !data.user)
    return NextResponse.json({ guide: null }, { status: 401 });
  const audience = knowledgeAudienceForClaims(data.user.app_metadata);
  const content = knowledgeContentForAudience(
    KNOWLEDGE_GUIDE_CONTENT,
    audience,
  );
  const allowedFeatureIds = new Set(content.features.map((item) => item.id));
  const pathname = new URL(request.url).searchParams.get("path") ?? "/";
  const feature = featureGuideForPathname(
    CONTEXTUAL_FEATURE_GUIDES.filter((item) => allowedFeatureIds.has(item.id)),
    pathname,
  );

  if (!feature) return NextResponse.json({ guide: null }, { status: 404 });

  return NextResponse.json({
    guide: {
      title: feature.title,
      href: `/knowledge?article=${encodeURIComponent(`feature-${feature.id}`)}`,
    },
  });
}
