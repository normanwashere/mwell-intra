export type ConnectivityStatus = "online" | "offline" | "stale";

export interface MutationAvailability {
  readonly allowed: boolean;
  readonly reason: string | null;
}

export function nextConnectivityStatus(
  current: ConnectivityStatus,
  browserOnline: boolean,
): ConnectivityStatus {
  if (!browserOnline) return "offline";
  return current === "offline" ? "stale" : current;
}

export function mutationAvailability(
  status: ConnectivityStatus,
): MutationAvailability {
  if (status === "offline") {
    return {
      allowed: false,
      reason: "Reconnect before changing live data.",
    };
  }
  if (status === "stale") {
    return {
      allowed: false,
      reason: "Reload current data before making changes.",
    };
  }
  return { allowed: true, reason: null };
}
