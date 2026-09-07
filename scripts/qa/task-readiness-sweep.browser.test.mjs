import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readinessDom, readinessStatus } from "./task-readiness-sweep.mjs";

const require = createRequire(new URL("../../apps/shell/package.json", import.meta.url));
const { chromium } = require("@playwright/test");

test("rendered readiness states cannot turn unavailable, stale selection or empty regions into passes", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      const context = await browser.newContext({ viewport });
      try {
        const page = await context.newPage();
        for (const [content, expected] of [
          ['<h3>Needed for this task</h3><p>No outstanding learning is identified for this task.</p>', "passed"],
          ['<p role="alert">Task learning readiness is unavailable.</p>', "failed"],
          ['<p role="alert">Task readiness could not be refreshed. Try again.</p>', "failed"],
          ['<p role="status">Refreshing task readiness.</p>', "failed"],
          ["", "failed"],
        ]) {
          await page.setContent(`<section aria-label="Task learning" data-task-id="one">${content}</section>`);
          assert.equal(readinessStatus([await readinessDom(page, "one")], "one"), expected);
        }
        await page.setContent('<section aria-label="Task learning" data-task-id="other"><h3>Needed for this task</h3></section>');
        assert.equal(readinessStatus([await readinessDom(page, "one")], "one"), "failed");
      } finally { await context.close(); }
    }
  } finally { await browser.close(); }
});
