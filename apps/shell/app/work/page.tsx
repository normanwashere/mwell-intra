"use client";

import { WorkApp } from "@intra/work";
import { useSession } from "@intra/auth";
import { hasCapability, workSources } from "@shell/lib/navigation";

export default function WorkPage() {
  const { mode, userRoles, userCapabilities } = useSession();
  const access = { mode, userRoles, userCapabilities };
  return (
    <WorkApp
      allowedSources={workSources(access)}
      hasCapability={(module, capability) =>
        hasCapability(access, module, capability as never)
      }
    />
  );
}
