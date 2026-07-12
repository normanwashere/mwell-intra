import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.ComponentProps<"a">) => (
    <a href={String(href)} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@intra/ui", () => ({
  Badge: ({ children }: { children: React.ReactNode }) => (
    <span>{children}</span>
  ),
  Icon: ({ name, ...props }: { name: string; className?: string }) => (
    <span aria-hidden="true" data-icon={name} {...props} />
  ),
  EmptyState: () => null,
}));
import { FeatureGuide } from "@shell/components/knowledge/FeatureGuide";
import { KnowledgeRoleGuide } from "@shell/components/knowledge/KnowledgeRoleGuide";
import {
  KNOWLEDGE_GUIDE_CONTENT,
  resolveKnowledgeGuide,
} from "@shell/components/knowledge/KnowledgeBase";
import { KNOWLEDGE_CONTENT } from "./content";
import { searchKnowledge } from "./search";
import type {
  KnowledgeArticle,
  KnowledgeFeature,
  KnowledgeFlow,
  KnowledgeRole,
} from "./types";

const liveRole: KnowledgeRole = {
  id: "release_manager",
  label: "Release manager",
  module: "admin",
  availability: "live",
  purpose: "Own governed production release readiness and final handoff.",
  authority: {
    capabilities: ["review_release", "record_release"],
    accessibleRoutes: ["/admin/releases", "/admin/audit"],
    canDo: ["Verify release evidence.", "Record the release disposition."],
    cannotDo: ["Cannot approve a release they authored."],
    decisions: ["Decide whether the release evidence is complete."],
    upstreamRoleIds: ["change_author"],
    downstreamRoleIds: ["platform_admin"],
    escalation: "Escalate failed controls to the platform administrator.",
  },
};

const comingSoonRole: KnowledgeRole = {
  ...liveRole,
  id: "future_release_manager",
  label: "Future release manager",
  availability: "coming_soon",
  purpose: "Planned authority for future release orchestration.",
  authority: {
    ...liveRole.authority,
    capabilities: [],
    accessibleRoutes: ["/admin/future-releases"],
    canDo: ["Plan the future release operating model."],
    cannotDo: ["Do not execute a production release through this role."],
    decisions: ["Planned decision authority for release orchestration."],
  },
};

const rolesById = new Map<string, KnowledgeRole>([
  [liveRole.id, liveRole],
  [comingSoonRole.id, comingSoonRole],
  [
    "change_author",
    {
      ...liveRole,
      id: "change_author",
      label: "Change author",
    },
  ],
  [
    "platform_admin",
    {
      ...liveRole,
      id: "platform_admin",
      label: "Platform administrator",
    },
  ],
]);

const feature: KnowledgeFeature = {
  id: "release-review",
  title: "Release review",
  module: "admin",
  availability: "live",
  routes: ["/admin/releases/:id"],
  roleIds: [liveRole.id],
  capabilityIds: ["review_release"],
  purpose: "Review one governed release before production handoff.",
  controls: [
    {
      name: "Approve release",
      behavior: "Records an approved release disposition.",
      validation: "Independent reviewer and complete evidence are required.",
      result: "The release becomes approved with actor and time.",
    },
  ],
  fields: [
    {
      name: "Decision reason",
      purpose: "Explains the release disposition.",
      required: true,
      validation: "Enter a specific non-empty reason.",
    },
  ],
  reads: ["Release evidence and current approval state."],
  writes: ["Approval disposition, actor, reason, and time."],
  statuses: ["Draft, ready, approved, rejected, or failed."],
  notifications: ["The change author receives the recorded outcome."],
  exceptions: ["A stale release shows an error and must be refreshed."],
  completionEvidence: ["Audit history contains the final disposition."],
  owner: "Platform",
  reviewedAt: "2026-07-12",
};

const relatedArticle: KnowledgeArticle = {
  id: "release-procedure",
  slug: "release-procedure",
  title: "Run a governed release",
  summary: "Prepare, review, and hand off a release.",
  module: "admin",
  roles: [liveRole.id],
  keywords: [],
  sections: [],
  relatedArticleIds: [],
  flowIds: ["release-flow"],
  liveRoutes: [],
  owner: "Platform",
  reviewedAt: "2026-07-12",
};

