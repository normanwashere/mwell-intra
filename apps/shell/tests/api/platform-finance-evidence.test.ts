import { beforeEach, expect, it, vi } from 'vitest';
const state=vi.hoisted(()=>({getUser:vi.fn(),rpc:vi.fn(),signed:vi.fn(),bucket:vi.fn()}));
vi.mock('@shell/lib/supabase/server',()=>({createSupabaseServerClient:async()=>({auth:{getUser:state.getUser},schema:()=>({rpc:state.rpc})})}));
vi.mock('@shell/lib/supabase/admin',()=>({createSupabaseAdminClient:()=>({storage:{from:(bucket:string)=>{state.bucket(bucket);return {createSignedUrl:state.signed};}}})}));
import { POST } from '@shell/app/api/finance/evidence/route';
const id='11111111-1111-4111-8111-111111111111';
const request=()=>new Request('https://intra.test/api/finance/evidence',{method:'POST',headers:{origin:'https://intra.test','Content-Type':'application/json'},body:JSON.stringify({entryId:id,storage_path:'attacker-path'})});
beforeEach(()=>{
  vi.clearAllMocks();
  state.getUser.mockResolvedValue({data:{user:{id:'reader'}},error:null});
  state.rpc.mockResolvedValue({data:{bucket:'procurement-requests',storage_path:'request/registered.pdf',filename:'proof.pdf'},error:null});
  state.signed.mockResolvedValue({data:{signedUrl:'https://storage.test/signed'},error:null});
});
it('signs only server-authorized registered evidence with a five-minute expiry',async()=>{
  const response=await POST(request());
  expect(response.status).toBe(200);
  expect(state.rpc).toHaveBeenCalledWith('platform_close_evidence',{p_entry:id});
  expect(state.bucket).toHaveBeenCalledWith('procurement-requests');
  expect(state.signed).toHaveBeenCalledWith('request/registered.pdf',300,{download:'proof.pdf'});
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  expect(await response.json()).toEqual({url:'https://storage.test/signed'});
});
it('does not sign denied, unauthenticated, cross-origin or malformed paths',async()=>{
  state.rpc.mockResolvedValue({error:{message:'wrong source'},data:null});
  expect((await POST(request())).status).toBe(403);
  state.getUser.mockResolvedValue({data:{user:null},error:null});
  expect((await POST(request())).status).toBe(401);
  const foreign=request(); foreign.headers.set('origin','https://foreign.test');
  expect((await POST(foreign)).status).toBe(403);
  expect(state.signed).not.toHaveBeenCalled();
});
it('does not leak arbitrary path or public URL responses',async()=>{
  for(const storage_path of ['../private.pdf','https://public.test/file','/absolute.pdf']) {
    state.rpc.mockResolvedValue({data:{bucket:'documents',storage_path},error:null});
    expect((await POST(request())).status).toBe(403);
  }
  expect(state.signed).not.toHaveBeenCalled();
});
