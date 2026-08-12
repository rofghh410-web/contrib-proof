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
  const requests = [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } },
    { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "repo_inventory", arguments: {} } },
    { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "repo_plan", arguments: {} } },
    { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "repo_review", arguments: {} } },
    { jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "repo_gate", arguments: {} } }
  ].map((request) => JSON.stringify(request)).join("\n") + "\n";
  const result = spawnSync(process.execPath, [bin, "mcp", "--root", healthy], { input: requests, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const responses = result.stdout.trim().split(/\r?\n/).map((line) => JSON.parse(line));
  assert.equal(responses[0].result.protocolVersion, "2024-11-05");
  assert.equal(responses[1].result.tools.length, 6);
  assert.ok(responses[2].result.structuredContent.fileCount >= 4);
  assert.ok(Array.isArray(responses[3].result.structuredContent.items));
  assert.equal(responses[4].result.structuredContent.kind, "change-review");
  assert.equal(responses[5].result.structuredContent.kind, "gate-result");
  assert.equal(responses[5].result.structuredContent.status, "pass");
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
