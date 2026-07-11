import type { KnowledgeEvidence } from "./types";

const date = "2026-07-11";
const base = {
  capturedAt: date,
  reviewedAt: date,
  provenance: "production" as const,
  sensitiveDataReviewed: true,
};

export const KNOWLEDGE_EVIDENCE: KnowledgeEvidence[] = [
  {
    ...base,
    id: "ev-access-start",
    nodeId: "access-start",
    desktopSrc: "/knowledge/screenshots/sign-in-desktop.png",
    route: "/login",
    roleId: "core_staff_only",
    alt: "Mwell Intra sign-in screen",
    expectedLandmark: "Sign in",
    hotspots: [
      {
        id: "credentials",
        number: 1,
        x: 0.5,
        y: 0.58,
        label: "Enter assigned identity",
        instruction:
          "Enter the assigned Mwell email and password, then select Sign in once.",
      },
    ],
  },
  {
    ...base,
    id: "ev-p2p-start",
    nodeId: "p2p-start",
    desktopSrc: "/knowledge/screenshots/procurement-list-desktop.png",
    mobileSrc: "/knowledge/screenshots/procurement-request-mobile.png",
    route: "/procurement/requests/new",
    roleId: "procurement_requester",
    alt: "Procurement request workflow",
    expectedLandmark: "Purchase request",
    hotspots: [
      {
        id: "request",
        number: 1,
        x: 0.33,
        y: 0.3,
        label: "Start the request",
        instruction:
          "Capture category, line items, justification, dates, cost context, and supporting evidence.",
      },
    ],
  },
  {
    ...base,
    id: "ev-p2p-route",
    nodeId: "p2p-route",
    desktopSrc: "/knowledge/screenshots/procurement-list-desktop.png",
    route: "/procurement",
    roleId: "procurement_officer",
    alt: "Procurement governed request queue",
    expectedLandmark: "Procurement",
    hotspots: [
      {
        id: "queue",
        number: 1,
        x: 0.42,
        y: 0.34,
        label: "Open the governed request",
        instruction:
          "Open the assigned request and confirm the sourcing or policy-exception route.",
      },
    ],
  },
  {
    ...base,
    id: "ev-vendor-start",
    nodeId: "vendor-start",
    desktopSrc: "/knowledge/screenshots/legal-cases-desktop.png",
    mobileSrc: "/knowledge/screenshots/legal-invite-mobile.png",
    route: "/legal/invites/new",
    roleId: "legal_admin",
    alt: "Legal vendor invitation workflow",
    expectedLandmark: "Invite",
    hotspots: [
      {
        id: "invite",
        number: 1,
        x: 0.48,
        y: 0.38,
        label: "Record vendor identity",
        instruction:
          "Enter verified company, contact, category, jurisdiction, and risk facts before sending the invitation.",
      },
    ],
  },
  {
    ...base,
    id: "ev-vendor-review",
    nodeId: "vendor-review",
    desktopSrc: "/knowledge/screenshots/legal-cases-desktop.png",
    route: "/legal",
    roleId: "legal_reviewer",
    alt: "Legal accreditation case queue",
    expectedLandmark: "Cases",
    hotspots: [
      {
        id: "case",
        number: 1,
        x: 0.4,
        y: 0.35,
        label: "Open the accreditation case",
        instruction:
          "Review submitted evidence, checklist dispositions, instruments, and decision history.",
      },
    ],
  },
  {
    ...base,
    id: "ev-setup-bin",
    nodeId: "setup-bin",
    desktopSrc: "/knowledge/screenshots/warehouse-storage-desktop.png",
    route: "/warehouse/storage",
    roleId: "warehouse_admin",
    alt: "Warehouse storage areas and bins",
    expectedLandmark: "Storage areas",
    hotspots: [
      {
        id: "add-bin",
        number: 1,
        x: 0.92,
        y: 0.08,
        label: "Add a scannable bin",
        instruction:
          "Create a bin under the correct warehouse and storage area before receiving stock.",
      },
    ],
  },
  {
    ...base,
    id: "ev-receive-record",
    nodeId: "receive-record",
    desktopSrc: "/knowledge/screenshots/warehouse-receiving-desktop.png",
    route: "/warehouse/receiving",
    roleId: "warehouse_logistics_supervisor",
    alt: "Warehouse receiving screen",
    expectedLandmark: "Receiving",
    hotspots: [
      {
        id: "product",
        number: 1,
        x: 0.35,
        y: 0.25,
        label: "Select product and quantity",
        instruction:
          "Use a PO-backed product and record delivered quantity, serial or lot details.",
      },
      {
        id: "destination",
        number: 2,
        x: 0.38,
        y: 0.57,
        label: "Choose destination",
        instruction:
          "Select a valid scannable bin and attach required receipt evidence.",
      },
    ],
  },
];
