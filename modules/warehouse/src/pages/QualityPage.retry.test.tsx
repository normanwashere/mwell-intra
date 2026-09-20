import { expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InMemoryRepository } from '@/data/inMemoryRepository';
import { makeRepo, renderWithProviders } from '@/test/renderWithProviders';
import { QualityPage } from './QualityPage';

vi.mock('@/components/camera/EvidenceCapture', () => ({ EvidenceCapture: ({onChange}:{onChange:(urls:string[])=>void}) =>
  <button type="button" onClick={() => onChange(['data:image/png;base64,AAAA'])}>Attach test evidence</button> }));

it('blocks other inspection commands while an original committed batch needs confirmation', async () => {
  const data = await makeRepo().getData(); data.receipts=[]; data.returns=[];
  const repo = new InMemoryRepository(data,{storage:null});
  await repo.receiveStock({actor:'receiver',locationId:data.locations[0]!.id,lines:[{productId:'shirt-l',quantity:2}],
    receiptException:{type:'non_po',reason:'Local fixture',evidenceUrls:['test/approval.pdf']}});
  await repo.receiveStock({actor:'receiver',locationId:data.locations[0]!.id,lines:[{productId:'shirt-l',quantity:1}],
    receiptException:{type:'non_po',reason:'Separate uninspected receipt',evidenceUrls:['test/approval.pdf']}});
  const original = repo.inspectQualityBatch.bind(repo);
  const save = vi.spyOn(repo,'inspectQualityBatch').mockImplementationOnce(async input => {await original(input);throw new Error('Response lost');});
  renderWithProviders(<QualityPage />,{repo,role:'warehouse_operator'});
  const user = userEvent.setup();
  await user.click((await screen.findAllByRole('button',{name:'Select group'}))[0]!);
  await user.click(screen.getByRole('button',{name:'Review selected inspections'}));
  let dialog = await screen.findByRole('dialog');
  await user.click(within(dialog).getByRole('checkbox'));
  await user.click(within(dialog).getByRole('button',{name:'Attach test evidence'}));
  await user.click(within(dialog).getByRole('button',{name:'Submit 1 inspection'}));
  await waitFor(() => expect(within(dialog).getByRole('alert')).toHaveTextContent(/could not confirm/i));
  const pinned = structuredClone(save.mock.calls[0]![0]);
  await user.click(within(dialog).getByRole('button',{name:'Close'}));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(screen.getByRole('button',{name:'Select group'})).toBeDisabled();
  expect(screen.getByRole('button',{name:'Inspect'})).toBeDisabled();
  expect(screen.getByRole('button',{name:'Clear selection'})).toBeDisabled();
  await user.click(screen.getByRole('button',{name:'Review unconfirmed inspection'}));
  dialog = await screen.findByRole('dialog');
  await user.click(within(dialog).getByRole('button',{name:'Retry original inspection'}));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  expect(save.mock.calls[1]![0]).toEqual(pinned);
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect((await repo.listQualityInspections({limit:100})).rows).toHaveLength(1);
});
