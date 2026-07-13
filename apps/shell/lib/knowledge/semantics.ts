import type {
  KnowledgeContent,
  KnowledgeEvidence,
  KnowledgeFlow,
  KnowledgeFlowNode,
} from "./types";

export type NodePresentationKind =
  | "screenshot"
  | "decision"
  | "system"
  | "exception"
  | "outcome"
  | "guidance";

export interface NodePresentation {
  kind: NodePresentationKind;
  title: string;
  detail: string;
  label: string;
}

export function resolveSelectedWorkflowNode(
  flow: KnowledgeFlow,
  input: {
    requestedStepId: string | null;
    hasBranch: boolean;
    branchNodeId: string;
  },
): KnowledgeFlowNode {
  if (input.hasBranch) {
    return (
      flow.nodes.find((node) => node.id === input.branchNodeId) ??
      flow.nodes.find((node) => node.id === flow.startNodeId)!
    );
  }
  return (
    flow.nodes.find((node) => node.id === input.requestedStepId) ??
    flow.nodes.find((node) => node.id === flow.startNodeId)!
  );
}

export function nodePresentation(
  node: KnowledgeFlowNode,
  evidence?: KnowledgeEvidence,
): NodePresentation {
  if (evidence)
    return {
      kind: "screenshot",
      title: "Verified screen",
      detail: evidence.state,
      label: "Screen evidence",
    };
  if (node.type === "decision")
    return {
      kind: "decision",
      title: "Decision criteria",
      detail: node.policyBasis,
      label: "Decision point",
    };
  if (node.type === "terminal")
    return {
      kind: "outcome",
      title: "Completion proof",
      detail: node.outcome ?? node.body,
      label: `Outcome: ${node.terminalOutcome}`,
    };
  if (node.type === "system")
    return {
      kind: "system",
      title: "System transition",
      detail: node.databaseEffect ?? node.outcome ?? node.body,
      label: "Automated step",
    };
  if (node.type === "exception")
    return {
      kind: "exception",
      title: "Exception response",
      detail: node.exception ?? node.body,
      label: "Controlled exception",
    };
  return {
    kind: "guidance",
    title: "Operating guidance",
    detail: node.body,
    label: "Procedure",
  };
}

const CAPABILITY_OWNERSHIP: Record<
  string,
  { module: "warehouse"; capability: string }
> = {
  "setup-start": { module: "warehouse", capability: "manage_locations" },
  "setup-area": { module: "warehouse", capability: "manage_locations" },
  "setup-bin": { module: "warehouse", capability: "manage_locations" },
  "setup-route": {
    module: "warehouse",
    capability: "manage_operation_routes",
  },
};

export function workflowRoleAlignmentErrors(
  content: KnowledgeContent,
): string[] {
  const errors: string[] = [];
  for (const flow of content.flows) {
    for (const node of flow.nodes) {
      for (const owner of node.ownerRoleIds) {
        if (!flow.roles.includes(owner))
          errors.push(`${flow.id}/${node.id} owner ${owner} is not a flow role`);
      }
      const rule = CAPABILITY_OWNERSHIP[node.id];
      if (!rule) continue;
      const expected = content.roles
        .filter(
          (role) =>
            role.availability === "live" &&
            role.rbacModule === rule.module &&
            role.authority.capabilities.includes(rule.capability),
        )
        .map((role) => role.id)
        .sort();
      const actual = [...node.ownerRoleIds].sort();
      if (expected.join("|") !== actual.join("|"))
        errors.push(
          `${flow.id}/${node.id} owners ${actual.join(", ")} do not match ${rule.capability}: ${expected.join(", ")}`,
        );
    }
  }
  return errors;
}

export function guidedEvidenceRoute(
  route: string,
  nodeId: string,
  returnTo: string,
): string {
  const target = new URL(route, "https://intra.local");
  target.searchParams.set("guide", nodeId);
  target.searchParams.set("returnTo", returnTo);
  return `${target.pathname}${target.search}`;
}
