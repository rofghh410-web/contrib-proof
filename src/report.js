const fs = require("node:fs");
const path = require("node:path");
const { formatHtml } = require("./html");

const TOOL_NAME = "ContribProof";
const TOOL_VERSION = "0.8.2";

function summarize(checks, strict = false) {
  const counts = { pass: 0, warn: 0, fail: 0, skip: 0 };
  for (const check of checks) counts[check.status] = (counts[check.status] || 0) + 1;
  const score = Math.max(0, 100 - counts.fail * 25 - counts.warn * 8);
  const failed = counts.fail > 0 || (strict && counts.warn > 0);
  return {
    status: failed ? "fail" : (counts.warn ? "needs-attention" : "pass"),
    score,
    ...counts,
    total: checks.length
  };
}

function createReport({ root, checks, configPath, mode = "verify", strict = false, inventory = null, impact = null, review = null, release = null, context = null, exceptions = null, proof = null }) {
  return {
    schemaVersion: 1,
    tool: { name: TOOL_NAME, version: TOOL_VERSION },
    mode,
    root: path.resolve(root),
    configPath: configPath ? path.resolve(configPath) : null,
    generatedAt: new Date().toISOString(),
    summary: summarize(checks, strict),
    checks,
    inventory,
    impact,
    review,
    release,
    context,
    exceptions,
    proof
  };
}

function statusIcon(status) {
  return { pass: "✅", warn: "⚠️", fail: "❌", skip: "⏭️" }[status] || "•";
}

function formatMarkdown(report) {
  const summary = report.summary;
  const lines = [
    `# ContribProof report`,
    "",
    `- Status: **${summary.status}**`,
    `- Readiness score: **${summary.score}/100**`,
    `- Checks: ${summary.pass} passed, ${summary.warn} warnings, ${summary.fail} failures, ${summary.skip} skipped`,
    `- Mode: \`${report.mode}\``,
    "",
    "## Findings",
    ""
  ];

  if (report.inventory) {
    lines.push("## Repository inventory", "", `Indexed **${report.inventory.fileCount}** files across ${Object.keys(report.inventory.languageCounts || {}).length} language or file categories.`, "");
  }
  if (report.context) {
    const git = report.context.git || {};
    const runtime = report.context.runtime || {};
    const configuration = report.context.configuration || {};
    const options = report.context.options || {};
    const configurationLabel = `\`${configuration.path || "defaults"}\``;
    const configurationHash = configuration.sha256 ? ` (SHA-256 \`${configuration.sha256}\`)` : "";
    lines.push("## Execution context", "", `Runtime: **Node ${runtime.node || "unknown"}** on **${runtime.platform || "unknown"}/${runtime.arch || "unknown"}**.`, `Git: **${git.commit || "unavailable"}** on **${git.branch || "detached/unavailable"}**; dirty: **${git.dirty === null || git.dirty === undefined ? "unknown" : git.dirty ? "yes" : "no"}**; shallow: **${git.shallow === null || git.shallow === undefined ? "unknown" : git.shallow ? "yes" : "no"}**.`, `Configuration: ${configurationLabel}${configurationHash}.`, `Options: execute **${options.execute ? "on" : "off"}**, diff **${options.includeDiff ? "on" : "off"}**, base **${options.base || "none"}**, exceptions **${options.applyExceptions ? "applied" : "not applied"}**.`, "");
  }
  if (report.impact) {
    lines.push("## Change impact", "", `The static graph considered **${report.impact.importEdgesConsidered}** import edges and identified **${report.impact.impactedFiles.length}** potentially impacted files.`, "");
  }
  if (report.release) {
    if (!report.release.available) {
      lines.push("## Release readiness", "", `Release readiness unavailable: ${report.release.reason}`, "");
    } else {
      lines.push("## Release readiness", "", `Release **${report.release.version || "unspecified"}** is **${report.release.summary.status}** at **${report.release.summary.score}/100**.`, `The range contains **${report.release.commits.length}** non-merge commit(s) and **${report.release.changes.files}** changed file(s).`, "");
      for (const check of report.release.checks) {
        lines.push(`### ${statusIcon(check.status)} ${check.title}`, "", check.message);
        if (check.remediation) lines.push("", `**Next step:** ${check.remediation}`);
        lines.push("");
      }
      if (report.release.recommendations?.length) lines.push("**Recommendations:**", "", ...report.release.recommendations.map((item) => `- ${item}`), "");
    }
  }
  if (report.exceptions) {
    lines.push("## Policy exceptions", "", `Exception processing: **${report.exceptions.applied ? "enabled" : "disabled"}**.`, `Active: **${report.exceptions.active}**, expired: **${report.exceptions.expired}**, invalid: **${report.exceptions.invalid}**.`, "");
    if (report.exceptions.applied && report.exceptions.active) lines.push("Active exceptions can convert matching findings to explicit skipped checks until their expiry date; the exception policy check remains blocking if the file is invalid or expired.", "");
  }
  if (report.gate) {
    lines.push("## Merge gate", "", `Gate status: **${report.gate.status}**.`, `Configured maximum risk: **${report.gate.policy.maxRisk}**.`, `Violations: **${report.gate.summary.violations}**.`, "");
    if (!report.gate.violations.length) lines.push("No merge-gate violations were produced.", "");
    for (const violation of report.gate.violations.slice(0, 20)) {
      lines.push(`### ${violation.level === "warning" ? "⚠️" : "❌"} ${violation.title}`, "", violation.message, "", `**Next step:** ${violation.remediation}`, "");
    }
  }
  if (report.review) {
    if (!report.review.available) {
      lines.push("## Change review", "", `Review unavailable: ${report.review.reason}`, "");
    } else {
      lines.push("## Change review", "", `Risk level: **${report.review.risk.level}** (${report.review.risk.score}/100 heuristic score).`, `Changed **${report.review.diff.files}** file(s) with **${report.review.diff.additions}** additions and **${report.review.diff.deletions}** deletions.`, "");
      for (const finding of report.review.findings.slice(0, 20)) {
        lines.push(`### ${finding.level === "high" ? "❗" : "⚠️"} ${finding.title}`, "", finding.message, "", `**Next step:** ${finding.remediation}`, "");
      }
      if (!report.review.findings.length) lines.push("No focused change-review findings were produced.", "");
    }
  }
  if (report.proof) {
    lines.push("## Proof identity", "", `Bundle hash: \`${report.proof.bundleHash}\``, "");
  }

  if (!report.checks.length) lines.push("No checks were produced.", "");
  for (const check of report.checks) {
    lines.push(`### ${statusIcon(check.status)} ${check.title}`);
    lines.push("");
    lines.push(`**${check.category}** · \`${check.id}\``);
    lines.push("");
    lines.push(check.message);
    if (check.remediation) {
      lines.push("", `**Next step:** ${check.remediation}`);
    }
    if (check.evidence && check.evidence.length) {
      lines.push("", "Evidence:");
      for (const evidence of check.evidence.slice(0, 20)) {
        const location = evidence.line ? `${evidence.path}:${evidence.line}` : evidence.path;
        const detail = evidence.detail ? ` — ${evidence.detail}` : "";
        lines.push(`- \`${location}\`${detail}`);
      }
    }
    lines.push("");
  }
  return `${lines.join("\n").trim()}\n`;
}

