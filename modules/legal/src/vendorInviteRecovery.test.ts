import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const rootSource = (relativePath: string) =>
  readFileSync(resolve(process.cwd(), "../..", relativePath), "utf8");

describe("vendor invitation delivery recovery", () => {
  it("allows the delivery function to retry an existing governed invite", () => {
    const edge = rootSource(
      "supabase/functions/vendor-invite-delivery/index.ts",
    );

    expect(edge).toContain("invite_id?: string");
    expect(edge).toContain("body?.invite_id");
    expect(edge).toContain('.from("vendor_invites")');
  });

  it("keeps password setup on an explicitly allowlisted Intra origin", () => {
    const edge = rootSource(
      "supabase/functions/vendor-invite-delivery/index.ts",
    );
    const route = rootSource(
      "apps/shell/app/api/legal/vendor-invites/route.ts",
    );

    expect(edge).toContain("redirect_origin?: string");
    expect(edge).toContain("https://mwell-intra-uat.vercel.app");
    expect(edge).toContain("inviteRedirectOrigin(body?.redirect_origin)");
    expect(route).toContain("redirect_origin: request.nextUrl.origin");
  });

  it("exposes retry through the live invite repository", () => {
    const store = rootSource("modules/legal/src/localStore.ts");

    expect(store).toContain("retry: (inviteId: string)");
    expect(store).toContain("body: JSON.stringify({ invite_id: inviteId })");
  });

  it("keeps failed delivery visible and actionable on the case", () => {
    const page = rootSource("modules/legal/src/pages/CaseDetailPage.tsx");

    expect(page).toContain("Invitation email was not delivered");
    expect(page).toContain("Retry invitation email");
    expect(page).toContain("invite.status === 'delivery_failed'");
  });
});
