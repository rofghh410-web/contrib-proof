const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const bin = path.join(root, "bin", "contrib-proof.js");
const healthy = path.join(__dirname, "fixtures", "healthy");
const unhealthy = path.join(__dirname, "fixtures", "unhealthy");

function runCli(args, cwd = root) {
  return spawnSync(process.execPath, [bin, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, CI: "1" }
  });
}

test("version flag reports the public release version", () => {
  const result = runCli(["--version"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "0.9.0");
});

test("healthy fixture passes executable verification", () => {
  const result = runCli(["verify", "--root", healthy, "--execute", "--format", "json"]);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.summary.fail, 0);
  assert.equal(report.summary.status, "pass");
  assert.ok(report.inventory.fileCount >= 4);
  assert.ok(report.proof.bundleHash);
});

test("unhealthy fixture exposes evidence for missing files, links, and commands", () => {
  const result = runCli(["verify", "--root", unhealthy, "--execute", "--format", "json"]);
  assert.equal(result.status, 1);
  const report = JSON.parse(result.stdout);
  const ids = report.checks.map((check) => check.id);
  assert.ok(ids.includes("required-file:CONTRIBUTING.md"));
  assert.ok(ids.some((id) => id.startsWith("broken-link:")));
  assert.ok(ids.includes("command:failing"));
  assert.ok(report.checks.find((check) => check.id === "command:failing").evidence[0].output.includes(""));
});

test("proof command writes a complete bundle", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "contrib-proof-test-"));
  const bundle = path.join(directory, "bundle");
  const result = runCli(["proof", "--root", healthy, "--execute", "--format", "json", "--bundle", bundle]);
  assert.equal(result.status, 0, result.stderr);
  for (const name of ["manifest.json", "report.json", "report.md", "report.sarif", "report.html", "plan.json", "plan.md", "review.json", "review.md"]) {
    assert.ok(fs.existsSync(path.join(bundle, name)), name);
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(bundle, "manifest.json"), "utf8"));
  assert.equal(manifest.algorithm, "sha256");
  assert.equal(manifest.bundleHash.length, 64);
  const validation = runCli(["validate", path.join(bundle, "report.json")]);
  assert.equal(validation.status, 0, validation.stderr);
  const manifestValidation = runCli(["validate", path.join(bundle, "manifest.json"), "--kind", "proof-manifest", "--format", "json"]);
  assert.equal(manifestValidation.status, 0, manifestValidation.stderr);
  const verified = runCli(["proof-verify", bundle, "--root", healthy, "--format", "json"]);
  assert.equal(verified.status, 0, verified.stderr);
  assert.equal(JSON.parse(verified.stdout).valid, true);
});

test("attestation CLI signs and verifies a proof bundle against a public trust root", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "contrib-proof-attestation-cli-"));
  const bundle = path.join(directory, "bundle");
  const privateKey = path.join(directory, "private.pem");
  const publicKey = path.join(directory, "public.pem");
  const keygen = runCli(["attest-keygen", "--private-key", privateKey, "--public-key", publicKey]);
  assert.equal(keygen.status, 0, keygen.stderr);
  assert.ok(JSON.parse(keygen.stdout).publicKeySha256);
  const proof = runCli(["proof", "--root", healthy, "--execute", "--format", "json", "--bundle", bundle]);
  assert.equal(proof.status, 0, proof.stderr);
  const signed = runCli(["attest", bundle, "--private-key", privateKey, "--key-id", "cli-key"]);
  assert.equal(signed.status, 0, signed.stderr);
  const attestationPath = path.join(bundle, "attestation.json");
  assert.ok(fs.existsSync(attestationPath));
  const verification = runCli(["attest-verify", attestationPath, "--public-key", publicKey, "--bundle", bundle, "--format", "json"]);
  assert.equal(verification.status, 0, verification.stderr);
  const result = JSON.parse(verification.stdout);
  assert.equal(result.valid, true);
  assert.equal(result.signatureValid, true);
  assert.equal(result.keyTrusted, true);
  assert.equal(result.subjectValid, true);
  const validation = runCli(["validate", attestationPath, "--kind", "proof-attestation", "--format", "json"]);
  assert.equal(validation.status, 0, validation.stderr);
  assert.equal(JSON.parse(validation.stdout).valid, true);
});

