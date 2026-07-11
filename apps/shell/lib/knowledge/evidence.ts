import { KNOWLEDGE_FLOWS } from "./workflows";
import type { KnowledgeEvidence, KnowledgeFlowNode } from "./types";

const date = "2026-07-11";

interface ScreenSource {
  src: string;
  route: string;
  landmark: string;
  mobileSrc?: string;
}

function interactionFor(node: KnowledgeFlowNode, source: ScreenSource) {
  const id = node.id;
  if (id === "vendor-start")
    return {
      x: 0.2,
      y: 0.026,
      mobileX: 0.5,
      mobileY: 0.22,
      label: "Invite vendor",
      instruction: "Select Invite vendor to create the governed invitation.",
    };
  if (id === "vendor-apply")
    return {
      x: 0.5,
      y: 0.57,
      label: "Continue application",
      instruction:
        "Select Continue application to open the vendor checklist and upload the outstanding requirements.",
    };
  if (id === "vendor-end")
    return {
      x: 0.5,
      y: 0.38,
      label: "Accreditation status",
      instruction:
        "Review the status, expiry, outstanding documents, and signature actions from the vendor portal.",
    };
  if (id.startsWith("vendor-"))
    return {
      x: 0.24,
      y: 0.16,
      mobileX: 0.5,
      mobileY: 0.38,
      label: "Accreditation case",
      instruction:
        "Open the vendor's case row to review its checklist and next required action.",
    };
  if (id === "p2p-start")
    return {
      x: 0.16,
      y: 0.045,
      mobileX: 0.5,
      mobileY: 0.2,
      label: "New request",
      instruction: "Select New request to begin the purchase request wizard.",
    };
  if (id === "receive-record")
    return {
      x: 0.36,
      y: 0.18,
      label: "Product and quantity",
      instruction:
        "Select the delivered product, enter its quantity, then add it to the receipt.",
    };
  if (id.includes("inspect") || id.includes("outcome"))
    return {
      x: 0.48,
      y: 0.25,
      label: source.landmark,
      instruction: `Use the highlighted ${source.landmark} control to record the decision and required evidence.`,
    };
  if (id === "receive-putaway" || id.startsWith("setup-"))
    return {
      x: 0.36,
      y: 0.38,
      label: source.landmark,
      instruction: `Select the highlighted ${source.landmark} control to continue this step.`,
    };
  return {
    x: 0.25,
    y: 0.16,
    label: source.landmark,
    instruction: `Open the highlighted ${source.landmark} area, then complete: ${node.body}`,
  };
}

