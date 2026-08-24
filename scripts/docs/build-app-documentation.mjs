import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse as parseCsv } from "csv-parse/sync";
import { marked, Renderer } from "marked";
import { resolveHandbookCatalog } from "./handbook-catalog.mjs";
import {
  HANDBOOK_GUIDES,
  HANDBOOK_MODES,
  LEGACY_ROUTES,
  validateHandbookGuides,
} from "./handbook-guides.mjs";

const root = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
export const outputFile = "docs/manual/index.html";
const mermaidBundleFile = path.join(root, "node_modules/mermaid/dist/mermaid.min.js");
const handbookStylesFile = path.join(root, "scripts/docs/handbook-styles.css");
const handbookRuntimeFile = path.join(root, "scripts/docs/handbook-runtime.js");
const MODE_TAB_ALIASES = Object.freeze({
  home: "start",
  tasks: "workflows",
  roles: "roles",
  system: "system",
});

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

function canonicalGuideHash({ modeId, guideId, headingId }) {
  const params = new URLSearchParams({ mode: modeId, guide: guideId });
  if (headingId) params.set("heading", headingId);
  return `#${params}`;
}

function compatibilityGuideHash({ modeId, guideId, headingId }) {
  return routeHash({
    tabId: MODE_TAB_ALIASES[modeId],
    articleId: modeId === "home" ? undefined : `guide-${guideId}`,
    headingId: headingId ? `${guideId}-${headingId}` : undefined,
  });
}

