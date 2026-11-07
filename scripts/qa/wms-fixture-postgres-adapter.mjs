import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { WMS_FIXTURE_PROJECT_REF } from './wms-fixture-lifecycle.mjs';
import { assertWmsLiveFixtureCleanupReady } from './wms-live-fixture-guard.mjs';

const OP='seed-one-serial';
const tableNames=['warehouse.products','warehouse.inventory_units','private.warehouse_unit_history','private.warehouse_stock_epochs'];
const sqlNames=Object.fromEntries(tableNames.map(t=>[t,t.split('.').map(n=>`"${n}"`).join('.')]));
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
function check(ok,message){if(!ok){const e=new Error(`WMS PostgreSQL fixture: ${message}`);e.code='WMS_FIXTURE_POSTGRES_BLOCKED';throw e;}}
const envelope=plan=>({runId:plan.runId,projectRef:plan.projectRef,namespace:plan.namespace,sourceCommit:plan.sourceCommit});
const idParts=plan=>{const suffix=plan.runId.slice('wms-fixture-'.length);return {product:`qa-fixture-${suffix}-product`,unit:`qa-fixture-${suffix}-unit`,serial:`QA-${suffix.toUpperCase()}`,batch:`uat-fixture-${suffix}`};};

export function createRepresentativeFixturePlan({runId=`wms-fixture-${randomUUID()}`,sourceCommit}){
  check(/^wms-fixture-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(runId),'invalid run ID');
  check(/^[0-9a-f]{40}$/.test(sourceCommit),'exact source commit required');
  const ids=idParts({runId});const roots=[{table:'warehouse.products',id:ids.product},{table:'warehouse.inventory_units',id:ids.unit}];
  return {version:1,runId,namespace:runId,projectRef:WMS_FIXTURE_PROJECT_REF,sourceCommit,stockOrigin:'synthetic',roots,
    operations:[{id:OP,action:'seed_one_serial',rootKeys:roots.map(r=>`${r.table}:${r.id}`)}]};
}
function validatePlan(plan){check(isDeepStrictEqual(plan,createRepresentativeFixturePlan(plan)),'only the exact two-row representative write-set is supported');}

export function assertFixtureDatabaseTarget(connectionString,{localDisposable=false}={}){
  let url;try{url=new URL(connectionString);}catch{throw Error('Invalid database connection input');}
  check(['postgres:','postgresql:'].includes(url.protocol)&&!url.search&&!url.hash,'connection overrides are forbidden');
  if(localDisposable){
    check(['localhost','127.0.0.1','[::1]'].includes(url.hostname)&&/^\/qa_wms_fixture_[0-9a-f]{32}$/.test(url.pathname),'only an owned disposable local database is allowed');
  }else{
    const direct=url.hostname===`db.${WMS_FIXTURE_PROJECT_REF}.supabase.co`&&decodeURIComponent(url.username)==='postgres';
    const sessionPooler=/^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$/.test(url.hostname)&&decodeURIComponent(url.username)===`postgres.${WMS_FIXTURE_PROJECT_REF}`;
    check((direct||sessionPooler)&&(!url.port||url.port==='5432')&&url.pathname==='/postgres','wrong project, database or non-session pooler');
  }
  return url;
}
async function transaction(client,readOnly,fn){
  await client.query(readOnly?'begin isolation level repeatable read read only':'begin isolation level read committed');
  try{
    await client.query("select set_config('lock_timeout','3s',true),set_config('statement_timeout','30s',true),set_config('timezone','UTC',true)");
    const result=await fn();await client.query('commit');return result;
  }catch(error){await client.query('rollback');throw error;}
}
async function storedRun(client,plan,bindings){
  const row=(await client.query('select * from private.wms_fixture_runs where run_id=$1',[plan.runId])).rows[0];
  if(row)check(isDeepStrictEqual(row.plan,plan)&&isDeepStrictEqual(row.bindings,bindings),'run plan or bin bindings changed');
  return row;
}
async function rowsForRun(client,plan){
  const ids=idParts(plan);const rows=[];
  for(const table of tableNames){
    const condition=table==='private.warehouse_unit_history'?'unit_id=$1':table==='private.warehouse_stock_epochs'?"(scope_key::jsonb)->>0=$1":'id=$1';
    const id=table==='warehouse.products'||table==='private.warehouse_stock_epochs'?ids.product:ids.unit;
    const result=await client.query(`select id::text as id,md5(to_jsonb(t)::text) as md5,
      encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') as sha256 from ${sqlNames[table]} t where ${condition} order by id`,[id]);
    rows.push(...result.rows.map(r=>({table,id:r.id,md5:r.md5,sha256:r.sha256})));
  }
  return rows;
}
const recordsFor=(plan,rows)=>rows.map(r=>({table:r.table,id:r.id,runId:plan.runId,operationId:OP,rowSha256:r.sha256}));
const sqlIdentifier=n=>{check(/^[a-z_][a-z0-9_]*$/.test(n),'unexpected catalog identifier');return `"${n}"`;};

