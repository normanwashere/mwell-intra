import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoachOverlay } from "./CoachOverlay";
import type { TrainingStep } from "./training/types";

const step: TrainingStep = {
  id: "receive",
  title: "Choose the purchase order",
  instruction: "Select the order shown in the practice brief.",
  anchor: "[data-onboarding-anchor='purchase-order']",
  allowedCommands: ["select-order"],
};

afterEach(() => {
  document.body.innerHTML = "";
});

function visible(element: HTMLElement, rect: Partial<DOMRect> = {}) {
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
    x: 100,
    y: 100,
    top: 100,
    left: 100,
    right: 300,
    bottom: 160,
    width: 200,
    height: 60,
    toJSON: () => ({}),
    ...rect,
  } as DOMRect);
  vi.spyOn(element, "getClientRects").mockReturnValue({
    0: element.getBoundingClientRect(),
    length: 1,
    item: () => element.getBoundingClientRect(),
    [Symbol.iterator]: function* () {
      yield element.getBoundingClientRect();
    },
  } as DOMRectList);
}

describe("CoachOverlay", () => {
  it("stops safely when the anchor is missing or ambiguous", () => {
    const { rerender } = render(
      <CoachOverlay step={step} canGoBack={false} onBack={vi.fn()} onExit={vi.fn()} onResumeLater={vi.fn()} />,
    );
    expect(screen.getByRole("heading", { name: "Training needs an update" })).toBeInTheDocument();

    const first = document.createElement("button");
    const second = document.createElement("button");
    first.dataset.onboardingAnchor = "purchase-order";
    second.dataset.onboardingAnchor = "purchase-order";
    document.body.append(first, second);
    visible(first);
    visible(second);
    rerender(
      <CoachOverlay step={{ ...step, id: "receive-again" }} canGoBack={false} onBack={vi.fn()} onExit={vi.fn()} onResumeLater={vi.fn()} />,
    );
    expect(screen.getByText("The highlighted control is missing or appears more than once.")).toBeInTheDocument();
  });

  it("contains a malformed selector as an update state instead of crashing", () => {
    render(
      <CoachOverlay
        step={{ ...step, anchor: "[broken" }}
        canGoBack={false}
        onBack={vi.fn()}
        onExit={vi.fn()}
        onResumeLater={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Training needs an update" }),
    ).toBeInTheDocument();
  });

  it("recovers when a dynamically revealed anchor enters the DOM", async () => {
    render(
      <CoachOverlay
        step={step}
        canGoBack={false}
        onBack={vi.fn()}
        onExit={vi.fn()}
        onResumeLater={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "Training needs an update" }),
    ).toBeInTheDocument();

    const target = document.createElement("button");
    target.dataset.onboardingAnchor = "purchase-order";
    visible(target);
    document.body.append(target);

    expect(
      await screen.findByRole("heading", { name: step.title }),
    ).toBeInTheDocument();
  });

  it("focuses the coach heading and exposes keyboard-safe recovery controls", () => {
    const target = document.createElement("button");
    target.dataset.onboardingAnchor = "purchase-order";
    document.body.append(target);
    visible(target);
    const onBack = vi.fn();
    const onExit = vi.fn();
    const onResumeLater = vi.fn();
    const onContinue = vi.fn();

    render(
      <CoachOverlay step={step} canGoBack onBack={onBack} onExit={onExit} onResumeLater={onResumeLater} onContinue={onContinue} />,
    );

    expect(screen.getByRole("heading", { name: step.title })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(screen.getByRole("button", { name: "Resume later" }));
    fireEvent.click(screen.getByRole("button", { name: "Exit training" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(onBack).toHaveBeenCalledOnce();
    expect(onResumeLater).toHaveBeenCalledOnce();
    expect(onExit).toHaveBeenCalledOnce();
    expect(onContinue).toHaveBeenCalledOnce();
  });

  it("uses a mobile bottom sheet and repositions after resize", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
    const target = document.createElement("button");
    target.dataset.onboardingAnchor = "purchase-order";
    document.body.append(target);
    visible(target);

    const { rerender } = render(
      <CoachOverlay step={step} canGoBack={false} onBack={vi.fn()} onExit={vi.fn()} onResumeLater={vi.fn()} />,
    );
    expect(screen.getByRole("dialog")).toHaveAttribute("data-placement", "sheet");
    fireEvent.click(screen.getByRole("button", { name: "Minimize training coach" }));
    expect(screen.getByRole("dialog")).toHaveAttribute("data-collapsed", "true");
    rerender(
      <CoachOverlay
        step={step}
        canGoBack={false}
        onBack={vi.fn()}
        onExit={vi.fn()}
        onResumeLater={vi.fn()}
        error="Batch number is required"
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Batch number is required");
    expect(screen.getByRole("button", { name: "Minimize training coach" })).toBeVisible();

    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
    fireEvent(window, new Event("resize"));
    expect(screen.getByRole("dialog")).toHaveAttribute("data-placement", "right");
  });
});
