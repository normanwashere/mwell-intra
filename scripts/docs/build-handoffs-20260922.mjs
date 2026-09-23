import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { documentationOnly } from './export-handoff-source.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const own = path.join(root, 'docs/handoffs/2026-09-22');
const out = path.join(root, 'outputs/handoffs-20260922');
const source = process.env.HANDOFF_SOURCE_ROOT || (existsSync(path.join(root, 'apps/shell/package.json')) ? root : path.resolve(root, '../mwell-intra-onboarding'));
const runtime = process.env.HANDOFF_RUNTIME_MODULES || path.join(root, 'tools/handoff/node_modules');
const sourceRequire = createRequire(path.join(source, 'package.json'));
const shellRequire = createRequire(path.join(source, 'apps/shell/package.json'));
const runtimeRequire = createRequire(path.join(runtime, '_handoff-loader.cjs'));
const { marked, Renderer } = sourceRequire('marked');
const { JSDOM } = shellRequire('jsdom');
const { parse: parseCsv } = sourceRequire('csv-parse/sync');
const { chromium } = runtimeRequire('playwright');
const JSZip = runtimeRequire('jszip');
const commit = JSON.parse(readFileSync(path.join(own, 'release-status.json'), 'utf8')).sourceCommit;
assert.match(commit, /^[a-f0-9]{40}$/, 'Source review requires a full, immutable commit ID');
const zipName = 'mwell-intra-handoffs-20260922.zip';
const read = p => readFileSync(p, 'utf8');
const sha = v => createHash('sha256').update(v).digest('hex');
const escape = v => String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const slug = v => v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const git = (...args) => execFileSync('git', ['-C', source, ...args], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, windowsHide: true });
const snapshotFile = path.join(source, 'source-manifest.json');
const snapshot = existsSync(snapshotFile) ? JSON.parse(read(snapshotFile)) : null;
if (snapshot) assert.equal(snapshot.commit, commit, 'Copied source does not match the reviewed release');
const referenceCommit = snapshot ? snapshot.sourceCommit : git('rev-parse', 'HEAD').trim();
assert.match(referenceCommit, /^[a-f0-9]{40}$/, 'References require the exact transfer revision');
if (!snapshot && referenceCommit !== commit) {
  git('merge-base', '--is-ancestor', commit, referenceCommit);
  const changed = git('diff', '--name-only', commit, referenceCommit).trim().split('\n').filter(Boolean);
  assert.ok(changed.every(documentationOnly), 'Reference revision includes unverified non-documentation changes');
}
const repoUrl = `https://github.com/normanwashere/mwell-intra/blob/${referenceCommit}/`;
const pinned = p => {
  if (!snapshot) return git('show', `${referenceCommit}:${p}`);
  assert.ok(!path.isAbsolute(p) && !p.split(/[\\/]/).includes('..'));
  const bytes = readFileSync(path.join(source, p));
  assert.equal(sha(bytes), snapshot.files[p], `Copied source was changed: ${p}`);
  return bytes.toString('utf8');
};
const inputs = new Map();
function input(relative) {
  const text = read(path.join(root, relative));
  inputs.set(relative, sha(text));
  return text;
}
const statusText = input('docs/handoffs/2026-09-22/release-status.json');
const status = JSON.parse(statusText);
assert.equal(status.schemaVersion, 1);
assert.equal(status.sourceCommit, commit);
assert.match(status.asOf, /^\d{4}-\d{2}-\d{2}$/);
assert.equal(new Set(status.items.map(x => x.id)).size, status.items.length);
for (const id of ['full-ci', 'seller-contract', 'seller-chain', 'vendor-chain', 'reporting-api', 'data-stack', 'production', 'smtp']) {
  assert.ok(status.items.some(x => x.id === id), `Missing status ${id}`);
}
for (const item of status.items) {
  for (const key of ['id', 'label', 'state', 'detail', 'owner', 'evidence']) assert.ok(item[key], `${item.id}: missing ${key}`);
  assert.ok(!item.tone || ['success', 'warning', 'muted'].includes(item.tone), `Invalid status tone: ${item.id}`);
  if (item.evidenceUrl) assert.equal(new URL(item.evidenceUrl).protocol, 'https:');
}
const drafts = Object.fromEntries(['data', 'technical', 'testers'].map(k => [k, input(`docs/handoffs/2026-09-22/${k}.md`)]));
drafts.technical += '\n' + input('docs/handoffs/2026-09-22/PORTABILITY.md');
input('scripts/docs/build-handoffs-20260922.mjs');
input('scripts/docs/export-handoff-source.mjs');
input('tools/handoff/package.json');
input('tools/handoff/package-lock.json');
const maintenance = input('docs/handoffs/2026-09-22/README.md');

