import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TaskLearningSummary } from "./TaskLearningSummary";
import type { TaskLearningProjection } from "./taskReadiness";

const task = {
  id: "receive",
  title: "Receive a delivery",
  outcome: "Record inspected delivery evidence",
  actionCapabilities: [],
};
const projection: TaskLearningProjection = {
  status: "known",
  neededNow: [],
  otherRequired: [],
  optional: [],
};
describe("TaskLearningSummary", () => {
  it("shows a compact task outcome and disclosures without promising access", () => {
    render(<TaskLearningSummary task={task} projection={projection} />);
    expect(
      screen.getByRole("heading", { name: task.title }),
    ).toBeInTheDocument();
    expect(screen.getByText(task.outcome)).toBeInTheDocument();
    expect(
      screen.getByText(/Role permissions and record checks still apply/),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Other required learning (0)").closest("details"),
    ).not.toHaveAttribute("open");
    expect(
      screen.getByText("Optional guidance (0)").closest("details"),
    ).not.toHaveAttribute("open");
  });
  it("does not show a ready claim for an unavailable projection", () => {
    render(
      <TaskLearningSummary
        task={task}
        projection={{ ...projection, status: "unavailable" }}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("unavailable");
    expect(
      screen.queryByText(/No outstanding learning/),
    ).not.toBeInTheDocument();
  });
});
