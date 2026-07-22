import type { ModuleDefinition } from "../contracts";

export type ProductCapability =
  | "view_readiness"
  | "prepare_readiness"
  | "decide_go_live"
  | "acknowledge_operations_handoff"
  | "view_pricing"
  | "propose_pricing"
  | "approve_pricing";

export type ProductRole =
  | "contributor"
  | "product_owner"
  | "operations_partner";

const PRODUCT_CAPABILITIES = [
  "view_readiness",
  "prepare_readiness",
  "decide_go_live",
  "acknowledge_operations_handoff",
  "view_pricing",
  "propose_pricing",
  "approve_pricing",
] as const satisfies readonly ProductCapability[];

export const productModule: ModuleDefinition<
  "product",
  ProductRole,
  ProductCapability
> = {
  module: "product",
  label: "Product",
  capabilities: PRODUCT_CAPABILITIES,
  roles: {
    contributor: {
      label: "Product Contributor",
      description:
        "Prepares readiness evidence and submits effective-dated price proposals.",
      capabilities: [
        "view_readiness",
        "prepare_readiness",
        "view_pricing",
        "propose_pricing",
      ],
    },
    product_owner: {
      label: "Product Owner",
      description:
        "Makes the final go-live decision and independently decides submitted price proposals.",
      capabilities: [
        "view_readiness",
        "decide_go_live",
        "view_pricing",
        "approve_pricing",
      ],
    },
    operations_partner: {
      label: "Operations Partner",
      description:
        "Reviews approved launch conditions and acknowledges the Operations handoff.",
      capabilities: [
        "view_readiness",
        "acknowledge_operations_handoff",
      ],
    },
  },
};
