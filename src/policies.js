const fs = require("node:fs");
const path = require("node:path");
const { makeCheck } = require("./check");
const { checkActionPinning, checkDependencyHygiene } = require("./dependencies");
const { buildLanguageAdapterChecks } = require("./adapters");

function readIfPresent(root, relative) {
  try {
    return fs.readFileSync(path.join(root, relative), "utf8");
  } catch {
    return null;
  }
}

function checkContributorDocumentation(root) {
  const checks = [];
  const contributing = readIfPresent(root, "CONTRIBUTING.md");
  if (contributing !== null) {
    const expectations = [
      { id: "setup", pattern: /install|setup|getting started/i, label: "setup or installation" },
      { id: "validation", pattern: /test|lint|check|verify/i, label: "validation commands" },
      { id: "pull-request", pattern: /pull request|pull-request|\bPR\b/i, label: "pull-request guidance" }
    ];
    const missing = expectations.filter((item) => !item.pattern.test(contributing));
    checks.push(makeCheck({
      id: "docs:contributing-signals",
      category: "contributor-experience",
      status: missing.length ? "warn" : "pass",
      severity: missing.length ? "warning" : "info",
      title: missing.length ? "CONTRIBUTING.md is missing contributor signals" : "CONTRIBUTING.md has core contributor signals",
      message: missing.length ? `Could not find: ${missing.map((item) => item.label).join(", ")}.` : "Setup, validation, and pull-request guidance were detected.",
      remediation: missing.length ? "Make the first contribution path explicit and runnable for a new contributor." : null,
      evidence: [{ path: "CONTRIBUTING.md" }]
    }));
  }

  const security = readIfPresent(root, "SECURITY.md");
  if (security !== null) {
    const hasReportPath = /report|contact|email|disclos/i.test(security);
    checks.push(makeCheck({
      id: "docs:security-contact",
      category: "security-maintenance",
      status: hasReportPath ? "pass" : "warn",
      severity: hasReportPath ? "info" : "warning",
      title: hasReportPath ? "Security policy exposes a reporting path" : "Security policy lacks an obvious reporting path",
      message: hasReportPath ? "A security contact or reporting instruction was detected." : "Contributors may not know where to report a vulnerability privately.",
      remediation: hasReportPath ? null : "Add a monitored reporting path and explain what information a report should contain.",
      evidence: [{ path: "SECURITY.md" }]
    }));
  }
  return checks;
}

function checkWorkflowSecurity(root, inventory) {
  const checks = [];
  for (const workflow of inventory.workflows || []) {
    if (!workflow.readable) continue;
    if (workflow.hasPullRequestTrigger && !workflow.permissions.length) {
      checks.push(makeCheck({
        id: `workflow:permissions:${workflow.path}`,
        category: "security-maintenance",
        status: "warn",
        severity: "warning",
        title: `Workflow ${workflow.path} has no explicit permissions block`,
        message: "Implicit GitHub token permissions make it harder to audit what a pull request workflow can do.",
        remediation: "Declare the smallest required permissions, usually contents: read for verification jobs.",
        evidence: [{ path: workflow.path }]
      }));
    }
    if (workflow.usesPullRequestTarget && workflow.usesWritePermission) {
      checks.push(makeCheck({
        id: `workflow:pull-request-target:${workflow.path}`,
        category: "security-maintenance",
        status: "warn",
        severity: "warning",
        title: `Review write permissions in ${workflow.path}`,
        message: "A pull_request_target workflow appears to request write access; untrusted pull-request code must not run with that token.",
        remediation: "Separate read-only preparation from trusted publishing, and document why any write permission is required.",
        evidence: [{ path: workflow.path }]
      }));
    }
  }
  if (!checks.length && (inventory.workflows || []).length) {
    checks.push(makeCheck({
      id: "workflow:security-baseline",
      category: "security-maintenance",
      status: "pass",
      title: "Workflow security baseline has no findings",
      message: `Inspected ${inventory.workflows.length} workflow file(s) for explicit permissions and pull-request target risks.`,
      remediation: null,
      evidence: inventory.workflows.map((workflow) => ({ path: workflow.path }))
    }));
  }
  if (!inventory.workflows || inventory.workflows.length === 0) {
    checks.push(makeCheck({
      id: "workflow:present",
      category: "repository-basics",
      status: "warn",
      severity: "warning",
      title: "No GitHub Actions workflow was discovered",
      message: "Automated verification is difficult to reproduce without a checked-in CI workflow.",
      remediation: "Add a minimal read-only CI workflow that runs the project tests and ContribProof.",
      evidence: []
    }));
  }
  return checks;
}

function checkPackageScripts(inventory) {
  if (!inventory.package || inventory.package.parseError) return [makeCheck({
    id: "package:scripts",
    category: "validation",
    status: "skip",
    severity: "info",
    title: "No readable package.json scripts were found",
    message: "The package-script policy is only relevant to repositories with a readable package.json.",
    remediation: null,
    evidence: []
  })];
  const scripts = inventory.package.scripts || {};
  const hasTest = Boolean(scripts.test || scripts.check || scripts.verify);
  return [makeCheck({
    id: "package:scripts",
    category: "validation",
    status: hasTest ? "pass" : "warn",
    severity: hasTest ? "info" : "warning",
    title: hasTest ? "package.json exposes a validation script" : "package.json has no obvious validation script",
    message: hasTest ? `Detected ${Object.keys(scripts).join(", ") || "a validation script"}.` : "A new contributor has no obvious npm entry point for verification.",
    remediation: hasTest ? null : "Add test, check, or verify and document which command is authoritative.",
    evidence: [{ path: "package.json" }]
  })];
}

function checkSensitiveFilenames(root, inventory) {
  const suspicious = (inventory.files || []).filter((file) => {
    const name = file.path.toLowerCase();
    if (/\.example\b|sample|fixture|testdata/.test(name)) return false;
    return /(^|\/)(\.env(?:\.[^/]+)?|id_rsa|credentials(?:\.[^/]+)?|[^/]+\.(?:pem|key|p12|pfx))$/.test(name);
  });
  if (!suspicious.length) return [makeCheck({
    id: "secrets:filenames",
    category: "security-maintenance",
    status: "pass",
    title: "No suspicious credential filenames were indexed",
    message: "This is only a filename signal; it is not a secret scanner.",
    remediation: null,
    evidence: []
  })];
  return [makeCheck({
    id: "secrets:filenames",
    category: "security-maintenance",
    status: "warn",
    severity: "warning",
    title: "Credential-like filenames are present",
    message: `${suspicious.length} file(s) look like credentials or private keys. ContribProof does not read their contents.`,
    remediation: "Confirm these are intentional fixtures or remove them from the repository and strengthen ignore rules.",
    evidence: suspicious.map((file) => ({ path: file.path }))
  })];
}

function runPolicyChecks(root, config, inventory) {
  return [
    ...checkContributorDocumentation(root),
    ...checkWorkflowSecurity(root, inventory),
    ...checkPackageScripts(inventory),
    ...checkSensitiveFilenames(root, inventory),
    ...checkDependencyHygiene(inventory, config.dependencyPolicy),
    ...checkActionPinning(root, inventory, config.dependencyPolicy),
    ...buildLanguageAdapterChecks(inventory.adapters)
  ];
}

module.exports = {
  checkContributorDocumentation,
  checkPackageScripts,
  checkSensitiveFilenames,
  checkWorkflowSecurity,
  runPolicyChecks
};
