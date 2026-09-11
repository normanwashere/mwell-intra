const filters = new Set(['authoring', 'active', 'closed']);
const sorts = new Set(['poNumber', 'total', 'updatedAt']);

export function poListSort(params: URLSearchParams) {
  return { key: sorts.has(params.get('sort') ?? '') ? params.get('sort') : null, dir: params.get('dir') === 'desc' ? 'desc' as const : 'asc' as const };
}

export function poDetailPath(id: string, list: URLSearchParams) {
  const context = new URLSearchParams();
  if (filters.has(list.get('filter') ?? '')) context.set('fromFilter', list.get('filter')!);
  const sort = poListSort(list);
  if (sort.key) { context.set('fromSort', sort.key); context.set('fromDir', sort.dir); }
  return `/purchase-orders/${encodeURIComponent(id)}${context.size ? '?'+context : ''}`;
}

export function poReturnPath(search: string) {
  const context = new URLSearchParams(search), list = new URLSearchParams();
  if (filters.has(context.get('fromFilter') ?? '')) list.set('filter', context.get('fromFilter')!);
  if (sorts.has(context.get('fromSort') ?? '')) {
    list.set('sort', context.get('fromSort')!);
    list.set('dir', context.get('fromDir') === 'desc' ? 'desc' : 'asc');
  }
  return `/procurement/purchase-orders${list.size ? '?'+list : ''}`;
}
