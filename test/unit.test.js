const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { extractImports, extractSymbols, buildGraph, analyzeImpact } = require("../src/graph");
const { compareReports } = require("../src/compare");
const { checkChangePolicy } = require("../src/checks");
const { getChangedFiles, isGitRepository } = require("../src/git");
const { buildSafeEnvironment, executeCommand } = require("../src/runner");
const { explainReport, extractOutputText, redactReport } = require("../src/openai");
const { buildDependencyInventory, checkActionPinning, checkDependencyHygiene } = require("../src/dependencies");
const { formatHtml } = require("../src/html");
const { formatSarif } = require("../src/report");
const { buildRemediationPlan, formatPlanMarkdown } = require("../src/plan");
const { validateGate, validatePlan, validateReport, validateReview } = require("../src/validate");
const { buildReviewPacket, formatReviewMarkdown, parseDiffPatch } = require("../src/review");
const { evaluateGate, formatGateMarkdown, validateGatePolicy } = require("../src/gate");
const { buildGithubAnnotations, formatGithubAnnotations, normalizeAnnotationPath } = require("../src/annotations");

test("GitHub annotations escape untrusted text and keep evidence paths relative", () => {
  const report = {
    checks: [{
      status: "fail",
      title: "Bad, title: 100%",
      message: "first line\nsecond line",
      evidence: [{ path: "src\\main.js", line: 7, detail: "do not emit this" }]
    }],
    review: {
      findings: [{
        level: "high",
        title: "Credential-like value added",
        message: "Review the redacted value.",
        evidence: [{ path: "../outside.js", line: 2 }]
      }]
    }
  };
  const output = formatGithubAnnotations(report);
  assert.match(output, /::error title=ContribProof%3A Bad%2C title%3A 100%25,file=src\/main.js,line=7::first line%0Asecond line/);
  assert.match(output, /::error title=ContribProof%3A Credential-like value added,line=2::Review the redacted value\./);
  assert.doesNotMatch(output, /do not emit this/);
  assert.equal(normalizeAnnotationPath("/absolute/file.js"), null);
  assert.equal(normalizeAnnotationPath("C:\\absolute\\file.js"), null);
  assert.equal(normalizeAnnotationPath("src/../../outside.js"), null);
  assert.equal(normalizeAnnotationPath("./src/main.js"), "src/main.js");
});

test("GitHub annotation output reports truncation at a bounded limit", () => {
  const result = buildGithubAnnotations({
    checks: [{
      status: "warn",
      title: "Many findings",
      message: "Review these files.",
      evidence: [{ path: "a.js" }, { path: "b.js" }]
    }]
  }, { maxAnnotations: 1 });
  assert.equal(result.lines.length, 1);
  assert.equal(result.truncated, true);
  assert.match(formatGithubAnnotations({
    checks: [{ status: "warn", title: "Many findings", message: "Review these files.", evidence: [{ path: "a.js" }, { path: "b.js" }] }]
  }, { maxAnnotations: 1 }), /Additional findings were omitted/);
});

test("graph extraction finds symbols and relative imports", () => {
  const source = "import { helper } from './helper.js';\nexport function main() { return helper(); }";
  assert.deepEqual(extractImports("src/index.js", source)[0].target, "./helper.js");
  assert.equal(extractSymbols("src/index.js", source)[0].name, "main");
});

test("graph impact includes transitive importers", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "contrib-proof-graph-"));
  fs.mkdirSync(path.join(directory, "src"), { recursive: true });
  fs.writeFileSync(path.join(directory, "src", "core.js"), "export function core() {}\n");
  fs.writeFileSync(path.join(directory, "src", "feature.js"), "import { core } from './core.js';\nexport function feature() { return core(); }\n");
  fs.writeFileSync(path.join(directory, "src", "feature.test.js"), "import { feature } from './feature.js';\nfeature();\n");
  const graph = buildGraph(directory);
  const impact = analyzeImpact(directory, ["src/core.js"], graph);
  assert.ok(impact.impactedFiles.some((item) => item.file === "src/feature.js"));
  assert.ok(impact.testCandidates.some((item) => item.file === "src/feature.test.js"));
});

