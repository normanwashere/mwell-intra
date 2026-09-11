import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DesktopNavigationToggle, useDesktopNavigation } from "@intra/ui";

function Harness() {
  const navigation = useDesktopNavigation();
  return <>
    <DesktopNavigationToggle hidden={navigation.hidden} onToggle={navigation.toggle} controls="test-navigation" />
    <aside id="test-navigation" style={navigation.hidden ? { display: "none" } : undefined}>Navigation</aside>
    <input aria-label="Unsaved note" defaultValue="Keep this draft" />
  </>;
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });

describe("desktop navigation preference", () => {
  it("hides and restores navigation with keyboard without resetting page inputs", async () => {
    render(<Harness />);
    const user = userEvent.setup();
    const toggle = screen.getByRole("button", { name: "Hide side navigation" });
    expect(toggle).toHaveAttribute("aria-controls", "test-navigation");
    toggle.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByText("Navigation")).not.toBeVisible();
    expect(toggle).toHaveFocus();
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("textbox")).toHaveValue("Keep this draft");
    await user.keyboard(" ");
    expect(screen.getByText("Navigation")).toBeVisible();
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });

  it("restores the preference after shell remount and responds to another tab", async () => {
    const view = render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "Hide side navigation" }));
    view.unmount();
    render(<Harness />);
    expect(screen.getByRole("button", { name: "Show side navigation" })).toBeInTheDocument();
    act(() => {
      localStorage.removeItem("intra.desktop-navigation.hidden");
      window.dispatchEvent(new StorageEvent("storage", { key: "intra.desktop-navigation.hidden" }));
    });
    expect(screen.getByText("Navigation")).toBeVisible();
  });

  it("still toggles when browser storage is blocked", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("Blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Blocked"); });
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "Hide side navigation" }));
    expect(screen.getByText("Navigation")).not.toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Show side navigation" }));
    expect(screen.getByText("Navigation")).toBeVisible();
  });
});
