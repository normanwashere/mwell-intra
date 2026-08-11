export interface AuditPresentationRow {
  readonly module: string | null;
  readonly entity_type: string | null;
  readonly entity_id: string | null;
  readonly action: string | null;
  readonly actor: string | null;
}

export function humanizeAuditToken(
  value: string | null | undefined,
  fallback = "Activity recorded",
): string {
  const words = String(value ?? "")
    .trim()
    .replaceAll(/[._-]+/g, " ")
    .replaceAll(/\s+/g, " ");
  if (!words) return fallback;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function auditActorLabel(
  actorId: string | null | undefined,
  actors: ReadonlyMap<string, string>,
): string {
  const normalizedActorId = String(actorId ?? "").trim();
  const resolved = actors.get(normalizedActorId)?.trim();
  if (resolved) return resolved;
  if (!normalizedActorId) return "System process";
  return "Unavailable account";
}

export function auditEntityLabel(row: AuditPresentationRow): string {
  return humanizeAuditToken(row.entity_type, "Governed record");
}

export function auditEventSummary(row: AuditPresentationRow): string {
  const action = humanizeAuditToken(row.action);
  if (!String(row.entity_type ?? "").trim()) return action;
  return `${action} ${humanizeAuditToken(row.entity_type).toLocaleLowerCase()}`;
}
