"use client";

import type { SessionProfile } from "@intra/auth";
import type { UserRoles } from "@intra/rbac";
import { cx } from "@shell/lib/cx";
import { resolvePersonaPresentation } from "@shell/lib/personaPresentation";

export function PersonaContext({
  profile,
  userRoles,
  compact = false,
  className,
}: {
  profile: SessionProfile;
  userRoles: Partial<UserRoles>;
  compact?: boolean;
  className?: string;
}) {
  const persona = resolvePersonaPresentation(profile, userRoles);
  const authority = persona.authority.map((item) => item.label).join(", ");

  return (
    <div
      className={cx("min-w-0", className)}
      aria-label={`Signed in as ${persona.title} in ${persona.department}`}
    >
      <p className="truncate text-xs font-semibold text-ink">
        {persona.title}
        <span className="font-normal text-muted"> · {persona.department}</span>
      </p>
      {!compact && (
        <p
          className="max-w-72 truncate text-[0.65rem] text-faint"
          title={authority || "No scoped authority"}
        >
          {authority ? `Scoped: ${authority}` : "No scoped authority"}
        </p>
      )}
    </div>
  );
}
