#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { renderAutomatedVendorEvidenceDryRun } from './publish-vendor-evidence-learning.mjs';
if (process.argv.length !== 3) throw new Error('Explicit local automated-review input JSON required; render only');
process.stdout.write(renderAutomatedVendorEvidenceDryRun(JSON.parse(readFileSync(process.argv[2], 'utf8'))));
