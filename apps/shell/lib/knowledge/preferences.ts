"use client";

import { useCallback, useEffect, useState } from "react";

export type KnowledgeFeedback = "helpful" | "needs_improvement" | "outdated";

export interface KnowledgeLibraryItem {
  id: string;
  title: string;
  href: string;
  context: string;
  viewedAt: string;
}

export interface KnowledgePreferences {
  onboardingComplete: boolean;
  onboardingStep: number;
  savedIds: string[];
  recent: KnowledgeLibraryItem[];
  feedback: Record<string, KnowledgeFeedback>;
}

const EMPTY_PREFERENCES: KnowledgePreferences = {
  onboardingComplete: false,
  onboardingStep: 0,
  savedIds: [],
  recent: [],
  feedback: {},
};

const PREFERENCES_EVENT = "intra:knowledge-preferences";

export const knowledgePreferenceKey = (userId: string) =>
  `intra.knowledge.preferences.v1:${userId}`;

const normalize = (value: Partial<KnowledgePreferences>): KnowledgePreferences => ({
  onboardingComplete: value.onboardingComplete === true,
  onboardingStep: Math.min(3, Math.max(0, Number(value.onboardingStep) || 0)),
  savedIds: Array.isArray(value.savedIds)
    ? [...new Set(value.savedIds.filter((item): item is string => typeof item === "string"))]
    : [],
  recent: Array.isArray(value.recent)
    ? value.recent
        .filter(
          (item): item is KnowledgeLibraryItem =>
            Boolean(
              item &&
                typeof item.id === "string" &&
                typeof item.title === "string" &&
                typeof item.href === "string",
            ),
        )
        .filter((item, index, items) => items.findIndex((candidate) => candidate.id === item.id) === index)
        .slice(0, 10)
    : [],
  feedback:
    value.feedback && typeof value.feedback === "object" ? value.feedback : {},
});

export function readKnowledgePreferences(userId: string): KnowledgePreferences {
  if (typeof window === "undefined" || !userId) return EMPTY_PREFERENCES;
  try {
    const raw = window.localStorage.getItem(knowledgePreferenceKey(userId));
    return raw ? normalize(JSON.parse(raw) as Partial<KnowledgePreferences>) : EMPTY_PREFERENCES;
  } catch {
    return EMPTY_PREFERENCES;
  }
}

export function updateKnowledgePreferences(
  userId: string,
  updater: (current: KnowledgePreferences) => KnowledgePreferences,
) {
  if (typeof window === "undefined" || !userId) return EMPTY_PREFERENCES;
  const next = normalize(updater(readKnowledgePreferences(userId)));
  window.localStorage.setItem(knowledgePreferenceKey(userId), JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(PREFERENCES_EVENT, { detail: userId }));
  return next;
}

export function useKnowledgePreferences(userId: string) {
  const [preferences, setPreferences] = useState<KnowledgePreferences>(EMPTY_PREFERENCES);

  useEffect(() => {
    const refresh = () => setPreferences(readKnowledgePreferences(userId));
    refresh();
    const onPreferences = (event: Event) => {
      if ((event as CustomEvent<string>).detail === userId) refresh();
    };
    window.addEventListener(PREFERENCES_EVENT, onPreferences);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(PREFERENCES_EVENT, onPreferences);
      window.removeEventListener("storage", refresh);
    };
  }, [userId]);

  const update = useCallback(
    (updater: (current: KnowledgePreferences) => KnowledgePreferences) =>
      setPreferences(updateKnowledgePreferences(userId, updater)),
    [userId],
  );

  const setOnboardingStep = useCallback(
    (step: number) => update((current) => ({ ...current, onboardingStep: step })),
    [update],
  );
  const completeOnboarding = useCallback(
    () => update((current) => ({ ...current, onboardingComplete: true, onboardingStep: 3 })),
    [update],
  );
  const restartOnboarding = useCallback(
    () => update((current) => ({ ...current, onboardingComplete: false, onboardingStep: 0 })),
    [update],
  );
  const toggleSaved = useCallback(
    (id: string) =>
      update((current) => ({
        ...current,
        savedIds: current.savedIds.includes(id)
          ? current.savedIds.filter((item) => item !== id)
          : [id, ...current.savedIds],
      })),
    [update],
  );
  const recordViewed = useCallback(
    (item: Omit<KnowledgeLibraryItem, "viewedAt">) =>
      update((current) => ({
        ...current,
        recent: [
          { ...item, viewedAt: new Date().toISOString() },
          ...current.recent.filter((candidate) => candidate.id !== item.id),
        ],
      })),
    [update],
  );
  const setFeedback = useCallback(
    (id: string, feedback: KnowledgeFeedback) =>
      update((current) => ({
        ...current,
        feedback: { ...current.feedback, [id]: feedback },
      })),
    [update],
  );

  return {
    preferences,
    setOnboardingStep,
    completeOnboarding,
    restartOnboarding,
    toggleSaved,
    recordViewed,
    setFeedback,
  };
}
