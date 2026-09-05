import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { FollowupQueue } from '../../work/src/FollowupQueue';
const state=vi.hoisted(()=>({rpc:vi.fn(),client:{schema:vi.fn()}}));
vi.mock('@intra/auth',()=>({useSession:()=>({mode:'supabase',supabaseClient:state.client,profile:{id:'owner'}})}));
beforeEach(()=>{vi.clearAllMocks();state.client.schema.mockReturnValue({rpc:state.rpc});});
it('owner acknowledges and resolves, and persisted resolution survives remount',async()=>{
  let row={id:'followup-a',metric_id:'finance-metric',area:'finance',reason_code:'target_breach',status:'open',can_act:true} as Record<string,unknown>;
  state.rpc.mockImplementation(async(name:string,args:{payload?:Record<string,unknown>})=>{
    if(name==='platform_transition_followup') row={...row,status:args.payload?.action==='acknowledge'?'acknowledged':'resolved',acknowledged_by:'owner',acknowledged_at:'2026-09-05',...(args.payload?.action==='resolve'?{resolved_by:'owner',resolved_at:'2026-09-05',resolution_reference:args.payload.resolution_reference}:{})};
    return {data:name==='platform_followup_page'?[row]:row,error:null};
  });
  const view=render(<FollowupQueue />);
  fireEvent.click(await screen.findByRole('button',{name:'Acknowledge'}));
  const reference=await screen.findByLabelText('Resolution record reference');
  fireEvent.change(reference,{target:{value:'FIN-2026-009'}});
  fireEvent.click(screen.getByRole('button',{name:'Resolve'}));
  await screen.findByText(/Resolved by owner.*FIN-2026-009/);
  view.unmount();render(<FollowupQueue />);
  await screen.findByText(/Resolved by owner.*FIN-2026-009/);
  expect(screen.queryByRole('button',{name:'Resolve'})).not.toBeInTheDocument();
  expect(state.rpc).toHaveBeenCalledWith('platform_transition_followup',{payload:{id:'followup-a',action:'resolve',resolution_reference:'FIN-2026-009'}});
});
it('requester readback offers no owner mutation and failures do not claim empty work',async()=>{
  state.rpc.mockResolvedValue({data:[{id:'a',metric_id:'finance-metric',status:'acknowledged',reason_code:'target_breach',area:'finance',can_act:false}],error:null});
  const view=render(<FollowupQueue />);
  await screen.findByText('finance-metric / finance');
  expect(screen.queryByRole('button',{name:'Resolve'})).not.toBeInTheDocument();
  view.unmount();state.rpc.mockResolvedValue({data:null,error:{message:'Source unavailable'}});
  render(<FollowupQueue />);
  await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('Source unavailable'));
  expect(screen.queryByText('No follow-ups in your scope.')).not.toBeInTheDocument();
});