test("controlled runner executes without shell and returns bounded result", async () => {
  const result = await executeCommand({ run: process.execPath, args: ["-e", "process.stdout.write('ok')"] }, { cwd: process.cwd() });
  assert.equal(result.ok, true);
  assert.equal(result.stdout, "ok");
  assert.equal(buildSafeEnvironment({ OPENAI_API_KEY: "should-not-pass" }).OPENAI_API_KEY, undefined);
});

test("OpenAI explanation adapter uses Responses API output_text and redacts keys", async () => {
  let captured;
  const fakeFetch = async (url, options) => {
    captured = { url, options, body: JSON.parse(options.body) };
    return { ok: true, status: 200, json: async () => ({ output_text: "Evidence explanation" }) };
  };
  const report = { root: "/private/repo", configPath: "/private/repo/.contrib-proof.json", checks: [{ evidence: [{ path: "x", output: "OPENAI_API_KEY=sk-secret" }] }] };
  assert.equal(extractOutputText({ output_text: "x" }), "x");
  assert.equal(redactReport(report).checks[0].evidence[0].output.includes("sk-secret"), false);
  const explanation = await explainReport(report, { apiKey: "sk-test", fetchImpl: fakeFetch, model: "test-model" });
  assert.equal(explanation, "Evidence explanation");
  assert.match(captured.url, /\/responses$/);
  assert.equal(captured.body.model, "test-model");
  assert.equal(captured.body.input.includes("sk-secret"), false);
});

test("baseline comparison isolates new regressions and resolved checks", () => {
  const baseline = {
    summary: { status: "pass", score: 100 },
    checks: [
      { id: "a", status: "pass", severity: "info", message: "ok", evidence: [] },
      { id: "b", status: "warn", severity: "warning", message: "old warning", evidence: [] }
    ]
  };
  const current = {
    summary: { status: "fail", score: 75 },
    checks: [
      { id: "a", status: "fail", severity: "error", message: "new failure", evidence: [{ path: "src/a.js" }] },
      { id: "b", status: "pass", severity: "info", message: "fixed", evidence: [] },
      { id: "c", status: "warn", severity: "warning", message: "new warning", evidence: [] }
    ]
  };
  const comparison = compareReports(baseline, current);
  assert.equal(comparison.regression, true);
  assert.equal(comparison.newlyFailing.length, 1);
  assert.equal(comparison.newlyWarning.length, 1);
  assert.equal(comparison.resolved.length, 1);
});

test("change policy reports missing test evidence from a real Git diff", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "contrib-proof-git-"));
  const git = (args) => {
    const { spawnSync } = require("node:child_process");
    return spawnSync("git", args, { cwd: directory, encoding: "utf8" });
  };
  fs.mkdirSync(path.join(directory, "src"), { recursive: true });
  fs.writeFileSync(path.join(directory, "src", "app.js"), "export const value = 1;\n");
  assert.equal(git(["init", "-b", "main"]).status, 0);
  assert.equal(git(["config", "user.email", "test@example.invalid"]).status, 0);
  assert.equal(git(["config", "user.name", "ContribProof Test"]).status, 0);
  assert.equal(git(["add", "."]).status, 0);
  assert.equal(git(["commit", "-m", "baseline"]).status, 0);
  fs.writeFileSync(path.join(directory, "src", "app.js"), "export const value = 2;\n");
  assert.equal(git(["add", "."]).status, 0);
  assert.equal(git(["commit", "-m", "change"]).status, 0);
  const diff = getChangedFiles(directory, "HEAD~1");
  assert.equal(diff.ok, true);
  const checks = checkChangePolicy(directory, { changePolicy: { requireTestsForCode: true, requireDocsForUserFacingCode: false, requireChangelogForCode: false } }, "HEAD~1");
  assert.ok(checks.some((check) => check.id === "changes:tests" && check.status === "warn"));
});

test("Git checks do not borrow a parent repository for a nested root", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "contrib-proof-git-root-"));
  const nested = path.join(directory, "fixture");
  fs.mkdirSync(nested);
  const git = (args) => {
    const { spawnSync } = require("node:child_process");
    return spawnSync("git", args, { cwd: directory, encoding: "utf8" });
  };
  assert.equal(git(["init", "-b", "main"]).status, 0);
  assert.equal(git(["config", "user.email", "test@example.invalid"]).status, 0);
  assert.equal(git(["config", "user.name", "ContribProof Test"]).status, 0);
  fs.writeFileSync(path.join(directory, "README.md"), "# root\n");
  assert.equal(git(["add", "."]).status, 0);
  assert.equal(git(["commit", "-m", "baseline"]).status, 0);
  assert.equal(isGitRepository(directory), true);
  assert.equal(isGitRepository(nested), false);
  assert.equal(getChangedFiles(nested).ok, false);
});