function resolveDocumentLink(href, sourceFile, sourceIds, sourceRoutes) {
  if (/^(https?:|mailto:|#)/i.test(href)) return href;
  const [filePart, fragment] = href.split("#", 2);
  if (!filePart.toLowerCase().endsWith(".md")) return href;
  const target = normalize(path.relative(root, path.resolve(root, path.dirname(sourceFile), filePart)));
  const id = sourceIds.get(target);
  const route = sourceRoutes.get(`${target}#${slug(fragment ?? "")}`) ?? sourceRoutes.get(target);
  return id && route
    ? canonicalGuideHash(route)
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

function markdownHeadingEntries(source) {
  return String(source).split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^(#{1,6})\s+(.+?)\s*$/);
    return match ? [{ depth: match[1].length, text: match[2] }] : [];
  });
}

function extractSourceFragment(sourceRecord, heading) {
  if (path.extname(sourceRecord.file).toLowerCase() === ".csv" || heading == null) {
    return sourceRecord.sourceText;
  }
  const lines = sourceRecord.sourceText.split("\n");
  const headings = lines.map((line, index) => {
    const match = line.match(/^(#{1,6})\s+(.+?)\s*$/);
    return match ? { index, depth: match[1].length, text: match[2] } : null;
  }).filter(Boolean);
  const selected = headings.find(({ text }) => text === heading);
  if (!selected) throw new Error(`Missing exact source heading ${heading} in ${sourceRecord.file}.`);
  const end = headings.find(({ index, depth }) => index > selected.index && depth <= selected.depth)?.index ?? lines.length;
  return lines.slice(selected.index, end).join("\n");
}

export function loadDocumentationSources(sourceFiles = documentationSources()) {
  const { documents: catalogDocuments, errors } = resolveHandbookCatalog(sourceFiles);
  if (errors.length) {
    throw new Error(`Handbook source registry validation failed:\n${errors.join("\n")}`);
  }
  const catalogBySource = new Map(catalogDocuments.map((document) => [document.source, document]));
  return sourceFiles.map((file) => {
    const sourceText = normalizeText(readFileSync(path.join(root, file), "utf8"));
    const catalog = catalogBySource.get(file);
    return {
      ...catalog,
      file,
      sourceText,
      title: titleOf(sourceText, file),
      legacyArticleId: `doc-${slug(file.replace(/^docs\//, ""))}`,
      hash: createHash("sha256").update(sourceText).digest("hex"),
    };
  });
}

export function resolveHandbookModel(sourceInput, options = {}) {
  const configured = Array.isArray(sourceInput)
    ? { ...options, sources: sourceInput }
    : { ...(sourceInput ?? {}) };
  const sources = configured.sources ?? loadDocumentationSources();
  const modes = configured.modes ?? HANDBOOK_MODES;
  const guides = configured.guides ?? HANDBOOK_GUIDES;
  const legacyRoutes = configured.legacyRoutes ?? LEGACY_ROUTES;
  const validation = validateHandbookGuides({
    modes,
    guides,
    legacyRoutes,
    documents: sources.map(({ source, id, primaryTab, relatedTabs, contentType, audience, summary, keywords, sortOrder, collapse, relatedSources }) => ({
      source,
      id,
      primaryTab,
      relatedTabs,
      contentType,
      audience,
      summary,
      keywords,
      sortOrder,
      collapse,
      relatedSources,
    })),
  });
  if (validation.errors.length) {
    throw new Error(`Handbook guide model validation failed:\n${validation.errors.join("\n")}`);
  }

  const sourceByFile = new Map(sources.map((source) => [source.file, source]));
  const guideById = new Map(guides.map((guide) => [guide.id, guide]));
  const sourceRoutes = new Map();
  for (const source of sources) {
    const articleRoute = legacyRoutes.find((route) =>
      route.legacyTabId === source.primaryTab &&
      route.legacyArticleId === source.legacyArticleId &&
      route.legacyHeadingId == null);
    if (articleRoute) sourceRoutes.set(source.file, articleRoute);
    for (const { text } of markdownHeadingEntries(source.sourceText)) {
      const legacyHeadingId = `${source.legacyArticleId}-${slug(text)}`;
      const headingRoute = legacyRoutes.find((route) =>
        route.legacyTabId === source.primaryTab &&
        route.legacyArticleId === source.legacyArticleId &&
        route.legacyHeadingId === legacyHeadingId);
      if (headingRoute) sourceRoutes.set(`${source.file}#${slug(text)}`, headingRoute);
    }
  }

  return { modes, guides, legacyRoutes, sources, sourceByFile, guideById, sourceRoutes };
}

export function composeHandbookGuides(model) {
  const sourceLibrary = model.guideById.get("source-references");
  const librarySectionByFile = new Map(
    sourceLibrary.sourceSections.map((sourceSection) => [sourceSection.source, sourceSection]),
  );
  return model.guides.map((guide) => {
    const ownsGovernedBodies = guide.id === "source-references";
    const sourceIds = new Map(model.sources.map((source) => [source.file, source.legacyArticleId]));
    const sourceReferences = guide.sourceSections.map((sourceSection) => {
      const source = model.sourceByFile.get(sourceSection.source);
      if (!source) throw new Error(`${guide.id} references unavailable source ${sourceSection.source}.`);
      const sourceText = extractSourceFragment(source, sourceSection.heading);
      const librarySection = librarySectionByFile.get(source.file);
      if (!librarySection) throw new Error(`${source.file} has no canonical System source-library section.`);
      const rootHeading = source.sourceText.match(/^#\s+(.+)$/m)?.[1]?.trim();
      const canonicalTargetId = sourceSection.heading && sourceSection.heading !== rootHeading
        ? `${source.legacyArticleId}-${slug(sourceSection.heading)}`
        : `source-references-${librarySection.id}`;
      const canonicalSourceHref = canonicalGuideHash({
        modeId: "system",
        guideId: "source-references",
        headingId: librarySection.id,
      });
      const rendered = ownsGovernedBodies
        ? renderSource(sourceText, source.file, sourceIds, model.sourceRoutes)
        : null;
      return {
        ...sourceSection,
        file: source.file,
        title: source.title,
        contentType: source.contentType,
        owner: guide.owner ?? "Mwell Intra Product and Operations",
        version: guide.applicableBuild ?? "Current source-controlled version",
        reviewDate: guide.lastReviewedDate ?? "Generated with the current handbook",
        releaseIdentity: guide.applicableBuild ?? "Current generated handbook",
        hash: source.hash,
        sourceText,
        canonicalTargetId,
        canonicalSourceHref,
        html: rendered == null ? null : decorateArticleHtml({
          id: source.legacyArticleId,
          collapse: "none",
        }, rendered),
      };
    });
    return { ...guide, sourceReferences };
  });
}

const CONTROLLED_SEARCH_TERMS = Object.freeze({
  "finance-readiness-evidence:Step:step-2": ["three-way match", "match purchase order receipt invoice"],
  "procurement-request-approval:Task:outcome": ["approve request", "RFQ", "request for quotation"],
  "stock-receiving-putaway:Task:outcome": ["receive stock", "receiving", "receipt"],
  "stock-receiving-putaway:Step:step-3": ["report damaged item", "damaged stock", "quarantine"],
  "platform_administrator:Troubleshooting:negative-and-recovery-scenario": ["reset password", "invalid login", "access denied", "password recovery", "sign in blocked"],
  "vendor-accreditation-renewal:Task:outcome": ["vendor renewal", "renew vendor"],
  "ecommerce-fulfillment-delivery:Task:outcome": ["pick and pack"],
  "returns-replacements-refunds-rma:Task:outcome": ["refund"],
  "event-stock-custody:Decision:decision-2": ["lost event stock", "damaged event stock"],
  "inventory-count-variance:Task:outcome": ["cycle count", "cycle count variance"],
  "department-doa-activation:Task:outcome": ["DOA", "delegation of authority"],
});

function guideSearchRecord({
  type,
  guide,
  headingId,
  title,
  heading,
  role = "",
  module = "",
  excerpt,
  whyMatched,
  keywords = [],
  searchText,
  audience = [],
  source = "",
}) {
  const modeId = guide.modeId;
  const tabId = MODE_TAB_ALIASES[modeId];
  const compactExcerpt = searchExcerpt(plainMarkdownText(excerpt));
  const controlledTerms = CONTROLLED_SEARCH_TERMS[`${guide.id}:${type}:${headingId}`] ?? [];
  return {
    type,
    modeId,
    guideId: guide.id,
    headingId,
    title,
    heading,
    role,
    module,
    excerpt: compactExcerpt,
    whyMatched,
    href: canonicalGuideHash({ modeId, guideId: guide.id, headingId }),
    keywords: [...keywords, ...controlledTerms],
    searchText: plainMarkdownText([searchText, controlledTerms].flat().join(" ")),
    tabId,
    tabIds: [tabId],
    articleId: `guide-${guide.id}`,
    summary: compactExcerpt,
    audience,
    source,
    text: compactExcerpt,
  };
}

export function buildGuideSearchIndex(guides) {
  const guideById = new Map(guides.map((guide) => [guide.id, guide]));
  const roleLabel = (id) => guideById.get(id)?.canonicalName ?? guideById.get(id)?.title ?? id;
  const records = [];

  for (const guide of guides.filter(({ type }) => type === "task")) {
    const roles = guide.participatingRoles.map(roleLabel);
    const sources = guide.governingSources.join(" ");
    records.push(guideSearchRecord({
      type: "Task",
      guide,
      headingId: "outcome",
      title: guide.title,
      heading: "Outcome",
      role: roles.join(", "),
      module: guide.module,
      excerpt: guide.outcome,
      whyMatched: "Task outcome, module, role, or keyword",
      keywords: guide.keywords,
      searchText: [guide.title, guide.outcome, guide.summary, guide.module, roles, guide.keywords, guide.startCondition].flat().join(" "),
      audience: roles,
      source: sources,
    }));
    for (const [index, stage] of guide.steps.entries()) {
      const stageRole = roleLabel(stage.performingRole);
      records.push(guideSearchRecord({
        type: "Step",
        guide,
        headingId: stage.id,
        title: guide.title,
        heading: `${index + 1}. ${stage.label}`,
        role: stageRole,
        module: stage.module,
        excerpt: `${stage.instruction} ${stage.expectedResult}`,
        whyMatched: "Procedure step, route, result, or evidence",
        keywords: guide.keywords,
        searchText: [stage.label, stage.instruction, stage.route, stage.expectedResult, stage.dataRead, stage.dataWritten, stage.evidenceRetained, stage.nextHandoff, guide.keywords].flat().join(" "),
        audience: [stageRole],
        source: sources,
      }));
    }
    for (const decision of guide.decisionPoints) {
      records.push(guideSearchRecord({
        type: "Decision",
        guide,
        headingId: decision.id,
        title: guide.title,
        heading: decision.question,
        role: roleLabel(decision.ownerRole),
        module: guide.module,
        excerpt: `${decision.question} ${decision.noBranch.outcome} ${decision.noBranch.recoveryAction}`,
        whyMatched: "Decision, denial, exception, or recovery",
        keywords: [...guide.keywords, "decision", "exception"],
        searchText: [
          decision.question,
          decision.yesBranch.label,
          decision.yesBranch.condition,
          decision.yesBranch.outcome,
          decision.noBranch.label,
          decision.noBranch.condition,
          decision.noBranch.outcome,
          decision.noBranch.recoveryAction,
          guide.keywords,
        ].flat().join(" "),
        audience: [roleLabel(decision.ownerRole)],
        source: sources,
      }));
    }
    records.push(guideSearchRecord({
      type: "Troubleshooting",
      guide,
      headingId: "decisions-and-exceptions",
      title: `${guide.title}: recover or escalate`,
      heading: "Recovery",
      role: roles.join(", "),
      module: guide.module,
      excerpt: guide.recovery,
      whyMatched: "Recovery and denial guidance",
      keywords: [...guide.keywords, "recovery", "denied", "blocked"],
      searchText: [guide.recovery, guide.denialChecks, guide.decisionLabels].flat().join(" "),
      audience: roles,
      source: sources,
    }));
  }

  for (const guide of guides.filter(({ type }) => type === "role")) {
    const modules = [...new Set(guide.workspaceMap.map(({ module }) => module))];
    records.push(guideSearchRecord({
      type: "Role",
      guide,
      headingId: "role-purpose-and-department",
      title: guide.canonicalName,
      heading: "Role purpose and department",
      role: guide.canonicalName,
      module: modules.join(", "),
      excerpt: guide.purpose,
      whyMatched: "Role name, alias, module, or permitted work",
      keywords: guide.keywords,
      searchText: [guide.canonicalName, guide.displayedAliases, guide.purpose, guide.departmentAndScope, modules, guide.permittedActions, guide.linkedTasks].flat().join(" "),
      audience: [guide.canonicalName, ...guide.displayedAliases],
      source: guide.governingSources.join(" "),
    }));
    records.push(guideSearchRecord({
      type: "Troubleshooting",
      guide,
      headingId: "negative-and-recovery-scenario",
      title: `${guide.canonicalName}: denied or blocked work`,
      heading: "Negative and recovery scenario",
      role: guide.canonicalName,
      module: modules.join(", "),
      excerpt: `${guide.guidedSimulation.negativeScenario} ${guide.guidedSimulation.recovery}`,
      whyMatched: "Role denial and recovery guidance",
      keywords: [...guide.keywords, "denied", "recovery"],
      searchText: [guide.denialChecks, guide.escalationAndRecovery, guide.guidedSimulation.negativeScenario, guide.guidedSimulation.recovery].flat().join(" "),
      audience: [guide.canonicalName],
      source: guide.governingSources.join(" "),
    }));
  }

  for (const guide of guides.filter(({ type }) => type === "system")) {
    records.push(guideSearchRecord({
      type: "System reference",
      guide,
      headingId: "overview",
      title: guide.title,
      heading: "Overview",
      excerpt: guide.summary,
      whyMatched: "System responsibility, audience, or keyword",
      keywords: guide.keywords,
      searchText: [guide.title, guide.summary, guide.audience, guide.keywords].flat().join(" "),
      audience: guide.audience,
      source: guide.governingSources.join(" "),
    }));
    for (const reference of guide.id === "source-references" ? guide.sourceReferences : []) {
      records.push(guideSearchRecord({
        type: "System reference",
        guide,
        headingId: reference.id,
        title: reference.heading ?? reference.title,
        heading: guide.title,
        excerpt: reference.sourceText,
        whyMatched: "Governed source title or content",
        keywords: guide.keywords,
        searchText: [reference.title, reference.heading, reference.sourceText, guide.keywords].flat().join(" "),
        audience: guide.audience,
        source: reference.file,
      }));
    }
  }
  return records;
}

function renderItems(items, emptyMessage = "None recorded.") {
  return items?.length
    ? `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
    : `<p>${escapeHtml(emptyMessage)}</p>`;
}

function guideLink(guide, { label = guide.title, summary = guide.summary, headingId, related = false } = {}) {
  const tabId = MODE_TAB_ALIASES[guide.modeId];
  return `<a href="${escapeHtml(canonicalGuideHash({ modeId: guide.modeId, guideId: guide.id, headingId }))}" data-guide-link data-article-link${related ? " data-related-link" : ""} data-mode="${escapeHtml(guide.modeId)}" data-guide-id="${escapeHtml(guide.id)}" data-tab="${escapeHtml(tabId)}" data-article="guide-${escapeHtml(guide.id)}"${headingId ? ` data-heading="${escapeHtml(`${guide.id}-${headingId}`)}"` : ""} data-title="${escapeHtml(guide.title)}" data-summary="${escapeHtml(guide.summary)}" data-audience="${escapeHtml((guide.audience ?? guide.participatingRoles ?? []).join(", "))}" data-content-type="${escapeHtml(guide.type)}"><span>${escapeHtml(label)}</span>${summary ? `<small>${escapeHtml(summary)}</small>` : ""}</a>`;
}

function canonicalSourceLink(reference) {
  return `<a href="${escapeHtml(reference.canonicalSourceHref)}" data-canonical-source-link data-article-link data-mode="system" data-guide-id="source-references" data-tab="system" data-article="guide-source-references" data-heading="${escapeHtml(reference.canonicalTargetId)}">Open governed source in the System library</a>`;
}

function sourceReferenceBody(guide, reference) {
  return `<details id="${escapeHtml(`${guide.id}-${reference.id}`)}" class="source-reference" data-source-reference="${escapeHtml(reference.id)}" data-source-body data-source-file="${escapeHtml(reference.file)}" data-section-id="${escapeHtml(`${guide.id}:source:${reference.id}`)}"><summary id="${escapeHtml(`${guide.id}-${reference.id}-summary`)}"><span>${escapeHtml(reference.heading ?? reference.title)}</span><small>${escapeHtml(reference.file)}</small></summary><div class="source-reference-content">${reference.html}</div></details>`;
}

function sourceReferenceLink(guide, reference) {
  return `<section id="${escapeHtml(`${guide.id}-${reference.id}`)}" class="source-reference-link" data-source-reference="${escapeHtml(reference.id)}" data-source-file="${escapeHtml(reference.file)}"><h3>${escapeHtml(reference.heading ?? reference.title)}</h3><p><code>${escapeHtml(reference.file)}</code></p>${canonicalSourceLink(reference)}</section>`;
}

function sourceControlRows(guide, references, { addressable = false } = {}) {
  return references.map((reference) => `<section${addressable ? ` id="${escapeHtml(`${guide.id}-${reference.id}`)}"` : ""} class="source-control" data-source-control="${escapeHtml(`${guide.id}:${reference.id}`)}"><h3>${escapeHtml(reference.heading ?? reference.title)}</h3><dl><dt>Source filename</dt><dd>${escapeHtml(reference.file)}</dd><dt>Owner</dt><dd>${escapeHtml(reference.owner)}</dd><dt>Version</dt><dd>${escapeHtml(reference.version)}</dd><dt>Source checksum</dt><dd><code>${escapeHtml(reference.hash)}</code></dd><dt>Release identity</dt><dd>${escapeHtml(reference.releaseIdentity)}</dd><dt>Review date</dt><dd>${escapeHtml(reference.reviewDate)}</dd></dl>${canonicalSourceLink(reference)}</section>`).join("");
}

function documentControls(guide, references, { sectionId = "document-controls", label = "Document controls", addressableReferences = true } = {}) {
  return `<details class="guide-support document-controls" data-guide-section="${escapeHtml(sectionId)}" data-section-id="${escapeHtml(`${guide.id}:${sectionId}`)}"><summary id="${escapeHtml(`${guide.id}-${sectionId}`)}"><span role="heading" aria-level="2">${escapeHtml(label)}</span></summary><div class="guide-support-content">${sourceControlRows(guide, references, { addressable: addressableReferences })}</div></details>`;
}

function guideSection(guide, id, label, content, attributes = "") {
  return `<section id="${escapeHtml(`${guide.id}-${id}`)}" data-guide-section="${escapeHtml(id)}"${attributes}><h2>${escapeHtml(label)}</h2>${content}</section>`;
}

function mermaidLabel(value) {
  return String(value).replace(/[\[\]{}"\n]/g, " ").replace(/\s+/g, " ").trim();
}

function decisionTargetNode(target, stageNodes, decisionNodes) {
  if (target.type === "stage") return stageNodes.get(target.id);
  if (target.type === "decision") return decisionNodes.get(target.id);
  return `O_${target.id.replace(/[^a-z0-9]+/gi, "_").toUpperCase()}`;
}

function taskFlow(guide) {
  const lines = ["flowchart TD", `START([${mermaidLabel(guide.startCondition)}])`];
  const stageNodes = new Map(guide.steps.map((stage, index) => [stage.id, `S${index + 1}`]));
  const decisionNodes = new Map(guide.decisionPoints.map((decision, index) => [decision.id, `D${index + 1}`]));
  const decisionIdsWithInboundBranches = new Set(
    guide.decisionPoints.flatMap((decision) => [decision.yesBranch, decision.noBranch])
      .filter(({ target }) => target.type === "decision")
      .map(({ target }) => target.id),
  );
  const decisionsAt = (position, stageId) => guide.decisionPoints.filter((decision) =>
    decision.placement.position === position &&
    decision.placement.stageId === stageId &&
    !decisionIdsWithInboundBranches.has(decision.id));
  const outcomes = new Set();

  guide.steps.forEach((stage, index) => lines.push(`S${index + 1}["${index + 1}. ${mermaidLabel(stage.label)}"]`));
  guide.decisionPoints.forEach((decision, index) => lines.push(`D${index + 1}{"${mermaidLabel(decision.question)}"}`));

  const firstStage = guide.steps[0];
  if (firstStage) {
    const beforeFirst = decisionsAt("before", firstStage.id);
    lines.push(`START --> ${beforeFirst.length ? decisionNodes.get(beforeFirst[0].id) : stageNodes.get(firstStage.id)}`);
  }
  for (const [index, stage] of guide.steps.entries()) {
    const stageNode = stageNodes.get(stage.id);
    const after = decisionsAt("after", stage.id);
    if (after.length) {
      for (const decision of after) lines.push(`${stageNode} --> ${decisionNodes.get(decision.id)}`);
    } else if (index + 1 < guide.steps.length) {
      const nextStage = guide.steps[index + 1];
      const beforeNext = decisionsAt("before", nextStage.id);
      lines.push(`${stageNode} --> ${beforeNext.length ? decisionNodes.get(beforeNext[0].id) : stageNodes.get(nextStage.id)}`);
    } else {
      outcomes.add("completion");
      lines.push(`${stageNode} --> O_COMPLETION`);
    }
  }
  for (const decision of guide.decisionPoints) {
    for (const branch of [decision.yesBranch, decision.noBranch]) {
      if (branch.target.type === "outcome") outcomes.add(branch.target.id);
      lines.push(`${decisionNodes.get(decision.id)} -->|${mermaidLabel(branch.label)}| ${decisionTargetNode(branch.target, stageNodes, decisionNodes)}`);
    }
  }
  for (const outcome of outcomes) {
    const label = outcome.replaceAll("-", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
    lines.push(`O_${outcome.replace(/[^a-z0-9]+/gi, "_").toUpperCase()}([${label}])`);
  }
  const source = lines.join("\n");
  const stages = guide.steps.map(({ label }) => label).join("|");
  const textEquivalent = `<div class="flow-text-equivalent"><h3>Flow text equivalent</h3><ol>${guide.steps.map((stage, index) => `<li>${index + 1}. ${escapeHtml(stage.label)} by ${escapeHtml(stage.performingRole)}.${guide.decisionPoints.filter(({ placement }) => placement.stageId === stage.id).map((decision) => ` Decision: ${decision.question}`).join("")}</li>`).join("")}</ol><p><strong>Branches:</strong> ${escapeHtml(guide.decisionPoints.flatMap((decision) => [decision.yesBranch, decision.noBranch]).map((branch) => `${branch.label}: ${branch.outcome}`).join(" "))}</p></div>`;
  return `<figure class="diagram-shell" data-diagram-id="${escapeHtml(`${guide.id}:flow:overview`)}" data-flow-workflow="${escapeHtml(guide.id)}" data-flow-view="overview" data-flow-stages="${escapeHtml(stages)}"><div class="diagram-toolbar" aria-label="Diagram zoom controls"><button type="button" data-diagram-fit aria-label="Fit diagram to available space">Fit</button><button type="button" data-diagram-zoom="reset" aria-label="Show diagram at 100 percent">100%</button><button type="button" data-diagram-zoom="out" aria-label="Zoom diagram out">−</button><button type="button" data-diagram-zoom="in" aria-label="Zoom diagram in">+</button></div><div class="diagram-viewport" data-diagram-viewport role="region" tabindex="0" aria-label="Task flow diagram"><div class="diagram-canvas"><div class="mermaid">${escapeHtml(source)}</div></div></div><figcaption>Complete task flow with decision and terminal outcomes.</figcaption></figure>${textEquivalent}`;
}

function decisionDestination(guide, decisionById, branch) {
  if (branch.target.type === "stage") {
    const index = guide.steps.findIndex(({ id }) => id === branch.target.id);
    return `Resume at Step ${index + 1}: ${guide.steps[index].label}.`;
  }
  if (branch.target.type === "decision") {
    return `Continue to decision: ${decisionById.get(branch.target.id).question}`;
  }
  return `Terminal ${branch.target.id.replaceAll("-", " ")} outcome.`;
}

function decisionRecords(guide, roleName) {
  const decisionById = new Map(guide.decisionPoints.map((decision) => [decision.id, decision]));
  return guide.decisionPoints.map((decision) => {
    const stageIndex = guide.steps.findIndex(({ id }) => id === decision.placement.stageId);
    const branchRecord = (branch, failed) => `<section class="decision-branch" data-decision-branch="${failed ? "no" : "yes"}"><h4>${escapeHtml(branch.label)} branch</h4><dl><dt>${failed ? "Failed condition" : "Branch condition"}</dt><dd>${escapeHtml(branch.condition)}</dd><dt>Outcome</dt><dd>${escapeHtml(branch.outcome)}</dd><dt>Recovery action</dt><dd>${escapeHtml(branch.recoveryAction)}</dd><dt>Destination</dt><dd>${escapeHtml(decisionDestination(guide, decisionById, branch))}</dd><dt>Semantics</dt><dd>${branch.terminal ? "Terminal outcome; this task instance does not resume." : "Recovery or continuation; resume at the named destination."}</dd></dl></section>`;
    return `<section id="${escapeHtml(`${guide.id}-${decision.id}`)}" class="decision-record" data-task-decision="${escapeHtml(decision.id)}"><h3>${escapeHtml(decision.question)}</h3><p><strong>Placement:</strong> ${escapeHtml(`${decision.placement.position === "before" ? "Before" : "After"} Step ${stageIndex + 1}: ${guide.steps[stageIndex].label}`)}</p><p><strong>Owner:</strong> ${escapeHtml(roleName(decision.ownerRole))}</p>${branchRecord(decision.yesBranch, false)}${branchRecord(decision.noBranch, true)}</section>`;
  }).join("");
}

function taskArticle(guide, guideById) {
  const roleName = (id) => guideById.get(id)?.canonicalName ?? guideById.get(id)?.title ?? id;
  const policyReferences = guide.sourceReferences.filter(({ purpose }) => purpose === "policy-basis");
  const supportReferences = guide.sourceReferences.filter(({ purpose }) => purpose !== "policy-basis");
  const involved = guide.participatingRoles.map((id) => {
    const role = guideById.get(id);
    return role ? `<li>${guideLink(role, { label: roleName(id), summary: "" })}</li>` : `<li>${escapeHtml(roleName(id))}</li>`;
  }).join("");
  const prerequisites = `<h3>Required access</h3>${renderItems(guide.requiredAccess)}<h3>Inputs and evidence</h3>${renderItems(guide.inputsAndEvidence)}<h3>Start condition</h3><p>${escapeHtml(guide.startCondition)}</p>`;
  const stages = `<ol class="task-stages">${guide.steps.map((stage, index) => `<li id="${escapeHtml(`${guide.id}-${stage.id}`)}" data-task-stage="${escapeHtml(stage.id)}"><header><span>Step ${index + 1}</span><h3>${escapeHtml(stage.label)}</h3><p>${escapeHtml(roleName(stage.performingRole))} | ${escapeHtml(stage.module)} | <code>${escapeHtml(stage.route)}</code></p></header><p>${escapeHtml(stage.instruction)}</p><aside class="screen-evidence-pending" data-screen-evidence="pending" data-screenshot-binding="${escapeHtml(stage.screenshot.bindingId)}" role="status"><strong>Screen evidence pending review</strong><p>The procedure remains usable while the stage-specific application evidence is reviewed.</p></aside><dl><dt>Expected visible result</dt><dd>${escapeHtml(stage.expectedResult)}</dd><dt>Data read</dt><dd>${escapeHtml(stage.dataRead.join("; "))}</dd><dt>Data written</dt><dd>${escapeHtml(stage.dataWritten.join("; "))}</dd><dt>Evidence retained</dt><dd>${escapeHtml(stage.evidenceRetained.join("; "))}</dd><dt>Next handoff</dt><dd>${escapeHtml(roleName(stage.nextHandoff))}</dd></dl></li>`).join("")}</ol>`;
  const decisions = `${decisionRecords(guide, roleName)}<h3>Denial checks</h3>${renderItems(guide.denialChecks)}<h3>Shared recovery control</h3><p>${escapeHtml(guide.recovery)}</p><h3>Task handoff</h3><p>${escapeHtml(guide.handoff)}</p>`;
  const completion = `<h3>Observable application state</h3>${renderItems(guide.completionCriteria)}<h3>Retained evidence</h3>${renderItems(guide.completionEvidence)}<h3>Downstream owner and unfinished states</h3><p>${escapeHtml(guide.handoff)}</p>${renderItems(guide.denialChecks)}`;
  const related = guide.relatedTasks.map((id) => guideById.get(id)).filter(Boolean);
  const policy = `<details class="guide-support policy-basis" data-guide-section="policy-basis" data-section-id="${escapeHtml(`${guide.id}:policy-basis`)}"><summary id="${escapeHtml(`${guide.id}-policy-basis`)}"><span role="heading" aria-level="2">Why this rule exists</span></summary><div class="guide-support-content">${policyReferences.length ? sourceControlRows(guide, policyReferences, { addressable: true }) : "<p>No separate policy extract is mapped to this guide.</p>"}</div></details>`;
  return `<article id="guide-${escapeHtml(guide.id)}" data-guide data-document data-guide-id="${escapeHtml(guide.id)}" data-guide-type="task" data-mode="tasks" data-tab="workflows" data-related-tabs="" data-category="Tasks" data-search="${escapeHtml([guide.title, guide.summary, guide.keywords].flat().join(" ").toLowerCase())}" hidden><header class="article-header"><div><span class="category">Task</span><h1>${escapeHtml(guide.title)}</h1><p>${escapeHtml(guide.summary)}</p></div></header><div class="article-body">${guideSection(guide, "outcome", "Outcome", `<p>${escapeHtml(guide.outcome)}</p>`)}${guideSection(guide, "flow", "Flow", taskFlow(guide))}${guideSection(guide, "who-is-involved", "Who is involved", `<ul>${involved}</ul><p><strong>Accountable closer:</strong> ${escapeHtml(roleName(guide.steps.at(-1)?.performingRole ?? guide.participatingRoles.at(-1)))}</p>`)}${guideSection(guide, "before-you-start", "Before you start", prerequisites)}${guideSection(guide, "steps", "Steps", stages)}${guideSection(guide, "decisions-and-exceptions", "Decisions and exceptions", decisions)}${guideSection(guide, "completion-checklist", "Completion checklist", completion)}${guideSection(guide, "related-tasks", "Related tasks", related.length ? `<div class="article-list">${related.map((item) => guideLink(item, { related: true })).join("")}</div>` : "<p>No direct continuation or recovery guide.</p>")}${policy}${documentControls(guide, supportReferences)}</div></article>`;
}

function roleArticle(guide, guideById) {
  const linkedTasks = guide.linkedTasks.map((id) => guideById.get(id)).filter(Boolean);
  const workspace = `<table><thead><tr><th scope="col">Module</th><th scope="col">Landing route</th></tr></thead><tbody>${guide.workspaceMap.map(({ module, landingRoute }) => `<tr><td>${escapeHtml(module)}</td><td><code>${escapeHtml(landingRoute)}</code></td></tr>`).join("")}</tbody></table>`;
  const simulationTask = guideById.get(guide.guidedSimulation.linkedTaskId);
  const simulation = `<h3>${escapeHtml(guide.guidedSimulation.title)}</h3><p>${escapeHtml(guide.guidedSimulation.scenario)}</p><p><strong>Start route:</strong> <code>${escapeHtml(guide.guidedSimulation.startRoute)}</code></p>${simulationTask ? guideLink(simulationTask, { label: `Open task: ${simulationTask.title}`, summary: "" }) : ""}<h3>Success criteria</h3>${renderItems(guide.guidedSimulation.successCriteria)}`;
  const recovery = `<h3>Negative case</h3><p>${escapeHtml(guide.guidedSimulation.negativeScenario)}</p><h3>Recovery</h3><p>${escapeHtml(guide.guidedSimulation.recovery)}</p><h3>Denial checks</h3>${renderItems(guide.denialChecks)}`;
  return `<article id="guide-${escapeHtml(guide.id)}" data-guide data-document data-guide-id="${escapeHtml(guide.id)}" data-guide-type="role" data-mode="roles" data-tab="roles" data-related-tabs="" data-category="Roles" data-search="${escapeHtml([guide.title, guide.summary, guide.keywords].flat().join(" ").toLowerCase())}" hidden><header class="article-header"><div><span class="category">Role</span><h1>${escapeHtml(guide.canonicalName)}</h1><p>${escapeHtml(guide.summary)}</p></div></header><div class="article-body">${guideSection(guide, "role-purpose-and-department", "Role purpose and department", `<p>${escapeHtml(guide.purpose)}</p><p><strong>Department and scope:</strong> ${escapeHtml(guide.departmentAndScope)}</p><p><strong>Assignment owner:</strong> ${escapeHtml(guide.assignmentOwner)}</p>`)}${guideSection(guide, "your-workspace", "Your workspace", `${workspace}<h3>Required access</h3>${renderItems(guide.requiredAccess)}`)}${guideSection(guide, "work-queue-and-priorities", "Work queue and priorities", renderItems(guide.workQueueOrStartConditions))}${guideSection(guide, "permitted-actions", "Permitted actions", renderItems(guide.permittedActions))}${guideSection(guide, "decisions-and-approval-authority", "Decisions and approval authority", renderItems(guide.authorityLimits))}${guideSection(guide, "prohibited-actions", "Prohibited actions", renderItems(guide.prohibitedActions))}${guideSection(guide, "handoffs-received-and-sent", "Handoffs received and sent", renderItems(guide.handoffs))}${guideSection(guide, "guided-simulation", "Guided simulation", simulation)}${guideSection(guide, "negative-and-recovery-scenario", "Negative and recovery scenario", recovery)}${guideSection(guide, "escalation-and-support", "Escalation and support", `<p>${escapeHtml(guide.escalationAndRecovery)}</p>`)}${guideSection(guide, "completion-evidence-and-training-sign-off", "Completion evidence and training sign-off", `<h3>Evidence responsibilities</h3>${renderItems(guide.evidenceResponsibilities)}<h3>Training sign-off</h3>${renderItems(guide.trainingReadiness)}<h3>Related tasks</h3><div class="article-list">${linkedTasks.map((task) => guideLink(task)).join("")}</div>`)}${documentControls(guide, guide.sourceReferences, { sectionId: "capability-codes-and-document-controls", label: "Capability codes and document controls" })}</div></article>`;
}

function systemArticle(guide) {
  const ownsGovernedBodies = guide.id === "source-references";
  const references = guide.sourceReferences.map((reference) => ownsGovernedBodies
    ? sourceReferenceBody(guide, reference)
    : sourceReferenceLink(guide, reference)).join("");
  return `<article id="guide-${escapeHtml(guide.id)}" data-guide data-document data-guide-id="${escapeHtml(guide.id)}" data-guide-type="system" data-mode="system" data-tab="system" data-related-tabs="" data-category="System" data-search="${escapeHtml([guide.title, guide.summary, guide.keywords].flat().join(" ").toLowerCase())}" hidden><header class="article-header"><div><span class="category">System</span><h1>${escapeHtml(guide.title)}</h1><p>${escapeHtml(guide.summary)}</p></div></header><div class="article-body">${guideSection(guide, "overview", "Overview", `<p>${escapeHtml(guide.summary)}</p><p><strong>Audience:</strong> ${escapeHtml(guide.audience.join(", "))}</p>`)}${guideSection(guide, "source-references", "Source references", references || "<p>No governed reference is mapped.</p>")}${documentControls(guide, guide.sourceReferences, { addressableReferences: false })}</div></article>`;
}

function homeGuide(guide, guides, guideById) {
  const frequentIds = [
    "procurement-request-approval",
    "vendor-accreditation-renewal",
    "stock-receiving-putaway",
    "ecommerce-fulfillment-delivery",
    "returns-replacements-refunds-rma",
    "inventory-count-variance",
  ];
  const frequentTasks = frequentIds.map((id) => guideById.get(id)).filter(Boolean);
  const roles = guides.filter(({ type }) => type === "role");
  const systemGuides = guides.filter(({ type }) => type === "system");
  return `<section class="hero home-guide" data-guide data-guide-id="home" data-guide-type="home" data-mode="home"><span class="category">Mwell Intra handbook</span><h1>What do you need to do?</h1><section id="home-start-a-task" data-home-section="start-a-task"><h2>Start a task</h2><div class="article-list frequent-tasks">${frequentTasks.map((task) => guideLink(task)).join("")}</div></section><section id="home-learn-my-role" data-home-section="learn-my-role"><h2>Learn my role</h2><label for="role-entry">Choose your role</label><select id="role-entry" data-role-entry><option value="">Select a role</option>${roles.map((role) => `<option value="${escapeHtml(role.id)}">${escapeHtml(role.canonicalName)}</option>`).join("")}</select><button type="button" data-open-role>Open role</button><div class="article-list role-entry-links">${roles.map((role) => guideLink(role, { summary: "" })).join("")}</div></section><section id="home-manage-support" data-home-section="manage-support"><h2>Manage or support Mwell Intra</h2><div class="article-list">${systemGuides.map((item) => guideLink(item)).join("")}</div></section><section id="home-recent-guides" data-home-section="recent-guides"><h2>Recent guides</h2><ol data-recent-guides><li>No recent guides yet.</li></ol></section>${documentControls(guide, guide.sourceReferences)}</section>`;
}

function modePanel(mode, guides) {
  const tabId = MODE_TAB_ALIASES[mode.id];
  const modeGuides = guides.filter((guide) => guide.modeId === mode.id && guide.type !== "home");
  return `<section id="mode-panel-${escapeHtml(mode.id)}" class="mode-panel-shell"><div role="tabpanel" id="panel-${escapeHtml(tabId)}" aria-labelledby="mode-${escapeHtml(mode.id)}" data-mode-panel data-mode="${escapeHtml(mode.id)}" data-tab-panel${mode.id === "home" ? "" : " hidden"} tabindex="0"><header class="panel-header"><h2>${escapeHtml(mode.label)}</h2><p>${escapeHtml(mode.summary)}</p></header>${modeGuides.length ? `<div class="article-list">${modeGuides.map((guide) => guideLink(guide)).join("")}</div>` : "<p>Choose an outcome, role, or system responsibility from Home.</p>"}</div></section>`;
}

export function renderHandbookShell({ model, guides, searchIndex, styles, runtime, mermaidBundle }) {
  const guideById = new Map(guides.map((guide) => [guide.id, guide]));
  const home = guideById.get("home");
  const articles = guides.filter(({ type }) => type !== "home").map((guide) =>
    guide.type === "task" ? taskArticle(guide, guideById)
      : guide.type === "role" ? roleArticle(guide, guideById)
        : systemArticle(guide)).join("\n");
  const initialSearchState = { query: "", scope: "all" };
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
    <div class="search-wrap"><input id="search" type="search" placeholder="What do you need help with?" aria-label="What do you need help with?" autocomplete="off"><div class="search-scope" role="group" aria-label="Search scope"><button type="button" data-search-scope="tab" aria-pressed="false">This mode</button><button type="button" data-search-scope="all" aria-pressed="true">All guides</button></div></div>
    <div class="toolbar"><span data-current-mode>Home</span><button class="drawer-trigger" type="button" data-open-drawer="contents" aria-controls="contents-rail" aria-expanded="false">Contents</button><button class="drawer-trigger" type="button" data-open-drawer="toc" aria-controls="page-toc" aria-expanded="false">On this page</button><button id="theme" type="button" aria-label="Toggle color theme">Theme</button><div class="print-control"><button type="button" data-print-trigger aria-controls="print-menu" aria-expanded="false" aria-haspopup="dialog">Print</button><div id="print-menu" class="print-menu" role="dialog" aria-label="Print options" tabindex="-1" hidden><button type="button" data-print-scope="guide">Current guide</button><button type="button" data-print-scope="mode">Current mode</button><button type="button" data-print-scope="all">Complete handbook</button></div></div></div>
  </header>
  <div class="handbook-shell">
    <nav class="tab-rail" role="tablist" aria-label="Handbook modes">${model.modes.map((mode, index) => `<button role="tab" id="mode-${escapeHtml(mode.id)}" aria-controls="panel-${escapeHtml(MODE_TAB_ALIASES[mode.id])}" aria-selected="${index === 0}" tabindex="${index === 0 ? 0 : -1}" type="button" data-mode-button data-mode="${escapeHtml(mode.id)}" data-tab-button data-tab="${escapeHtml(MODE_TAB_ALIASES[mode.id])}">${escapeHtml(mode.label)}</button>`).join("")}</nav>
    <aside id="contents-rail" class="contents-rail" aria-labelledby="contents-title"><div class="drawer-heading"><h2 id="contents-title">Contents</h2><button type="button" data-close-drawer="contents" aria-label="Close contents">Close</button></div><div class="summary"><strong>Find a guide</strong><div class="result-count" id="result-count" aria-live="polite">Choose a task, role, or system guide</div></div><section class="search-results" id="search-results" aria-label="Search results" hidden></section><section class="empty" id="empty" aria-labelledby="empty-title" hidden><h2 id="empty-title">No direct answer found</h2><p role="status" aria-live="polite">Try a related term or start from a frequent task.</p><div class="article-list" aria-label="Controlled search suggestions"><a href="#mode=home&amp;guide=home&amp;q=receive+stock&amp;scope=all" data-route-link data-search-suggestion="receive stock"><span>Receive stock</span><small>Frequent task</small></a><a href="#mode=home&amp;guide=home&amp;q=approve+request&amp;scope=all" data-route-link data-search-suggestion="approve request"><span>Approve a request</span><small>Frequent task</small></a><a href="#mode=home&amp;guide=home&amp;q=cycle+count&amp;scope=all" data-route-link data-search-suggestion="cycle count"><span>Cycle count</span><small>Frequent task</small></a></div><div class="article-list" aria-label="Other handbook paths"><a href="#mode=roles&amp;guide=platform_administrator" data-route-link>Browse role guides</a><a href="#mode=system&amp;guide=source-references&amp;scope=mode" data-route-link data-no-result-system>Search System references</a></div></section>${model.modes.map((mode) => modePanel(mode, guides)).join("")}</aside>
    <main class="reading-canvas" tabindex="-1">
      <section class="route-notice" id="route-notice" role="status" hidden><span>This handbook link has moved. The nearest current guide is open.</span><div><button type="button" data-recovery-search>Search</button><button type="button" data-dismiss-notice aria-label="Dismiss message">Dismiss</button></div></section>
      ${homeGuide(home, guides, guideById)}
      ${articles}
    </main>
    <aside id="page-toc" class="page-toc" aria-labelledby="page-toc-title"><div class="drawer-heading"><h2 id="page-toc-title">On this page</h2><button type="button" data-close-drawer="toc" aria-label="Close table of contents">Close</button></div><nav data-page-toc aria-label="On this page"></nav></aside>
  </div>
  <script data-handbook-index>window.__HANDBOOK_INDEX__ = ${serializeForScript(searchIndex)}; window.__HANDBOOK_LEGACY_ROUTES__ = ${serializeForScript(model.legacyRoutes)}; window.__HANDBOOK_MODES__ = ${serializeForScript(model.modes)}; window.__HANDBOOK_SEARCH_STATE__ = ${serializeForScript(initialSearchState)};</script>
  <script>${mermaidBundle}</script>
  <script data-handbook-runtime>
${runtime}
  </script>
</body>
</html>`;
}

export function buildDocumentationHtml(sourceFiles = documentationSources()) {
  const sources = loadDocumentationSources(sourceFiles);
  const model = resolveHandbookModel(sources);
  const guides = composeHandbookGuides(model);
  const searchIndex = buildGuideSearchIndex(guides);
  const mermaidBundle = readFileSync(mermaidBundleFile, "utf8").replace(/[ \t]+$/gm, "");
  const styles = normalizeText(readFileSync(handbookStylesFile, "utf8")).replace(/[ \t]+$/gm, "");
  const runtime = normalizeText(readFileSync(handbookRuntimeFile, "utf8"))
    .replace(/[ \t]+$/gm, "")
    .replaceAll("</script", "<\\/script");
  return renderHandbookShell({ model, guides, searchIndex, styles, runtime, mermaidBundle });
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