// Reference reads use an immutable revision; newer source may change docs only.
const referenceDefinitions = [
  ['Root tooling', 'package.json', '"packageManager": "pnpm@10.23.0"', 'Declared Node/pnpm and root verification commands; not evidence those commands passed.'],
  ['Shell dependencies', 'apps/shell/package.json', '"next": "^16.3.3"', 'Next.js 16, React 19, shell dev/build and browser test commands.'],
  ['Deployment configuration', 'apps/shell/vercel.json', 'app/knowledge/page.tsx', 'Only the Knowledge server page is pinned to hnd1. Actual UAT deployment evidence is recorded separately in Release Status.'],
  ['UAT matrix', '.github/workflows/uat-live-certification.yml', 'viewport: mobile-320', 'Six route widths, two transaction widths and independent cleanup are defined, not certified by their existence.'],
  ['Maintained vendor transaction journey', 'scripts/qa/full-intra-live-e2e.mjs', "name: 'legal submitted application handoff'", 'Existing harness includes vendor-owned application submission and separate Legal handoff. Wait for real transaction artifacts; a harness definition is not a pass.'],
  ['UAT roster', 'scripts/qa/live-e2e-scenarios.mjs', 'intra.test.operations.associate@mwell.com.ph', 'Eleven baseline personas; no passwords or fresh login claim.'],
  ['Synthetic seller', 'scripts/qa/sep20-seller-user-provision.mjs', 'intra.seller.uat.sep20@mwell.com.ph', 'Additional seller identity is synthetic; dates, learning and stock readiness require session validation.'],
  ['Seller date regression', 'scripts/verify-event-ledger-effective-read.pglite.test.mjs', "statement_timestamp() at time zone 'Asia/Manila'", 'Fixture uses the event business date; timezone and midnight-boundary assertions remain separate from live seller proof.'],
  ['Vendor upload authority', 'supabase/migrations/20260920164950_vendor_document_upload_authorization.sql', 'core.current_vendor_id()', 'Owned vendor case and matching requirement are checked. Source changes do not prove browser upload or Legal handoff.'],
  ['Accepted Quality hold', 'supabase/migrations/20260905180530_authorize_accepted_provisional_quality_hold_release.sql', "inspection.disposition = 'accepted'", 'Provisional hold release recognizes accepted inspection; direct hold bypass remains prohibited.'],
  ['Environment guard', 'scripts/lib/target-environment.mjs', 'Mutation runs are forbidden when APP_ENV=production.', 'Mutating QA requires an explicit nonproduction target; handoff generation does not invoke these commands.'],
  ['Health evidence', 'apps/shell/app/api/health/route.ts', 'NEXT_PUBLIC_ENABLE_SW', 'Health exposes runtime/environment metadata. See Release Status for the independently captured live observation.'],
  ['Technical and functional specification', 'docs/TECHNICAL_AND_FUNCTIONAL_SPECIFICATION.md', 'Post-event corrections retain existing restrictions', 'Workflow and authority constraints; dated release claims retain their original evidence boundary.'],
  ['Cutover and recovery', 'docs/MIGRATION_CUTOVER_HYPERCARE_RUNBOOK.md', 'backup restore reference', 'Reconciliation, restore reference, ownership and business go/no-go are required. Proposed support hours are not staffed commitments.'],
  ['Policy cutover', 'docs/runbooks/POLICY-ALIGNMENT-CUTOVER.md', 'Do not rewrite signed snapshots', 'Independent authority and signed-evidence preservation must survive release and recovery.'],
  ['Retention ownership', 'docs/RETENTION.md', 'Legal + DPO sign-off', 'Recipient retention and backup decisions need accountable approval; this pack is not a legal compliance opinion.'],
  ['UAT and issues', 'docs/UAT_AND_ISSUE_MANAGEMENT.md', 'P0/P1 defects cannot be waived', 'Business sign-off is distinct from automated results; production blockers are not waived by handing over documents.'],
  ['Interactive Warehouse export', 'apps/shell/app/api/warehouse/exports/route.ts', 'reportingViews', 'Existing interactive exports are not the proposed unattended Reporting API.'],
  ['Interactive Insights export', 'apps/shell/app/api/insights/export/route.ts', 'reporting_period_start', 'Existing insight export is not a full detailed integration feed.'],
  ['Reporting dataset registry', 'apps/shell/lib/reporting/catalog.ts', "availability: 'unavailable'", 'All 30 proposed IDs remain unavailable; a draft mapping is not an export permission.'],
  ['Draft dictionary parser', 'apps/shell/lib/reporting/dictionary.ts', 'export function parseReportingDictionary', 'Source-metadata validation only; no business-record serializer or approved reporting projection.'],
  ['Draft dictionary checks', 'apps/shell/lib/reporting/dictionary.test.ts', 'parseReportingDictionary', 'Maintained tests verify the draft contract; their presence alone does not show they passed.'],
];
const sourceReview = referenceDefinitions.map(([title, file, needle, finding]) => {
  const text = pinned(file);
  assert.ok(text.includes(needle), `Source contract missing: ${file}: ${needle}`);
  const line = text.slice(0, text.indexOf(needle)).split('\n').length;
  return { title, file, line, sha256: sha(text), finding, url: `${repoUrl}${file}#L${line}` };
});
const tree = snapshot ? Object.keys(snapshot.files).join('\n') : git('ls-tree', '-r', '--name-only', commit, 'apps/shell/app/api');
assert.ok(!tree.includes('apps/shell/app/api/reporting/'), 'Reporting endpoint appeared; review unavailable-service status before rebuilding.');

