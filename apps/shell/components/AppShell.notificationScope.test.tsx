// @vitest-environment jsdom
import React, { act, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { notificationScopeKey } from '../lib/notificationScopeKey';

afterEach(() => vi.unstubAllGlobals());

describe('AppShell notification scope mount boundary', () => {
  it('wires the raw snapshot and principal to the Bell key, not the whole shell', () => {
    const source = readFileSync(resolve(process.cwd(), 'components/AppShell.tsx'), 'utf8');
    expect(source).toMatch(/const \{[^}]*roleCapabilities[^}]*\} = useSession\(\)/);
    expect(source).toContain('<NotificationBell key={notificationScopeKey({ mode, principalId: profileId, roleCapabilities })} />');
    expect(source).not.toContain('notificationScopeKey({ mode, principalId: profileId, roleCapabilities: userCapabilities');
  });

  it('remounts state on actor/null/authority boundaries but preserves ordinary same-scope refreshes', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    let mounts = 0;
    const retired = vi.fn();
    const staleUpdates: Array<() => void> = [];
    function StatefulBellProbe() {
      const [cached, setCached] = useState('empty');
      useEffect(() => {
        mounts++;
        staleUpdates.push(() => setCached('old-response'));
        return retired;
      }, []);
      return <button onClick={() => setCached('cached-open')}>{cached}</button>;
    }
    const renderScope = async (principalId: string | null, globalRead = false) => {
      const key = notificationScopeKey({ mode: 'supabase', principalId, roleCapabilities: globalRead ? { core: ['manage_notifications'] } : {} });
      await act(async () => root.render(<StatefulBellProbe key={key} />));
    };
    try {
      await renderScope('A');
      await act(async () => container.querySelector('button')!.click());
      await renderScope('A');
      expect(container.textContent).toBe('cached-open');
      expect(mounts).toBe(1);
      for (const [actor, globalRead] of [[null, false], ['B', false], ['A', false], ['A', true], ['A', false]] as const) {
        await renderScope(actor, globalRead);
        expect(container.textContent).toBe('empty');
      }
      expect(mounts).toBe(6);
      expect(retired).toHaveBeenCalledTimes(5);
      await act(async () => staleUpdates[0]!());
      expect(container.textContent).toBe('empty');
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
});
