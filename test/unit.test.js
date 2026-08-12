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
const { validateBaseline, validateDoctor, validateExceptions, validateGate, validatePlan, validateRelease, validateReport, validateReview } = require("../src/validate");
const { buildReviewPacket, formatReviewMarkdown, parseDiffPatch } = require("../src/review");
const { evaluateGate, formatGateMarkdown, validateGatePolicy } = require("../src/gate");
const { buildGithubAnnotations, formatGithubAnnotations, normalizeAnnotationPath } = require("../src/annotations");
const { buildReleaseReadiness, formatReleaseMarkdown } = require("../src/release");
const { appendHistory, historyEntry, readHistory, resolveHistoryPath, summarizeHistory } = require("../src/history");
const { evaluateBaseline, formatBaselineMarkdown } = require("../src/baseline");
const { applyExceptions, buildExceptionChecks, readExceptions, resolveExceptionsPath } = require("../src/exceptions");
const { buildDoctorReport } = require("../src/doctor");
const { appendLedger, readLedger, resolveLedgerPath, verifyLedger } = require("../src/ledger");
const { buildVerificationReport } = require("../src/engine");
const { createProofManifest, verifyProofBundle, writeProofBundle } = require("../src/proof");
const { runFixtureSuite } = require("../src/fixtures");
const { validateExecutionContext, validateFixtureSuite, validateProofManifest, validateProofVerification } = require("../src/validate");

test("shared verification engine records reproducible execution context", () => {
  const fixtureRoot = path.resolve(__dirname, "fixtures", "healthy");
  const report = buildVerificationReport(fixtureRoot, { execute: true });
  assert.equal(report.context.schemaVersion, 1);
  assert.equal(report.context.configuration.path, ".contrib-proof.json");
  assert.equal(report.context.options.execute, true);
  assert.equal(validateExecutionContext(report.context).valid, true);
  assert.equal(validateReport(report).valid, true);
});

test("proof verification detects changed manifests and unsafe evidence paths", () => {
  const fixtureRoot = path.resolve(__dirname, "fixtures", "healthy");
  const report = buildVerificationReport(fixtureRoot, { execute: true });
  const manifest = createProofManifest(fixtureRoot, report);
  report.proof = manifest;
  const bundle = fs.mkdtempSync(path.join(os.tmpdir(), "contrib-proof-verify-"));
  writeProofBundle(bundle, report, manifest);
  const valid = verifyProofBundle(bundle, fixtureRoot);
  assert.equal(valid.valid, true);
  assert.equal(validateProofManifest(manifest).valid, true);
  assert.equal(validateProofVerification(valid).valid, true);

  const changed = JSON.parse(fs.readFileSync(path.join(bundle, "manifest.json"), "utf8"));
  changed.files[0].sha256 = "0".repeat(64);
  fs.writeFileSync(path.join(bundle, "manifest.json"), `${JSON.stringify(changed, null, 2)}\n`);
  const invalidHash = verifyProofBundle(bundle, fixtureRoot);
  assert.equal(invalidHash.valid, false);
  assert.ok(invalidHash.errors.some((error) => error.includes("SHA-256 changed") || error.includes("evidenceHash")));

  changed.files[0].path = "../outside.txt";
  fs.writeFileSync(path.join(bundle, "manifest.json"), `${JSON.stringify(changed, null, 2)}\n`);
  const invalidPath = verifyProofBundle(bundle, fixtureRoot);
  assert.equal(invalidPath.valid, false);
  assert.ok(invalidPath.errors.some((error) => error.includes("remain relative")));
});

test("fixture suite is declarative and validates as a public artifact", () => {
  const fixtureRoot = path.resolve(__dirname, "..", ".");
  const suite = runFixtureSuite(fixtureRoot, ".contrib-proof-fixtures.json", { allowExecute: false });
  assert.equal(suite.valid, true);
  assert.equal(suite.summary.total, 2);
  assert.equal(validateFixtureSuite(suite).valid, true);
  assert.throws(() => runFixtureSuite(fixtureRoot, "../outside-fixtures.json"), /inside the repository root/);
});

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
  assert.match(formatHtml({ ...report, exceptions: { path: ".contrib-proof-exceptions.json", exists: false, total: 0, active: 0, expired: 0, invalid: 0, errors: [], exceptions: [], applied: false } }), /Policy exceptions/);
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