async function preservationSnapshot(client,plan){
  const ids=idParts(plan);
  const tables=(await client.query(`select n.nspname schema,c.relname name from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where c.relkind in ('r','p') and (n.nspname in ('warehouse','procurement','product')
      or (n.nspname='core' and c.relname in ('profiles','roles','user_roles','activity_log'))
      or (n.nspname='auth' and c.relname in ('users','audit_log_entries'))
      or (n.nspname='private' and c.relname not in ('wms_fixture_runs','wms_fixture_leases','wms_fixture_operations','wms_fixture_owned_rows','wms_fixture_identities','uat_warehouse_archive_batches','uat_warehouse_archive_members'))
      or exists(select 1 from pg_constraint fk where fk.conrelid=c.oid and fk.contype='f'
        and fk.confrelid in ('warehouse.products'::regclass,'warehouse.inventory_units'::regclass))) order by 1,2`)).rows;
  const names=tables.map(t=>`${t.schema}.${t.name}`);
  for(const required of ['warehouse.products','warehouse.inventory_units','procurement.requests','auth.users','core.profiles','core.activity_log','private.warehouse_unit_history'])check(names.includes(required),`missing preservation surface ${required}`);
  const result=[];
  for(const t of tables){
    const name=`${t.schema}.${t.name}`;
    const excluded=name==='warehouse.products'||name==='private.warehouse_stock_epochs'?ids.product:name==='warehouse.inventory_units'||name==='private.warehouse_unit_history'?ids.unit:null;
    const where=excluded?` where ${name==='private.warehouse_unit_history'?'unit_id':name==='private.warehouse_stock_epochs'?"(scope_key::jsonb)->>0":'id'}<>$1`:'';
    const row=(await client.query(`select count(*)::text count,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) hash
      from ${sqlIdentifier(t.schema)}.${sqlIdentifier(t.name)} t${where}`,excluded?[excluded]:[])).rows[0];
    result.push({table:name,...row});
  }
  return result;
}
const changedSurfaces=(before,after)=>[...new Set([...before,...after].map(r=>r.table))]
  .filter(table=>!isDeepStrictEqual(before.find(r=>r.table===table),after.find(r=>r.table===table))).sort();

