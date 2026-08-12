const STATUSES = new Set(["pass", "warn", "fail", "skip"]);
const REVIEW_LEVELS = new Set(["high", "medium", "low"]);
const GATE_LEVELS = new Set(["error", "warning"]);
const { validateGatePolicy } = require("./gate");

function push(errors, location, message) {
  errors.push(`${location}: ${message}`);
}

function validatePlan(plan) {
  const errors = [];
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) {
    return { valid: false, errors: ["plan: expected an object"] };
  }
  if (plan.schemaVersion !== 1) push(errors, "plan.schemaVersion", "must be 1");
  if (!plan.summary || typeof plan.summary !== "object") push(errors, "plan.summary", "must be an object");
  if (!Array.isArray(plan.items)) push(errors, "plan.items", "must be an array");
  for (const [index, item] of (plan.items || []).entries()) {
    if (!item || typeof item !== "object") {
      push(errors, `plan.items[${index}]`, "must be an object");
      continue;
    }
    for (const field of ["id", "priority", "effort", "owner", "status", "category", "title", "why", "nextStep"]) {
      if (typeof item[field] !== "string" || !item[field]) push(errors, `plan.items[${index}].${field}`, "must be a non-empty string");
    }
    if (!STATUSES.has(item.status)) push(errors, `plan.items[${index}].status`, "must be pass, warn, fail, or skip");
    if (!Array.isArray(item.evidence)) push(errors, `plan.items[${index}].evidence`, "must be an array");
  }
  return { valid: errors.length === 0, errors };
}

function validateReview(review) {
  const errors = [];
  if (!review || typeof review !== "object" || Array.isArray(review)) return { valid: false, errors: ["review: expected an object"] };
  if (review.schemaVersion !== 1) push(errors, "review.schemaVersion", "must be 1");
  if (review.kind !== "change-review") push(errors, "review.kind", "must be change-review");
  if (typeof review.available !== "boolean") push(errors, "review.available", "must be a boolean");
  if (!Array.isArray(review.findings)) push(errors, "review.findings", "must be an array");
  for (const [index, finding] of (review.findings || []).entries()) {
    if (!finding || typeof finding !== "object") {
      push(errors, `review.findings[${index}]`, "must be an object");
      continue;
    }
    for (const field of ["id", "level", "category", "title", "message", "remediation"]) {
      if (typeof finding[field] !== "string" || !finding[field]) push(errors, `review.findings[${index}].${field}`, "must be a non-empty string");
    }
    if (!REVIEW_LEVELS.has(finding.level)) push(errors, `review.findings[${index}].level`, "must be high, medium, or low");
    if (!Array.isArray(finding.evidence)) push(errors, `review.findings[${index}].evidence`, "must be an array");
  }
  if (review.available) {
    if (!review.risk || typeof review.risk !== "object") push(errors, "review.risk", "must be an object when review is available");
    else {
      if (!Number.isInteger(review.risk.score) || review.risk.score < 0 || review.risk.score > 100) push(errors, "review.risk.score", "must be an integer from 0 to 100");
      if (!['routine', 'elevated', 'high'].includes(review.risk.level)) push(errors, "review.risk.level", "has an unsupported value");
      if (!Array.isArray(review.risk.factors)) push(errors, "review.risk.factors", "must be an array");
    }
    if (!review.diff || typeof review.diff !== "object") push(errors, "review.diff", "must be an object");
    if (!review.testPlan || typeof review.testPlan !== "object") push(errors, "review.testPlan", "must be an object");
  } else if (typeof review.reason !== "string" || !review.reason) {
    push(errors, "review.reason", "must explain why review is unavailable");
  }
  return { valid: errors.length === 0, errors };
}

