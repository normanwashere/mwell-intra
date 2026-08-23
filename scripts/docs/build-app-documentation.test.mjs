import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  buildDocumentationHtml,
  documentationSources,
} from "./build-app-documentation.mjs";

const EXPECTED_PROCUREMENT_STAGE_LABELS = Object.freeze([
  "Request",
  "Route",
  "Validate",
  "Solicit",
  "Quorum",
  "Evaluate",
  "Recommend",
  "Variance",
  "Approve",
  "Commit",
  "Monitor",
  "Receive",
  "Payment",
  "Close",
]);

const PROCUREMENT_MERMAID_STAGE_LABELS = Object.freeze([
  "Requester records need, category, goods or services, scope or specification, budget, cost center, required date, and acceptance criteria",
  "Procurement confirms solicitation document, procurement mode, governance tier, invited-vendor target, and reasons",
  "System validates active policy profile, effective DOA, accreditation, special-risk controls, and complete source package",
  "Procurement issues one versioned package to accredited vendors and records acknowledgments, clarifications, deadlines, and equal notices",
  "System evaluates response quorum and routes failed bid, extension or requote, or controlled insufficient-bids exception",
  "Procurement records commercial tabulation; requester or technical reviewer records technical evaluation",
  "Procurement records best-value recommendation and rationale; system selects no automatic winner",
  "Recommendation variance follows independent justification and approval",
  "Current Mwell DOA and separation of duty approve the award",
  "Procurement creates PO or agreement after vendor, sourcing, approval, and protection controls pass",
  "Vendor acknowledges commitment; outstanding delivery and acceptance enter monitored queues",
  "Warehouse or service owner records receipt and acceptance; quality issues route to rejection, replacement, warranty, or RMA",
  "Procurement prepares payment-readiness pack; Finance validates invoice, PO or agreement, receipt or acceptance, tax, and variance evidence",
  "Procurement file closes after payment readiness, delivery closure, open-issue resolution, and retained evidence are complete",
]);

const EXPECTED_PROCUREMENT_OPERATING_H3 = Object.freeze([
  "Exact 14-stage procurement-to-payment overview",
  "Solicitation document and type classification",
  "Bid quorum and failed-bid recovery",
  "Exception eligibility",
  "Best-value award and recommendation variance",
  "Receiving, quality and RMA",
  "Payment evidence and file closure",
  "Operating rules",
]);

const EXPECTED_PROCUREMENT_ROLE_HEADINGS = Object.freeze([
  "Requester",
  "Department Head",
  "Procurement Lead",
  "Legal/Compliance",
  "Technical Reviewer",
  "Warehouse/Operations",
  "Finance Controller",
  "Vendor Representative",
  "Platform Admin",
]);

const EXPECTED_PROCUREMENT_ROLE_FIELDS = Object.freeze([
  "Start condition",
  "Permitted action",
  "Prohibited action",
  "Handoff",
  "Denial check",
  "Recovery",
  "Completion evidence",
]);

