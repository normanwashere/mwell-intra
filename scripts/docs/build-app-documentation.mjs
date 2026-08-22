import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse as parseCsv } from "csv-parse/sync";
import { marked, Renderer } from "marked";
import { HANDBOOK_TABS, resolveHandbookCatalog } from "./handbook-catalog.mjs";

const root = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
export const outputFile = "docs/manual/index.html";
const mermaidBundleFile = path.join(root, "node_modules/mermaid/dist/mermaid.min.js");
const handbookStylesFile = path.join(root, "scripts/docs/handbook-styles.css");
const handbookRuntimeFile = path.join(root, "scripts/docs/handbook-runtime.js");

function normalize(file) {
  return file.replaceAll("\\", "/");
}

function normalizeText(value) {
  return value.replace(/\r\n?/g, "\n");
}

function markdownFiles(directory) {
  const absolute = path.join(root, directory);
  if (!existsSync(absolute)) return [];
  return readdirSync(absolute)
    .filter((name) => name.endsWith(".md"))
    .sort()
    .map((name) => normalize(path.join(directory, name)));
}

function filesWithExtension(directory, extension) {
  const absolute = path.join(root, directory);
  if (!existsSync(absolute)) return [];
  return readdirSync(absolute)
    .filter((name) => name.endsWith(extension))
    .sort()
    .map((name) => normalize(path.join(directory, name)));
}

export function documentationSources() {
  const prioritized = [
    "docs/manual/MWELL_INTRA_USER_MANUAL.md",
    "docs/PROCESS_REFERENCE_LIBRARY.md",
  ];
  const remaining = [
    ...markdownFiles("docs"),
    ...markdownFiles("docs/policy"),
    ...markdownFiles("docs/runbooks"),
    ...markdownFiles("docs/releases"),
    ...markdownFiles("docs/import-templates"),
    ...filesWithExtension("docs/import-templates", ".csv"),
  ].sort();
  return [...prioritized, ...remaining].filter(
    (file, index, files) =>
      files.indexOf(file) === index &&
      file !== "docs/knowledge-base-coverage-report.md",
  );
}

