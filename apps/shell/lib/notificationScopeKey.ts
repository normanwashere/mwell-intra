import type { AuthMode, UserCapabilities } from '@intra/auth';

export function notificationScopeKey({ mode, principalId, roleCapabilities }: {
  mode: AuthMode;
  principalId: string | null | undefined;
  roleCapabilities?: UserCapabilities;
}): string {
  // Notification SELECT uses has_any_cap, not certification-filtered capabilities.
  const globalRead = Boolean(principalId) && Object.values(roleCapabilities ?? {})
    .some(capabilities => capabilities?.includes('manage_notifications'));
  return JSON.stringify([mode, principalId ?? null, globalRead]);
}
