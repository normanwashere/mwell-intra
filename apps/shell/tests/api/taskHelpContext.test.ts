import { expect, it, vi } from "vitest";
import { GET } from "../../app/api/knowledge/context/route";

const auth = vi.hoisted(() => ({ kind: "vendor", memory: false }));
vi.mock("@shell/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => auth.memory ? null : ({ auth: { getUser: async () => ({ data: { user: { app_metadata: { kind: auth.kind } } }, error: null }) } }),
}));

it("does not disclose internal feature help to a vendor even with client role claims", async () => {
  auth.kind = "vendor";
  auth.memory = false;
  const response = await GET(new Request("http://localhost/api/knowledge/context?article=feature-procurement-request-create&kind=employee"));
  expect(await response.json()).toEqual({ guide: null });
});

it("returns minimal exact feature guidance for a server-authenticated employee", async () => {
  auth.kind = "employee";
  auth.memory = false;
  const response = await GET(new Request("http://localhost/api/knowledge/context?article=feature-procurement-request-create"));
  const body = await response.json();
  expect(body.guide.href).toBe("/knowledge?article=feature-procurement-request-create");
  expect(body.guide.controls.length).toBeGreaterThan(0);
  expect(Object.keys(body.guide).sort()).toEqual(["completionEvidence", "controls", "exceptions", "href", "purpose", "title"]);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
});

it("keeps memory guidance explicitly unavailable", async () => {
  auth.memory = true;
  const response = await GET(new Request("http://localhost/api/knowledge/context?article=feature-procurement-request-create"));
  expect(await response.json()).toEqual({ guide: null, unavailable: true });
  auth.memory = false;
});
