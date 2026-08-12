function statusRank(status) {
  return { fail: 3, warn: 2, pass: 1, skip: 0 }[status] ?? -1;
}

function stableCheck(check) {
  return {
    id: check.id,
    status: check.status,
    severity: check.severity,
    message: check.message,
    remediation: check.remediation,
    evidence: (check.evidence || []).map((item) => ({ path: item.path, line: item.line, detail: item.detail }))
  };
}

function compareReports(baseline, current) {
  const before = new Map((baseline.checks || []).map((check) => [check.id, check]));
  const after = new Map((current.checks || []).map((check) => [check.id, check]));
  const ids = [...new Set([...before.keys(), ...after.keys()])].sort();
  const changes = [];
  for (const id of ids) {
    const previous = before.get(id);
    const next = after.get(id);
    if (!previous && next) {
      changes.push({ id, type: "added", before: null, after: stableCheck(next) });
    } else if (previous && !next) {
      changes.push({ id, type: "removed", before: stableCheck(previous), after: null });
    } else if (previous.status !== next.status || JSON.stringify(stableCheck(previous)) !== JSON.stringify(stableCheck(next))) {
      changes.push({ id, type: "changed", before: stableCheck(previous), after: stableCheck(next) });
    }
  }
  const newlyFailing = changes.filter((change) => change.after && change.after.status === "fail" && (!change.before || change.before.status !== "fail"));
  const newlyWarning = changes.filter((change) => change.after && change.after.status === "warn" && (!change.before || statusRank(change.before.status) < 2));
  const resolved = changes.filter((change) => change.before && statusRank(change.before.status) >= 2 && change.after && statusRank(change.after.status) < 2);
  return {
    schemaVersion: 1,
    baseline: { status: baseline.summary?.status || null, score: baseline.summary?.score ?? null },
    current: { status: current.summary?.status || null, score: current.summary?.score ?? null },
    changes,
    newlyFailing,
    newlyWarning,
    resolved,
    regression: newlyFailing.length > 0
  };
}

function formatComparisonMarkdown(comparison) {
  const lines = [
    "# ContribProof baseline comparison",
    "",
    `- Baseline: **${comparison.baseline.status || "unknown"}** (${comparison.baseline.score ?? "?"}/100)`,
    `- Current: **${comparison.current.status || "unknown"}** (${comparison.current.score ?? "?"}/100)`,
    `- Regression: **${comparison.regression ? "yes" : "no"}**`,
    `- Changes: ${comparison.changes.length}; newly failing: ${comparison.newlyFailing.length}; newly warning: ${comparison.newlyWarning.length}; resolved: ${comparison.resolved.length}`,
    "",
    "## Changed checks",
    ""
  ];
  if (!comparison.changes.length) lines.push("No check changes.", "");
  for (const change of comparison.changes) {
    lines.push(`- **${change.type}** \`${change.id}\`: ${change.before?.status || "—"} → ${change.after?.status || "—"}`);
  }
  return `${lines.join("\n")}\n`;
}

module.exports = {
  compareReports,
  formatComparisonMarkdown,
  statusRank
};
