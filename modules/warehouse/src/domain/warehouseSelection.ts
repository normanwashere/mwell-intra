/** New work must not silently select the first of several warehouses. */
export function selectedWarehouse(
  locations: readonly { id: string; type: string; active?: boolean }[],
  selected: string,
): string {
  const eligible = locations.filter(location => location.type === 'warehouse' && location.active !== false);
  if (selected) return eligible.some(location => location.id === selected) ? selected : '';
  return eligible.length === 1 ? eligible[0]!.id : '';
}
