import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  clearTrainingAdaptersForTests,
  getTrainingAdapter,
  registerTrainingAdapter,
} from "./registry";
import type { TrainingAdapter } from "./types";

const adapter: TrainingAdapter<{ count: number }> = {
  id: "test-adapter",
  version: 1,
  scenarioIds: ["test-scenario"],
  initialState: () => ({ count: 0 }),
  dispatch: (state, command) => ({
    state: { count: state.count + 1 },
    nextStepId: command.type === "finish" ? "done" : "start",
  }),
};

afterEach(clearTrainingAdaptersForTests);

describe("training adapter registry", () => {
  it("registers a versioned adapter and resolves it by id", () => {
    registerTrainingAdapter(adapter);
    expect(getTrainingAdapter("test-adapter")).toBe(adapter);
  });

  it("rejects duplicate ids instead of silently replacing behavior", () => {
    registerTrainingAdapter(adapter);
    expect(() => registerTrainingAdapter({ ...adapter })).toThrow(
      "Training adapter test-adapter is already registered.",
    );
  });

  it("returns undefined for an unknown adapter", () => {
    expect(getTrainingAdapter("missing")).toBeUndefined();
  });
});

function filesBelow(root: string): string[] {
  if (!statSync(root).isDirectory()) return [root];
  return readdirSync(root).flatMap((entry) => filesBelow(resolve(root, entry)));
}

describe("training dependency boundary", () => {
  it("keeps simulation adapters detached from operational data clients", () => {
    const workspace = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
    const trainingFiles = readdirSync(resolve(workspace, "modules"), {
      withFileTypes: true,
    }).flatMap((moduleEntry) => {
      const root = resolve(workspace, "modules", moduleEntry.name, "src", "training");
      try {
        return filesBelow(root).filter((file) => /\.(ts|tsx)$/.test(file));
      } catch {
        return [];
      }
    });
    const runtimeFiles = [
      "TrainingModeProvider.tsx",
      "CoachOverlay.tsx",
      "TrainingBanner.tsx",
      "OnboardingTrainingSession.tsx",
    ].map((file) => resolve(workspace, "modules", "learning", "src", file));
    const forbidden = [
      /from\s+["'][^"']*localStore[^"']*["']/,
      /from\s+["'][^"']*data\/supabase[^"']*["']/,
      /\bcreateRepository\s*\(/,
      /\.rpc\s*\(/,
      /\.from\s*\(/,
    ];

    const violations = [...trainingFiles, ...runtimeFiles].flatMap((file) => {
      if (file.endsWith(".test.ts") || file.endsWith(".test.tsx")) return [];
      const source = readFileSync(file, "utf8");
      return forbidden.some((pattern) => pattern.test(source)) ? [file] : [];
    });

    expect(violations).toEqual([]);
  });
});
