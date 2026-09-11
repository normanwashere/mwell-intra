import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve('outputs/sep12-performance');
const read = async name => JSON.parse(await readFile(path.join(root, name), 'utf8'));
const before = await read('seeded-before/results.json');
const after = await read('optimized/results.json');
const apiBefore = await read('seeded-before/api.json');
const apiAfter = await read('optimized/api.json');
const sqlBefore = (await read('sql-before.json'))[0].results;
const sqlAfter = (await read('sql-after.json'))[0].results;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const median = values => {
  const sorted = values.filter(Number.isFinite).sort((a,b) => a-b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length/2);
  return sorted.length%2 ? sorted[middle] : (sorted[middle-1]+sorted[middle])/2;
};
const ms = value => value == null ? 'unavailable' : `${Math.round(value).toLocaleString()} ms`;
const change = (a,b) => a > 0 && b != null ? `${((a-b)/a*100).toFixed(1)}% ${b <= a ? 'faster' : 'slower'}`.replace('-', '') : 'unavailable';
const roles = [...new Set(before.results.map(row => row.role))];
assert.equal(roles.length, 11);
assert.equal(before.results.length, 132);
assert.equal(after.results.length, 132);
const sqlMatch = sqlBefore.every(row => sqlAfter.find(item => item.role === row.role)?.hash === row.hash);
const apiMatch = apiBefore.results.every(row => apiAfter.results.filter(item => item.role === row.role).every(item => item.hash === row.hash));
assert(sqlMatch && apiMatch, 'Authority output changed between benchmarks');
const failures = [...before.results,...after.results].filter(row => !row.passed);
const apiErrors = [...apiBefore.results,...apiAfter.results].filter(row => row.error);
const rows = roles.map(role => {
  const pick = (run,width) => run.results.filter(row => row.role === role && row.width === width);
  const b = median(pick(before,1440).map(row=>row.readyMs));
  const a = median(pick(after,1440).map(row=>row.readyMs));
  const bm = median(pick(before,390).map(row=>row.readyMs));
  const am = median(pick(after,390).map(row=>row.readyMs));
  return {role,desktopBefore:b,desktopAfter:a,mobileBefore:bm,mobileAfter:am,
    routes:pick(after,390).length,passed:after.results.filter(row=>row.role===role).every(row=>row.passed)};
});
const routeRows = before.results.filter(row=>row.width===390).map(({role,route})=>{
  const pick = run=>run.results.filter(row=>row.role===role && row.route===route && row.width===1440);
  const b = median(pick(before).map(row=>row.readyMs));
  const a = median(pick(after).map(row=>row.readyMs));
  return {role,route,b,a,requestsBefore:median(pick(before).map(row=>row.requests.length)),requestsAfter:median(pick(after).map(row=>row.requests.length)),
    bytesBefore:median(pick(before).map(row=>row.requests.reduce((sum,req)=>sum+(req.bytes??0),0))),
    bytesAfter:median(pick(after).map(row=>row.requests.reduce((sum,req)=>sum+(req.bytes??0),0)))};
}).sort((a,b)=>b.a-a.a);
const concurrency = [1,3,5].map(value=>({value,
  before:median(apiBefore.results.filter(row=>row.concurrency===value).map(row=>row.ms)),
  after:median(apiAfter.results.filter(row=>row.concurrency===value).map(row=>row.ms))}));
const summary = {roles:rows, routes:routeRows, concurrency, authorityOutputsIdentical:sqlMatch&&apiMatch,
  sqlBefore:median(sqlBefore.flatMap(row=>row.snapshot_ms)), sqlAfter:median(sqlAfter.flatMap(row=>row.snapshot_ms)),
  failures,apiErrors,beforeCommit:before.health.commit,afterCommit:after.health.commit};