async function exactOwnership(client,plan,run){
  const rows=await rowsForRun(client,plan);
  const owned=(await client.query('select * from private.wms_fixture_owned_rows where run_id=$1 order by table_name,row_id',[plan.runId])).rows;
  const operations=(await client.query('select * from private.wms_fixture_operations where run_id=$1',[plan.runId])).rows;
  if(!run){check(rows.length===0&&owned.length===0&&operations.length===0,'fixture identity collision');return {rows,operations};}
  check(operations.length<=1&&rows.length===owned.length,'unknown or incomplete operation ownership');
  check(rows.every(r=>owned.some(o=>o.table_name===r.table&&o.row_id===r.id&&o.row_sha256===r.sha256&&o.row_md5===r.md5&&o.operation_id===OP)),'owned row changed or foreign row found');
  check(!operations.length?rows.length===0:rows.length===4&&rows.filter(r=>r.table==='private.warehouse_unit_history').length===1
    &&rows.filter(r=>r.table==='private.warehouse_stock_epochs').length===1,'unexpected retained history/fixture closure');
  return {rows,operations};
}
async function checkBin(client,bindings){
  const result=await client.query(`select b.id from warehouse.storage_areas b join warehouse.locations l on l.id=b.location_id
    where b.id=$1 and l.id=$2 and b.active is true and l.active is true and l.type='warehouse'`,[bindings.binId,bindings.locationId]);
  check(result.rows.length===1,'explicit active Warehouse bin required');
}
async function checkSourceContract(client,plan){
  const fingerprints=[['private.archive_uat_warehouse_fixture(text,jsonb)','bee94066b7e49d48782f1168d8ac89a0'],
    ['private.uat_warehouse_references(jsonb,text)','37655d996dc4b6ade61c8147a08542a3'],
    ['private.guard_uat_archived_warehouse_write()','1ccd0ed4bb034f13ba6734ecbd54932d'],
    ['private.warehouse_record_unit_history()','3c7dfcf8c4acc69faa8cd8b2cc1cd534'],
    ['private.warehouse_advance_stock_epoch()','f46559a09d5636760f37c40d83d277f9'],
    ['private.warehouse_stock_scope(text,text,text)','bf38a5d379d9a7ca35dbd7be07d65e25'],
    ['private.normalize_inventory_unit_serial()','40344bb25cc74e0f4b99cb201c4cfbf0'],
    ['private.lock_serial_custody_identity(text)','641a7661fd659bc3f36a994da56edcaf'],
    ['private.warehouse_lock_work_location()','6e153048df3b2950cf06169bc86fa64c']];
  for(const [signature,hash] of fingerprints){
    const row=(await client.query("select md5(replace(prosrc,chr(13),'')) hash from pg_proc where oid=to_regprocedure($1)",[signature])).rows[0];
    check(row?.hash===hash,'archive/history source contract drift');
  }
  const writerContracts=[
    ['private.wms_fixture_tokens(jsonb)','2c507914f36344858b484521263e4885',false,'i'],
    ['private.wms_fixture_guard_targets()','6cdf59eb24c4598160ad2718ed7bf915',true,'s'],
    ['private.wms_fixture_guard_write()','3c138d2eb9df1a00bbb06e9555395e9a',true,'v'],
    ['private.wms_fixture_assert_writer_coverage()','e8b746792b07622e501f6b05610fb7ae',true,'s'],
  ];
  for(const [signature,hash,definer,volatility] of writerContracts){
    const row=(await client.query(`select md5(replace(prosrc,chr(13),'')) hash,prosecdef,provolatile,
      proowner='postgres'::regrole as owner_ok,proconfig=array['search_path=""'] as config_ok,
      not exists(select 1 from unnest(array['anon','authenticated','service_role']) r(role)
        where has_function_privilege(r.role,p.oid,'EXECUTE')) as private_only from pg_proc p where oid=to_regprocedure($1)`,[signature])).rows[0];
    check(row?.hash===hash&&row.prosecdef===definer&&row.provolatile===volatility&&row.owner_ok&&row.config_ok&&row.private_only,'writer source contract drift');
  }
  await client.query('select private.wms_fixture_assert_writer_coverage()');
  const seedTriggers=[
    ['warehouse.products','uat_archived_record_write_guard','private.guard_uat_archived_warehouse_write()',31,'O'],
    ['warehouse.inventory_units','uat_archived_record_write_guard','private.guard_uat_archived_warehouse_write()',31,'O'],
    ['warehouse.inventory_units','warehouse_count_epoch','private.warehouse_advance_stock_epoch()',31,'O'],
    ['warehouse.inventory_units','warehouse_inventory_unit_serial_normalize','private.normalize_inventory_unit_serial()',23,'O'],
    ['warehouse.inventory_units','warehouse_unit_history','private.warehouse_record_unit_history()',29,'O'],
    ['warehouse.inventory_units','warehouse_work_location_guard','private.warehouse_lock_work_location()',23,'O'],
    ...tableNames.map(table=>[table,'wms_fixture_registered_write_guard','private.wms_fixture_guard_write()',31,'A']),
  ].map(([table,name,signature,type,enabled])=>({table,name,signature,type,enabled}));
  const installed=(await client.query(`select n.nspname||'.'||c.relname as table,g.tgname name,g.tgfoid::regprocedure::text signature,
    g.tgtype::int type,g.tgenabled enabled,g.tgqual is null as unconditional,g.tgnargs=0 as no_args
    from pg_trigger g join pg_class c on c.oid=g.tgrelid join pg_namespace n on n.oid=c.relnamespace
    where not g.tgisinternal and (g.tgtype::int & 4)=4 and (n.nspname||'.'||c.relname)=any($1::text[])`,[tableNames])).rows;
  check(installed.length===seedTriggers.length&&installed.every(({unconditional,no_args,...t})=>unconditional&&no_args
    &&seedTriggers.some(expected=>isDeepStrictEqual(t,expected))),'seed trigger source contract drift');
  const ids=idParts(plan);
  const collision=(await client.query(`select (select count(*) from warehouse.products where sku=$1 and id<>$2)
    +(select count(*) from warehouse.inventory_units where serial_number=$1 and id<>$3) as n`,[ids.serial,ids.product,ids.unit])).rows[0];
  check(Number(collision.n)===0,'foreign SKU or serial collision');
}
async function rejectForeignDependencies(client,plan){
  const ids=idParts(plan);
  const exempt=(schema,name)=>['warehouse.inventory_units','private.warehouse_unit_history'].includes(`${schema}.${name}`)
    ? `exists(select 1 from private.wms_fixture_owned_rows own where own.run_id=$2 and own.table_name='${schema}.${name}'
        and own.row_id=to_jsonb(t)->>'id' and own.row_sha256=encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'))`
    : 'false';
  // Catalog pairs preserve composite FK semantics; no schema or column-name
  // assumption may hide another department's reference to either exact root.
  const foreignKeys=(await client.query(`select ns.nspname schema,c.relname name,parent.relname parent,
    row_security_active(c.oid) filtered,
    jsonb_agg(jsonb_build_object('child',ca.attname,'parent',pa.attname) order by keys.ordinality) columns
    from pg_constraint fk join pg_class c on c.oid=fk.conrelid join pg_namespace ns on ns.oid=c.relnamespace
    join pg_class parent on parent.oid=fk.confrelid
    cross join lateral unnest(fk.conkey,fk.confkey) with ordinality keys(child,parent,ordinality)
    join pg_attribute ca on ca.attrelid=c.oid and ca.attnum=keys.child
    join pg_attribute pa on pa.attrelid=parent.oid and pa.attnum=keys.parent
    where fk.contype='f' and fk.confrelid in ('warehouse.products'::regclass,'warehouse.inventory_units'::regclass)
    group by fk.oid,ns.nspname,c.relname,parent.relname,c.oid order by ns.nspname,c.relname,fk.oid`)).rows;
  for(const fk of foreignKeys){
    check(!fk.filtered,'foreign-key dependency scan is row-filtered');
    const relation=`${sqlIdentifier(fk.schema)}.${sqlIdentifier(fk.name)}`;
    const joins=fk.columns.map(c=>`t.${sqlIdentifier(c.child)}=parent.${sqlIdentifier(c.parent)}`).join(' and ');
    const result=await client.query(`select exists(select 1 from ${relation} t where exists(
      select 1 from warehouse.${sqlIdentifier(fk.parent)} parent where parent.id=$1 and ${joins})
      and $2::text is not null and not (${exempt(fk.schema,fk.name)})) found`,[fk.parent==='products'?ids.product:ids.unit,plan.runId]);
    check(!result.rows[0].found,`foreign dependency in ${fk.schema}.${fk.name}`);
  }
  const productKeys=['product_id','productId','warehouse_product_id','warehouseProductId','source_product_id','sourceProductId','output_product_id','outputProductId'];
  const unitKeys=['unit_id','unitId','inventory_unit_id','inventoryUnitId'];
  const serialKeys=['serial_number','serialNumber','serial_numbers','serialNumbers','pickedSerialNumbers'];
  const keys=names=>`(${names.map(n=>`@.key == ${JSON.stringify(n)}`).join(' || ')})`;
  // Inspect structured identity fields, including nested unit/receipt states
  // and serial arrays. Never use substring/prefix scans of arbitrary text.
  const path=`strict $.** ? (@.type() == "object").keyvalue() ? (
    (${keys(productKeys)} && @.value == $product) || (${keys(unitKeys)} && @.value == $unit) ||
    (${keys(serialKeys)} && (@.value ? (@.type() == "string") like_regex ${JSON.stringify(`^\\s*${ids.serial}\\s*$`)} flag "i" ||
      @.value ? (@.type() == "array")[*] ? (@.type() == "string") like_regex ${JSON.stringify(`^\\s*${ids.serial}\\s*$`)} flag "i")))`;
  const tables=(await client.query(`select n.nspname schema,c.relname name,row_security_active(c.oid) filtered
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where c.relkind in ('r','p') and not (n.nspname='private' and c.relname='wms_fixture_identities') and (n.nspname in ('warehouse','product','procurement')
      or (n.nspname='private' and (c.relname like 'stock_conversion_%' or c.relname like 'event_custody_%'
        or c.relname like 'external_po_%' or c.relname='warehouse_unit_history'))
      or (n.nspname not in ('pg_catalog','information_schema') and exists(select 1 from pg_attribute a
        where a.attrelid=c.oid and not a.attisdropped and a.attname=any($1::text[])))) order by 1,2`,[productKeys.concat(unitKeys,serialKeys)])).rows;
  for(const {schema,name,filtered} of tables){
    check(!filtered,'logical dependency scan is row-filtered');
    const result=await client.query(`select exists(select 1 from ${sqlIdentifier(schema)}.${sqlIdentifier(name)} t
      where jsonb_path_exists(to_jsonb(t),$1::jsonpath,$3::jsonb) and $2::text is not null and not (${exempt(schema,name)})) found`,
    [path,plan.runId,JSON.stringify({product:ids.product,unit:ids.unit})]);
    check(!result.rows[0].found,`foreign dependency in ${schema}.${name}`);
  }
}

