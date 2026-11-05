import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const fixtureName = '00000000000000_ci_legacy_prerequisites.sql';

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
  const source = path.join(root, 'supabase/migrations');
  const names = readdirSync(source).filter(name => name.endsWith('.sql')).sort();
  if (!names.length || names.some(name => !/^\d{14}_[a-z0-9_]+\.sql$/.test(name) || name <= fixtureName)) {
    throw new Error('Invalid or empty repository migration inventory');
  }
  const config = readFileSync(path.join(root, 'supabase/config.toml'), 'utf8');
  if (!/^project_id = "mwell-intra-learning-ci"\r?$/m.test(config) || /\benv\(|project_ref|password/i.test(config)) {
    throw new Error('Expected the committed, credential-free local CI configuration');
  }
  validateLegacyPrerequisites(readFileSync(new URL('./fixtures/learning-legacy-prerequisites.sql', import.meta.url), 'utf8'));
  const migrations = path.join(target, 'supabase/migrations');
  mkdirSync(migrations, { recursive: true });
  writeFileSync(path.join(target, 'supabase/config.toml'), config);
  copyFileSync(new URL('./fixtures/learning-legacy-prerequisites.sql', import.meta.url), path.join(migrations, fixtureName));
  for (const name of names) copyFileSync(path.join(source, name), path.join(migrations, name));
  return { fixtureName, migrationCount: names.length, destination: target };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.env.CI !== 'true' || !process.env.RUNNER_TEMP || process.argv.length !== 4 || process.argv[2] !== '--output') {
    throw new Error('CI=true, RUNNER_TEMP and --output are required for disposable PostgreSQL preparation');
  }
  const result = prepareLearningPostgres({ root, temporaryRoot: process.env.RUNNER_TEMP, destination: process.argv[3] });
  console.log(`Prepared empty legacy dependencies and ${result.migrationCount} unchanged migrations in ${result.destination}`);
}
