const OPERATIONAL_PREFIXES = [
  "/work",
  "/warehouse",
  "/procurement",
  "/finance",
  "/legal",
  "/events",
  "/product",
  "/insights",
  "/admin",
] as const;

const EMBEDDED_ROUTER_ROOTS = new Set(["/warehouse", "/procurement", "/legal"]);

export function isOnboardingProtectedPath(pathname: string): boolean {
  return OPERATIONAL_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function onboardingHref(destination: string): string {
  const canonicalDestination = EMBEDDED_ROUTER_ROOTS.has(destination)
    ? `${destination}/`
    : destination;
  return `/onboarding?next=${encodeURIComponent(canonicalDestination)}`;
}