test("fixture command enforces declarative status and check contracts", () => {
  const result = runCli(["fixtures", "--root", root, "--execute", "--format", "json"]);
  assert.equal(result.status, 0, result.stderr);
  const suite = JSON.parse(result.stdout);
  assert.equal(suite.kind, "fixture-suite");
  assert.equal(suite.valid, true);
  assert.equal(suite.summary.passed, 2);
});

test("markdown and SARIF formats are emitted", () => {
  const markdown = runCli(["verify", "--root", healthy, "--format", "markdown"]);
  assert.equal(markdown.status, 0);
  assert.match(markdown.stdout, /# ContribProof report/);
  const sarif = runCli(["verify", "--root", unhealthy, "--format", "sarif"]);
  assert.equal(sarif.status, 1);
  const parsed = JSON.parse(sarif.stdout);
  assert.equal(parsed.version, "2.1.0");
  assert.ok(Array.isArray(parsed.runs[0].results));
  const html = runCli(["verify", "--root", healthy, "--format", "html"]);
  assert.equal(html.status, 0);
  assert.match(html.stdout, /<!doctype html>/i);
  assert.match(html.stdout, /Execution context/);
});

test("init refuses to overwrite configuration without --force", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "contrib-proof-init-"));
  const first = runCli(["init", "--root", directory]);
  assert.equal(first.status, 0);
  const second = runCli(["init", "--root", directory]);
  assert.equal(second.status, 2);
  const forced = runCli(["init", "--root", directory, "--force"]);
  assert.equal(forced.status, 0);
  assert.equal(JSON.parse(fs.readFileSync(path.join(directory, ".contrib-proof.json"), "utf8")).version, 1);
});

test("MCP server exposes read-only tools and structured inventory", () => {
  const proofBundle = path.join(healthy, ".mcp-proof-bundle");
  fs.rmSync(proofBundle, { recursive: true, force: true });
  const proof = runCli(["proof", "--root", healthy, "--execute", "--format", "json", "--bundle", proofBundle]);
  assert.equal(proof.status, 0, proof.stderr);
  const requests = [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } },
    { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "repo_inventory", arguments: {} } },
    { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "repo_plan", arguments: {} } },
    { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "repo_review", arguments: {} } },
    { jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "repo_gate", arguments: {} } },
    { jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "repo_release", arguments: {} } },
    { jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "repo_verify", arguments: {} } },
    { jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "repo_doctor", arguments: {} } },
    { jsonrpc: "2.0", id: 10, method: "tools/call", params: { name: "repo_ledger", arguments: {} } },
    { jsonrpc: "2.0", id: 11, method: "tools/call", params: { name: "repo_proof_verify", arguments: { bundlePath: ".mcp-proof-bundle" } } },
    { jsonrpc: "2.0", id: 12, method: "tools/call", params: { name: "repo_fixtures", arguments: {} } }
  ].map((request) => JSON.stringify(request)).join("\n") + "\n";
  const result = spawnSync(process.execPath, [bin, "mcp", "--root", healthy], { input: requests, encoding: "utf8" });
  fs.rmSync(proofBundle, { recursive: true, force: true });
  assert.equal(result.status, 0, result.stderr);
  const responses = result.stdout.trim().split(/\r?\n/).map((line) => JSON.parse(line));
  assert.equal(responses[0].result.protocolVersion, "2024-11-05");
  assert.equal(responses[0].result.serverInfo.version, "0.9.0");
  assert.equal(responses[1].result.tools.length, 12);
  assert.ok(responses[2].result.structuredContent.fileCount >= 4);
  assert.ok(Array.isArray(responses[3].result.structuredContent.items));
  assert.equal(responses[4].result.structuredContent.kind, "change-review");
  assert.equal(responses[5].result.structuredContent.kind, "gate-result");
  assert.equal(responses[5].result.structuredContent.status, "pass");
  assert.equal(responses[6].result.structuredContent.kind, "release-readiness");
  assert.equal(responses[8].result.structuredContent.kind, "doctor-report");
  assert.equal(responses[9].result.structuredContent.kind, "ledger-verification");
  assert.equal(responses[10].result.structuredContent.kind, "proof-verification");
  assert.equal(responses[10].result.structuredContent.valid, true);
  assert.equal(responses[11].result.structuredContent.kind, "fixture-suite");
});

