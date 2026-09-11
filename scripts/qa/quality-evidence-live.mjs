import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const require=createRequire(new URL('../../apps/shell/package.json',import.meta.url));
const { chromium }=require('@playwright/test');
const origin='https://mwell-intra-uat.vercel.app';
const run=process.env.QUALITY_RUN??'quality-live';
assert(/^[a-z0-9-]+$/.test(run));
const output=path.resolve('outputs/sep12-performance',run);
assert(process.env.AUDIT_PASSWORD);
const health=await(await fetch(origin+'/api/health',{cache:'no-store'})).json();
assert.equal(health.deployment.appEnv,'uat');
assert.equal(health.deployment.supabaseProjectRef,'kkoitlvydytdhlpxhuah');
await mkdir(output,{recursive:true});
const browser=await chromium.launch();
const context=await browser.newContext({viewport:{width:1440,height:900},serviceWorkers:'block'});
const page=await context.newPage(); page.setDefaultTimeout(30000);
const report={health,checks:[],screenshots:[]};
const summaries=new Map(), details=new Map(), observed=[];
const parseJobs=[];
page.on('response',response=>{
  const url=new URL(response.url());
  if(!url.hostname.endsWith('supabase.co')) return;
  if(url.pathname.endsWith('/quality_inspection_queue')) parseJobs.push(response.json().then(rows=>{
    assert(Array.isArray(rows)); for(const row of rows) { assert(!('evidence_urls' in row)); summaries.set(row.id,row); }
  }));
  if(url.pathname.endsWith('/quality_inspections') && url.searchParams.get('select')==='evidence_urls') {
    observed.push(url.searchParams.get('id'));
    if(response.ok()) parseJobs.push(response.json().then(body=>{
      const row=Array.isArray(body)?body[0]:body;
      assert(Array.isArray(row?.evidence_urls),'Exact-photo response must contain evidence');
      details.set(url.searchParams.get('id').replace(/^eq\./,''),row.evidence_urls);
    }));
  }
});
const capture=async name=>{ await page.screenshot({path:path.join(output,name),animations:'disabled'});report.screenshots.push(name); };
try {
  await page.goto(origin+'/login');
  await page.locator('#email').fill('intra.test.operations.lead@mwell.com.ph');
  await page.locator('#password').fill(process.env.AUDIT_PASSWORD);
  await page.getByRole('button',{name:/^sign in$/i}).click();
  await page.waitForURL(url=>url.pathname!='/login');
  await page.goto(origin+'/warehouse/quality');
  await page.getByText(/\d+ pending inspections/).waitFor();
  await Promise.all(parseJobs);
  assert(summaries.size>100,'Must verify a multi-page queue');
  assert.equal(observed.length,0,'Pending must not download inspection photos');
  report.checks.push({check:'complete metadata queue with no photo downloads on Pending',count:summaries.size,passed:true});
  await capture('pending-desktop.png');
  await page.getByRole('tab',{name:'Completed',exact:true}).click();
  const firstPhoto=page.getByRole('button',{name:/View \d+ evidence photo/}).first();
  await firstPhoto.waitFor();
  await firstPhoto.getByRole('img', { name: 'Evidence', exact: true }).waitFor();
  await Promise.all(parseJobs);
  const totalWithEvidence=[...summaries.values()].filter(row=>row.disposition!=='pending'&&row.evidence_count>0).length;
  assert(observed.length<=totalWithEvidence,'Each completed record should load at most once');
  assert(observed.every(value=>summaries.get(value.replace(/^eq\./,'')).disposition!=='pending'),'Completed must not fetch pending photos');
  report.checks.push({check:'Completed reads only its photo records; desktop currently fits all five',visibleRequests:observed.length,totalWithEvidence,passed:true});
  const row=firstPhoto.locator('xpath=ancestor::li[1]');
  const id=(await row.getAttribute('aria-label')).replace('Inspection ','');
  await capture('completed-desktop.png');
  await firstPhoto.click();
  const dialog=page.getByRole('dialog',{name:'Evidence photo'});
  await dialog.waitFor();
  const img=dialog.getByRole('img',{name:'Evidence',exact:true});
  await img.waitFor();
  await img.evaluate(image=>image.decode());
  const actual=await img.getAttribute('src');
  if(details.get(id)[0].startsWith('data:')) assert.equal(actual,details.get(id)[0]);
  assert(await img.evaluate(image=>image.naturalWidth>0));
  report.checks.push({check:'exact persisted photo opens and decodes',inspectionId:id,passed:true});
  await capture('photo-preview-desktop.png');
  await page.keyboard.press('Escape');
  let failOnce=true;
  await page.route('**/rest/v1/quality_inspections?*',async route=>{
    const url=new URL(route.request().url());
    if(failOnce && url.searchParams.get('select')==='evidence_urls' && url.searchParams.get('id')===`eq.${id}`) {
      failOnce=false; await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'Synthetic photo-read failure for UAT verification'})});
    } else await route.continue();
  });
  await page.goto(origin+`/warehouse/quality?inspection=${id}`);
  await page.getByRole('button',{name:'Retry photos',exact:true}).waitFor();
  await capture('photo-retry-desktop.png');
  await page.getByRole('button',{name:'Retry photos',exact:true}).click();
  await page.getByRole('button',{name:/View \d+ evidence photo/}).waitFor();
  assert.equal(failOnce,false);
  report.checks.push({check:'injected read failure recovers without a business mutation',passed:true});
  await page.unroute('**/rest/v1/quality_inspections?*');
  await page.setViewportSize({width:390,height:844});
  await page.reload();
  await page.getByRole('button',{name:/View \d+ evidence photo/}).waitFor();
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await capture('completed-mobile.png');
  report.checks.push({check:'mobile exact-record link, thumbnail and no horizontal page overflow',passed:true});
  await page.goto(origin+'/warehouse/quality');
  await page.getByText(/\d+ pending inspections/).waitFor();
  observed.length=0;
  await page.getByRole('tab',{name:'Completed',exact:true}).click();
  await page.getByRole('button',{name:/View \d+ evidence photo/}).first().getByRole('img',{name:'Evidence',exact:true}).waitFor();
  const beforeScroll=observed.length;
  assert(beforeScroll<totalWithEvidence,'Mobile must leave offscreen photo records unloaded');
  await page.getByRole('list',{name:'Completed inspections'}).getByRole('listitem').last().scrollIntoViewIfNeeded();
  await page.getByRole('list',{name:'Completed inspections'}).getByRole('listitem').last().getByRole('img',{name:'Evidence',exact:true}).waitFor();
  assert(observed.length>beforeScroll,'Scrolling must load newly visible photos');
  await capture('completed-mobile-scroll.png');
  report.checks.push({check:'mobile scroll loads previously offscreen photos',beforeScroll,afterScroll:observed.length,totalWithEvidence,passed:true});
  report.passed=true;
} catch(error) { report.passed=false;report.error=error.message;await capture('failure.png');throw error; }
finally { await writeFile(path.join(output,'results.json'),JSON.stringify(report,null,2)); await context.close();await browser.close(); }
console.log(JSON.stringify(report));