const relatedFlow: KnowledgeFlow = {
  id: "release-flow",
  title: "Release to production",
  summary: "Governed release preparation and approval.",
  roles: [liveRole.id],
  startNodeId: "review",
  nodes: [
    {
      id: "review",
      type: "decision",
      title: "Is release evidence complete?",
      ownerRoleIds: [liveRole.id],
      body: "Review the evidence pack.",
      authorityRoleId: liveRole.id,
      policyBasis: "Release policy section 4 and segregation of duties.",
    },
    {
      id: "complete",
      type: "terminal",
      title: "Release approved",
      ownerRoleIds: [liveRole.id],
      body: "Record the approved outcome.",
      terminalOutcome: "complete",
    },
  ],
  edges: [{ from: "review", to: "complete", label: "Complete" }],
};

describe("KnowledgeRoleGuide", () => {
  it("renders exact live authority, pages, handoffs, tasks, escalation, and related content semantically", () => {
    const markup = renderToStaticMarkup(
      <KnowledgeRoleGuide
        role={liveRole}
        rolesById={rolesById}
        relatedFeatures={[feature]}
        relatedArticles={[relatedArticle]}
        relatedFlows={[relatedFlow]}
        onBack={() => undefined}
        onOpenArticle={() => undefined}
        onOpenFlow={() => undefined}
      />,
    );

    expect(markup).toContain("<article");
    expect(markup).toContain("<h1");
    expect(markup).toContain("Release manager");
    expect(markup).toContain("Live");
    expect(markup).toContain("Own governed production release readiness");
    expect(markup).toContain("/admin/releases");
    expect(markup).toContain("review_release");
    expect(markup).toContain("Verify release evidence.");
    expect(markup).toContain("Cannot approve a release they authored.");
    expect(markup).toContain(
      "Decide whether the release evidence is complete.",
    );
    expect(markup).toContain("Change author");
    expect(markup).toContain("Platform administrator");
    expect(markup).toContain("Is release evidence complete?");
    expect(markup).toContain("Escalate failed controls");
    expect(markup).toContain("Run a governed release");
    expect(markup).toMatch(/<h2[^>]*>Accessible pages<\/h2>/);
    expect(markup).toMatch(/<h2[^>]*>Capability matrix<\/h2>/);
    expect(markup).toMatch(/<h2[^>]*>Can do and cannot do<\/h2>/);
    expect(markup).toMatch(/<h2[^>]*>Decision authority<\/h2>/);
    expect(markup).toMatch(/<h2[^>]*>Responsibility timeline<\/h2>/);
    expect(markup).toMatch(/<h2[^>]*>Upstream and downstream handoffs<\/h2>/);
    expect(markup).toMatch(/<h2[^>]*>Common tasks<\/h2>/);
    expect(markup).toMatch(/<h2[^>]*>Segregation of duties<\/h2>/);
    expect(markup).toMatch(/<h2[^>]*>Exceptions and escalation<\/h2>/);
    expect(markup).toMatch(/<h2[^>]*>Related content<\/h2>/);
    expect(markup).toContain("<ul");
    expect(markup).toContain("<table");
    expect(markup).toContain("min-h-11");
    expect(markup).toContain('aria-label="Role capability matrix"');
    expect(markup).toContain('tabindex="0"');
  });

  it("marks a coming-soon role as non-operational and emits no executable route link", () => {
    const markup = renderToStaticMarkup(
      <KnowledgeRoleGuide
        role={comingSoonRole}
        rolesById={rolesById}
        relatedFeatures={[]}
        relatedArticles={[]}
        relatedFlows={[]}
        onBack={() => undefined}
        onOpenArticle={() => undefined}
        onOpenFlow={() => undefined}
      />,
    );

    expect(markup).toContain("Coming soon");
    expect(markup).toContain("Roadmap profile");
    expect(markup).toContain("Not available for live work");
    expect(markup).toContain("/admin/future-releases");
    expect(markup).toContain('aria-disabled="true"');
    expect(markup).not.toContain('href="/admin/future-releases"');
    expect(markup).toContain(
      "Do not execute a production release through this role.",
    );
  });
});

