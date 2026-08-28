import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ToastProvider } from '@intra/ui';
import { FinanceClosePanel } from './FinanceClosePanel';
import { isSupportedFinanceEvidenceReference, openLiveFinanceCloseEvidence, validateFinanceCloseEntry } from '../data';

const id='11111111-1111-4111-8111-111111111111';
const reference=`evidence://${id}`;
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });
it('uploads against the selected Finance source and fills the immutable registered evidence identity', async () => {
  const manage=vi.fn().mockResolvedValue({});
  const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({reference,document_id:id,filename:'proof.pdf'})));
  vi.stubGlobal('fetch',fetcher);
  render(<ToastProvider><FinanceClosePanel entries={[]} manage={manage} openEvidence={vi.fn()} canManage currentActorId="actor-A" /></ToastProvider>);
  fireEvent.click(screen.getByRole('button',{name:'Prepare close entry'}));
  fireEvent.change(screen.getByLabelText('Canonical source ID'),{target:{value:'PO-A'}});
  fireEvent.change(screen.getByLabelText('Source reference'),{target:{value:'PO-A'}});
  fireEvent.change(screen.getByLabelText('Amount (PHP)'),{target:{value:'100'}});
  fireEvent.change(screen.getByLabelText('Upload evidence'),{target:{files:[new File(['%PDF-1.4'],'proof.pdf',{type:'application/pdf'})]}});
  expect(screen.getByRole('button',{name:'Prepare for posting'})).toBeDisabled();
  await screen.findByText('proof.pdf');
  expect(screen.getByLabelText('Registered evidence ID')).toHaveValue(id);
  expect(screen.getByLabelText('Registered evidence ID')).toBeDisabled();
  expect(screen.getByLabelText('Evidence type')).toHaveValue('core_document');
  expect(fetcher.mock.calls[0]![1].body.get('source_id')).toBe('PO-A');
  fireEvent.click(screen.getByRole('button',{name:'Prepare for posting'}));
  await waitFor(() => expect(manage).toHaveBeenCalledWith(expect.objectContaining({sourceRecordId:'PO-A',
    evidenceRecordId:id,evidenceRecordType:'core_document',evidenceUrl:reference})));
});
it('validates durable references and opens non-Event Finance uploads through the authorized API', async () => {
  expect(isSupportedFinanceEvidenceReference(reference)).toBe(true);
  expect(validateFinanceCloseEntry({action:'save',sourceRecordType:'purchase_order',sourceRecordId:'PO-A',
    evidenceRecordType:'core_document',evidenceRecordId:id,evidenceUrl:reference,amount:100})).toEqual([]);
  const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({url:'https://storage.test/signed?token=fresh'})));
  vi.stubGlobal('fetch',fetcher);
  expect(await openLiveFinanceCloseEvidence({} as never,{evidenceUrl:reference,sourceRecordType:'purchase_order',sourceRecordId:'PO-A'} as never))
    .toBe('https://storage.test/signed?token=fresh');
  expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toEqual({action:'open',reference});
});
it('allows a canonical evidence identity without a URL and leaves resolution to the server', async () => {
  const manage=vi.fn().mockResolvedValue({});
  render(<ToastProvider><FinanceClosePanel entries={[]} manage={manage} openEvidence={vi.fn()} canManage currentActorId="actor-A" /></ToastProvider>);
  fireEvent.click(screen.getByRole('button',{name:'Prepare close entry'}));
  fireEvent.change(screen.getByLabelText('Canonical source ID'),{target:{value:'PO-A'}});
  fireEvent.change(screen.getByLabelText('Source reference'),{target:{value:'PO-A'}});
  fireEvent.change(screen.getByLabelText('Amount (PHP)'),{target:{value:'100'}});
  expect(screen.getByRole('button',{name:'Prepare for posting'})).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Registered evidence ID'),{target:{value:id}});
  expect(screen.getByLabelText('Evidence URL')).toHaveValue('');
  expect(screen.getByRole('button',{name:'Prepare for posting'})).toBeEnabled();
  fireEvent.click(screen.getByRole('button',{name:'Prepare for posting'}));
  await waitFor(() => expect(manage).toHaveBeenCalledWith(expect.objectContaining({sourceRecordId:'PO-A',
    evidenceRecordType:'payment_release',evidenceRecordId:id,evidenceUrl:''})));
});
