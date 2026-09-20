// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RequestsPage } from './RequestsPage';

const state = vi.hoisted(() => ({ rows: [
  { id: 'old-approved', title: 'PO 0001 watches', status: 'approved', requesterId: 'actor', vendorName: 'Vendor One', createdAt: '2026-08-24', lines: [], approvalSteps: [] },
  ...Array.from({ length: 120 }, (_, i) => ({ id: `draft-${i}`, title: `Draft ${i}`, status: 'draft', requesterId: 'actor', createdAt: '2026-09-20', lines: [], approvalSteps: [] })),
], loading: false, refresh: vi.fn() }));
vi.mock('@intra/auth', () => ({ useSession: () => ({ mode: 'memory', profile: { id: 'actor', name: 'Employee', kind: 'employee' } }), Guard: () => null }));
vi.mock('../localStore', () => ({ useProcurementRequests: () => ({ rows: state.rows, loading: state.loading, refresh: state.refresh }) }));
let root: Root, host: HTMLDivElement;
function Detail() { const location = useLocation(), navigate = useNavigate(); return <><p data-detail>{location.pathname}{location.search}</p><button onClick={() => navigate(-1)}>Back</button></>; }
beforeEach(() => { state.loading = false; state.refresh.mockClear(); Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

it('marks the request results busy until rendered and enables Refresh only after loading', async () => {
  const render = () => root.render(<MemoryRouter><RequestsPage /></MemoryRouter>);
  state.loading = true;
  await act(async () => render());
  const refresh = () => [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Refresh')!;
  const results = () => host.querySelector('[role=region][aria-label="Purchase request results"]');
  expect(results()?.getAttribute('aria-busy')).toBe('true');
  expect(results()?.textContent).toContain('Loading requests');
  expect(refresh().disabled).toBe(true);
  expect(host.querySelector('tbody')).toBeNull();
  state.loading = false;
  await act(async () => render());
  expect(results()?.getAttribute('aria-busy')).toBe('false');
  expect(results()?.textContent).not.toContain('Loading requests');
  expect(results()?.querySelector('tbody')).not.toBeNull();
  expect(refresh().disabled).toBe(false);
  await act(async () => refresh().click());
  expect(state.refresh).toHaveBeenCalledOnce();
});

it('searches the full authorized list and restores filtered URL context after opening an exact record', async () => {
  await act(async () => root.render(<MemoryRouter initialEntries={['/requests?filter=approved&owner=mine&from=2026-08-01']}><Routes><Route path="/requests" element={<RequestsPage />} /><Route path="/requests/:id" element={<Detail />} /></Routes></MemoryRouter>));
  const input = host.querySelector<HTMLInputElement>('input[type=search]');
  expect(input).not.toBeNull();
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '0001'); input!.dispatchEvent(new Event('input', { bubbles: true })); });
  expect(host.textContent).toContain('PO 0001 watches');
  expect(host.textContent).not.toContain('Draft 119');
  const row = [...host.querySelectorAll<HTMLElement>('tbody tr')].find(element => element.textContent?.includes('PO 0001 watches'));
  expect(row).toBeDefined();
  await act(async () => row!.click());
  expect(host.querySelector('[data-detail]')?.textContent).toContain('/requests/old-approved');
  expect(host.querySelector('[data-detail]')?.textContent).toContain('fromFilter=approved');
  await act(async () => host.querySelector<HTMLButtonElement>('button')!.click());
  expect(host.querySelector<HTMLInputElement>('input[type=search]')?.value).toBe('0001');
  expect(host.querySelector('button[aria-pressed=true]')?.textContent).toContain('Approved');
});
