import type { DataSource } from "@intra/data-kit";
import { useSession } from "./session";

export function useCanPrepareWarehouseExport(source: DataSource, demoAllowed = true): boolean {
  const { mode, loading, profile, userCapabilities } = useSession();
  if (source === "memory") return demoAllowed;
  return mode === "supabase" && !loading && profile !== null && (
    userCapabilities?.warehouse?.includes("register_exports") === true ||
    userCapabilities?.insights?.includes("prepare_exports") === true
  );
}
