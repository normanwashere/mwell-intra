import { describe, expect, it } from "vitest";
import { KNOWLEDGE_CONTENT } from "./content";
import { TROUBLESHOOTING_GUIDES } from "./troubleshooting";
import { warehouseExportAuthority } from "./warehouseExportGuidance";

const article = (id: string) => KNOWLEDGE_CONTENT.articles.find(item => item.id === id)!;
const recovery = (id: string) => TROUBLESHOOTING_GUIDES.find(item => item.id === id)!;

describe("safe operating guidance", () => {
  it("explains unavailable exports without treating report access as export authority", () => {
    expect(warehouseExportAuthority).toMatch(/inventory or access is loading/);
    expect(warehouseExportAuthority).toMatch(/authorized colleague/);
    expect(warehouseExportAuthority).toMatch(/report loads successfully/);
    expect(warehouseExportAuthority).toMatch(/training and access to the source records/);
  });

  it("uses sale-aware outstanding custody without changing return or Quality authority", () => {
    const text = JSON.stringify(article("warehouse-events-and-returns"));
    expect(text).toMatch(/remaining.*sales, giveaways and prior returns/i);
    expect(text).toMatch(/2 issued, 1 sold and 1 returned.*0 remaining/);
    expect(text).toMatch(/cannot load.*not zero/);
    expect(text).toMatch(/exact serial.*active hold.*Quality/i);
    expect(text).toMatch(/independent settlement approval/);
    expect(article("warehouse-events-and-returns").liveRoutes).toEqual(["/warehouse/events"]);
  });

  it("matches serialized transfer quantity to distinct scans and preserves uncertain-result recovery", () => {
    const text = JSON.stringify(recovery("trouble-variance"));
    expect(text).toMatch(/transfer quantity must match the distinct captured serials/);
    expect(text).toMatch(/product, source location, bin and active holds/);
    expect(text).toMatch(/check movement history and recover the original result before changing/);
    expect(text).toMatch(/Do not duplicate scans or change quantity to force/);
  });

  it("allows a valid alternate picking bin without removing custody or independent release controls", () => {
    const text = JSON.stringify(article("warehouse-order-to-release"));
    expect(text).toMatch(/another valid source bin/);
    expect(text).toMatch(/explicit source-bin assignment still applies/);
    expect(text).toMatch(/warehouse, exact serial, active hold and reservation checks/);
    expect(text).toMatch(/Do not combine picks from different bins/);
    expect(text).toMatch(/other than the packer/);
    expect(article("warehouse-order-to-release").liveRoutes).toEqual(["/warehouse/fulfillment"]);
  });

  it("preserves CSV unknowns and verified zero without granting export or payment authority", () => {
    const text = JSON.stringify(article("pricing-and-reporting"));
    expect(text).toMatch(/blank numeric cells/);
    expect(text).toMatch(/Ordered Units Availability/);
    expect(text).toMatch(/Received Units Availability/);
    expect(text).toMatch(/unknown/);
    expect(text).toMatch(/verified zero remains 0 with available/);
    expect(text).toMatch(/export permission/);
    expect(text).toMatch(/does not confirm payment/);
  });

  it("distinguishes monthly Finance totals, current inventory and all-time activity", () => {
    const text = JSON.stringify(article("pricing-and-reporting"));
    expect(text).toMatch(/Committed POs and net received use the displayed period/);
    expect(text).toMatch(/Inventory value is a current balance/);
    expect(text).toMatch(/Finance close and activity remain all time/);
    expect(text).toMatch(/failed source is not zero activity/);
  });

  it("limits offline access to public content and preserves the original account's queued work", () => {
    const text = JSON.stringify(recovery("trouble-stale-session"));
    expect(text).toMatch(/Offline access is limited to public assets and the offline screen/);
    expect(text).toMatch(/sign-out, account change or access loss/);
    expect(text).toMatch(/not access to private records/);
    expect(text).toMatch(/queued work.*account that created it/);
    expect(text).toMatch(/Do not clear all browser data/);
    expect(JSON.stringify(recovery("trouble-offline-write"))).toMatch(/same account.*saved result before retrying/);
  });

  it("explains My Work recovery without treating failed reads as absence", () => {
    const text = JSON.stringify(recovery("trouble-missing-data"));
    expect(text).toMatch(/My Work/);
    expect(text).toMatch(/failed source is not an empty queue/);
    expect(text).toMatch(/without creating a duplicate request/);
    expect(recovery("trouble-missing-data").flowIds).toEqual(["exception-and-recovery"]);
  });

  it("keeps access recovery tied to the correct account and existing authority", () => {
    const text = JSON.stringify(recovery("trouble-access-denied"));
    expect(text).toMatch(/active identity/);
    expect(text).toMatch(/different account/);
    expect(text).toMatch(/does not submit or replay a transaction/);
    expect(text).toMatch(/Do not request an administrator role merely to complete one task/);
    expect(text).not.toMatch(/JSON 401|Cache-Control/);
  });

  it("gives Product landmarks record context without approval or deployment claims", () => {
    const text = JSON.stringify(article("product-launch-and-pricing"));
    expect(text).toMatch(/Check the record title, version and product/);
    expect(text).toMatch(/does not approve a package or complete Operations handoff/);
    expect(article("product-launch-and-pricing").liveRoutes).toEqual(["/product"]);
  });

  it("keeps operator actions free of release-status and engineering handoff instructions", () => {
    const text = JSON.stringify([
      article("warehouse-order-to-release"), article("pricing-and-reporting"),
      article("product-launch-and-pricing"), recovery("trouble-access-denied"),
      recovery("trouble-missing-data"), recovery("trouble-offline-write"),
      recovery("trouble-stale-session"),
      article("warehouse-events-and-returns"), warehouseExportAuthority,
    ]);
    expect(text).not.toMatch(/four-QA|candidate|release manifest|deployment|retest|Reviewed against|screenshot certification|fully certified/i);
    expect(article("pricing-and-reporting").liveRoutes).toEqual(["/warehouse/pricing"]);
  });
});
