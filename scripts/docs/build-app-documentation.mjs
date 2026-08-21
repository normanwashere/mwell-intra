import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse as parseCsv } from "csv-parse/sync";
import { marked, Renderer } from "marked";

const root = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
export const outputFile = "docs/manual/index.html";

function normalize(file) {
  return file.replaceAll("\\", "/");
}

function markdownFiles(directory) {
  const absolute = path.join(root, directory);
  if (!existsSync(absolute)) return [];
  return readdirSync(absolute)
    .filter((name) => name.endsWith(".md"))
    .map((name) => normalize(path.join(directory, name)));
}

function filesWithExtension(directory, extension) {
  const absolute = path.join(root, directory);
  if (!existsSync(absolute)) return [];
  return readdirSync(absolute)
    .filter((name) => name.endsWith(extension))
    .map((name) => normalize(path.join(directory, name)));
}

export function documentationSources() {
  return [
    "docs/manual/MWELL_INTRA_USER_MANUAL.md",
    ...markdownFiles("docs"),
    ...markdownFiles("docs/policy"),
    ...markdownFiles("docs/runbooks"),
    ...markdownFiles("docs/releases"),
    ...markdownFiles("docs/import-templates"),
    ...filesWithExtension("docs/import-templates", ".csv"),
  ].filter((file, index, files) => files.indexOf(file) === index);
}

