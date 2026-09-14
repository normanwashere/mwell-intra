// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DocumentUploader } from './DocumentUploader';

const mocks = vi.hoisted(() => ({ upload: vi.fn(), error: vi.fn(), done: vi.fn() }));
vi.mock('../localStore', () => ({ useAccreditationDocs: () => ({ upload: mocks.upload }) }));
vi.mock('@intra/ui', async original => ({ ...await original<typeof import('@intra/ui')>(), Icon: () => null, useToast: () => ({ error: mocks.error }) }));
let root: Root;
let container: HTMLDivElement;
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.clearAllMocks();
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(createElement(DocumentUploader, {
    caseId: 'case-A', vendorId: 'vendor-A', actorEmail: 'vendor@example.test',
    requirement: { id: 'req-A', requirement: 'Financial statements' } as ComponentProps<typeof DocumentUploader>['requirement'], onDone: mocks.done,
  })));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
async function pick(type = 'application/pdf') {
  const input = container.querySelector('input[type="file"]')!;
  Object.defineProperty(input, 'files', { configurable: true, value: [new File(['SYNTHETIC'], 'synthetic.pdf', { type })] });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
}
async function click(label: string) {
  const button = [...container.querySelectorAll('button')].find(button => button.textContent === label)!;
  expect(button).toBeDefined();
  await act(async () => { button.click(); await new Promise(resolve => setTimeout(resolve, 50)); });
}

it('keeps an actionable upload failure beside the selected file without closing or clearing the form', async () => {
  mocks.upload.mockRejectedValue(new Error('The selected file could not be read. Choose the original file again.'));
  await pick(); await click('Upload document');
  expect(mocks.upload).toHaveBeenCalledTimes(1);
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('Choose the original file again');
  expect(container.textContent).toContain('synthetic.pdf');
  expect(mocks.done).not.toHaveBeenCalled();
  expect(mocks.error).toHaveBeenCalledOnce();
  await click('Clear');
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

it('shows file validation inline without dispatch and clears it on a new file selection', async () => {
  await pick('text/html'); await click('Upload document');
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
  expect(mocks.upload).not.toHaveBeenCalled();
  await pick();
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

it('preserves one successful upload and its existing case, actor and completion callback', async () => {
  mocks.upload.mockResolvedValue({ id: 'doc-A', filename: 'synthetic.pdf' });
  await pick(); await click('Upload document');
  expect(mocks.upload).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ caseId: 'case-A', vendorId: 'vendor-A', requirementId: 'req-A', uploadedByEmail: 'vendor@example.test', mimeType: 'application/pdf', sizeBytes: 9 }));
  expect(mocks.done).toHaveBeenCalledExactlyOnceWith({ id: 'doc-A', filename: 'synthetic.pdf' });
  expect(container.querySelector('[role="alert"]')).toBeNull();
});
