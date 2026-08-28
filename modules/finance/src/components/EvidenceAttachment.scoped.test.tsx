import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { EvidenceAttachment, useEvidenceAttachment, type EvidenceDocument } from '@intra/ui';

const id = '11111111-1111-4111-8111-111111111111';
const reference = `evidence://${id}`;
const file = () => new File(['%PDF-1.4'], 'proof.pdf', { type: 'application/pdf' });
const registered = () => new Response(JSON.stringify({reference,document_id:id,filename:'proof.pdf'}));
function Harness({ target='actor-A:PO-A:open', initial='', send, choose=false }: {
  target?: string; initial?: string; send?: (file: File) => Promise<EvidenceDocument>; choose?: boolean;
}) {
  const attachment = useEvidenceAttachment(target,initial);
  return <>
    <EvidenceAttachment attachment={attachment} recordLabel="PO-A" upload={send}
      uploadScope={{sourceType:'purchase_order',sourceId:'PO-A'}}
      loadDocuments={choose ? async () => [{reference:'request-A/proof.pdf',filename:'registered.pdf',preview:async () => 'https://storage.test/preview'}] : undefined} />
    <button disabled={!attachment.canSubmit(true)} onClick={() => submitted(attachment.reference)}>Submit</button>
  </>;
}
const submitted = vi.fn();
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); submitted.mockClear(); });
function selectFile(value=file()) { fireEvent.change(screen.getByLabelText('Upload evidence'),{target:{files:[value]}}); }
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes,no) => { resolve=yes; reject=no; });
  return {promise,resolve,reject};
}

