import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

export function bundleReleaseDocumentation({ root = repoRoot, destination }) {
  if (!destination) throw new Error('A documentation output directory is required.');
  const target = path.resolve(destination);
  const source = path.resolve(root, 'docs');
  if (target === source || target.startsWith(source + path.sep) || source.startsWith(target + path.sep)) {
    throw new Error('Documentation output must not overlap the source tree.');
  }
  mkdirSync(target, { recursive: true });
  // Keep canonical document locations, including transitive handoff/plan links.
  cpSync(source, target, { recursive: true });
  writeFileSync(path.join(target, 'MWELL_INTRA_COMPLETE_DOCUMENTATION.html'), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Mwell Intra documentation</title>
<script>location.replace('manual/index.html' + location.search + location.hash);</script>
</head><body><a href="manual/index.html">Open the maintained operating handbook</a></body></html>
`);
  writeFileSync(path.join(target, 'MWELL_INTRA_USER_MANUAL.md'),
    '# Mwell Intra User Manual\n\n[Open the maintained user manual](manual/MWELL_INTRA_USER_MANUAL.md).\n');
  writeFileSync(path.join(target, 'manual/USER_TRAINING_AND_OPERATIONS_MANUAL.md'),
    '# User Training and Operations Manual\n\n[Open the maintained manual](../USER_TRAINING_AND_OPERATIONS_MANUAL.md).\n');
  const screenshots = path.join(root, 'apps/shell/public/knowledge/screenshots');
  if (existsSync(screenshots)) cpSync(screenshots, path.join(target, 'screenshots'), { recursive: true });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const index = process.argv.indexOf('--output');
  if (index < 0 || !process.argv[index + 1]) throw new Error('Usage: bundle-release-documentation.mjs --output <directory>');
  bundleReleaseDocumentation({ destination: process.argv[index + 1] });
}
