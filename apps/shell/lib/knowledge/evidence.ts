import { KNOWLEDGE_FLOWS } from "./workflows";
import type { KnowledgeEvidence, KnowledgeFlowNode } from "./types";

const date = "2026-07-11";

interface ScreenSource {
  src: string;
  route: string;
  landmark: string;
  mobileSrc?: string;
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
    return id === "vendor-start" || id === "vendor-apply"
      ? {
          src: "/knowledge/screenshots/legal-cases-desktop.png",
          mobileSrc: "/knowledge/screenshots/legal-invite-mobile.png",
          route: id === "vendor-start" ? "/legal/invites/new" : "/vendor",
          landmark: id === "vendor-start" ? "Invite" : "Accreditation",
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
            x: 0.5,
            y: 0.35,
            label: node.title,
            instruction: node.body,
          },
        ],
      };
    }),
);
