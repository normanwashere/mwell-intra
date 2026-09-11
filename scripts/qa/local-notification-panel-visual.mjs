import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const require = createRequire(new URL('../../apps/shell/package.json', import.meta.url));
const { chromium, expect } = require('@playwright/test');
const { build } = require('esbuild');
const base = process.env.CONTEXT_BASE_URL ?? 'http://localhost:3021';
assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'Local rendered fixture only.');
const output = path.resolve('outputs/notification-context-local');
await mkdir(output, { recursive: true });
const result = await build({
  stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {NotificationBell} from './components/NotificationBell';
    createRoot(document.getElementById('notification-fixture')).render(<NotificationBell />);`, loader: 'tsx', resolveDir: path.resolve('apps/shell') },
  bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [{ name: 'local-notification-fixture', setup(build) {
    build.onResolve({ filter: /^@intra\/auth$/ }, () => ({ path: 'auth', namespace: 'fixture' }));
    build.onResolve({ filter: /^@shell\/lib\/supabase\/env$/ }, () => ({ path: 'env', namespace: 'fixture' }));
    build.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ loader: 'js', contents: args.path === 'env' ? 'export const ENABLE_NOTIFICATIONS = true;' : `
      const rows = [
        {id:'N-11',kind:'approval_pending',entity_type:'purchase_request',entity_id:'PR-2026-0011',read_at:null,created_at:'2026-09-11T00:00:00Z'},
        {id:'N-12',kind:'accreditation_renewal_due',entity_type:'vendor',entity_id:'VENDOR-2026-0012',read_at:null,created_at:'2026-09-10T00:00:00Z'},
        {id:'N-13',kind:'approval_overdue',entity_type:'purchase_order',entity_id:'PO-2026-0013',read_at:'2026-09-11T01:00:00Z',created_at:'2026-09-11T01:00:00Z'}
      ];
      const client = {from:()=>({select:()=>({order:()=>({limit:async()=>({data:[...rows],error:null})})})}),
        rpc:async(_,args)=>{window.fixtureWrites=(window.fixtureWrites||0)+1; const row=rows.find(row=>row.id===args.payload.notification_id); row.read_at=new Date().toISOString(); return {error:null};}};
      export const useSession=()=>({profile:{id:'local-fixture'},mode:'supabase',supabaseClient:client});` }));
  } }],
});
const browser = await chromium.launch();
const results = [];
try {
  for (const [name, width, height, theme] of [['desktop-light',1440,900,'light'], ['desktop-dark',1280,800,'dark'], ['mobile-light',390,844,'light'], ['mobile-small',320,720,'light']]) {
    const context = await browser.newContext({ viewport:{width,height}, reducedMotion:'reduce', serviceWorkers:'block' });
    const page = await context.newPage();
    await page.route('**/*', route => new URL(route.request().url()).hostname.endsWith('.supabase.co') ? route.abort() : route.continue());
    await page.goto(`${base}/login`);
    const sheets = await page.locator('link[rel="stylesheet"]').evaluateAll(elements => elements.map(element => element.href));
    const fontClasses = await page.locator('html').getAttribute('class');
    assert(sheets.length > 0, 'Use actual app CSS for the component capture.');
    await page.setContent(`<!doctype html><html class="${fontClasses?.replace(/\bdark\b/g,'') ?? ''} ${theme}"><head>${sheets.map(href=>`<link rel="stylesheet" href="${href}">`).join('')}</head><body class="bg-app text-ink"><header class="flex items-center justify-between border-b border-line bg-surface p-5"><h1 class="text-lg font-semibold">Notifications</h1><div id="notification-fixture"></div></header></body></html>`);
    await page.addScriptTag({content:result.outputFiles[0].text});
    const trigger = page.getByRole('button', {name:/Notifications, 2 unread/});
    await trigger.click();
    const dialog = page.getByRole('dialog', {name:'Notifications',exact:true});
    await expect(dialog).toContainText('PR-2026-0011');
    await expect.poll(()=>dialog.evaluate(element=>{const r=element.getBoundingClientRect();return r.left>=-1 && r.right<=innerWidth+1;})).toBe(true);
    await expect.poll(()=>dialog.evaluate(element=>element.scrollWidth-element.clientWidth)).toBeLessThanOrEqual(2);
    await page.evaluate(() => document.fonts.ready);
    assert((await page.locator('body').evaluate(element=>getComputedStyle(element).fontFamily)).toLowerCase().includes('poppins'), 'Brand font must load in the rendered fixture.');
    await page.screenshot({path:path.join(output,`${name}.png`),animations:'disabled'});
    assert.equal(await page.evaluate(()=>window.fixtureWrites||0),0);
    await dialog.getByRole('button',{name:'Unread',exact:true}).click();
    await expect(dialog.locator('li')).toHaveCount(2);
    await dialog.getByRole('button',{name:'Mark read',exact:true}).first().click();
    await expect(dialog.locator('li')).toHaveCount(1);
    assert.equal(await page.evaluate(()=>window.fixtureWrites),1);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button',{name:/Notifications, 1 unread/})).toBeFocused();
    results.push({name,passed:true,backend:'simulated, no Supabase requests',actualComponent:true});
    await context.close();
  }
} finally { await browser.close(); }
await writeFile(path.join(output,'results.json'),JSON.stringify(results,null,2));
console.log(JSON.stringify(results));
