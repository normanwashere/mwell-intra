import { expect, it } from "vitest";
import { NextRequest } from "next/server";
import { sameOriginTestBaseUrl } from "../helpers/playwrightOrigin";

it.each(["http://127.0.0.1:3040", "http://[::1]:3040", "http://localhost:3040"])(
  "aligns the browser origin with the actual NextRequest URL for %s",
  (input) => {
    const base = sameOriginTestBaseUrl(input);
    const url = new URL("/api/learning/simulation-choice", base);
    const request = new NextRequest(url, { headers: { origin: url.origin } });
    expect(url.origin).toBe("http://localhost:3040");
    expect(request.headers.get("origin")).toBe(new URL(request.url).origin);
  },
);

it("documents the original loopback-header mismatch without weakening it", () => {
  const url = "http://127.0.0.1:3040/api/learning/simulation-choice";
  const request = new NextRequest(url, { headers: { origin: new URL(url).origin } });
  expect(new URL(request.url).origin).toBe("http://localhost:3040");
  expect(request.headers.get("origin")).toBe("http://127.0.0.1:3040");
});

it.each([
  "https://mwell-intra-uat.vercel.app",
  "https://example.invalid/base?test=1",
  "http://192.0.2.1:3040",
  "http://localhost:3040",
])("preserves non-loopback URLs and existing localhost spelling: %s", (input) => {
  expect(sameOriginTestBaseUrl(input)).toBe(input);
});

it("retains the port and path when aligning a loopback URL", () => {
  expect(sameOriginTestBaseUrl("http://127.0.0.1:4321/base?test=1"))
    .toBe("http://localhost:4321/base?test=1");
});