function formatSarif(report) {
  const results = report.checks
    .filter((check) => check.status === "fail" || check.status === "warn")
    .map((check) => {
      const evidence = check.evidence && check.evidence[0];
      const result = {
        ruleId: check.id,
        level: check.status === "fail" ? "error" : "warning",
        message: { text: `${check.title}: ${check.message}` }
      };
      if (evidence && evidence.path) {
        result.locations = [{
          physicalLocation: {
            artifactLocation: { uri: evidence.path },
            region: evidence.line ? { startLine: evidence.line } : undefined
          }
        }];
      }
      return result;
    });
  for (const finding of report.review?.findings || []) {
    const evidence = finding.evidence && finding.evidence[0];
    const result = {
      ruleId: finding.id,
      level: finding.level === "high" ? "error" : "warning",
      message: { text: `${finding.title}: ${finding.message}` }
    };
    if (evidence && evidence.path) {
      result.locations = [{
        physicalLocation: {
          artifactLocation: { uri: evidence.path },
          region: evidence.line ? { startLine: evidence.line } : undefined
        }
      }];
    }
    results.push(result);
  }
  for (const violation of report.gate?.violations || []) {
    const evidence = violation.evidence && violation.evidence[0];
    if (results.some((result) => result.ruleId === violation.id)) continue;
    const result = {
      ruleId: violation.id,
      level: violation.level === "warning" ? "warning" : "error",
      message: { text: `${violation.title}: ${violation.message}` }
    };
    if (evidence && evidence.path) {
      result.locations = [{
        physicalLocation: {
          artifactLocation: { uri: evidence.path },
          region: evidence.line ? { startLine: evidence.line } : undefined
        }
      }];
    }
    results.push(result);
  }
  for (const check of report.release?.checks || []) {
    if (check.status !== "fail" && check.status !== "warn") continue;
    const evidence = check.evidence && check.evidence[0];
    const result = {
      ruleId: check.id,
      level: check.status === "fail" ? "error" : "warning",
      message: { text: `${check.title}: ${check.message}` }
    };
    if (evidence && evidence.path) {
      result.locations = [{
        physicalLocation: {
          artifactLocation: { uri: evidence.path },
          region: evidence.line ? { startLine: evidence.line } : undefined
        }
      }];
    }
    results.push(result);
  }
  return JSON.stringify({
    version: "2.1.0",
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    runs: [{
      tool: { driver: { name: TOOL_NAME, version: TOOL_VERSION } },
      results
    }]
  }, null, 2) + "\n";
}

function formatReport(report, format) {
  if (format === "json") return `${JSON.stringify(report, null, 2)}\n`;
  if (format === "sarif") return formatSarif(report);
  if (format === "html") return formatHtml(report);
  if (format === "markdown" || format === "md") return formatMarkdown(report);
  throw new Error(`unsupported format: ${format}`);
}

function writeReport(outputPath, content) {
  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
  fs.writeFileSync(outputPath, content, "utf8");
}

module.exports = {
  TOOL_NAME,
  TOOL_VERSION,
  createReport,
  formatMarkdown,
  formatReport,
  formatSarif,
  summarize,
  writeReport
};
