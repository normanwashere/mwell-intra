// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CreateRequestPage } from './CreateRequestPage';

const profile = { id: 'requester', name: 'Test Requester' };
const toast = { success: vi.fn(), error: vi.fn() }, add = vi.fn();
vi.mock('@intra/auth', () => ({ Guard: ({children}:{children:ReactNode}) => children, useCan: () => true, useSession: () => ({profile, mode:'memory'}) }));
vi.mock('@intra/ui', async () => ({ ...await vi.importActual('@intra/ui'), useToast: () => toast }));
vi.mock('../localStore', () => ({ useProcurementRequests: () => ({add}), useProcurementVendors: () => [] }));
let root: Root, host: HTMLDivElement;
const originalScroll = HTMLElement.prototype.scrollIntoView;
beforeEach(() => {
  (globalThis as unknown as {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
  vi.stubGlobal('matchMedia',()=>({matches:false,addEventListener:vi.fn(),removeEventListener:vi.fn(),addListener:vi.fn(),removeListener:vi.fn()}));
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
  add.mockClear();toast.error.mockClear();
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(async()=>{await act(async()=>{await new Promise(resolve=>setTimeout(resolve,0));root.unmount();});host.remove();HTMLElement.prototype.scrollIntoView=originalScroll;vi.restoreAllMocks();vi.unstubAllGlobals();});
function Location(){return <output>{useLocation().pathname}</output>;}
async function mount(){await act(async()=>root.render(<MemoryRouter initialEntries={['/requests/new']}><CreateRequestPage/><Location/></MemoryRouter>));}
async function editTitle(value='Unsaved test request'){
  const input=host.querySelector<HTMLInputElement>('#title')!;
  await act(async()=>{
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,value);
    input.dispatchEvent(new Event('input',{bubbles:true}));
  });
}
it('warns on browser exit only after an edit and preserves the form when Cancel is chosen',async()=>{
  await mount();
  const initial=new Event('beforeunload',{cancelable:true});window.dispatchEvent(initial);expect(initial.defaultPrevented).toBe(false);
  await editTitle();
  const leave=new Event('beforeunload',{cancelable:true});window.dispatchEvent(leave);expect(leave.defaultPrevented).toBe(true);
  const confirm=vi.spyOn(window,'confirm').mockReturnValue(false);
  await act(async()=>{[...host.querySelectorAll('a')].find(link=>link.textContent?.trim()==='Cancel')!.click();});
  expect(confirm).toHaveBeenCalled();expect(host.querySelector('output')!.textContent).toBe('/requests/new');
  expect(host.querySelector<HTMLInputElement>('#title')!.value).toBe('Unsaved test request');expect(add).not.toHaveBeenCalled();
});
it('does not turn Continue into a save or bypass required fields',async()=>{
  await mount();await editTitle();
  await act(async()=>{[...host.querySelectorAll('button')].find(button=>button.textContent?.includes('Continue'))!.click();});
  expect(add).not.toHaveBeenCalled();expect(toast.error).toHaveBeenCalled();
  expect(host.querySelector('#title')).not.toBeNull();
});
it('does not warn after edits are reverted to the original form',async()=>{
  await mount();await editTitle();await editTitle('');
  const leave=new Event('beforeunload',{cancelable:true});window.dispatchEvent(leave);expect(leave.defaultPrevented).toBe(false);
});
