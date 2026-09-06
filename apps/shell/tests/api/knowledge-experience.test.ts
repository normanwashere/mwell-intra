import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ server: vi.fn(), admin: vi.fn(), getUser: vi.fn(), profile: vi.fn(), limit: vi.fn(), ingest: vi.fn() }));
vi.mock("@shell/lib/supabase/server", () => ({ createSupabaseServerClient: mocks.server }));
vi.mock("@shell/lib/supabase/admin", () => ({ createSupabaseAdminClient: mocks.admin }));
import { POST } from "../../app/api/knowledge/experience/route";
const event = { eventId: "11111111-1111-4111-8111-111111111111", name: "guide_opened", articleId: "feature-knowledge-library", viewport: "desktop" };
const environmentKeys = ["KNOWLEDGE_EXPERIENCE_ENABLED", "KNOWLEDGE_EXPERIENCE_POLICY_APPROVED", "KNOWLEDGE_EXPERIENCE_HMAC_KEY"];
const originalEnvironment = Object.fromEntries(environmentKeys.map(key => [key, process.env[key]]));
afterEach(() => {
  for (const key of environmentKeys) {
    if (originalEnvironment[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnvironment[key];
  }
});
const request = (body: unknown = event, headers: Record<string,string> = {}) => new Request("https://local.test/api/knowledge/experience", {
  method: "POST", headers: { origin: "https://local.test", "content-type": "application/json", ...headers }, body: JSON.stringify(body),
});
beforeEach(() => {
  vi.resetAllMocks();
  delete process.env.KNOWLEDGE_EXPERIENCE_ENABLED;
  delete process.env.KNOWLEDGE_EXPERIENCE_POLICY_APPROVED;
  process.env.KNOWLEDGE_EXPERIENCE_HMAC_KEY = "k".repeat(64);
  mocks.getUser.mockResolvedValue({ data: { user: { id: "server-actor", user_metadata: { kind: "employee" } } }, error: null });
  mocks.profile.mockResolvedValue({ data: { kind: "vendor", status: "active" }, error: null });
  mocks.limit.mockResolvedValue({ error: null }); mocks.ingest.mockResolvedValue({ error: null });
  mocks.server.mockResolvedValue({ auth: { getUser: mocks.getUser }, rpc: mocks.limit,
    from: () => ({ select: () => ({ eq: () => ({ single: mocks.profile }) }) }) });
  mocks.admin.mockReturnValue({ schema: () => ({ rpc: mocks.ingest }) });
});
const enable = () => { process.env.KNOWLEDGE_EXPERIENCE_ENABLED = "true"; process.env.KNOWLEDGE_EXPERIENCE_POLICY_APPROVED = "true"; };
describe("optional experience endpoint", () => {
  it("defaults disabled without authentication, rate-limit or database side effects", async () => {
    expect(await (await POST(request())).json()).toEqual({ state: "disabled" });
    expect(mocks.server).not.toHaveBeenCalled(); expect(mocks.admin).not.toHaveBeenCalled();
  });
  it("requires both explicit flags and a dedicated pseudonym key", async () => {
    process.env.KNOWLEDGE_EXPERIENCE_ENABLED = "true";
    expect(await (await POST(request())).json()).toEqual({ state: "disabled" });
    enable(); delete process.env.KNOWLEDGE_EXPERIENCE_HMAC_KEY;
    expect((await POST(request())).status).toBe(503);
    expect(mocks.server).not.toHaveBeenCalled();
  });
  it("rejects unauthenticated, cross-origin and oversized streamed bodies", async () => {
    enable();
    expect((await POST(request(event, { origin: "https://foreign.test" }))).status).toBe(403);
    expect((await POST(request({ value: "x".repeat(1100) }))).status).toBe(413);
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect((await POST(request())).status).toBe(401);
    expect(mocks.ingest).not.toHaveBeenCalled();
  });
  it("rejects forged identity and vendor/internal catalog mismatch", async () => {
    enable();
    expect((await POST(request({ ...event, actorId: "other" }))).status).toBe(400);
    expect((await POST(request({ ...event, articleId: "feature-warehouse-tasks" }))).status).toBe(400);
    expect(mocks.ingest).not.toHaveBeenCalled();
  });
  it("sends only validated enums and HMAC actor from the authenticated server identity", async () => {
    enable(); expect((await POST(request())).status).toBe(202);
    expect(mocks.limit).toHaveBeenCalledWith("check_rate_limit", { p_bucket: "knowledge.experience", p_max_per_hour: 120 });
    const payload = mocks.ingest.mock.calls[0]![1];
    expect(payload).toEqual({ p_event_id: event.eventId, p_name: "guide_opened", p_article_id: event.articleId,
      p_result: null, p_viewport: "desktop", p_audience: "vendor", p_actor_ref: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(JSON.stringify(payload)).not.toContain("server-actor");
    await POST(request()); expect(mocks.ingest.mock.calls[1]![1]).toEqual(payload);
  });
  it("fails closed on rate limits and hides transport errors without logging payloads", async () => {
    enable(); mocks.limit.mockResolvedValue({ error: { code: "42501" } });
    expect((await POST(request())).status).toBe(429); expect(mocks.admin).not.toHaveBeenCalled();
    mocks.limit.mockResolvedValue({ error: null }); mocks.ingest.mockResolvedValue({ error: { message: "secret backend detail" } });
    const response = await POST(request()); expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("secret");
  });
});
