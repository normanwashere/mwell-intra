/** Returns a trimmed HTTPS URL when it is safe to expose as a user-facing link. */
export function normalizeSafeHttpsUrl(
  value: string | null | undefined,
): string | null {
  const candidate = value?.trim();
  if (!candidate) return null;

  try {
    const parsed = new URL(candidate);
    if (
      parsed.protocol !== "https:" ||
      !parsed.hostname ||
      parsed.username ||
      parsed.password
    ) {
      return null;
    }
    return candidate;
  } catch {
    return null;
  }
}