test("dependency inventory distinguishes manifests with and without lockfiles", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "contrib-proof-dependencies-"));
  fs.writeFileSync(path.join(directory, "package.json"), JSON.stringify({ dependencies: { example: "^1.0.0" } }));
  const files = [{ path: "package.json" }];
  const unlocked = buildDependencyInventory(directory, files);
  assert.deepEqual(unlocked.unlocked, ["package.json"]);
  fs.writeFileSync(path.join(directory, "package-lock.json"), "{}\n");
  const locked = buildDependencyInventory(directory, [...files, { path: "package-lock.json" }]);
  assert.deepEqual(locked.unlocked, []);
  assert.equal(checkDependencyHygiene({ dependencies: unlocked }, { requireLockfile: true })[0].status, "warn");
  assert.equal(checkDependencyHygiene({ dependencies: locked }, { requireLockfile: true })[0].status, "pass");
});

test("workflow action pinning reports mutable refs and accepts full SHAs", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "contrib-proof-actions-"));
  fs.mkdirSync(path.join(directory, ".github", "workflows"), { recursive: true });
  fs.writeFileSync(path.join(directory, ".github", "workflows", "ci.yml"), [
    "steps:",
    "  - uses: actions/checkout@v4",
    `  - uses: acme/action@${"a".repeat(40)}`
  ].join("\n"));
  const inventory = { workflows: [{ path: ".github/workflows/ci.yml" }] };
  const findings = checkActionPinning(directory, inventory, { checkActionPinning: true, allowedActionRefs: [] });
  assert.equal(findings[0].status, "warn");
  assert.equal(findings[0].evidence.length, 1);
  const allowed = checkActionPinning(directory, inventory, { checkActionPinning: true, allowedActionRefs: ["actions/checkout@v4"] });
  assert.equal(allowed[0].status, "pass");
});

test("remediation plan is deterministic and HTML escapes repository text", () => {
  const report = {
    schemaVersion: 1,
    tool: { name: "ContribProof", version: "0.5.0" },
    mode: "verify",
    summary: { score: 50, pass: 1, warn: 1, fail: 1, skip: 0 },
    checks: [
      { id: "docs:missing", category: "documentation", status: "warn", severity: "warning", title: "Docs", message: "Update docs", remediation: "Write it", evidence: [] },
      { id: "required-file:LICENSE", category: "repository-basics", status: "fail", severity: "error", title: "<unsafe>", message: "Missing", remediation: "Add it", evidence: [{ path: "LICENSE" }] },
      { id: "ok", category: "validation", status: "pass", severity: "info", title: "OK", message: "fine", evidence: [] }
    ]
  };
  const plan = buildRemediationPlan(report);
  assert.deepEqual(plan.items.map((item) => item.priority), ["P0", "P1"]);
  assert.match(formatPlanMarkdown(plan), /P0/);
  const html = formatHtml(report);
  assert.match(html, /&lt;unsafe&gt;/);
  assert.doesNotMatch(html, /<h2><unsafe>/);
  assert.match(html, /report-data/);
});

test("artifact validators accept generated contracts and reject malformed input", () => {
  const validReport = {
    schemaVersion: 1,
    tool: { name: "ContribProof", version: "0.5.0" },
    summary: { status: "pass", score: 100, pass: 1, warn: 0, fail: 0, skip: 0, total: 1 },
    checks: [{ id: "ok", category: "validation", status: "pass", title: "OK", message: "fine", evidence: [] }]
  };
  assert.equal(validateReport(validReport).valid, true);
  assert.equal(validatePlan(buildRemediationPlan(validReport)).valid, true);
  assert.equal(validateReport({ ...validReport, checks: [{ status: "unknown" }] }).valid, false);
});