test("baseline, exceptions, and ledger CLI commands create auditable artifacts", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "contrib-proof-control-plane-"));
  const baselinePath = path.join(directory, "baseline.json");
  const currentPath = path.join(directory, "current.json");
  const first = runCli(["verify", "--root", healthy, "--format", "json"]);
  assert.equal(first.status, 0, first.stderr);
  const baseline = JSON.parse(first.stdout);
  const current = JSON.parse(first.stdout);
  const target = current.checks.find((check) => check.status === "pass");
  target.status = "fail";
  target.severity = "error";
  target.message = "Synthetic regression for the baseline gate.";
  current.summary = { ...current.summary, status: "fail", score: Math.max(0, current.summary.score - 25), pass: Math.max(0, current.summary.pass - 1), fail: current.summary.fail + 1 };
  fs.writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
  fs.writeFileSync(currentPath, `${JSON.stringify(current, null, 2)}\n`);
  const blocked = runCli(["baseline", baselinePath, currentPath, "--format", "json"]);
  assert.equal(blocked.status, 1, blocked.stderr);
  assert.equal(JSON.parse(blocked.stdout).kind, "baseline-decision");
  const allowed = runCli(["baseline", baselinePath, currentPath, "--max-new-failures", "1", "--max-score-drop", "25", "--format", "json"]);
  assert.equal(allowed.status, 0, allowed.stderr);
  assert.equal(JSON.parse(allowed.stdout).status, "pass");
  const ledgerPath = "records/ledger.jsonl";
  const ledger = runCli(["ledger", "--root", directory, "--record", baselinePath, "--ledger-path", ledgerPath, "--format", "json"]);
  assert.equal(ledger.status, 0, ledger.stderr);
  assert.equal(JSON.parse(ledger.stdout).entries, 1);
  const secondLedger = runCli(["ledger", "--root", directory, "--record", currentPath, "--ledger-path", ledgerPath, "--format", "json"]);
  assert.equal(secondLedger.status, 0, secondLedger.stderr);
  assert.equal(JSON.parse(secondLedger.stdout).entries, 2);
});

test("release command writes release evidence and history can record it", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "contrib-proof-release-cli-"));
  const git = (args) => spawnSync("git", args, { cwd: directory, encoding: "utf8" });
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
  const bundle = path.join(directory, "release-bundle");
  const reportPath = path.join(directory, "report.json");
  const release = runCli(["release", "--root", directory, "--since", "HEAD~1", "--format", "json", "--output", reportPath, "--bundle", bundle]);
  assert.equal(release.status, 0, release.stderr);
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  assert.equal(report.release.kind, "release-readiness");
  assert.equal(report.release.summary.status, "pass");
  assert.ok(fs.existsSync(path.join(bundle, "release.json")));
  assert.ok(fs.existsSync(path.join(bundle, "release.md")));
  assert.equal(runCli(["validate", reportPath]).status, 0);
  assert.equal(runCli(["validate", path.join(bundle, "release.json"), "--kind", "release"]).status, 0);
  const historyPath = path.join(directory, "maintenance.jsonl");
  const history = runCli(["history", "--root", directory, "--record", reportPath, "--history-path", "maintenance.jsonl", "--format", "json"]);
  assert.equal(history.status, 0, history.stderr);
  const historySummary = JSON.parse(history.stdout);
  assert.equal(historySummary.runs, 1);
  assert.equal(historySummary.latestScore, report.summary.score);
  assert.ok(fs.existsSync(historyPath));
  assert.doesNotMatch(fs.readFileSync(historyPath, "utf8"), /Release notes|value = 2/);
  fs.writeFileSync(path.join(directory, "CHANGELOG.md"), "# Changelog\n\n## 0.5.0\n");
  const blocked = runCli(["release", "--root", directory, "--since", "HEAD~1", "--format", "json"]);
  assert.equal(blocked.status, 1, blocked.stderr);
  assert.match(blocked.stdout, /release:changelog/);
});

