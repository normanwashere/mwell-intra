import { NextResponse } from "next/server";
import { featureGuideForPathname } from "@shell/lib/knowledge/context";
import { CONTEXTUAL_FEATURE_GUIDES } from "@shell/lib/knowledge/contextIndex";

export function GET(request: Request) {
  const pathname = new URL(request.url).searchParams.get("path") ?? "/";
  const feature = featureGuideForPathname(CONTEXTUAL_FEATURE_GUIDES, pathname);

  if (!feature)
    return NextResponse.json({ guide: null }, { status: 404 });

  return NextResponse.json({
    guide: {
      title: feature.title,
      href: `/knowledge?article=${encodeURIComponent(`feature-${feature.id}`)}`,
    },
  });
}
