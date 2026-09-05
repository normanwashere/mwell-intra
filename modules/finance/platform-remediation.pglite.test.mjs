import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { URL } from "node:url";
import { PGlite } from "@electric-sql/pglite";
const A = "11111111-1111-4111-8111-111111111111",
  B = "22222222-2222-4222-8222-222222222222",
  C = "33333333-3333-4333-8333-333333333333";
test("platform projections preserve RLS, page full populations, transition follow-ups and union independent work", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema auth; create schema core; create schema warehouse; create schema procurement; create schema product; create schema private; create schema storage;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.actor',true),'')::uuid $$;
      create function core.has_live_cap(m text,c text) returns boolean language sql stable as $$ select m||'.'||c=any(string_to_array(current_setting('test.caps',true),',')) $$;
      create table auth.users(id uuid primary key);
      insert into auth.users values('${A}'),('${B}'),('${C}');
      create table core.profiles(id uuid primary key,email text,full_name text,title text,kind text,vendor_id uuid,status text);
      create table core.user_roles(user_id uuid,module text,role text);
      create table core.activity_log(module text,entity_type text,entity_id uuid,action text,actor uuid,detail jsonb);
      create table core.finance_close_entries(id uuid primary key,source_record_type text,source_record_id text,evidence_record_type text,evidence_record_id text,source_reference text,status text,prepared_by uuid,prepared_at timestamptz,posted_by uuid,evidence_url text);
      create view core.finance_close_entry_lineage with(security_invoker=true) as select * from core.finance_close_entries;
      create table warehouse.event_reconciliations(event_id text,approved_by uuid,evidence_url text);
      create view core.finance_close_entry_authority with(security_invoker=true) as select l.*,r.approved_by as settlement_approved_by from core.finance_close_entry_lineage l left join warehouse.event_reconciliations r on l.source_record_type='event_reconciliation' and r.event_id=l.source_record_id;
      create table core.finance_activity(source text,ref_id text,amount numeric,occurred_at timestamptz,owner uuid);
      alter table core.finance_activity enable row level security;
      create policy scope on core.finance_activity using(owner=auth.uid());
      create view core.v_finance_activity with(security_invoker=true) as select * from core.finance_activity;
      create table procurement.purchase_orders(id text,po_number text,vendor_name text,total numeric,status text,updated_at timestamptz);
      create table procurement.payment_readiness_packs(id uuid,purchase_order_id text);
      create table procurement.payment_releases(id uuid,purchase_order_id text,payment_reference text,amount numeric,recorded_at timestamptz,status text);
      create table warehouse.receipts(id text,created_at timestamptz);
      create table warehouse.inventory_position_v1(product_id text,on_hand numeric);
      create table warehouse.products(id text,unit_cost numeric);
      create table product.readiness_packages(id uuid,title text,status text,submitted_at timestamptz,prepared_by uuid,submitted_by uuid,decided_at timestamptz,is_current boolean,operations_acknowledged_at timestamptz);
      create table product.price_proposals(id uuid,product_name text,reason text,status text,effective_at timestamptz,proposed_by uuid);
      create table core.insight_followups(id uuid primary key default gen_random_uuid(),metric_id text,area text,reason_code text,status text default 'open',requested_by uuid,created_at timestamptz default now());
      alter table core.insight_followups enable row level security;
      create policy insight_followups_read on core.insight_followups using(requested_by=auth.uid());
      create table core.documents(id text,storage_path text,status text,expires_at date,entity_type text,entity_id text,doc_type text,version integer);
      create table private.action_evidence(id uuid,source_type text,source_id text,uploaded_by uuid,filename text,storage_path text,created_at timestamptz,ready boolean,size_bytes bigint,mime_type text);
      create table storage.objects(bucket_id text,name text,metadata jsonb);
      create function private.can_use_action_evidence(text,text,boolean) returns boolean language sql as $$select core.has_live_cap('warehouse','manage_finance_close') and $1='purchase_order' and $2='po-a'$$;
      create function private.assert_action_evidence(text,text,text) returns void language sql as $$select$$;
      create function private.assert_finance_close_binding(text,text,text,text) returns void language sql as $$select$$;
      create function private.finance_close_evidence_reference(text,text) returns text language sql as $$select null::text$$;
      create function core.my_work() returns table(id text,principal_id uuid,source text,title text,description text,status text,priority text,due_at timestamptz,href text,required_module text,required_capability text,source_record_exists boolean) language sql as $$ select 'existing',auth.uid(),'warehouse','Existing projection','','pending','normal',null::timestamptz,'/warehouse','warehouse','view_inventory',true $$;
      create view core.v_my_work with(security_invoker=true) as select * from core.my_work();
      grant usage on schema auth,core,warehouse,procurement,product to authenticated;
      grant select on all tables in schema core,warehouse,procurement,product to authenticated;
    `);
    for (const file of [
      "20260905091000_platform_finance.sql",
      "20260905091001_platform_work_union.sql",
    ])
      await db.exec(
        await readFile(
          new URL("../../supabase/migrations/" + file, import.meta.url),
          "utf8",
        ),
      );
    const bindings = await readFile(
      new URL(
        "../../supabase/migrations/20260815154702_procurement_finance_requester_privacy.sql",
        import.meta.url,
      ),
      "utf8",
    );
    for (const name of [
      "assert_finance_close_binding",
      "finance_close_evidence_reference",
    ]) {
      const start = bindings.indexOf(
        "create or replace function private." + name + "(",
      );
      const end = bindings.indexOf("end $$;", start) + "end $$;".length;
      assert(start >= 0 && end > start);
      await db.exec(bindings.slice(start, end));
    }
    await db.exec(`insert into core.finance_activity select 'procurement_po',lpad(i::text,5,'0'),i,'2026-09-01','${A}' from generate_series(1,1005)i;
      insert into core.finance_activity values('procurement_po','private',999999,'2026-09-01','${B}');
      insert into core.profiles select gen_random_uuid(),'person'||i||'@test','Person '||i,'','employee',null,'active' from generate_series(1,1005)i;
      insert into core.profiles values('${A}','requester@test','Requester','','employee',null,'active');
      insert into core.user_roles select id,'product','owner' from core.profiles;
      insert into core.user_roles select id,'warehouse','finance' from core.profiles;
      insert into core.insight_followups(id,metric_id,area,reason_code,requested_by) values('${A}','finance-metric','finance','target_breach','${A}');
      insert into product.readiness_packages values('${A}','Package A','submitted',now(),'${A}','${A}',null,false,null);
      insert into core.finance_close_entries(id,source_record_type,source_record_id,source_reference,status,prepared_by,prepared_at,evidence_url) values('${A}','purchase_order','po-a','PO-A','ready','${A}',now(),'https://evidence.test/a');
      insert into procurement.purchase_orders values('po-a','PO-A','Vendor A',100,'approved',now());
      insert into procurement.payment_releases values('${C}','po-a','BANK-2026-009',75,now(),'posted');
      insert into core.documents values('${B}','bound.pdf','approved',null,'purchase_order','po-a','invoice',1);
      insert into storage.objects values('documents','bound.pdf','{}');
      update core.finance_close_entries set evidence_record_type='core_document',evidence_record_id='${B}' where id='${A}';
      set role authenticated; set test.actor='${A}'; set test.caps='warehouse.view_finance,procurement.view_finance,core.manage_rbac';`);
    const inspected = (
      await db.query("select core.platform_close_evidence($1) p", [A])
    ).rows[0].p;
    assert.equal(inspected.bucket, "documents");
    assert.equal(inspected.storage_path, "bound.pdf");
    await db.exec(
      `reset role; update core.documents set entity_id='unrelated-po'; set role authenticated;`,
    );
    await assert.rejects(
      db.query("select core.platform_close_evidence($1)", [A]),
      /does not belong/,
    );
    await db.exec(
      `reset role; update core.documents set entity_id='po-a',expires_at='2000-01-01'; set role authenticated;`,
    );
    await assert.rejects(
      db.query("select core.platform_close_evidence($1)", [A]),
      /expired/,
    );
    await db.exec(
      `reset role; update core.documents set expires_at=null; set role authenticated;`,
    );
    let cursor = "",
      seen = [];
    for (const size of [null, 0, -1, 501]) {
      await assert.rejects(
        db.query("select core.platform_finance_page($1,$2,$3)", [
          "activity",
          "",
          size,
        ]),
        /Invalid page size/,
      );
    }
    for (;;) {
      const {
        rows: [{ page }],
      } = await db.query(
        "select core.platform_finance_page($1,$2,37) as page",
        ["activity", cursor],
      );
      assert.equal(page.total, 1005);
      seen.push(...page.rows.map((r) => r.ref_id));
      if (!page.next) break;
      cursor = page.next;
    }
    assert.equal(seen.length, 1005);
    assert.equal(new Set(seen).size, 1005);
    assert(!seen.includes("private"));
    const {
      rows: [{ totals }],
    } = await db.query(
      "select core.platform_finance_totals('2026-09-01','2026-09-05') totals",
    );
    assert.equal(totals.committedValue, (1005 * 1006) / 2);
    const {
      rows: [{ directory }],
    } = await db.query(
      "select core.platform_user_directory('person1005','active','employee',1) directory",
    );
    assert.equal(directory.total, 1);
    assert.equal(directory.roles.length, 2);
    assert.equal(
      (await db.query("select core.platform_followup_page() p")).rows[0].p
        .length,
      1,
    );
    await assert.rejects(
      db.query("select core.platform_transition_followup($1)", [
        { id: A, action: "acknowledge" },
      ]),
      /owner capability/,
    );
    await db.exec(
      `set test.actor='${B}'; set test.caps='warehouse.manage_finance_close,product.decide_go_live';`,
    );
    await db.exec(`reset role;
      insert into private.action_evidence values('${C}','purchase_order','po-a','${B}','Invoice C','action-c.pdf',now(),true,42,'application/pdf');
      insert into core.documents values('${C}','action-c.pdf','approved',null,'action_evidence','${C}','action_evidence',1);
      insert into storage.objects values('documents','action-c.pdf','{"size":42,"mimetype":"application/pdf"}');
      set role authenticated;`);
    const options = (
      await db.query(
        "select core.platform_close_evidence_options('purchase_order','po-a') p",
      )
    ).rows[0].p;
    assert.equal(options.length, 1);
    assert.equal(options[0].id, C);
    assert.equal(options[0].label, "Invoice C");
    assert.equal(
      (
        await db.query(
          "select core.platform_close_release_sources('BANK-2026-009')",
        )
      ).rows.length,
      0,
    );
    await db.exec(
      `reset role; revoke select on procurement.payment_releases from authenticated; set role authenticated; set test.caps='warehouse.manage_finance_close,procurement.view_finance,product.decide_go_live';`,
    );
    const releases = (
      await db.query(
        "select core.platform_close_sources('BANK-2026-009','payment_release',null) p",
      )
    ).rows[0].p;
    assert.equal(releases.length, 1);
    assert.equal(releases[0].id, C);
    assert.equal(releases[0].reference, "BANK-2026-009");
    assert.equal(releases[0].amount, 75);
    assert.equal(releases[0].href, "/procurement/purchase-orders/po-a");
    const prebound = (
      await db.query("select core.platform_close_sources($1,$2,$3) p", [
        "",
        "payment_release",
        C,
      ])
    ).rows[0].p;
    assert.equal(prebound.length, 1);
    assert.equal(prebound[0].reference, "BANK-2026-009");
    const work = (await db.query("select * from core.my_work()")).rows;
    assert(work.some((r) => r.id === "existing"));
    assert(work.some((r) => r.id === "product-decision:" + A));
    assert(work.some((r) => r.id === "finance-close:" + A));
    assert(work.some((r) => r.id === "insight-followup:" + A));
    await db.query("select core.platform_transition_followup($1)", [
      { id: A, action: "acknowledge" },
    ]);
    await db.query("select core.platform_transition_followup($1)", [
      { id: A, action: "acknowledge" },
    ]);
    await assert.rejects(
      db.query("select core.platform_transition_followup($1)", [
        { id: A, action: "resolve", resolution_reference: "https://private" },
      ]),
      /controlled resolution/,
    );
    await db.query("select core.platform_transition_followup($1)", [
      { id: A, action: "resolve", resolution_reference: "FIN-2026-009" },
    ]);
    const final = (await db.query("select core.platform_followup_page() p"))
      .rows[0].p[0];
    assert.equal(final.status, "resolved");
    assert.equal(final.resolved_by, B);
    assert.equal(final.resolution_reference, "FIN-2026-009");
    assert(
      !(await db.query("select * from core.my_work()")).rows.some(
        (r) => r.id === "insight-followup:" + A,
      ),
    );
    await db.exec(`set test.actor='${A}';`);
    assert(
      !(await db.query("select * from core.my_work()")).rows.some(
        (r) =>
          r.id === "finance-close:" + A || r.id === "product-decision:" + A,
      ),
    );
    await db.exec(`set test.actor='${C}'; set test.caps='';`);
    assert.equal(
      (await db.query("select core.platform_followup_page() p")).rows[0].p
        .length,
      0,
    );
    await assert.rejects(
      db.query("select core.platform_transition_followup($1)", [
        { id: A, action: "acknowledge" },
      ]),
      /owner capability/,
    );
    await assert.rejects(
      db.query("select core.platform_user_directory()"),
      /administration/,
    );
  } finally {
    await db.close();
  }
});