describe("FeatureGuide", () => {
  it("explains every control and field plus data, outcomes, policy, and related flows", () => {
    const markup = renderToStaticMarkup(
      <FeatureGuide
        feature={feature}
        rolesById={rolesById}
        relatedArticles={[relatedArticle]}
        relatedFlows={[relatedFlow]}
        onBack={() => undefined}
        onOpenArticle={() => undefined}
        onOpenFlow={() => undefined}
      />,
    );

    expect(markup).toContain("Review one governed release");
    expect(markup).toContain("Release manager");
    expect(markup).toContain("/admin/releases/:id");
    expect(markup).toContain("Open from a record list");
    expect(markup).not.toContain('href="/admin/releases/:id"');
    expect(markup).toContain("Approve release");
    expect(markup).toContain("Records an approved release disposition.");
    expect(markup).toContain("Independent reviewer");
    expect(markup).toContain("The release becomes approved");
    expect(markup).toContain("Decision reason");
    expect(markup).toContain("Required");
    expect(markup).toContain("Release evidence and current approval state.");
    expect(markup).toContain("Approval disposition, actor, reason, and time.");
    expect(markup).toContain("Draft, ready, approved, rejected, or failed.");
    expect(markup).toContain(
      "The change author receives the recorded outcome.",
    );
    expect(markup).toContain("A stale release shows an error");
    expect(markup).toContain("Audit history contains the final disposition.");
    expect(markup).toContain(
      "Release policy section 4 and segregation of duties.",
    );
    expect(markup).toContain("Release to production");
    expect(markup).toMatch(/<h2[^>]*>Controls<\/h2>/);
    expect(markup).toMatch(/<h2[^>]*>Fields<\/h2>/);
    expect(markup).toMatch(/<h2[^>]*>Reads and writes<\/h2>/);
    expect(markup).toMatch(/<h2[^>]*>Statuses and notifications<\/h2>/);
    expect(markup).toMatch(/<h2[^>]*>Errors and completion<\/h2>/);
    expect(markup).toMatch(/<h2[^>]*>Policy basis<\/h2>/);
    expect(markup).toMatch(/<h2[^>]*>Related flows and content<\/h2>/);
    expect(markup).toContain("<dl");
    expect(markup).toContain("<table");
    expect(markup).toContain('aria-label="Feature fields"');
    expect(markup).toContain('tabindex="0"');
  });
});

describe("guide search integration and accessibility", () => {
  it("indexes and resolves coming-soon role profiles without granting a route", () => {
    const result = searchKnowledge(
      KNOWLEDGE_GUIDE_CONTENT,
      "roadmap Strategic sourcing lead",
      { type: "role" },
    )[0];
    const articleId = new URL(
      result!.href,
      "https://intra.test",
    ).searchParams.get("article");

    expect(result).toMatchObject({
      type: "role",
      availability: "coming_soon",
    });
    expect(
      resolveKnowledgeGuide(KNOWLEDGE_GUIDE_CONTENT, articleId),
    ).toMatchObject({
      kind: "role",
      role: { id: "strategic_sourcing_lead", availability: "coming_soon" },
    });
  });

  it.each(["role", "feature"] as const)(
    "resolves a %s search destination to its dedicated guide",
    (type) => {
      const result = searchKnowledge(
        KNOWLEDGE_CONTENT,
        "Warehouse operations",
        {
          type,
        },
      )[0];
      expect(result).toBeDefined();
      const articleId = new URL(
        result!.href,
        "https://intra.test",
      ).searchParams.get("article");

      expect(resolveKnowledgeGuide(KNOWLEDGE_CONTENT, articleId)).toMatchObject(
        {
          kind: type,
        },
      );
    },
  );

  it("uses one h1, labelled sections, semantic lists, and 44px navigation targets", () => {
    const markup = renderToStaticMarkup(
      <FeatureGuide
        feature={feature}
        rolesById={rolesById}
        relatedArticles={[relatedArticle]}
        relatedFlows={[relatedFlow]}
        onBack={() => undefined}
        onOpenArticle={() => undefined}
        onOpenFlow={() => undefined}
      />,
    );

    expect(markup.match(/<h1/g)).toHaveLength(1);
    expect(markup).not.toMatch(/<section(?![^>]*aria-labelledby)/);
    expect(markup).toContain("<ul");
    expect(markup).toContain("min-h-11");
  });
});
