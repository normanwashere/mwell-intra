"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Icon } from "@intra/ui";
import {
  mutationAvailability,
  nextConnectivityStatus,
  type ConnectivityStatus,
  type MutationAvailability,
} from "@shell/lib/connectivity";

interface ConnectivityValue extends MutationAvailability {
  readonly status: ConnectivityStatus;
}

const ConnectivityContext = createContext<ConnectivityValue | null>(null);

export function ConnectivityProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<ConnectivityStatus>("online");

  useEffect(() => {
    if (!navigator.onLine) setStatus("offline");
    const update = () => {
      setStatus((current) => nextConnectivityStatus(current, navigator.onLine));
    };
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  const value = useMemo(
    () => ({ status, ...mutationAvailability(status) }),
    [status],
  );

  return (
    <ConnectivityContext.Provider value={value}>
      {status !== "online" && (
        <div
          role={status === "offline" ? "alert" : "status"}
          aria-live="polite"
          data-connectivity-status={status}
          className="sticky top-0 z-[70] flex min-h-11 items-center justify-center gap-2 border-b border-amber-300 bg-amber-50 px-4 py-2 text-center text-sm font-semibold text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100"
        >
          <Icon
            name={status === "offline" ? "info" : "rotate"}
            className="h-4 w-4"
          />
          <span>
            {status === "offline"
              ? "You are offline. Live changes are disabled."
              : "Connection restored. Reload to verify the latest live data."}
          </span>
          {status === "stale" && (
            <button
              type="button"
              className="inline-flex min-h-11 items-center rounded-lg px-3 underline underline-offset-2"
              onClick={() => window.location.reload()}
            >
              Reload
            </button>
          )}
        </div>
      )}
      {children}
    </ConnectivityContext.Provider>
  );
}

export function useConnectivity(): ConnectivityValue {
  const value = useContext(ConnectivityContext);
  if (!value) {
    throw new Error("useConnectivity must be used inside ConnectivityProvider");
  }
  return value;
}

export function useMutationAvailability(): MutationAvailability {
  const { allowed, reason } = useConnectivity();
  return { allowed, reason };
}
