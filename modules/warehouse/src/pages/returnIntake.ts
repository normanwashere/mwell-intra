import type { ReturnInput, WarehouseData } from "@/data/repository";
import { resolveWarehouseScan } from "@/components/camera/WarehouseScanFlow";

export interface ReturnIntakeLine {
  id: number;
  productId: string;
  quantity: number;
  reason: string;
  serials: string;
}

export function parseReturnSerials(value: string): string[] {
  return value.split(/[\s,;]+/).filter(Boolean);
}

export function prepareReturnLines(
  data: WarehouseData,
  drafts: readonly ReturnIntakeLine[],
  eventId?: string,
): { lines: ReturnInput["lines"]; errors: (string | null)[] } {
  const lines: ReturnInput["lines"] = [];
  const seen = new Set<string>();
  const errors = drafts.map((draft) => {
    const product = data.products.find((item) => item.id === draft.productId);
    if (!product) return "Select a product.";
    if (!Number.isSafeInteger(draft.quantity) || draft.quantity < 1) {
      return "Quantity must be a positive whole number.";
    }
    if (!draft.reason.trim()) return "Select a return reason.";
    const line = {
      productId: product.id,
      quantity: draft.quantity,
      reason: draft.reason,
      disposition: "quarantine" as const,
    };
    if (!product.serialized) {
      lines.push(line);
      return null;
    }
    const serials = parseReturnSerials(draft.serials);
    if (serials.length !== draft.quantity) {
      return `Expected ${draft.quantity} serial number${draft.quantity === 1 ? "" : "s"}; entered ${serials.length}.`;
    }
    for (const serial of serials) {
      const normalized = serial.toLowerCase();
      if (seen.has(normalized))
        return `${serial} is already included in this return.`;
      const resolution = resolveWarehouseScan({
        data,
        context: "return",
        code: serial,
        expectedProductId: product.id,
        expectedEventId: eventId || undefined,
      });
      if (!resolution.ok) return resolution.message;
      seen.add(normalized);
      // The existing return command traces one device per line.
      lines.push({
        ...line,
        quantity: 1,
        serialNumber: resolution.serialNumber,
      });
    }
    return null;
  });
  return { lines: errors.some(Boolean) ? [] : lines, errors };
}
