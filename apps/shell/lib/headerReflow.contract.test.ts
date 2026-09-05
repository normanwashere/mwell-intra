import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("shell header enlarged-text reflow", () => {
  it("wraps the toolbar and bounds its wrapping actions without shrinking text or targets", () => {
    const source = readFileSync(resolve(process.cwd(), "components/AppShell.tsx"), "utf8");
    expect(source).toContain("flex flex-wrap items-center justify-between gap-3 px-4");
    expect(source).toContain("flex min-w-0 flex-1 basis-[5rem] items-center gap-2 md:hidden");
    expect(source).toContain('className="flex max-w-full shrink-0 flex-wrap items-center justify-end gap-1.5"');
    expect(source).toContain('data-shell-header-actions="true"');
    expect(source).toContain("grid h-11 w-11 place-items-center");
  });
});
