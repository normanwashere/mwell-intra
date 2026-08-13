"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";
import { useSession } from "@intra/auth";
import { can, type CapabilityFor, type Module } from "@intra/rbac";
import { useOptionalLearning } from "./LearningProvider";
import { LockedCapabilityRecovery } from "./LockedCapabilityRecovery";

export interface CertifiedActionRenderProps {
  execute<T>(command: () => Promise<T>): Promise<T | undefined>;
  pending: boolean;
}

export function CertifiedAction<M extends Module>({
  module,
  capability,
  children,
}: {
  module: M;
  capability: CapabilityFor<M>;
  children(props: CertifiedActionRenderProps): ReactNode;
}) {
  const { mode, userRoles, roleCapabilities = {} } = useSession();
  const learning = useOptionalLearning();
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const roleAllowed = mode === "supabase"
    ? roleCapabilities[module]?.includes(capability) === true
    : can(userRoles, module, capability);
  const effective = learning?.isLiveCapability(module, capability) ?? false;
  const lock = learning?.lockedReason(module, capability) ?? null;

  const execute = useCallback(async <T,>(command: () => Promise<T>) => {
    if (inFlight.current) return undefined;
    inFlight.current = true;
    setPending(true);
    try {
      return await command();
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }, []);

  if (!roleAllowed) {
    return <LockedCapabilityRecovery module={module} capability={capability} reason="role" />;
  }
  if (!learning) {
    return <LockedCapabilityRecovery module={module} capability={capability} reason="unavailable" />;
  }
  if (!effective && lock) {
    return <LockedCapabilityRecovery module={module} capability={capability} reason="training" requirementIds={lock.requirementIds} />;
  }
  if (!effective) {
    return <LockedCapabilityRecovery module={module} capability={capability} reason="unavailable" />;
  }
  return children({ execute, pending });
}
