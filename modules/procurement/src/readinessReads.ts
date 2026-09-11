export async function readReadinessIndependently<T extends { id: string }, R>(
  records: T[],
  read: (record: T) => Promise<R>,
): Promise<{ rows: R[]; errors: Record<string, string> }> {
  const results = await Promise.all(records.map(async record => {
    try { return { id: record.id, value: await read(record) }; }
    catch { return { id: record.id, error: 'Policy readiness could not be loaded. Please retry.' }; }
  }));
  return {
    rows: results.flatMap(result => result.value === undefined ? [] : [result.value]),
    errors: Object.fromEntries(results.filter(result => result.error).map(result => [result.id, result.error!])),
  };
}
