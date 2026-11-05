export const warehouseExportAuthority =
  "Sign in and wait for your permissions to finish loading. Your account must currently be allowed to prepare Warehouse or Insights exports. Viewing reports or reviewing exports alone is not enough. Required training and access to the source records still apply.";

export const WAREHOUSE_EXPORT_ENTRY_GUIDANCE: Readonly<Partial<Record<string, string>>> = {
  "warehouse-dashboard": `Opening this page requires permission to view the Warehouse dashboard. Analytics and finance viewing permissions are not additional requirements for this page. Preparing an export is a separate permission: ${warehouseExportAuthority}`,
  "warehouse-data": `Opening this page requires permission to view Warehouse analytics. Export permission alone does not open this page. Preparing an export is a separate permission: ${warehouseExportAuthority}`,
  "warehouse-reports": `Opening this quantity report requires permission to view Warehouse inventory, Warehouse analytics, or Warehouse finance. Insights access is not required for this Warehouse report. Inventory viewing does not grant finance access or export authority. Export permission alone does not open this page. Preparing an export is a separate permission: ${warehouseExportAuthority}`,
};
