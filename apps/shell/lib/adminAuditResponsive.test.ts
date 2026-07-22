import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const auditPageSource = readFileSync(
  new URL("../app/admin/audit/page.tsx", import.meta.url),
  "utf8",
);

describe("admin audit responsive layout", () => {
  it("wraps long audit references without truncating their contents", () => {
    expect(auditPageSource).toContain('data-testid="audit-entity-reference"');
    expect(auditPageSource).toContain(
      'className="mt-2 max-w-full break-words text-sm text-muted [overflow-wrap:anywhere]"',
    );
    expect(auditPageSource).not.toContain("truncate");
    expect(auditPageSource).not.toContain("text-ellipsis");
  });

  it("contains and wraps long structured audit detail values", () => {
    expect(auditPageSource).toContain('data-testid="audit-event-detail"');
    expect(auditPageSource).toContain("whitespace-pre-wrap");
    expect(auditPageSource).toContain("[overflow-wrap:anywhere]");
    expect(auditPageSource).toContain("overflow-x-hidden");
  });

  it("allows every audit list layer to shrink within a mobile viewport", () => {
    expect(auditPageSource).toContain(
      '<ol className="min-w-0 max-w-full space-y-3">',
    );
    expect(auditPageSource).toContain(
      '<li key={row.id} className="min-w-0 max-w-full">',
    );
    expect(auditPageSource).toContain(
      '<Card className="min-w-0 max-w-full overflow-hidden p-4">',
    );
  });
});
