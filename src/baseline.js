const { compareReports, statusRank } = require("./compare");

function summarizeRegression(comparison, policy = {}) {
  const maxNewFailures = Number.isInteger(policy.maxNewFailures) && policy.maxNewFailures >= 0 ? policy.maxNewFailures : 0;
  const maxNewWarnings = Number.isInteger(policy.maxNewWarnings) && policy.maxNewWarnings >= 0 ? policy.maxNewWarnings : 0;
  const maxScoreDrop = Number.isInteger(policy.maxScoreDrop) && policy.maxScoreDrop >= 0 ? policy.maxScoreDrop : 0;
  const scoreDrop = Number.isInteger(comparison.baseline.score) && Number.isInteger(comparison.current.score)
    ? comparison.baseline.score - comparison.current.score
    : null;
  const violations = [];
  if (comparison.newlyFailing.length > maxNewFailures) violations.push({ id: "baseline:new-failures", limit: maxNewFailures, actual: comparison.newlyFailing.length });
  if (comparison.newlyWarning.length > maxNewWarnings) violations.push({ id: "baseline:new-warnings", limit: maxNewWarnings, actual: comparison.newlyWarning.length });
  if (scoreDrop !== null && scoreDrop > maxScoreDrop) violations.push({ id: "baseline:score-drop", limit: maxScoreDrop, actual: scoreDrop });
  return {
    schemaVersion: 1,
    kind: "baseline-decision",
    passed: violations.length === 0,
    status: violations.length ? "fail" : "pass",
    policy: { maxNewFailures, maxNewWarnings, maxScoreDrop },
    baseline: comparison.baseline,
    current: comparison.current,
    scoreDrop,
    summary: {
      changed: comparison.changes.length,
      newlyFailing: comparison.newlyFailing.length,
      newlyWarning: comparison.newlyWarning.length,
      resolved: comparison.resolved.length,
      violations: violations.length
    },
    violations,
    newlyFailing: comparison.newlyFailing,
    newlyWarning: comparison.newlyWarning,
    resolved: comparison.resolved
  };
}

function evaluateBaseline(baseline, current, policy = {}) {
  return summarizeRegression(compareReports(baseline, current), policy);
}

function formatBaselineMarkdown(decision) {
  const lines = [
    "# ContribProof baseline decision",
    "",
    `- Status: **${decision.status}**`,
    `- Baseline score: **${decision.baseline.score ?? "n/a"}/100**`,
    `- Current score: **${decision.current.score ?? "n/a"}/100**`,
    `- Score drop: **${decision.scoreDrop ?? "n/a"}**`,
    `- Newly failing: **${decision.summary.newlyFailing}**`,
    `- Newly warning: **${decision.summary.newlyWarning}**`,
    `- Policy violations: **${decision.summary.violations}**`,
    "",
    "## Regression policy",
    "",
    `- Max new failures: **${decision.policy.maxNewFailures}**`,
    `- Max new warnings: **${decision.policy.maxNewWarnings}**`,
    `- Max score drop: **${decision.policy.maxScoreDrop}**`,
    ""
  ];
  if (!decision.violations.length) lines.push("The current report is within the configured regression budget.", "");
  else {
    lines.push("## Violations", "", ...decision.violations.map((item) => `- **${item.id}** · limit ${item.limit}, actual ${item.actual}`), "");
  }
  return `${lines.join("\n").trim()}\n`;
}

module.exports = {
  evaluateBaseline,
  formatBaselineMarkdown,
  summarizeRegression,
  statusRank
};
