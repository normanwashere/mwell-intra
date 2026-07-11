import { Suspense } from "react";
import { KnowledgeBase } from "@shell/components/knowledge/KnowledgeBase";
import { ModuleLoadingSkeleton } from "@shell/components/ModuleLoadingSkeleton";

export default function KnowledgePage() {
  return (
    <Suspense fallback={<ModuleLoadingSkeleton />}>
      <KnowledgeBase />
    </Suspense>
  );
}
