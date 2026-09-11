import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { checkConvenience } from './sep11-qol-checks.mjs';
const require = createRequire(new URL('../../apps/shell/package.json', import.meta.url));
const { chromium } = require('@playwright/test');
const origin = process.env.PREVIEW_ORIGIN || 'https://mwell-intra-uat.vercel.app';
assert(['https://mwell-intra-uat.vercel.app', 'http://localhost:3023'].includes(origin) || /^https:\/\/mwell-intra-[a-z0-9-]+\.vercel\.app$/.test(origin));
const stage = process.env.PREVIEW_STAGE || 'before';
assert(['before','after'].includes(stage));
assert(process.env.AUDIT_PASSWORD);
// Use only cookies exported by the authenticated Vercel CLI for this preview.
const previewCookies = process.env.PREVIEW_COOKIE_FILE ? (await readFile(process.env.PREVIEW_COOKIE_FILE,'utf8')).split(/\r?\n/).filter(line=>line.includes('\t')).map(line=>{
  const [rawDomain,,cookiePath,secure,expires,name,value]=line.split('\t');
  const domain=rawDomain.replace(/^#HttpOnly_/,'');
  assert.equal(domain,new URL(origin).hostname);
  return {name,value,domain,path:cookiePath,secure:secure==='TRUE',httpOnly:rawDomain.startsWith('#HttpOnly_'),expires:Number(expires)||-1};
}) : [];
const health = await (await fetch(origin + '/api/health',{headers:previewCookies.length?{cookie:previewCookies.map(c=>`${c.name}=${c.value}`).join('; ')}:{}})).json();
assert.equal(health.deployment.supabaseProjectRef, 'kkoitlvydytdhlpxhuah');
if(stage==='after' && origin.startsWith('https:')) {
  assert(process.env.PREVIEW_SHA, 'Verify the exact isolated preview build');
  assert.equal(health.commit,process.env.PREVIEW_SHA);
}
const run=process.env.PREVIEW_RUN||stage;
assert(/^[a-z0-9-]+$/.test(run));
const output = path.resolve('outputs/sep11-hierarchy-preview', run);
await mkdir(output, {recursive:true});
const cases = [
  {id:'pick-pack',email:'operations.associate',route:'/warehouse/fulfillment?tab=orders&filter=floor_work'},
  {id:'my-work',email:'employee',route:'/work?view=waiting'},
  {id:'purchase-order',email:'procurement.lead',route:'/procurement/purchase-orders/HANDBOOK-T7-R1-PO'},
];
const reads = new Set(['my_capability_snapshot','my_learning_snapshot','resolve_assignments','commitment_readiness','department_request_actor_names','platform_followup_page','acceptance_work_items','payment_readiness_staleness_work_items','purchase_order_closure_work_items','purchase_order_lifecycle','purchase_order_receipt_status','review_open_purchase_orders','get_effective_policy_profile','get_latest_request_draft','list_stock_change_requests','payment_evidence_options','purchase_order_amendment_work_items','request_decision_eligibility','vendor_purchase_order_acknowledgements']);
const results=[];
const browser=await chromium.launch();
try {
  for (const item of cases) {
    if(process.env.PREVIEW_CASE && process.env.PREVIEW_CASE !== item.id) continue;
    const context=await browser.newContext({serviceWorkers:'block',reducedMotion:'reduce'});
    await context.addCookies(previewCookies);
    const blocked=[];
    await context.route('**/*', route => {
      const req=route.request(), url=new URL(req.url());
      if(['GET','HEAD','OPTIONS'].includes(req.method()))return route.continue();
      if(url.hostname==='kkoitlvydytdhlpxhuah.supabase.co' && (url.pathname==='/auth/v1/token'||url.pathname.startsWith('/storage/v1/object/sign/')||reads.has(url.pathname.split('/').at(-1))))return route.continue();
      // Next development tooling is not an application write.
      if(url.origin===origin && url.pathname.startsWith('/__nextjs'))return route.continue();
      blocked.push(url.pathname);return route.abort();
    });
    const page=await context.newPage();page.setDefaultTimeout(60000);
    const errors=[],apiErrors=[],authResponses=[];
    let authenticated=false;
    page.on('pageerror',e=>errors.push(e.message));
    page.on('response',r=>{if(r.url().includes('kkoitlvydytdhlpxhuah.supabase.co')&&r.status()>=400)(authenticated?apiErrors:authResponses).push(r.status()+':'+new URL(r.url()).pathname);});
    await page.goto(origin+'/login',{timeout:120000});
    await page.locator('#email').fill(`intra.test.${item.email}@mwell.com.ph`);
    await page.locator('#password').fill(process.env.AUDIT_PASSWORD);
    await page.getByRole('button',{name:/^sign in$/i}).click();
    await page.waitForURL(u=>u.pathname!=='/login',{timeout:120000});
    authenticated=true;
    for(const width of [1440,390]) {
      if(process.env.PREVIEW_WIDTH && Number(process.env.PREVIEW_WIDTH) !== width) continue;
      await page.setViewportSize({width,height:width===390?844:1000});
      await page.goto(origin+item.route,{timeout:120000,waitUntil:'domcontentloaded'});
      await page.locator('main h1:visible').first().waitFor();
      if(item.id==='pick-pack')await page.locator('ul[aria-label="Fulfillment demand"] > li').first().waitFor();
      if(item.id==='my-work')await page.locator('a[aria-label^="Open tracked request:"]').first().waitFor();
      if(item.id==='purchase-order')await page.getByRole('navigation',{name:'Purchase order sections'}).waitFor();
      await page.waitForTimeout(900);
      await page.evaluate(()=>{document.documentElement.classList.remove('dark');window.scrollTo(0,0);});
      const metrics=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth-innerWidth,firstOrder:document.querySelector('ul[aria-label="Fulfillment demand"] > li')?.getBoundingClientRect().top,heading:document.querySelector('main h1')?.textContent}));
      assert(metrics.overflow<=1,'Page overflow');
      await page.screenshot({path:path.join(output,`${item.id}-${width}.png`),animations:'disabled'});
      if(stage==='after') {
        assert.equal(await page.locator('.hierarchy-preview').count(),1);
        if(process.env.PREVIEW_QOL === 'true') {
          try { await checkConvenience({page,context,item,width,origin,output}); }
          catch(error) { await page.screenshot({path:path.join(output,`${item.id}-${width}-failure.png`)});throw error; }
        }
        if(process.env.PREVIEW_SIDEBAR === 'true') {
          const hide = page.getByRole('button',{name:'Hide side navigation',exact:true});
          if(width === 1440) {
            const controls = await hide.getAttribute('aria-controls');
            const aside = page.locator('#'+controls);
            assert(await aside.isVisible());
            const header = page.locator('header').first();
            const beforeWidth = (await header.boundingBox()).width;
            const routeBefore = page.url();
            await hide.focus();await page.keyboard.press('Enter');
            const show = page.getByRole('button',{name:'Show side navigation',exact:true});
            assert.equal(await aside.isVisible(),false);
            assert.equal(await show.getAttribute('aria-expanded'),'false');
            assert.equal(page.url(),routeBefore);
            assert((await header.boundingBox()).width > beforeWidth);
            assert(await show.evaluate(el=>el===document.activeElement));
            await page.screenshot({path:path.join(output,`${item.id}-${width}-nav-hidden.png`)});
            await page.reload();await show.waitFor();
            assert.equal(await aside.isVisible(),false);
            if(item.id === 'pick-pack') {
              await page.goto(origin+'/');
              await show.waitFor();
              assert.equal(await show.getAttribute('aria-controls'),'suite-side-navigation');
              await page.goto(origin+item.route);
              await show.waitFor();
              assert.equal(await show.getAttribute('aria-controls'),'warehouse-side-navigation');
              await page.locator('ul[aria-label="Fulfillment demand"] > li').first().waitFor();
            }
            await page.setViewportSize({width:390,height:844});
            assert.equal(await show.isVisible(),false);
            assert(await page.getByRole('navigation',{name:'Primary mobile',exact:true}).isVisible());
            await page.setViewportSize({width:1440,height:1000});
            await show.focus();await page.keyboard.press('Space');
            assert(await aside.isVisible());
            assert.equal(await hide.getAttribute('aria-expanded'),'true');
          } else {
            assert.equal(await hide.isVisible(),false);
            assert(await page.getByRole('navigation',{name:'Primary mobile',exact:true}).isVisible());
          }
        }
        if(item.id==='pick-pack') {
          const toolsMenu=page.getByText('Queue tools',{exact:true});
          await toolsMenu.click();
          const guidance=page.locator('details.hp-guidance');
          assert.equal(await guidance.getAttribute('open'),null);
          await guidance.locator('summary').click();await guidance.getByRole('list',{name:'Department handoff'}).waitFor();
          await guidance.locator('summary').click();
          await toolsMenu.click();
          await page.getByLabel('Search orders',{exact:true}).fill('NO-MATCH-VISUAL-PREVIEW');
          await page.locator('ul[aria-label="Fulfillment demand"]').waitFor({state:'hidden'});
          assert.equal(await page.locator('ul[aria-label="Fulfillment demand"] > li').count(),0);
          await page.getByLabel('Search orders',{exact:true}).fill('');
          await page.locator('ul[aria-label="Fulfillment demand"] > li').first().waitFor();
        }
        if(item.id==='my-work') {
          await page.getByRole('button',{name:'Needs your action',exact:true}).click();
          await page.getByRole('button',{name:'Recently completed',exact:true}).click();
          await page.goBack();assert.equal(new URL(page.url()).searchParams.get('view'),null);
        }
        if(item.id==='purchase-order') {
          await page.getByRole('navigation',{name:'Purchase order sections'}).getByRole('link',{name:'Line items',exact:true}).click();
          assert.equal(new URL(page.url()).hash,'#lines');
        }
      }
      if(stage==='after') {
        await page.goto(origin+item.route,{timeout:120000,waitUntil:'domcontentloaded'});
        await page.locator('main h1:visible').first().waitFor();
        if(item.id==='pick-pack')await page.locator('ul[aria-label="Fulfillment demand"] > li').first().waitFor();
        if(item.id==='my-work')await page.locator('a[aria-label^="Open tracked request:"]').first().waitFor();
        if(item.id==='purchase-order')await page.getByRole('navigation',{name:'Purchase order sections'}).waitFor();
      }
      await page.evaluate(()=>{document.documentElement.classList.add('dark');window.scrollTo(0,0);});
      await page.screenshot({path:path.join(output,`${item.id}-${width}-dark.png`),animations:'disabled'});
      assert.deepEqual(errors,[]);assert.deepEqual(apiErrors,[]);assert.deepEqual(blocked,[]);
      results.push({id:item.id,width,...metrics,authResponses,passed:true});
      await writeFile(path.join(output,'results.json'),JSON.stringify({stage,origin,health,results},null,2));
    }
    await context.close();
  }
}finally{await browser.close();}
console.log(JSON.stringify({stage,results}));
