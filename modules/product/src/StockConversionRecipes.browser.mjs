// Full Product module, real session provider/Guard and CSS; synthetic RPC data only.
/* global window, document, innerWidth */
import console from "node:console";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const require = createRequire(path.join(root, "apps/shell/package.json"));
const { build } = require("esbuild");
const { chromium, expect } = require("@playwright/test");
const postcss = require("postcss"), tailwind = require("tailwindcss");
const output = path.join(root, "modules/product/output/playwright/stock-conversion", new Date().toISOString().replace(/[:.]/g, "-"));
await mkdir(output, { recursive: true });
const entry = `
  import React from 'react';
  import {createRoot} from 'react-dom/client';
  import {SessionProvider,Guard} from '@intra/auth';
  import {ProductApp} from './src/ProductApp';
  const persona=new URLSearchParams(location.search).get('persona') || 'product';
  const caps=persona==='warehouse' ? {warehouse:['manage_products','manage_returns']} :
    {product:persona==='reader' ? ['view_readiness'] : ['view_readiness','decide_go_live','view_pricing','approve_pricing']};
  const user={id:'fixture-'+persona,email:persona+'@example.invalid',app_metadata:{roles:persona==='warehouse' ? {warehouse:['warehouse_supervisor']} : {product:['product_owner']}},user_metadata:{name:'Product fixture'},aud:'authenticated',created_at:'2026-09-20T00:00:00Z'};
  const session={user,access_token:'synthetic',refresh_token:'synthetic',expires_in:3600,token_type:'bearer'};
  const options={kits:[{id:'kit-1',name:'Health fair watch and packaging',version:3,product_id:'variant',product_name:'Event watch',base_product_id:'base',base_product_name:'Base watch',recovery_ready:true,packaging:[{product_id:'bag',name:'Event presentation bag',quantity:2}]}],events:[{id:'event-1',name:'Community health fair',status:'planned'},{id:'closed-event',name:'Completed community fair',status:'closed'}],recipes:[]};
  const readiness=[{id:'ready-1',product_id:'variant',title:'Community health watch',version:3,status:'submitted',kit_required:false,evidence:[{id:'e1',label:'Operations evidence',reference:'https://evidence.example.invalid/readiness',verified:true}],prepared_by:'contributor',created_at:'2026-09-20T00:00:00Z',updated_at:'2026-09-20T00:00:00Z'}];
  window.fixtureCalls=[];
  const saved=new Map();
  const client={auth:{getSession:async()=>({data:{session},error:null}),getUser:async()=>({data:{user},error:null}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},
    schema(schema){return {
      from(table){
        window.fixtureCalls.push({schema,table});
        if(schema==='warehouse' && table!=='kit_definitions') throw Error('Warehouse custody access forbidden');
        const rows=table==='readiness_packages' ? readiness : table==='kit_definitions' ? [{id:'kit-1',product_id:'variant',version:3,status:'active',product_approval_reference:'Product 123'}] : [];
        const query={select(){return query},order(){return query},in(){return query},limit:async()=>({data:rows,error:null})};return query;
      },
      async rpc(name,args){
        window.fixtureCalls.push({schema,name,args});
        if(schema==='core' && name==='my_capability_snapshot') return {data:{roleCapabilities:caps,userCapabilities:caps},error:null};
        if(schema==='warehouse' && name==='stock_conversion_recipe_workspace') return {data:structuredClone(options),error:null};
        if(schema==='warehouse' && name==='execute_stock_conversion' && args.payload.action==='approve_recipe') {
          if(!caps.product?.includes('decide_go_live')) throw Error('Product authority missing');
          const p=args.payload;
          if(!saved.has(p.idempotency_key)) {
            const recipe={...p,id:'recipe-'+(saved.size+1),kit_version:3,kit_name:options.kits[0].name,event_name:options.events.find(e=>e.id===p.event_id).name,
              source_product_name:p.direction==='conversion'?'Base watch':'Event watch',output_product_name:p.direction==='conversion'?'Event watch':'Base watch',approved_by:user.id,approved_at:'2026-09-20T03:00:00Z'};
            saved.set(p.idempotency_key,recipe);options.recipes.unshift(recipe);
          }
          return {data:saved.get(p.idempotency_key),error:null};
        }
        throw Error('Unexpected fixture RPC: '+schema+'.'+name);
      }
    }}
  };
  createRoot(document.getElementById('root')).render(<SessionProvider config={{mode:'supabase',client}}><main className="mx-auto max-w-6xl p-4 sm:p-6"><Guard module="product" cap="view_readiness"><ProductApp/></Guard></main></SessionProvider>);
`;
const bundle = await build({ stdin: { contents: entry, resolveDir: path.join(root, "modules/product"), loader: "tsx" }, bundle: true,
  write: false, platform: "browser", format: "iife", jsx: "automatic", loader: { ".css": "empty" },
  define: { "process.env.NODE_ENV": '"development"', "process.env": "{}" },
  alias: { react: path.dirname(require.resolve("react/package.json")), "react-dom": path.dirname(require.resolve("react-dom/package.json")) },
});
let styles = "";
for (const file of ["packages/ui/src/styles.css", "apps/shell/app/globals.css", "apps/shell/app/hierarchy-preview.css"]) styles += await readFile(path.join(root, file), "utf8") + "\n";
const css = await postcss([tailwind({ presets: [require("@intra/config/tailwind/preset")], content: [
  { raw: entry, extension: "tsx" }, path.join(root, "modules/product/src/**/*.{ts,tsx}"), path.join(root, "packages/ui/src/**/*.{ts,tsx}"), path.join(root, "packages/auth/src/**/*.{ts,tsx}"),
] })]).process(styles, { from: undefined });
const report = { kind: "offline-full-Product-module-real-session-Guard-mock-RPC", fontMode: "system-fallback", liveWrites: 0, captures: [], errors: [], blockedRequests: [], complete: false };
const browser = await chromium.launch();
try {
  for (const [persona, width, height] of [["product",1440,1000],["product",390,844],["product",320,720],["reader",390,844],["warehouse",390,844]]) {
    const context = await browser.newContext({ viewport: { width, height }, serviceWorkers: "block", reducedMotion: "reduce" });
    try {
      await context.route("**/*", route => {
        if (route.request().url().startsWith("https://product-fixture.test/")) return route.fulfill({ contentType: "text/html", body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div>' });
        report.blockedRequests.push(route.request().url()); return route.abort();
      });
      const page = await context.newPage();
      page.on("pageerror", error => report.errors.push(error.message));
      await page.goto(`https://product-fixture.test/?persona=${persona}`);
      await page.addStyleTag({ content: css.css + "\n:root{--font-inter:Arial;--font-poppins:Arial;--font-grotesk:Arial;--font-jbmono:monospace}" });
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      const capture = async name => {
        const metrics = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth-innerWidth,
          fields: [...document.querySelectorAll('#stock-conversion-recipes input,#stock-conversion-recipes select,#stock-conversion-recipes button')].map(el=>{
            const b=el.getBoundingClientRect(); return {label:el.getAttribute('aria-label')||el.id||el.textContent,x:b.x,right:b.right,width:b.width,height:b.height};
          }) }));
        assert(metrics.overflow<=1, `${width}/${name}: page overflow`);
        for(const field of metrics.fields) assert(field.x>=0 && field.right<=width+1 && field.height>=40, `${width}/${name}: bad control bounds ${JSON.stringify(field)}`);
        const file=`${persona}-${width}-${name}.png`;
        await page.screenshot({path:path.join(output,file),fullPage:true,animations:"disabled"});
        report.captures.push({persona,width,height,name,file,...metrics});
      };
      if(persona==='warehouse') {
        await expect(page.getByRole('heading',{name:'Access denied for this page'})).toBeVisible();
        assert.equal((await page.evaluate(()=>window.fixtureCalls)).filter(c=>c.name==='stock_conversion_recipe_workspace').length,0);
        await capture('Product-gate-denied'); continue;
      }
      await expect(page.getByRole('heading',{name:'Product readiness',exact:true})).toBeVisible();
      if(persona==='reader') {
        await expect(page.getByRole('link',{name:'Stock conversion recipes',exact:true})).toHaveCount(0);
        assert.equal((await page.evaluate(()=>window.fixtureCalls)).filter(c=>c.name==='stock_conversion_recipe_workspace').length,0);
        await capture('approval-authority-denied'); continue;
      }
      await page.getByRole('link',{name:'Stock conversion recipes',exact:true}).click();
      const section=page.getByRole('region',{name:'Stock conversion recipes',exact:true});
      await expect(section).toBeVisible();
      await page.getByLabel('Approved kit definition',{exact:true}).selectOption('kit-1');
      await page.getByLabel('Event',{exact:true}).selectOption('event-1');
      await page.getByLabel('Product approval reference',{exact:true}).fill('Product-approved fair recipe 123');
      await page.getByLabel('Product approval evidence URL',{exact:true}).fill('https://evidence.example.invalid/product-approval');
      await expect(page.getByRole('button',{name:'Approve recipe',exact:true})).toBeEnabled();
      await capture('forward-ready');
      await page.getByRole('button',{name:'Approve recipe',exact:true}).click();
      await expect(section.getByRole('status')).toHaveText(/Recipe approved/);
      await section.locator('details').first().locator('summary').click();
      await capture('forward-approved-history');
      await page.getByLabel('Recipe direction',{exact:true}).selectOption('recovery');
      await page.getByLabel('Event',{exact:true}).selectOption('closed-event');
      await page.getByLabel('Product approval reference',{exact:true}).fill('Product recovery decision 456');
      await page.getByLabel('Product approval evidence URL',{exact:true}).fill('https://evidence.example.invalid/recovery');
      await expect(page.getByRole('button',{name:'Approve recipe',exact:true})).toBeDisabled();
      await page.getByLabel('Event presentation bag disposition',{exact:true}).selectOption('discard');
      await expect(page.getByRole('button',{name:'Approve recipe',exact:true})).toBeEnabled();
      await capture('recovery-explicit-packaging');
      await page.getByRole('button',{name:'Approve recipe',exact:true}).click();
      await expect(section.locator('details')).toHaveCount(2);
      const calls=await page.evaluate(()=>window.fixtureCalls);
      assert.deepEqual(calls.filter(c=>c.name==='execute_stock_conversion').map(c=>c.args.payload.action),['approve_recipe','approve_recipe']);
      assert.equal(calls.filter(c=>c.name==='stock_conversion_workspace').length,0);
    } finally { await context.close(); }
  }
  assert.deepEqual(report.errors,[]); assert.deepEqual(report.blockedRequests,[]); report.complete=true;
} finally {
  await browser.close();
  await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({output,complete:report.complete,captures:report.captures.length,errors:report.errors,blockedRequests:report.blockedRequests}));
}
