import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const destination = path.join(root, 'docs/audits/task-first-coverage.md');

export async function buildCoverageSnapshot() {
  const require = createRequire(path.join(root, 'apps/shell/package.json'));
  const { build } = require('esbuild');
  const bundled = await build({
    absWorkingDir: root,
    stdin: {
      contents: `import { KNOWLEDGE_CONTENT } from './apps/shell/lib/knowledge/content.ts';
        import { validateTaskCoverage } from './apps/shell/lib/knowledge/coverage.ts';
        export const content = KNOWLEDGE_CONTENT;
        export const coverage = validateTaskCoverage(content);`,
      resolveDir: root, loader: 'ts',
    },
    bundle: true, platform: 'node', format: 'esm', target: 'node22', write: false,
  });
  const { content, coverage } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
  const snapshot = {
    counts: coverage.counts,
    controls: coverage.inventory.map(({ key, referenceId, availability, flowIds, evidenceIds, unverified }) =>
      ({ key, referenceId, availability, flowIds, evidenceIds, unverified })),
  };
  const source = readFileSync(destination, 'utf8').replaceAll('\r\n', '\n');
  const jsonBlock = /```json\n([\s\S]*?)\n```/;
  if (!jsonBlock.test(source)) throw new Error('Coverage snapshot JSON block is missing.');
  // Replace only derived inventory. Preserve historical checks and acceptance caveats.
  let text = source.replace(jsonBlock, () => `\`\`\`json\n${JSON.stringify(snapshot, null, 2)}\n\`\`\``);
  const tableRows = content.features.map(feature => `| feature-${feature.id} | ${feature.availability} | ${feature.controls.length} | ${feature.routes.join(', ') || 'No executable route'} | ${feature.owner} | ${feature.relatedFlowIds.join(', ') || 'Reference only'} |`);
  const table = /\| Feature reference \| Availability \| Controls \| Routes \| Content owner \| Existing flows \|\n\| --- \| --- \| ---: \| --- \| --- \| --- \|\n(?:\|[^\n]*\|\n)+/;
  if (!table.test(text)) throw new Error('Coverage feature table is missing.');
  text = text.replace(table, () => [
    '| Feature reference | Availability | Controls | Routes | Content owner | Existing flows |',
    '| --- | --- | ---: | --- | --- | --- |', ...tableRows, '',
  ].join('\n'));
  return { text, coverage };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { text, coverage } = await buildCoverageSnapshot();
  if (process.argv.includes('--check')) {
    if (readFileSync(destination, 'utf8').replaceAll('\r\n', '\n') !== text) {
      throw new Error('Coverage snapshot is stale. Run node scripts/docs/build-task-coverage-snapshot.mjs.');
    }
    console.log('Coverage snapshot is current.');
  } else {
    writeFileSync(destination, text);
    console.log('Updated docs/audits/task-first-coverage.md inventory only.');
  }
  console.log(JSON.stringify({ ...coverage.counts, missingActionEvidence: coverage.missingActionEvidence.length,
    unverifiedRows: coverage.inventory.filter(row => row.unverified).length,
    unmappedLiveControls: coverage.unmappedLiveControls.length,
    unresolvedTargets: coverage.unresolvedTargets.length,
    invalidDecisionBranches: coverage.invalidDecisionBranches.length }, null, 2));
}
