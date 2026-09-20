// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WorkApp } from './WorkApp';

const state = vi.hoisted(() => ({ errors: [] as string[], refresh: vi.fn() }));
vi.mock('@intra/auth', () => ({ useSession: () => ({ profile: { id:'actor',kind:'employee' },loading:false }) }));
vi.mock('./FollowupQueue', () => ({ FollowupQueue: () => null }));
vi.mock('./data', async original => ({ ...await original<typeof import('./data')>(), useWorkData: () => ({ loading:false,error:null,refresh:state.refresh,data:{items:[{id:'a',source:'procurement',title:'Approve PR-1',description:'Review request',status:'submitted',priority:'normal',href:'/procurement/requests/pr-1'}]} }) }));
vi.mock('./tracking', () => ({ useWorkTracking: () => ({loading:false,errors:state.errors,refresh:state.refresh,coverage:'Your latest purchase and stock requests.',items:[
  {id:'draft',source:'procurement',title:'Draft PR-2',status:'Draft',owner:'You',nextStep:'Submit',bucket:'action',href:'/procurement/requests/pr-2'},
  {id:'wait',source:'warehouse',title:'Ring request',status:'Approved',owner:'Warehouse',nextStep:'Picking',bucket:'waiting',href:'/warehouse/fulfillment?tab=requests&request=wait'},
  {id:'done',source:'warehouse',title:'Closed request',status:'Closed',owner:'Requester',nextStep:'Review evidence',bucket:'completed',href:'/warehouse/fulfillment?tab=requests&request=done'},
  {id:'load',source:'procurement',title:'Volume-only request',status:'Draft',owner:'Requester',nextStep:'Submit',bucket:'action',href:'/procurement/requests/load',classification:{purpose:'load-only'}},
]}) }));
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT:boolean }).IS_REACT_ACT_ENVIRONMENT=true;
  state.errors=[]; state.refresh.mockClear(); window.history.replaceState(null,'','/work');
  host=document.createElement('div'); document.body.append(host); root=createRoot(host);
});
afterEach(async () => { await act(async()=>root.unmount()); host.remove(); });
async function render() { await act(async()=>root.render(<WorkApp allowedSources={['procurement','warehouse']} />)); }
async function choose(label: string) {
  const button=[...host.querySelectorAll('button')].find(button=>button.textContent?.includes(label));
  expect(button).toBeDefined(); await act(async()=>button!.click());
}
it('separates request work, navigates views and restores a valid history state', async () => {
  await render();
  expect(host.textContent).toContain('Draft PR-2');
  expect(host.textContent).not.toContain('Ring request');
  await choose('Waiting on someone else');
  expect(window.location.search).toBe('?view=waiting');
  expect(host.querySelector('a[aria-label="Open tracked request: Ring request"]')?.getAttribute('href')).toContain('request=wait');
  expect(host.textContent).not.toContain('Draft PR-2');
  await choose('Recently completed');
  expect(host.textContent).toContain('Closed request');
  await act(async()=>{window.history.replaceState(null,'','/work?view=waiting');window.dispatchEvent(new PopStateEvent('popstate'));});
  expect(host.querySelector('button[aria-pressed="true"]')?.textContent).toContain('Waiting on someone else');
});
it('keeps a failed tracking read distinct from an empty or completed queue', async () => {
  state.errors=['Unavailable']; await render(); await choose('Waiting on someone else');
  expect(host.querySelector('[role=alert]')?.textContent).toContain('list may be incomplete');
  expect(host.textContent).not.toContain('No matching tracked requests');
  await choose('Retry tracking'); expect(state.refresh).toHaveBeenCalledTimes(1);
});
it('clamps a source outside the current module scope and restores the search', async () => {
  window.history.replaceState(null,'','/work?view=waiting&source=legal&q=Ring');
  await render();
  expect(host.querySelector('select')?.value).toBe('all');
  expect(host.querySelector('input')?.value).toBe('Ring');
  expect(host.textContent).toContain('Ring request');
});
it('hides only classified load fixtures in explicit UAT mode and restores them through the record selector', async () => {
  window.history.replaceState(null, '', '/work?uat=1');
  await render();
  expect(host.textContent).not.toContain('Volume-only request');
  expect(host.textContent).toContain('Draft PR-2');
  const select = host.querySelector<HTMLSelectElement>('select[aria-label="Record visibility"]');
  expect(select).not.toBeNull();
  await act(async () => { select!.value = 'all'; select!.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(host.textContent).toContain('Volume-only request');
  expect(window.location.search).toContain('records=all');
});
