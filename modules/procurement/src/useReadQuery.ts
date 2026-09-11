'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// Key every result to its access scope; late reads cannot restore another session's data.
export function useReadQuery<T>(scope: unknown, key: string, read: () => Promise<T[]>): [T[], boolean, () => Promise<void>, string | undefined] {
  const readRef = useRef(read);
  readRef.current = read;
  const generation = useRef(0);
  const [state, setState] = useState<{ scope: unknown; key: string; rows: T[]; loading: boolean; error?: string }>({ scope, key, rows: [], loading: Boolean(scope) });
  const refresh = useCallback(async () => {
    const operation = ++generation.current;
    if (!scope) { setState({ scope, key, rows: [], loading: false }); return; }
    setState(current => ({ scope, key, rows: current.scope === scope && current.key === key ? current.rows : [], loading: true }));
    try {
      const rows = await readRef.current();
      if (operation === generation.current) setState({ scope, key, rows, loading: false });
    } catch {
      if (operation === generation.current) setState({ scope, key, rows: [], loading: false, error: 'Records could not be loaded. Please retry.' });
    }
  }, [scope, key]);
  useEffect(() => { void refresh(); return () => { generation.current++; }; }, [refresh]);
  return state.scope === scope && state.key === key
    ? [state.rows, state.loading, refresh, state.error]
    : [[], Boolean(scope), refresh, undefined];
}
