'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export function parseDirectoryState(search: string) {
  const params = new URLSearchParams(search);
  const status = params.get('status');
  const kind = params.get('kind');
  const page = Number(params.get('page'));
  return {
    query: (params.get('q') ?? '').slice(0, 200),
    status: status === 'all' || status === 'inactive' ? status : 'active',
    kind: kind === 'employee' || kind === 'vendor' ? kind : 'all',
    page: Number.isSafeInteger(page) && page >= 1 && page <= 100000 ? page : 1,
    user: (params.get('user') ?? '').slice(0, 200) || null,
  } as const;
}

export function directoryUrl(search: string, patch: Record<string, string | number | null>) {
  const params = new URLSearchParams(search);
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === '' || (key === 'page' && value === 1) ||
      (key === 'status' && value === 'active') || (key === 'kind' && value === 'all')) params.delete(key);
    else params.set(key, String(value));
  }
  return `/admin/users${params.size ? `?${params}` : ''}`;
}

export function useDirectoryState(beforeChange: () => boolean = () => true) {
  const [search, setSearch] = useState('');
  const [ready, setReady] = useState(false);
  const guard = useRef(beforeChange);
  guard.current = beforeChange;
  const current = useRef({ search: '', index: 0 });
  useEffect(() => {
    const initial = { search: window.location.search, index: window.history.state?.adminDirectoryIndex ?? 0 };
    current.current = initial;
    window.history.replaceState({ ...window.history.state, adminDirectoryIndex: initial.index }, '', window.location.href);
    setSearch(initial.search);
    setReady(true);
    const pop = (event: PopStateEvent) => {
      const next = { search: window.location.search, index: window.history.state?.adminDirectoryIndex };
      if (next.search === current.current.search) return;
      if (!guard.current()) {
        event.stopImmediatePropagation();
        if (typeof next.index === 'number' && next.index !== current.current.index) window.history.go(current.current.index - next.index);
        else window.history.pushState({ ...window.history.state, adminDirectoryIndex: current.current.index }, '', directoryUrl(current.current.search, {}));
        return;
      }
      current.current = { search: next.search, index: next.index ?? 0 };
      setSearch(next.search);
    };
    window.addEventListener('popstate', pop, true);
    return () => window.removeEventListener('popstate', pop, true);
  }, []);
  const update = useCallback((patch: Record<string, string | number | null>, replace = false) => {
    if (!guard.current()) return;
    const href = directoryUrl(window.location.search, patch);
    const index = current.current.index + (replace ? 0 : 1);
    window.history[replace ? 'replaceState' : 'pushState']({ ...window.history.state, adminDirectoryIndex: index }, '', href);
    current.current = { search: window.location.search, index };
    setSearch(window.location.search);
  }, []);
  return { ...parseDirectoryState(search), ready, update };
}
