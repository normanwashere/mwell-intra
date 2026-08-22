import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDocumentationHtml,
  documentationSources,
} from "./build-app-documentation.mjs";

test("builds one self-contained handbook from every canonical source", () => {
  const html = buildDocumentationHtml();
  const sources = documentationSources();
  assert.match(html, /Mwell Intra Standalone Operating Handbook/);
  assert.match(html, /Search the complete handbook/);
  assert.match(html, /Technical and Functional Specification/);
  assert.match(html, /User Training And Operations Manual/);
  assert.match(html, /WMS Feedback Release/);
  assert.match(html, /Users V1/);
  assert.match(html, /user@example\.com/);
  assert.match(html, /class="mermaid"/);
  assert.match(html, /mermaid\.initialize/);
  assert.match(html, /Mwell Intra Process Reference Library/);
  assert.match(html, /id="doc-manual-mwell-intra-user-manual-md-start-here"/);
  assert.doesNotMatch(html, /Knowledge Base/i);
  assert.doesNotMatch(html, /<script\s+src=/i);
  assert.doesNotMatch(html, /<link\s+[^>]*rel=["']stylesheet/i);
  assert.doesNotMatch(html, /\r/);
  assert.ok(sources.length >= 15);
  assert.deepEqual(sources.slice(2), [...sources.slice(2)].sort());
});

test("embeds local manual screenshots as data URLs", () => {
  const html = buildDocumentationHtml();
  assert.match(html, /src="data:image\/(?:png|jpeg|webp);base64,/);
  assert.doesNotMatch(html, /src="assets\/knowledge-base\//);
});

test("embeds local presentation assets without external requests", () => {
  const html = buildDocumentationHtml();
  assert.match(html, /<style data-handbook-styles>/);
  assert.match(html, /<script data-handbook-runtime>/);
  assert.doesNotMatch(html, /<script\s+src=/i);
  assert.doesNotMatch(html, /<link\s+[^>]*rel=["']stylesheet/i);
});

test("renders seven accessible tabs and every source once", () => {
  const html = buildDocumentationHtml();
  assert.equal((html.match(/role="tab"/g) ?? []).length, 7);
  assert.equal((html.match(/role="tabpanel"/g) ?? []).length, 7);
  for (const id of ["start", "workflows", "roles", "architecture", "infrastructure", "security", "release"]) {
    assert.match(html, new RegExp(`id="tab-${id}"`));
    assert.match(html, new RegExp(`id="panel-${id}"`));
  }
  assert.equal((html.match(/<article[^>]+data-document/g) ?? []).length, documentationSources().length);
});

test("renders primary article navigation and in-place route support", () => {
  const html = buildDocumentationHtml();
  assert.match(html, /data-article-link/);
  assert.match(html, /data-page-toc/);
  assert.match(html, /data-related-link/);
  assert.match(html, /data-previous-link/);
  assert.match(html, /data-next-link/);
  assert.match(html, /data-previous-link[^>]+data-title=/);
  assert.match(html, /data-next-link[^>]+data-content-type=/);
  assert.match(html, /function activateRoute\(\{ tabId, articleId, headingId, historyMode, restoreScroll \}\)/);
  assert.match(html, /history\.pushState/);
  assert.match(html, /history\.replaceState/);
  assert.doesNotMatch(html, /location\.(?:href|reload)/);
});
