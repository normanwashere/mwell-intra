"use client";

import * as React from "react";
import { Icon } from "@intra/ui";
import { useKnowledgePreferences } from "@shell/lib/knowledge/preferences";

const STEPS = [
  {
    title: "Confirm your role",
    body: "Start with the work you perform. Your role guide explains your pages, authority, handoffs, and escalation path.",
    outcome: "You know what you may do and which decisions stay with another owner.",
  },
  {
    title: "Learn your workspace",
    body: "Open only the modules assigned to you. Shared workflows connect departments without giving every participant the same access.",
    outcome: "You can distinguish your source workspace from shared My Work and Insights views.",
  },
  {
    title: "Practice one workflow",
    body: "Walk through a guided decision tree before doing live work. Practice guides explain prerequisites, evidence, handoffs, and exception branches without creating records.",
    outcome: "You can identify the next actor, expected status, and completion evidence.",
  },
  {
    title: "Know how to recover",
    body: "If access, ownership, evidence, or status is wrong, stop and use the documented recovery path. Never bypass an approval or controlled handoff.",
    outcome: "You know when to retry, correct, escalate, or ask an administrator for help.",
  },
] as const;

export function FirstTimeJourney({
  userId,
  onExploreRoles,
  onPractice,
}: {
  userId: string;
  onExploreRoles: () => void;
  onPractice?: () => void;
}) {
  const {
    preferences,
    setOnboardingStep,
    completeOnboarding,
    restartOnboarding,
  } = useKnowledgePreferences(userId);
  const step = STEPS[preferences.onboardingStep] ?? STEPS[0];

  if (preferences.onboardingComplete)
    return (
      <section
        aria-label="First 10 minutes in Intra"
        className="flex flex-wrap items-center justify-between gap-3 border-y border-line py-4"
      >
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-full bg-emerald-100 text-emerald-800">
            <Icon name="check" className="h-5 w-5" />
          </span>
          <div>
            <p className="font-semibold text-ink">Orientation complete</p>
            <p className="text-sm text-muted">Your role guides and practice workflows remain available below.</p>
          </div>
        </div>
        <button type="button" className="btn-ghost btn-sm min-h-11" onClick={restartOnboarding}>
          Restart orientation
        </button>
      </section>
    );

  return (
    <section
      aria-label="First 10 minutes in Intra"
      className="overflow-hidden rounded-lg border border-brand-400 bg-surface shadow-e1"
    >
      <div className="grid lg:grid-cols-[18rem_minmax(0,1fr)]">
        <div className="bg-brand-900 p-5 text-white sm:p-6">
          <p className="text-xs font-semibold uppercase text-brand-200">New to Intra</p>
          <h2 className="mt-2 text-2xl font-bold">Your first 10 minutes</h2>
          <p className="mt-2 text-sm leading-6 text-brand-100">
            A safe orientation before you create or approve a live record.
          </p>
          <ol className="mt-5 grid grid-cols-4 gap-2 lg:grid-cols-1" aria-label="Orientation progress">
            {STEPS.map((item, index) => (
              <li key={item.title}>
                <button
                  type="button"
                  onClick={() => setOnboardingStep(index)}
                  aria-label={`${index + 1}. ${item.title}`}
                  aria-current={preferences.onboardingStep === index ? "step" : undefined}
                  className={`flex min-h-11 w-full items-center gap-3 rounded-md px-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white ${preferences.onboardingStep === index ? "bg-white text-brand-900" : "text-brand-100 hover:bg-brand-800"}`}
                >
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-current text-xs font-bold">{index + 1}</span>
                  <span className="hidden lg:block">{item.title}</span>
                </button>
              </li>
            ))}
          </ol>
        </div>
        <div className="flex min-h-72 flex-col justify-between p-5 sm:p-7">
          <div>
            <p className="text-xs font-semibold uppercase text-brand-700">Step {preferences.onboardingStep + 1} of {STEPS.length}</p>
            <h3 className="mt-2 text-2xl font-bold text-ink">{step.title}</h3>
            <p className="mt-3 max-w-2xl leading-7 text-muted">{step.body}</p>
            <div className="mt-5 border-l-4 border-emerald-500 bg-emerald-50 p-4 dark:border-emerald-400 dark:bg-emerald-950">
              <p className="text-xs font-semibold uppercase text-emerald-800 dark:text-emerald-300">Checkpoint</p>
              <p className="mt-1 text-sm text-emerald-950 dark:text-emerald-100">{step.outcome}</p>
            </div>
          </div>
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
            <button
              type="button"
              className="btn-ghost btn-sm min-h-11"
              onClick={() => preferences.onboardingStep === 0 ? onExploreRoles() : setOnboardingStep(preferences.onboardingStep - 1)}
            >
              {preferences.onboardingStep === 0 ? "Explore role guides" : "Previous"}
            </button>
            <div className="flex flex-wrap gap-2">
              {preferences.onboardingStep === 2 && onPractice && (
                <button type="button" className="btn-outline btn-sm min-h-11" onClick={onPractice}>
                  Open practice workflow
                </button>
              )}
              {preferences.onboardingStep < STEPS.length - 1 ? (
                <button type="button" className="btn-primary btn-sm min-h-11" onClick={() => setOnboardingStep(preferences.onboardingStep + 1)}>
                  Next orientation step <Icon name="arrowRight" className="h-4 w-4" />
                </button>
              ) : (
                <button type="button" className="btn-primary btn-sm min-h-11" onClick={completeOnboarding}>
                  Finish orientation <Icon name="check" className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
