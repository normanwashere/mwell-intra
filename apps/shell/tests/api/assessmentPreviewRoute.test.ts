import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { POST } from "../../app/api/learning/assessment-preview/route";

const command = {
  requirementId: "internal.warehouse.receiving-controls-assessment.v1",
  assignmentRequirementId: "test-assignment",
  attemptId: "test-attempt",
  answers: [
    { questionId: "receiving-identifiers", answerId: "capture-identifiers" },
    { questionId: "receiving-exception", answerId: "controlled-quality" },
  ],
};
const request = (body: unknown = command, origin = "http://localhost:3040") =>
  new Request("http://localhost:3040/api/learning/assessment-preview", {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("NEXT_PUBLIC_DATA_SOURCE", "memory");
});
afterEach(() => vi.unstubAllEnvs());

it.each(["0", "1"])("denies production preview scoring even with memory simulation flag %s", async (flag) => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("MWELL_MEMORY_SIMULATION_TEST", flag);
  const response = await POST(request());
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: "Preview assessment scoring is unavailable." });
});

it("denies preview scoring for the live data source", async () => {
  vi.stubEnv("NEXT_PUBLIC_DATA_SOURCE", "supabase");
  expect((await POST(request())).status).toBe(404);
});

it("denies cross-origin commands", async () => {
  expect((await POST(request(command, "https://example.invalid"))).status).toBe(403);
});

it("returns only the authoritative score for a complete local assessment", async () => {
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({ score: 100 });
});

it.each([
  { ...command, score: 100 },
  { ...command, answers: command.answers.slice(0, 1) },
  { ...command, answers: [command.answers[0], command.answers[0]] },
  { ...command, answers: [{ ...command.answers[0], answerId: "unknown" }, command.answers[1]] },
])("rejects malformed or authority-bearing commands %#", async (body) => {
  const response = await POST(request(body));
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "Preview assessment could not be scored." });
});
