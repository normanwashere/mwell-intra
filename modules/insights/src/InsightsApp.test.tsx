// @vitest-environment jsdom
import * as React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import type { InsightArea } from './types';

const state = vi.hoisted(() => ({ rpc: vi.fn(), areas: ['executive', 'finance'] as InsightArea[] }));
vi.mock('@intra/auth', () => ({ useSession: () => ({ profile: { id: 'u1' }, userRoles: { insights: ['executive'] }, userCapabilities: {}, mode: 'supabase', loading: false, supabaseClient: { schema: () => ({ rpc: state.rpc }) } }) }));
vi.mock('./data', async original => ({ ...await original<typeof import('./data')>(),
  useOnlineStatus: () => true,
  useInsightsData: () => ({ loading: false, error: null, refresh: vi.fn(), areas: state.areas,
    data: { metrics: [{ id: 'm1', label: 'Test indicator', area: 'executive', value: 10, targetDirection: 'informational', status: 'stale', sampleCount: 1, sourceHref: '/finance', reportingPeriodStart: null, reportingPeriodEnd: null, sourceUpdatedAt: null }], extractedAt: null } }),
}));
vi.mock('@intra/ui', () => ({
  userFacingError: (value: string) => value,
  Icon: () => null,
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ModuleHero: () => <h1>Insights</h1>,
  HeroChipButton: () => null,
  EmptyState: () => <p>No indicators</p>,
  SignInPrompt: () => null,
  SkeletonStats: () => null,
  SegmentedControl: ({ options, onChange }: { options: { value: string; label: string }[]; onChange(value: string): void }) => <div>{options.map(option => <button key={option.value} onClick={() => onChange(option.value)}>{option.label}</button>)}</div>,
  Sheet: ({ open, children, footer }: { open: boolean; children: React.ReactNode; footer: React.ReactNode }) => open ? <div role="dialog">{children}{footer}</div> : null,
}));
import { InsightsApp } from './InsightsApp';

afterEach(() => { vi.unstubAllGlobals(); state.rpc.mockReset(); state.areas = ['executive', 'finance']; });

async function mount() {
  vi.stubGlobal('React', React);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  window.history.replaceState(null, '', '/insights/executive');
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<InsightsApp initialArea="executive" />));
  return { host, root, close: async () => { await act(async () => root.unmount()); host.remove(); } };
}
const button = (host: HTMLElement, label: string) => [...host.querySelectorAll('button')].find(item => item.textContent === label)!;

it('keeps indicator identity, target, provenance and follow-up together in a responsive comparison row', async () => {
  const view = await mount();
  try {
    const row = view.host.querySelector('article[data-insight-metric="m1"]')!;
    expect(row.getAttribute('aria-label')).toBe('Test indicator');
    expect(row.querySelector('h2')?.textContent).toBe('Test indicator');
    expect(row.textContent).toContain('Informational');
    expect(row.textContent).toContain('1 records');
    expect(row.textContent).toContain('Source updated');
    expect(row.textContent).toContain('Reporting period');
    expect(row.className).toContain('xl:grid-cols-');
    expect(row.className).not.toContain('min-h-56');
    expect(button(row as HTMLElement, 'Escalate indicator')).toBeDefined();
    expect(view.host.querySelector('section[aria-label="Operational indicators"]')).not.toBeNull();
  } finally { await view.close(); }
});

it.each(['denied', 'network'])('UX22 retains reason, focus and retry key with an in-dialog %s error', async failure => {
  state.rpc.mockImplementationOnce(async () => { if (failure === 'network') throw new Error('Network failure'); return { error: { message: 'Permission denied' } }; })
    .mockResolvedValueOnce({ data: { id: 'followup-1' }, error: null });
  const view = await mount();
  try {
    await act(async () => button(view.host, 'Escalate indicator').click());
    const reason = view.host.querySelector<HTMLSelectElement>('#insight-followup-reason')!;
    await act(async () => { reason.value = 'definition_question'; reason.dispatchEvent(new Event('change', { bubbles: true })); });
    const submit = button(view.host, 'Create accountable follow-up'); submit.focus();
    await act(async () => submit.click());
    expect(view.host.querySelector('[role="dialog"] [role="alert"]')?.textContent).toContain('Retry uses the same request');
    expect(reason.value).toBe('definition_question');
    expect(document.activeElement).toBe(submit);
    await act(async () => submit.click());
    expect(state.rpc.mock.calls[0]?.[1]).toEqual(state.rpc.mock.calls[1]?.[1]);
    expect(view.host.querySelector('[role="dialog"]')).toBeNull();
    expect(view.host.textContent).toContain('Follow-up followup-1');
  } finally { await view.close(); }
});

it('UX06 synchronizes desktop/mobile selection and history, refusing unauthorized areas', async () => {
  const view = await mount();
  try {
    await act(async () => button(view.host, 'Finance').click());
    expect(window.location.pathname).toBe('/insights/finance');
    const selector = view.host.querySelector<HTMLSelectElement>('#insights-area')!;
    expect(selector.value).toBe('finance');
    await act(async () => { window.history.replaceState(null, '', '/insights/executive'); window.dispatchEvent(new PopStateEvent('popstate')); });
    expect(selector.value).toBe('executive');
    await act(async () => { selector.value = 'finance'; selector.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(window.location.pathname).toBe('/insights/finance');
    state.areas = ['executive'];
    await act(async () => view.root.render(<InsightsApp initialArea="executive" />));
    expect(view.host.querySelector('[role="alert"]')?.textContent).toContain('outside your permitted scope');
    expect(view.host.textContent).not.toContain('Test indicator');
  } finally { await view.close(); }
});
