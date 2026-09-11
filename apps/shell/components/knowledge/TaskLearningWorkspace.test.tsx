// @vitest-environment jsdom
import * as React from 'react';
import { act, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import type { TaskDefinition } from '../../lib/knowledge/taskCatalog';
import { taskSelectionQuery } from '../../../../modules/learning/src/taskSelection';

const tasks: TaskDefinition[] = Array.from({ length: 6 }, (_, i) => ({ id: `task-${i}`, title: `Task ${i}`, outcome: 'Review assigned work', actionHref: '/product', audience: 'internal', actionCapabilities: [], priority: i, roleIds: ['core_staff_only'], module: 'product', moduleLabel: 'Product', aliases: [], personaIds: [], featureId: 'product', guideHref: '/knowledge', availability: 'live' }));
vi.mock('./TaskStartLoader', () => ({ useAvailableTasks: () => tasks }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/onboarding',
  useSearchParams: () => new URLSearchParams(useSyncExternalStore(callback => { window.addEventListener('popstate', callback); return () => window.removeEventListener('popstate', callback); }, () => window.location.search)),
}));
vi.mock('next/link', () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }));
vi.mock('@intra/ui', () => ({ Icon: () => null }));
vi.mock('@intra/learning', () => ({
  taskSelectionQuery,
  useOptionalLearning: () => ({ snapshot: {}, loading: false, stale: false }),
  taskRequirementIds: () => ['req-1'],
  OnboardingCenter: ({ selectedTask }: { selectedTask?: TaskDefinition }) => selectedTask ? <section data-task-id={selectedTask.id}><h2>{selectedTask.title}</h2></section> : null,
}));
import { TaskLearningWorkspace } from './TaskLearningWorkspace';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('UX11 offers all tasks once with human roles and restores task, requirement and next on Back', async () => {
  vi.stubGlobal('React', React); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  window.history.replaceState(null, '', '/onboarding?task=task-0&requirement=req-1&next=%2Fproduct%23readiness-42');
  const nativePush = window.history.pushState.bind(window.history);
  const push = vi.spyOn(window.history, 'pushState').mockImplementation((...args) => { nativePush(...args); window.dispatchEvent(new PopStateEvent('popstate')); });
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<TaskLearningWorkspace />));
    expect(host.querySelectorAll('button[aria-label^="Select Task"]')).toHaveLength(6);
    expect(host.textContent).toContain('Core staff');
    expect(host.textContent).not.toContain('core_staff_only');
    const region = host.querySelector<HTMLElement>('[aria-label="Eligible tasks by module"]')!;
    expect(region.tabIndex).toBe(0);
    expect(region.className).toContain('max-h-80');
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Select Task 5"]')!.click());
    expect(push).toHaveBeenCalledOnce();
    expect(new URLSearchParams(window.location.search).get('next')).toBe('/product#readiness-42');
    expect(new URLSearchParams(window.location.search).get('requirement')).toBe('req-1');
    expect(document.activeElement?.textContent).toBe('Task 5');
    await act(async () => { window.history.back(); await new Promise(resolve => window.addEventListener('popstate', resolve, { once: true })); });
    expect(new URLSearchParams(window.location.search).get('task')).toBe('task-0');
    expect(new URLSearchParams(window.location.search).get('requirement')).toBe('req-1');
    expect(new URLSearchParams(window.location.search).get('next')).toBe('/product#readiness-42');
    expect(document.activeElement?.textContent).toBe('Task 0');
  } finally { await act(async () => root.unmount()); host.remove(); }
});
