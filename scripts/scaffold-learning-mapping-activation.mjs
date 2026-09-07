#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { baselineQuery } from './rehearse-learning-mapping-correction.mjs';
const bindings = JSON.parse(readFileSync(new URL('./learning-mapping-uat-bindings.json', import.meta.url), 'utf8'));

export function scaffoldActivation(key, publishedFingerprint = null) {
  const binding = bindings.bindings.find((entry) => entry.key === key);
  if (!binding || (publishedFingerprint !== null && !/^[a-f0-9]{32}$/.test(publishedFingerprint))) {
    throw new Error('Internal correction key and exact optional v2 fingerprint required');
  }
  const identity = { projectRef: bindings.projectRef, candidate: bindings.candidate, key,
    baselineFingerprint: binding.baselineFingerprint, publishedFingerprint };
  return {
    purpose: 'Scaffolding only. Null values are deliberately unverified; this is not approval.',
    publishedFingerprintQuery: `${baselineQuery(key, 2)};`,
    input: { ...identity, mode: 'rehearsal', reviewMode: 'automated',
      ownerEmail: 'intra.test.admin@mwell.com.ph', reviewerEmail: 'intra.test.legal.lead@mwell.com.ph',
      authorAgentId: null, reviewerAgentId: null, reviewedAt: null, userAuthorizationReference: null,
      reviewArtifactPath: null, reviewArtifactSha256: null, reviewedContentSha256: binding.contentSha256,
      publicHealthPath: null, publicHealthSha256: null, activationReviewPath: null, activationReviewSha256: null },
    publicHealthEvidence: { surface: 'public_alias', projectRef: bindings.projectRef,
      commit: null, healthy: null, observedAt: null },
    activationReviewDraft: { ...identity, reviewMode: 'automated', verdict: null,
      reviewerAgentId: null, publicHealthSha256: null, activationPolicy: 'add_current_version_preserve_prior' },
    executionApprovalDraft: { executionApproved: false, candidate: bindings.candidate, key,
      reviewerAgentId: null, rehearsalSqlSha256: null },
    procedure: [
      'Main reads publishedFingerprintQuery and binds the exact inactive v2 fingerprint.',
      'Reuse the actual per-key content/publication review artifact and its real agent identities; do not treat this scaffold as that artifact.',
      'After public-alias promotion, capture actual matching project/commit health evidence and hash that file.',
      'Obtain separate activation review bound to both fingerprints and the actual public-health file hash.',
      'Render rollback SQL with activate-learning-mapping-correction.mjs using the completed input object only.',
      'Main rehearses and reviews exact SQL. A separately approved execution artifact with its SHA-256 is required for mode apply.',
    ],
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (![3, 4].includes(process.argv.length)) throw new Error('Usage: node scripts/scaffold-learning-mapping-activation.mjs warehouse_operator|finance|admin [published-v2-fingerprint]');
  process.stdout.write(`${JSON.stringify(scaffoldActivation(process.argv[2], process.argv[3] ?? null), null, 2)}\n`);
}