test("release readiness correlates Git history with release metadata and evidence signals", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "contrib-proof-release-"));
  const git = (args) => require("node:child_process").spawnSync("git", args, { cwd: directory, encoding: "utf8" });
  fs.mkdirSync(path.join(directory, "src"), { recursive: true });
  fs.mkdirSync(path.join(directory, "test"), { recursive: true });
  fs.mkdirSync(path.join(directory, "docs"), { recursive: true });
  fs.writeFileSync(path.join(directory, "README.md"), "# Fixture\n");
  fs.writeFileSync(path.join(directory, "LICENSE"), "Fixture license\n");
  fs.writeFileSync(path.join(directory, "package.json"), JSON.stringify({ name: "fixture", version: "0.5.0" }) + "\n");
  fs.writeFileSync(path.join(directory, "CITATION.cff"), "version: 0.5.0\n");
  fs.writeFileSync(path.join(directory, "CHANGELOG.md"), "# Changelog\n\n## 0.5.0\n");
  fs.writeFileSync(path.join(directory, "src", "app.js"), "export const value = 1;\n");
  assert.equal(git(["init", "-b", "main"]).status, 0);
  assert.equal(git(["config", "user.email", "test@example.invalid"]).status, 0);
  assert.equal(git(["config", "user.name", "ContribProof Test"]).status, 0);
  assert.equal(git(["add", "."]).status, 0);
  assert.equal(git(["commit", "-m", "baseline"]).status, 0);
  fs.writeFileSync(path.join(directory, "package.json"), JSON.stringify({ name: "fixture", version: "0.6.0" }) + "\n");
  fs.writeFileSync(path.join(directory, "CITATION.cff"), "version: 0.6.0\n");
  fs.writeFileSync(path.join(directory, "CHANGELOG.md"), "# Changelog\n\n## 0.6.0\n\n- release\n\n## 0.5.0\n");
  fs.writeFileSync(path.join(directory, "src", "app.js"), "export const value = 2;\n");
  fs.writeFileSync(path.join(directory, "test", "app.test.js"), "assert.equal(2, 2);\n");
  fs.writeFileSync(path.join(directory, "docs", "release.md"), "Release notes.\n");
  assert.equal(git(["add", "."]).status, 0);
  assert.equal(git(["commit", "-m", "release evidence"]).status, 0);
  const release = buildReleaseReadiness({
    root: directory,
    since: "HEAD~1",
    report: { checks: [{ id: "command:test", status: "pass" }], review: { findings: [] } }
  });
  assert.equal(release.available, true);
  assert.equal(release.version, "0.6.0");
  assert.equal(release.summary.status, "pass");
  assert.equal(validateRelease(release).valid, true);
  assert.match(formatReleaseMarkdown(release), /release readiness/);
});

test("history stores summaries only and calculates maintenance trends", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "contrib-proof-history-"));
  const report = {
    generatedAt: "2026-08-12T00:00:00.000Z",
    tool: { name: "ContribProof", version: "0.6.0" },
    mode: "verify",
    summary: { status: "pass", score: 96, pass: 4, warn: 1, fail: 0, skip: 0 },
    checks: [{ evidence: [{ path: "src/secret.js", output: "do-not-copy" }] }],
    proof: { bundleHash: "a".repeat(64) }
  };
  const entry = historyEntry(report, { recordedAt: "2026-08-12T00:01:00.000Z" });
  assert.equal(entry.score, 96);
  assert.doesNotMatch(JSON.stringify(entry), /do-not-copy|secret\.js/);
  appendHistory(directory, report, "metrics/history.jsonl", { recordedAt: entry.recordedAt });
  const history = readHistory(directory, "metrics/history.jsonl");
  const summary = summarizeHistory(history.entries);
  assert.equal(history.errors.length, 0);
  assert.equal(summary.runs, 1);
  assert.equal(summary.latestScore, 96);
  assert.equal(summary.failureRate, 0);
  assert.throws(() => resolveHistoryPath(directory, "../outside.jsonl"), /inside the repository root/);
});

