import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GET } from "../../app/api/knowledge/tasks/route";

const state = vi.hoisted(() => ({ memory: false, error: false, user: null as null | { app_metadata: Record<string, unknown>; user_metadata?: Record<string, unknown> } }));
vi.mock("@shell/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => state.memory ? null : ({ auth: { getUser: async () => ({ data: { user: state.user }, error: state.error ? new Error("Unauthenticated") : null }) } }),
}));
beforeEach(() => {
  state.memory = false; state.error = false; state.user = null;
  vi.stubEnv("NEXT_PUBLIC_DATA_SOURCE", "memory");
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("MWELL_MEMORY_SIMULATION_TEST", "0");
});
afterEach(() => vi.unstubAllEnvs());

it.each([
  ["supabase", "production", "0"],
  ["memory", "production", "0"],
  ["supabase", "test", "1"],
  ["", "development", "0"],
])("does not serve demo tasks for missing client with source=%s env=%s flag=%s", async (source, environment, flag) => {
  state.memory = true;
  vi.stubEnv("NEXT_PUBLIC_DATA_SOURCE", source);
  vi.stubEnv("NODE_ENV", environment);
  vi.stubEnv("MWELL_MEMORY_SIMULATION_TEST", flag);
  const response = await GET(new Request("http://localhost/api/knowledge/tasks?demoProfile=demo-admin"));
  expect(await response.json()).toEqual({ tasks: [], unavailable: true });
});

it("allows an explicitly opted-in production memory simulation", async () => {
  state.memory = true;
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("MWELL_MEMORY_SIMULATION_TEST", "1");
  const body = await (await GET(new Request("http://localhost/api/knowledge/tasks?demoProfile=demo-vendor"))).json();
  expect(body.demo).toBe(true);
  expect(body.tasks.length).toBeGreaterThan(0);
});

it.each([false, true])("returns 401 for absent or rejected server authentication (error=%s)", async (error) => {
  state.error = error;
  if (error) state.user = { app_metadata: { kind: "employee", roles: { core: ["platform_admin"] } } };
  const response = await GET();
  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({ tasks: [] });
  expect(response.headers.get("cache-control")).toBe("private, no-store");
});

it("returns explicit memory unavailability, not a privileged demo catalog", async () => {
  state.memory = true;
  const response = await GET();
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ tasks: [], unavailable: true });
});

it("uses trusted employee roles for the returned tasks", async () => {
  state.user = { app_metadata: { kind: "employee", roles: { warehouse: ["warehouse_operator"] } } };
  const response = await GET();
  const body = await response.json();
  expect(body.tasks.map((task: { id: string }) => task.id)).toContain("receive-inspect-stock");
  expect(body.tasks.every((task: { audience: string }) => task.audience === "internal")).toBe(true);
  expect(body.tasks.map((task: { id: string }) => task.id)).not.toContain("review-access-request");
});

it("does not accept client query/header roles or editable user metadata", async () => {
  state.user = { app_metadata: { kind: "employee", roles: {} }, user_metadata: { roles: { core: ["platform_admin"] } } };
  const request = new Request("http://localhost/api/knowledge/tasks?roles=platform_admin&kind=employee", { headers: { "x-user-roles": "platform_admin" } });
  const response = await GET(request);
  expect(await response.json()).toEqual({ tasks: [] });
});

it("uses only enumerated demo profile roles when no server client exists", async () => {
  state.memory = true;
  const response = await GET(new Request("http://localhost/api/knowledge/tasks?demoProfile=demo-warehouse-operator&roles=platform_admin"));
  const body = await response.json();
  expect(body.demo).toBe(true);
  expect(body.tasks.map((task: { id: string }) => task.id)).toContain("receive-inspect-stock");
  expect(body.tasks.map((task: { id: string }) => task.id)).not.toContain("review-access-request");
});

it("keeps the enumerated vendor demo catalog vendor-only", async () => {
  state.memory = true;
  const response = await GET(new Request("http://localhost/api/knowledge/tasks?demoProfile=demo-vendor&kind=employee&roles=platform_admin"));
  const body = await response.json();
  expect(body.tasks.length).toBeGreaterThan(0);
  expect(body.tasks.every((task: { audience: string }) => task.audience === "vendor")).toBe(true);
});

it("rejects an unknown demo profile instead of accepting supplied roles", async () => {
  state.memory = true;
  const response = await GET(new Request("http://localhost/api/knowledge/tasks?demoProfile=unknown&roles=platform_admin"));
  expect(await response.json()).toEqual({ tasks: [], unavailable: true });
});

it("ignores demoProfile on live requests including unauthenticated requests", async () => {
  const request = new Request("http://localhost/api/knowledge/tasks?demoProfile=demo-admin");
  expect((await GET(request)).status).toBe(401);
  state.user = { app_metadata: { kind: "vendor", roles: { core: ["vendor_portal"] } } };
  const body = await (await GET(request)).json();
  expect(body.demo).toBeUndefined();
  expect(body.tasks.length).toBeGreaterThan(0);
  expect(body.tasks.every((task: { audience: string }) => task.audience === "vendor")).toBe(true);
});

it("keeps vendor tasks vendor-only despite mixed privileged trusted roles", async () => {
  state.user = { app_metadata: { kind: "vendor", roles: { core: ["vendor_portal", "platform_admin"], warehouse: ["warehouse_operator"] } } };
  const response = await GET();
  const body = await response.json();
  expect(body.tasks.length).toBeGreaterThan(0);
  expect(body.tasks.every((task: { audience: string; actionHref: string }) => task.audience === "vendor" && (task.actionHref === "/vendor" || task.actionHref.startsWith("/vendor/")))).toBe(true);
  expect(body.tasks.map((task: { id: string }) => task.id)).not.toContain("receive-inspect-stock");
  expect(response.headers.get("cache-control")).toBe("private, no-store");
});