function sourceFor(node: KnowledgeFlowNode): ScreenSource {
  const id = node.id;
  if (id === "access-start")
    return {
      src: "/knowledge/screenshots/sign-in-desktop.png",
      route: "/login",
      landmark: "Sign in",
    };
  if (id.startsWith("access-") || id.startsWith("recover-"))
    return id.includes("fix") || id.includes("escalate")
      ? {
          src: "/knowledge/screenshots/admin-users-desktop.png",
          route: "/admin/users",
          landmark: "Users",
        }
      : {
          src: "/knowledge/screenshots/intra-home-desktop.png",
          route: "/",
          landmark: "Mwell Intra",
        };
  if (id.startsWith("p2p-")) {
    if (id === "p2p-start")
      return {
        src: "/knowledge/screenshots/procurement-list-desktop.png",
        mobileSrc: "/knowledge/screenshots/procurement-request-mobile.png",
        route: "/procurement/requests/new",
        landmark: "Purchase request",
      };
    if (
      id.includes("approve") ||
      id.includes("accept") ||
      id.includes("outcome")
    )
      return {
        src: "/knowledge/screenshots/procurement-approvals-desktop.png",
        route: "/procurement/approvals",
        landmark: "Approvals",
      };
    if (id.includes("po") || id.includes("end"))
      return {
        src: "/knowledge/screenshots/procurement-purchase-orders-desktop.png",
        route: "/procurement/purchase-orders",
        landmark: "Purchase orders",
      };
    if (id.includes("receive"))
      return {
        src: "/knowledge/screenshots/warehouse-receiving-desktop.png",
        route: "/warehouse/receiving",
        landmark: "Receiving",
      };
    return {
      src: "/knowledge/screenshots/procurement-list-desktop.png",
      route: "/procurement",
      landmark: "Procurement",
    };
  }
  if (id.startsWith("vendor-"))
    return id === "vendor-start"
      ? {
          src: "/knowledge/screenshots/legal-cases-desktop.png",
          mobileSrc: "/knowledge/screenshots/legal-invite-mobile.png",
          route: "/legal/invites/new",
          landmark: "Invite",
        }
      : id === "vendor-apply" || id === "vendor-end"
        ? {
            src: "/knowledge/screenshots/vendor-portal-desktop.png",
            route: "/vendor",
            landmark: "Continue application",
          }
        : {
            src: "/knowledge/screenshots/legal-cases-desktop.png",
            route: "/legal",
            landmark: "Cases",
          };
  if (id.startsWith("setup-"))
    return id === "setup-route"
      ? {
          src: "/knowledge/screenshots/warehouse-operation-routes-desktop.png",
          route: "/warehouse/operation-routes",
          landmark: "Operation Routes",
        }
      : {
          src: "/knowledge/screenshots/warehouse-storage-desktop.png",
          route: "/warehouse/storage",
          landmark: "Storage areas",
        };
  if (id.startsWith("receive-")) {
    if (id === "receive-start")
      return {
        src: "/knowledge/screenshots/warehouse-purchase-orders-desktop.png",
        route: "/warehouse/purchase-orders",
        landmark: "Purchase Orders",
      };
    if (id === "receive-record")
      return {
        src: "/knowledge/screenshots/warehouse-receiving-desktop.png",
        route: "/warehouse/receiving",
        landmark: "Receiving",
      };
    if (id.includes("inspect") || id.includes("outcome"))
      return {
        src: "/knowledge/screenshots/warehouse-quality-desktop.png",
        route: "/warehouse/quality",
        landmark: "Quality Control",
      };
    if (id === "receive-putaway")
      return {
        src: "/knowledge/screenshots/warehouse-storage-desktop.png",
        route: "/warehouse/storage",
        landmark: "Storage areas",
      };
    return {
      src: "/knowledge/screenshots/warehouse-inventory-desktop.png",
      route: "/warehouse/inventory",
      landmark: "Inventory",
    };
  }
  if (id.startsWith("event-")) {
    if (id === "event-start" || id === "event-end")
      return {
        src: "/knowledge/screenshots/warehouse-events-desktop.png",
        route: "/warehouse/events",
        landmark: "Events",
      };
    if (id === "event-reserve" || id === "event-issue")
      return {
        src: "/knowledge/screenshots/warehouse-allocations-desktop.png",
        route: "/warehouse/allocations",
        landmark: "Allocations",
      };
    if (id.includes("outcome"))
      return {
        src: "/knowledge/screenshots/warehouse-exceptions-desktop.png",
        route: "/warehouse/exceptions",
        landmark: "Exceptions",
      };
    return {
      src: "/knowledge/screenshots/warehouse-returns-desktop.png",
      route: "/warehouse/returns",
      landmark: "Returns",
    };
  }
  if (id.startsWith("count-")) {
    if (id === "count-adjust")
      return {
        src: "/knowledge/screenshots/warehouse-approvals-desktop.png",
        route: "/warehouse/approvals",
        landmark: "Stock approvals",
      };
    if (id === "count-end")
      return {
        src: "/knowledge/screenshots/warehouse-inventory-desktop.png",
        route: "/warehouse/inventory",
        landmark: "Inventory",
      };
    return {
      src: "/knowledge/screenshots/warehouse-cycle-counts-desktop.png",
      route: "/warehouse/cycle-counts",
      landmark: "Cycle Counts",
    };
  }
  if (id.startsWith("price-"))
    return {
      src: "/knowledge/screenshots/warehouse-pricing-desktop.png",
      route: "/warehouse/pricing",
      landmark: "Pricing",
    };
  if (id.startsWith("doa-"))
    return {
      src: "/knowledge/screenshots/admin-doa-desktop.png",
      route: "/admin/doa",
      landmark: "Delegation",
    };
  return {
    src: "/knowledge/screenshots/intra-home-desktop.png",
    route: "/",
    landmark: "Mwell Intra",
  };
}

export const KNOWLEDGE_EVIDENCE: KnowledgeEvidence[] = KNOWLEDGE_FLOWS.flatMap(
  (flow) =>
    flow.nodes.map((node) => {
      const source = sourceFor(node);
      const interaction = interactionFor(node, source);
      return {
        id: `ev-${node.id}`,
        nodeId: node.id,
        desktopSrc: source.src,
        mobileSrc: source.mobileSrc,
        route: source.route,
        roleId: node.ownerRoleIds[0]!,
        capturedAt: date,
        reviewedAt: date,
        provenance: "documentation" as const,
        alt: `${source.landmark} screen for ${node.title}`,
        expectedLandmark: source.landmark,
        expectedDatabaseEffect: node.databaseEffect,
        sensitiveDataReviewed: true,
        hotspots: [
          {
            id: "primary",
            number: 1,
            ...interaction,
          },
        ],
      };
    }),
);
