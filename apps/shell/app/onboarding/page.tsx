"use client";

import { Suspense } from "react";
import { TaskLearningWorkspace } from "@shell/components/knowledge/TaskLearningWorkspace";

export default function OnboardingPage() {
  return <Suspense><TaskLearningWorkspace /></Suspense>;
}
