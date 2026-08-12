import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const concurrencySource = readFileSync(
  new URL("./verify-learning-concurrency.mjs", import.meta.url),
  "utf8",
);
const workflowSource = readFileSync(
  new URL("../.github/workflows/ci.yml", import.meta.url),
  "utf8",
);

test("exercises both READ COMMITTED lock orderings for every authority loss", () => {
  for (const authority of [
    "assignment deletion",
    "role deactivation",
    "capability removal",
  ]) {
    assert.match(concurrencySource, new RegExp(`${authority} issuance-first`));
    assert.match(concurrencySource, new RegExp(`${authority} loss-first`));
  }
  assert.match(
    concurrencySource,
    /verifyAuthorityLossFirstRace[\s\S]*?assertStillBlocked[\s\S]*?assert\.rejects[\s\S]*?no active certification/i,
  );
  assert.match(concurrencySource, /set statement_timeout = '20s'/i);
  assert.match(concurrencySource, /set deadlock_timeout = '1s'/i);
});

test("cleans deterministic fixtures before and after every applied run", () => {
  assert.match(
    concurrencySource,
    /await cleanupFixture\(checkClient\);[\s\S]*?await seedFixture\(checkClient\);/,
  );
  assert.match(
    concurrencySource,
    /finally[\s\S]*?await cleanupFixture\(checkClient\)[\s\S]*?client\.end/,
  );
  assert.match(
    workflowSource,
    /pnpm verify:learning-applied\s*\n\s*pnpm verify:learning-applied/,
  );
});
