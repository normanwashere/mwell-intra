import { describe, expect, it } from "vitest";
import { loadLiveProductWorkspace } from "./data";

describe("Product live data scoping", () => {
  it("does not query pricing for an Operations-only Product role", async () => {
    const tables: string[] = [];
    const client = {
      schema: () => ({
        from: (table: string) => {
          tables.push(table);
          const builder = {
            select: () => builder,
            order: () => builder,
            limit: async () => ({ data: [], error: null }),
          };
          return builder;
        },
      }),
    } as unknown as Parameters<typeof loadLiveProductWorkspace>[0];

    const result = await loadLiveProductWorkspace(client, {
      readiness: true,
      pricing: false,
    });

    expect(tables).toEqual(["readiness_packages"]);
    expect(result.pricing).toEqual([]);
    expect(result.warnings).toEqual([]);
  });
});
