import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const checksum = bytes => createHash('sha256').update(bytes).digest('hex');
export const sourceArchive = (git, revision) => git('-c', 'core.autocrlf=false', '-c', 'core.eol=lf', 'archive', '--format=zip', revision);
export function includeFile(name) {
  const parts = name.split('/');
  if (path.isAbsolute(name) || /[\\:\x00]/.test(name) || parts.some(p => p === '..' || p === '')) return false;
  if (parts.some(p => /^(?:node_modules|\.git|\.vercel|\.next|\.turbo|\.temp|\.superpowers|\.codex.*|outputs|test-results|playwright-report|coverage)$/.test(p))) return false;
  if (parts.some(p => /^\.env(?:\.|$)/.test(p) && p !== '.env.example')) return false;
  if (/(?:^|\/)(?:storageState|storage-state|auth-state|credentials)\.(?:json|ya?ml|env)$/i.test(name)) return false;
  return true;
}
export function documentationOnly(name) {
  return name === 'README.md' || /^(?:docs\/|scripts\/docs\/|tools\/handoff\/)/.test(name);
}
export function secretKinds(bytes) {
  if (bytes.includes(0)) return [];
  const text = bytes.toString('utf8');
  const rules = {
    private_key: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    provider_secret: /\b(?:sb_secret_|sbp_|ghp_|github_pat_|sk_live_)[A-Za-z0-9_-]{20,}/,
    signed_token: /\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}/,
  };
  return Object.entries(rules).filter(([, re]) => re.test(text)).map(([kind]) => kind);
}

async function main(args) {
  if (args.length === 2 && args[0] === '--verify') {
    const root = path.resolve(args[1]);
    const manifest = JSON.parse(readFileSync(path.join(root, 'source-manifest.json'), 'utf8'));
    assert.equal(manifest.schemaVersion, 1);
    assert.match(manifest.commit, /^[a-f0-9]{40}$/);
    assert.match(manifest.sourceCommit, /^[a-f0-9]{40}$/);
    assert(manifest.files['apps/shell/package.json'] && manifest.files['pnpm-lock.yaml']);
    for (const [name, hash] of Object.entries(manifest.files)) {
      assert(includeFile(name), `Unsafe manifest path: ${name}`);
      assert.match(hash, /^[a-f0-9]{64}$/);
      assert.equal(checksum(readFileSync(path.join(root, name))), hash, `Changed source file: ${name}`);
    }
    console.log(JSON.stringify({ applicationCommit: manifest.commit, sourceCommit: manifest.sourceCommit,
      filesVerified: Object.keys(manifest.files).length, status: 'passed', scope: 'Manifest-listed files only; compare archive checksum via trusted delivery channel.' }, null, 2));
    return;
  }
  assert.equal(args.length, 6, 'Use --ref COMMIT --application-ref COMMIT --out NEW_DIRECTORY');
  const options = Object.fromEntries(Array.from({ length: 3 }, (_, i) => [args[i * 2], args[i * 2 + 1]]));
  assert.deepEqual(Object.keys(options).sort(), ['--application-ref', '--out', '--ref']);
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const git = (...a) => execFileSync('git', ['-C', root, ...a], { maxBuffer: 256 * 1024 * 1024, windowsHide: true });
  const resolve = ref => git('rev-parse', '--verify', `${ref}^{commit}`).toString().trim();
  const sourceCommit = resolve(options['--ref']);
  const commit = resolve(options['--application-ref']);
  git('merge-base', '--is-ancestor', commit, sourceCommit);
  const changed = git('diff', '--name-only', commit, sourceCommit).toString().trim().split('\n').filter(Boolean);
  assert(changed.every(documentationOnly), 'Source revision includes unverified runtime changes');
  const runtimeRequire = createRequire(path.join(root, 'tools/handoff/package.json'));
  const JSZip = runtimeRequire('jszip');
  const archive = await JSZip.loadAsync(sourceArchive(git, sourceCommit));
  const objectFormat = git('rev-parse', '--show-object-format').toString().trim();
  assert(['sha1', 'sha256'].includes(objectFormat), 'Unsupported Git object format');
  const blobs = new Map(git('ls-tree', '-r', '-z', '--format=%(objectname)%x09%(path)', sourceCommit)
    .toString('utf8').split('\0').filter(Boolean).map(entry => {
      const separator = entry.indexOf('\t');
      assert(separator > 0, 'Invalid Git tree record');
      return [entry.slice(separator + 1), entry.slice(0, separator)];
    }));
  const packed = new JSZip();
  const files = {};
  const entries = [];
  const excluded = [];
  const findings = [];
  for (const [name, entry] of Object.entries(archive.files).sort(([a], [b]) => a.localeCompare(b))) {
    if (entry.dir) continue;
    if (!includeFile(name)) { excluded.push(name); continue; }
    assert.equal((Number(entry.unixPermissions) & 0o170000) === 0o120000, false, `Symlink requires review: ${name}`);
    const bytes = await entry.async('nodebuffer');
    const blobHash = createHash(objectFormat).update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    assert.equal(blobHash, blobs.get(name), `Archive changed committed bytes: ${name}`);
    const kinds = secretKinds(bytes);
    if (kinds.length) findings.push({ file: name, kinds });
    files[name] = checksum(bytes);
    entries.push([name, bytes]);
    packed.file(name, bytes, { date: entry.date, unixPermissions: entry.unixPermissions });
  }
  assert.deepEqual(findings, [], 'Potential secrets must be reviewed before packaging; values intentionally not printed');
  assert(files['apps/shell/package.json'] && files['pnpm-lock.yaml'] && files['tools/handoff/package-lock.json']);
  const manifest = { schemaVersion: 1, commit, sourceCommit, createdAt: new Date().toISOString(),
    scope: 'Committed app source plus documentation-only successor. No Git history, credentials or infrastructure state.',
    historicalEvidenceRequiresGitHistory: true, excluded, files };
  const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
  packed.file('source-manifest.json', manifestBytes);
  const zip = await packed.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 }, platform: 'UNIX' });
  const restored = await JSZip.loadAsync(zip);
  for (const [name, hash] of Object.entries(files)) assert.equal(checksum(await restored.file(name).async('nodebuffer')), hash);
  const out = path.resolve(options['--out']);
  assert(!existsSync(out), 'Output must be a new directory; existing evidence is never overwritten');
  mkdirSync(out, { recursive: true });
  const dest = path.join(out, 'source');
  for (const [name, bytes] of [...entries, ['source-manifest.json', manifestBytes]]) {
    const file = path.resolve(dest, name);
    assert(file.startsWith(dest + path.sep));
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, bytes, { flag: 'wx' });
  }
  const zipName = `mwell-intra-source-${sourceCommit.slice(0, 12)}.zip`;
  writeFileSync(path.join(out, zipName), zip, { flag: 'wx' });
  writeFileSync(path.join(out, 'SHA256SUMS'), `${checksum(zip)}  ${zipName}\n`, { flag: 'wx' });
  console.log(JSON.stringify({ commit, sourceCommit, out, zipName, files: entries.length, excluded: excluded.length,
    sha256: checksum(zip), zipRoundtrip: 'passed', scan: 'No configured secret patterns found; not a comprehensive security audit' }, null, 2));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main(process.argv.slice(2));
