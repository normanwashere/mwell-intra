// Simulated browser proof only: actual EventsApp, AppShell and controls; no UAT transport.
/* global window, document, innerWidth */
import console from 'node:console';
import process from 'node:process';
// Browser plugin not available; regular Playwright exercises the requested scoped flows.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { fileURLToPath, URL } from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const require=createRequire(new URL('../package.json',import.meta.url));
const shellRequire=createRequire(path.join(root,'apps/shell/package.json'));
const {build}=createRequire(createRequire(require.resolve('vitest/package.json')).resolve('vite'))('esbuild');
const {chromium}=shellRequire('@playwright/test');
const output=process.env.EVENT_VISUAL_OUTPUT;
assert.ok(output,'Set EVENT_VISUAL_OUTPUT to an evidence directory outside the checkout');
assert.ok(!path.resolve(output).startsWith(path.resolve(root)),'Keep generated visual evidence outside the checkout');
await mkdir(output,{recursive:true});
const auth=`
const role=new URLSearchParams(location.search).get('role')||'seller';
const owner=role==='owner', finance=role==='finance';
const eventsCaps=owner?['view_events','manage_events','request_fulfillment']:finance?['view_events','approve_settlement']:['view_event_custody','record_event_outcome'];
window.calls=[];
const store={enabled:!owner,sellers:[],entries:[],sold:finance?1:0,giveaway:finance?1:0,amount:finance?125:0};
const tables={
 events:[{id:'e1',name:'Manila Health Fair',type:'b2c',status:'active',start_date:'2026-09-20',end_date:'2026-09-21',owner_email:'owner@example.test'}],
 event_custody_totals:[{event_id:'e1',issued_units:2,reserved_units:0,returned_units:0}],
 products:[{id:'watch',name:'mWell Watch',item_class:'sellable_sku'},{id:'bag',name:'Event tote',item_class:'merchandise'}],
 departments:[{id:'marketing',code:'marketing',name:'Marketing'}],department_cost_centers:[{department_id:'marketing',code:'MKT',name:'Marketing'}],
 event_reconciliations:[],department_stock_requests:[]
};
function query(table){const result={data:tables[table]||[],error:null};const q={then:(resolve,reject)=>Promise.resolve(result).then(resolve,reject)};for(const k of ['select','in','eq','order','limit'])q[k]=()=>q;return q;}
async function rpc(name,{payload:p}){
 window.calls.push({name,payload:p});
 if(name==='event_custody_readiness')return {data:{ready:true,schema:true,capabilities:true,learning:true},error:null};
 if(name==='event_demand_availability')return {data:p.product_ids.map(product_id=>({product_id,eligible_quantity:product_id==='watch'?2:5})),error:null};
 if(name==='request_event_fulfillment')return {data:{id:'request-1',event_id:'e1'},error:null};
 if(name==='configure_event_custody'){
  if(p.action==='enable')store.enabled=true;if(p.action==='disable')store.enabled=false;
  if(p.action==='assign')store.sellers=[{user_id:'seller',full_name:'Maria Santos',email:p.seller_email,valid_until:'2026-09-21T16:00:00Z',revoked_at:null}];
  if(p.action==='revoke')store.sellers[0].revoked_at=new Date().toISOString();
  return {data:{action:p.action},error:null};
 }
 if(name==='record_event_outcome'){
  const entry={...p,id:'entry-'+store.entries.length,seller_id:'seller',created_at:new Date().toISOString()};store.entries.push(entry);
  if(p.kind==='sale'){store.sold+=p.quantity;store.amount+=p.amount;}if(p.kind==='giveaway')store.giveaway+=p.quantity;
  return {data:entry,error:null};
 }
 if(name==='event_custody_ledger')return {data:{enabled:store.enabled,may_configure:owner,event_name:'Manila Health Fair',event_status:'active',
  readiness:{ready:true,schema:true,capabilities:true,learning:true},
  totals:{sold_units:store.sold,giveaway_units:store.giveaway,gross_sales_amount:store.amount},sellers:store.sellers,next_offset:null,
  allocations:[{allocation_id:'a1',product_id:'mWell Watch',serialized:true,issued_units:2,returned_units:0,sold_units:store.sold,giveaway_units:store.giveaway,remaining_units:2-store.sold-store.giveaway,eligible_serials:store.sold?['MW-S002']:['MW-S001','MW-S002']}],
  entries:finance?[{id:'finance-entry',kind:'sale',seller_id:'seller',quantity:1,amount:125,external_reference:'RCPT-1001',serial_numbers:['MW-S001'],created_at:new Date().toISOString()}]:store.entries},error:null};
 throw new Error('Unexpected simulated RPC: '+name);
}
const client={schema:()=>({from:query,rpc}),auth:{getSession:async()=>({data:{session:null}})}};
const session={profile:{id:owner?'owner':finance?'finance':'seller',name:owner?'Event Owner':finance?'Finance Reviewer':'Maria Santos',email:role+'@example.test',kind:'employee',title:role==='seller'?'Event Seller':role},
 userRoles:{events:[owner?'coordinator':finance?'finance_reviewer':'seller']},userCapabilities:{events:eventsCaps},roleCapabilities:{events:eventsCaps},
 mode:'supabase',supabaseClient:client,loading:false,signOut:async()=>{}};
export const useSession=()=>session;
export const resetMemorySession=()=>{};
export const clearMemorySession=()=>{};
`;
const entry=`import React from 'react';import {createRoot} from 'react-dom/client';
import {EventsApp} from '${root.replaceAll('\\','/')}modules/events/src/EventsApp.tsx';
import {AppShell} from '${root.replaceAll('\\','/')}apps/shell/components/AppShell.tsx';
import {MotionProvider,ToastProvider} from '@intra/ui';
createRoot(document.getElementById('root')).render(<MotionProvider><ToastProvider><div role="status" style={{padding:'8px',background:'#fff4cc',color:'#443600',fontSize:12}}>SIMULATED RPC / local UI proof / not live certification</div><AppShell><EventsApp eventId="e1" /></AppShell></ToastProvider></MotionProvider>);`;
const sources={auth,entry,
 navigation:`export const usePathname=()=>'/events/e1';export const useRouter=()=>({push:url=>location.assign(url),refresh:()=>location.reload(),replace:url=>location.replace(url)});`,
 link:`import React from 'react';export default function Link({href,children,prefetch,...props}){return <a href={href} {...props}>{children}</a>}`,
 image:`import React from 'react';export default function Image({priority,fill,...props}){return <img {...props}/>}`,
 env:`export const ENABLE_NOTIFICATIONS=false;`,
 demo:`export const resetDemoData=()=>{};`
};
const bundle=await build({stdin:{contents:entry,sourcefile:'custody-visual.tsx',resolveDir:path.join(root,'apps/shell'),loader:'tsx'},bundle:true,write:false,format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"development"'},
 alias:{'@intra/ui':path.join(root,'packages/ui/src/index.ts'),'@intra/rbac':path.join(root,'packages/rbac/src/index.ts'),'@shell':path.join(root,'apps/shell')},
 plugins:[{name:'isolated-simulated-session',setup(b){
  b.onResolve({filter:/^(@intra\/auth|next\/(navigation|link|image)|@shell\/lib\/(supabase\/env|demoData))$/},args=>({path:args.path==='@intra/auth'?'auth':args.path.endsWith('env')?'env':args.path.endsWith('demoData')?'demo':args.path.split('/').at(-1),namespace:'mock'}));
  b.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:sources[args.path],loader:'tsx',resolveDir:path.join(root,'apps/shell')}));
 }}]});
