"use client";

import { Button, Icon } from "@intra/ui";
import { useTraining } from "./TrainingModeProvider";

export function TrainingBanner({ onExit }: { onExit?(): void }) {
  const { active, scenario, currentStep, resume, exit } = useTraining();
  return (
    <section
      aria-label="Training mode"
      className="sticky top-0 z-[70] flex flex-col gap-3 border-b border-cyan-400 bg-cyan-50 px-4 py-3 text-cyan-950 sm:flex-row sm:items-center sm:justify-between dark:border-cyan-700 dark:bg-cyan-950 dark:text-cyan-50"
    >
      <div className="flex min-w-0 items-center gap-3">
        <Icon name="clipboard" className="h-5 w-5 shrink-0" />
        <div className="min-w-0">
          <p className="font-semibold">Training mode: {scenario.title}</p>
          <p className="text-sm leading-5 opacity-80">{currentStep.title}</p>
        </div>
      </div>
      <div className="flex gap-2">
        {!active && <Button size="sm" onClick={resume}>Resume</Button>}
        <Button variant="outline" size="sm" onClick={onExit ?? exit}>Exit training</Button>
      </div>
    </section>
  );
}