function categoryFor(file) {
  const name = normalize(file).toLowerCase();
  if (name.includes("/import-templates/")) return "Import templates";
  if (name.includes("/releases/")) return "Release notes";
  if (name.includes("/policy/") || name.includes("control_matrix")) return "Policy and controls";
  if (name.includes("/runbooks/") || /cutover|retention|issue_management/.test(name)) return "Operations and runbooks";
  if (/technical|erd|traceability/.test(name)) return "Engineering reference";
  if (/training|user_manual/.test(name)) return "Manuals and training";
  if (/ux-review|coverage-report|release-evidence/.test(name)) return "Review and evidence";
  return "Platform reference";
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
    `<pre class="${lang === "mermaid" ? "flow-source" : "code-block"}"${lang ? ` data-language="${escapeHtml(lang)}"` : ""}><code>${escapeHtml(text)}</code></pre>`;

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
  const sources = documentationSources();
  const sourceIds = new Map(sources.map((file) => [file, `doc-${slug(file.replace(/^docs\//, ""))}`]));
  const documents = sources.map((file) => {
    const source = readFileSync(path.join(root, file), "utf8");
    return {
      file,
      id: sourceIds.get(file),
      title: titleOf(source, file),
      category: categoryFor(file),
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
      (document, index) => `<article id="${document.id}" data-document data-category="${escapeHtml(document.category)}" data-search="${escapeHtml(`${document.title} ${document.category} ${document.file}`.toLowerCase())}">
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
  <title>Mwell Intra Complete Documentation</title>
  <style>
    :root{font-family:Inter,"Segoe UI",Arial,sans-serif;color:#17233b;background:#edf4fa;line-height:1.6;--ink:#17233b;--muted:#5c6d86;--surface:#fff;--soft:#eef5fb;--line:#cad9e8;--brand:#0875bd;--accent:#13a384;--warning:#bd6408;--shadow:0 8px 24px rgba(32,63,91,.09)}
    html[data-theme="dark"]{color:#e7f0fa;background:#071522;--ink:#e7f0fa;--muted:#a9bad0;--surface:#0f2236;--soft:#162c43;--line:#29435d;--brand:#46b8ff;--accent:#55d9b2;--warning:#ffb259;--shadow:none}
    *{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;color:var(--ink);background:inherit}a{color:var(--brand);text-underline-offset:3px}button,input,select{font:inherit}.topbar{position:sticky;top:0;z-index:20;display:flex;align-items:center;gap:12px;min-height:72px;padding:12px 20px;background:var(--surface);border-bottom:1px solid var(--line)}.brand{display:flex;align-items:baseline;gap:8px;white-space:nowrap}.brand strong{font-size:23px;color:var(--brand)}.brand span{font-weight:700}.search-wrap{display:flex;flex:1;gap:8px;max-width:840px;margin:auto}.search-wrap input,.search-wrap select{min-height:44px;border:1px solid var(--line);border-radius:6px;background:var(--soft);color:var(--ink);padding:9px 12px}.search-wrap input{flex:1}.toolbar{display:flex;gap:8px}.toolbar button,.menu-button,.sidebar-close{min-width:44px;min-height:44px;border:1px solid var(--line);border-radius:6px;background:var(--soft);color:var(--ink);cursor:pointer}.menu-button,.sidebar-close{display:none}.layout{display:grid;grid-template-columns:290px minmax(0,1fr);max-width:1600px;margin:auto}.sidebar{position:sticky;top:72px;height:calc(100vh - 72px);overflow:auto;padding:20px 16px;background:var(--surface);border-right:1px solid var(--line)}.summary{padding:14px;border-left:4px solid var(--accent);background:var(--soft);margin-bottom:18px}.summary strong{display:block;font-size:28px}.nav-group{margin:18px 0}.nav-group h2{margin:0 8px 7px;color:var(--muted);font-size:12px;text-transform:uppercase}.nav-group a{display:block;padding:8px;border-left:3px solid transparent;color:var(--ink);text-decoration:none}.nav-group a:hover,.nav-group a[aria-current="true"]{border-left-color:var(--brand);background:var(--soft);color:var(--brand)}main{min-width:0;padding:34px clamp(18px,4vw,64px) 80px}.hero{max-width:1050px;margin:0 auto 30px;padding:30px;border:1px solid var(--line);border-left:5px solid var(--brand);background:var(--surface);box-shadow:var(--shadow)}.hero h1{margin:0 0 8px;font-size:clamp(30px,4vw,48px);letter-spacing:0}.hero p{max-width:760px;color:var(--muted)}.hero-meta{display:flex;flex-wrap:wrap;gap:8px;margin-top:18px}.hero-meta span,.category{display:inline-flex;padding:4px 8px;border-radius:4px;background:var(--soft);color:var(--brand);font-size:12px;font-weight:700}article{max-width:1050px;margin:0 auto;scroll-margin-top:92px}.article-header{display:flex;justify-content:space-between;gap:18px;align-items:flex-start;margin-bottom:20px}.article-header h1{margin:7px 0 2px;font-size:clamp(27px,3vw,38px);letter-spacing:0}.article-header p{margin:0;color:var(--muted);overflow-wrap:anywhere}.source-hash{font:12px ui-monospace,monospace;color:var(--muted);overflow-wrap:anywhere}.article-body{min-width:0;padding:26px;background:var(--surface);border:1px solid var(--line);box-shadow:var(--shadow);overflow-wrap:anywhere}.article-body h2,.article-body h3,.article-body h4{letter-spacing:0;scroll-margin-top:92px}.article-body h2{margin-top:34px;padding-top:8px;border-top:1px solid var(--line)}.article-body table{display:block;width:100%;overflow:auto;border-collapse:collapse}.article-body th,.article-body td{padding:10px;border:1px solid var(--line);text-align:left;vertical-align:top}.article-body th{background:var(--soft)}.article-body blockquote{margin:18px 0;padding:12px 16px;border-left:4px solid var(--warning);background:var(--soft)}.article-body code{font-family:"Cascadia Code",Consolas,monospace}.article-body :not(pre)>code{padding:2px 5px;border-radius:3px;background:var(--soft);white-space:normal;overflow-wrap:anywhere}.article-body pre code{white-space:pre}pre{max-width:100%;overflow:auto;padding:16px;background:#071522;color:#e7f0fa;border-radius:4px}.flow-source{border-left:4px solid var(--accent)}.doc-image{margin:22px 0}.doc-image img{display:block;max-width:100%;height:auto;border:1px solid var(--line);background:var(--soft)}.doc-image figcaption{color:var(--muted);font-size:13px}.back-link{display:inline-block;margin-top:18px}.document-break{max-width:1050px;margin:56px auto;border:0;border-top:1px solid var(--line)}.empty{max-width:1050px;margin:auto;padding:30px;background:var(--surface);border:1px solid var(--line)}[hidden]{display:none!important}.result-count{color:var(--muted);font-size:13px}
    @media(max-width:900px){.topbar{flex-wrap:wrap;padding:10px 12px}.brand{flex:1}.menu-button{display:inline-block}.search-wrap{order:3;min-width:100%;max-width:none}.layout{display:block}.sidebar{position:fixed;z-index:30;inset:0 15% 0 0;height:auto;transform:translateX(-105%);transition:transform .2s ease;box-shadow:var(--shadow)}.sidebar[data-open="true"]{transform:none}.sidebar-close{display:block;width:100%;margin-bottom:12px}.topbar{top:0}.article-header{display:block}.source-hash{display:block;margin-top:7px}main{padding:24px 14px 80px}.hero,.article-body{padding:20px}.document-break{margin:42px auto}}
    @media(max-width:520px){.search-wrap{display:grid;grid-template-columns:1fr}.toolbar button{padding:0 10px}.brand span{display:none}.hero h1{font-size:30px}.article-header h1{font-size:27px}.article-body{padding:16px}}
    @media print{.topbar,.sidebar,.back-link{display:none!important}.layout{display:block}main{padding:0}.hero,article{max-width:none}.hero,.article-body{box-shadow:none}.document-break{break-before:page}.article-body{border:0;padding:0}a{color:inherit;text-decoration:none}}
  </style>
</head>
<body id="top">
  <header class="topbar">
    <button class="menu-button" id="menu" type="button" aria-label="Open contents" aria-expanded="false">Contents</button>
    <div class="brand"><strong>mwell</strong><span>Intra documentation</span></div>
    <div class="search-wrap"><input id="search" type="search" placeholder="Search every document" aria-label="Search documentation"><select id="category" aria-label="Filter by category"><option value="all">All sections</option>${categories.map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join("")}</select></div>
    <div class="toolbar"><button id="theme" type="button" aria-label="Toggle color theme">Theme</button><button type="button" onclick="window.print()" aria-label="Print documentation">Print</button></div>
  </header>
  <div class="layout">
    <aside class="sidebar" id="sidebar" aria-label="Documentation contents"><button class="sidebar-close" id="sidebar-close" type="button">Close contents</button><div class="summary"><strong>${documents.length}</strong>current source documents<div class="result-count" id="result-count">Showing all documents</div></div>${nav}</aside>
    <main>
      <section class="hero"><span class="category">Complete handbook</span><h1>Mwell Intra documentation</h1><p>One searchable, printable reference for users, trainers, developers, infrastructure teams, control owners, and release reviewers. Historical implementation plans and superseded audit working papers are intentionally excluded.</p><div class="hero-meta"><span>${documents.length} source documents</span><span>Source-controlled release set</span><span>Self-contained HTML</span></div></section>
      <p class="empty" id="empty" hidden>No document matches this search and category.</p>
      ${articles}
    </main>
  </div>
  <script>
    const search=document.querySelector('#search'),category=document.querySelector('#category'),articles=[...document.querySelectorAll('[data-document]')],links=[...document.querySelectorAll('[data-doc-link]')],groups=[...document.querySelectorAll('[data-nav-category]')],empty=document.querySelector('#empty'),count=document.querySelector('#result-count'),sidebar=document.querySelector('#sidebar'),menu=document.querySelector('#menu'),sidebarClose=document.querySelector('#sidebar-close');
    function filter(){const query=search.value.trim().toLowerCase(),selected=category.value;let visible=0;articles.forEach(article=>{const matchesCategory=selected==='all'||article.dataset.category===selected;const matchesText=!query||article.innerText.toLowerCase().includes(query)||article.dataset.search.includes(query);article.hidden=!(matchesCategory&&matchesText);const divider=article.nextElementSibling;if(divider?.classList.contains('document-break'))divider.hidden=article.hidden;if(!article.hidden)visible++});links.forEach(link=>{const article=document.getElementById(link.dataset.docLink);link.hidden=article?.hidden??true});groups.forEach(group=>{group.hidden=![...group.querySelectorAll('[data-doc-link]')].some(link=>!link.hidden)});empty.hidden=visible!==0;count.textContent=visible===articles.length?'Showing all documents':'Showing '+visible+' of '+articles.length}
    function closeSidebar(){sidebar.dataset.open='false';menu.setAttribute('aria-expanded','false');menu.focus()}
    search.addEventListener('input',filter);category.addEventListener('change',filter);menu.addEventListener('click',()=>{const open=sidebar.dataset.open!=='true';sidebar.dataset.open=String(open);menu.setAttribute('aria-expanded',String(open));if(open)sidebarClose.focus()});sidebarClose.addEventListener('click',closeSidebar);links.forEach(link=>link.addEventListener('click',()=>{sidebar.dataset.open='false';menu.setAttribute('aria-expanded','false')}));document.querySelector('#theme').addEventListener('click',()=>{const root=document.documentElement;root.dataset.theme=root.dataset.theme==='dark'?'light':'dark';localStorage.setItem('mwell-doc-theme',root.dataset.theme)});document.documentElement.dataset.theme=localStorage.getItem('mwell-doc-theme')||'light';document.addEventListener('keydown',event=>{if(event.key==='Escape'&&sidebar.dataset.open==='true'){closeSidebar();return}if(event.key==='/'&&!/input|textarea|select/i.test(document.activeElement.tagName)){event.preventDefault();search.focus()}});filter();
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
