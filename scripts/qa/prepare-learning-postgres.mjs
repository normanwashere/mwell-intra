import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const manifestDigest = 'ff26523771be13271f3a691a29643d49bab48cda54e5b7899ccdf6d88ec355b2';
const digest = value => createHash('sha256').update(value.toString().replace(/\r\n?/g, '\n')).digest('hex');

export function validateCanonicalManifest(raw) {
  if (digest(raw) !== manifestDigest) throw new Error('Unreviewed canonical replay manifest');
  return JSON.parse(raw);
}

function readOwnedFile(root, filename) {
  const relative = path.relative(root, filename);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('File outside repository');
  let current = root;
  for (const part of relative.split(path.sep)) {
    current = path.join(current, part);
    if (lstatSync(current).isSymbolicLink()) throw new Error('Symlink input is not allowed');
  }
  if (!lstatSync(filename).isFile()) throw new Error('Expected a regular file');
  return readFileSync(filename);
}

export function validateReplayInventory(root) {
  root = realpathSync(root);
  const manifest = validateCanonicalManifest(readOwnedFile(root, path.join(root, 'scripts/qa/canonical-replay-manifest.json')));
  const files = [];
  for (const [kind, entries, directory] of [
    ['baseline', manifest.baseline, 'scripts/qa/fixtures/canonical-uat-baseline'],
    ['sources', manifest.sources, 'supabase/migrations'],
  ]) {
    const names = entries.map(entry => entry.file);
    if (!names.length || new Set(names).size !== names.length ||
        names.some(name => !/^\d{14}_[a-z0-9_]+\.sql$/.test(name)) ||
        names.join('\n') !== [...names].sort().join('\n')) throw new Error('Invalid migration inventory');
    const actual = readdirSync(path.join(root, directory)).filter(name => name.endsWith('.sql')).sort();
    if (actual.join('\n') !== names.join('\n')) throw new Error(`Missing or unclassified ${kind} migration`);
    for (const [index, entry] of entries.entries()) {
      const bytes = readOwnedFile(root, path.join(root, directory, entry.file));
      if (digest(bytes) !== entry.sha256) throw new Error(`Changed ${kind} migration: ${entry.file}`);
      if (kind === 'sources' && !['preserve-history', 'execute-forward'].includes(entry.action)) throw new Error('Unknown migration action');
      const output = kind === 'baseline'
        ? `${String(index + 1).padStart(14, '0')}_${entry.file.slice(15)}`
        : entry.action === 'execute-forward' ? entry.file : null;
      files.push({ ...entry, kind, output, bytes });
    }
  }
  const outputNames = files.filter(file => file.output).map(file => file.output);
  if (new Set(outputNames).size !== outputNames.length || outputNames.join('\n') !== [...outputNames].sort().join('\n')) {
    throw new Error('Duplicate or unordered output migration');
  }
  return { manifest, files };
}

export function validateLegacyPrerequisites(sql) {
  const digest = createHash('sha256').update(sql.replace(/\r\n?/g, '\n')).digest('hex');
  if (digest !== '6a1b315c67ffa20736fd8c9d12e7542165cc9f3143de1cae82f8791312d9e96d') {
    throw new Error('Unreviewed legacy prerequisite fixture; review real catalog provenance and authority before changing');
  }
}

export function prepareLearningPostgres({ root, temporaryRoot, destination }) {
  const parent = realpathSync(temporaryRoot);
  const target = path.resolve(destination);
  const relative = path.relative(parent, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) ||
      path.dirname(target) !== parent || target === path.resolve(root)) {
    throw new Error('Database workspace is outside the dedicated temporary directory');
  }
  if (existsSync(target)) throw new Error('Database workspace already exists; refusing to overwrite');
  const { manifest, files } = validateReplayInventory(root);
  const config = readOwnedFile(realpathSync(root), path.join(realpathSync(root), 'supabase/config.toml')).toString();
  if (!/^project_id = "mwell-intra-learning-ci"\r?$/m.test(config) || /\benv\(|project_ref|password/i.test(config)) {
    throw new Error('Expected the committed, credential-free local CI configuration');
  }
  const migrations = path.join(target, 'supabase/migrations');
  mkdirSync(migrations, { recursive: true });
  writeFileSync(path.join(target, 'supabase/config.toml'), config);
  // Write the already validated bytes, not a second read that could differ from the audit.
  for (const file of files.filter(file => file.output)) writeFileSync(path.join(migrations, file.output), file.bytes);
  writeFileSync(path.join(target, 'replay-audit.json'), JSON.stringify({
    scope: manifest.scope, manifestSha256: manifestDigest,
    files: files.map(({ bytes: _bytes, ...metadata }) => metadata),
  }, null, 2) + '\n');
  return {
    baselineCount: manifest.baseline.length,
    migrationCount: files.filter(file => file.kind === 'sources' && file.output).length,
    preservedCount: files.filter(file => !file.output).length,
    destination: target,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.env.CI !== 'true' || !process.env.RUNNER_TEMP || process.argv.length !== 4 || process.argv[2] !== '--output') {
    throw new Error('CI=true, RUNNER_TEMP and --output are required for disposable PostgreSQL preparation');
  }
  const result = prepareLearningPostgres({ root, temporaryRoot: process.env.RUNNER_TEMP, destination: process.argv[3] });
  console.log(`Prepared ${result.baselineCount} canonical empty-baseline files and ${result.migrationCount} unchanged forward migrations; ${result.preservedCount} historical files accounted for but not replayed. Workspace: ${result.destination}`);
}
