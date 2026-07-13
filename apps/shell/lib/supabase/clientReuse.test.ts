import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = (relativePath: string) =>
  readFileSync(resolve(process.cwd(), relativePath), "utf8");

describe("authenticated Supabase browser client ownership", () => {
  it("creates the browser client only in the app provider", () => {
    const provider = source("app/providers.tsx");
    const adminUsers = source("app/admin/users/page.tsx");
    const adminDoa = source("app/admin/doa/page.tsx");

    expect(provider).toContain("createSupabaseBrowserClient()");
    expect(adminUsers).not.toContain("createSupabaseBrowserClient");
    expect(adminDoa).not.toContain("createSupabaseBrowserClient");
  });

  it("uses the session client with explicit schemas in admin features", () => {
    const adminUsers = source("app/admin/users/page.tsx");
    const adminDoa = source("app/admin/doa/page.tsx");

    expect(adminUsers).toContain("supabaseClient?.schema('core')");
    expect(adminDoa).toContain('supabaseClient?.schema("procurement")');
    expect(adminDoa).toContain('supabaseClient?.schema("core")');
  });

  it("associates DOA editor labels with their controls", () => {
    const adminDoa = source("app/admin/doa/page.tsx");

    for (const field of [
      "department",
      "version",
      "source-document",
      "effective-date",
    ]) {
      expect(adminDoa).toContain(`htmlFor="doa-${field}"`);
      expect(adminDoa).toContain(`id="doa-${field}"`);
    }
    expect(adminDoa).toContain("htmlFor={`doa-approver-${row.key}`}");
    expect(adminDoa).toContain("id={`doa-approver-${row.key}`}");
  });
});
