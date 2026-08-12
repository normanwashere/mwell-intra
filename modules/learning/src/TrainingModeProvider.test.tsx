import { act, renderHook } from "@testing-library/react";
import { createRef, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TrainingModeProvider, useTraining } from "./TrainingModeProvider";
import type { TrainingAdapter, TrainingScenario } from "./training/types";

const initial = { count: 0 };
const adapter: TrainingAdapter<{ count: number }> = {
  id: "counter",
  version: 1,
  scenarioIds: ["counter-flow"],
  initialState: () => initial,
  dispatch: (state, command) => {
    if (command.type === "increment") {
      return {
        state: { count: state.count + 1 },
        nextStepId: "confirm",
      };
    }
    if (command.type === "confirm") {
      return {
        state,
        nextStepId: "done",
        checkpointId: "confirmed",
        completed: true,
      };
    }
    throw new Error(`Unknown counter command ${command.type}.`);
  },
};
const scenario: TrainingScenario = {
  id: "counter-flow",
  title: "Count safely",
  initialStepId: "start",
  steps: [
    {
      id: "start",
      title: "Start counting",
      instruction: "Use the declared training action.",
      anchor: "[data-onboarding-anchor='counter']",
      allowedCommands: ["increment"],
    },
    {
      id: "confirm",
      title: "Confirm count",
      instruction: "Confirm the simulated count.",
      anchor: "[data-onboarding-anchor='confirm']",
      allowedCommands: ["confirm"],
    },
    {
      id: "done",
      title: "Practice complete",
      instruction: "Return to onboarding.",
      anchor: "[data-onboarding-anchor='done']",
      allowedCommands: [],
      terminal: true,
    },
  ],
};

function wrapper(
  checkpoint = vi.fn().mockResolvedValue(undefined),
  launcherRef = createRef<HTMLButtonElement>(),
  persistSession = false,
) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <TrainingModeProvider
        adapter={adapter}
        scenario={scenario}
        assignmentRequirementId="assignment-1"
        attemptId="attempt-1"
        onCheckpoint={checkpoint}
        launcherRef={launcherRef}
        persistSession={persistSession}
      >
        {children}
      </TrainingModeProvider>
    );
  };
}

describe("TrainingModeProvider", () => {
  beforeEach(() => window.sessionStorage.clear());

  it("accepts only commands declared by the current step", async () => {
    const { result } = renderHook(() => useTraining<{ count: number }>(), {
      wrapper: wrapper(),
    });

    await expect(
      result.current.dispatch({ type: "live-submit" }),
    ).rejects.toThrow("Command live-submit is not allowed for training step start.");
    expect(result.current.state).toEqual({ count: 0 });
  });

  it("clones initial state, moves deterministically, and can reset", async () => {
    const { result } = renderHook(() => useTraining<{ count: number }>(), {
      wrapper: wrapper(),
    });

    await act(() => result.current.dispatch({ type: "increment" }));
    expect(result.current.state).toEqual({ count: 1 });
    expect(result.current.currentStep.id).toBe("confirm");
    expect(initial).toEqual({ count: 0 });

    act(() => result.current.reset());
    expect(result.current.state).toEqual({ count: 0 });
    expect(result.current.currentStep.id).toBe("start");
  });

  it("supports Back before evidence is committed", async () => {
    const { result } = renderHook(() => useTraining<{ count: number }>(), {
      wrapper: wrapper(),
    });

    await act(() => result.current.dispatch({ type: "increment" }));
    expect(result.current.canGoBack).toBe(true);
    act(() => result.current.back());
    expect(result.current.currentStep.id).toBe("start");
    expect(result.current.state.count).toBe(0);
  });

  it("reports each checkpoint idempotently and prevents Back across committed evidence", async () => {
    const checkpoint = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useTraining<{ count: number }>(), {
      wrapper: wrapper(checkpoint),
    });

    await act(() => result.current.dispatch({ type: "increment" }));
    await act(() => result.current.dispatch({ type: "confirm" }));
    expect(result.current.canGoBack).toBe(false);
    act(() => result.current.back());
    expect(result.current.currentStep.id).toBe("done");

    act(() => result.current.reset());
    await act(() => result.current.dispatch({ type: "increment" }));
    await act(() => result.current.dispatch({ type: "confirm" }));

    expect(checkpoint).toHaveBeenCalledOnce();
    expect(checkpoint).toHaveBeenCalledWith({
      assignmentRequirementId: "assignment-1",
      attemptId: "attempt-1",
      scenarioId: "counter-flow",
      checkpointId: "confirmed",
      outcomeId: undefined,
      idempotencyKey: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      ),
      terminal: true,
    });
  });

  it("preserves progress for Resume later and resets on Exit", async () => {
    const launcher = document.createElement("button");
    document.body.append(launcher);
    const launcherRef = { current: launcher };
    const focus = vi.spyOn(launcher, "focus");
    const { result } = renderHook(() => useTraining<{ count: number }>(), {
      wrapper: wrapper(vi.fn(), launcherRef),
    });

    await act(() => result.current.dispatch({ type: "increment" }));
    act(() => result.current.resumeLater());
    expect(result.current.active).toBe(false);
    act(() => result.current.resume());
    expect(result.current.state.count).toBe(1);

    act(() => result.current.exit());
    expect(result.current.active).toBe(false);
    expect(result.current.state.count).toBe(0);
    expect(focus).toHaveBeenCalled();
  });

  it("restores simulation-only progress after a remount and clears it on exit", async () => {
    const first = renderHook(() => useTraining<{ count: number }>(), {
      wrapper: wrapper(vi.fn(), createRef<HTMLButtonElement>(), true),
    });
    await act(() => first.result.current.dispatch({ type: "increment" }));
    first.unmount();

    const resumed = renderHook(() => useTraining<{ count: number }>(), {
      wrapper: wrapper(vi.fn(), createRef<HTMLButtonElement>(), true),
    });
    expect(resumed.result.current.state.count).toBe(1);
    expect(resumed.result.current.currentStep.id).toBe("confirm");

    act(() => resumed.result.current.exit());
    expect(window.sessionStorage.length).toBe(0);
  });
});