const designInputs = {
  'reporting-design.md': 'docs/superpowers/specs/2026-09-20-reporting-api-design.md',
  'reporting-implementation-plan.md': 'docs/superpowers/plans/2026-09-20-reporting-api-implementation.md',
  'reporting-quickstart.md': 'docs/integrations/reporting-api/DATA-TEAM-QUICKSTART.md',
  'reporting-security-review.md': 'docs/integrations/reporting-api/SECURITY-REVIEW.md',
  'reporting-foundation-progress.md': 'docs/integrations/reporting-api/FOUNDATION-PROGRESS.md',
  'reporting-source-map.md': 'docs/integrations/reporting-api/source-map.md',
  'reporting-authority-foundation.md': 'docs/integrations/reporting-api/AUTHORITY-FOUNDATION.md',
  'reporting-dependency-remediation.md': 'docs/integrations/reporting-api/DEPENDENCY-REMEDIATION.md',
  'reporting-release-readiness.md': 'docs/integrations/reporting-api/RELEASE-READINESS.md',
};
const machineInputs = {
  'dictionary.json': 'docs/integrations/reporting-api/dictionary.json',
  'source-schema.json': 'docs/integrations/reporting-api/source-schema.json',
  'hash-vectors.json': 'docs/integrations/reporting-api/hash-vectors.json',
};
const designDocs = {};
for (const [name, file] of Object.entries(designInputs)) {
  let text = input(file);
  marked.walkTokens(marked.lexer(text), token => {
    if (token.type !== 'link' || /^(?:https?:|#)/.test(token.href)) return;
    const resolved = path.resolve(root, path.dirname(file), token.href);
    const bundled = Object.entries({ ...designInputs, ...machineInputs }).find(([, inputPath]) => path.resolve(root, inputPath) === resolved);
    const reviewedSource = sourceReview.find(item => path.resolve(root, item.file) === resolved);
    assert.ok(bundled || reviewedSource, `Unreviewed design reference: ${file}: ${token.href}`);
    text = text.replaceAll(`](${token.href})`, `](${bundled ? bundled[0] : reviewedSource.url})`);
  });
  designDocs[name] = `> Reporting engineering reference. No working endpoint, connector or credentials are supplied. Design requirements are not implementation evidence; see the dated progress and Release Status for completed checks and remaining gates.\n\n${text}`;
}
for (const [name, file] of Object.entries(machineInputs)) {
  const text = input(file);
  JSON.parse(text);
  designDocs[name] = text;
}
const catalogue = marked.lexer(designDocs['reporting-design.md']).find(t => t.type === 'table' && t.rows.some(r => r[0].text.includes('warehouse.products')));
assert.ok(catalogue, 'Dataset catalogue not found');
assert.equal(catalogue.rows.length, 30);
const datasetIds = catalogue.rows.map(r => r[0].text.replaceAll('`', ''));
assert.equal(new Set(datasetIds).size, 30);
assert.equal(datasetIds.filter(x => x.startsWith('warehouse.')).length, 19);
assert.equal(datasetIds.filter(x => x.startsWith('procurement.')).length, 10);
assert.equal(datasetIds.filter(x => x === 'reference.links').length, 1);

const testerTokens = marked.lexer(drafts.testers);
const cases = [];
for (const token of testerTokens) {
  if (token.type === 'table' && token.header[0].text === 'Case') {
    for (const row of token.rows) {
      const match = row[0].text.match(/^([A-Z]+-\d{2}) (.+)$/);
      assert.ok(match, `Invalid case: ${row[0].text}`);
      cases.push({ id: match[1], title: match[2], steps: row[1].text, expected: row[2].text });
    }
  }
  if (token.type === 'paragraph') {
    const match = token.text.match(/^\*\*([A-Z]+-\d{2}): (.+?)\.\*\* ([\s\S]+?) Expected: ([\s\S]+)$/);
    if (match) cases.push({ id: match[1], title: match[2], steps: match[3], expected: match[4] });
  }
}
assert.equal(cases.length, 27);
assert.equal(new Set(cases.map(x => x.id)).size, 27);
const csvCell = v => {
  let text = String(v ?? '');
  if (/^[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
};
const csv = rows => '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
const testHeaders = ['Case ID', 'Title', 'Status', 'Actor / role', 'Variant / viewport', 'Preconditions / fixture IDs', 'Steps', 'Expected saved result and handoff', 'Actual result', 'Evidence reference', 'UAT build / deployment', 'Tested by', 'Tested at / timezone', 'Next owner', 'Issue ID', 'Retest result', 'Cleanup disposition'];
const testsCsv = csv([testHeaders, ...cases.map(c => [c.id, c.title, 'Not run', '', '', '', c.steps, c.expected, '', '', '', '', '', '', '', '', ''])]);
const issueHeaders = ['Issue ID', 'Case ID', 'Severity', 'Status', 'UAT URL / build', 'Role (no password)', 'Time / timezone', 'Device / browser / viewport', 'Record IDs / starting state', 'Steps', 'Expected', 'Actual / exact message', 'Evidence reference', 'Saved or changed stock / unknown', 'Impact / workaround', 'Owner', 'Target date', 'Retest and next actor', 'Cleanup disposition'];
const issuesCsv = csv([issueHeaders, issueHeaders.map(() => '')]);
const payload = (type, text) => `data:${type};base64,${Buffer.from(text).toString('base64')}`;
const download = (name, text, label = name) => `<a class="download" download="${escape(name)}" href="${payload(name.endsWith('.csv') ? 'text/csv;charset=utf-8' : 'text/plain;charset=utf-8', text)}">${escape(label)}</a>`;

let diagramNumber = 0;
const diagrams = [];
const renderer = new Renderer();
renderer.html = ({ text }) => escape(text);
renderer.link = function (token) {
  if (token.href.startsWith('mailto:')) return escape(token.text);
  return Renderer.prototype.link.call(this, token);
};
renderer.code = function ({ text, lang }) {
  if (lang !== 'mermaid') return `<pre><code>${escape(text)}</code></pre>`;
  const id = `handoff-flow-${++diagramNumber}`;
  diagrams.push({ id, text });
  return `<figure class="handoff-diagram" data-flow="${id}"><div class="flow-image">%%${id}%%</div><figcaption>Process flow with explicit handoffs and decision branches.</figcaption><details class="diagram-source"><summary>Flowchart text</summary><pre>${escape(text)}</pre></details></figure>`;
};
renderer.table = function (token) {
  return `<div class="table-scroll" tabindex="0" role="region" aria-label="Scrollable reference table">${Renderer.prototype.table.call(this, token)}</div>`;
};
function markdown(text) { return marked.parse(text, { renderer, gfm: true }); }
function sections(text) {
  const tokens = marked.lexer(text);
  const result = [];
  let current;
  for (const token of tokens) {
    if (token.type === 'heading' && token.depth === 1) continue;
    if (token.type === 'heading' && token.depth === 2) {
      current = { title: token.text, id: slug(token.text), raw: '' };
      result.push(current);
    } else {
      assert.ok(current || token.type === 'space', 'Content requires an opening section');
      if (current) current.raw += token.raw;
    }
  }
  return result.map(s => ({ ...s, html: markdown(s.raw) }));
}
const sourceHtml = `<p>Tested application source <code>${commit}</code>; reference revision <code>${referenceCommit}</code>. A later reference revision may update documentation only. These references support the stated contracts, not deployment, full runtime correctness or acceptance. Repository links need network access and authorization; essential operating content is already in this pack.</p><div class="table-scroll" tabindex="0" role="region" aria-label="Source review"><table><thead><tr><th>Reference</th><th>Review conclusion</th></tr></thead><tbody>${sourceReview.map(r => `<tr><td><a href="${r.url}">${escape(r.title)}</a><br><code>${escape(r.file)}:${r.line}</code></td><td>${escape(r.finding)}</td></tr>`).join('')}</tbody></table></div>`;
function statusHtml() {
  return `<p><strong>As of ${escape(status.asOf)} ${escape(status.timezone)}.</strong> Updated by ${escape(status.updatedBy)}. ${escape(status.evidenceBoundary)}</p><p>Live commit: <code>${escape(status.liveCommit || 'Not reverified')}</code>. Live deployment: <code>${escape(status.liveDeploymentId || 'Not recorded')}</code>. Health confirmed by release owner: ${escape(status.liveVerifiedAt || 'Not recorded')}. UAT project: <code>${escape(status.uatProjectRef || 'Not recorded')}</code>.</p><div class="table-scroll" tabindex="0" role="region" aria-label="Release status"><table><thead><tr><th>Item and status</th><th>Remaining work</th><th>Owner and evidence</th></tr></thead><tbody>${status.items.map(s => `<tr data-status-id="${escape(s.id)}"><td><strong>${escape(s.label)}</strong><br><span class="state ${escape(s.tone || 'warning')}">${escape(s.state)}</span></td><td>${escape(s.detail)}</td><td>${escape(s.owner)}<br><small>${escape(s.evidence)}</small>${s.evidenceUrl ? `<br><a href="${escape(s.evidenceUrl)}">Evidence</a>` : ''}</td></tr>`).join('')}</tbody></table></div><p>${download('release-status.json', statusText, 'Download dated status snapshot')}</p>`;
}
const style = `
:root{color-scheme:light;--ink:#20272d;--muted:#52616a;--line:#d2dadd;--paper:#fff;--ground:#f3f6f6;--accent:#08766b;--link:#145a9b;--risk:#a22e35}
body{overflow-wrap:anywhere}
*{box-sizing:border-box;letter-spacing:0}html{scroll-behavior:auto;scroll-padding-top:20px}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.6 'Segoe UI',Arial,sans-serif}a{color:var(--link);text-underline-offset:3px;overflow-wrap:anywhere}a:hover{color:var(--accent)}:focus-visible{outline:3px solid #08766b;outline-offset:3px}button,input{font:inherit}button{cursor:pointer;border:1px solid #87969d;border-radius:4px;background:white;color:var(--ink);padding:6px 10px;min-height:40px}button:hover{background:#e9f1ef}input[type=search]{min-width:0;width:100%;padding:9px 11px;border:1px solid #87969d;border-radius:4px;background:white}p,ul,ol{margin:0 0 16px}li{margin:4px 0}small{font-size:13px;color:var(--muted)}code{font:0.89em/1.5 Consolas,monospace;overflow-wrap:anywhere}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:var(--ground);padding:14px;border:1px solid var(--line);font:13px/1.65 Consolas,monospace}h1,h2,h3{line-height:1.25;font-family:Cambria,Georgia,serif;overflow-wrap:anywhere}h1{font-size:32px;margin:9px 0 10px}h2{font-size:23px;margin:0}h3{font-size:20px;margin:24px 0 12px}.skip{position:absolute;top:-80px;left:12px;z-index:4;background:white;padding:10px}.skip:focus{top:6px}.layout{display:grid;grid-template-columns:272px minmax(0,1fr);min-height:100vh}.sidebar{position:sticky;top:0;height:100vh;overflow-y:auto;padding:28px 20px;background:var(--ground);border-right:1px solid var(--line)}.brand{display:block;font-weight:700;font-size:20px;color:var(--ink);text-decoration:none;margin-bottom:3px}.sidebar p{font-size:13px;color:var(--muted)}.pack-nav{display:flex;flex-wrap:wrap;gap:8px 14px;padding:16px 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line);margin-bottom:20px}.pack-nav a{font-size:14px}.pack-nav [aria-current=page]{color:var(--ink);font-weight:700;text-decoration-thickness:3px}.search-label{display:block;font-weight:600;font-size:14px;margin-bottom:5px}.result-count{display:block;min-height:26px;padding-top:4px}.tools{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 16px}.tools button{font-size:13px}.toc{display:grid;gap:3px}.toc a{display:block;padding:5px 0;font-size:14px;text-decoration:none;border-bottom:1px solid transparent}.toc a:hover{border-color:var(--line)}main{min-width:0;max-width:1192px;padding:30px 42px 64px}header{padding-bottom:24px;border-bottom:2px solid var(--ink);margin-bottom:14px}.eyebrow{font-size:13px;font-weight:600;color:var(--muted)}.subtitle{max-width:850px;color:var(--muted)}.baseline{font-size:15px;margin-bottom:0}.baseline strong{color:var(--risk)}.doc-section{border-bottom:1px solid var(--line);scroll-margin-top:20px}.doc-section>summary{cursor:pointer;display:flex;align-items:baseline;gap:12px;padding:20px 0;list-style:none}.doc-section>summary::-webkit-details-marker{display:none}.doc-section>summary::before{content:'+';font:22px Consolas,monospace;color:var(--accent);flex:0 0 18px}.doc-section[open]>summary::before{content:'-'} .section-body{padding:0 0 24px 30px;min-width:0}.state{color:var(--risk);font-size:14px;font-weight:600}.table-scroll{overflow:auto;max-width:100%;margin:16px 0 20px}table{width:100%;border-collapse:collapse;font-size:14px;line-height:1.5;table-layout:fixed}th,td{padding:11px 13px;border:1px solid var(--line);text-align:left;vertical-align:top;overflow-wrap:anywhere}th{background:#e8efee;font-weight:650}tr:nth-child(even) td{background:#f7f9f9}table th:first-child{width:27%}td small{display:block;margin-top:6px}.handoff-diagram{margin:18px 0;padding:16px;border:1px solid var(--line);border-radius:4px;background:white}.flow-image{text-align:center;overflow:auto}.flow-image svg{display:block;width:100%;height:auto;max-height:820px;margin:auto}figcaption{font-size:13px;color:var(--muted);margin:12px 0 8px}.diagram-source{font-size:13px}.diagram-source summary{cursor:pointer}.download{display:inline-block;margin:4px 16px 4px 0}.empty{padding:30px 0;color:var(--muted)}[hidden]{display:none!important}.footer{margin-top:28px;padding-top:16px;border-top:1px solid var(--line);font-size:13px;color:var(--muted)}.pack-list{list-style:none;padding:0}.pack-list li{padding:18px 0;border-bottom:1px solid var(--line)}.pack-list a{font-weight:600;font-size:20px}.pack-list p{margin:8px 0 0}.counts{display:flex;flex-wrap:wrap;gap:12px 24px;font-size:14px;color:var(--muted)}.counts strong{color:var(--ink)}
.state.success{color:#12654b}.state.warning{color:#795114}.state.muted{color:#52616a}.baseline strong{color:var(--ink)}
@media(max-width:1000px){.layout{grid-template-columns:230px minmax(0,1fr)}main{padding:24px}.sidebar{padding:22px 16px}.section-body{padding-left:0}}
@media(max-width:700px){.layout{display:block}.sidebar{position:static;height:auto;max-height:none;border-right:0;border-bottom:1px solid var(--line);padding:16px 20px}.toc{display:none}.brand{font-size:18px}.sidebar p{margin-bottom:10px}.pack-nav{padding:10px 0;margin-bottom:10px}.tools{margin-bottom:0}.result-count{float:right}main{padding:24px 20px 40px}h1{font-size:28px}h2{font-size:22px}.doc-section>summary{padding:18px 0}.section-body{padding-left:0}table{min-width:620px}.handoff-diagram{padding:8px}.flow-image svg{max-height:none}.counts{gap:8px 18px}}
@media print{@page{size:A4;margin:15mm 13mm 17mm}html,body{background:white;color:black;font-size:10pt;line-height:1.45}.layout{display:block}.sidebar,.skip,.tools,.result-count,.empty,.download,.diagram-source{display:none!important}main{padding:0;max-width:none}header{padding-bottom:10px;margin-bottom:10px}h1{font-size:22pt}h2{font-size:16pt}h3{font-size:12pt}.doc-section>summary{padding:13px 0 9px;break-after:avoid}.doc-section>summary::before{display:none}.section-body{padding:0 0 12px}.doc-section{border:0;display:block!important}.doc-section>.section-body{display:block!important}p,li{orphans:3;widows:3}.table-scroll{overflow:visible;margin:10px 0}table{min-width:0;font-size:9pt;table-layout:fixed}th,td{padding:6px 8px}thead{display:table-header-group}tr{break-inside:avoid}.handoff-diagram{break-inside:avoid;padding:8px;margin:12px 0}.flow-image{overflow:visible}.flow-image svg{max-height:215mm;max-width:100%}figcaption{font-size:9pt}pre{font-size:9pt;padding:8px}a{color:#20272d;text-decoration:none}.baseline,.subtitle{font-size:10pt}.state{font-size:9pt}.footer{font-size:8pt}.pack-list a{font-size:13pt}.counts{font-size:9pt}}
@media print{.footer{display:none}}
`;
const clientScript = `
(() => {
 const sections=[...document.querySelectorAll('.doc-section')], search=document.querySelector('#search'), count=document.querySelector('#result-count'), empty=document.querySelector('#empty');
 const beforeSearch=new Map(); let searching=false, printState=null;
 const texts=new Map(sections.map(s=>[s,s.textContent.toLocaleLowerCase().replace(/\\s+/g,' ')]));
 function applySearch(){const terms=search.value.trim().toLocaleLowerCase().split(/\\s+/).filter(Boolean);if(terms.length&&!searching){sections.forEach(s=>beforeSearch.set(s,s.open));searching=true;}let visible=0;sections.forEach(s=>{const matches=terms.every(t=>texts.get(s).includes(t));s.hidden=!matches;const nav=document.querySelector('.toc a[href="#'+s.id+'"]');if(nav)nav.hidden=!matches;if(matches)visible++;if(terms.length&&matches)s.open=true;else if(!terms.length&&searching)s.open=beforeSearch.get(s)??false;});if(!terms.length)searching=false;count.textContent=terms.length?visible+' of '+sections.length+' sections':sections.length+' sections';empty.hidden=visible!==0;}
 search.addEventListener('input',applySearch);search.addEventListener('keydown',e=>{if(e.key==='Escape'){search.value='';applySearch();}});
 document.querySelector('#expand').addEventListener('click',()=>sections.filter(s=>!s.hidden).forEach(s=>s.open=true));
 document.querySelector('#collapse').addEventListener('click',()=>sections.forEach(s=>s.open=false));
 function revealHash(hash=location.hash){const id=decodeURIComponent(hash.slice(1));const target=document.getElementById(id);if(!target)return;if(target.hidden){search.value='';applySearch();}let p=target;while(p){if(p.tagName==='DETAILS')p.open=true;p=p.parentElement;}target.scrollIntoView();}
 document.querySelectorAll('a[href^="#"]').forEach(a=>a.addEventListener('click',()=>revealHash(a.hash)));window.addEventListener('hashchange',()=>revealHash());
 window.addEventListener('beforeprint',()=>{if(printState)return;printState=sections.map(s=>({s,open:s.open,hidden:s.hidden}));sections.forEach(s=>{s.hidden=false;s.open=true;});});
 window.addEventListener('afterprint',()=>{if(!printState)return;printState.forEach(({s,open,hidden})=>{s.open=open;s.hidden=hidden;});printState=null;});
 document.querySelector('#print').addEventListener('click',()=>window.print());applySearch();if(location.hash)revealHash();
})();`;
const titles = { index: 'mWell Intra Handoffs', data: 'Data Team Handoff', technical: 'Technical Team Handoff', testers: 'Tester Handoff' };
const subtitles = { index: 'Data, engineering and controlled UAT coordination', data: 'Reporting API plan and the decisions needed to build it', technical: 'Setup, deployment, support and release checks', testers: 'Role-based sessions, saved-result checks and cross-team handoffs' };
function page(key, parts) {
  const all = [...parts];
  all.splice(1, 0, { title: 'Release Status', id: 'release-status', html: statusHtml() });
  assert.equal(new Set(all.map(s => s.id)).size, all.length);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><title>${titles[key]} | September 22 2026</title><style>${style}</style></head><body><a class="skip" href="#main">Skip to content</a><div class="layout"><aside class="sidebar"><a class="brand" href="index.html">mWell Intra</a><p>Handoff edition / 22 September 2026</p><nav class="pack-nav" aria-label="Handoff packs">${Object.entries({ index: 'Hub', data: 'Data', technical: 'Technical', testers: 'Testers' }).map(([k, label]) => `<a href="${k}.html"${k === key ? ' aria-current="page"' : ''}>${label}</a>`).join('')}</nav><label class="search-label" for="search">Search this pack</label><input type="search" id="search" placeholder="Search sections" autocomplete="off"><output class="result-count" id="result-count" aria-live="polite"></output><div class="tools" aria-label="Document actions"><button id="expand" title="Expand all visible sections">Expand all</button><button id="collapse" title="Collapse all sections">Collapse all</button><button id="print" title="Print the complete document">Print</button></div><nav class="toc" aria-label="Contents">${all.map(s => `<a href="#${s.id}">${escape(s.title)}</a>`).join('')}</nav></aside><main id="main"><header><div class="eyebrow">UAT HANDOFF / ${escape(status.asOf)} / ${escape(status.timezone)}</div><h1>${titles[key]}</h1><p class="subtitle">${subtitles[key]}</p><p class="baseline"><strong>Release status.</strong> ${escape(status.summary)}</p></header><p id="empty" class="empty" hidden>No matching sections.</p>${all.map((s, i) => `<details class="doc-section" id="${s.id}"${i === 0 ? ' open' : ''}><summary><h2>${escape(s.title)}</h2></summary><div class="section-body">${s.html}</div></details>`).join('')}<footer class="footer">Reviewed source <code>${commit}</code>. Dated documentation snapshot, not live monitoring. No secrets or account passwords. SMTP excluded. The old standalone Warehouse repository must not be deployed.</footer></main></div><script>${clientScript}</script></body></html>`;
}
const pages = {};
for (const key of ['data', 'technical', 'testers']) {
  const parts = sections(drafts[key]);
  if (key === 'data') {
    parts.push({ title: 'Dataset Catalogue', id: 'dataset-catalogue', html: `<p><strong>30 proposed datasets: 19 Warehouse, 10 Procurement, one relationship dataset.</strong> These are design mappings, not implemented API resources. Verify effective schema, stable keys and disclosure before delivery.</p>${markdown(catalogue.raw)}` });
    parts.push({ title: 'Design and Engineering Downloads', id: 'design-downloads', html: `<p>Offline design, tested-foundation evidence, draft field dictionary, observed source schema and portable hash vectors. The draft mappings do not authorize disclosure. No working API, connector, OpenAPI artifact, credentials or integration acceptance is included.</p>${Object.entries(designDocs).map(([name, text]) => download(name, text)).join(' ')}` });
  }
  if (key === 'testers') parts.push({ title: 'Execution Downloads', id: 'execution-downloads', html: `<p><strong>${cases.length} case groups, all Not run.</strong> Allocate fixtures and identities before Ready. Add execution rows for each actor, viewport, negative path and retest. Protect the completed results as internal evidence; keep passwords, real personal data and signed URLs out.</p>${download('test-results.csv', testsCsv, 'Download test checklist CSV')}${download('issue-template.csv', issuesCsv, 'Download issue template CSV')}` });
  parts.push({ title: 'Source Review', id: 'source-review', html: sourceHtml });
  pages[`${key}.html`] = page(key, parts);
}
pages['index.html'] = page('index', [
  { title: 'Choose Your Handoff', id: 'choose-your-handoff', html: `<ul class="pack-list"><li><a href="data.html">Data team</a><p>Review the proposed contract and confirm the recipient stack. No reporting connection is available.</p></li><li><a href="technical.html">Technical team</a><p>Review source, setup, operations and unresolved release work. Transfer acceptance is still required.</p></li><li><a href="testers.html">Testers</a><p>Coordinate controlled UAT with scoped accounts, current fixtures and saved-result evidence.</p></li></ul><p class="counts"><span><strong>3</strong> audience packs</span><span><strong>${datasetIds.length}</strong> proposed datasets</span><span><strong>${cases.length}</strong> unexecuted case groups</span></p>` },
  { title: 'Decisions and Ownership', id: 'decisions-and-ownership', html: `<p>Data must confirm its actual backend and database. Receiving engineers must confirm access, reproducibility, support and restore responsibilities. The UAT coordinator must allocate each tester's identity, fixture and next actor.</p><p><strong>Business and production acceptance remain separate.</strong> Require current full CI, the seller stock-to-Finance chain, vendor upload/submission/Legal proof, visual review and a real participant pilot. SMTP is excluded. An automated pass or delivered document does not close these decisions.</p>` },
  { title: 'Downloads', id: 'downloads', html: `${download('test-results.csv', testsCsv, 'Test checklist CSV')}${download('issue-template.csv', issuesCsv, 'Issue template CSV')}${download('release-status.json', statusText, 'Dated release status JSON')}<p><a href="README.md">Distribution and maintenance notes</a> / <a href="source-review.json">Source review ledger</a> / <a href="build-manifest.json">Build manifest</a></p>` },
  { title: 'Source and Distribution Boundary', id: 'source-and-distribution-boundary', html: `<p>Application source review is pinned to <code>${commit}</code>. Release Status records the separately checked UAT deployment and test results. Building these documents does not run or certify the app. SMTP remains excluded.</p><p>The three audience HTML files contain their own styles, interactions, diagrams and embedded downloads. The ZIP is limited to the declared recipient files. App source, environment files, passwords and QA captures are excluded. The source-code package is a separate commit-bound delivery.</p><p>Document screenshots and print checks are retained separately under <code>qa</code>. They are document evidence only, not application or business acceptance.</p>` },
]);

function securityScan(name, text) {
  const forbidden = [
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{8,}/,
    /\b(?:sb_secret_|sbp_|ghp_|github_pat_|sk_live_)[A-Za-z0-9_-]{16,}/,
    /postgres(?:ql)?:\/\/[^\s:/]+:[^\s@]+@/i,
    /https?:\/\/[^\s"<>]+\?(?:[^\s"<>]*&)?(?:token|access_token|signature|x-amz-signature)=/i,
    /(?:password|SUPABASE_SERVICE_ROLE_KEY)\s*[=:]\s*["'][^"'\s]{8,}["']/i,
  ];
  for (const pattern of forbidden) assert.ok(!pattern.test(text), `Possible secret in ${name}; manual review required`);
  assert.ok(!/live-update\.html/i.test(text), `Blocked old document reference in ${name}`);
}
function dom(text) { return new JSDOM(text).window.document; }
async function launch() {
  return chromium.launch({ headless: true, ...(process.env.HANDOFF_BROWSER_EXECUTABLE ? { executablePath: process.env.HANDOFF_BROWSER_EXECUTABLE } : {}) });
}
async function renderDiagrams() {
  const browser = await launch();
  try {
    const p = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
    await p.route('**/*', route => route.abort());
    await p.setContent('<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>');
    await p.addScriptTag({ content: read(path.join(source, 'node_modules/mermaid/dist/mermaid.min.js')) });
    await p.evaluate(() => window.mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', deterministicIds: true, htmlLabels: false, theme: 'base', fontFamily: 'Arial, sans-serif', themeVariables: { primaryColor: '#edf5f2', primaryTextColor: '#20272d', primaryBorderColor: '#517c73', lineColor: '#52616a', secondaryColor: '#edf1f7', tertiaryColor: '#fff4e3', fontSize: '16px' }, flowchart: { htmlLabels: false, useMaxWidth: true, padding: 10, rankSpacing: 24, nodeSpacing: 28 } }));
    for (const diagram of diagrams) {
      let svg = await p.evaluate(async ({ id, text }) => (await window.mermaid.render(id, text)).svg, diagram);
      const doc = dom(svg);
      const node = doc.querySelector('svg');
      assert.ok(node && node.querySelectorAll('.node').length >= 7, `Incomplete flowchart ${diagram.id}`);
      assert.ok(!node.querySelector('script,foreignObject,image'), `Unexpected active or external diagram content: ${node.querySelector('script,foreignObject,image')?.outerHTML.slice(0, 500)}`);
      node.setAttribute('role', 'img');
      node.setAttribute('aria-label', diagram.id === 'handoff-flow-1' ? 'Proposed reporting generation and reconciliation flow' : diagram.id === 'handoff-flow-2' ? 'Intra application and authorization architecture' : 'Event stock journey through independent actors and Finance');
      svg = node.outerHTML;
      for (const name of Object.keys(pages)) pages[name] = pages[name].replace(`%%${diagram.id}%%`, svg);
    }
  } finally { await browser.close(); }
}

const distributionReadme = `# mWell Intra Handoffs September 22 2026\n\nOpen index.html, or open data.html, technical.html or testers.html directly. Each audience HTML is self-contained, with local styles, interactions, rendered flowcharts and embedded downloads. No server or internet is needed to read it. Cross-pack navigation requires the four HTML files to remain together. Repository and UAT links require authorized network access and were not opened as part of document QA.\n\nThe checklist has ${cases.length} case groups, all Not run. The reporting catalogue has ${datasetIds.length} proposed datasets, not deployed resources. Reporting downloads include design requirements, tested-foundation evidence and a draft dictionary, not disclosure approval. There is no working reporting endpoint, connector or credential in this package. SMTP is out of scope. Never deploy the old standalone Warehouse repository.\n\nCurrent status is a dated snapshot embedded from release-status.json. Editing the distributed JSON alone does not update already-built HTML; the maintainer must edit the source JSON and rebuild. Do not label app journeys or business acceptance passed from documentation QA.\n\n## Maintainer instructions\n\n${maintenance.split('## Rebuild')[1] || ''}`;
const licenseFiles = [
  ['marked 15.0.12 (build-time Markdown parser)', path.join(source, 'node_modules/marked/LICENSE.md')],
  ['Mermaid 11.17.0 (build-time diagram renderer; only SVG output is distributed)', path.join(source, 'node_modules/mermaid/LICENSE')],
];
const notices = licenseFiles.map(([label, file]) => `${label}\n${read(file)}\n`).join('\n');
const ledger = { sourceCommit: commit, referenceCommit, sourceReviewOnly: true, noLiveChecks: true, reportingApiRouteAbsentInPinnedTree: true, references: sourceReview };
const commonFiles = {
  'test-results.csv': testsCsv,
  'issue-template.csv': issuesCsv,
  'release-status.json': statusText,
  'README.md': distributionReadme,
  'source-review.json': JSON.stringify(ledger, null, 2) + '\n',
  'third-party-notices.txt': notices,
  ...designDocs,
};

function checkLink(href, name, documents, fileNames, isDownload = false) {
  if (href.startsWith('data:')) { assert.ok(isDownload, `Unexpected data link in ${name}`); return; }
  if (/^https:\/\//.test(href)) { const url = new URL(href); assert.ok(!url.username && !url.password); return; }
  assert.ok(!/^(?:javascript|http|file):/i.test(href), `Unsafe link ${href} in ${name}`);
  const [filePart, fragment] = href.split('#');
  const target = filePart || name;
  assert.ok(fileNames.has(target), `Missing link ${href} in ${name}`);
  if (fragment && documents.has(target)) assert.ok(documents.get(target).getElementById(decodeURIComponent(fragment)), `Missing fragment ${href} in ${name}`);
}
async function verifyStatic() {
  const manifest = JSON.parse(read(path.join(out, 'build-manifest.json')));
  assert.equal(manifest.sourceCommit, commit);
  assert.equal(manifest.referenceCommit, referenceCommit);
  for (const [file, hash] of inputs) assert.equal(manifest.inputs[file], hash, `Stale build input ${file}`);
  const names = new Set([...manifest.files.map(x => x.name), 'build-manifest.json']);
  const documents = new Map();
  for (const file of manifest.files) {
    const bytes = readFileSync(path.join(out, file.name));
    assert.equal(sha(bytes), file.sha256, `Changed output ${file.name}`);
    securityScan(file.name, bytes.toString('utf8'));
    if (file.name.endsWith('.html')) documents.set(file.name, dom(bytes.toString('utf8')));
  }
  const checks = [];
  for (const [name, doc] of documents) {
    assert.equal(doc.querySelectorAll('h1').length, 1);
    const ids = [...doc.querySelectorAll('[id]')].map(n => n.id);
    assert.equal(new Set(ids).size, ids.length, `Duplicate IDs in ${name}`);
    assert.equal(doc.querySelectorAll('[data-status-id]').length, status.items.length);
    assert.equal(doc.querySelectorAll('.flow-image svg').length, name === 'index.html' ? 0 : 1);
    assert.equal(doc.querySelectorAll('script[src],link[rel=stylesheet],img[src^="http"],iframe,object,embed').length, 0);
    assert.ok(!doc.body.textContent.includes('%%handoff-flow-'));
    for (const a of doc.querySelectorAll('a[href]')) checkLink(a.getAttribute('href'), name, documents, names, a.hasAttribute('download'));
    for (const s of status.items) {
      const row = doc.querySelector(`[data-status-id="${s.id}"]`);
      assert.ok(row.textContent.includes(s.state) && row.textContent.includes(s.detail), `Status drift ${name}:${s.id}`);
    }
    for (const a of doc.querySelectorAll('a[download]')) {
      const filename = a.getAttribute('download');
      const embedded = Buffer.from(a.href.split(',')[1], 'base64');
      assert.deepEqual(embedded, readFileSync(path.join(out, filename)), `Embedded download differs: ${filename}`);
    }
    checks.push({ page: name, sections: doc.querySelectorAll('.doc-section').length, diagrams: doc.querySelectorAll('.flow-image svg').length, anchorsChecked: doc.querySelectorAll('a[href]').length });
  }
  for (const name of names) {
    if (!name.endsWith('.md')) continue;
    marked.walkTokens(marked.lexer(read(path.join(out, name))), token => {
      if (token.type === 'link' || token.type === 'image') checkLink(token.href, name, documents, names);
    });
  }
  const rows = parseCsv(read(path.join(out, 'test-results.csv')), { columns: true, bom: true });
  assert.equal(rows.length, cases.length);
  assert.ok(rows.every(r => r.Status === 'Not run' && !r['Actual result'] && !r['Evidence reference']));
  assert.deepEqual(rows.map(r => r['Case ID']), cases.map(c => c.id));
  const archive = await JSZip.loadAsync(readFileSync(path.join(out, zipName)));
  const archiveNames = Object.keys(archive.files).filter(n => !archive.files[n].dir).sort();
  assert.deepEqual(archiveNames, [...names].sort());
  for (const name of archiveNames) {
    assert.ok(!/\.env|\.xlsx?$|password|credentials|^qa\//i.test(name), `Forbidden bundle item ${name}`);
    assert.deepEqual(await archive.file(name).async('nodebuffer'), readFileSync(path.join(out, name)), `ZIP mismatch: ${name}`);
  }
  return { status: 'passed', contentAndLinkChecks: checks, proposedDatasets: datasetIds.length, unexecutedCaseGroups: rows.length, archiveFiles: archiveNames.length, secretPatternScan: 'passed; pattern scan is not a security certification', externalLinks: 'syntax and source paths checked; remote reachability/auth not tested', sourceFiles: sourceReview.length };
}

async function build() {
  mkdirSync(out, { recursive: true });
  await renderDiagrams();
  const files = { ...pages, ...commonFiles };
  for (const [name, text] of Object.entries(files)) { securityScan(name, text); writeFileSync(path.join(out, name), text, 'utf8'); }
  const manifest = { edition: '2026-09-22', builtAt: new Date().toISOString(), sourceCommit: commit, referenceCommit, sourceCheckoutHeadAtBuild: snapshot ? null : referenceCommit, sourceMode: snapshot ? 'verified-copy' : 'git-commit', statusAsOf: status.asOf, proposedDatasets: datasetIds, testerCaseIds: cases.map(c => c.id), inputs: Object.fromEntries(inputs), sourceReviewHashes: Object.fromEntries(sourceReview.map(r => [r.file, r.sha256])), files: Object.entries(files).map(([name, text]) => ({ name, bytes: Buffer.byteLength(text), sha256: sha(text) })), exclusions: ['Application source and runtime', 'Environment files and credentials', 'Unrelated MWS workbook', 'QA screenshots and print PDFs', 'Old blocked live-update document'], verification: 'Run --verify for browser and print checks; build itself is not business acceptance.' };
  files['build-manifest.json'] = JSON.stringify(manifest, null, 2) + '\n';
  writeFileSync(path.join(out, 'build-manifest.json'), files['build-manifest.json']);
  const zip = new JSZip();
  for (const [name, text] of Object.entries(files)) zip.file(name, text, { date: new Date('2026-09-22T00:00:00Z') });
  writeFileSync(path.join(out, zipName), await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } }));
  const result = await verifyStatic();
  console.log(JSON.stringify({ ...result, output: out, zip: zipName }, null, 2));
}

async function inspectPrint(qa) {
  const pdfjs = await import(pathToFileURL(runtimeRequire.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href);
  const { createCanvas, loadImage } = runtimeRequire('@napi-rs/canvas');
  const reports = [];
  for (const key of ['index', 'data', 'technical', 'testers']) {
    const pdfPath = path.join(qa, `${key}-print-a4.pdf`);
    const loadingTask = pdfjs.getDocument({ data: new Uint8Array(readFileSync(pdfPath)), useSystemFonts: true, isEvalSupported: false });
    const pdf = await loadingTask.promise;
    const pagesText = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const text = (await page.getTextContent()).items.map(t => t.str || '').join(' ');
      assert.ok(text.trim().length > 100, `${key} print page ${n} is blank or almost empty`);
      pagesText.push(text);
    }
    const compact = pagesText.join(' ').replace(/\s+/g, '');
    const doc = dom(read(path.join(out, `${key}.html`)));
    for (const heading of doc.querySelectorAll('.doc-section > summary h2')) assert.ok(compact.includes(heading.textContent.replace(/\s+/g, '')), `Missing printed section ${key}: ${heading.textContent}`);
    for (const needle of [status.liveCommit, status.liveVerifiedAt, status.uatProjectRef, ...(key === 'testers' ? cases.map(c => c.id) : []), ...(key === 'data' ? datasetIds : [])].filter(Boolean)) assert.ok(compact.includes(needle.replace(/\s+/g, '')), `Missing printed content ${key}: ${needle}`);
    const printDir = path.join(qa, `${key}-print-pages`);
    mkdirSync(printDir, { recursive: true });
    assert.ok(path.resolve(printDir).startsWith(path.resolve(out) + path.sep));
    for (const name of readdirSync(printDir)) {
      if (/^page-\d+\.png$/.test(name)) unlinkSync(path.join(printDir, name));
    }
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const viewport = page.getViewport({ scale: 96 / 72 });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      await page.render({ canvasContext: canvas.getContext('2d'), canvas, viewport }).promise;
      writeFileSync(path.join(printDir, `page-${n}.png`), canvas.toBuffer('image/png'));
      page.cleanup();
    }
    const pageImages = readdirSync(printDir).filter(n => /^page-\d+\.png$/.test(n)).sort((a,b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
    assert.equal(pageImages.length, pdf.numPages);
    const sheet = createCanvas(4 * 322, Math.ceil(pdf.numPages / 4) * 478);
    const ctx = sheet.getContext('2d');
    ctx.fillStyle = '#dce1e3'; ctx.fillRect(0, 0, sheet.width, sheet.height);
    ctx.font = '14px Arial'; ctx.fillStyle = '#20272d';
    for (let i = 0; i < pdf.numPages; i++) {
      const im = await loadImage(path.join(printDir, pageImages[i]));
      const x = (i % 4) * 322 + 8, y = Math.floor(i / 4) * 478 + 26;
      ctx.fillText(`${key} / page ${i + 1}`, x, y - 8);
      ctx.drawImage(im, x, y, 306, 433);
    }
    writeFileSync(path.join(qa, `${key}-print-contact-sheet.png`), sheet.toBuffer('image/png'));
    reports.push({ document: key, pages: pdf.numPages, allSectionHeadingsPresent: true, currentReleasePointerPresent: true, blankPages: 0, caseIdsChecked: key === 'testers' ? cases.length : 0, datasetIdsChecked: key === 'data' ? datasetIds.length : 0, renderedPages: pdf.numPages });
    await loadingTask.destroy();
  }
  return reports;
}

async function verifyBrowser() {
  const staticChecks = await verifyStatic();
  const qa = path.join(out, 'qa');
  mkdirSync(qa, { recursive: true });
  const browser = await launch();
  const results = [];
  try {
    for (const key of ['index', 'data', 'technical', 'testers']) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, offline: true, acceptDownloads: true });
      const p = await context.newPage();
      const errors = [], externalRequests = [];
      p.on('pageerror', error => errors.push(error.message));
      p.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      p.on('request', request => { if (/^https?:/.test(request.url())) externalRequests.push(request.url()); });
      const url = pathToFileURL(path.join(out, `${key}.html`)).href;
      await p.goto(url);
      assert.equal(await p.title(), `${titles[key]} | September 22 2026`);
      assert.ok((await p.locator('main').innerText()).length > 500);
      assert.equal(await p.locator('h1').textContent(), titles[key]);
      await p.screenshot({ path: path.join(qa, `${key}-desktop-1440.png`) });
      const count = await p.locator('.doc-section').count();
      await p.locator('#expand').click();
      assert.equal(await p.locator('.doc-section[open]').count(), count);
      await p.locator('#collapse').click();
      assert.equal(await p.locator('.doc-section[open]').count(), 0);
      await p.locator('.doc-section summary').first().focus();
      await p.keyboard.press('Enter');
      assert.equal(await p.locator('.doc-section[open]').count(), 1);
      await p.locator('#search').fill('SMTP');
      assert.ok(await p.locator('.doc-section:not([hidden])').count() > 0);
      assert.equal(await p.locator('.doc-section:not([hidden]):not([open])').count(), 0);
      await p.locator('#search').fill('no-such-handoff-phrase-927');
      assert.equal(await p.locator('.doc-section:not([hidden])').count(), 0);
      assert.ok(await p.locator('#empty').isVisible());
      await p.locator('#search').press('Escape');
      assert.equal(await p.locator('.doc-section:not([hidden])').count(), count);
      await p.locator('.toc a[href="#release-status"]').click();
      assert.ok(await p.locator('#release-status').getAttribute('open') !== null);
      assert.ok((await p.locator('#release-status').innerText()).includes(status.items.find(s => s.id === 'full-ci').label));
      const horizontalOverflow = () => p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
      assert.ok(!(await horizontalOverflow()), `${key} desktop overflow`);
      if (key !== 'index') {
        const flow = p.locator('.handoff-diagram');
        await flow.evaluate(n => { const parent = n.closest('.doc-section'); parent.open = true; });
        await flow.scrollIntoViewIfNeeded();
        const geometry = await flow.locator('svg').evaluate(svg => { const b = svg.getBoundingClientRect(); return { width: b.width, height: b.height, nodes: svg.querySelectorAll('.node').length, edges: svg.querySelectorAll('.flowchart-link').length }; });
        assert.ok(geometry.width > 200 && geometry.height > 200 && geometry.nodes >= 7 && geometry.edges >= 6);
        await flow.screenshot({ path: path.join(qa, `${key}-flowchart.png`) });
      }
      if (key === 'testers') {
        await p.locator('#execution-downloads summary').click();
        const [dl] = await Promise.all([p.waitForEvent('download'), p.getByRole('link', { name: 'Download test checklist CSV', exact: true }).click()]);
        assert.equal(dl.suggestedFilename(), 'test-results.csv');
        assert.equal(await dl.failure(), null);
        assert.deepEqual(readFileSync(await dl.path()), readFileSync(path.join(out, 'test-results.csv')));
      }
      await p.setViewportSize({ width: 390, height: 844 });
      await p.goto(url);
      assert.ok(!(await horizontalOverflow()), `${key} mobile overflow`);
      await p.screenshot({ path: path.join(qa, `${key}-mobile-390.png`) });
      await p.locator('#search').fill('SMTP');
      assert.ok(await p.locator('.doc-section:not([hidden])').count() > 0);
      for (const width of [320, 768, 1280]) {
        await p.setViewportSize({ width, height: 900 });
        assert.ok(!(await horizontalOverflow()), `${key} ${width}px overflow`);
      }
      // Printing must restore filtered/collapsed state and include every section.
      const stateBefore = await p.locator('.doc-section').evaluateAll(nodes => nodes.map(n => [n.open, n.hidden]));
      await p.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
      assert.equal(await p.locator('.doc-section[open]:not([hidden])').count(), count);
      await p.emulateMedia({ media: 'print' });
      const clipped = await p.locator('td,th,pre').evaluateAll(nodes => nodes.filter(n => n.scrollWidth > n.clientWidth + 2).map(n => n.textContent.slice(0,80)));
      assert.deepEqual(clipped, [], `${key} print overflow`);
      await p.pdf({ path: path.join(qa, `${key}-print-a4.pdf`), printBackground: true, preferCSSPageSize: true, displayHeaderFooter: true, headerTemplate: '<span></span>', footerTemplate: '<div style="font-size:8px;width:100%;padding:0 13mm;text-align:right;color:#52616a">Handoff documentation | <span class="pageNumber"></span> / <span class="totalPages"></span></div>' });
      await p.evaluate(() => window.dispatchEvent(new Event('afterprint')));
      assert.deepEqual(await p.locator('.doc-section').evaluateAll(nodes => nodes.map(n => [n.open, n.hidden])), stateBefore);
      await p.emulateMedia({ media: 'screen' });
      await p.setViewportSize({ width: 1440, height: 900 });
      const peer = key === 'index' ? 'data' : 'index';
      await p.locator(`.pack-nav a[href="${peer}.html"]`).click();
      assert.equal(await p.locator('h1').textContent(), titles[peer]);
      assert.deepEqual(errors, [], `${key} browser errors`);
      assert.deepEqual(externalRequests, [], `${key} external asset requests`);
      results.push({ page: key, status: 'passed', viewports: [1440, 1280, 768, 390, 320], checks: ['identity/nonblank', 'zero runtime/console errors', 'zero network asset requests while offline', 'section search and no-result recovery', 'expand/collapse and keyboard disclosure', 'deep link opens section', 'cross-pack navigation', 'no page-wide overflow', 'all sections print despite search/collapse', 'print state restored', ...(key === 'testers' ? ['CSV download matches disk'] : []), ...(key !== 'index' ? ['nonblank SVG nodes and edges'] : [])] });
      await context.close();
    }
  } finally { await browser.close(); }
  const printChecks = await inspectPrint(qa);
  const report = { verifiedAt: new Date().toISOString(), scope: 'This verification command checks handoff documents only, not app CI, UAT, SMTP or business acceptance.', browserPath: 'Locked local Playwright toolchain; recipient HTML files opened offline.', staticChecks, browserChecks: results, printChecks, visualInspection: 'Screenshots captured for separate human/model visual inspection; capture alone is not visual acceptance. See visual-review.md for the actual inspection record when present.', limitations: ['Only installed Chromium rendered; other browser/OS/printer combinations not certified.', 'This documentation check does not visit remote repository, UAT or external reference links.', 'Secret pattern scan is not an exhaustive security audit.', 'No physical-device or application workflow acceptance.'] };
  writeFileSync(path.join(qa, 'verification.json'), JSON.stringify(report, null, 2) + '\n');
  const list = directory => readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? list(path.join(directory, entry.name)) : [path.join(directory, entry.name)]);
  writeFileSync(path.join(out, 'FILES.json'), JSON.stringify({ sourceFiles: [...inputs.keys()].filter(p => p.startsWith('docs/handoffs/') || p.endsWith('build-handoffs-20260922.mjs')).map(p => path.join(root, p)), outputFiles: [...list(out).filter(p => !p.endsWith('FILES.json')), path.join(out, 'FILES.json')].sort(), note: 'Only the 15 manifest-listed recipient files are in the ZIP; other files are local QA evidence.' }, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}

assert.ok(process.argv.slice(2).every(x => x === '--verify'), 'Supported option: --verify');
if (process.argv.includes('--verify')) await verifyBrowser();
else await build();
