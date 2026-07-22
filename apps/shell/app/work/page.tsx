"use client";

import { WorkApp } from "@intra/work";
import { useSession } from "@intra/auth";
import { workSources } from "@shell/lib/navigation";

export default function WorkPage() {
  const { mode, userRoles, userCapabilities } = useSession();
  return (
    <WorkApp
      allowedSources={workSources({ mode, userRoles, userCapabilities })}
    />
  );
}
