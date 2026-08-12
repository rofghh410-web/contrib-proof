const PRIORITY_ORDER = { P0: 0, P1: 1, P2: 2, P3: 3 };

function priorityFor(check) {
  if (check.status === "fail" || check.severity === "error") return "P0";
  if (check.status === "warn" || check.severity === "warning") return "P1";
  if (check.status === "skip") return "P2";
  return "P3";
}

function effortFor(check) {
  if (/workflow:pull-request-target|command:|dependencies:lockfile/.test(check.id)) return "medium";
  if (/config:|required-file:|broken-link:|docs:/.test(check.id)) return "small";
  if (/changes:/.test(check.id)) return "small-to-medium";
  return "medium";
}

function ownerFor(check) {
  if (check.category === "security-maintenance" || check.category === "supply-chain") return "maintainer";
  if (check.category === "validation" || check.category === "change-policy") return "contributor + maintainer";
  return "maintainer or documentation owner";
}

function buildRemediationPlan(report) {
  const checks = [
    ...(report.checks || []),
    ...(report.release?.checks || []).map((check) => ({ ...check, category: check.category || "release-readiness" }))
  ];
  const items = checks
    .filter((check) => check.status !== "pass")
    .map((check) => ({
      id: check.id,
      priority: priorityFor(check),
      effort: effortFor(check),
      owner: ownerFor(check),
      status: check.status,
      category: check.category,
      title: check.title,
      why: check.message,
      nextStep: check.remediation || "Review the evidence and decide whether this signal should be addressed or explicitly accepted.",
      evidence: (check.evidence || []).slice(0, 20)
    }))
    .sort((left, right) => PRIORITY_ORDER[left.priority] - PRIORITY_ORDER[right.priority] || left.id.localeCompare(right.id));

  return {
    schemaVersion: 1,
    source: {
      reportSchemaVersion: report.schemaVersion || 1,
      tool: report.tool || null
    },
    summary: {
      items: items.length,
      blocking: items.filter((item) => item.priority === "P0").length,
      recommended: items.filter((item) => item.priority === "P1").length,
      deferred: items.filter((item) => item.priority === "P2").length
    },
    items
  };
}

function formatPlanMarkdown(plan) {
  const lines = [
    "# ContribProof remediation plan",
    "",
    `- Actionable items: **${plan.summary.items}**`,
    `- Blocking: **${plan.summary.blocking}**`,
    `- Recommended: **${plan.summary.recommended}**`,
    `- Deferred or informational: **${plan.summary.deferred}**`,
    ""
  ];
  if (!plan.items.length) {
    lines.push("No remediation items were produced.", "");
    return `${lines.join("\n")}\n`;
  }
  for (const item of plan.items) {
    lines.push(`## ${item.priority} · ${item.title}`, "", `**${item.category}** · ${item.status} · effort: ${item.effort} · owner: ${item.owner}`, "", item.why, "", `**Next step:** ${item.nextStep}`);
    if (item.evidence.length) {
      lines.push("", "Evidence:");
      for (const evidence of item.evidence) {
        const location = evidence.line ? `${evidence.path}:${evidence.line}` : evidence.path;
        lines.push(`- \`${location}\`${evidence.detail ? ` — ${evidence.detail}` : ""}`);
      }
    }
    lines.push("");
  }
  return `${lines.join("\n").trim()}\n`;
}

module.exports = {
  buildRemediationPlan,
  effortFor,
  formatPlanMarkdown,
  ownerFor,
  priorityFor
};