const postcss=shellRequire('postcss'),tailwind=shellRequire('tailwindcss');
const config=shellRequire('tailwindcss/loadConfig')(path.join(root,'apps/shell/tailwind.config.ts'));
config.content=[path.join(root,'apps/shell/{app,components,lib}/**/*.{ts,tsx}'),path.join(root,'packages/ui/src/**/*.{ts,tsx}'),path.join(root,'modules/events/src/**/*.{ts,tsx}')].map(p=>p.replaceAll('\\','/'));
const css=await postcss([tailwind(config)]).process(await readFile(path.join(root,'packages/ui/src/styles.css'),'utf8')+'\n'+await readFile(path.join(root,'apps/shell/app/globals.css'),'utf8'),{from:path.join(root,'apps/shell/app/globals.css')});
await writeFile(path.join(output,'simulated.css'),css.css);
const assets={'/bundle.js':['text/javascript',bundle.outputFiles[0].contents],'/style.css':['text/css',css.css],'/mwell-wordmark.png':['image/png',await readFile(path.join(root,'apps/shell/public/mwell-wordmark.png'))]};
const chunks=path.join(root,'apps/shell/.next/static/chunks'),fontRules=[];
for(const file of await readdir(chunks)){if(!file.endsWith('.css'))continue;const parsed=postcss.parse(await readFile(path.join(chunks,file),'utf8'));parsed.walkAtRules('font-face',rule=>fontRules.push(rule.toString()));}
assert.ok(fontRules.length,'Compile the actual Next app first to supply its local fonts');
assets['/style.css'][1]+='\n'+fontRules.join('\n')+'\n:root{--font-poppins:Poppins;--font-inter:Inter;--font-jbmono:"JetBrains Mono";}';
for(const file of await readdir(path.join(root,'apps/shell/.next/static/media'))){if(file.endsWith('.woff2'))assets['/media/'+file]=['font/woff2',await readFile(path.join(root,'apps/shell/.next/static/media',file))];}
const server=createServer((req,res)=>{
 const route=new URL(req.url,'http://localhost').pathname;
 if(route.startsWith('/api/')){res.setHeader('content-type','application/json');res.end('{"guide":null}');return;}
 const asset=assets[route];if(asset){res.setHeader('content-type',asset[0]);res.end(asset[1]);return;}
 res.setHeader('content-type','text/html');res.end('<!doctype html><html><head><title>Simulated Events custody proof</title><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch({headless:true});
const report={proof:'SIMULATED ONLY; no migration, auth provisioning, learning certification or UAT writes',screens:[],calls:[]};
try{
 for(const width of [1440,390,320]){
  const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>new URL(route.request().url()).origin===url?route.continue():route.abort());
  const shot=async(name)=>{
   await page.evaluate(()=>window.scrollTo(0,0));await page.evaluate(()=>document.fonts.ready);
   assert.equal(await page.title(),'Simulated Events custody proof');
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${name}: horizontal page overflow`);
   assert.equal(await page.locator('img').evaluateAll(images=>images.every(i=>i.complete&&i.naturalWidth>0)),true);
   const file=`${width}-${name}.png`;await page.screenshot({path:path.join(output,file),fullPage:true});report.screens.push(file);
  };
  await page.goto(url+'/?role=owner');await page.getByRole('button',{name:'Enable prospective custody'}).waitFor();await shot('owner-disabled');
  await page.getByRole('button',{name:'Enable prospective custody'}).click();await page.getByRole('button',{name:'Disable seller posting'}).waitFor();
  await page.getByLabel('Named seller account email').fill('maria.santos@example.test');await page.getByRole('button',{name:'Assign seller',exact:true}).click();
  await page.getByRole('button',{name:'Revoke',exact:true}).waitFor();await shot('owner-assigned');
  await page.getByRole('button',{name:'Revoke',exact:true}).click();await page.getByText(/Maria Santos.*Revoked/).waitFor();await shot('owner-revoked');
  report.calls.push(...await page.evaluate(()=>window.calls));
  await page.getByRole('button',{name:'Request warehouse stock',exact:true}).click();
  await page.getByLabel('Product 1', {exact:true}).selectOption('watch');await page.getByRole('button',{name:'Add product'}).click();await page.getByLabel('Product 2',{exact:true}).selectOption('bag');
  await page.getByLabel('Quantity 1',{exact:true}).fill('50');await page.getByLabel('Quantity 2',{exact:true}).fill('50');
  if(width<640)assert.ok((await page.getByLabel('Product 1',{exact:true}).boundingBox()).width>=240,'Mobile product identity needs its own full-width row');
  await page.getByText(/shortage: 48/).waitFor();await shot('multi-line-demand');
  await page.goto(url+'/?role=seller');await page.getByLabel('Issued allocation').waitFor();await page.getByLabel('Issued allocation').selectOption('a1');
  await page.getByLabel('MW-S001',{exact:true}).check();await page.getByLabel('Total sales amount (PHP)').fill('125');await page.getByLabel('External reference').fill('RCPT-1001');await shot('seller-ready');
  await page.getByRole('button',{name:'Record outcome',exact:true}).click();await page.getByText('RCPT-1001',{exact:true}).waitFor();await shot('seller-recorded');
  const calls=await page.evaluate(()=>window.calls);assert.equal(calls.filter(c=>c.name==='record_event_outcome').length,1);assert.ok(!calls.some(c=>/issue|release/.test(c.name)));report.calls.push(...calls);
  await page.goto(url+'/?role=finance');await page.getByLabel('Recorded outcome totals').waitFor();await shot('finance-readback');
  assert.equal(await page.getByRole('button',{name:'Record outcome',exact:true}).count(),0);assert.equal(await page.getByLabel('Named seller account email').count(),0);
  assert.deepEqual(errors,[]);await page.close();
 }
 await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({proof:report.proof,screens:report.screens,output},null,2));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
