import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDocumentationHtml,
  documentationSources,
} from "./build-app-documentation.mjs";

test("builds one self-contained handbook from every canonical source", () => {
  const html = buildDocumentationHtml();
  assert.match(html, /Mwell Intra Complete Documentation/);
  assert.match(html, /Search every document/);
  assert.match(html, /Technical and Functional Specification/);
  assert.match(html, /User Training And Operations Manual/);
  assert.match(html, /WMS Feedback Release/);
  assert.match(html, /Users V1/);
  assert.match(html, /user@example\.com/);
  assert.doesNotMatch(html, /<script\s+src=/i);
  assert.doesNotMatch(html, /<link\s+[^>]*rel=["']stylesheet/i);
  assert.ok(documentationSources().length >= 15);
});

test("embeds local manual screenshots as data URLs", () => {
  const html = buildDocumentationHtml();
  assert.match(html, /src="data:image\/(?:png|jpeg|webp);base64,/);
  assert.doesNotMatch(html, /src="assets\/knowledge-base\//);
});
