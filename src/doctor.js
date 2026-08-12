const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { loadConfig } = require("./config");
const { isGitRepository, runGit } = require("./git");
const { makeCheck } = require("./check");

function commandOnPath(command) {
  if (typeof command !== "string" || !command.trim()) return false;
  if (path.isAbsolute(command)) return fs.existsSync(command);
  const pathEntries = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
  return pathEntries.some((entry) => {
    const candidate = path.join(entry, command);
    try {
      return fs.existsSync(candidate) && fs.statSync(candidate).isFile();
    } catch {
      return false;
    }
  });
}

function versionTuple(value) {
  const match = String(value || "").match(/^(\d+)\.(\d+)\.(\d+)/);
  return match ? match.slice(1).map(Number) : null;
}

function atLeast(actual, expected) {
  const left = versionTuple(actual) || [0, 0, 0];
  for (let index = 0; index < expected.length; index += 1) {
    if (left[index] !== expected[index]) return left[index] > expected[index];
  }
  return true;
}

function makeDoctorCheck({ id, status, title, message, remediation = null, evidence = [] }) {
  return makeCheck({ id: `doctor:${id}`, category: "environment", status, severity: status === "fail" ? "error" : (status === "warn" ? "warning" : "info"), title, message, remediation, evidence });
}

function buildDoctorReport(root) {
  const resolvedRoot = path.resolve(root);
  const checks = [];
  const nodeVersion = process.versions.node;
  checks.push(makeDoctorCheck({
    id: "node-version",
    status: atLeast(nodeVersion, [20, 0, 0]) ? "pass" : "fail",
    title: atLeast(nodeVersion, [20, 0, 0]) ? "Node.js runtime is supported" : "Node.js runtime is too old",
    message: `Detected Node.js ${nodeVersion}; ContribProof requires Node.js 20 or newer.`,
    remediation: atLeast(nodeVersion, [20, 0, 0]) ? null : "Upgrade the runner or local runtime to Node.js 20 or newer.",
    evidence: []
  }));

  const gitRoot = runGit(resolvedRoot, ["rev-parse", "--show-toplevel"]);
  const exactGit = isGitRepository(resolvedRoot);
  checks.push(makeDoctorCheck({
    id: "git-root",
    status: exactGit ? "pass" : "fail",
    title: exactGit ? "Repository root is an exact Git work tree" : "Repository root is not an exact Git work tree",
    message: exactGit ? `Git resolved this root as ${gitRoot.stdout.trim()}.` : "Git history-dependent commands require the selected root itself to be a work tree.",
    remediation: exactGit ? null : "Run the command from the repository checkout, not a parent directory or nested fixture.",
    evidence: []
  }));

  const shallow = exactGit ? runGit(resolvedRoot, ["rev-parse", "--is-shallow-repository"]) : null;
  const isShallow = shallow?.ok && shallow.stdout.trim() === "true";
  checks.push(makeDoctorCheck({
    id: "git-history",
    status: !exactGit ? "skip" : (isShallow ? "warn" : "pass"),
    title: !exactGit ? "Git history depth could not be inspected" : (isShallow ? "Git checkout is shallow" : "Git history is available"),
    message: !exactGit ? "No exact Git work tree was available for the history check." : (isShallow ? "This checkout may not contain the base refs required for diff, release, or baseline analysis." : "The checkout is not marked as shallow."),
    remediation: isShallow ? "Fetch full history when running release-readiness or baseline analysis." : null,
    evidence: []
  }));

  const configInfo = loadConfig(resolvedRoot);
  checks.push(makeDoctorCheck({
    id: "configuration",
    status: configInfo.usedDefaults ? "warn" : (configInfo.errors.length ? "fail" : "pass"),
    title: configInfo.usedDefaults ? "Default configuration is active" : (configInfo.errors.length ? "Configuration is invalid" : "Configuration is valid"),
    message: configInfo.usedDefaults ? "No .contrib-proof.json was found; only the default policy is available." : (configInfo.errors.length ? configInfo.errors.join("; ") : "The repository configuration loaded successfully."),
    remediation: configInfo.usedDefaults ? "Run contrib-proof init and review the policy before enabling CI gates." : (configInfo.errors.length ? "Fix the configuration errors before relying on automated decisions." : null),
    evidence: configInfo.path ? [{ path: ".contrib-proof.json" }] : []
  }));

  const commandIds = [];
  for (const command of configInfo.config.commands || []) {
    const executable = command.run;
    const available = commandOnPath(executable);
    commandIds.push(command.id);
    checks.push(makeDoctorCheck({
      id: `command:${command.id}`,
      status: available ? "pass" : (command.required === false ? "warn" : "fail"),
      title: available ? `Configured executable is available: ${command.id}` : `Configured executable is missing: ${command.id}`,
      message: available ? `Found ${executable} on PATH without executing it.` : `Could not find ${executable} on PATH; no command was executed.`,
      remediation: available ? null : "Install the configured executable or update the repository command definition.",
      evidence: [{ path: ".contrib-proof.json" }]
    }));
  }
  if (!commandIds.length) {
    checks.push(makeDoctorCheck({
      id: "commands",
      status: "pass",
      title: "No configured commands require environment inspection",
      message: "The doctor only checks declared executables and does not execute arbitrary repository commands.",
      evidence: configInfo.path ? [{ path: ".contrib-proof.json" }] : []
    }));
  }

  const summary = { pass: 0, warn: 0, fail: 0, skip: 0, total: checks.length };
  for (const check of checks) summary[check.status] += 1;
  summary.score = Math.max(0, 100 - summary.fail * 30 - summary.warn * 10);
  summary.status = summary.fail ? "fail" : (summary.warn ? "needs-attention" : "pass");
  return {
    schemaVersion: 1,
    kind: "doctor-report",
    root: resolvedRoot,
    generatedAt: new Date().toISOString(),
    environment: { node: nodeVersion, platform: process.platform, arch: process.arch, cpuCount: os.cpus().length },
    summary,
    checks
  };
}

function formatDoctorMarkdown(report) {
  const lines = [
    "# ContribProof doctor",
    "",
    `- Status: **${report.summary.status}**`,
    `- Score: **${report.summary.score}/100**`,
    `- Runtime: **Node.js ${report.environment.node}** on **${report.environment.platform}/${report.environment.arch}**`,
    "",
    "## Diagnostics",
    ""
  ];
  for (const check of report.checks) {
    const icon = { pass: "✅", warn: "⚠️", fail: "❌", skip: "⏭️" }[check.status] || "•";
    lines.push(`### ${icon} ${check.title}`, "", check.message);
    if (check.remediation) lines.push("", `**Next step:** ${check.remediation}`);
    lines.push("");
  }
  return `${lines.join("\n").trim()}\n`;
}

module.exports = { buildDoctorReport, commandOnPath, formatDoctorMarkdown };
