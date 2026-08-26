import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migrationUrl = new URL(
  "../supabase/migrations/20260826103000_event_reconciliation_finance_handoff.sql",
  import.meta.url,
);
const controlsMigrationUrl = new URL(
  "../supabase/migrations/20260826123000_event_settlement_close_controls.sql",
  import.meta.url,
);
const actorSeparationMigrationUrl = new URL(
  "../supabase/migrations/20260826133000_enforce_event_settlement_actor_separation.sql",
  import.meta.url,
);
const actorLineagePreflightMigrationUrl = new URL(
  "../supabase/migrations/20260826143000_preflight_event_settlement_actor_lineage.sql",
  import.meta.url,
);
const marketingId = "11111111-1111-4111-8111-111111111111";
const financeId = "22222222-2222-4222-8222-222222222222";
const financePosterId = "33333333-3333-4333-8333-333333333333";
const financeCloserId = "44444444-4444-4444-8444-444444444444";

async function createDatabase({ applyActorLineagePreflight = true } = {}) {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;
    create schema core;
    create schema private;
    create schema warehouse;

    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('app.actor_id', true), '')::uuid
    $$;
    create function core.has_live_cap(module_name text, capability_name text)
    returns boolean language sql stable as $$
      select position(
        module_name || '.' || capability_name
        in coalesce(current_setting('app.capabilities', true), '')
      ) > 0
    $$;

    create table core.activity_log (
      id bigserial primary key,
      module text not null,
      entity_type text not null,
      entity_id uuid not null,
      action text not null,
      actor uuid,
      detail jsonb,
      created_at timestamptz not null default now()
    );

    create table warehouse.events (
      id text primary key,
      start_date date not null,
      end_date date
    );
    create table warehouse.allocations (
      id uuid primary key default gen_random_uuid(),
      event_id text not null,
      quantity integer not null,
      status text not null
    );
    create table warehouse.event_reconciliations (
      event_id text primary key,
      status text not null,
      sold_units integer not null default 0,
      giveaway_units integer not null default 0,
      returned_units integer not null default 0,
      lost_units integer not null default 0,
      damaged_units integer not null default 0,
      rekit_units integer not null default 0,
      gross_sales_amount numeric not null default 0,
      finance_reference text,
      evidence_url text,
      note text,
      prepared_by uuid,
      prepared_at timestamptz,
      approved_by uuid,
      approved_at timestamptz,
      updated_at timestamptz not null default now()
    );
    create table core.finance_close_entries (
      id uuid primary key default gen_random_uuid(),
      period_start date,
      period_end date,
      entry_type text,
      source_module text,
      source_reference text,
      source_record_type text,
      source_record_id text,
      evidence_record_type text,
      evidence_record_id text,
      amount numeric not null default 0,
      status text not null default 'ready',
      evidence_url text,
      reconciliation_note text,
      prepared_by uuid,
      prepared_at timestamptz not null default now(),
      posted_by uuid,
      posted_at timestamptz,
      reconciled_by uuid,
      reconciled_at timestamptz,
      updated_at timestamptz not null default now()
    );
    create table warehouse.event_settlements (
      event_id text primary key,
      reconciliation_event_id text not null,
      finance_close_entry_id uuid not null
    );
    create view core.finance_close_entry_lineage as
    select
      entry.*,
      null::text as prepared_by_name,
      null::text as prepared_by_email,
      null::text as posted_by_name,
      null::text as posted_by_email,
      null::text as reconciled_by_name,
      null::text as reconciled_by_email
    from core.finance_close_entries entry;

    create function private.assert_finance_close_binding(text, text, text, text)
    returns void language plpgsql stable security definer set search_path = '' as $$
    begin
      raise exception 'Legacy Finance binding rejected the record';
    end $$;
    create function private.finance_close_evidence_reference(text, text)
    returns text language sql stable security definer set search_path = ''
      as $$ select null::text $$;

    create function core.manage_finance_close_entry(payload jsonb)
    returns jsonb language plpgsql security definer set search_path = '' as $$
    declare
      v core.finance_close_entries;
      v_action text := payload->>'action';
    begin
      if auth.uid() is null then raise exception 'Authenticated Finance actor required'; end if;
      if not core.has_live_cap('warehouse', 'manage_finance_close') then
        raise exception 'Not authorized: warehouse.manage_finance_close';
      end if;
      if v_action = 'save' then
        insert into core.finance_close_entries(
          period_start, period_end, entry_type, source_module, source_reference,
          source_record_type, source_record_id, evidence_record_type,
          evidence_record_id, amount, status, evidence_url, prepared_by
        ) values (
          (payload->>'period_start')::date, (payload->>'period_end')::date,
          payload->>'entry_type', payload->>'source_module', payload->>'source_reference',
          payload->>'source_record_type', payload->>'source_record_id',
          payload->>'evidence_record_type', payload->>'evidence_record_id',
          coalesce((payload->>'amount')::numeric, 0), 'ready',
          nullif(payload->>'evidence_url', ''), auth.uid()
        ) returning * into v;
      else
        select * into v from core.finance_close_entries
        where id = (payload->>'id')::uuid for update;
        if not found then raise exception 'Finance close entry not found'; end if;
        if v_action = 'post' then
          if v.status <> 'ready' then raise exception 'Only a ready entry can be posted'; end if;
          if v.prepared_by = auth.uid() then
            raise exception 'A second Finance user must post the prepared entry';
          end if;
          update core.finance_close_entries set status='posted', posted_by=auth.uid(),
            posted_at=now(), updated_at=now() where id=v.id returning * into v;
        elsif v_action = 'reconcile' then
          if v.status <> 'posted' then raise exception 'Post the entry before reconciliation'; end if;
          if v.posted_by = auth.uid() then
            raise exception 'A third Finance user must reconcile the posted entry';
          end if;
          if v.prepared_by = auth.uid() then
            raise exception 'The preparer cannot reconcile their own entry';
          end if;
          update core.finance_close_entries set status='reconciled',
            reconciled_by=auth.uid(), reconciled_at=now(), updated_at=now()
          where id=v.id returning * into v;
        else
          raise exception 'Unsupported Finance close action';
        end if;
      end if;
      return to_jsonb(v);
    end $$;

    create function warehouse.save_event_reconciliation(payload jsonb)
    returns jsonb language plpgsql security definer set search_path = '' as $$
    declare
      v_row warehouse.event_reconciliations;
      v_close_id uuid;
    begin
      select * into v_row
      from warehouse.event_reconciliations
      where event_id = payload->>'event_id'
      for update;
      if not found then raise exception 'Event reconciliation not found'; end if;

      if payload->>'action' = 'submit' then
        update warehouse.event_reconciliations set
          status = 'submitted',
          sold_units = coalesce((payload->>'sold_units')::integer, 0),
          giveaway_units = coalesce((payload->>'giveaway_units')::integer, 0),
          returned_units = coalesce((payload->>'returned_units')::integer, 0),
          lost_units = coalesce((payload->>'lost_units')::integer, 0),
          damaged_units = coalesce((payload->>'damaged_units')::integer, 0),
          rekit_units = coalesce((payload->>'rekit_units')::integer, 0),
          gross_sales_amount = coalesce((payload->>'gross_sales_amount')::numeric, 0),
          finance_reference = nullif(payload->>'finance_reference', ''),
          evidence_url = nullif(payload->>'evidence_url', ''),
          updated_at = now()
        where event_id = v_row.event_id
        returning * into v_row;
        return to_jsonb(v_row);
      end if;

      if payload->>'action' <> 'approve' then
        raise exception 'Unsupported action in legacy stub';
      end if;
      if v_row.status <> 'submitted' then
        raise exception 'Submit before approval';
      end if;
      if v_row.prepared_by = auth.uid() then
        raise exception 'A second Finance user must approve the event settlement';
      end if;
      if nullif(v_row.finance_reference, '') is null
         or nullif(v_row.evidence_url, '') is null then
        raise exception 'Finance reference and evidence are required for approval';
      end if;

      update warehouse.event_reconciliations set
        status = 'approved', approved_by = auth.uid(), approved_at = now(), updated_at = now()
      where event_id = v_row.event_id
      returning * into v_row;
      insert into core.finance_close_entries default values returning id into v_close_id;
      insert into warehouse.event_settlements(
        event_id, reconciliation_event_id, finance_close_entry_id
      ) values (v_row.event_id, v_row.event_id, v_close_id);
      return to_jsonb(v_row) || jsonb_build_object('finance_close_entry_id', v_close_id);
    end $$;
  `);
  await db.exec(await readFile(migrationUrl, "utf8"));
  await db.exec(await readFile(controlsMigrationUrl, "utf8"));
  await db.exec(await readFile(actorSeparationMigrationUrl, "utf8"));
  if (applyActorLineagePreflight) {
    await db.exec(await readFile(actorLineagePreflightMigrationUrl, "utf8"));
  }
  return db;
}

async function setActor(db, actorId, capabilities = []) {
  await db.query("select set_config('app.actor_id', $1, false)", [actorId]);
  await db.query("select set_config('app.capabilities', $1, false)", [
    capabilities.join(','),
  ]);
}

async function seedDraft(db, eventId, evidenceUrl) {
  await db.query(
    `insert into warehouse.events(id, start_date, end_date)
     values ($1, '2026-09-12', '2026-09-13')`,
    [eventId],
  );
  await db.query(
    `insert into warehouse.allocations(event_id, quantity, status)
     values ($1, 3, 'issued')`,
    [eventId],
  );
  await db.query(
    `insert into warehouse.event_reconciliations(
       event_id, status, sold_units, gross_sales_amount, evidence_url,
       prepared_by, prepared_at
     ) values ($1, 'draft', 3, 16970, $2, $3, now())`,
    [eventId, evidenceUrl, marketingId],
  );
}

function transitionPayload(eventId, action, overrides = {}) {
  return {
    event_id: eventId,
    action,
    sold_units: 3,
    giveaway_units: 0,
    returned_units: 0,
    lost_units: 0,
    damaged_units: 0,
    rekit_units: 0,
    gross_sales_amount: 16970,
    evidence_url: "https://example.com/uat/events/UAT-AUG24-EVENT-A",
    ...overrides,
  };
}

async function transition(db, payload) {
  return db.query(
    "select warehouse.save_event_reconciliation($1::jsonb) as result",
    [JSON.stringify(payload)],
  );
}

async function seedLegacyEventClose(
  db,
  {
    eventId,
    includeReconciliation = true,
    reconciliationStatus = "approved",
    preparedBy = marketingId,
    approvedBy = financeId,
    status = "ready",
    postedBy = null,
    reconciledBy = null,
  },
) {
  if (includeReconciliation) {
    await db.query(
      `insert into warehouse.event_reconciliations(
         event_id, status, evidence_url, prepared_by, prepared_at,
         approved_by, approved_at
       ) values ($1, $2, 'https://example.com/preflight', $3, now(), $4, now())`,
      [eventId, reconciliationStatus, preparedBy, approvedBy],
    );
  }

  await db.exec(`
    alter table core.finance_close_entries
      disable trigger enforce_event_finance_actor_separation
  `);
  await db.query(
    `insert into core.finance_close_entries(
       entry_type, source_module, source_reference,
       source_record_type, source_record_id,
       evidence_record_type, evidence_record_id, evidence_url,
       status, prepared_by, posted_by, reconciled_by
     ) values (
       'event_settlement', 'events', $1,
       'event_reconciliation', $1,
       'event_reconciliation', $1, 'https://example.com/preflight',
       $2, $3, $4, $5
     )`,
    [eventId, status, preparedBy, postedBy, reconciledBy],
  );
  await db.exec(`
    alter table core.finance_close_entries
      enable trigger enforce_event_finance_actor_separation
  `);
}

async function applyActorLineagePreflight(db) {
  await db.exec(await readFile(actorLineagePreflightMigrationUrl, "utf8"));
}

test("Event operations submits evidence and Finance independently approves a bound close entry", async () => {
  const db = await createDatabase();
  await seedDraft(db, "uat-event-a", transitionPayload("", "").evidence_url);

  await setActor(db, marketingId, ['events.manage_events']);
  await transition(
    db,
    transitionPayload("uat-event-a", "submit", {
      finance_reference: "EVENTS-MUST-NOT-ASSIGN-THIS",
    }),
  );
  let reconciliation = await db.query(
    "select status, finance_reference from warehouse.event_reconciliations where event_id = 'uat-event-a'",
  );
  assert.deepEqual(reconciliation.rows[0], {
    status: "submitted",
    finance_reference: null,
  });

  await setActor(db, marketingId, [
    'events.manage_events',
    'events.approve_settlement',
  ]);
  await assert.rejects(
    transition(
      db,
      transitionPayload("uat-event-a", "approve", {
        finance_reference: "FIN-EVT-AUG24-001",
      }),
    ),
    /second Finance user/i,
  );

  await setActor(db, financeId, ['events.approve_settlement']);
  await assert.rejects(
    transition(db, transitionPayload("uat-event-a", "approve")),
    /Finance settlement reference is required/i,
  );
  await transition(
    db,
    transitionPayload("uat-event-a", "approve", {
      finance_reference: "FIN-EVT-AUG24-001",
    }),
  );

  reconciliation = await db.query(
    "select status, finance_reference from warehouse.event_reconciliations where event_id = 'uat-event-a'",
  );
  assert.deepEqual(reconciliation.rows[0], {
    status: "approved",
    finance_reference: "FIN-EVT-AUG24-001",
  });
  const closeEntry = await db.query(`
    select close_entry.source_record_type, close_entry.source_record_id,
           close_entry.evidence_record_type, close_entry.evidence_record_id,
           close_entry.evidence_url
    from core.finance_close_entries close_entry
    join warehouse.event_settlements settlement
      on settlement.finance_close_entry_id = close_entry.id
    where settlement.event_id = 'uat-event-a'
  `);
  assert.deepEqual(closeEntry.rows[0], {
    source_record_type: "event_reconciliation",
    source_record_id: "uat-event-a",
    evidence_record_type: "event_reconciliation",
    evidence_record_id: "uat-event-a",
    evidence_url: "https://example.com/uat/events/UAT-AUG24-EVENT-A",
  });
  await db.query(
    `select private.assert_finance_close_binding(
       'event_reconciliation', 'uat-event-a',
       'event_reconciliation', 'uat-event-a'
     )`,
  );
  await db.close();
});

test("submission rejects a draft without Event evidence", async () => {
  const db = await createDatabase();
  await seedDraft(db, "event-no-evidence", null);
  await setActor(db, marketingId, ['events.manage_events']);
  await assert.rejects(
    transition(
      db,
      transitionPayload("event-no-evidence", "submit", { evidence_url: null }),
    ),
    /valid HTTPS evidence URL before Finance submission/i,
  );
  await db.close();
});

test("capabilities and grants fail closed", async () => {
  const db = await createDatabase();
  await seedDraft(db, "event-denied", transitionPayload("", "").evidence_url);
  await setActor(db, marketingId);

  await assert.rejects(
    transition(db, transitionPayload("event-denied", "submit")),
    /Not authorized: events\.manage_events/i,
  );

  const grants = await db.query(`
    select
      has_function_privilege('authenticated', 'warehouse.open_event_reconciliation_evidence(jsonb)', 'execute') as authenticated_open,
      has_function_privilege('anon', 'warehouse.open_event_reconciliation_evidence(jsonb)', 'execute') as anon_open,
      has_function_privilege('authenticated', 'private.is_supported_event_evidence_reference(text)', 'execute') as authenticated_private
  `);
  assert.deepEqual(grants.rows[0], {
    authenticated_open: true,
    anon_open: false,
    authenticated_private: false,
  });
  await db.close();
});

test("submission and Finance posting reject invalid Event evidence", async () => {
  const db = await createDatabase();
  await seedDraft(db, "event-invalid-evidence", "javascript:alert(1)");
  await setActor(db, marketingId, ['events.manage_events']);
  await assert.rejects(
    transition(
      db,
      transitionPayload("event-invalid-evidence", "submit", {
        evidence_url: "javascript:alert(1)",
      }),
    ),
    /valid HTTPS evidence URL/i,
  );

  await db.exec(`
    update warehouse.event_reconciliations
    set status='approved', evidence_url='javascript:alert(1)', finance_reference='FIN-BAD',
        approved_by='${financeId}', approved_at=now()
    where event_id='event-invalid-evidence';
    insert into core.finance_close_entries(
      entry_type, source_module, source_reference, source_record_type, source_record_id,
      evidence_record_type, evidence_record_id, evidence_url, status, prepared_by
    ) values (
      'event_settlement', 'events', 'editable-ref', 'event_reconciliation',
      'event-invalid-evidence', 'event_reconciliation', 'event-invalid-evidence',
      'javascript:alert(1)', 'ready', '${marketingId}'
    );
  `);
  const entry = await db.query(
    "select id from core.finance_close_entries where source_record_id='event-invalid-evidence'",
  );
  await setActor(db, financePosterId, ['warehouse.manage_finance_close']);
  await assert.rejects(
    db.query("select core.manage_finance_close_entry($1::jsonb)", [
      JSON.stringify({ action: 'post', id: entry.rows[0].id }),
    ]),
    /valid HTTPS evidence URL/i,
  );
  await db.close();
});

test("canonical event source uniqueness and the Finance RPC reject manual duplicates", async () => {
  const db = await createDatabase();
  await seedDraft(db, "event-canonical", transitionPayload("", "").evidence_url);
  await setActor(db, marketingId, ['events.manage_events']);
  await transition(db, transitionPayload("event-canonical", "submit"));
  await setActor(db, financeId, ['events.approve_settlement']);
  await transition(
    db,
    transitionPayload("event-canonical", "approve", {
      finance_reference: "FIN-CANONICAL-001",
    }),
  );

  await setActor(db, financePosterId, ['warehouse.manage_finance_close']);
  const duplicatePayload = {
    action: 'save',
    period_start: '2026-09-01',
    period_end: '2026-09-30',
    entry_type: 'event_settlement',
    source_module: 'events',
    source_reference: 'DIFFERENT-EDITABLE-REFERENCE',
    source_record_type: 'event_reconciliation',
    source_record_id: 'event-canonical',
    evidence_record_type: 'event_reconciliation',
    evidence_record_id: 'event-canonical',
    evidence_url: transitionPayload("", "").evidence_url,
    amount: 16970,
  };
  await assert.rejects(
    db.query("select core.manage_finance_close_entry($1::jsonb)", [
      JSON.stringify(duplicatePayload),
    ]),
    /generated by Event settlement approval/i,
  );
  await assert.rejects(
    db.query(`
      insert into core.finance_close_entries(
        period_start, period_end, entry_type, source_module, source_reference,
        source_record_type, source_record_id, evidence_record_type,
        evidence_record_id, evidence_url, prepared_by
      ) values (
        '2026-10-01', '2026-10-31', 'event_settlement', 'events', 'OTHER-REF',
        'event_reconciliation', 'event-canonical', 'event_reconciliation',
        'event-canonical', 'https://example.com/other', '${financePosterId}'
      )
    `),
    /duplicate key value violates unique constraint/i,
  );
  await db.close();
});

test("evidence opening is authorized, audited, and available before Post", async () => {
  const db = await createDatabase();
  const eventId = "55555555-5555-4555-8555-555555555555";
  await seedDraft(db, eventId, transitionPayload("", "").evidence_url);
  await setActor(db, marketingId, ['events.view_events']);
  const opened = await db.query(
    "select warehouse.open_event_reconciliation_evidence($1::jsonb) as result",
    [JSON.stringify({ event_id: eventId })],
  );
  assert.equal(
    opened.rows[0].result.evidence_url,
    transitionPayload("", "").evidence_url,
  );
  const auditByAction = await db.query(
    "select action, actor, detail->>'event_id' as event_id from core.activity_log where action='evidence_opened'",
  );
  assert.deepEqual(auditByAction.rows[0], {
    action: 'evidence_opened',
    actor: marketingId,
    event_id: eventId,
  });
  await db.close();
});

test("Finance post and reconcile require three independent actors and posted state", async () => {
  const db = await createDatabase();
  await db.exec(`
    insert into warehouse.events(id, start_date, end_date)
    values ('event-sod', '2026-09-12', '2026-09-13');
    insert into warehouse.event_reconciliations(
      event_id, status, sold_units, gross_sales_amount, evidence_url,
      prepared_by, prepared_at, approved_by, approved_at
    ) values (
      'event-sod', 'approved', 3, 16970, 'https://example.com/event-sod',
      '${marketingId}', now(), '${financeId}', now()
    );
    insert into core.finance_close_entries(
      entry_type, source_module, source_reference, source_record_type, source_record_id,
      evidence_record_type, evidence_record_id, evidence_url, status, prepared_by
    ) values (
      'event_settlement', 'events', 'event-sod', 'event_reconciliation', 'event-sod',
      'event_reconciliation', 'event-sod', 'https://example.com/event-sod',
      'ready', '${marketingId}'
    )
  `);
  const entry = await db.query(
    "select id from core.finance_close_entries where source_record_id='event-sod'",
  );
  const id = entry.rows[0].id;

  await setActor(db, financeCloserId, ['warehouse.manage_finance_close']);
  await assert.rejects(
    db.query("select core.manage_finance_close_entry($1::jsonb)", [
      JSON.stringify({ action: 'reconcile', id }),
    ]),
    /Post the entry before reconciliation/i,
  );
  await setActor(db, financeId, ['warehouse.manage_finance_close']);
  await assert.rejects(
    db.query(
      "update core.finance_close_entries set status='posted', posted_by=$1 where id=$2",
      [financeId, id],
    ),
    /settlement approver cannot post/i,
  );
  await assert.rejects(
    db.query("select core.manage_finance_close_entry($1::jsonb)", [
      JSON.stringify({ action: 'post', id }),
    ]),
    /settlement approver cannot post/i,
  );
  await setActor(db, financePosterId, ['warehouse.manage_finance_close']);
  await db.query("select core.manage_finance_close_entry($1::jsonb)", [
    JSON.stringify({ action: 'post', id }),
  ]);
  await assert.rejects(
    db.query("select core.manage_finance_close_entry($1::jsonb)", [
      JSON.stringify({ action: 'reconcile', id }),
    ]),
    /third Finance user must reconcile/i,
  );
  await setActor(db, financeId, ['warehouse.manage_finance_close']);
  await assert.rejects(
    db.query(
      "update core.finance_close_entries set status='reconciled', reconciled_by=$1 where id=$2",
      [financeId, id],
    ),
    /settlement approver cannot reconcile/i,
  );
  await assert.rejects(
    db.query("select core.manage_finance_close_entry($1::jsonb)", [
      JSON.stringify({ action: 'reconcile', id }),
    ]),
    /settlement approver cannot reconcile/i,
  );
  await setActor(db, marketingId, ['warehouse.manage_finance_close']);
  await assert.rejects(
    db.query("select core.manage_finance_close_entry($1::jsonb)", [
      JSON.stringify({ action: 'reconcile', id }),
    ]),
    /preparer cannot reconcile/i,
  );
  await setActor(db, financeCloserId, ['warehouse.manage_finance_close']);
  await db.query("select core.manage_finance_close_entry($1::jsonb)", [
    JSON.stringify({ action: 'reconcile', id }),
  ]);
  const closed = await db.query(
    "select status, posted_by, reconciled_by from core.finance_close_entries where id=$1",
    [id],
  );
  assert.deepEqual(closed.rows[0], {
    status: 'reconciled',
    posted_by: financePosterId,
    reconciled_by: financeCloserId,
  });
  const authority = await db.query(
    "select settlement_approved_by from core.finance_close_entry_authority where id=$1",
    [id],
  );
  assert.equal(authority.rows[0].settlement_approved_by, financeId);
  await db.close();
});

test("locked Event settlement preflight rejects every invalid legacy actor state", async (t) => {
  const cases = [
    {
      name: "missing reconciliation lineage",
      seed: { includeReconciliation: false },
      error: /missing approved reconciliation lineage/i,
    },
    {
      name: "reconciliation is not approved",
      seed: { reconciliationStatus: "submitted" },
      error: /missing approved reconciliation lineage/i,
    },
    {
      name: "approved reconciliation has no approver",
      seed: { approvedBy: null },
      error: /missing approved reconciliation lineage/i,
    },
    {
      name: "preparer is settlement approver",
      seed: { approvedBy: marketingId },
      error: /preparer and approver must be different actors/i,
    },
    {
      name: "posted entry has no poster",
      seed: { status: "posted" },
      error: /requires an attributable poster/i,
    },
    {
      name: "posted entry was posted by its preparer",
      seed: { status: "posted", postedBy: marketingId },
      error: /preparer and poster must be different actors/i,
    },
    {
      name: "posted entry was posted by its settlement approver",
      seed: { status: "posted", postedBy: financeId },
      error: /approver and poster must be different actors/i,
    },
    {
      name: "reconciled entry has no poster",
      seed: { status: "reconciled", reconciledBy: financeCloserId },
      error: /requires an attributable poster/i,
    },
    {
      name: "reconciled entry has no reconciler",
      seed: { status: "reconciled", postedBy: financePosterId },
      error: /requires an attributable reconciler/i,
    },
    {
      name: "reconciled entry was posted by its preparer",
      seed: {
        status: "reconciled",
        postedBy: marketingId,
        reconciledBy: financeCloserId,
      },
      error: /preparer and poster must be different actors/i,
    },
    {
      name: "reconciled entry was posted by its settlement approver",
      seed: {
        status: "reconciled",
        postedBy: financeId,
        reconciledBy: financeCloserId,
      },
      error: /approver and poster must be different actors/i,
    },
    {
      name: "reconciler is settlement preparer",
      seed: {
        status: "reconciled",
        postedBy: financePosterId,
        reconciledBy: marketingId,
      },
      error: /preparer and reconciler must be different actors/i,
    },
    {
      name: "reconciler is settlement approver",
      seed: {
        status: "reconciled",
        postedBy: financePosterId,
        reconciledBy: financeId,
      },
      error: /approver and reconciler must be different actors/i,
    },
    {
      name: "reconciler is close-entry poster",
      seed: {
        status: "reconciled",
        postedBy: financePosterId,
        reconciledBy: financePosterId,
      },
      error: /poster and reconciler must be different actors/i,
    },
  ];

  for (const [index, testCase] of cases.entries()) {
    await t.test(testCase.name, async () => {
      const db = await createDatabase({ applyActorLineagePreflight: false });
      await seedLegacyEventClose(db, {
        eventId: `preflight-invalid-${index}`,
        ...testCase.seed,
      });
      await assert.rejects(applyActorLineagePreflight(db), testCase.error);
      await db.close();
    });
  }
});

test("locked Event settlement preflight accepts clean ready, posted, and reconciled lineage", async () => {
  const db = await createDatabase({ applyActorLineagePreflight: false });
  await seedLegacyEventClose(db, { eventId: "preflight-ready" });
  await seedLegacyEventClose(db, {
    eventId: "preflight-posted",
    status: "posted",
    postedBy: financePosterId,
  });
  await seedLegacyEventClose(db, {
    eventId: "preflight-reconciled",
    status: "reconciled",
    postedBy: financePosterId,
    reconciledBy: financeCloserId,
  });

  await applyActorLineagePreflight(db);
  const result = await db.query(`
    select status, count(*)::integer as count
    from core.finance_close_entries
    where source_record_type = 'event_reconciliation'
    group by status
    order by status
  `);
  assert.deepEqual(result.rows, [
    { status: "posted", count: 1 },
    { status: "ready", count: 1 },
    { status: "reconciled", count: 1 },
  ]);
  await db.close();
});