await writeFile(path.join(root,'summary.json'),JSON.stringify(summary,null,2));
const table = (headers,body) => `<div class="table"><table><thead><tr>${headers.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${body.map(row=>`<tr>${row.map(cell=>`<td>${esc(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>mWell Intra | UAT performance results</title>
<style>*{box-sizing:border-box}body{margin:0;background:#f2f5f7;color:#192b37;font:15px/1.6 system-ui,sans-serif}header{background:#fff;border-bottom:3px solid #087fa1;padding:28px max(24px,calc((100% - 1280px)/2))}h1{font-size:30px;margin:0}h2{font-size:22px;margin:0 0 12px}p{max-width:1000px}main{max-width:1328px;margin:auto;padding:24px}section{padding:28px 0;border-bottom:1px solid #cad6de}nav{display:flex;flex-wrap:wrap;gap:24px;margin-top:18px}a{color:#006780}th{text-align:left;background:#e5eef3;position:sticky;top:0}td,th{padding:10px 13px;border-bottom:1px solid #d2dce3;vertical-align:top}table{border-collapse:collapse;width:100%;background:white}.table{overflow:auto}code{overflow-wrap:anywhere}summary{cursor:pointer;font-weight:650;padding:12px 0}.note{border-left:4px solid #bb790f;padding:10px 16px;background:#fff5de}.ok{border-left:4px solid #148769;padding:10px 16px;background:#e7f6f0}.shots{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}.shots img{width:100%;max-height:540px;object-fit:contain;object-position:top;background:#fff;border:1px solid #d2dce3}figure{margin:0}figcaption{font-size:13px;padding:8px 0}.small{font-size:13px;color:#4b626f}@media(max-width:720px){.shots{grid-template-columns:1fr}h1{font-size:26px}main{padding:16px}}</style>
<header><div class="small">September 12, 2026 / Live UAT / Performance verification</div><h1>mWell Intra performance results</h1><p>All 11 operating personas, with the same synthetic volume before and after. Business steps, approval rules, training requirements and evidence remain unchanged.</p><nav><a href="#results">Role results</a><a href="#database">Database</a><a href="#routes">Screen detail</a><a href="#evidence">Screenshots</a><a href="#scope">Method and limits</a></nav></header><main>
<section><h2>What changed</h2><p>Database training checks reuse PostgreSQL query plans, not permission results. Each call still evaluates the current actor, role, scope, certification, expiry and emergency-exception rules. Quality Control waits for warehouse startup data before requesting its complete control queues, avoiding an early discarded fetch.</p><p class="${failures.length||apiErrors.length?'note':'ok'}">${failures.length} failed browser samples across 264 before/after navigations; ${apiErrors.length} failed API requests across 198 before/after requests. All 11 permission-result fingerprints match. This is a performance check, not a replacement for full transaction certification.</p><p>650 added fixtures remain available: 300 zero-stock products, 200 unallocated synthetic ecommerce orders, 100 draft procurement requests and 50 draft department requests. Look for <strong>PERF-SEP12</strong>. They are not real stock, pricing or deliveries. Existing tester scenarios were retained.</p></section>
<section id="results"><h2>Results by role</h2><p>Desktop: median of three samples per screen. Mobile: one sample per screen, aggregated by role. These small-sample results are not p95 promises.</p>${table(['User type','Screens','Desktop before','Desktop after','Change','Mobile before','Mobile after','Run status'],rows.map(row=>[row.role.replaceAll('_',' '),row.routes,ms(row.desktopBefore),ms(row.desktopAfter),change(row.desktopBefore,row.desktopAfter),ms(row.mobileBefore),ms(row.mobileAfter),row.passed?'Passed':'Investigate']))}</section>
<section id="database"><h2>Database and bounded concurrency</h2><p>Direct database execution median: <strong>${ms(summary.sqlBefore)} before; ${ms(summary.sqlAfter)} after</strong> (${change(summary.sqlBefore,summary.sqlAfter)}). Five calls per role per run. Exact output hashes match for every role.</p>${table(['Concurrent requests','API median before','API median after','Change'],concurrency.map(row=>[row.value,ms(row.before),ms(row.after),change(row.before,row.after)]))}<p>API stages each contain 33 real authenticated read-only calls. Concurrency is limited to five; no write load, destructive stress or capacity-ceiling test was performed.</p></section>
<section id="routes"><h2>Screen-level diagnostics</h2><p>Sorted by remaining desktop loading time. Backend payload includes compressed response-body bytes where reported by Chromium. Rendering, network and database time are all included in the readiness measurement.</p>${table(['User / screen','Before','After','Change','Requests before / after','Backend KB before / after'],routeRows.map(row=>[row.role.replaceAll('_',' ')+' '+row.route,ms(row.b),ms(row.a),change(row.b,row.a),row.requestsBefore+' / '+row.requestsAfter,Math.round(row.bytesBefore/1024)+' / '+Math.round(row.bytesAfter/1024)]))}<p class="note">Remaining priority: Quality startup still includes evidence-heavy warehouse data. Move legacy inline evidence to controlled object storage only through a separate, verified migration, and then replace broad startup datasets with route-specific summaries. Do not hide inspection evidence or truncate queues to make the timing look better.</p><p>Next performance gate: agree a realistic one-year data forecast and user-concurrency target, then run an isolated volume test. Add field measurements for slow networks and actual phones before setting service-level promises. Add indexes only against an observed query plan and measured improvement; index count alone is not an optimization.</p></section>
<section id="evidence"><h2>Live screenshots</h2><p>First sample of each screen at 1440px and 390px. Open any image for full resolution. Captured labels and workflow controls are the live application, not a mock-up.</p>${roles.map(role=>`<details><summary>${esc(role.replaceAll('_',' '))}</summary><div class="shots">${after.results.filter(row=>row.role===role&&row.screenshot).map(row=>`<figure><a href="optimized/${esc(row.screenshot)}"><img loading="lazy" src="optimized/${esc(row.screenshot)}" alt="${esc(role+' '+row.route+' '+row.width+'px')}"></a><figcaption>${esc(row.route)} / ${row.width}px / ${ms(row.readyMs)}</figcaption></figure>`).join('')}</div></details>`).join('')}</section>
<section id="scope"><h2>Method, evidence and limits</h2><p>Real Chromium, full-page navigation, browser cache enabled, no network or CPU throttling, service workers blocked. A screen is ready when its main heading is visible and tracked Supabase requests have settled for 400ms. This proxy is reproducible but does not prove every control has completed its own work.</p><p>The initial unseeded baseline also completed 132 navigations. The comparable runs above use the same 650 added fixtures. Browser/API runs are sequential to avoid test accounts replacing each other's sessions. Screenshots are desktop and mobile viewport emulations, not physical-device tests. Synthetic long-task readings are not real-user INP. Database authorization comparisons and focused regression tests are separate from real business transaction completion.</p><p>The build reports 223 service-worker precache entries (about 17 MB). First-install/offline-cache traffic is excluded from this comparison and remains a separate slow-network test. Do not remove offline assets without verifying the offline workflow.</p><p>Database advisor review: 82 unindexed-foreign-key notices, 177 unused-index notices and 27 multiple-permissive-policy warnings remain. The measured authority joins already have relevant indexes. These notices are a review backlog, not proof that adding 82 indexes or deleting 177 indexes improves the app. Evaluate each against real plans, retention and write costs. Preserve the union of allowed roles when reviewing permissive policies. <a href="database-advisors.json">Full advisor evidence</a>; <a href="https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys">foreign-key index guidance</a>; <a href="https://supabase.com/docs/guides/database/database-linter?lint=0006_multiple_permissive_policies">policy guidance</a>.</p><p>Before commit: <code>${esc(before.health.commit)}</code><br>After commit: <code>${esc(after.health.commit)}</code><br>Target: <code>${esc(JSON.stringify(after.health.deployment))}</code></p><p><a href="seeded-before/results.json">Before browser evidence</a> | <a href="optimized/results.json">After browser evidence</a> | <a href="seeded-before/api.json">Before API evidence</a> | <a href="optimized/api.json">After API evidence</a> | <a href="summary.json">Summary data</a></p></section></main></html>`;
await writeFile(path.join(root,'index.html'),html);
console.log(JSON.stringify(summary,null,2));