/** Low-level sessions for reviewed integrations/tests. Production CLI uses the
 * verified connector below, not caller-supplied target assertions. */
export function createPostgresFixtureSessions({writer,reader,readHealth,bindings,onObservation=()=>{}}){
  check(writer!==reader,'independent read-only connection required');
  check(bindings&&Object.keys(bindings).sort().join(',')==='binId,locationId'
    &&[bindings.binId,bindings.locationId].every(x=>typeof x==='string'&&x.length>0&&x.length<=160),'invalid bin bindings');
  let heldRun=null,heldFence=null;
  const reported=new Set();
  function observe(plan,phase,before,after){
    const tables=changedSurfaces(before,after);if(!tables.length)return;
    const observation={runId:plan.runId,phase,kind:'unrelated-protected-change',tables,beforeSha256:digest(before),afterSha256:digest(after)};
    const key=digest(observation);if(!reported.has(key)){onObservation(observation);reported.add(key);}
  }
  async function mutateTransaction(plan,phase,fn){
    for(let attempt=1;attempt<=3;attempt++){
      try{return await transaction(writer,false,async()=>{
        const before=await preservationSnapshot(writer,plan);
        const result=await fn(before);
        const after=await preservationSnapshot(writer,plan);
        if(!isDeepStrictEqual(before,after)){
          const error=new Error('WMS PostgreSQL fixture: transaction preservation changed; rollback required');
          error.code='WMS_FIXTURE_PRESERVATION_DRIFT';throw error;
        }
        return result;
      });}catch(error){
        // Only known rolled-back drift is retried. Unknown COMMIT/connection
        // outcomes must be reconciled from durable receipts, never replayed.
        if(error.code!=='WMS_FIXTURE_PRESERVATION_DRIFT'||attempt===3)throw error;
        onObservation({runId:plan.runId,phase,kind:'rolled-back-preservation-retry',attempt});
      }
    }
  }
  async function runtime(plan){
    validatePlan(plan);const h=await readHealth();
    check(h?.status==='ok'&&h.commit===plan.sourceCommit&&h.deployment?.appEnv==='uat'&&h.deployment?.supabaseProjectRef===WMS_FIXTURE_PROJECT_REF,'runtime SHA/environment/project mismatch');
  }
  async function lease(client,plan,fence,open=false){
    check(heldRun===plan.runId&&heldFence===fence,'session does not own this fence');
    const row=(await client.query(`select *,owner_pid=pg_backend_pid() and owner_backend_start=
      (select backend_start from pg_stat_activity where pid=pg_backend_pid()) as owns_backend
      from private.wms_fixture_leases where run_id=$1 for update`,[plan.runId])).rows[0];
    check(row?.fence===fence&&row.owns_backend&&(!open||row.state==='open'),'stale or closed writer fence');return row;
  }
  const adapter={id:'postgres-exact-one-serial-v1',
    async inspect({plan,records}){
      await runtime(plan);
      return transaction(writer,true,async()=>{
        await checkSourceContract(writer,plan);await checkBin(writer,bindings);const run=await storedRun(writer,plan,bindings);
        const {rows}=await exactOwnership(writer,plan,run);
        if(run)observe(plan,'inspection',run.preservation,await preservationSnapshot(writer,plan));
        const expected=recordsFor(plan,rows);
        if(records)check(isDeepStrictEqual(records,expected),'requested cleanup inventory differs from actual owned rows');
        return {...envelope(plan),appEnv:'uat',complete:true,roots:plan.roots.map(r=>({...r,ownerRunId:plan.runId,classification:rows.length?'owned-synthetic':'reserved-synthetic',masterStock:false})),
          records:expected.map(r=>({...r,ownerRunId:plan.runId,classification:'owned-synthetic',masterStock:false}))};
      });
    },
    async acquire({plan,recovery}){
      await runtime(plan);check(!heldRun,'adapter already owns a run');
      const locked=(await writer.query("select pg_try_advisory_lock(hashtextextended($1,0)) locked",[`wms-fixture:${plan.runId}`])).rows[0].locked;
      check(locked,'another process still owns the run; no automatic termination');
      try{
        const fence=randomUUID();
        await mutateTransaction(plan,'acquire',async before=>{
          await checkSourceContract(writer,plan);const run=await storedRun(writer,plan,bindings);await exactOwnership(writer,plan,run);await checkBin(writer,bindings);
          check(recovery||!run,'existing run requires durable recovery');
          await writer.query("select pg_advisory_xact_lock(hashtextextended('wms-fixture-registered-writers',0))");
          if(!run)await writer.query('insert into private.wms_fixture_runs(run_id,plan,bindings,preservation) values($1,$2,$3,$4)',[plan.runId,JSON.stringify(plan),JSON.stringify(bindings),JSON.stringify(before)]);
          const ids=idParts(plan);
          await writer.query(`insert into private.wms_fixture_identities(run_id,product_id,unit_id,serial_number) values($1,$2,$3,$4)
            on conflict(run_id) do nothing`,[plan.runId,ids.product,ids.unit,ids.serial]);
          await writer.query(`insert into private.wms_fixture_leases(run_id,fence,state,owner_pid,owner_backend_start)
            select $1,$2,$3,pg_backend_pid(),backend_start from pg_stat_activity where pid=pg_backend_pid()
            on conflict(run_id) do update set fence=excluded.fence,state=excluded.state,
              owner_pid=excluded.owner_pid,owner_backend_start=excluded.owner_backend_start,seed_transaction=null`,[plan.runId,fence,recovery?'drained':'open']);
        });
        heldRun=plan.runId;heldFence=fence;return {...envelope(plan),fence};
      }catch(error){await writer.query('select pg_advisory_unlock(hashtextextended($1,0))',[`wms-fixture:${plan.runId}`]);throw error;}
    },
    async execute({plan,fence,operation,idempotencyKey,signal}){
      await runtime(plan);check(isDeepStrictEqual(operation,plan.operations[0])&&idempotencyKey===`${plan.runId}:mutation:${OP}`,'unsupported command');
      check(!signal?.aborted,'operation aborted before dispatch');
      return mutateTransaction(plan,'execute',async()=>{
        check(!signal?.aborted,'operation aborted before retry dispatch');
        await lease(writer,plan,fence,true);await checkSourceContract(writer,plan);const run=await storedRun(writer,plan,bindings);
        const existing=await exactOwnership(writer,plan,run);
        if(existing.operations.length)return {...envelope(plan),fence,operationId:OP,outcome:'applied',receiptId:existing.operations[0].receipt_id,records:recordsFor(plan,existing.rows)};
        await checkBin(writer,bindings);const ids=idParts(plan);
        await writer.query('update private.wms_fixture_leases set seed_transaction=txid_current() where run_id=$1',[plan.runId]);
        await writer.query(`insert into warehouse.products(id,sku,name,category,serialized,attributes,unit_cost,reorder_point,item_class,serialization_policy,uom)
          values($1,$2,'Owned UAT fixture - cleanup required','device',true,$3,0,0,'sellable_sku','required','piece')`,[ids.product,ids.serial,JSON.stringify({synthetic:true,wms_fixture_run_id:plan.runId})]);
        await writer.query(`insert into warehouse.inventory_units(id,product_id,serial_number,location_id,bin_id,status)
          values($1,$2,$3,$4,$5,'in_stock')`,[ids.unit,ids.product,ids.serial,bindings.locationId,bindings.binId]);
        const rows=await rowsForRun(writer,plan);check(rows.length===4,'actual registration history and stock epoch must each be exactly one row');
        const receiptId=`${plan.runId}:${OP}`;
        await writer.query('insert into private.wms_fixture_operations(run_id,operation_id,receipt_id) values($1,$2,$3)',[plan.runId,OP,receiptId]);
        for(const r of rows)await writer.query('insert into private.wms_fixture_owned_rows(run_id,operation_id,table_name,row_id,row_sha256,row_md5) values($1,$2,$3,$4,$5,$6)',[plan.runId,OP,r.table,r.id,r.sha256,r.md5]);
        await writer.query('update private.wms_fixture_leases set seed_transaction=null where run_id=$1',[plan.runId]);
        await rejectForeignDependencies(writer,plan);
        return {...envelope(plan),fence,operationId:OP,outcome:'applied',receiptId,records:recordsFor(plan,rows)};
      });
    },
    async drain({plan,fence}){
      await mutateTransaction(plan,'drain',async()=>{await lease(writer,plan,fence);await writer.query("update private.wms_fixture_leases set state='drained' where run_id=$1",[plan.runId]);});
      return {...envelope(plan),fence,writers:0,fenced:true};
    },
    async reconcile({plan,fence,intents}){
      await runtime(plan);return transaction(writer,true,async()=>{
        const run=await storedRun(writer,plan,bindings);check(run,'durable run missing');
        const {rows,operations}=await exactOwnership(writer,plan,run);
        check(intents.length<=1&&intents.every(i=>i.operationId===OP&&i.idempotencyKey===`${plan.runId}:mutation:${OP}`),'foreign durable intent');
        check(!operations.length||intents.length===1,'database outcome has no durable intent');
        return {...envelope(plan),fence,complete:true,outcomes:intents.map(i=>({operationId:i.operationId,outcome:operations.length?'applied':'not-applied',receiptId:operations[0]?.receipt_id??null})),records:recordsFor(plan,rows)};
      });
    },
    async archive({plan,fence,records,idempotencyKey,inventorySha256}){
      await runtime(plan);return mutateTransaction(plan,'archive',async()=>{
        const l=await lease(writer,plan,fence);check(l.state==='drained','writer is not drained');await checkSourceContract(writer,plan);
        // Same lock order as the archive authority: fence, then exact roots.
        // FK writers cannot commit a new reference between closure and archive.
        await writer.query("select pg_advisory_xact_lock(hashtextextended('uat-warehouse-fixture-archive',0))");
        const ids=idParts(plan);
        await writer.query('select id from warehouse.products where id=$1 for update',[ids.product]);
        await writer.query('select id from warehouse.inventory_units where id=$1 for update',[ids.unit]);
        const run=await storedRun(writer,plan,bindings);await rejectForeignDependencies(writer,plan);
        const {rows}=await exactOwnership(writer,plan,run);check(isDeepStrictEqual(records,recordsFor(plan,rows)),'archive inventory changed');
        const sorted=records.toSorted((a,b)=>`${a.table}:${a.id}`<`${b.table}:${b.id}`?-1:1);
        check(inventorySha256===digest(sorted)&&idempotencyKey===`${plan.runId}:archive:v1`,'archive intent mismatch');
        if(!rows.length)return {...envelope(plan),fence,idempotencyKey,inventorySha256,archiveIds:[]};
        const manifest=rows.filter(r=>r.table.startsWith('warehouse.')).map(r=>({table:r.table.slice('warehouse.'.length),row_id:r.id,row_md5:r.md5,provenance:`Owned run ${plan.runId}; operation ${OP}; exact immutable receipt` }));
        await writer.query('select private.archive_uat_warehouse_fixture($1,$2::jsonb)',[idParts(plan).batch,JSON.stringify(manifest)]);
        await exactOwnership(writer,plan,run);await rejectForeignDependencies(writer,plan);
        return {...envelope(plan),fence,idempotencyKey,inventorySha256,archiveIds:[idParts(plan).batch]};
      });
    },
    async release({plan,fence}){
      check(heldRun===plan.runId&&heldFence===fence,'cannot release another run');
      await writer.query('select pg_advisory_unlock(hashtextextended($1,0))',[`wms-fixture:${plan.runId}`]);heldRun=null;heldFence=null;
    },
  };
  const verifier={id:'postgres-independent-readonly-v1',async prove({plan,fence,nonce}){
    await runtime(plan);return transaction(reader,true,async()=>{
      check((await reader.query('show transaction_read_only')).rows[0].transaction_read_only==='on','proof transaction is not read-only');
      await checkSourceContract(reader,plan);const run=await storedRun(reader,plan,bindings);check(run,'durable run missing');await rejectForeignDependencies(reader,plan);
      observe(plan,'readonly-proof',run.preservation,await preservationSnapshot(reader,plan));
      const {rows}=await exactOwnership(reader,plan,run);const records=recordsFor(plan,rows);const ids=idParts(plan);
      const members=(await reader.query('select table_name,row_id,row_md5,batch_id from private.uat_warehouse_archive_members where batch_id=$1 order by table_name,row_id',[ids.batch])).rows;
      const business=rows.filter(r=>r.table.startsWith('warehouse.'));
      check(members.length===business.length&&business.every(r=>members.some(m=>`warehouse.${m.table_name}`===r.table&&m.row_id===r.id&&m.row_md5===r.md5)),'archive membership is incomplete or foreign');
      const active=(await reader.query(`select (select count(*) from warehouse.active_products where id=$1)
        +(select count(*) from warehouse.active_inventory_units where id=$2) as n`,[ids.product,ids.unit])).rows[0];
      check(Number(active.n)===0,'active fixture residue remains');
      const history=rows.filter(r=>r.table==='private.warehouse_unit_history');
      check(!rows.length||history.length===1,'original unit history is unaccounted');
      return {...envelope(plan),fence,nonce,verifierId:this.id,complete:true,activeCount:0,unknownCount:0,foreignCount:0,
        archiveIds:rows.length?[ids.batch]:[],retainedRecords:records,archivedRecords:records.map(r=>({...r,archiveId:ids.batch}))};
    });
  }};
  return {adapter,verifier};
}

