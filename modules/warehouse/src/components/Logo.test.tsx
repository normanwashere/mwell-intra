import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Logo } from "./Logo";

describe("Logo", () => {
  it("uses the canonical Mwell wordmark", () => {
    render(<Logo title="Mwell Intra" />);

    const logo = screen.getByRole("img", { name: "Mwell Intra" });
    expect(logo.querySelector("img")).toHaveAttribute(
      "src",
      "/mwell-wordmark.png",
    );
  });

  it("keeps the approved color artwork legible on dark surfaces", () => {
    render(<Logo title="Mwell Intra" variant="light" />);

    expect(
      screen.getByRole("img", { name: "Mwell Intra" }).querySelector("img"),
    ).toHaveClass("brightness-0", "invert");
  });
});