test("review command produces a change-risk packet from a real Git diff", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "contrib-proof-review-"));
  const git = (args) => spawnSync("git", args, { cwd: directory, encoding: "utf8" });
  fs.mkdirSync(path.join(directory, "src"), { recursive: true });
  fs.writeFileSync(path.join(directory, "README.md"), "# Review fixture\n");
  fs.writeFileSync(path.join(directory, "LICENSE"), "fixture license\n");
  fs.writeFileSync(path.join(directory, "src", "auth.js"), "export function login() { return true; }\n");
  assert.equal(git(["init", "-b", "main"]).status, 0);
  assert.equal(git(["config", "user.email", "test@example.invalid"]).status, 0);
  assert.equal(git(["config", "user.name", "ContribProof Test"]).status, 0);
  assert.equal(git(["add", "."]).status, 0);
  assert.equal(git(["commit", "-m", "baseline"]).status, 0);
  fs.writeFileSync(path.join(directory, "src", "auth.js"), "export function login() { return true; }\nconst token = \"sk-review-test-value-that-must-be-redacted\";\n");
  assert.equal(git(["add", "."]).status, 0);
  assert.equal(git(["commit", "-m", "change"]).status, 0);
  const result = runCli(["review", "--root", directory, "--base", "HEAD~1", "--format", "json"]);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.mode, "review");
  assert.equal(report.review.available, true);
  assert.equal(report.review.risk.level, "high");
  assert.doesNotMatch(result.stdout, /sk-review-test-value/);
  const bundle = path.join(directory, "gate-bundle");
  const gate = runCli(["gate", "--root", directory, "--base", "HEAD~1", "--format", "json", "--bundle", bundle]);
  assert.equal(gate.status, 1);
  const gateReport = JSON.parse(gate.stdout);
  assert.equal(gateReport.gate.kind, "gate-result");
  assert.equal(gateReport.gate.status, "fail");
  assert.ok(gateReport.gate.violations.length >= 1);
  assert.doesNotMatch(gate.stdout, /sk-review-test-value/);
  assert.ok(fs.existsSync(path.join(bundle, "gate.json")));
  assert.ok(fs.existsSync(path.join(bundle, "gate.md")));
  const gateValidation = runCli(["validate", path.join(bundle, "gate.json"), "--kind", "gate"]);
  assert.equal(gateValidation.status, 0, gateValidation.stderr);
});

test("gate command remains usable when review is unavailable and checks pass", () => {
  const result = runCli(["gate", "--root", healthy, "--format", "json"]);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.gate.status, "pass");
  assert.equal(report.gate.policy.requireReview, false);
});

test("GitHub annotations are opt-in and keep the report file parseable", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "contrib-proof-annotations-"));
  const reportPath = path.join(directory, "report.json");
  const result = runCli(["verify", "--root", unhealthy, "--format", "json", "--output", reportPath, "--github-annotations"]);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /::error title=ContribProof%3A/);
  assert.doesNotMatch(result.stdout, /OPENAI_API_KEY|sk-/);
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  assert.equal(report.schemaVersion, 1);
  const withoutOutput = runCli(["verify", "--root", healthy, "--github-annotations"]);
  assert.equal(withoutOutput.status, 2);
  assert.match(withoutOutput.stderr, /requires --output/);
});