function slug(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "document";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function collapseWhitespace(value) {
  return String(value).replace(/\s+/g, " ").trim();
}

function plainMarkdownText(value) {
  return collapseWhitespace(
    String(value)
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/<[^>]*>/g, " ")
      .replace(/[`*_~>#|]/g, " "),
  );
}

function searchExcerpt(value, limit = 240) {
  const text = collapseWhitespace(value);
  return text.length <= limit ? text : `${text.slice(0, limit - 3).trimEnd()}...`;
}

function serializeForScript(value) {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

function titleOf(source, file) {
  if (path.extname(file).toLowerCase() === ".csv") {
    return path.basename(file, ".csv").replaceAll("-", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
  }
  return source.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? path.basename(file, ".md");
}

function mimeFor(file) {
  const extension = path.extname(file).toLowerCase();
  return extension === ".jpg" || extension === ".jpeg"
    ? "image/jpeg"
    : extension === ".webp"
      ? "image/webp"
      : extension === ".svg"
        ? "image/svg+xml"
        : "image/png";
}

function embeddedImage(href, sourceFile) {
  if (/^(https?:|data:)/i.test(href)) return href;
  const absolute = path.resolve(root, path.dirname(sourceFile), href);
  if (!existsSync(absolute)) return href;
  return `data:${mimeFor(absolute)};base64,${readFileSync(absolute).toString("base64")}`;
}

function routeHash({ tabId, articleId, headingId }) {
  const params = new URLSearchParams({ tab: tabId });
  if (articleId) params.set("article", articleId);
  if (headingId) params.set("heading", headingId);
  return `#${params}`;
}

function resolveDocumentLink(href, sourceFile, sourceIds, sourceRoutes) {
  if (/^(https?:|mailto:|#)/i.test(href)) return href;
  const [filePart, fragment] = href.split("#", 2);
  if (!filePart.toLowerCase().endsWith(".md")) return href;
  const target = normalize(path.relative(root, path.resolve(root, path.dirname(sourceFile), filePart)));
  const id = sourceIds.get(target);
  const route = sourceRoutes.get(target);
  return id && route
    ? routeHash({
      tabId: route.primaryTab,
      articleId: id,
      headingId: fragment ? `${id}-${slug(fragment)}` : undefined,
    })
    : href;
}

function flowDiagramMetadata(text) {
  const directive = String(text).match(/^\s*%%\s*handbook-flow:\s*([^\n]+)\n?/i);
  if (!directive) return { source: text, workflow: null, view: null, stages: [] };
  const values = Object.fromEntries(directive[1].split(";").map((part) => {
    const [key, ...rest] = part.trim().split("=");
    return [key?.trim().toLowerCase(), rest.join("=").trim()];
  }));
  const view = ["overview", "role", "decision"].includes(values.view) ? values.view : "overview";
  return {
    source: String(text).slice(directive[0].length),
    workflow: slug(values.workflow || "workflow"),
    view,
    stages: (values.stages || "").split("|").map((stage) => stage.trim()).filter(Boolean),
  };
}

function renderMarkdown(markdown, sourceFile, sourceIds, sourceRoutes) {
  const renderer = new Renderer();
  renderer.heading = function ({ depth, text, tokens }) {
    const documentId = sourceIds.get(sourceFile) ?? "document";
    return `<h${depth} id="${documentId}-${slug(text)}">${this.parser.parseInline(tokens)}</h${depth}>`;
  };
  renderer.image = ({ href, title, text }) => {
    const source = embeddedImage(href, sourceFile);
    return `<figure class="doc-image"><img src="${escapeHtml(source)}" alt="${escapeHtml(text)}" loading="lazy"${title ? ` title="${escapeHtml(title)}"` : ""}><figcaption>${escapeHtml(text)}</figcaption></figure>`;
  };
  renderer.link = function ({ href, title, tokens }) {
    const target = resolveDocumentLink(href, sourceFile, sourceIds, sourceRoutes);
    const external = /^https?:/i.test(target);
    const internalRoute = /^#tab=/.test(target);
    return `<a href="${escapeHtml(target)}"${internalRoute ? " data-route-link" : ""}${title ? ` title="${escapeHtml(title)}"` : ""}${external ? ' target="_blank" rel="noreferrer"' : ""}>${this.parser.parseInline(tokens)}</a>`;
  };
  renderer.code = ({ text, lang }) => {
    if (lang !== "mermaid") return `<pre class="code-block"${lang ? ` data-language="${escapeHtml(lang)}"` : ""}><code>${escapeHtml(text)}</code></pre>`;
    const metadata = flowDiagramMetadata(text);
    const flowAttributes = metadata.workflow
      ? ` data-flow-workflow="${escapeHtml(metadata.workflow)}" data-flow-view="${metadata.view}" data-flow-stages="${escapeHtml(metadata.stages.join("|"))}"`
      : "";
    return `<figure class="diagram-shell"${flowAttributes}><div class="diagram-toolbar" aria-label="Diagram zoom controls"><button type="button" data-diagram-fit aria-label="Fit diagram to available space">Fit</button><button type="button" data-diagram-zoom="reset" aria-label="Show diagram at 100 percent">100%</button><button type="button" data-diagram-zoom="out" aria-label="Zoom diagram out">−</button><button type="button" data-diagram-zoom="in" aria-label="Zoom diagram in">+</button></div><div class="diagram-viewport" data-diagram-viewport role="region" tabindex="0" aria-label="Diagram canvas. Scroll or pan in both directions to inspect it."><div class="diagram-canvas"><div class="mermaid">${escapeHtml(metadata.source)}</div></div></div><figcaption>Process flow. Decision branches are shown as labeled paths.</figcaption></figure>`;
  };

  return marked.parse(markdown.replace(/^#\s+.+(?:\r?\n)+/, ""), {
    async: false,
    gfm: true,
    renderer,
  });
}

function renderCsv(csv) {
  const rows = parseCsv(csv, { bom: true, relax_column_count: true, skip_empty_lines: true });
  if (rows.length === 0) return "<p>This template has no rows.</p>";
  const [headers, ...records] = rows;
  return `<p class="template-note">Governed CSV template. Example rows are illustrative and must be removed before a production import.</p><table><thead><tr>${headers.map((cell) => `<th scope="col">${escapeHtml(cell)}</th>`).join("")}</tr></thead><tbody>${records.map((row) => `<tr>${headers.map((_, index) => `<td>${escapeHtml(row[index] ?? "")}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}

function renderSource(source, sourceFile, sourceIds, sourceRoutes) {
  return path.extname(sourceFile).toLowerCase() === ".csv"
    ? renderCsv(source)
    : renderMarkdown(source, sourceFile, sourceIds, sourceRoutes);
}

function disclosureDefaultOpen(document, heading, index, section) {
  if (document.collapse === "reference") return index === 0;
  if (document.collapse !== "workflow") return true;
  return index === 0 ||
    section.includes('class="diagram-shell"') ||
    /overview|at a glance|completion|success criteria|done when|outcome/i.test(heading);
}

function decorateArticleHtml(document, html) {
  const duplicateFallbackIds = new Map();
  const withDiagramIds = html.replace(/<figure class="diagram-shell"([^>]*)>([\s\S]*?)<\/figure>/g, (match, attributes, contents) => {
    const workflow = attributes.match(/\bdata-flow-workflow="([^"]+)"/)?.[1];
    const view = attributes.match(/\bdata-flow-view="([^"]+)"/)?.[1];
    const source = contents.match(/<div class="mermaid">([\s\S]*?)<\/div>/)?.[1] ?? contents;
    const baseId = workflow && view
      ? `${document.id}:flow:${workflow}:${view}`
      : `${document.id}:diagram:${createHash("sha256").update(source).digest("hex").slice(0, 12)}`;
    const duplicateCount = duplicateFallbackIds.get(baseId) ?? 0;
    duplicateFallbackIds.set(baseId, duplicateCount + 1);
    const id = duplicateCount === 0 ? baseId : `${baseId}:${duplicateCount + 1}`;
    return `<figure class="diagram-shell" data-diagram-id="${escapeHtml(id)}"${attributes}>${contents}</figure>`;
  });
  const flowPattern = /<figure\b(?=[^>]*\bclass="diagram-shell")(?=[^>]*\bdata-flow-workflow="([^"]+)")(?=[^>]*\bdata-flow-view="([^"]+)")(?=[^>]*\bdata-flow-stages="([^"]*)")[^>]*>[\s\S]*?<\/figure>/g;
  const diagrams = [...withDiagramIds.matchAll(flowPattern)];
  let groupedHtml = "";
  let cursor = 0;
  for (let index = 0; index < diagrams.length;) {
    const first = diagrams[index];
    const workflow = first[1];
    let end = index + 1;
    while (end < diagrams.length && diagrams[end][1] === workflow && withDiagramIds.slice(diagrams[end - 1].index + diagrams[end - 1][0].length, diagrams[end].index).trim() === "") end += 1;
    const group = diagrams.slice(index, end);
    const views = new Set(group.map((diagram) => diagram[2]));
    if (!["overview", "role", "decision"].every((view) => views.has(view))) { index = end; continue; }
    const stages = first[3].split("|").filter(Boolean);
    const groupStart = first.index;
    const groupEnd = group[group.length - 1].index + group[group.length - 1][0].length;
    groupedHtml += withDiagramIds.slice(cursor, groupStart);
    const controls = [["overview", "Overview"], ["role", "By role"], ["decision", "Decisions"]]
      .map(([view, label]) => `<button type="button" data-diagram-view-control="${view}" aria-pressed="${view === "overview"}">${label}</button>`).join("");
    const ribbon = stages.map((stage, stageIndex) => `<li data-process-stage="${stageIndex}">${escapeHtml(stage)}</li>`).join("");
    const figures = group.map((diagram) => diagram[0].replace("<figure ", `<figure data-diagram-view="${diagram[2]}" `)).join("");
    groupedHtml += `<section class="diagram-group" data-diagram-group="${escapeHtml(`${document.id}:flow:${workflow}`)}" data-workflow-id="${escapeHtml(workflow)}" data-active-diagram-view="overview"><div class="diagram-group-header"><div class="diagram-view-controls" role="group" aria-label="Workflow diagram perspective">${controls}</div><div class="process-ribbon-viewport" role="region" tabindex="0" aria-label="Workflow stages. Use left and right arrow keys to scroll stages."><ol class="process-ribbon">${ribbon}</ol></div></div>${figures}</section>`;
    cursor = groupEnd;
    index = end;
  }
  groupedHtml += withDiagramIds.slice(cursor);
  if (document.collapse === "none") return groupedHtml;

  let sectionIndex = 0;
  return groupedHtml.split(/(?=<h2\b)/).map((section) => {
    const heading = section.match(/^<h2 id="([^"]+)">([\s\S]*?)<\/h2>/);
    if (!heading) return section;
    const [, headingId, headingHtml] = heading;
    const open = disclosureDefaultOpen(document, plainMarkdownText(headingHtml), sectionIndex, section);
    sectionIndex += 1;
    return `<details class="article-section" data-section-id="${escapeHtml(`${document.id}:${headingId}`)}"${open ? " open" : ""}><summary id="${escapeHtml(headingId)}"><span role="heading" aria-level="2">${headingHtml}</span></summary><div class="article-section-content">${section.slice(heading[0].length)}</div></details>`;
  }).join("");
}

function buildSearchIndex(documents) {
  return documents.flatMap((document) => {
    const searchableTabs = [...new Set([document.primaryTab, ...document.relatedTabs])];
    const diagramLabels = (text) => [...String(text).matchAll(/```mermaid\s*([\s\S]*?)```/g)]
      .flatMap(([, diagram]) => [...diagram.matchAll(/\[([^\]]+)\]/g)].map(([, label]) => label))
      .join(" ");
    const sourceSearchText = `${plainMarkdownText(document.sourceText)} ${diagramLabels(document.sourceText)}`;
    const records = [{
      tabId: document.primaryTab,
      tabIds: searchableTabs,
      articleId: document.id,
      headingId: null,
      title: document.title,
      heading: document.title,
      summary: document.summary,
      audience: document.audience,
      keywords: document.keywords,
      source: document.file,
      text: searchExcerpt(sourceSearchText),
      searchText: sourceSearchText,
    }];

    if (path.extname(document.file).toLowerCase() === ".csv") return records;

    const tokens = marked.lexer(document.sourceText);
    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index];
      if (token.type !== "heading" || token.depth === 1) continue;
      const sectionTokens = [token];
      for (let cursor = index + 1; cursor < tokens.length && tokens[cursor].type !== "heading"; cursor += 1) {
        sectionTokens.push(tokens[cursor]);
      }
      const heading = plainMarkdownText(token.text);
      const sectionSearchText = sectionTokens.map((sectionToken) => `${plainMarkdownText(sectionToken.text ?? sectionToken.raw)} ${diagramLabels(sectionToken.raw)}`).join(" ");
      records.push({
        tabId: document.primaryTab,
        tabIds: searchableTabs,
        articleId: document.id,
        headingId: `${document.id}-${slug(token.text)}`,
        title: document.title,
        heading,
        summary: document.summary,
        audience: document.audience,
        keywords: document.keywords,
        source: document.file,
        text: searchExcerpt(sectionSearchText),
        searchText: sectionSearchText,
      });
    }
    return records;
  });
}

export function buildDocumentationHtml() {
  const mermaidBundle = readFileSync(mermaidBundleFile, "utf8").replace(/[ \t]+$/gm, "");
  const styles = normalizeText(readFileSync(handbookStylesFile, "utf8")).replace(/[ \t]+$/gm, "");
  const runtime = normalizeText(readFileSync(handbookRuntimeFile, "utf8"))
    .replace(/[ \t]+$/gm, "")
    .replaceAll("</script", "<\\/script");
  const sources = documentationSources();
  const sourceIds = new Map(sources.map((file) => [file, `doc-${slug(file.replace(/^docs\//, ""))}`]));
  const { documents: catalogDocuments, warnings } = resolveHandbookCatalog(sources);
  const catalogBySource = new Map(catalogDocuments.map((document) => [document.source, document]));
  const sourceRoutes = new Map(catalogDocuments.map((document) => [document.source, document]));
  const tabById = new Map(HANDBOOK_TABS.map((tab) => [tab.id, tab]));
  for (const warning of warnings) console.warn(warning);
  const documents = sources.map((file) => {
    const source = normalizeText(readFileSync(path.join(root, file), "utf8"));
    const catalog = catalogBySource.get(file);
    const { id: catalogId, ...metadata } = catalog;
    return {
      ...metadata,
      file,
      id: sourceIds.get(file),
      catalogId,
      title: titleOf(source, file),
      category: tabById.get(metadata.primaryTab).label,
      sourceText: source,
      html: decorateArticleHtml({ id: sourceIds.get(file), collapse: metadata.collapse }, renderSource(source, file, sourceIds, sourceRoutes)),
      hash: createHash("sha256").update(source).digest("hex").slice(0, 12),
    };
  });
  const orderedDocuments = [...documents].sort((left, right) =>
    tabById.get(left.primaryTab).order - tabById.get(right.primaryTab).order ||
    left.sortOrder - right.sortOrder ||
    left.file.localeCompare(right.file),
  );
  const searchIndex = buildSearchIndex(orderedDocuments);
  const initialSearchState = { query: "", scope: "all" };
  const documentBySource = new Map(documents.map((document) => [document.file, document]));
  const articleLink = (document, { related = false, relationLabel } = {}) => {
    const label = relationLabel ?? document.title;
    return `<a href="${escapeHtml(routeHash({ tabId: document.primaryTab, articleId: document.id }))}" data-article-link${related ? " data-related-link" : ""} data-tab="${escapeHtml(document.primaryTab)}" data-article="${escapeHtml(document.id)}" data-title="${escapeHtml(document.title)}" data-summary="${escapeHtml(document.summary)}" data-audience="${escapeHtml(document.audience.join(", "))}" data-content-type="${escapeHtml(document.contentType)}"><span>${escapeHtml(label)}</span><small>${escapeHtml(document.summary)}</small></a>`;
  };
  const panels = HANDBOOK_TABS.map((tab, index) => {
    const primaryDocuments = orderedDocuments.filter((document) => document.primaryTab === tab.id);
    const relatedDocuments = orderedDocuments.filter((document) => document.relatedTabs.includes(tab.id));
    return `<section role="tabpanel" id="panel-${tab.id}" aria-labelledby="tab-${tab.id}" data-tab-panel${index === 0 ? "" : " hidden"} tabindex="0">
      <header class="panel-header"><h2>${escapeHtml(tab.label)}</h2><p>${escapeHtml(tab.summary)}</p></header>
      <div class="article-list">${primaryDocuments.map((document) => articleLink(document)).join("")}</div>
      ${relatedDocuments.length ? `<section class="related-articles" aria-label="Related primary articles"><h3>Related primary articles</h3>${relatedDocuments.map((document) => articleLink(document, { related: true, relationLabel: `${document.title} (${tabById.get(document.primaryTab).label})` })).join("")}</section>` : ""}
    </section>`;
  }).join("");
  const articles = orderedDocuments
    .map((document, index) => {
      const previous = orderedDocuments[index - 1];
      const next = orderedDocuments[index + 1];
      const related = document.relatedSources
        .map((source) => documentBySource.get(source))
        .filter(Boolean);
      return `<article id="${document.id}" data-document data-tab="${escapeHtml(document.primaryTab)}" data-related-tabs="${escapeHtml(document.relatedTabs.join("|"))}" data-category="${escapeHtml(document.category)}" data-search="${escapeHtml(`${document.title} ${document.category} ${document.file} ${document.summary} ${document.keywords.join(" ")} ${document.audience.join(" ")}`.toLowerCase())}" hidden>
        <header class="article-header"><div><span class="category">${escapeHtml(document.category)}</span><h1>${escapeHtml(document.title)}</h1><p>${escapeHtml(document.file)}</p></div><span class="source-hash" title="Source checksum">${document.hash}</span></header>
        <div class="article-disclosure-controls" data-article-disclosures aria-label="Article section controls"><button type="button" data-disclosure-action="expand">Expand all</button><button type="button" data-disclosure-action="collapse">Collapse all</button></div>
        <div class="article-body">${document.html}</div>
        <nav class="article-pagination" aria-label="Article navigation">${previous ? `<a href="${escapeHtml(routeHash({ tabId: previous.primaryTab, articleId: previous.id }))}" data-article-link data-previous-link data-tab="${escapeHtml(previous.primaryTab)}" data-article="${escapeHtml(previous.id)}" data-title="${escapeHtml(previous.title)}" data-summary="${escapeHtml(previous.summary)}" data-audience="${escapeHtml(previous.audience.join(", "))}" data-content-type="${escapeHtml(previous.contentType)}">Previous: ${escapeHtml(previous.title)}</a>` : ""}${next ? `<a href="${escapeHtml(routeHash({ tabId: next.primaryTab, articleId: next.id }))}" data-article-link data-next-link data-tab="${escapeHtml(next.primaryTab)}" data-article="${escapeHtml(next.id)}" data-title="${escapeHtml(next.title)}" data-summary="${escapeHtml(next.summary)}" data-audience="${escapeHtml(next.audience.join(", "))}" data-content-type="${escapeHtml(next.contentType)}">Next: ${escapeHtml(next.title)}</a>` : ""}</nav>
        ${related.length ? `<nav class="related-sources" aria-label="Related sources"><h2>Related sources</h2>${related.map((relatedDocument) => articleLink(relatedDocument, { related: true })).join("")}</nav>` : ""}
      </article>`;
    })
    .join("");

  return `<!doctype html>
<html lang="en" data-theme="light">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <link rel="icon" href="data:,">
  <title>Mwell Intra Standalone Operating Handbook</title>
  <style data-handbook-styles>
${styles}
  </style>
</head>
<body id="top">
  <header class="topbar">
    <div class="brand"><strong>mwell</strong><span>Intra handbook</span></div>
    <div class="search-wrap"><input id="search" type="search" placeholder="Search the complete handbook" aria-label="Search handbook" autocomplete="off"><div class="search-scope" role="group" aria-label="Search scope"><button type="button" data-search-scope="tab" aria-pressed="false">This tab</button><button type="button" data-search-scope="all" aria-pressed="true">All tabs</button></div></div>
    <div class="toolbar"><button class="drawer-trigger" type="button" data-open-drawer="contents" aria-controls="contents-rail" aria-expanded="false">Contents</button><button class="drawer-trigger" type="button" data-open-drawer="toc" aria-controls="page-toc" aria-expanded="false">On this page</button><button id="theme" type="button" aria-label="Toggle color theme">Theme</button><div class="print-control"><button type="button" data-print-trigger aria-controls="print-menu" aria-expanded="false">Print</button><div id="print-menu" class="print-menu" hidden><button type="button" data-print-scope="article">Current article</button><button type="button" data-print-scope="tab">Active tab</button><button type="button" data-print-scope="all">Complete handbook</button></div></div></div>
  </header>
  <div class="handbook-shell">
    <nav class="tab-rail" role="tablist" aria-label="Handbook sections">${HANDBOOK_TABS.map((tab, index) => `<button role="tab" id="tab-${tab.id}" aria-controls="panel-${tab.id}" aria-selected="${index === 0}" tabindex="${index === 0 ? 0 : -1}" type="button" data-tab-button data-tab="${tab.id}">${escapeHtml(tab.label)}</button>`).join("")}</nav>
    <aside id="contents-rail" class="contents-rail" aria-labelledby="contents-title"><div class="drawer-heading"><h2 id="contents-title">Contents</h2><button type="button" data-close-drawer="contents" aria-label="Close contents">Close</button></div><div class="summary"><strong>${documents.length}</strong>maintained source documents<div class="result-count" id="result-count" aria-live="polite">Choose an article to read</div></div><section class="search-results" id="search-results" aria-label="Search results" hidden></section>${panels}</aside>
    <main class="reading-canvas" tabindex="-1">
      <section class="route-notice" id="route-notice" role="status" hidden><span>This handbook link is no longer available. You are back at Start Here.</span><div><button type="button" data-recovery-search>Search</button><button type="button" data-dismiss-notice aria-label="Dismiss message">Dismiss</button></div></section>
      <section class="hero"><span class="category">Standalone operating handbook</span><h1>Mwell Intra</h1><p>One searchable, printable reference for users, trainers, developers, infrastructure teams, control owners, and release reviewers. It includes rendered process diagrams, application procedures, screenshots, governed reference extracts, technical specifications, and release controls.</p><div class="hero-meta"><span>${documents.length} maintained sources</span><span>Source-controlled release set</span><span>Self-contained HTML</span></div></section>
      <p class="empty" id="empty" hidden>No document matches this search and category.</p>
      ${articles}
    </main>
    <aside id="page-toc" class="page-toc" aria-labelledby="page-toc-title"><div class="drawer-heading"><h2 id="page-toc-title">On this page</h2><button type="button" data-close-drawer="toc" aria-label="Close table of contents">Close</button></div><nav data-page-toc aria-label="On this page"></nav></aside>
  </div>
  <script data-handbook-index>window.__HANDBOOK_INDEX__ = ${serializeForScript(searchIndex)}; window.__HANDBOOK_SEARCH_STATE__ = ${serializeForScript(initialSearchState)};</script>
  <script>${mermaidBundle}</script>
  <script data-handbook-runtime>
${runtime}
  </script>
</body>
</html>`;
}

export function writeDocumentationHtml({ check = false } = {}) {
  const html = buildDocumentationHtml();
  const absolute = path.join(root, outputFile);
  if (check) {
    if (!existsSync(absolute) || readFileSync(absolute, "utf8") !== html) {
      throw new Error(`Consolidated documentation is stale. Run pnpm docs:build and commit ${outputFile}.`);
    }
    console.log(`Consolidated documentation is current: ${outputFile}`);
    return;
  }
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, html);
  console.log(`Wrote ${outputFile} from ${documentationSources().length} source documents.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    writeDocumentationHtml({ check: process.argv.includes("--check") });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