function repositoryFile(relativePath) {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

function markdownSection(markdown, level, heading) {
  const lines = markdown.split(/\r?\n/);
  const marker = `${"#".repeat(level)} ${heading}`;
  const start = lines.findIndex((line) => line === marker);
  assert.notEqual(start, -1, `missing ${marker}`);
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    const match = lines[index].match(/^(#+)\s/);
    if (match && match[1].length <= level) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

function normalizeWhitespace(value) {
  return value.trim().replace(/\s+/g, " ");
}

function parseProcurementOverviewStages(process) {
  const overview = markdownSection(process, 3, "Exact 14-stage procurement-to-payment overview");
  const nodes = [...overview.matchAll(/\bS(\d+)\[(\d+)\s+([^\]\r\n]+)\]/g)].map((match) => ({
    nodeNumber: Number(match[1]),
    displayedNumber: Number(match[2]),
    mermaidLabel: normalizeWhitespace(match[3]),
  }));
  const sequence = Array.from({ length: EXPECTED_PROCUREMENT_STAGE_LABELS.length }, (_, index) => index + 1);

  assert.deepEqual(nodes.map(({ nodeNumber }) => nodeNumber), sequence, "procurement overview stage nodes must be S1 through S14 in order");
  assert.deepEqual(nodes.map(({ displayedNumber }) => displayedNumber), sequence, "procurement overview stage numbers must be 1 through 14 in order");

  return nodes.map(({ displayedNumber, mermaidLabel }) => {
    const sourceIndex = PROCUREMENT_MERMAID_STAGE_LABELS.indexOf(mermaidLabel);
    assert.notEqual(sourceIndex, -1, `unrecognized procurement overview stage ${displayedNumber}: ${mermaidLabel}`);
    assert.equal(sourceIndex, displayedNumber - 1, `procurement overview stage ${displayedNumber} has the wrong meaning`);
    return EXPECTED_PROCUREMENT_STAGE_LABELS[sourceIndex];
  });
}

function assertTask11Structure(process, manual) {
  const operatingExtract = markdownSection(process, 2, "Procurement Policy Operating Extract");
  const operatingH3 = [...operatingExtract.matchAll(/^### (.+)$/gm)].map((match) => match[1]);
  assert.deepEqual(
    operatingH3,
    EXPECTED_PROCUREMENT_OPERATING_H3,
    "procurement operating extract headings must match exactly",
  );

  const normalizedOverviewStages = parseProcurementOverviewStages(process);
  assert.deepEqual(
    normalizedOverviewStages,
    EXPECTED_PROCUREMENT_STAGE_LABELS,
    "procurement overview stage labels must match exactly",
  );

  const metadata = manual.match(/%% handbook-flow: workflow=procurement-to-payment; view=overview; stages=([^\n]+)/);
  assert.ok(metadata, "missing procurement overview metadata");
  assert.deepEqual(
    metadata[1].split("|"),
    EXPECTED_PROCUREMENT_STAGE_LABELS,
    "procurement flow metadata must share the exact overview stage labels",
  );

  const roleSection = markdownSection(manual, 2, "Procurement Role Procedures");
  const roleHeadings = [...roleSection.matchAll(/^### (.+)$/gm)].map((match) => match[1]);
  assert.deepEqual(roleHeadings, EXPECTED_PROCUREMENT_ROLE_HEADINGS, "procurement role headings must match exactly");

  for (const role of EXPECTED_PROCUREMENT_ROLE_HEADINGS) {
    const procedure = markdownSection(roleSection, 3, role);
    for (const field of EXPECTED_PROCUREMENT_ROLE_FIELDS) {
      const escapedField = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const count = (procedure.match(new RegExp(`^- \\*\\*${escapedField}:\\*\\*`, "gm")) ?? []).length;
      assert.equal(count, 1, `${role} ${field} must appear exactly once`);
    }
  }

  return { operatingExtract, roleSection };
}

const AFFIRMATIVE_RELEASE_PATTERNS = Object.freeze([
  /\b(?:live|uat)(?:\s*\/\s*(?:live|uat))?(?:\s+(?:approval|pass|certification|completion|deployment|activation))?\s+(?:(?:is|was|has been)\s+)?(?:approved|passed|certified|complete|completed|deployed|activated|successful|done)\b/i,
  /\b(?:deployment|activation)\s+(?:to|in|on)\s+(?:live|uat)\s+(?:(?:is|was|has been)\s+)?(?:approved|passed|certified|complete|completed|successful|done)\b/i,
  /\b(?:deployment|activation)\s+(?:(?:is|was|has been)\s+)?(?:approved|passed|certified|complete|completed|successful|done)\s+(?:in|to|on)\s+(?:live|uat)\b/i,
  /\bmigration(?:\s+(?:is|was|has been))?[\s-]+applied(?:\s+(?:in|to|on)\s+(?:live|uat))?\b/i,
  /\b(?:live|uat)\s+migration(?:\s+(?:is|was|has been))?[\s-]+applied\b/i,
]);

function assertNoAffirmativeReleaseClaims(markdown) {
  const sentences = markdown
    .replace(/\r/g, "")
    .split(/(?<=[.!?])(?:\s+|$)|\n+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  for (const sentence of sentences) {
    for (const pattern of AFFIRMATIVE_RELEASE_PATTERNS) {
      const match = pattern.exec(sentence);
      if (!match) continue;
      const prefix = sentence.slice(Math.max(0, match.index - 24), match.index);
      if (/\b(?:no|not|never|without)\s+[^.;:]{0,20}$/i.test(prefix)) continue;
      assert.fail(`prohibited affirmative release claim: ${sentence}`);
    }
  }
}

function runtimeFunction(name, nextFunction, bindings = {}) {
  const runtime = readFileSync(new URL("./handbook-runtime.js", import.meta.url), "utf8");
  const match = runtime.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n    }\\n\\n    function ${nextFunction}`));
  assert.ok(match, `could not extract ${name} from the handbook runtime`);
  const source = match[0].slice(0, match[0].lastIndexOf(`function ${nextFunction}`));
  return new Function(...Object.keys(bindings), `${source}; return ${name};`)(...Object.values(bindings));
}

function generatorFunction(name, nextFunction, bindings = {}) {
  const generator = readFileSync(new URL("./build-app-documentation.mjs", import.meta.url), "utf8");
  const match = generator.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n}\\n\\nfunction ${nextFunction}`));
  assert.ok(match, `could not extract ${name} from the documentation generator`);
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

test("includes the exact MPIC source and separates the three route axes", () => {
  const html = buildDocumentationHtml();
  assert.match(html, /MPIC Procurement Policy February2025\.docx/);
  assert.match(html, /Solicitation document/);
  assert.match(html, /Procurement mode/);
  assert.match(html, /Governance tier/);
  assert.match(html, /three to four accredited vendors/i);
  assert.match(html, /at least three usable responses/i);
});

test("keeps one canonical MPIC article with separated sections in required order", () => {
  const html = buildDocumentationHtml();
  const source = repositoryFile("docs/policy/MPIC_PROCUREMENT_POLICY_FEBRUARY_2025.md");
  const headings = [...source.matchAll(/^## (.+)$/gm)].map((match) => match[1]);

  assert.equal((html.match(/<article id="doc-policy-mpic-procurement-policy-february-2025-md"/g) ?? []).length, 1);
  assert.equal(documentationSources().filter((file) => file === "docs/policy/MPIC_PROCUREMENT_POLICY_FEBRUARY_2025.md").length, 1);
  assert.deepEqual(headings, [
    "Source identity",
    "Scope",
    "Direct requirements",
    "Mwell mapping",
    "Active profile",
    "Conflicts",
    "Ownership",
    "Revision procedure",
  ]);
  assert.match(markdownSection(source, 2, "Direct requirements"), /Department Head[\s\S]*Group Controller/);
  assert.match(markdownSection(source, 2, "Mwell mapping"), /Solicitation document[\s\S]*Procurement mode[\s\S]*Governance tier/);
});

test("locks the exact procurement stage order and six decision-tree semantics", () => {
  const manual = repositoryFile("docs/manual/MWELL_INTRA_USER_MANUAL.md");
  const process = repositoryFile("docs/PROCESS_REFERENCE_LIBRARY.md");
  assertTask11Structure(process, manual);

  const treeHeadings = EXPECTED_PROCUREMENT_OPERATING_H3.slice(1, -1);
  for (const heading of treeHeadings) {
    const tree = markdownSection(process, 3, heading);
    assert.match(tree, /```mermaid/);
    assert.match(tree, /\|Yes\|/);
    assert.match(tree, /\|No\|/);
    assert.match(tree, /Blocked/i);
    assert.match(tree, /Recovery/i);
    assert.match(tree, /evidence/i);
  }

  const quorum = markdownSection(process, 3, "Bid quorum and failed-bid recovery");
  assert.match(quorum, /current, independently approved pre-issue invitation-target exception/i);
  assert.match(quorum, /\|Yes\|[^\n]*Controlled package path[^\n]*exception evidence/i);
  assert.match(quorum, /\|No\|[^\n]*Blocked terminal/i);
});

test("keeps all nine procurement role procedures complete", () => {
  const manual = repositoryFile("docs/manual/MWELL_INTRA_USER_MANUAL.md");
  const process = repositoryFile("docs/PROCESS_REFERENCE_LIBRARY.md");
  assertTask11Structure(process, manual);
});

test("blocks obsolete routing, certification, named variance authority, and extension inheritance claims", () => {
  const files = [
    "docs/policy/MPIC_PROCUREMENT_POLICY_FEBRUARY_2025.md",
    "docs/policy/VENDOR_TO_PAY_CONTROL_MATRIX.md",
    "docs/PROCESS_REFERENCE_LIBRARY.md",
    "docs/TECHNICAL_AND_FUNCTIONAL_SPECIFICATION.md",
    "docs/TRAINING_AND_HANDOVER_CONTENT.md",
    "docs/manual/MWELL_INTRA_USER_MANUAL.md",
    "docs/REQUIREMENTS_TRACEABILITY_MATRIX.md",
  ];
  const byFile = Object.fromEntries(files.map((file) => [file, repositoryFile(file)]));
  const all = Object.values(byFile).join("\n");
  const operating = [
    byFile["docs/policy/VENDOR_TO_PAY_CONTROL_MATRIX.md"],
    byFile["docs/PROCESS_REFERENCE_LIBRARY.md"],
    byFile["docs/TECHNICAL_AND_FUNCTIONAL_SPECIFICATION.md"],
    byFile["docs/TRAINING_AND_HANDOVER_CONTENT.md"],
    byFile["docs/manual/MWELL_INTRA_USER_MANUAL.md"],
  ].join("\n");
  const extract = byFile["docs/policy/MPIC_PROCUREMENT_POLICY_FEBRUARY_2025.md"];
  const traceability = byFile["docs/REQUIREMENTS_TRACEABILITY_MATRIX.md"];

  for (const obsolete of [
    /RFQ[^\n]{0,100}(?:below|under)[^\n]{0,40}(?:PHP )?1,000,000/i,
    /RFP[^\n]{0,100}(?:above|over|at or above)[^\n]{0,40}(?:PHP )?1,000,000/i,
    /1,000,000[^\n]{0,120}(?:switches|converts|uses)[^\n]{0,60}RFP/i,
  ]) assert.doesNotMatch(all, obsolete);

  assertNoAffirmativeReleaseClaims(all);
  assert.doesNotMatch(operating, /(?:recommendation variance|recommendation differs|differing recommendation)[\s\S]{0,260}(?:Department Head|Group Controller|Finance Controller|independent Controller)/i);
  assert.match(operating, /first independent variance decision/i);
  assert.match(operating, /second independent variance decision/i);

  const conflicts = markdownSection(extract, 2, "Conflicts");
  assert.match(conflicts, /current Mwell code[\s\S]*`dept_head`[\s\S]*`finance`[\s\S]*unresolved/i);
  assert.match(conflicts, /`maxExtensionWorkingDays`/i);
  assert.match(conflicts, /seven working days/i);
  assert.match(conflicts, /seven calendar days/i);
  assert.match(conflicts, /block activation/i);
  assert.doesNotMatch(markdownSection(extract, 2, "Active profile"), /inherits[^\n]*all[^\n]*MPIC controls/i);
  assert.match(traceability, /`dept_head`[\s\S]*`finance`[\s\S]*unresolved/i);
  assert.match(traceability, /seven calendar days[\s\S]*working-day[\s\S]*activation blocked/i);
});

test("rejects representative Task 11 structural and certification mutations", () => {
  const process = repositoryFile("docs/PROCESS_REFERENCE_LIBRARY.md");
  const manual = repositoryFile("docs/manual/MWELL_INTRA_USER_MANUAL.md");

  const alteredStage = process.replace(
    "8 Recommendation variance follows independent justification and approval",
    "8 Unrelated placeholder stage",
  );
  assert.throws(() => assertTask11Structure(alteredStage, manual), /overview stage/i);

  const duplicateTree = process.replace(
    "### Operating rules",
    "### Bid quorum and failed-bid recovery\n\nDuplicate tree.\n\n### Operating rules",
  );
  assert.throws(() => assertTask11Structure(duplicateTree, manual), /operating extract headings/i);

  const duplicateRole = manual.replace(
    "### Department Head",
    "### Requester\n\nDuplicate role.\n\n### Department Head",
  );
  assert.throws(() => assertTask11Structure(process, duplicateRole), /role headings/i);

  const duplicateField = manual.replace(
    /(- \*\*Start condition:\*\*[^\n]+)/,
    "$1\n$1",
  );
  assert.throws(() => assertTask11Structure(process, duplicateField), /Requester Start condition/i);

  for (const affirmativeClaim of [
    "UAT passed.",
    "UAT is complete.",
    "The migration is applied in UAT.",
    "Live deployment is complete.",
    "Deployment completed in UAT.",
  ]) {
    assert.throws(() => assertNoAffirmativeReleaseClaims(`${process}\n${affirmativeClaim}`), /affirmative release claim/i);
  }

  assert.doesNotThrow(() => assertNoAffirmativeReleaseClaims([
    "No live/UAT certification is claimed.",
    "UAT has not passed and remains pending.",
    "Live deployment is blocked.",
    "The migration remains unapplied.",
    "Local tests do not prove activation.",
  ].join(" ")));
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
    "tabIds",
    "articleId",
    "headingId",
    "title",
    "heading",
    "summary",
    "audience",
    "keywords",
    "source",
    "text",
    "searchText",
  ]);
  assert.ok(heading.text.length <= 240);
  assert.ok(index.some((record) => record.tabIds.includes("workflows") && /three-way match/i.test(record.searchText)), "workflow diagram labels remain searchable without exposing source fences");
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

test("renders maintained flow views before workflow prose", () => {
  const html = buildDocumentationHtml();
  const workflows = [
    "procurement-to-payment",
    "vendor-accreditation",
    "receiving-putaway",
    "ecommerce-fulfillment",
    "returns-replacements",
    "inventory-release",
    "event-custody",
    "inventory-integrity",
  ];

  assert.ok((html.match(/class="mermaid"/g) ?? []).length >= 6);
  for (const workflow of workflows) {
    const group = html.match(new RegExp(`<section class="diagram-group"[^>]+data-workflow-id="${workflow}"[\\s\\S]*?</section>`));
    assert.ok(group, `renders ${workflow} as a maintained diagram group`);
    for (const view of ["overview", "role", "decision"]) assert.match(group[0], new RegExp(`data-diagram-view="${view}"`));
    assert.match(group[0], /--&gt;\|[^|]+\|/, `${workflow} includes labeled decision edges`);
    const nextGroup = html.indexOf('<section class="diagram-group"', group.index + group[0].length);
    const completion = html.indexOf('<strong>Completion criteria:</strong>', group.index + group[0].length);
    assert.ok(completion > group.index && (nextGroup < 0 || completion < nextGroup), `${workflow} keeps completion criteria after its diagram group`);
  }
  assert.match(html, /class="process-ribbon"/);
  assert.match(html, /data-diagram-fit/);
  assert.doesNotMatch(html, /```mermaid/);
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
    diagramZoom: { "doc-technical-and-functional-specification-md:diagram-1": 1.4, fit: "fit", broken: "big" },
    diagramModes: { "procurement-to-payment": "decision", broken: "sideways" },
    tabScroll: { architecture: 480, release: "bottom" },
    theme: "dark",
  }), {
    activeTab: "architecture",
    activeArticle: "doc-technical-and-functional-specification-md",
    query: "tenant",
    scope: "tab",
    expandedIds: ["doc-technical-and-functional-specification-md:runtime-architecture"],
    diagramViews: { "doc-technical-and-functional-specification-md:diagram-1": { left: 18, top: 32 } },
    diagramZoom: { "doc-technical-and-functional-specification-md:diagram-1": 1.4, fit: "fit" },
    diagramModes: { "procurement-to-payment": "decision" },
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
    diagramModes: {},
    tabScroll: {},
    theme: "light",
  });
});

test("keeps semantic diagram state IDs stable when diagrams are inserted or reordered", () => {
  const decorateArticleHtml = generatorFunction("decorateArticleHtml", "buildSearchIndex", {
    escapeHtml: (value) => value,
    disclosureDefaultOpen: () => true,
    createHash,
  });
  const document = { id: "doc-example", collapse: "none" };
  const overview = '<figure class="diagram-shell" data-flow-workflow="procurement-to-payment" data-flow-view="overview" data-flow-stages="Request|Pay"><div class="mermaid">flowchart TD\nA[Request] --&gt; B[Pay]</div></figure>';
  const role = '<figure class="diagram-shell" data-flow-workflow="procurement-to-payment" data-flow-view="role" data-flow-stages="Request|Pay"><div class="mermaid">flowchart TD\nA[Requester] --&gt; B[Finance]</div></figure>';
  const decision = '<figure class="diagram-shell" data-flow-workflow="procurement-to-payment" data-flow-view="decision" data-flow-stages="Request|Pay"><div class="mermaid">flowchart TD\nA{Approved?} --&gt;|Yes| B[Pay]</div></figure>';
  const fallback = '<figure class="diagram-shell"><div class="mermaid">flowchart TD\nA[Stable fallback] --&gt; B[Done]</div></figure>';
  const inserted = '<figure class="diagram-shell"><div class="mermaid">flowchart TD\nX[Inserted] --&gt; Y[Other]</div></figure>';
  const original = decorateArticleHtml(document, `${overview}${role}${decision}${fallback}`);
  const reordered = decorateArticleHtml(document, `${inserted}${fallback}${overview}${role}${decision}`);
  const idFor = (html, marker) => html.match(new RegExp(`data-diagram-id="([^"]+)"[^>]*>(?:(?!<figure)[\\s\\S])*?${marker}`))?.[1];

  assert.equal(idFor(original, "Request] --&gt; B\\[Pay"), idFor(reordered, "Request] --&gt; B\\[Pay"));
  assert.equal(idFor(original, "Stable fallback"), idFor(reordered, "Stable fallback"));
  assert.match(original, /data-diagram-id="doc-example:flow:procurement-to-payment:overview"/);
});

test("restores a saved tab position through the document viewport", () => {
  const calls = [];
  const restoreStoredPosition = runtimeFunction("restoreStoredPosition", "activateLinkedRoute", {
    document: { getElementById: () => null },
    openContainingDisclosure: () => {},
    tabScroll: { architecture: 480 },
    window: { scrollTo: (options) => calls.push(options) },
  });

  restoreStoredPosition({ tabId: "architecture", headingId: null });

  assert.deepEqual(calls, [{ left: 0, top: 480, behavior: "auto" }]);
});

test("uses window as the handbook reading scroll owner", () => {
  const html = buildDocumentationHtml();

  assert.match(html, /window\.addEventListener\('scroll'/);
  assert.doesNotMatch(html, /readingCanvas\.addEventListener\('scroll'/);
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
