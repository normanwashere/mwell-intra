import { afterEach, expect, it, vi } from 'vitest';
import { resolveEvidenceDocument, uploadEvidenceDocument } from './documentEvidence';

const id='11111111-1111-4111-8111-111111111111';
const upload=vi.fn().mockResolvedValue({error:null});
const signed=vi.fn().mockResolvedValue({data:{signedUrl:'https://storage.test/authorized'},error:null});
const from=vi.fn(() => ({upload,createSignedUrl:signed}));
const client={storage:{from}} as never;
afterEach(() => {vi.clearAllMocks();vi.unstubAllGlobals();});
it('keeps the existing Warehouse upload contract private and non-overwriting',async () => {
  vi.stubGlobal('crypto',{randomUUID:() => id});
  const file=new File(['%PDF-1.4'],'proof.pdf',{type:'application/pdf'});
  expect(await uploadEvidenceDocument(client,file,'excess-custody/custody-A')).toBe(`excess-custody/custody-A/${id}.pdf`);
  expect(from).toHaveBeenCalledWith('evidence');
  expect(upload).toHaveBeenCalledWith(`excess-custody/custody-A/${id}.pdf`,file,{contentType:'application/pdf',upsert:false});
  expect(signed).not.toHaveBeenCalled();
});
it('rejects unsigned connections, URLs, traversal, unsupported and empty files before storage',async () => {
  const file=new File(['%PDF-1.4'],'proof.pdf',{type:'application/pdf'});
  await expect(uploadEvidenceDocument(null,file,'excess-custody/A')).rejects.toThrow('signed-in');
  for (const path of ['../secret','excess-custody/../../secret','https://host.test/file','/absolute','excess-custody/A?token=secret']) {
    await expect(uploadEvidenceDocument(client,file,path)).rejects.toThrow('valid evidence record');
  }
  await expect(uploadEvidenceDocument(client,new File(['html'],'x.html',{type:'text/html'}),'excess-custody/A')).rejects.toThrow('Unsupported');
  await expect(uploadEvidenceDocument(client,new File([],'x.pdf',{type:'application/pdf'}),'excess-custody/A')).rejects.toThrow('non-empty');
  expect(from).not.toHaveBeenCalled();
});
it('resolves private Warehouse previews on demand and rejects traversal or remote paths',async () => {
  expect(await resolveEvidenceDocument(client,`excess-custody/A/${id}.pdf`)).toBe('https://storage.test/authorized');
  expect(signed).toHaveBeenCalledWith(`excess-custody/A/${id}.pdf`,300);
  for (const path of ['../secret','excess-custody/../secret','https://host.test/file','/secret']) {
    await expect(resolveEvidenceDocument(client,path)).rejects.toThrow('unavailable');
  }
  expect(signed).toHaveBeenCalledTimes(1);
});
it('accepts 4 MiB and rejects 4 MiB plus one byte before storage',async () => {
  vi.stubGlobal('crypto',{randomUUID:() => id});
  const limit=4 * 1024 * 1024;
  await expect(uploadEvidenceDocument(client,new File([new Uint8Array(limit + 1)],'large.pdf',{type:'application/pdf'}),'excess-custody/A'))
    .rejects.toThrow('4 MB');
  expect(from).not.toHaveBeenCalled();
  await expect(uploadEvidenceDocument(client,new File([new Uint8Array(limit)],'max.pdf',{type:'application/pdf'}),'excess-custody/A'))
    .resolves.toBe(`excess-custody/A/${id}.pdf`);
  expect(upload).toHaveBeenCalledTimes(1);
});
