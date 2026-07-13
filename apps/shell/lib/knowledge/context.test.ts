import { describe, expect, it } from "vitest";
import { KNOWLEDGE_CONTENT } from "./content";
import { featureGuideForPathname } from "./context";
import { CONTEXTUAL_FEATURE_GUIDES } from "./contextIndex";

describe("contextual Knowledge Base guidance", () => {
  it("indexes every currently implemented feature route", () => {
    const expected = KNOWLEDGE_CONTENT.features
      .filter((feature) => feature.availability !== "coming_soon")
      .map((feature) => ({
        id: feature.id,
        title: feature.title,
        routes: feature.routes,
      }));

    expect(CONTEXTUAL_FEATURE_GUIDES).toEqual(expected);
  });

  it("prefers the exact page over a dynamic record route", () => {
    expect(
      featureGuideForPathname(
        CONTEXTUAL_FEATURE_GUIDES,
        "/procurement/requests/new",
      )?.id,
    ).toBe("procurement-request-create");
    expect(
      featureGuideForPathname(
        CONTEXTUAL_FEATURE_GUIDES,
        "/procurement/requests/REQ-42",
      )?.id,
    ).toBe("procurement-request-detail");
  });

  it("documents contextual guidance as part of the live Knowledge Base", () => {
    const library = KNOWLEDGE_CONTENT.features.find(
      (feature) => feature.id === "knowledge-library",
    );

    expect(
      library?.controls.some(
        (control) => control.name === "Open contextual guidance",
      ),
    ).toBe(true);
    expect(
      KNOWLEDGE_CONTENT.features.some((feature) => feature.id === "context"),
    ).toBe(false);
  });
});
