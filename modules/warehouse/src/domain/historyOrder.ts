export function newestFirst(a: { createdAt: string; id: string }, b: { createdAt: string; id: string }): number {
  const timestamp = (value: string) => {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : -Infinity;
  };
  const first = timestamp(a.createdAt);
  const second = timestamp(b.createdAt);
  if (first !== second) return first > second ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
