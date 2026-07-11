"use client";

import Link from "next/link";
import { Badge, Button, Icon } from "@intra/ui";
import type {
  KnowledgeArticle as Article,
  KnowledgeRole,
} from "@shell/lib/knowledge/types";

export function KnowledgeArticle({
  article,
  rolesById,
  onBack,
  onOpenFlow,
}: {
  article: Article;
  rolesById: Map<string, KnowledgeRole>;
  onBack: () => void;
  onOpenFlow: (id: string) => void;
}) {
  return (
    <article className="mx-auto max-w-4xl">
      <Button variant="ghost" size="sm" onClick={onBack}>
        <Icon name="chevron" className="h-4 w-4 rotate-90" />
        Back to Knowledge Base
      </Button>
      <header className="mt-4 border-b border-line pb-5">
        <div className="flex flex-wrap gap-2">
          <Badge tone="brand">{article.module}</Badge>
          {article.roles.slice(0, 4).map((id) => (
            <Badge key={id} tone="slate">
              {rolesById.get(id)?.label ?? id}
            </Badge>
          ))}
        </div>
        <h1 className="mt-3 text-3xl font-bold text-ink">{article.title}</h1>
        <p className="mt-2 text-base text-muted">{article.summary}</p>
        <p className="mt-3 text-xs text-faint">
          Owner: {article.owner} | Reviewed {article.reviewedAt}
        </p>
      </header>
      <div className="mt-6 space-y-8">
        {article.sections.map((section) => (
          <section key={section.id} id={section.id} className="scroll-mt-24">
            <h2 className="text-xl font-bold text-ink">{section.title}</h2>
            <p className="mt-2 leading-7 text-muted">{section.body}</p>
            {section.steps && (
              <ol className="mt-4 space-y-3">
                {section.steps.map((step, index) => (
                  <li
                    key={`${section.id}-${step.title}`}
                    className="border-l-4 border-brand-500 bg-surface p-4 shadow-e1"
                  >
                    <div className="flex items-start gap-3">
                      <span className="tnum grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-600 text-xs font-bold text-white">
                        {index + 1}
                      </span>
                      <div className="min-w-0">
                        <h3 className="font-semibold text-ink">{step.title}</h3>
                        <p className="mt-1 text-sm text-muted">
                          {step.instruction}
                        </p>
                        <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-emerald-700">
                          Expected outcome
                        </p>
                        <p className="mt-1 text-sm text-muted">
                          {step.expectedOutcome}
                        </p>
                        {step.exception && (
                          <>
                            <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-amber-700">
                              If this cannot proceed
                            </p>
                            <p className="mt-1 text-sm text-muted">
                              {step.exception}
                            </p>
                          </>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        ))}
      </div>
      <footer className="mt-8 border-t border-line pt-5">
        <h2 className="font-semibold text-ink">Continue in Intra</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {article.liveRoutes.map((route) => (
            <Link key={route} href={route} className="btn-outline btn-sm">
              Open {route}
              <Icon name="arrowRight" className="h-4 w-4" />
            </Link>
          ))}
        </div>
        <p className="mt-2 text-xs text-faint">
          Operational routes remain subject to your assigned role.
        </p>
        {article.flowIds.length > 0 && (
          <div className="mt-5 flex flex-wrap gap-2">
            {article.flowIds.map((id) => (
              <Button
                key={id}
                size="sm"
                variant="outline"
                onClick={() => onOpenFlow(id)}
              >
                Open related flow
              </Button>
            ))}
          </div>
        )}
      </footer>
    </article>
  );
}
