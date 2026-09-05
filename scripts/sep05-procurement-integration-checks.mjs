import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
export async function runIntegrationChecks({db,withRole,maker,legalDecider,procurement,finance,vendorActor,vendorId,reviewId}) {
    await db.exec(`
      create schema storage;
      create table storage.objects(bucket_id text,name text,owner_id text);
      alter table storage.objects enable row level security;
      create table core.user_roles(user_id uuid,module text,role text,effective_at timestamptz default now(),expires_at timestamptz);
      create table core.roles(module text,role text,is_active boolean);
      create table core.role_capabilities(module text,role text,cap text);
      insert into core.roles values('legal','legal_reviewer',true),('procurement','finance',true),('procurement','admin',true),('procurement','approver',true),('procurement','procurement_officer',true);
      insert into core.role_capabilities select module,role,case when module='legal' then 'review_accreditation' else 'approve_request' end from core.roles;
      create table core.activity_log(module text,entity_type text,entity_id text,action text,actor uuid,detail jsonb);
      create function auth.jwt() returns jsonb language sql as $$ select '{"email":"actor@example.test"}'::jsonb $$;
      create function core.is_vendor() returns boolean language sql stable as $$ select core.current_vendor_id() is not null $$;
      create function core.has_module_role(text) returns boolean language sql stable as $$ select exists(select 1 from core.user_roles where user_id=auth.uid() and module=$1) $$;
      create function private.can_read_procurement_request(text) returns boolean language sql stable security definer as $$ select exists(select 1 from procurement.requests where id=$1 and requester_id=auth.uid()) or core.has_live_cap('procurement','author_po') or core.has_live_cap('procurement','view_finance') $$;
      alter table procurement.requests add column justification jsonb, add column decided_at timestamptz, add column decided_by_email text, add column decision_note text, add column submitted_at timestamptz;
      alter table procurement.purchase_orders add column expected_date date;
      alter table procurement.payment_readiness_packs add column prepared_at timestamptz default clock_timestamp();
      create table procurement.approval_steps(id text primary key,request_id text,status text,step_order integer,assigned_user_id uuid,tier text,label text,note text,decided_at timestamptz,decided_by_email text,signature jsonb);
    `);
    const attachmentSql = readFileSync('supabase/migrations/20260710041319_govern_procurement_attachments.sql','utf8');
    const tableStart = attachmentSql.indexOf('create table if not exists procurement.request_attachments');
    await db.exec(attachmentSql.slice(tableStart,attachmentSql.indexOf(');',tableStart)+2));
    await db.exec('alter table procurement.request_attachments enable row level security');
    const accessStart = attachmentSql.indexOf('create or replace function procurement.prepare_request_attachment_access');
    await db.exec(attachmentSql.slice(accessStart,attachmentSql.indexOf('$$;',accessStart)+3));
    const privacy = readFileSync('supabase/migrations/20260815154702_procurement_finance_requester_privacy.sql','utf8');
    await db.exec(privacy.slice(privacy.indexOf('drop policy if exists read_request_attachments'),privacy.indexOf('drop policy if exists procurement_requests_auth_insert')));
    const decisions = readFileSync('supabase/migrations/20260810155350_procurement_legal_database_authority_remediation.sql','utf8');
    const decisionStart = decisions.indexOf('create or replace function procurement.decide_request_step');
    await db.exec(decisions.slice(decisionStart,decisions.indexOf('$$;',decisionStart)+3));
    await db.exec('alter function procurement.decide_request_step(jsonb) rename to decide_request_step_uncertified_impl');
    const priorPolicy=readFileSync('supabase/migrations/20260710210000_policy_aligned_legal_procurement.sql','utf8');
    const actualFk=priorPolicy.match(/final_approval_step_id text references procurement\.approval_steps\(id\) on delete restrict/)[0];
    await db.exec(`alter table procurement.exception_packs add column ${actualFk};
      alter table procurement.approval_steps add constraint approval_steps_request_id_step_order_key unique(request_id,step_order);
      insert into procurement.requests(id,status,requester_id,title,lines) values('REVISION-FK','rejected','${maker}','Old','[]');
      insert into procurement.approval_steps(id,request_id,status,step_order,assigned_user_id,tier,note,signature) values('HISTORY-STEP','REVISION-FK','approved',1,'${legalDecider}','final_approver','Original decision','{"signer_name":"Historic approver"}');
      insert into procurement.exception_packs(request_id,exception_type,status,final_approval_step_id) values('REVISION-FK','direct_award','approved','HISTORY-STEP');`);
    await db.exec(readFileSync('supabase/migrations/20260905090000_procurement_remediation.sql','utf8'));
    await db.exec(`grant usage on schema storage to authenticated; grant select on procurement.request_attachments,storage.objects to authenticated;
      insert into core.user_roles(user_id,module,role) values ('${legalDecider}','legal','legal_reviewer');
      update procurement.requests set requester_id='${maker}' where id='76000000-0000-0000-0000-000000000006';
    `);
    // Genuine previous decision implementation must still enforce signatures.
    const effectiveAuthority=readFileSync('supabase/migrations/20260816090000_security_database_launch_blocker_convergence.sql','utf8');
    const certificationAuthority=readFileSync('supabase/migrations/20260812200000_learning_authority.sql','utf8');
    function definition(source,name) {
      const start=source.indexOf('create or replace function '+name+'(');
      assert(start>=0,name+' signature exists');
      return source.slice(start,source.indexOf('$$;',start)+3);
    }
    await db.exec(`create schema learning;
      create function learning.is_certification_required(text,text) returns boolean language sql as $$ select true $$;
      create function learning.has_active_certification(uuid,text,text) returns boolean language sql as $$ select true $$;
      create function learning.has_active_emergency_exception(uuid,text,text) returns boolean language sql as $$ select false $$;`);
    // Model an active certificate at the learning boundary, but execute the real
    // has_live_cap -> has_cap -> effective role/profile/definition chain.
    const tierWithRole=async (...args)=>{
      const action=args[4];
      args[4]=async()=>{
        await db.exec('reset role');
        await db.exec(definition(effectiveAuthority,'core.has_cap'));
        await db.exec(definition(effectiveAuthority,'core.has_module_role'));
        await db.exec(definition(certificationAuthority,'core.has_live_cap'));
        await db.exec('set role authenticated');
        await action();
      };
      return withRole(...args);
    };
    await db.exec(`insert into procurement.requests(id,status,requester_id) values('TIER-REQ','submitted','${maker}');
      insert into procurement.approval_steps(id,request_id,status,step_order,assigned_user_id,tier) values('TIER-STEP','TIER-REQ','pending',1,'${finance}','final_approver')`);
    for(const [tier,module,role] of [['final_approver','procurement','admin'],['procurement_head','procurement','procurement_officer'],['dept_head','procurement','approver'],['finance','procurement','finance'],['legal','legal','legal_reviewer']]) {
      const unrelatedRole=role==='finance' ? 'approver' : 'finance';
      await db.query('delete from core.user_roles where user_id=$1',[finance]);
      await db.query('update procurement.approval_steps set tier=$1 where id=\'TIER-STEP\'',[tier]);
      await db.query("insert into core.user_roles(user_id,module,role) values($1,'procurement',$2)",[finance,unrelatedRole]);
      await db.query("insert into core.user_roles(user_id,module,role,effective_at,expires_at) values($1,$2,$3,now()-interval '2 days',now()-interval '1 day')",[finance,module,role]);
      await tierWithRole('authenticated',finance,['approve_request'],['review_accreditation'],async()=>{
        assert.equal((await db.query("select core.has_live_cap('procurement','approve_request') ok")).rows[0].ok,true,'certified unrelated role is deliberately active');
        assert.equal((await db.query("select procurement.request_decision_eligibility('{\"request_id\":\"TIER-REQ\"}') result")).rows[0].result.canDecide,false,`${tier}: expired role must not supply tier`);
        await assert.rejects(db.query('select procurement.decide_request_step($1::jsonb)',[JSON.stringify({request_id:'TIER-REQ',decision:'rejected'})]),/certification/i);
      });
      await db.query("update core.user_roles set effective_at=now()+interval '1 day',expires_at=null where user_id=$1 and module=$2 and role=$3",[finance,module,role]);
      await tierWithRole('authenticated',finance,['approve_request'],['review_accreditation'],async()=>{
        assert.equal((await db.query("select procurement.request_decision_eligibility('{\"request_id\":\"TIER-REQ\"}') result")).rows[0].result.canDecide,false,`${tier}: future grant`);
      });
      await db.query("update core.user_roles set effective_at=now()-interval '1 day' where user_id=$1 and module=$2 and role=$3",[finance,module,role]);
      await db.query('update core.roles set is_active=false where module=$1 and role=$2',[module,role]);
      await tierWithRole('authenticated',finance,['approve_request'],['review_accreditation'],async()=>{
        assert.equal((await db.query("select procurement.request_decision_eligibility('{\"request_id\":\"TIER-REQ\"}') result")).rows[0].result.canDecide,false,`${tier}: inactive definition`);
      });
      await db.query('update core.roles set is_active=true where module=$1 and role=$2',[module,role]);
      await tierWithRole('authenticated',finance,['approve_request'],['review_accreditation'],async()=>{
        assert.equal((await db.query("select procurement.request_decision_eligibility('{\"request_id\":\"TIER-REQ\"}') result")).rows[0].result.canDecide,true,`${tier}: current grant`);
      });
    }
    await db.query("update core.profiles set status='inactive' where id=$1",[finance]);
    await tierWithRole('authenticated',finance,['approve_request'],['review_accreditation'],async()=>{
      assert.equal((await db.query("select procurement.request_decision_eligibility('{\"request_id\":\"TIER-REQ\"}') result")).rows[0].result.canDecide,false,'inactive profile');
    });
    await db.query("update core.profiles set status='active' where id=$1",[finance]);
    await db.exec(`insert into procurement.requests(id,status,requester_id) values('LEGAL-REQ','submitted','${maker}');
      insert into procurement.approval_steps(id,request_id,status,step_order,assigned_user_id,tier) values('LEGAL-STEP','LEGAL-REQ','pending',1,'${legalDecider}','legal')`);
    await withRole('authenticated',legalDecider,[],['review_accreditation'],async()=>{
      await assert.rejects(db.query(`select procurement.decide_request_step('${JSON.stringify({request_id:'LEGAL-REQ',decision:'approved'})}'::jsonb)`),/signature/i);
      const approved=await db.query('select procurement.decide_request_step($1::jsonb) result',[JSON.stringify({request_id:'LEGAL-REQ',decision:'approved',signature:{signature_png:'data:image/png;base64,AA==',signer_name:'Legal',signature_method:'typed'}})]);
      assert.equal(approved.rows[0].result.status,'approved');
    });
    await withRole('authenticated',legalDecider,[],['review_accreditation','approve_accreditation'],async()=>{
      await db.query('select legal.record_vendor_eligibility_decision($1::jsonb)',[JSON.stringify({probation_review_id:reviewId,expected_revision:0,decision:'pass',evidence_reference:'private/review.pdf',notice_reference:'private/pass.pdf'})]);
    });
    const ids={};
    for (const purpose of ['invoice','acceptance','tax']) {
      const id='att_'+purpose, path='request/76000000-0000-0000-0000-000000000006/'+id+'.pdf';
      await db.query('insert into storage.objects values($1,$2,$3)',['procurement-requests',path,procurement]);
      await withRole('authenticated',procurement,['author_po'],[],async()=>{
        await db.query('select procurement.register_payment_document($1::jsonb)',[JSON.stringify({purchase_order_id:'PO-TASK10',purpose,attachment:{id,filename:purpose+'.pdf',mime_type:'application/pdf',size_bytes:100,sha256:'a'.repeat(64),storage_path:path}})]);
      }); ids[purpose]=id;
    }
    const payload={purchase_order_id:'PO-TASK10',invoice_number:'Invoice X',invoice_date:'2026-09-05',invoice_amount:400,tax_amount:0,withholding_amount:0,invoice_or_si_storage_path:ids.invoice,milestone_support_storage_path:ids.acceptance,tax_withholding_support_storage_path:ids.tax};
    let pack;
    await withRole('authenticated',procurement,['author_po'],[],async()=>{
      pack=(await db.query('select procurement.prepare_invoice_payment_readiness($1::jsonb) result',[JSON.stringify(payload)])).rows[0].result;
      assert.equal(pack.status,'ready_for_finance'); assert.equal(pack.document_ids.invoice,ids.invoice);
      await assert.rejects(db.query('select procurement.prepare_payment_readiness($1::jsonb)',[JSON.stringify({...payload,invoice_number:' invoice x '})]),/duplicate/i);
      await assert.rejects(db.query('select procurement.prepare_invoice_payment_readiness($1::jsonb)',[JSON.stringify({...payload,invoice_number:'Too much',invoice_amount:60000})]),/match|exceeds|incomplete/i);
      for(const signature of ['private.policy_prepare_invoice_payment_readiness_pre_sep05(jsonb)','procurement.acknowledge_purchase_order_pre_sep05(jsonb)','procurement.prepare_request_attachment_access_pre_sep05(jsonb)']) {
        assert.equal((await db.query("select has_function_privilege(current_user,$1,'EXECUTE') ok",[signature])).rows[0].ok,false,signature);
      }
    });
    await withRole('authenticated',maker,[],[],async()=>{
      assert.equal((await db.query('select * from procurement.request_attachments')).rows.length,0,'requester cannot enumerate payment metadata');
      assert.equal((await db.query('select * from storage.objects')).rows.length,0,'requester cannot read private payment objects');
      await assert.rejects(db.query('select procurement.prepare_request_attachment_access($1::jsonb)',[JSON.stringify({attachment_id:ids.invoice})]),/access required/i);
    });
    await withRole('authenticated',finance,['view_finance'],[],async()=>{
      assert.equal((await db.query('select * from storage.objects')).rows.length,3);
      const file=(await db.query('select procurement.prepare_request_attachment_access($1::jsonb) result',[JSON.stringify({attachment_id:ids.invoice})])).rows[0].result;
      assert.equal(file.bucket,'procurement-requests');
      await db.query('select procurement.review_payment_readiness($1::jsonb)',[JSON.stringify({id:pack.id,status:'accepted',note:'Verified'})]);
    });
    await db.exec("insert into procurement.purchase_order_lifecycle_state(purchase_order_id,revision,sent_at,acknowledgement_due_at) values('PO-TASK10',1,now(),now()+interval '2 days') on conflict do nothing");
    await withRole('authenticated',vendorActor,[],[],async()=>{
      const projection=(await db.query("select procurement.vendor_purchase_order_acknowledgements('{}'::jsonb) result")).rows[0].result.find(p=>p.id==='PO-TASK10');
      const ack={purchase_order_id:'PO-TASK10',expected_revision:1,document_hash:projection.documentHash,acknowledgement_reference:'Vendor read revision 1'};
      await assert.rejects(db.query('select procurement.acknowledge_purchase_order($1::jsonb)',[JSON.stringify({...ack,expected_revision:null})]),/expected_revision/i);
      await db.query('select procurement.acknowledge_purchase_order($1::jsonb)',[JSON.stringify(ack)]);
      const replay=(await db.query('select procurement.acknowledge_purchase_order($1::jsonb) result',[JSON.stringify(ack)])).rows[0].result;
      assert.equal(replay.replayed,true);
    },vendorId);
    const event=(await db.query("select payload from procurement.purchase_order_lifecycle_events where event_type='vendor_acknowledged'")).rows[0];
    assert.equal(event.payload.documentHash.length,64);
    await db.exec(`insert into procurement.route_decisions(id,request_id,policy_version,method) values('99000000-0000-0000-0000-000000000001','REVISION-FK','old','rfq');
      insert into procurement.sourcing_events(id,request_id,route_decision_id,status,submission_deadline,original_submission_deadline) values('99000000-0000-0000-0000-000000000002','REVISION-FK','99000000-0000-0000-0000-000000000001','failed_bid',now()-interval '1 day',now()-interval '1 day');
      insert into procurement.sourcing_responses(sourcing_event_id,vendor_id,proposal_storage_path) values('99000000-0000-0000-0000-000000000002','${vendorId}','private/historic-proposal.pdf');`);
    const sourcingBefore=(await db.query("select to_jsonb(s) snapshot from procurement.sourcing_events s where request_id='REVISION-FK'")).rows[0].snapshot;
    const responseBefore=(await db.query("select to_jsonb(s) snapshot from procurement.sourcing_responses s where sourcing_event_id='99000000-0000-0000-0000-000000000002'")).rows[0].snapshot;
    const before=(await db.query("select to_jsonb(s) snapshot from procurement.approval_steps s where id='HISTORY-STEP'")).rows[0].snapshot;
    const revisionPayload={id:'REVISION-FK',expected_revision:0,title:'Corrected',justification:{need:'Corrected scope'},lines:[{description:'Scope',quantity:1,unitPrice:20}]};
    await withRole('authenticated',maker,['create_request'],[],async()=>{
      const revised=(await db.query('select procurement.revise_request($1::jsonb) result',[JSON.stringify(revisionPayload)])).rows[0].result;
      assert.equal(revised.id,'REVISION-FK'); assert.equal(revised.revision,1); assert.equal(revised.status,'draft');
      await assert.rejects(db.query('select procurement.revise_request($1::jsonb)',[JSON.stringify(revisionPayload)]),/changed/i);
    });
    const archived=(await db.query("select * from procurement.approval_step_audit where id='HISTORY-STEP'")).rows[0];
    assert.deepEqual(archived.snapshot,before); assert(archived.archived_at); assert.equal(archived.request_revision,0);
    const retained=(await db.query("select * from procurement.exception_packs where request_id='REVISION-FK'")).rows[0];
    assert.equal(retained.final_approval_step_id,'HISTORY-STEP'); assert.equal(retained.status,'superseded');
    assert.equal((await db.query("select count(*)::int n from procurement.approval_steps where request_id='REVISION-FK'")).rows[0].n,0);
    const revision=(await db.query("select snapshot from procurement.request_revisions where request_id='REVISION-FK' and revision=0")).rows[0].snapshot;
    assert.deepEqual(revision.approvalSteps,[before]); assert.equal(revision.exceptionPacks[0].status,'approved');
    assert.deepEqual(revision.sourcingEvents,[sourcingBefore]);
    assert.equal(revision.routeDecisions[0].status,'confirmed');
    assert.equal((await db.query("select status from procurement.sourcing_events where id='99000000-0000-0000-0000-000000000002'")).rows[0].status,'cancelled');
    assert.deepEqual((await db.query("select to_jsonb(s) snapshot from procurement.sourcing_responses s where sourcing_event_id='99000000-0000-0000-0000-000000000002'")).rows[0].snapshot,responseBefore);
    assert.equal((await db.query("select status from procurement.route_decisions where id='99000000-0000-0000-0000-000000000001'")).rows[0].status,'policy_decision_required');
    await assert.rejects(db.exec("delete from procurement.approval_step_audit where id='HISTORY-STEP'"),/foreign key|violates/i);
    await withRole('authenticated',maker,['create_request'],[],async()=>{
      await assert.rejects(db.exec("update procurement.approval_step_audit set snapshot='{}' where id='HISTORY-STEP'"),/permission denied/i);
    });
    await assert.rejects(db.exec("insert into procurement.approval_steps(id,request_id,status,step_order,tier) values('HISTORY-STEP','REVISION-FK','pending',1,'final_approver')"),/Archived approval identity/i);
    // Execute the actual prior submission ladder body, including final-tier
    // cardinality and unique positions, rather than inserting a mock ladder.
    const tierSource=readFileSync('supabase/migrations/20260710040105_repair_procurement_submission_contract.sql','utf8');
    await db.exec(definition(tierSource,'procurement.derive_approval_tiers'));
    await db.exec(definition(priorPolicy,'private.policy_submit_procurement_request').replace('private.policy_submit_procurement_request(', 'private.policy_submit_procurement_request_legacy('));
    await db.exec(`alter table procurement.approval_steps alter column id set default gen_random_uuid()::text;
      alter table procurement.approval_steps add column matrix_version text, add column request_version integer;
      alter table core.profiles add column if not exists full_name text, add column if not exists email text;
      update procurement.requests set category='goods',department='F03',attachments='[{"kind":"spec"},{"kind":"budget"},{"kind":"previous_cost"},{"kind":"quote"}]' where id='REVISION-FK';
      insert into procurement.route_decisions(request_id,policy_version,request_version,method) values('REVISION-FK','new',2,'rfq');
      insert into procurement.doa_matrices(id,version,department,effective_at) values('99000000-0000-0000-0000-000000000003','F03-NEW','F03',now()-interval '1 day');
      insert into procurement.doa_assignments(matrix_id,department,tier,approver_user_id)
      select '99000000-0000-0000-0000-000000000003','F03',tier,'${legalDecider}' from unnest(array['dept_head','procurement_head','final_approver']) tier;`);
    await withRole('authenticated',maker,['create_request'],[],async()=>{
      const submitted=(await db.query("select private.policy_submit_procurement_request_legacy('{\"id\":\"REVISION-FK\"}') result")).rows[0].result;
      assert.equal(submitted.status,'submitted');
    });
    const ladder=(await db.query("select * from procurement.approval_steps where request_id='REVISION-FK' order by step_order")).rows;
    assert.equal(ladder.length,3); assert(ladder.every(s=>s.status==='pending' && s.request_version===2 && s.id!=='HISTORY-STEP'));
    // Supply current authority for the first new step; the old ID is still denied.
    await db.exec(`insert into core.user_roles(user_id,module,role) values('${legalDecider}','procurement','approver')`);
    await withRole('authenticated',legalDecider,['approve_request'],['review_accreditation'],async()=>{
      await assert.rejects(db.query('select procurement.decide_request_step($1::jsonb)',[JSON.stringify({request_id:'REVISION-FK',step_id:'HISTORY-STEP',decision:'approved'})]),/not the next/i);
    });
    assert.deepEqual((await db.query("select snapshot from procurement.approval_step_audit where id='HISTORY-STEP'")).rows[0].snapshot,before);
    console.info('F03: actual restrictive FK and prior submission ladder pass; signed history, exception IDs and sourcing children retained, old authority invalidated.');
}
