// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PolicyEvidenceForm } from './PolicyEvidenceForm';
let host: HTMLDivElement; let root: Root;
beforeEach(() => { (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
async function submitForm() { await act(async () => { host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }); }
it('never submits an incomplete business form and displays field validation', async () => {
 const submit = vi.fn();
 await act(async () => root.render(createElement(PolicyEvidenceForm,{submit})));
 await submitForm();
 expect(submit).not.toHaveBeenCalled();
 expect(host.textContent).toContain('Select a supported policy requirement.');
 const control=host.querySelector('select')!;
 await act(async () => { control.value='IMPORT_PLAN'; control.dispatchEvent(new Event('change',{bubbles:true})); });
 await submitForm();
 expect(submit).not.toHaveBeenCalled();
 expect(host.textContent).toContain('Importer of record is required.');
 expect(host.textContent).not.toContain('JSON');
});
it('submits business inputs as the existing evidence payload and retains input on failure', async () => {
 const submit=vi.fn().mockRejectedValue(new Error('offline'));
 await act(async () => root.render(createElement(PolicyEvidenceForm,{submit})));
 const control=host.querySelector('select')!;
 await act(async () => { control.value='RFQ_COMMERCIAL_COMPARISON'; control.dispatchEvent(new Event('change',{bubbles:true})); });
 const fields=host.querySelectorAll('textarea');
 for(const [index, field] of [...fields].entries()) await act(async () => {
   Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(field,index===0?'Comparison 42':'Best-value recommendation');
   field.dispatchEvent(new Event('input',{bubbles:true}));
 });
 await submitForm();
 expect(submit).toHaveBeenCalledWith({controlCode:'RFQ_COMMERCIAL_COMPARISON',evidenceType:'document',facts:{reference:'Comparison 42',summary:'Best-value recommendation'}});
 expect(host.querySelector('textarea')?.value).toBe('Comparison 42');
 expect(host.textContent).toContain('Your entries are retained');
});