test("baseline regression budgets are deterministic and validate as public artifacts", () => {
  const baseline = {
    summary: { status: "pass", score: 100 },
    checks: [{ id: "stable", status: "pass", severity: "info", message: "ok", evidence: [] }]
  };
  const current = {
    summary: { status: "fail", score: 75 },
    checks: [{ id: "stable", status: "fail", severity: "error", message: "regressed", evidence: [] }]
  };
  const blocked = evaluateBaseline(baseline, current);
  assert.equal(blocked.status, "fail");
  assert.equal(blocked.summary.newlyFailing, 1);
  assert.equal(validateBaseline(blocked).valid, true);
  const allowed = evaluateBaseline(baseline, current, { maxNewFailures: 1, maxScoreDrop: 25 });
  assert.equal(allowed.status, "pass");
  assert.match(formatBaselineMarkdown(allowed), /within the configured regression budget/);
});

test("policy exceptions are time-bounded, explicit, and preserve original findings", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "contrib-proof-exceptions-"));
  const file = path.join(directory, ".contrib-proof-exceptions.json");
  fs.writeFileSync(file, JSON.stringify({ version: 1, exceptions: [{ id: "maint-1", checkId: "required-file:LICENSE", reason: "Migration tracked separately", owner: "maintainer", expiresAt: "2099-01-01T00:00:00.000Z" }] }));
  const result = readExceptions(directory);
  assert.equal(result.errors.length, 0);
  assert.equal(validateExceptions(JSON.parse(fs.readFileSync(file, "utf8"))).valid, true);
  assert.equal(buildExceptionChecks(result)[0].status, "pass");
  const [effective] = applyExceptions([{ id: "required-file:LICENSE", category: "repository-basics", status: "fail", severity: "error", title: "Missing", message: "Add it", evidence: [] }], result.exceptions);
  assert.equal(effective.status, "skip");
  assert.equal(effective.originalStatus, "fail");
  assert.equal(effective.exception.id, "maint-1");
  fs.writeFileSync(file, JSON.stringify({ version: 1, exceptions: [{ id: "expired", checkId: "x", reason: "old", owner: "maintainer", expiresAt: "2000-01-01T00:00:00.000Z" }] }));
  assert.equal(buildExceptionChecks(readExceptions(directory))[0].status, "fail");
  fs.writeFileSync(file, JSON.stringify({ version: 1, exceptions: [
    { id: "duplicate", checkId: "x", reason: "one", owner: "maintainer", expiresAt: "2099-01-01T00:00:00.000Z" },
    { id: "duplicate", checkId: "x", reason: "two", owner: "maintainer", expiresAt: "2099-01-01T00:00:00.000Z" }
  ] }));
  assert.equal(readExceptions(directory).errors.length, 1);
  assert.throws(() => resolveExceptionsPath(directory, "../outside.json"), /inside the repository root/);
});

test("maintenance ledger chains summaries and detects tampering", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "contrib-proof-ledger-"));
  const report = { generatedAt: "2026-08-12T00:00:00.000Z", tool: { name: "ContribProof", version: "0.7.0" }, mode: "verify", summary: { status: "pass", score: 100, pass: 1, warn: 0, fail: 0, skip: 0 } };
  appendLedger(directory, report, "records/ledger.jsonl", { recordedAt: "2026-08-12T00:01:00.000Z" });
  appendLedger(directory, report, "records/ledger.jsonl", { recordedAt: "2026-08-12T00:02:00.000Z" });
  const ledger = readLedger(directory, "records/ledger.jsonl");
  assert.equal(ledger.valid, true);
  assert.equal(ledger.entries.length, 2);
  assert.equal(verifyLedger(directory, "records/ledger.jsonl").entries, 2);
  const ledgerPath = resolveLedgerPath(directory, "records/ledger.jsonl");
  const lines = fs.readFileSync(ledgerPath, "utf8").trim().split(/\r?\n/);
  fs.writeFileSync(ledgerPath, `${lines[0]}\n\n${lines[1]}\n`);
  assert.equal(readLedger(directory, "records/ledger.jsonl").valid, false);
  fs.writeFileSync(ledgerPath, `${lines.join("\n")}\n`);
  lines[0] = lines[0].replace('"status":"pass"', '"status":"fail"');
  fs.writeFileSync(ledgerPath, `${lines.join("\n")}\n`);
  assert.equal(readLedger(directory, "records/ledger.jsonl").valid, false);
  assert.throws(() => resolveLedgerPath(directory, "../outside.jsonl"), /inside the repository root/);
});

test("doctor report is read-only and has a validated contract", () => {
  const report = buildDoctorReport(process.cwd());
  assert.equal(report.kind, "doctor-report");
  assert.equal(validateDoctor(report).valid, true);
  assert.ok(report.checks.some((check) => check.id === "doctor:node-version"));
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
