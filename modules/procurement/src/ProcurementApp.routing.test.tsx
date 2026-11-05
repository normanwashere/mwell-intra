// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useParams } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ProcurementApp } from './ProcurementApp';

const session = vi.hoisted(() => ({
  userRoles: { core: ['staff'], legal: ['legal_reviewer'] } as Record<string, string[]>,
}));
vi.mock('@intra/auth', () => ({ useSession: () => ({
  profile: { id: 'routing-actor' }, userRoles: session.userRoles, loading: false,
}) }));
vi.mock('@intra/ui', () => ({
  SignInPrompt: () => <div>Sign in</div>,
  SkeletonList: () => null,
  SkeletonStats: () => null,
}));
vi.mock('./components/ProcurementTabs', () => ({ ProcurementTabs: () => null }));
vi.mock('./pages/RequestsPage', () => ({ RequestsPage: () => <div>Request list</div> }));
vi.mock('./pages/CreateRequestPage', () => ({ CreateRequestPage: () => <div>Create request</div> }));
vi.mock('./pages/RequestDetailPage', () => ({ RequestDetailPage: () => <div>Request detail: {useParams().id}</div> }));
vi.mock('./pages/ApprovalInboxPage', () => ({ ApprovalInboxPage: () => <div>Approval inbox</div> }));
vi.mock('./pages/PurchaseOrdersPage', () => ({ PurchaseOrdersPage: () => <div>Purchase orders</div> }));
vi.mock('./pages/AcceptanceWorkItemPage', () => ({ AcceptanceWorkItemPage: () => <div>Acceptance work item</div> }));
vi.mock('./pages/PurchaseOrderDetailRoute', () => ({ PurchaseOrderDetailRoute: () => <div>Purchase order detail</div> }));
vi.mock('./pages/VarianceReviewPage', () => ({ VarianceReviewPage: () => <div>Variance review</div> }));

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  session.userRoles = { core: ['staff'], legal: ['legal_reviewer'] };
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function navigate(path: string) {
  window.history.replaceState(null, '', path);
  await act(async () => root.render(<ProcurementApp />));
}

it.each(['/procurement/requests/new', '/procurement/requests/new/'])(
  'redirects tier-only Legal from %s instead of treating new as a request id',
  async (path) => {
    await navigate(path);
    expect(window.location.pathname).toBe('/procurement/approvals');
    expect(host.textContent).toBe('Approval inbox');
    expect(host.textContent).not.toContain('Create request');
    expect(host.textContent).not.toContain('Request detail');
  },
);

it('retains tier-only Legal access to a concrete request review', async () => {
  await navigate('/procurement/requests/req-review-1');
  expect(window.location.pathname).toBe('/procurement/requests/req-review-1');
  expect(host.textContent).toBe('Request detail: req-review-1');
});

it('keeps the create route available to a requester with create_request', async () => {
  session.userRoles = { core: ['staff'], procurement: ['requester'] };
  await navigate('/procurement/requests/new');
  expect(window.location.pathname).toBe('/procurement/requests/new');
  expect(host.textContent).toBe('Create request');
});

it('does not give an unrelated staff member procurement access', async () => {
  session.userRoles = { core: ['staff'] };
  await navigate('/procurement/requests/new');
  expect(host.textContent).toContain('No procurement access');
  expect(host.textContent).not.toContain('Create request');
});
