import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {classifyPlatform,validateDiagnosticOptions} from './wms-fixture-migration-replay.native.mjs';
test('bare native PostgreSQL cannot certify Supabase migration compatibility',()=>{
  const result=classifyPlatform({server_version:'17.6',auth_users:null,storage_objects:null,auth_uid:null,api_roles:[]});
  assert.equal(result.supabaseCompatible,false);assert.deepEqual(result.missing,['auth.users','storage.objects','auth.uid()','anon','authenticated','service_role']);
  assert.equal(classifyPlatform({server_version:'17.6',auth_users:'auth.users',storage_objects:'storage.objects',auth_uid:'auth.uid()',api_roles:['anon','authenticated','service_role']}).supabaseCompatible,true);
});
test('diagnostic cannot accept connection strings, remote targets or extra input',()=>{
  assert.throws(()=>validateDiagnosticOptions({databaseUrl:'postgres://remote',parent:'/tmp',nativeBin:'/tmp'}),/Unknown/);
  assert.throws(()=>validateDiagnosticOptions({parent:'/tmp',nativeBin:'https://remote'}),/absolute/);
});
test('probe contains no fixture installation, auth/role creation, extension shim or full-pass path',()=>{
  const source=readFileSync(new URL('./wms-fixture-migration-replay.native.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(source,/installAdapterFixture|create role|create schema auth|create table auth|create extension/i);
  assert.match(source,/fullNativeChainPassed: false/);
  assert.match(source,/finally/);assert.match(source,/pg_ctl/);
});
test('seven existing trigger body pins match actual source definitions and normalizer convergence, not shape fixtures',async()=>{
  const read=name=>readFileSync(new URL('../../supabase/migrations/'+name,import.meta.url),'utf8').replace(/\r\n?/g,'\n');
  const specs=[
    ['stock_conversion_watch_qc_origin','20261105233321_stock_conversion_qc_putaway_bridge.sql','a67f2490c4de34690271e88dcd3a50a6'],
    ['stock_conversion_guard_claimed_unit','20260920025920_approved_stock_origin_conversion.sql','982ce2ef4f71957d9586560d09548001'],
    ['guard_uat_archived_warehouse_write','20261106145742_uat_warehouse_fixture_archive.sql','1ccd0ed4bb034f13ba6734ecbd54932d'],
    ['warehouse_advance_stock_epoch','20261105071150_warehouse_count_integrity.sql','f46559a09d5636760f37c40d83d277f9'],
    ['normalize_inventory_unit_serial','20260826160000_harden_serial_custody_concurrency.sql','40344bb25cc74e0f4b99cb201c4cfbf0'],
    ['warehouse_record_unit_history','20261105071201_warehouse_unit_custody_history.sql','3c7dfcf8c4acc69faa8cd8b2cc1cd534'],
    ['warehouse_lock_work_location','20261105071219_warehouse_location_dependencies.sql','6e153048df3b2950cf06169bc86fa64c'],
  ];
  const db=new PGlite();
  try{
    // Only composite names needed to parse declarations; no trigger is run here.
    await db.exec('create schema private; create schema warehouse; create table private.stock_conversion_qc_origins(id uuid); create table warehouse.procurement_receipt_serial_claims(id uuid);');
    for(const [name,file] of specs){
      const sql=read(file),matches=[...sql.matchAll(new RegExp('create (?:or replace )?function private\\.'+name+'\\(\\)','gi'))];
      assert.equal(matches.length,1,name);const start=matches[0].index,end=sql.indexOf('$$;',start);assert(end>start);
      await db.exec(sql.slice(start,end+3));
    }
    const convergence=read('20260920025920_approved_stock_origin_conversion.sql'),anchor=convergence.indexOf("declare definition text:=pg_get_functiondef('private.normalize_inventory_unit_serial()'");
    assert(anchor>0);const start=convergence.lastIndexOf('do $migration$',anchor),end=convergence.indexOf('$migration$;',anchor);assert(start>=0&&end>anchor);
    await db.exec(convergence.slice(start,end+'$migration$;'.length));
    for(const [name,,md5] of specs){const r=await db.query('select md5(prosrc) body from pg_proc where oid=$1::regprocedure',['private.'+name+'()']);assert.equal(r.rows[0].body,md5,name);}
  }finally{await db.close();}
});