it('posts local bytes to the scoped API and submits only the durable registered reference', async () => {
  const fetcher=vi.fn().mockResolvedValue(registered());
  vi.stubGlobal('fetch',fetcher);
  render(<Harness />);
  selectFile();
  await screen.findByText('proof.pdf');
  expect(fetcher.mock.calls[0]![0]).toBe('/api/evidence');
  const body=fetcher.mock.calls[0]![1].body as FormData;
  expect(body.get('file')).toBeInstanceOf(File);
  expect(body.get('source_type')).toBe('purchase_order');
  expect(body.get('source_id')).toBe('PO-A');
  fireEvent.click(screen.getByRole('button',{name:'Submit'}));
  expect(submitted).toHaveBeenCalledWith(reference);
});
it('blocks submission while uploading and retries a failed upload', async () => {
  const pending=deferred<Response>();
  vi.stubGlobal('fetch',vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValueOnce(registered()));
  render(<Harness />);
  selectFile();
  expect(screen.getByRole('button',{name:'Submit'})).toBeDisabled();
  await act(async () => pending.resolve(new Response(JSON.stringify({error:'Denied'}),{status:403})));
  expect(screen.getByRole('alert')).toHaveTextContent('Denied');
  expect(screen.getByRole('button',{name:'Submit'})).toBeDisabled();
  fireEvent.click(screen.getByRole('button',{name:'Retry upload'}));
  await screen.findByText('proof.pdf');
  expect(screen.getByRole('button',{name:'Submit'})).toBeEnabled();
});
it.each(['actor-A:PO-B:open','actor-B:PO-A:open','actor-A:PO-A:closed'])('discards late uploads after scope changes to %s and back', async (target) => {
  const pending=deferred<EvidenceDocument>();
  const view=render(<Harness send={() => pending.promise} />);
  selectFile();
  view.rerender(<Harness target={target} send={() => pending.promise} />);
  view.rerender(<Harness send={() => pending.promise} />);
  await act(async () => pending.resolve({reference,filename:'old.pdf'}));
  expect(screen.queryByText('old.pdf')).not.toBeInTheDocument();
  expect(screen.getByRole('button',{name:'Submit'})).toBeDisabled();
});
it('removal cancels attachment selection without letting a late upload restore it', async () => {
  const pending=deferred<EvidenceDocument>();
  render(<Harness send={() => pending.promise} />);
  selectFile();
  fireEvent.click(screen.getByRole('button',{name:'Remove evidence'}));
  await act(async () => pending.resolve({reference,filename:'old.pdf'}));
  expect(screen.queryByText('old.pdf')).not.toBeInTheDocument();
  expect(screen.getByRole('button',{name:'Submit'})).toBeDisabled();
});
it('recognizes a persisted reference and requests a fresh authorized preview each time', async () => {
  const fetcher=vi.fn().mockImplementation(async () => new Response(JSON.stringify({url:'https://storage.test/fresh?token=preview'})));
  vi.stubGlobal('fetch',fetcher);
  const open=vi.spyOn(window,'open').mockReturnValue(null);
  render(<Harness initial={reference} />);
  expect(screen.getByRole('button',{name:'Submit'})).toBeEnabled();
  fireEvent.click(screen.getByRole('button',{name:'Open evidence'}));
  await waitFor(() => expect(open).toHaveBeenCalledTimes(1));
  expect(screen.getByRole('link',{name:'Open document'})).toHaveAttribute('href','https://storage.test/fresh?token=preview');
  fireEvent.click(screen.getByRole('button',{name:'Open evidence'}));
  await waitFor(() => expect(open).toHaveBeenCalledTimes(2));
  expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toEqual({action:'open',reference});
  fireEvent.click(screen.getByRole('button',{name:'Submit'}));
  expect(submitted).toHaveBeenCalledWith(reference);
});
it('ignores stale preview responses after a record switch', async () => {
  const pending=deferred<Response>();
  vi.stubGlobal('fetch',vi.fn().mockReturnValue(pending.promise));
  const open=vi.spyOn(window,'open').mockReturnValue(null);
  const view=render(<Harness initial={reference} />);
  fireEvent.click(screen.getByRole('button',{name:'Open evidence'}));
  view.rerender(<Harness target="actor-A:PO-B:open" />);
  await act(async () => pending.resolve(new Response(JSON.stringify({url:'https://storage.test/preview'}))));
  expect(open).not.toHaveBeenCalled();
});
it('shows denied previews without changing the durable reference', async () => {
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({error:'No access'}),{status:403})));
  render(<Harness initial={reference} />);
  fireEvent.click(screen.getByRole('button',{name:'Open evidence'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('No access');
  fireEvent.click(screen.getByRole('button',{name:'Submit'}));
  expect(submitted).toHaveBeenCalledWith(reference);
});
it('rejects unsupported, empty and oversized files before upload', async () => {
  const send=vi.fn();
  render(<Harness send={send} />);
  for (const bad of [new File(['x'],'x.html',{type:'text/html'}),new File([],'x.pdf',{type:'application/pdf'}),
    new File([new Uint8Array(4 * 1024 * 1024 + 1)],'x.pdf',{type:'application/pdf'})]) {
    selectFile(bad);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button',{name:'Submit'})).toBeDisabled();
  }
  expect(send).not.toHaveBeenCalled();
  expect(screen.getByRole('alert')).toHaveTextContent('4 MB');
});
it('accepts an exact 4 MiB evidence file', async () => {
  const send=vi.fn().mockResolvedValue({reference,filename:'boundary.pdf'});
  render(<Harness send={send} />);
  selectFile(new File([new Uint8Array(4 * 1024 * 1024)],'boundary.pdf',{type:'application/pdf'}));
  await screen.findByText('boundary.pdf');
  expect(send).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button',{name:'Submit'})).toBeEnabled();
});
it('rejects public, expiring and credential-bearing URLs but retains permanent links', () => {
  render(<Harness />);
  for (const value of ['evidence/private.pdf','https://user:pass@host.test/proof','https://host.test/storage/v1/object/public/documents/proof',
    'https://host.test/storage/v1/object/sign/documents/proof?token=x','https://host.test/proof?X-Amz-Signature=x']) {
    fireEvent.change(screen.getByLabelText(/Evidence URL/),{target:{value}});
    expect(screen.getByRole('button',{name:'Submit'})).toBeDisabled();
  }
  fireEvent.change(screen.getByLabelText(/Evidence URL/),{target:{value:'https://host.test/permanent'}});
  expect(screen.getByRole('button',{name:'Submit'})).toBeEnabled();
});
it('retains the Legal/Procurement registered document chooser and authorized preview contract', async () => {
  const open=vi.spyOn(window,'open').mockReturnValue(null);
  render(<Harness choose />);
  fireEvent.click(screen.getByRole('button',{name:'Choose registered document'}));
  await screen.findByRole('option',{name:'registered.pdf'});
  fireEvent.change(screen.getByLabelText('Registered document'),{target:{value:'0'}});
  fireEvent.click(screen.getByRole('button',{name:'Open evidence'}));
  await waitFor(() => expect(open).toHaveBeenCalledWith('https://storage.test/preview','_blank','noopener,noreferrer'));
  fireEvent.click(screen.getByRole('button',{name:'Submit'}));
  expect(submitted).toHaveBeenCalledWith('request-A/proof.pdf');
});