export async function connectPostgresFixtureAdapter({databaseUrl,bindings,onObservation}){
  // Writer safeguards require independent review, full replay and an approved
  // transport before activation. Local proof alone cannot open this connector.
  assertWmsLiveFixtureCleanupReady();
  assertFixtureDatabaseTarget(databaseUrl);
  const {Client}=await import('pg');
  const clients=[0,1].map(()=>new Client({connectionString:databaseUrl,ssl:{rejectUnauthorized:true},connectionTimeoutMillis:8000,application_name:'mwell-wms-fixture-lifecycle'}));
  try{
    for(const c of clients){await c.connect();await c.query("set statement_timeout='30s';set lock_timeout='3s';set timezone='UTC'");}
    const identities=await Promise.all(clients.map(c=>c.query('select session_user,current_database(),pg_backend_pid() pid')));
    check(identities.every(r=>r.rows[0].session_user==='postgres'&&r.rows[0].current_database==='postgres')&&identities[0].rows[0].pid!==identities[1].rows[0].pid,'independent admin sessions required');
    const pair=createPostgresFixtureSessions({writer:clients[0],reader:clients[1],bindings,onObservation,readHealth:async()=>{
      const response=await fetch('https://mwell-intra-uat.vercel.app/api/health',{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10000)});
      check(response.ok,'UAT health request failed');return response.json();
    }});
    return {...pair,close:async()=>{await Promise.allSettled(clients.map(c=>c.end()));}};
  }catch(error){await Promise.allSettled(clients.map(c=>c.end()));throw error;}
}
