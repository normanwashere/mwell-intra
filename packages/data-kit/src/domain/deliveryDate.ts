export function deliveryToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function validateActualDeliveryDate(value: string | undefined, today = deliveryToday()): void {
  if (value === undefined) return;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000") ||
      !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value || value > today) {
    throw new Error("Actual delivery date must be a valid calendar date on or before today (Philippines).");
  }
}
