import { Suspense } from "react";
import { KnowledgeBase } from "@shell/components/knowledge/KnowledgeBase";
import { ModuleLoadingSkeleton } from "@shell/components/ModuleLoadingSkeleton";
import { createSupabaseServerClient } from "@shell/lib/supabase/server";
import {
  knowledgeAudienceForClaims,
  knowledgeContentForAudience,
} from "@shell/lib/knowledge/audience";
import { KNOWLEDGE_GUIDE_CONTENT } from "@shell/lib/knowledge/guideContent";

export default async function KnowledgePage() {
  const client = await createSupabaseServerClient("core");
  const { data } = client
    ? await client.auth.getUser()
    : { data: { user: null } };
  const audience = client
    ? knowledgeAudienceForClaims(data.user?.app_metadata)
    : "employee";
  const content = knowledgeContentForAudience(
    KNOWLEDGE_GUIDE_CONTENT,
    audience,
  );

  return (
    <Suspense fallback={<ModuleLoadingSkeleton />}>
      <KnowledgeBase content={content} />
    </Suspense>
  );
}
