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

function resolveDocumentLink(href, sourceFile, sourceIds) {
  if (/^(https?:|mailto:|#)/i.test(href)) return href;
  const [filePart, fragment] = href.split("#", 2);
  if (!filePart.toLowerCase().endsWith(".md")) return href;
  const target = normalize(path.relative(root, path.resolve(root, path.dirname(sourceFile), filePart)));
  const id = sourceIds.get(target);
  return id ? `#${id}${fragment ? `-${slug(fragment)}` : ""}` : href;
}

function renderMarkdown(markdown, sourceFile, sourceIds) {
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
    const target = resolveDocumentLink(href, sourceFile, sourceIds);
    const external = /^https?:/i.test(target);
    return `<a href="${escapeHtml(target)}"${title ? ` title="${escapeHtml(title)}"` : ""}${external ? ' target="_blank" rel="noreferrer"' : ""}>${this.parser.parseInline(tokens)}</a>`;
  };
  renderer.code = ({ text, lang }) =>
    lang === "mermaid"
      ? `<figure class="diagram-shell"><div class="diagram-toolbar" aria-label="Diagram zoom controls"><button type="button" data-diagram-zoom="out" aria-label="Zoom diagram out">−</button><button type="button" data-diagram-zoom="reset">Reset</button><button type="button" data-diagram-zoom="in" aria-label="Zoom diagram in">+</button></div><div class="diagram-viewport"><div class="mermaid">${escapeHtml(text)}</div></div><figcaption>Process flow. Decision branches are shown as labeled paths.</figcaption></figure>`
      : `<pre class="code-block"${lang ? ` data-language="${escapeHtml(lang)}"` : ""}><code>${escapeHtml(text)}</code></pre>`;

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

function renderSource(source, sourceFile, sourceIds) {
  return path.extname(sourceFile).toLowerCase() === ".csv"
    ? renderCsv(source)
    : renderMarkdown(source, sourceFile, sourceIds);
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
      html: renderSource(source, file, sourceIds),
      hash: createHash("sha256").update(source).digest("hex").slice(0, 12),
    };
  });
  const categories = [...new Set(documents.map((document) => document.category))];

  const nav = categories
    .map(
      (category) => `<section class="nav-group" data-nav-category="${escapeHtml(category)}"><h2>${escapeHtml(category)}</h2>${documents
        .filter((document) => document.category === category)
        .map(
          (document) =>
            `<a href="#${document.id}" data-doc-link="${document.id}">${escapeHtml(document.title)}</a>`,
        )
        .join("")}</section>`,
    )
    .join("");
  const articles = documents
    .map(
      (document, index) => `<article id="${document.id}" data-document data-category="${escapeHtml(document.category)}" data-search="${escapeHtml(`${document.title} ${document.category} ${document.file} ${document.summary} ${document.keywords.join(" ")} ${document.audience.join(" ")}`.toLowerCase())}">
        <header class="article-header"><div><span class="category">${escapeHtml(document.category)}</span><h1>${escapeHtml(document.title)}</h1><p>${escapeHtml(document.file)}</p></div><span class="source-hash" title="Source checksum">${document.hash}</span></header>
        <div class="article-body">${document.html}</div>
        <a class="back-link" href="#top">Back to contents</a>
      </article>${index < documents.length - 1 ? '<hr class="document-break">' : ""}`,
    )
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
    <button class="menu-button" id="menu" type="button" aria-label="Open contents" aria-expanded="false">Contents</button>
    <div class="brand"><strong>mwell</strong><span>Intra handbook</span></div>
    <div class="search-wrap"><input id="search" type="search" placeholder="Search the complete handbook" aria-label="Search handbook"><select id="category" aria-label="Filter by category"><option value="all">All sections</option>${categories.map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join("")}</select></div>
    <div class="toolbar"><button id="theme" type="button" aria-label="Toggle color theme">Theme</button><button type="button" onclick="window.print()" aria-label="Print documentation">Print</button></div>
  </header>
  <div class="layout">
    <aside class="sidebar" id="sidebar" aria-label="Documentation contents"><button class="sidebar-close" id="sidebar-close" type="button">Close contents</button><div class="summary"><strong>${documents.length}</strong>current source documents<div class="result-count" id="result-count">Showing all documents</div></div>${nav}</aside>
    <main>
      <section class="hero"><span class="category">Standalone operating handbook</span><h1>Mwell Intra</h1><p>One searchable, printable reference for users, trainers, developers, infrastructure teams, control owners, and release reviewers. It includes rendered process diagrams, application procedures, screenshots, governed reference extracts, technical specifications, and release controls.</p><div class="hero-meta"><span>${documents.length} maintained sources</span><span>Source-controlled release set</span><span>Self-contained HTML</span></div></section>
      <p class="empty" id="empty" hidden>No document matches this search and category.</p>
      ${articles}
    </main>
  </div>
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
