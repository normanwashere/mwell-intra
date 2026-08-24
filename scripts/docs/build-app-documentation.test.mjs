import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import * as documentationGenerator from "./build-app-documentation.mjs";
import { HANDBOOK_GUIDES, HANDBOOK_MODES, LEGACY_ROUTES } from "./handbook-guides.mjs";

const {
  buildDocumentationHtml,
  documentationSources,
  SYSTEM_SEARCH_INTENT_TERMS,
} = documentationGenerator;

const TASK_SECTION_IDS = Object.freeze([
  "outcome",
  "flow",
  "who-is-involved",
  "before-you-start",
  "steps",
  "decisions-and-exceptions",
  "completion-checklist",
  "related-tasks",
  "policy-basis",
  "document-controls",
]);

const ROLE_SECTION_IDS = Object.freeze([
  "role-purpose-and-department",
  "your-workspace",
  "work-queue-and-priorities",
  "permitted-actions",
  "decisions-and-approval-authority",
  "prohibited-actions",
  "handoffs-received-and-sent",
  "guided-simulation",
  "negative-and-recovery-scenario",
  "escalation-and-support",
  "completion-evidence-and-training-sign-off",
  "capability-codes-and-document-controls",
]);

const EXPECTED_PROCUREMENT_STAGE_LABELS = Object.freeze([
  "Define need",
  "Submit request",
  "Confirm path",
  "Source vendors",
  "Check accreditation",
  "Evaluate",
  "Recommend award",
  "Approve",
  "Issue PO or contract",
  "Deliver and close",
  "Prepare payment handoff",
  "Process payment",
  "Close file",
]);

const PROCUREMENT_MERMAID_STAGE_LABELS = Object.freeze([
  "Define the need",
  "Submit the request",
  "Confirm the procurement path",
  "Source vendors",
  "Check accreditation",
  "Evaluate offers",
  "Recommend award",
  "Approve under the active DOA",
  "Issue PO or contract",
  "Deliver and close delivery or service obligations",
  "Prepare payment handoff",
  "Process vendor payment",
  "Close the procurement file",
]);

