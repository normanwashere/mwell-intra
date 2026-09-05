import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { after, before, test } from "node:test";

const require = createRequire(new URL("../../apps/shell/package.json", import.meta.url));
const { chromium } = require("@playwright/test");
const ts = require("typescript");
const source = await readFile(new URL("./full-intra-live-e2e.mjs", import.meta.url), "utf8");
const ast = ts.createSourceFile("audit.mjs", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const definition = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "waitForUploadedEvidence");
assert.ok(definition);
const waitForUploadedEvidence = new Function(`${definition.getText(ast)}; return waitForUploadedEvidence;`)();
let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

for (const outcome of ["uploaded", "error", "missing"]) {
  test(`actual upload readiness helper: ${outcome}`, async () => {
    const page = await browser.newPage();
    page.setDefaultTimeout(500);
    await page.setContent('<div role="dialog" aria-label="Evidence"><div id="result"></div></div>');
    try {
      if (outcome !== "missing") await page.evaluate(outcome => {
        setTimeout(() => {
          const result = document.getElementById("result");
          result.textContent = outcome === "uploaded" ? "receipt.png" : "Private evidence uploads require a signed-in connection.";
          if (outcome === "error") result.setAttribute("role", "alert");
        }, 30);
      }, outcome);
      const completion = waitForUploadedEvidence(page.getByRole("dialog"), "receipt.png");
      if (outcome === "uploaded") await completion;
      else await assert.rejects(completion, outcome === "error" ? /Evidence upload failed: Private evidence uploads/ : /Timeout/);
    } finally { await page.close(); }
  });
}

test("mobile invitation review does not claim another shard certified delivery", () => {
  const fn = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "legalInviteVendorInteractionWorkflow");
  assert.ok(fn);
  assert.match(fn.getText(ast), /deliveryStatus: "not-attempted-on-this-viewport"/);
  assert.match(fn.getText(ast), /interactionSurfaceOnly: true/);
  assert.doesNotMatch(fn.getText(ast), /certified-on-/);
});
