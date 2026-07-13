import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260706092500_warehouse_demo_auth_users.sql",
  ),
  "utf8",
);

describe("optional warehouse demo seed boundary", () => {
  it("requires an operator-supplied password instead of embedding one", () => {
    expect(migration).not.toMatch(/crypt\('[^']+'/);
    expect(migration).toContain(
      "current_setting('mwell.seed_demo_password', true)",
    );
    expect(migration).toContain(
      "mwell.seed_demo_password must contain at least 16 characters",
    );
    expect(migration).toContain("crypt(demo_password, gen_salt('bf'))");
  });
});
