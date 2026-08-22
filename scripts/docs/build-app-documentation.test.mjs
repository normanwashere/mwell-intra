import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildDocumentationHtml,
  documentationSources,
} from "./build-app-documentation.mjs";

function runtimeFunction(name, nextFunction, bindings = {}) {
  const runtime = readFileSync(new URL("./handbook-runtime.js", import.meta.url), "utf8");
  const match = runtime.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n    }\\n\\n    function ${nextFunction}`));
  assert.ok(match, `could not extract ${name} from the handbook runtime`);
  const source = match[0].slice(0, match[0].lastIndexOf(`function ${nextFunction}`));
  return new Function(...Object.keys(bindings), `${source}; return ${name};`)(...Object.values(bindings));
}

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

test("renders progressive disclosures with stable state keys", () => {
  const html = buildDocumentationHtml();

  assert.match(html, /<details[^>]+data-section-id="doc-[^"]+:[^"]+"/);
  assert.match(html, /<summary\b/);
  assert.match(html, /data-article-disclosures/);
  assert.match(html, /Expand all/);
  assert.match(html, /Collapse all/);
  assert.match(html, /mwell-intra-handbook:v2/);
  assert.match(html, /data-section-id="doc-manual-mwell-intra-user-manual-md:doc-manual-mwell-intra-user-manual-md-start-here" open/);
});

test("embeds heading-level search records with match metadata", () => {
  const html = buildDocumentationHtml();
  const indexMatch = html.match(/window\.__HANDBOOK_INDEX__ = (\[[\s\S]*?\]);/);

  assert.ok(indexMatch, "the generated handbook embeds a search index");
  const index = JSON.parse(indexMatch[1]);
  const heading = index.find((record) => record.headingId && record.headingId !== record.articleId);

  assert.equal(index[0].tabId, "start");
  assert.ok(heading, "the index contains a heading-level record");
  assert.deepEqual(index.map((record) => record.tabId), [...index.map((record) => record.tabId)].sort((left, right) => {
    const tabOrder = ["start", "workflows", "roles", "architecture", "infrastructure", "security", "release"];
    return tabOrder.indexOf(left) - tabOrder.indexOf(right);
  }));
  assert.equal(new Set(index.map((record) => record.articleId)).size, (index.filter((record, position) => position === 0 || record.articleId !== index[position - 1].articleId)).length);
  assert.deepEqual(Object.keys(heading), [
    "tabId",
    "articleId",
    "headingId",
    "title",
    "heading",
    "summary",
    "audience",
    "keywords",
    "source",
    "text",
  ]);
  assert.ok(heading.text.length <= 240);
  assert.match(html, /"scope":"all"/);
  assert.match(html, /aria-live="polite"/);
  assert.doesNotMatch(indexMatch[1], /<\/script/i);
});

test("renders scoped explainable search without navigation reloads", () => {
  const html = buildDocumentationHtml();

  assert.match(html, /data-search-scope="tab"/);
  assert.match(html, /data-search-scope="all"/);
  assert.match(html, /data-search-result/);
  assert.match(html, /function rankSearchResults/);
  assert.match(html, /params\.set\("q", query\)/);
  assert.match(html, /params\.set\("scope", scope\)/);
  assert.match(html, /function openContainingDisclosure/);
  assert.doesNotMatch(html, /location\.(?:href|reload)/);
});

test("normalizes persisted handbook state without accepting malformed values", () => {
  const normalizeStoredState = runtimeFunction("normalizeStoredState", "readStoredState");

  assert.deepEqual(normalizeStoredState({
    activeTab: "architecture",
    activeArticle: "doc-technical-and-functional-specification-md",
    query: "  tenant  ",
    scope: "tab",
    expandedIds: ["doc-technical-and-functional-specification-md:runtime-architecture", 4],
    diagramViews: { "doc-technical-and-functional-specification-md:diagram-1": { left: 18, top: 32 } },
    diagramZoom: { "doc-technical-and-functional-specification-md:diagram-1": 1.4, broken: "big" },
    tabScroll: { architecture: 480, release: "bottom" },
    theme: "dark",
  }), {
    activeTab: "architecture",
    activeArticle: "doc-technical-and-functional-specification-md",
    query: "tenant",
    scope: "tab",
    expandedIds: ["doc-technical-and-functional-specification-md:runtime-architecture"],
    diagramViews: { "doc-technical-and-functional-specification-md:diagram-1": { left: 18, top: 32 } },
    diagramZoom: { "doc-technical-and-functional-specification-md:diagram-1": 1.4 },
    tabScroll: { architecture: 480 },
    theme: "dark",
  });
  assert.deepEqual(normalizeStoredState(null), {
    activeTab: "start",
    activeArticle: null,
    query: "",
    scope: "all",
    expandedIds: [],
    diagramViews: {},
    diagramZoom: {},
    tabScroll: {},
    theme: "light",
  });
});

test("serializes a tab-only scope without a query and parses it on refresh", () => {
  const routeHash = runtimeFunction("routeHash", "captureDisclosureState", { searchState: { query: "", scope: "tab" } });
  const parseRoute = runtimeFunction("parseRoute", "routeHash");
  const hash = routeHash({ tabId: "start", articleId: null, headingId: null });

  assert.equal(hash, "#tab=start&scope=tab");
  assert.deepEqual(parseRoute(hash), {
    tabId: "start",
    articleId: null,
    headingId: null,
    query: "",
    scope: "tab",
  });
  const defaultScopeHash = runtimeFunction("routeHash", "captureDisclosureState", { searchState: { query: "", scope: "all" } })({ tabId: "start" });
  assert.equal(defaultScopeHash, "#tab=start");
});

test("serializes tab routes safely while preserving browser query semantics", () => {
  const html = buildDocumentationHtml();
  const match = html.match(/href="(#tab=start&amp;article=doc-manual-mwell-intra-user-manual-md)" data-article-link/);
  assert.ok(match);
  const browserHref = match[1].replaceAll("&amp;", "&");
  const params = new URLSearchParams(browserHref.slice(1));
  assert.deepEqual(Object.fromEntries(params), {
    tab: "start",
    article: "doc-manual-mwell-intra-user-manual-md",
  });
});