const EXPECTED_PROCUREMENT_OPERATING_H3 = Object.freeze([
  "Canonical 13-step procurement-to-payment overview",
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
  const overview = markdownSection(process, 3, "Canonical 13-step procurement-to-payment overview");
  const nodes = [...overview.matchAll(/\bS(\d+)\[(\d+)\s+([^\]\r\n]+)\]/g)].map((match) => ({
    nodeNumber: Number(match[1]),
    displayedNumber: Number(match[2]),
    mermaidLabel: normalizeWhitespace(match[3]),
  }));
  const sequence = Array.from({ length: EXPECTED_PROCUREMENT_STAGE_LABELS.length }, (_, index) => index + 1);

  assert.deepEqual(nodes.map(({ nodeNumber }) => nodeNumber), sequence, "procurement overview step nodes must be sequential");
  assert.deepEqual(nodes.map(({ displayedNumber }) => displayedNumber), sequence, "procurement overview step numbers must be sequential");

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

const AFFIRMATIVE_RELEASE_CLAIMS = Object.freeze([
  {
    name: "live/UAT status",
    pattern: /\b(?:live|uat)(?:\s*\/\s*(?:live|uat))?(?:\s+(?:testing|approval|pass|certification|completion|deployment|activation))?\s+(?:(?:is|are|was|were|has|have|had|been|now|already|successfully|fully|formally)\s+)*(?:approved|passed|certified|complete|completed|deployed|activated|successful|done|claimed)\b/i,
  },
  {
    name: "deployment/activation status",
    pattern: /\b(?:deployment|activation)\s+(?:(?:to|in|on)\s+(?:live|uat)\s+)?(?:(?:is|are|was|were|has|have|had|been|now|already|successfully|fully|formally)\s+)*(?:approved|passed|certified|complete|completed|successful|done)(?:\s+(?:in|to|on)\s+(?:live|uat))?\b/i,
  },
  {
    name: "migration-applied status",
    pattern: /\b(?:(?:live|uat)\s+)?migration\s+(?:(?:is|are|was|were|has|have|had|been|now|already|successfully|fully|formally)\s+)*applied(?:\s+(?:in|to|on)\s+(?:live|uat))?\b/i,
  },
]);

function assertNoAffirmativeReleaseClaims(markdown) {
  const sentences = markdown
    .replace(/\r/g, "")
    .split(/(?<=[.!?])(?:\s+|$)|\n+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  for (const sentence of sentences) {
    for (const claim of AFFIRMATIVE_RELEASE_CLAIMS) {
      const match = claim.pattern.exec(sentence);
      if (!match) continue;
      const prefix = sentence.slice(Math.max(0, match.index - 24), match.index);
      if (/\b(?:no|not|never|without)\s+[^.;:]{0,20}$/i.test(prefix)) continue;
      assert.fail(`prohibited affirmative release claim (${claim.name}): ${sentence}`);
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

function embeddedWindowValue(html, name) {
  const match = html.match(new RegExp(`window\\.${name} = ([\\s\\S]*?);(?: window\\.|</script>)`));
  assert.ok(match, `missing embedded window.${name}`);
  return JSON.parse(match[1]);
}

function articleHtml(html, guideId) {
  const match = html.match(new RegExp(`<article[^>]+data-guide-id="${guideId}"[\\s\\S]*?</article>`));
  assert.ok(match, `missing rendered guide ${guideId}`);
  return match[0];
}

function tagAttributes(tag) {
  return Object.fromEntries(
    [...tag.matchAll(/([\w:-]+)="([^"]*)"/g)].map((match) => [match[1], match[2]]),
  );
}

test("exports deterministic outcome-first generator phases", () => {
  for (const helper of [
    "loadDocumentationSources",
    "resolveHandbookModel",
    "composeHandbookGuides",
    "buildGuideSearchIndex",
    "renderHandbookShell",
  ]) {
    assert.equal(typeof documentationGenerator[helper], "function", helper);
  }

  const sources = documentationGenerator.loadDocumentationSources(documentationSources());
  const model = documentationGenerator.resolveHandbookModel(sources);
  const guides = documentationGenerator.composeHandbookGuides(model);
  const searchIndex = documentationGenerator.buildGuideSearchIndex(guides);
  const html = documentationGenerator.renderHandbookShell({
    model,
    guides,
    searchIndex,
    styles: "/* phase-test */",
    runtime: "window.__PHASE_TEST__ = true;",
    mermaidBundle: "window.mermaid = window.mermaid || {};",
  });

  assert.equal(sources.length, documentationSources().length);
  assert.deepEqual(model.modes.map(({ id }) => id), HANDBOOK_MODES.map(({ id }) => id));
  assert.equal(guides.length, HANDBOOK_GUIDES.length);
  assert.ok(searchIndex.some(({ type }) => type === "Step"));
  assert.match(html, /What do you need to do\?/);
});

test("renders the four public modes and an outcome-first Home before metadata", () => {
  const html = buildDocumentationHtml();
  const modeLabels = [...html.matchAll(/<button[^>]+data-mode-button[^>]*>([^<]+)<\/button>/g)]
    .map((match) => normalizeWhitespace(match[1]));

  assert.deepEqual(modeLabels, ["Home", "Tasks", "Roles", "System"]);
  assert.equal((html.match(/data-mode-panel/g) ?? []).length, 4);
  assert.doesNotMatch(html, /<button[^>]+data-mode-button[^>]*>(?:Start Here|Workflows|Roles &amp; Training|Architecture|Infrastructure|Security &amp; Governance|Release &amp; QA)<\/button>/);

  const question = html.indexOf("What do you need to do?");
  const frequentTasks = html.indexOf("Start a task", question);
  const roleEntry = html.indexOf("Learn my role", frequentTasks);
  const systemEntry = html.indexOf("Manage or support Mwell Intra", roleEntry);
  const recentGuides = html.indexOf("Recent guides", systemEntry);
  const documentControls = html.indexOf("Document controls", recentGuides);
  assert.ok(question >= 0 && question < frequentTasks);
  assert.ok(frequentTasks < roleEntry && roleEntry < systemEntry);
  assert.ok(systemEntry < recentGuides && recentGuides < documentControls);
  assert.equal(html.slice(question, documentControls).includes("Source checksum"), false);
  assert.match(html.slice(question, documentControls), /data-guide-id="stock-receiving-putaway"/);
  assert.match(html.slice(question, documentControls), /data-role-entry/);
});

test("renders all canonical task, role, and System guides in contract order", () => {
  const html = buildDocumentationHtml();
  assert.equal((html.match(/<article[^>]+data-guide-type="task"/g) ?? []).length, 13);
  assert.equal((html.match(/<article[^>]+data-guide-type="role"/g) ?? []).length, 11);
  assert.equal((html.match(/<article[^>]+data-guide-type="system"/g) ?? []).length, 8);

  const task = articleHtml(html, "procurement-request-approval");
  const taskSections = [...task.matchAll(/data-guide-section="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(taskSections, TASK_SECTION_IDS);
  assert.match(task, /data-task-stage="step-1"[\s\S]*?General Employee[\s\S]*?\/procurement\/requests\/new/);
  assert.match(task, /Expected visible result/);
  assert.match(task, /Data read/);
  assert.match(task, /Data written/);
  assert.match(task, /Evidence retained/);
  assert.match(task, /Next handoff/);

  const role = articleHtml(html, "operations_associate");
  const roleSections = [...role.matchAll(/data-guide-section="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(roleSections, ROLE_SECTION_IDS);
  assert.match(role, /Guided simulation/);
  assert.match(role, /Negative and recovery scenario/);
  assert.match(role, /Completion evidence and training sign-off/);
});

test("renders every future step screenshot as pending review without enforcing strict coverage", () => {
  const html = buildDocumentationHtml();
  const taskStages = HANDBOOK_GUIDES.filter(({ type }) => type === "task")
    .flatMap(({ steps }) => steps);

  assert.equal(taskStages.length, 52);
  assert.equal((html.match(/data-screen-evidence="pending"/g) ?? []).length, taskStages.length);
  assert.equal((html.match(/Screen evidence pending review/g) ?? []).length, taskStages.length);
  assert.doesNotMatch(html, /data-screen-evidence="certified"/);
  assert.doesNotMatch(html, /data-certified-screenshot/);
});

test("collapses policy, source, capability, and document controls while preserving governed content", () => {
  const html = buildDocumentationHtml();
  const task = articleHtml(html, "procurement-request-approval");
  const role = articleHtml(html, "operations_associate");
  const sourceLibrary = articleHtml(html, "source-references");

  assert.match(task, /<details[^>]+data-guide-section="policy-basis"(?![^>]*\bopen\b)/);
  assert.match(task, /<details[^>]+data-guide-section="document-controls"(?![^>]*\bopen\b)/);
  assert.match(role, /<details[^>]+data-guide-section="capability-codes-and-document-controls"(?![^>]*\bopen\b)/);
  assert.equal(
    (sourceLibrary.match(/<details[^>]+data-source-reference=/g) ?? []).length,
    documentationSources().length,
  );
  for (const source of documentationSources()) {
    assert.match(sourceLibrary, new RegExp(`data-source-file="${source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
  }
  assert.match(sourceLibrary, /Mwell Intra Process Reference Library/);
  assert.match(sourceLibrary, /user@example\.com/);
});

test("renders decisions at their true stage with explicit recovery and terminal destinations", () => {
  const html = buildDocumentationHtml();
  const procurement = articleHtml(html, "procurement-request-approval");
  const receiving = articleHtml(html, "stock-receiving-putaway");
  const fulfillment = articleHtml(html, "ecommerce-fulfillment-delivery");

  assert.match(procurement, /S1 --&gt; D1/);
  assert.match(procurement, /D1 --&gt;\|Complete\| S2/);
  assert.match(procurement, /S3 --&gt; D3/);
  assert.match(procurement, /D3 --&gt;\|Approved\| S4/);
  assert.match(procurement, /D3 --&gt;\|Not approved\| D4/);
  assert.match(procurement, /D4 --&gt;\|Correctable\| S1/);
  assert.match(procurement, /D4 --&gt;\|Rejected\| O_REJECTION/);
  assert.ok(procurement.indexOf("S1 --&gt; D1") < procurement.indexOf("S3 --&gt; D3"));
  assert.doesNotMatch(procurement, /RECOVERY\[|\|No\| RECOVERY/);

  assert.match(receiving, /D1 --&gt;\|Mismatch\| S1/);
  assert.match(fulfillment, /D1 --&gt;\|Insufficient or held\| O_CONTROLLED_HOLD/);
  for (const label of ["Owner", "Failed condition", "Recovery action", "Destination"]) {
    assert.match(procurement, new RegExp(label));
  }
  for (const guide of HANDBOOK_GUIDES.filter(({ type }) => type === "task")) {
    const rendered = articleHtml(html, guide.id);
    assert.equal(
      (rendered.match(/data-task-decision=/g) ?? []).length,
      guide.decisionPoints.length,
      `${guide.id} renders every decision`,
    );
    assert.equal(
      (rendered.match(/data-decision-branch=/g) ?? []).length,
      guide.decisionPoints.length * 2,
      `${guide.id} renders both branches`,
    );
  }
});

test("renders governed source bodies once and links every other source control to the library", () => {
  const html = buildDocumentationHtml();
  const sourceLibrary = articleHtml(html, "source-references");
  const sourceFiles = documentationSources();

  assert.equal((html.match(/data-source-body/g) ?? []).length, sourceFiles.length);
  assert.equal((sourceLibrary.match(/data-source-body/g) ?? []).length, sourceFiles.length);
  for (const source of sourceFiles) {
    const escaped = source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.equal((html.match(new RegExp(`data-source-body[^>]+data-source-file="${escaped}"`, "g")) ?? []).length, 1, source);
  }

  for (const guide of HANDBOOK_GUIDES.filter(({ id }) => id !== "source-references")) {
    const rendered = guide.type === "home"
      ? html.match(/<section class="hero home-guide"[\s\S]*?<\/section>\s*<article id="guide-/)?.[0] ?? ""
      : articleHtml(html, guide.id);
    assert.doesNotMatch(rendered, /source-reference-content/, guide.id);
    if (guide.sourceSections.length) {
      assert.match(rendered, /data-canonical-source-link/, guide.id);
    }
  }
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
  for (const linkTag of html.matchAll(/<a[^>]+data-canonical-source-link[^>]*>/g)) {
    const targetId = tagAttributes(linkTag[0])["data-heading"];
    assert.ok(ids.has(targetId), `canonical source link targets addressable #${targetId}`);
  }
});

test("gives disclosures and DOM IDs globally unique keys and renders every legacy target", () => {
  const html = buildDocumentationHtml();
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  const disclosureKeys = [...html.matchAll(/data-section-id="([^"]+)"/g)].map((match) => match[1]);

  assert.equal(new Set(ids).size, ids.length, "every DOM ID is globally unique");
  assert.equal(new Set(disclosureKeys).size, disclosureKeys.length, "every disclosure state key is globally unique");
  for (const route of LEGACY_ROUTES) {
    const targetId = `${route.guideId}-${route.headingId}`;
    assert.ok(ids.includes(targetId), `${route.legacyArticleId} targets addressable #${targetId}`);
  }
});

test("embeds typed search records and every legacy route", () => {
  const html = buildDocumentationHtml();
  const index = embeddedWindowValue(html, "__HANDBOOK_INDEX__");
  const legacyRoutes = embeddedWindowValue(html, "__HANDBOOK_LEGACY_ROUTES__");

  assert.ok(index.some(({ type, guideId }) => type === "Task" && guideId === "stock-receiving-putaway"));
  assert.ok(index.some(({ type, guideId, headingId }) => type === "Step" && guideId === "stock-receiving-putaway" && headingId === "step-1"));
  assert.ok(index.some(({ type }) => type === "Decision"));
  assert.ok(index.some(({ type, guideId }) => type === "Role" && guideId === "operations_associate"));
  assert.ok(index.some(({ type }) => type === "Troubleshooting"));
  assert.ok(index.some(({ type }) => type === "System reference"));
  assert.ok(index.every(({ modeId, guideId, headingId, title, excerpt, href }) =>
    modeId && guideId && headingId && title && excerpt && href));
  assert.deepEqual(legacyRoutes, LEGACY_ROUTES);
});

test("builds one self-contained handbook from every canonical source", () => {
  const html = buildDocumentationHtml();
  const sources = documentationSources();
  assert.match(html, /Mwell Intra Standalone Operating Handbook/);
  assert.match(html, /What do you need help with\?/);
  assert.match(html, /Technical and Functional Specification/);
  assert.match(html, /User Training And Operations Manual/);
  assert.match(html, /WMS Feedback Release/);
  assert.match(html, /Users V1/);
  assert.match(html, /user@example\.com/);
  assert.match(html, /class="mermaid"/);
  assert.match(html, /mermaid\.initialize/);
  assert.match(html, /Mwell Intra Process Reference Library/);
  assert.match(html, /id="doc-manual-mwell-intra-user-manual-md-start-here"/);
  assert.doesNotMatch(html, /href=["'][^"']*(?:\/|#)knowledge\b/i);
  assert.doesNotMatch(html, /(?:live|in-app) Knowledge Base/i);
  assert.doesNotMatch(html, /<script\s+src=/i);
  assert.doesNotMatch(html, /<link\s+[^>]*rel=["']stylesheet/i);
  assert.doesNotMatch(html, /\r/);
  assert.ok(sources.length >= 15);
  assert.deepEqual(sources.slice(2), [...sources.slice(2)].sort());
});

test("fails before rendering an unclassified maintained source", () => {
  assert.throws(
    () => buildDocumentationHtml([...documentationSources(), "docs/new-review.md"]),
    /docs\/new-review\.md.*not classified/i,
  );
});

test("fails before rendering duplicate maintained sources", () => {
  const sources = documentationSources();
  const duplicateSource = "docs/releases/2026-08-21-WMS-FEEDBACK-RELEASE.md";

  assert.throws(
    () => buildDocumentationHtml([...sources, duplicateSource]),
    new RegExp(`${duplicateSource}.*appears more than once`, "i"),
  );
});

test("includes the canonical mWell source, incorporated MPIC reference, and three route axes", () => {
  const html = buildDocumentationHtml();
  assert.match(html, /mWell Procurement Policy and Procedures - Revised Modern Visual - Word Updated\.docx/);
  assert.match(html, /51F4E381CF7DEC6A1950867C4839750078DB08D603A5DE8AA54B63D12F6D1239/);
  assert.match(html, /MPIC Procurement Policy February2025\.docx/);
  assert.match(html, /Solicitation document/);
  assert.match(html, /Procurement mode/);
  assert.match(html, /Governance tier/);
  assert.match(html, /three to four accredited vendors/i);
  assert.match(html, /at least three usable responses/i);
});

test("keeps one incorporated MPIC source-library reference with separated sections in required order", () => {
  const html = buildDocumentationHtml();
  const source = repositoryFile("docs/policy/MPIC_PROCUREMENT_POLICY_FEBRUARY_2025.md");
  const headings = [...source.matchAll(/^## (.+)$/gm)].map((match) => match[1]);

  const sourceLibrary = articleHtml(html, "source-references");
  assert.equal((sourceLibrary.match(/data-source-file="docs\/policy\/MPIC_PROCUREMENT_POLICY_FEBRUARY_2025\.md"/g) ?? []).length, 1);
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

test("blocks obsolete routing, certification, named variance authority, and working-day extension claims", () => {
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

  assert.match(operating, /RFQ[^\n]{0,120}(?:below|under)[^\n]{0,40}(?:PHP )?1,000,000/i);
  assert.match(operating, /RFP[^\n]{0,120}(?:at or above|at PHP 1,000,000|PHP 1,000,000 and above)/i);
  assert.match(operating, /Importation[^\n]{0,120}does not automatically force RFP/i);
  assert.doesNotMatch(operating, /(?:Materials|Goods)[^\n]{0,40}(?:use|derive)[^\n]{0,20}RFQ/i);
  assert.doesNotMatch(operating, /Services[^\n]{0,40}(?:use|derive)[^\n]{0,20}RFP/i);
  assert.doesNotMatch(operating, /maxExtensionWorkingDays/i);

  assertNoAffirmativeReleaseClaims(all);
  assert.doesNotMatch(operating, /(?:recommendation variance|recommendation differs|differing recommendation)[\s\S]{0,260}(?:Department Head|Group Controller|Finance Controller|independent Controller)/i);
  assert.match(operating, /first independent variance decision/i);
  assert.match(operating, /second independent variance decision/i);

  const conflicts = markdownSection(extract, 2, "Conflicts");
  assert.match(conflicts, /current Mwell code[\s\S]*`dept_head`[\s\S]*`finance`[\s\S]*unresolved/i);
  assert.match(conflicts, /seven calendar days/i);
  assert.match(extract, /sourceDocumentStatus[\s\S]*updated_visual_draft/i);
  assert.doesNotMatch(markdownSection(extract, 2, "Active profile"), /inherits[^\n]*all[^\n]*MPIC controls/i);
  assert.match(traceability, /Neutral recommendation-variance decisions[\s\S]*Unresolved local authority mapping/i);
  assert.match(traceability, /maxExtensionCalendarDays/i);
});

test("rejects representative Task 11 structural and certification mutations", () => {
  const process = repositoryFile("docs/PROCESS_REFERENCE_LIBRARY.md");
  const manual = repositoryFile("docs/manual/MWELL_INTRA_USER_MANUAL.md");

  const alteredStage = process.replace(
    "8 Approve under the active DOA",
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
    "UAT has passed.",
    "UAT testing passed.",
    "UAT is complete.",
    "The migration is applied in UAT.",
    "The migration is now applied.",
    "The migration was successfully applied.",
    "The migration has now been applied.",
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

test("renders four accessible mode tabs and every canonical guide once", () => {
  const html = buildDocumentationHtml();
  assert.equal((html.match(/role="tab"/g) ?? []).length, 4);
  assert.equal((html.match(/role="tabpanel"/g) ?? []).length, 4);
  for (const id of ["home", "tasks", "roles", "system"]) {
    assert.match(html, new RegExp(`id="mode-${id}"`));
    assert.match(html, new RegExp(`id="mode-panel-${id}"`));
  }
  const controls = [...html.matchAll(/<button[^>]+data-mode-button[^>]*>/g)].map((match) => tagAttributes(match[0]));
  for (const control of controls) {
    const panelTag = html.match(new RegExp(`<[^>]+id="${control["aria-controls"]}"[^>]*>`))?.[0];
    assert.ok(panelTag, `${control.id} controls an existing element`);
    const panel = tagAttributes(panelTag);
    assert.equal(panel.role, "tabpanel", `${control.id} controls a tabpanel`);
    assert.equal(panel["aria-labelledby"], control.id, `${control.id} is the panel label`);
  }
  assert.equal((html.match(/data-guide(?:\s|>)/g) ?? []).length, HANDBOOK_GUIDES.length);
});

test("renders canonical guide navigation and in-place route support", () => {
  const html = buildDocumentationHtml();
  assert.match(html, /data-article-link/);
  assert.match(html, /data-guide-link/);
  assert.match(html, /data-page-toc/);
  assert.match(html, /data-related-link/);
  assert.match(html, /data-related-link[^>]+data-title=/);
  assert.match(html, /data-related-link[^>]+data-content-type=/);
  assert.match(html, /function activateRoute\(\{ modeId, guideId, headingId, query, scope, historyMode, restoreScroll, focusTarget, showSearchSurface = false \}\)/);
  assert.doesNotMatch(html, /let searchState/);
  assert.match(html, /history\.pushState/);
  assert.match(html, /history\.replaceState/);
  assert.doesNotMatch(html, /location\.(?:href|reload)/);
  assert.match(html, /data-print-scope="guide">Current guide/);
  assert.match(html, /data-print-scope="mode">Current mode/);
  assert.match(html, /data-print-scope="all">Complete handbook/);
});

test("renders progressive disclosures with stable state keys", () => {
  const html = buildDocumentationHtml();

  assert.match(html, /<details[^>]+data-section-id="procurement-request-approval:policy-basis"/);
  assert.match(html, /<details[^>]+data-section-id="procurement-request-approval:document-controls"/);
  assert.match(html, /<summary\b/);
  assert.match(html, /mwell-intra-handbook:v3/);
  assert.doesNotMatch(html, /data-section-id="procurement-request-approval:(?:policy-basis|document-controls)"[^>]+open/);
});

test("embeds guide-level typed search records with match metadata", () => {
  const html = buildDocumentationHtml();
  const indexMatch = html.match(/window\.__HANDBOOK_INDEX__ = (\[[\s\S]*?\]);/);

  assert.ok(indexMatch, "the generated handbook embeds a search index");
  const index = JSON.parse(indexMatch[1]);
  const step = index.find((record) => record.type === "Step");

  assert.equal(index[0].type, "Task");
  assert.ok(step, "the index contains a step-level record");
  assert.deepEqual(Object.keys(step), [
    "type",
    "modeId",
    "guideId",
    "headingId",
    "title",
    "heading",
    "role",
    "module",
    "excerpt",
    "whyMatched",
    "href",
    "keywords",
    "searchText",
    "tabId",
    "tabIds",
    "articleId",
    "summary",
    "audience",
    "source",
    "text",
  ]);
  assert.ok(step.text.length <= 240);
  assert.ok(index.some((record) => record.type === "Step" && /create and validate the request/i.test(record.searchText)), "structured task stages remain searchable without exposing source fences");
  assert.match(html, /"scope":"all"/);
  assert.match(html, /aria-live="polite"/);
  assert.doesNotMatch(indexMatch[1], /<\/script/i);
});

test("indexes operational language against canonical task and role destinations", () => {
  const sources = documentationGenerator.loadDocumentationSources(documentationSources());
  const model = documentationGenerator.resolveHandbookModel(sources);
  const index = documentationGenerator.buildGuideSearchIndex(documentationGenerator.composeHandbookGuides(model));
  const searchableText = (record) => normalizeWhitespace([
    record.title,
    record.heading,
    record.keywords,
    record.searchText,
  ].flat().join(" ")).toLowerCase();
  const cases = [
    ["three-way match", "finance-readiness-evidence"],
    ["approve request", "procurement-request-approval"],
    ["report damaged item", "stock-receiving-putaway"],
    ["reset password", "platform_administrator"],
    ["cycle count", "inventory-count-variance"],
    ["DOA", "department-doa-activation"],
    ["receive stock", "stock-receiving-putaway"],
    ["pick and pack", "ecommerce-fulfillment-delivery"],
    ["invalid login", "platform_administrator"],
    ["access denied", "platform_administrator"],
    ["vendor renewal", "vendor-accreditation-renewal"],
    ["renew vendor", "vendor-accreditation-renewal"],
    ["RFQ", "procurement-request-approval"],
    ["refund", "returns-replacements-refunds-rma"],
    ["lost event stock", "event-stock-custody"],
    ["cycle count variance", "inventory-count-variance"],
  ];

  assert.deepEqual(
    [...new Set(index.map(({ type }) => type))],
    ["Task", "Step", "Decision", "Troubleshooting", "Role", "System reference"],
  );
  for (const [query, guideId] of cases) {
    const match = index.find((record) => record.guideId === guideId && searchableText(record).includes(query.toLowerCase()));
    assert.ok(match, `${query} must index an operational answer in ${guideId}`);
    assert.match(match.href, new RegExp(`^#mode=(?:tasks|roles)&guide=${guideId}&heading=`));
    assert.ok(match.role || match.module, `${query} must expose role or module context`);
    assert.ok(match.excerpt.length > 20, `${query} must expose an actionable excerpt`);
  }
});

test("publishes the maintained governance search intent vocabulary", () => {
  const requiredIntents = [
    "doa", "delegation", "delegation of authority", "authority", "policy", "governance",
    "compliance", "security", "control", "retention", "architecture", "infrastructure",
    "release", "qa", "audit", "schema", "admin", "administration", "configuration",
    "training", "readiness", "system", "technical", "continuity", "backup", "source", "uat",
  ];

  assert.deepEqual(SYSTEM_SEARCH_INTENT_TERMS, requiredIntents);
  const html = buildDocumentationHtml();
  assert.deepEqual(embeddedWindowValue(html, "__HANDBOOK_SYSTEM_INTENTS__"), requiredIntents);
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

test("normalizes v3 per-guide state without accepting malformed values", () => {
  const normalizeStoredState = runtimeFunction("normalizeStoredState", "readStoredState");

  assert.deepEqual(normalizeStoredState({
    activeRoute: { modeId: "system", guideId: "technical-architecture", headingId: "overview", query: "  tenant  ", scope: "mode" },
    guideScroll: { "technical-architecture": 480, broken: "bottom" },
    recentGuides: ["technical-architecture", "technical-architecture", 4, "source-references"],
    disclosures: {
      "technical-architecture": ["technical-architecture:runtime-architecture", 4],
      broken: "open",
    },
    diagramViews: { "doc-technical-and-functional-specification-md:diagram-1": { left: 18, top: 32 } },
    diagramZoom: { "doc-technical-and-functional-specification-md:diagram-1": 1.4, fit: "fit", broken: "big" },
    diagramModes: { "procurement-to-payment": "decision", broken: "sideways" },
    theme: "dark",
  }), {
    activeRoute: { modeId: "system", guideId: "technical-architecture", headingId: "overview", query: "tenant", scope: "mode" },
    guideScroll: { "technical-architecture": 480 },
    recentGuides: ["technical-architecture", "source-references"],
    disclosures: { "technical-architecture": ["technical-architecture:runtime-architecture"] },
    diagramViews: { "doc-technical-and-functional-specification-md:diagram-1": { left: 18, top: 32 } },
    diagramZoom: { "doc-technical-and-functional-specification-md:diagram-1": 1.4, fit: "fit" },
    diagramModes: { "procurement-to-payment": "decision" },
    theme: "dark",
  });
  assert.deepEqual(normalizeStoredState(null), {
    activeRoute: { modeId: "home", guideId: "home", headingId: null, query: "", scope: "all" },
    guideScroll: {},
    recentGuides: [],
    disclosures: {},
    diagramViews: {},
    diagramZoom: {},
    diagramModes: {},
    theme: "light",
  });
});

test("migrates a genuine exact v2 legacy route into one v3 per-guide record", () => {
  const migrateV2State = runtimeFunction("migrateV2State", "readStoredState");
  const migrated = migrateV2State({
    activeTab: "workflows",
    activeArticle: "doc-process-reference-library-md",
    query: "  inspect delivery  ",
    scope: "tab",
    expandedIds: ["procurement-request-approval:policy-basis", "other-guide:document-controls"],
    diagramViews: { receiving: { left: 8, top: 12 } },
    diagramZoom: { receiving: 1.2 },
    diagramModes: { receiving: "role" },
    tabScroll: { workflows: 640 },
    theme: "dark",
  }, LEGACY_ROUTES);

  assert.deepEqual(migrated, {
    activeRoute: { modeId: "tasks", guideId: "procurement-request-approval", headingId: "document-controls", query: "inspect delivery", scope: "mode" },
    guideScroll: { "procurement-request-approval": 640 },
    recentGuides: ["procurement-request-approval"],
    disclosures: {
      "procurement-request-approval": ["procurement-request-approval:policy-basis"],
      "other-guide": ["other-guide:document-controls"],
    },
    diagramViews: { receiving: { left: 8, top: 12 } },
    diagramZoom: { receiving: 1.2 },
    diagramModes: { receiving: "role" },
    theme: "dark",
  });
});

test("does not restore an unmapped compatibility article during v2 migration", () => {
  const migrateV2State = runtimeFunction("migrateV2State", "readStoredState");
  const migrated = migrateV2State({
    activeTab: "workflows",
    activeArticle: "guide-stock-receiving-putaway",
    query: "stock",
    scope: "tab",
    tabScroll: { workflows: 900 },
  }, LEGACY_ROUTES);

  assert.deepEqual(migrated.activeRoute, { modeId: "home", guideId: "home", headingId: null, query: "stock", scope: "mode" });
  assert.deepEqual(migrated.guideScroll, {});
  assert.deepEqual(migrated.recentGuides, []);
});

test("keeps semantic diagram state IDs stable when diagrams are inserted or reordered", () => {
  const decorateArticleHtml = generatorFunction("decorateArticleHtml", "markdownHeadingEntries", {
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

test("restores a saved per-guide position through the document viewport", () => {
  const calls = [];
  const restoreStoredPosition = runtimeFunction("restoreStoredPosition", "activateLinkedRoute", {
    document: { getElementById: () => null },
    openContainingDisclosure: () => {},
    guideScroll: { "technical-architecture": 480 },
    window: { scrollTo: (options) => calls.push(options) },
  });

  restoreStoredPosition({ guideId: "technical-architecture", headingId: null });

  assert.deepEqual(calls, [{ left: 0, top: 480, behavior: "auto" }]);
});

test("uses window as the handbook reading scroll owner", () => {
  const html = buildDocumentationHtml();

  assert.match(html, /window\.addEventListener\('scroll'/);
  assert.doesNotMatch(html, /readingCanvas\.addEventListener\('scroll'/);
});

test("serializes and parses only canonical handbook routes", () => {
  const routeHash = runtimeFunction("routeHash", "isDrawerViewport");
  const parseRoute = runtimeFunction("parseRoute", "routeHash", { legacyRoutes: [] });
  const hash = routeHash({ modeId: "tasks", guideId: "procurement-request-approval", headingId: "steps", query: "three-way match", scope: "mode" });

  assert.equal(hash, "#mode=tasks&guide=procurement-request-approval&heading=steps&q=three-way+match&scope=mode");
  assert.deepEqual(parseRoute(hash), {
    modeId: "tasks",
    guideId: "procurement-request-approval",
    headingId: "steps",
    query: "three-way match",
    scope: "mode",
  });
  const defaultScopeHash = routeHash({ modeId: "home", guideId: "home", headingId: null, query: "", scope: "all" });
  assert.equal(defaultScopeHash, "#mode=home&guide=home");
  assert.deepEqual(parseRoute(""), { modeId: "home", guideId: "home", headingId: null, query: "", scope: "all" });
  assert.deepEqual(parseRoute("#foo=bar"), { modeId: "", guideId: "", headingId: null, query: "", scope: "all" });
});

test("stores query and scope only inside the five-field active route", () => {
  const currentStoredState = runtimeFunction("currentStoredState", "schedulePersistence", {
    activeRoute: { modeId: "tasks", guideId: "procurement-request-approval", headingId: "steps", query: "approve", scope: "mode" },
    guideScroll: {},
    recentGuides: [],
    disclosures: {},
    diagramViews: {},
    diagramZoom: {},
    diagramModes: {},
    document: { documentElement: { dataset: { theme: "light" } } },
  });

  assert.deepEqual(currentStoredState(), {
    activeRoute: { modeId: "tasks", guideId: "procurement-request-approval", headingId: "steps", query: "approve", scope: "mode" },
    guideScroll: {},
    recentGuides: [],
    disclosures: {},
    diagramViews: {},
    diagramZoom: {},
    diagramModes: {},
    theme: "light",
  });
});

test("translates an exact legacy route but does not guess an unknown legacy target", () => {
  const legacyRoutes = [{
    legacyTabId: "workflows",
    legacyArticleId: "doc-manual-mwell-intra-user-manual-md",
    legacyHeadingId: "doc-manual-mwell-intra-user-manual-md-warehouse-flow",
    modeId: "tasks",
    guideId: "stock-receiving-putaway",
    headingId: "flow",
  }];
  const parseRoute = runtimeFunction("parseRoute", "routeHash", { legacyRoutes });

  assert.deepEqual(parseRoute("#tab=workflows&article=doc-manual-mwell-intra-user-manual-md&heading=doc-manual-mwell-intra-user-manual-md-warehouse-flow"), {
    modeId: "tasks",
    guideId: "stock-receiving-putaway",
    headingId: "flow",
    query: "",
    scope: "all",
  });
  assert.deepEqual(parseRoute("#tab=workflows&article=unknown"), {
    modeId: "",
    guideId: "",
    headingId: null,
    query: "",
    scope: "all",
  });
});

test("renders canonical guide hashes while preserving compatibility data hooks", () => {
  const html = buildDocumentationHtml();
  const match = html.match(/href="(#mode=tasks&amp;guide=stock-receiving-putaway)"[^>]+data-guide-link[^>]+data-mode="tasks"[^>]+data-tab="workflows"[^>]+data-article="guide-stock-receiving-putaway"/);
  assert.ok(match);
  const browserHref = match[1].replaceAll("&amp;", "&");
  const params = new URLSearchParams(browserHref.slice(1));
  assert.deepEqual(Object.fromEntries(params), {
    mode: "tasks",
    guide: "stock-receiving-putaway",
  });
  assert.doesNotMatch(html, /href="#tab=/);
});