test("change review packet finds high-risk additions without retaining secret values", () => {
  const patch = [
    "diff --git a/src/auth.js b/src/auth.js",
    "--- a/src/auth.js",
    "+++ b/src/auth.js",
    "@@ -1,1 +1,4 @@",
    " export function login() {}",
    "+const apiKey = \"sk-this-is-a-test-value-that-must-not-leak\";",
    "+<<<<<<< HEAD",
    "+const token = \"pending\";",
    "+======="
  ].join("\n");
  const parsed = parseDiffPatch(patch, [{ status: "M", path: "src/auth.js" }]);
  assert.equal(parsed.files[0].additions, 4);
  const packet = buildReviewPacket({
    root: process.cwd(),
    base: "HEAD~1",
    changedFiles: [{ status: "M", path: "src/auth.js" }],
    patch,
    impact: { testCandidates: [], impactedFiles: [{ file: "src/auth.js", direct: true }], importEdgesConsidered: 0, symbolNodes: 0 }
  });
  assert.equal(packet.available, true);
  assert.equal(packet.risk.level, "high");
  assert.ok(packet.findings.some((finding) => finding.id.startsWith("review:credential-assignment")));
  assert.ok(packet.findings.some((finding) => finding.id.startsWith("review:conflict-marker")));
  assert.ok(packet.findings.some((finding) => finding.id === "review:tests-missing"));
  assert.doesNotMatch(JSON.stringify(packet), /sk-this-is-a-test-value/);
  assert.match(formatReviewMarkdown(packet), /change review/);
  assert.equal(validateReview(packet).valid, true);
  const renderedReport = {
    schemaVersion: 1,
    tool: { name: "ContribProof", version: "0.5.0" },
    mode: "review",
    summary: { status: "pass", score: 100, pass: 0, warn: 0, fail: 0, skip: 0, total: 0 },
    checks: [],
    review: packet
  };
  assert.doesNotMatch(formatHtml(renderedReport), /sk-this-is-a-test-value/);
  assert.doesNotMatch(formatSarif(renderedReport), /sk-this-is-a-test-value/);
  assert.equal(validateReport({
    schemaVersion: 1,
    tool: { name: "ContribProof", version: "0.5.0" },
    summary: { status: "pass", score: 100, pass: 0, warn: 0, fail: 0, skip: 0, total: 0 },
    checks: [],
    review: packet
  }).valid, true);
});

test("maintainer gate turns deterministic review policy into an auditable decision", () => {
  const report = {
    summary: { status: "pass", score: 100, pass: 0, warn: 0, fail: 0, skip: 0, total: 0 },
    checks: [],
    review: {
      schemaVersion: 1,
      kind: "change-review",
      available: true,
      base: "HEAD~1",
      changedFiles: [{ path: "src/auth.js", status: "M", additions: 1, deletions: 0, binary: false, riskFactors: [] }],
      diff: { files: 1, additions: 1, deletions: 0, addedLinesTruncated: false },
      risk: { score: 75, level: "high", factors: [] },
      findings: [{
        id: "review:credential-assignment:src/auth.js:2",
        level: "high",
        category: "integrity",
        title: "Credential-like value added",
        message: "credential-assignment detected; value [redacted 32 characters].",
        remediation: "Remove the value and rotate it if it was real.",
        evidence: [{ path: "src/auth.js", line: 2, detail: "value [redacted 32 characters]" }]
      }],
      testPlan: { changedSourceFiles: ["src/auth.js"], changedTestFiles: [], candidates: [], missingSignals: ["src/auth.js"] },
      recommendations: ["Rotate any exposed credential."]
    }
  };
  const policy = { maxRisk: "elevated", failOnFindings: ["high"], failOnCheckFailures: true, failOnWarnings: false, requireReview: true };
  assert.deepEqual(validateGatePolicy(policy), []);
  const result = evaluateGate(report, policy);
  assert.equal(result.status, "fail");
  assert.equal(result.passed, false);
  assert.ok(result.violations.some((item) => item.id.startsWith("gate:review-finding:")));
  assert.ok(result.violations.some((item) => item.id === "gate:risk-threshold"));
  assert.match(formatGateMarkdown(result), /ContribProof gate/);
  assert.doesNotMatch(JSON.stringify(result), /real-secret/);
  assert.equal(validateGate(result).valid, true);
  const renderedReport = { ...report, gate: result };
  assert.match(formatHtml(renderedReport), /Merge gate/);
  assert.ok(JSON.parse(formatSarif(renderedReport)).runs[0].results.some((item) => item.ruleId === "gate:risk-threshold"));
  assert.equal(validateReport({ ...renderedReport, schemaVersion: 1, tool: { name: "ContribProof", version: "0.5.0" } }).valid, true);
});
