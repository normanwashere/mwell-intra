export interface AuditPresentationRow {
  readonly module: string;
  readonly entity_type: string;
  readonly entity_id: string;
  readonly action: string;
  readonly actor: string;
}

export function humanizeAuditToken(value: string): string {
  const words = value.trim().replaceAll(/[._-]+/g, " ").replaceAll(/\s+/g, " ");
  if (!words) return "Activity recorded";
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function auditActorLabel(
  actorId: string,
  actors: ReadonlyMap<string, string>,
): string {
  const resolved = actors.get(actorId)?.trim();
  if (resolved) return resolved;
  if (!actorId.trim()) return "System process";
  return "Unavailable account";
}

export function auditEntityLabel(row: AuditPresentationRow): string {
  return humanizeAuditToken(row.entity_type);
}

export function auditEventSummary(row: AuditPresentationRow): string {
  return `${humanizeAuditToken(row.action)} ${humanizeAuditToken(row.entity_type).toLocaleLowerCase()}`;
}
