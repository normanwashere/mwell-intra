import { describe, expect, it } from "vitest";
import { loadLiveProductWorkspace, mapReadiness } from "./data";
import { canAcknowledgeOperationsHandoff, kitReadiness } from './domain';

describe("Product live data scoping", () => {
  it.each([true, false, undefined])('UX24 maps the actual live shape and current-package gate: %s', is_current => {
    const mapped = mapReadiness({ id: 'r1', product_id: 'p1', status: 'approved', is_current, evidence: [] })!;
    expect(kitReadiness(mapped)).toMatchObject({ state: 'not_required', ready: true });
    expect(canAcknowledgeOperationsHandoff(mapped)).toBe(is_current === true);
  });
  it.each(['draft', 'active', 'retired', 'absent', 'denied'])('UX24 reads real kit-definition fields without a circular handoff gate: %s', status => {
    const client = { schema: () => ({ from: (table: string) => {
      const query = { select: () => query, order: () => query, in: () => query,
        limit: async () => ({ error: table === 'kit_definitions' && status === 'denied' ? { message: 'Kit read denied' } : null,
          data: table === 'readiness_packages' ? [{ id: 'r1', product_id: 'p1', status: 'approved', is_current: true, evidence: [] }]
            : table === 'kit_definitions' && !['absent', 'denied'].includes(status) ? [{ id: 'k1', product_id: 'p1', version: 2, status, product_approval_reference: 'PROD-APPROVAL-42' }] : [] }) };
      return query;
    } }) };
    return loadLiveProductWorkspace(client as never).then(result => {
      expect(result.readiness[0]?.kitPublication?.status).toBe(status === 'absent' ? 'not_visible' : status === 'denied' ? 'unavailable' : status);
      expect(canAcknowledgeOperationsHandoff(result.readiness[0]!)).toBe(true);
      if (!['absent', 'denied'].includes(status)) expect(result.readiness[0]?.kitPublication?.approvalReference).toBe('PROD-APPROVAL-42');
    });
  });
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