function validateGate(gate) {
  const errors = [];
  if (!gate || typeof gate !== "object" || Array.isArray(gate)) return { valid: false, errors: ["gate: expected an object"] };
  if (gate.schemaVersion !== 1) push(errors, "gate.schemaVersion", "must be 1");
  if (gate.kind !== "gate-result") push(errors, "gate.kind", "must be gate-result");
  if (!["pass", "fail"].includes(gate.status)) push(errors, "gate.status", "must be pass or fail");
  if (typeof gate.passed !== "boolean") push(errors, "gate.passed", "must be a boolean");
  if (typeof gate.passed === "boolean" && gate.passed !== (gate.status === "pass")) push(errors, "gate.passed", "must agree with gate.status");
  if (!gate.policy || typeof gate.policy !== "object") push(errors, "gate.policy", "must be an object");
  else for (const error of validateGatePolicy(gate.policy)) push(errors, error, "invalid gate policy");
  if (!gate.summary || typeof gate.summary !== "object") push(errors, "gate.summary", "must be an object");
  else {
    for (const field of ["violations", "checkFailures", "warnings", "reviewFindings"]) {
      if (!Number.isInteger(gate.summary[field]) || gate.summary[field] < 0) push(errors, `gate.summary.${field}`, "must be a non-negative integer");
    }
    if (typeof gate.summary.reviewAvailable !== "boolean") push(errors, "gate.summary.reviewAvailable", "must be a boolean");
  }
  if (!Array.isArray(gate.violations)) push(errors, "gate.violations", "must be an array");
  for (const [index, violation] of (gate.violations || []).entries()) {
    if (!violation || typeof violation !== "object") {
      push(errors, `gate.violations[${index}]`, "must be an object");
      continue;
    }
    for (const field of ["id", "level", "category", "title", "message", "remediation"]) {
      if (typeof violation[field] !== "string" || !violation[field]) push(errors, `gate.violations[${index}].${field}`, "must be a non-empty string");
    }
    if (!GATE_LEVELS.has(violation.level)) push(errors, `gate.violations[${index}].level`, "must be error or warning");
    if (!Array.isArray(violation.evidence)) push(errors, `gate.violations[${index}].evidence`, "must be an array");
  }
  return { valid: errors.length === 0, errors };
}

function validateReport(report) {
  const errors = [];
  if (!report || typeof report !== "object" || Array.isArray(report)) {
    return { valid: false, errors: ["report: expected an object"] };
  }
  if (report.schemaVersion !== 1) push(errors, "report.schemaVersion", "must be 1");
  if (!report.tool || typeof report.tool.name !== "string" || typeof report.tool.version !== "string") {
    push(errors, "report.tool", "must contain name and version strings");
  }
  if (!report.summary || typeof report.summary !== "object") {
    push(errors, "report.summary", "must be an object");
  } else {
    for (const field of ["pass", "warn", "fail", "skip", "total", "score"]) {
      if (!Number.isInteger(report.summary[field]) || report.summary[field] < 0) push(errors, `report.summary.${field}`, "must be a non-negative integer");
    }
    if (!["pass", "needs-attention", "fail"].includes(report.summary.status)) push(errors, "report.summary.status", "has an unsupported value");
  }
  if (!Array.isArray(report.checks)) {
    push(errors, "report.checks", "must be an array");
  } else {
    for (const [index, check] of report.checks.entries()) {
      if (!check || typeof check !== "object") {
        push(errors, `report.checks[${index}]`, "must be an object");
        continue;
      }
      for (const field of ["id", "category", "status", "title", "message"]) {
        if (typeof check[field] !== "string" || !check[field]) push(errors, `report.checks[${index}].${field}`, "must be a non-empty string");
      }
      if (!STATUSES.has(check.status)) push(errors, `report.checks[${index}].status`, "must be pass, warn, fail, or skip");
      if (!Array.isArray(check.evidence)) push(errors, `report.checks[${index}].evidence`, "must be an array");
    }
  }
  if (report.plan !== undefined) {
    const result = validatePlan(report.plan);
    for (const error of result.errors) push(errors, error, "invalid nested remediation plan");
  }
  if (report.review !== undefined && report.review !== null) {
    const result = validateReview(report.review);
    for (const error of result.errors) push(errors, error, "invalid nested change review");
  }
  if (report.gate !== undefined && report.gate !== null) {
    const result = validateGate(report.gate);
    for (const error of result.errors) push(errors, error, "invalid nested gate result");
  }
  if (report.proof !== undefined && report.proof !== null) {
    if (report.proof.algorithm !== "sha256") push(errors, "report.proof.algorithm", "must be sha256");
    for (const field of ["reportHash", "evidenceHash", "bundleHash"]) {
      if (!/^[0-9a-f]{64}$/.test(report.proof[field] || "")) push(errors, `report.proof.${field}`, "must be a 64-character lowercase SHA-256 digest");
    }
    if (!Array.isArray(report.proof.files)) push(errors, "report.proof.files", "must be an array");
  }
  return { valid: errors.length === 0, errors };
}

function formatValidation(result) {
  if (result.valid) return "Artifact is valid.\n";
  return `Artifact is invalid (${result.errors.length} issue${result.errors.length === 1 ? "" : "s"}):\n${result.errors.map((error) => `- ${error}`).join("\n")}\n`;
}

module.exports = {
  formatValidation,
  validateGate,
  validatePlan,
  validateReport,
  validateReview
};
