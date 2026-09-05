import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ToastProvider } from '@intra/ui';
import { FinanceClosePanel } from './components/FinanceClosePanel';
import { FinanceOverview } from './components/FinanceOverview';
import { closeActionReason } from './closeEligibility';
import { paymentAge, paymentUrgency } from './paymentUrgency';
import { loadFinancePages, summarizeFinanceData } from './data';
import { FINANCE_DEMO_DATA } from './seed';
import type { FinanceCloseEntry, FinancePaymentItem } from './types';
const entry: FinanceCloseEntry = {id:'close-a',periodStart:'2026-09-01',periodEnd:'2026-09-05',entryType:'cogs',sourceModule:'procurement',sourceReference:'PO-A',sourceRecordType:'purchase_order',sourceRecordId:'po-a',evidenceRecordType:'payment_release',evidenceRecordId:'pay-a',amount:100,status:'ready',evidenceUrl:'https://evidence.test/a',preparedBy:'preparer',preparedAt:'2026-09-01',updatedAt:'2026-09-01T00:00:00Z'};
afterEach(() => { localStorage.clear(); window.history.replaceState(null,'','/'); });
it('flags with a new reason, edits the same versioned entry, and retains rejected correction values', async () => {
  const manage = vi.fn().mockResolvedValue(entry);
  const view = render(<ToastProvider><FinanceClosePanel entries={[entry]} manage={manage} openEvidence={vi.fn()} canManage currentActorId="reviewer" /></ToastProvider>);
  fireEvent.click(screen.getByRole('button',{name:'Flag'}));
  fireEvent.change(screen.getByLabelText('Correction reason'),{target:{value:'Correct the cost center'}});
  fireEvent.click(screen.getByRole('button',{name:'Record correction reason'}));
  await waitFor(() => expect(manage).toHaveBeenCalledWith(expect.objectContaining({id:'close-a',action:'exception',expectedUpdatedAt:entry.updatedAt,reconciliationNote:'Correct the cost center'})));
  view.rerender(<ToastProvider><FinanceClosePanel entries={[{...entry,status:'exception',reconciliationNote:'Correct the cost center'}]} manage={manage} openEvidence={vi.fn()} canManage currentActorId="reviewer" /></ToastProvider>);
  manage.mockRejectedValue(new Error('Entry changed; refresh'));
  fireEvent.click(screen.getByRole('button',{name:'Edit and resubmit'}));
  fireEvent.change(screen.getByLabelText('Amount (PHP)'),{target:{value:'225'}});
  fireEvent.click(screen.getByRole('button',{name:'Prepare for posting'}));
  await waitFor(() => expect(manage).toHaveBeenLastCalledWith(expect.objectContaining({action:'save',id:entry.id,expectedUpdatedAt:entry.updatedAt,amount:225})));
  expect(screen.getByLabelText('Amount (PHP)')).toHaveValue(225);
});
it('renders evidence inspection without mutation authority', async () => {
  const openEvidence = vi.fn().mockRejectedValue(new Error('Source restricted'));
  render(<ToastProvider><FinanceClosePanel entries={[entry]} manage={vi.fn()} openEvidence={openEvidence} canManage={false} currentActorId="reader" /></ToastProvider>);
  fireEvent.click(screen.getByRole('button',{name:'Open evidence'}));
  await waitFor(() => expect(openEvidence).toHaveBeenCalledWith(entry));
  expect(screen.queryByRole('button',{name:'Post'})).not.toBeInTheDocument();
});
it.each(['purchase_order', 'payment_release'] as const)('selects canonical %s by business reference and reauthorizes before saving',async(type)=>{
  const reference=type==='payment_release'?'BANK-2026-009':'PO-A';
  const source={id:'po-a',type,module:'procurement',reference,party:'Vendor A',amount:100,occurred_at:'2026-09-01',href:'/procurement/purchase-orders/po-a'};
  const search=vi.fn().mockResolvedValue([source]);
  const options=vi.fn().mockResolvedValue([{id:'doc-a',type:'core_document',label:'Registered invoice'}]);
  const manage=vi.fn().mockResolvedValue(entry);
  render(<ToastProvider><FinanceClosePanel entries={[]} manage={manage} openEvidence={vi.fn()} canManage currentActorId="preparer" searchSources={search} loadEvidenceOptions={options} /></ToastProvider>);
  fireEvent.click(screen.getByRole('button',{name:'Prepare close entry'}));
  await screen.findByRole('option',{name:new RegExp(`${reference}.*Vendor A`)});
  fireEvent.change(screen.getByLabelText('Source record'),{target:{value:`${type}:po-a`}});
  await screen.findByRole('option',{name:'Registered invoice'});
  fireEvent.change(screen.getByLabelText('Eligible registered evidence'),{target:{value:'doc-a'}});
  expect(screen.getByLabelText('Canonical source ID')).toHaveAttribute('readonly');
  expect(screen.getByLabelText('Source module')).toHaveValue('procurement');
  search.mockResolvedValue([]);
  fireEvent.click(screen.getByRole('button',{name:'Prepare for posting'}));
  await screen.findByText(/Source access or canonical identity changed/);
  expect(manage).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Amount (PHP)')).toHaveValue(100);
});
it('denies an inaccessible source supplied through a deep link',async()=>{
  window.history.replaceState(null,'','/finance?close_source_type=purchase_order&close_source_id=private-po');
  const search=vi.fn().mockResolvedValue([]);
  const manage=vi.fn();
  render(<ToastProvider><FinanceClosePanel entries={[]} manage={manage} openEvidence={vi.fn()} canManage currentActorId="preparer" searchSources={search} /></ToastProvider>);
  await screen.findByText(/requested source is not available in your scope/);
  expect(screen.queryByRole('button',{name:'Prepare for posting'})).not.toBeInTheDocument();
  expect(manage).not.toHaveBeenCalled();
});
it('enforces ordinary three-actor and Event four-actor eligibility', () => {
  expect(closeActionReason(entry,'post','preparer',true)).toMatch(/independent/);
  expect(closeActionReason(entry,'post','poster',true)).toBeUndefined();
  const posted = {...entry,status:'posted' as const,postedBy:'poster',settlementApprovedBy:'settler'};
  for (const actor of ['preparer','poster','settler']) expect(closeActionReason(posted,'reconcile',actor,true)).toMatch(/independent/);
  expect(closeActionReason(posted,'reconcile','closer',true)).toBeUndefined();
  expect(closeActionReason(posted,'exception','closer',true)).toMatch(/Only draft/);
  expect(closeActionReason({...entry,sourceRecordType:'event_reconciliation'},'save','closer',true)).toMatch(/Event correction/);
});
it('pages through a smaller API cap without dropping older rows or duplicate timestamps', async () => {
  const all = Array.from({length:1005},(_,i) => ({id:String(i).padStart(5,'0'),page_key:String(i).padStart(5,'0'),occurred_at:'2026-09-01'}));
  const rpc = vi.fn(async (_:string,args:{p_after:string}) => {
    const page=all.filter(row => row.page_key>args.p_after).slice(0,37);
    return {data:{rows:page,next:page.at(-1)?.page_key ?? null,total:all.length},error:null};
  });
  const result = await loadFinancePages({schema:()=>({rpc})} as never,'activity');
  expect(result.error).toBeNull(); expect(result.data).toHaveLength(1005);
  expect(new Set(result.data.map(row=>row.id)).size).toBe(1005);
});
it('does not show unavailable inventory or unauthorized payments as zero', () => {
  render(<FinanceOverview summary={summarizeFinanceData(FINANCE_DEMO_DATA)} states={{activity:'complete',payments:'not_authorized',inventory:'error',close:'complete'}} procurement={false} />);
  expect(screen.getByText('Unavailable')).toBeInTheDocument();
  expect(screen.getAllByText('Not in your scope')).toHaveLength(2);
});
it('orders overdue and accepted unpaid packs ahead of newer future-due packs', () => {
  const base={...FINANCE_DEMO_DATA.payments[0],status:'ready_for_finance',remainingAmount:100} as FinancePaymentItem;
  const old={...base,id:'old',dueDate:'2026-09-01',preparedAt:'2026-08-01'};
  const future={...base,id:'new',dueDate:'2026-10-01',preparedAt:'2026-09-05'};
  const accepted={...old,id:'accepted',status:'accepted' as const,dueDate:'2026-08-01'};
  expect(paymentUrgency([future,old,accepted]).map(p=>p.id)).toEqual(['accepted','old','new']);
  expect(paymentAge(old,new Date('2026-09-05'))).toMatch(/Overdue.*Waiting 35 days/);
});
