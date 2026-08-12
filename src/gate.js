const path = require("node:path");

const RISK_LEVELS = new Set(["routine", "elevated", "high"]);
const FINDING_LEVELS = new Set(["high", "medium", "low"]);
const RISK_RANK = { routine: 0, elevated: 1, high: 2 };

const DEFAULT_GATE_POLICY = {
  maxRisk: "elevated",
  failOnFindings: ["high"],
  failOnCheckFailures: true,
  failOnWarnings: false,
  requireReview: false
};

function validateGatePolicy(policy) {
  const errors = [];
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) return ["gatePolicy must be an object"];
  if (!RISK_LEVELS.has(policy.maxRisk)) errors.push("gatePolicy.maxRisk must be routine, elevated, or high");
  if (!Array.isArray(policy.failOnFindings) || policy.failOnFindings.some((level) => !FINDING_LEVELS.has(level))) {
    errors.push("gatePolicy.failOnFindings must contain only high, medium, or low");
  }
  for (const field of ["failOnCheckFailures", "failOnWarnings", "requireReview"]) {
    if (typeof policy[field] !== "boolean") errors.push(`gatePolicy.${field} must be a boolean`);
  }
  return errors;
}

function normalizeGatePolicy(policy = {}) {
  return {
    ...DEFAULT_GATE_POLICY,
    ...policy,
    failOnFindings: Array.isArray(policy.failOnFindings)
      ? [...new Set(policy.failOnFindings)]
      : [...DEFAULT_GATE_POLICY.failOnFindings]
  };
}

function relativeEvidence(evidence) {
  return (Array.isArray(evidence) ? evidence : [])
    .filter((item) => {
      if (!item || typeof item.path !== "string" || !item.path) return false;
      const normalized = item.path.replaceAll("\\", "/");
      return !path.posix.isAbsolute(normalized) && !path.win32.isAbsolute(normalized) && normalized !== ".." && !normalized.startsWith("../");
    })
    .slice(0, 20)
    .map((item) => ({ path: item.path, line: item.line, detail: item.detail }));
}

function makeViolation({ id, category, title, message, remediation, evidence = [], level = "error" }) {
  return { id, level, category, title, message, remediation, evidence: relativeEvidence(evidence) };
}

function evaluateGate(report, policy = {}) {
  const effectivePolicy = normalizeGatePolicy(policy);
  const policyErrors = validateGatePolicy(effectivePolicy);
  const violations = [];
  const checks = Array.isArray(report?.checks) ? report.checks : [];
  const review = report?.review;

  if (policyErrors.length) {
    violations.push(makeViolation({
      id: "gate:invalid-policy",
      category: "gate-policy",
      title: "Gate policy is invalid",
      message: policyErrors.join("; "),
      remediation: "Fix gatePolicy in .contrib-proof.json before relying on this gate."
    }));
  }

  if (effectivePolicy.failOnCheckFailures) {
    for (const check of checks.filter((item) => item?.status === "fail")) {
      violations.push(makeViolation({
        id: `gate:check-failure:${check.id}`,
        category: "check",
        title: check.title || "A configured check failed",
        message: check.message || "A configured check reported a failure.",
        remediation: check.remediation || "Resolve the failing check before merging.",
        evidence: check.evidence
      }));
    }
  }

  if (effectivePolicy.failOnWarnings) {
    for (const check of checks.filter((item) => item?.status === "warn")) {
      violations.push(makeViolation({
        id: `gate:warning:${check.id}`,
        category: "check",
        level: "warning",
        title: check.title || "A configured check produced a warning",
        message: check.message || "A configured check reported a warning.",
        remediation: check.remediation || "Review the warning or document an explicit exception.",
        evidence: check.evidence
      }));
    }
  }

  if (effectivePolicy.requireReview && (!review || !review.available)) {
    violations.push(makeViolation({
      id: "gate:review-unavailable",
      category: "review",
      title: "Required change review is unavailable",
      message: review?.reason || "No usable Git diff was available for the required review.",
      remediation: "Fetch the base ref and run the gate from a Git checkout with the required history."
    }));
  }

  if (review?.available) {
    const actualRisk = review.risk?.level;
    if (RISK_RANK[actualRisk] > RISK_RANK[effectivePolicy.maxRisk]) {
      violations.push(makeViolation({
        id: "gate:risk-threshold",
        category: "review",
        title: "Change risk exceeds the configured threshold",
        message: `The review classified this change as ${actualRisk}; the configured maximum is ${effectivePolicy.maxRisk}.`,
        remediation: "Split the change, add focused evidence, or obtain an explicit maintainer exception.",
        evidence: (review.changedFiles || [])
          .filter((file) => (file.riskFactors || []).length)
          .map((file) => ({ path: file.path }))
      }));
    }
    for (const finding of review.findings || []) {
      if (!effectivePolicy.failOnFindings.includes(finding.level)) continue;
      violations.push(makeViolation({
        id: `gate:review-finding:${finding.id}`,
        category: finding.category || "review",
        title: finding.title || "A review finding matched the gate policy",
        message: finding.message || "A review finding matched the configured gate policy.",
        remediation: finding.remediation || "Resolve the finding or document an explicit exception.",
        evidence: finding.evidence
      }));
    }
  }

  const checkFailures = checks.filter((item) => item?.status === "fail").length;
  const warnings = checks.filter((item) => item?.status === "warn").length;
  const reviewFindings = review?.available ? (review.findings || []).length : 0;
  return {
    schemaVersion: 1,
    kind: "gate-result",
    status: violations.length ? "fail" : "pass",
    passed: violations.length === 0,
    policy: effectivePolicy,
    summary: {
      violations: violations.length,
      checkFailures,
      warnings,
      reviewFindings,
      reviewAvailable: Boolean(review?.available),
      risk: review?.available ? review.risk?.level || null : null
    },
    violations
  };
}

function safeText(value) {
  return String(value ?? "").replace(/[`\r\n]/g, (character) => character === "`" ? "'" : " ");
}

function formatGateMarkdown(gate) {
  const lines = [
    "# ContribProof gate",
    "",
    `- Status: **${safeText(gate?.status || "unknown")}**`,
    `- Maximum risk: **${safeText(gate?.policy?.maxRisk || "unknown")}**`,
    `- Review findings: **${safeText(gate?.summary?.reviewFindings || 0)}**`,
    `- Violations: **${safeText(gate?.summary?.violations || 0)}**`,
    "",
    "## Gate violations",
    ""
  ];
  if (!gate?.violations?.length) lines.push("No gate violations were produced.", "");
  for (const violation of gate.violations || []) {
    lines.push(
      `### ${violation.level === "warning" ? "⚠️" : "❌"} ${safeText(violation.title)}`,
      "",
      `**${safeText(violation.category)}** · ${safeText(violation.id)}`,
      "",
      safeText(violation.message),
      "",
      `**Next step:** ${safeText(violation.remediation)}`
    );
    for (const evidence of violation.evidence || []) {
      lines.push(`- Evidence: ${safeText(evidence.path)}${evidence.line ? `:${safeText(evidence.line)}` : ""}`);
    }
    lines.push("");
  }
  return `${lines.join("\n").trim()}\n`;
}

module.exports = {
  DEFAULT_GATE_POLICY,
  evaluateGate,
  formatGateMarkdown,
  normalizeGatePolicy,
  validateGatePolicy
};
