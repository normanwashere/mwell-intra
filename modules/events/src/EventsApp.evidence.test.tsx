import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ToastProvider } from '@intra/ui';
const state=vi.hoisted(() => ({save:vi.fn().mockResolvedValue({}), open:vi.fn(), reference:'', status:'draft', roles:{events:['coordinator']}}));
vi.mock('@intra/auth',async (original) => ({...await original<typeof import('@intra/auth')>(),
  useSession:() => ({profile:{id:'actor-A',email:'actor@example.com',kind:'employee'},userRoles:state.roles,loading:false})}));
vi.mock('./data',async (original) => ({...await original<typeof import('./data')>(),useEventsData:() => ({
  data:{events:[{id:'event-A',name:'Evidence Event',type:'b2c',startDate:'2026-09-01',issuedUnits:1,reservedUnits:0,returnedUnits:0,lifecycle:'planned'}],
    reconciliations:[{eventId:'event-A',status:state.status,soldUnits:1,giveawayUnits:0,returnedUnits:0,lostUnits:0,damagedUnits:0,rekitUnits:0,
      grossSalesAmount:100,evidenceUrl:state.reference,updatedAt:'2026-08-01T00:00:00Z'}],warnings:[]},
  loading:false,error:null,refresh:vi.fn(),saveReconciliation:state.save,openReconciliationEvidence:state.open,isDemo:false,
})}));
import { EventsApp } from './EventsApp';
import { openLiveEventReconciliationEvidence } from './data';
const id='11111111-1111-4111-8111-111111111111';
const reference=`evidence://${id}`;
afterEach(() => {vi.unstubAllGlobals();vi.restoreAllMocks();state.save.mockClear();state.open.mockReset();state.reference='';state.status='draft';state.roles={events:['coordinator']};});
it('submits a local attachment as registered Event evidence', async () => {
  const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({reference,document_id:id,filename:'settlement.pdf'})));
  vi.stubGlobal('fetch',fetcher);
  render(<ToastProvider><EventsApp eventId="event-A" /></ToastProvider>);
  fireEvent.click(screen.getByRole('button',{name:'Submit to Finance'}));
  fireEvent.change(screen.getByLabelText('Upload evidence'),{target:{files:[new File(['%PDF-1.4'],'settlement.pdf',{type:'application/pdf'})]}});
  expect(screen.getByRole('button',{name:'Submit reconciliation'})).toBeDisabled();
  await screen.findByText('settlement.pdf');
  expect(fetcher.mock.calls[0]![1].body.get('source_type')).toBe('event_reconciliation');
  expect(fetcher.mock.calls[0]![1].body.get('source_id')).toBe('event-A');
  fireEvent.click(screen.getByRole('button',{name:'Submit reconciliation'}));
  await waitFor(() => expect(state.save).toHaveBeenCalledWith(expect.objectContaining({eventId:'event-A',action:'submit',evidenceUrl:reference})));
});
it('loads persisted registered evidence for independent Finance approval without an editable attachment', async () => {
  state.reference=reference;state.status='submitted';state.roles={events:['finance_reviewer']};
  render(<ToastProvider><EventsApp eventId="event-A" /></ToastProvider>);
  fireEvent.click(screen.getByRole('button',{name:'Review settlement'}));
  expect(screen.getByText('Registered evidence')).toBeInTheDocument();
  expect(screen.queryByLabelText('Upload evidence')).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Finance reference'),{target:{value:'FIN-A'}});
  fireEvent.click(screen.getByRole('button',{name:'Approve settlement'}));
  await waitFor(() => expect(state.save).toHaveBeenCalledWith(expect.objectContaining({action:'approve',evidenceUrl:reference})));
});
it('resolves saved Event evidence only after the existing Event authorization lookup', async () => {
  const rpc=vi.fn().mockResolvedValue({data:{evidence_url:reference},error:null});
  const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({url:'https://storage.test/fresh'})));
  vi.stubGlobal('fetch',fetcher);
  expect(await openLiveEventReconciliationEvidence({schema:() => ({rpc})} as never,'event-A')).toBe('https://storage.test/fresh');
  expect(rpc).toHaveBeenCalledWith('open_event_reconciliation_evidence',{payload:{event_id:'event-A'}});
  expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toEqual({action:'open',reference});
});
it('does not open a late preview after switching away from its Event', async () => {
  state.reference=reference;
  let resolve!: (url:string) => void;
  state.open.mockReturnValue(new Promise<string>((yes) => {resolve=yes;}));
  const open=vi.spyOn(window,'open').mockReturnValue(null);
  const view=render(<ToastProvider><EventsApp eventId="event-A" /></ToastProvider>);
  fireEvent.click(screen.getByRole('button',{name:'Open evidence'}));
  view.rerender(<ToastProvider><EventsApp eventId="event-B" /></ToastProvider>);
  await act(async () => resolve('https://storage.test/old-preview'));
  expect(open).not.toHaveBeenCalled();
});
