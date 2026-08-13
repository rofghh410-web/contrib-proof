const STATUSES = new Set(["pass", "warn", "fail", "skip"]);
const REVIEW_LEVELS = new Set(["high", "medium", "low"]);
const GATE_LEVELS = new Set(["error", "warning"]);
const RELEASE_STATUSES = new Set(["pass", "warn", "fail"]);
const RELEASE_SEVERITIES = new Set(["info", "warning", "error"]);
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

function validateRelease(release) {
  const errors = [];
  if (!release || typeof release !== "object" || Array.isArray(release)) return { valid: false, errors: ["release: expected an object"] };
  if (release.schemaVersion !== 1) push(errors, "release.schemaVersion", "must be 1");
  if (release.kind !== "release-readiness") push(errors, "release.kind", "must be release-readiness");
  if (typeof release.available !== "boolean") push(errors, "release.available", "must be a boolean");
  if (release.version !== null && release.version !== undefined && typeof release.version !== "string") push(errors, "release.version", "must be a string or null");
  if (!Array.isArray(release.commits)) push(errors, "release.commits", "must be an array");
  if (!release.changes || typeof release.changes !== "object") push(errors, "release.changes", "must be an object");
  if (!release.summary || typeof release.summary !== "object") {
    push(errors, "release.summary", "must be an object");
  } else {
    if (!["pass", "needs-attention", "unavailable"].includes(release.summary.status)) push(errors, "release.summary.status", "has an unsupported value");
    if (!Number.isInteger(release.summary.score) || release.summary.score < 0 || release.summary.score > 100) push(errors, "release.summary.score", "must be an integer from 0 to 100");
    for (const field of ["pass", "warn", "fail", "total"]) {
      if (!Number.isInteger(release.summary[field]) || release.summary[field] < 0) push(errors, `release.summary.${field}`, "must be a non-negative integer");
    }
  }
  if (!Array.isArray(release.checks)) push(errors, "release.checks", "must be an array");
  for (const [index, check] of (release.checks || []).entries()) {
    if (!check || typeof check !== "object") {
      push(errors, `release.checks[${index}]`, "must be an object");
      continue;
    }
    for (const field of ["id", "title", "message"]) {
      if (typeof check[field] !== "string" || !check[field]) push(errors, `release.checks[${index}].${field}`, "must be a non-empty string");
    }
    if (!RELEASE_STATUSES.has(check.status)) push(errors, `release.checks[${index}].status`, "must be pass, warn, or fail");
    if (!RELEASE_SEVERITIES.has(check.severity)) push(errors, `release.checks[${index}].severity`, "must be info, warning, or error");
    if (!Array.isArray(check.evidence)) push(errors, `release.checks[${index}].evidence`, "must be an array");
  }
  if (!Array.isArray(release.recommendations)) push(errors, "release.recommendations", "must be an array");
  if (release.available === false && (typeof release.reason !== "string" || !release.reason)) push(errors, "release.reason", "must explain why release readiness is unavailable");
  return { valid: errors.length === 0, errors };
}

function validateBaseline(baseline) {
  const errors = [];
  if (!baseline || typeof baseline !== "object" || Array.isArray(baseline)) return { valid: false, errors: ["baseline: expected an object"] };
  if (baseline.schemaVersion !== 1) push(errors, "baseline.schemaVersion", "must be 1");
  if (baseline.kind !== "baseline-decision") push(errors, "baseline.kind", "must be baseline-decision");
  if (!["pass", "fail"].includes(baseline.status)) push(errors, "baseline.status", "must be pass or fail");
  if (typeof baseline.passed !== "boolean") push(errors, "baseline.passed", "must be a boolean");
  if (typeof baseline.passed === "boolean" && baseline.passed !== (baseline.status === "pass")) push(errors, "baseline.passed", "must agree with baseline.status");
  if (!baseline.policy || typeof baseline.policy !== "object") push(errors, "baseline.policy", "must be an object");
  else for (const field of ["maxNewFailures", "maxNewWarnings", "maxScoreDrop"]) {
    if (!Number.isInteger(baseline.policy[field]) || baseline.policy[field] < 0) push(errors, `baseline.policy.${field}`, "must be a non-negative integer");
  }
  if (!baseline.summary || typeof baseline.summary !== "object") push(errors, "baseline.summary", "must be an object");
  else for (const field of ["changed", "newlyFailing", "newlyWarning", "resolved", "violations"]) {
    if (!Number.isInteger(baseline.summary[field]) || baseline.summary[field] < 0) push(errors, `baseline.summary.${field}`, "must be a non-negative integer");
  }
  if (baseline.scoreDrop !== null && baseline.scoreDrop !== undefined && !Number.isInteger(baseline.scoreDrop)) push(errors, "baseline.scoreDrop", "must be an integer or null");
  if (!Array.isArray(baseline.violations)) push(errors, "baseline.violations", "must be an array");
  for (const field of ["newlyFailing", "newlyWarning", "resolved"]) if (!Array.isArray(baseline[field])) push(errors, `baseline.${field}`, "must be an array");
  return { valid: errors.length === 0, errors };
}

function validateDoctor(doctor) {
  const errors = [];
  if (!doctor || typeof doctor !== "object" || Array.isArray(doctor)) return { valid: false, errors: ["doctor: expected an object"] };
  if (doctor.schemaVersion !== 1) push(errors, "doctor.schemaVersion", "must be 1");
  if (doctor.kind !== "doctor-report") push(errors, "doctor.kind", "must be doctor-report");
  if (!doctor.environment || typeof doctor.environment !== "object") push(errors, "doctor.environment", "must be an object");
  else {
    for (const field of ["node", "platform", "arch"]) if (typeof doctor.environment[field] !== "string" || !doctor.environment[field]) push(errors, `doctor.environment.${field}`, "must be a non-empty string");
    if (!Number.isInteger(doctor.environment.cpuCount) || doctor.environment.cpuCount < 1) push(errors, "doctor.environment.cpuCount", "must be a positive integer");
  }
  if (!doctor.summary || typeof doctor.summary !== "object") push(errors, "doctor.summary", "must be an object");
  else {
    for (const field of ["pass", "warn", "fail", "skip", "total", "score"]) if (!Number.isInteger(doctor.summary[field]) || doctor.summary[field] < 0) push(errors, `doctor.summary.${field}`, "must be a non-negative integer");
    if (doctor.summary.score > 100) push(errors, "doctor.summary.score", "must be no greater than 100");
    if (!['pass', 'needs-attention', 'fail'].includes(doctor.summary.status)) push(errors, "doctor.summary.status", "has an unsupported value");
  }
  if (!Array.isArray(doctor.checks)) push(errors, "doctor.checks", "must be an array");
  else for (const [index, check] of doctor.checks.entries()) {
    if (!check || typeof check !== "object") {
      push(errors, `doctor.checks[${index}]`, "must be an object");
      continue;
    }
    for (const field of ["id", "category", "status", "title", "message"]) {
      if (typeof check[field] !== "string" || !check[field]) push(errors, `doctor.checks[${index}].${field}`, "must be a non-empty string");
    }
    if (!STATUSES.has(check.status)) push(errors, `doctor.checks[${index}].status`, "has an unsupported value");
    if (!Array.isArray(check.evidence)) push(errors, `doctor.checks[${index}].evidence`, "must be an array");
  }
  return { valid: errors.length === 0, errors };
}

function validateExceptions(document) {
  const errors = [];
  if (!document || typeof document !== "object" || Array.isArray(document)) return { valid: false, errors: ["exceptions: expected an object"] };
  if (document.version !== 1) push(errors, "exceptions.version", "must be 1");
  if (!Array.isArray(document.exceptions)) push(errors, "exceptions.exceptions", "must be an array");
  for (const [index, exception] of (document.exceptions || []).entries()) {
    if (!exception || typeof exception !== "object" || Array.isArray(exception)) {
      push(errors, `exceptions.exceptions[${index}]`, "must be an object");
      continue;
    }
    for (const field of ["id", "checkId", "reason", "owner", "expiresAt"]) {
      if (typeof exception[field] !== "string" || !exception[field].trim()) push(errors, `exceptions.exceptions[${index}].${field}`, "must be a non-empty string");
    }
    if (typeof exception.expiresAt === "string" && Number.isNaN(Date.parse(exception.expiresAt))) push(errors, `exceptions.exceptions[${index}].expiresAt`, "must be an ISO-compatible date");
  }
  return { valid: errors.length === 0, errors };
}

function validateExecutionContext(context) {
  const errors = [];
  if (!context || typeof context !== "object" || Array.isArray(context)) return { valid: false, errors: ["context: expected an object"] };
  if (context.schemaVersion !== 1) push(errors, "context.schemaVersion", "must be 1");
  if (!context.runtime || typeof context.runtime !== "object") push(errors, "context.runtime", "must be an object");
  else for (const field of ["node", "platform", "arch", "cwd"]) if (typeof context.runtime[field] !== "string" || !context.runtime[field]) push(errors, `context.runtime.${field}`, "must be a non-empty string");
  if (!context.git || typeof context.git !== "object") push(errors, "context.git", "must be an object");
  else {
    for (const field of ["exactRoot", "dirty", "shallow"]) if (context.git[field] !== null && typeof context.git[field] !== "boolean") push(errors, `context.git.${field}`, "must be a boolean or null");
    for (const field of ["root", "commit", "branch"]) if (context.git[field] !== null && typeof context.git[field] !== "string") push(errors, `context.git.${field}`, "must be a string or null");
  }
  if (!context.configuration || typeof context.configuration !== "object") push(errors, "context.configuration", "must be an object");
  else {
    if (context.configuration.path !== null && typeof context.configuration.path !== "string") push(errors, "context.configuration.path", "must be a string or null");
    if (context.configuration.sha256 !== null && !/^[0-9a-f]{64}$/.test(context.configuration.sha256 || "")) push(errors, "context.configuration.sha256", "must be a SHA-256 digest or null");
    if (typeof context.configuration.usedDefaults !== "boolean") push(errors, "context.configuration.usedDefaults", "must be a boolean");
    if (!Array.isArray(context.configuration.errors)) push(errors, "context.configuration.errors", "must be an array");
  }
  if (!context.options || typeof context.options !== "object") push(errors, "context.options", "must be an object");
  else {
    for (const field of ["includeDiff", "execute", "applyExceptions"]) if (typeof context.options[field] !== "boolean") push(errors, `context.options.${field}`, "must be a boolean");
    if (context.options.base !== null && typeof context.options.base !== "string") push(errors, "context.options.base", "must be a string or null");
    if (context.options.exceptionsPath !== null && typeof context.options.exceptionsPath !== "string") push(errors, "context.options.exceptionsPath", "must be a string or null");
  }
  return { valid: errors.length === 0, errors };
}

function validateFixtureSuite(suite) {
  const errors = [];
  if (!suite || typeof suite !== "object" || Array.isArray(suite)) return { valid: false, errors: ["fixture-suite: expected an object"] };
  if (suite.schemaVersion !== 1) push(errors, "fixture-suite.schemaVersion", "must be 1");
  if (suite.kind !== "fixture-suite") push(errors, "fixture-suite.kind", "must be fixture-suite");
  if (typeof suite.path !== "string") push(errors, "fixture-suite.path", "must be a string");
  if (typeof suite.valid !== "boolean") push(errors, "fixture-suite.valid", "must be a boolean");
  if (!suite.summary || typeof suite.summary !== "object") push(errors, "fixture-suite.summary", "must be an object");
  else for (const field of ["total", "passed", "failed"]) if (!Number.isInteger(suite.summary[field]) || suite.summary[field] < 0) push(errors, `fixture-suite.summary.${field}`, "must be a non-negative integer");
  if (!Array.isArray(suite.cases)) push(errors, "fixture-suite.cases", "must be an array");
  else for (const [index, item] of suite.cases.entries()) {
    if (!item || typeof item !== "object") {
      push(errors, `fixture-suite.cases[${index}]`, "must be an object");
      continue;
    }
    for (const field of ["id", "root"]) if (typeof item[field] !== "string" || !item[field]) push(errors, `fixture-suite.cases[${index}].${field}`, "must be a non-empty string");
    if (typeof item.passed !== "boolean") push(errors, `fixture-suite.cases[${index}].passed`, "must be a boolean");
    if (!Array.isArray(item.errors)) push(errors, `fixture-suite.cases[${index}].errors`, "must be an array");
  }
  if (!Array.isArray(suite.errors)) push(errors, "fixture-suite.errors", "must be an array");
  return { valid: errors.length === 0, errors };
}

function validateProofVerification(result) {
  const errors = [];
  if (!result || typeof result !== "object" || Array.isArray(result)) return { valid: false, errors: ["proof-verification: expected an object"] };
  if (result.schemaVersion !== 1) push(errors, "proof-verification.schemaVersion", "must be 1");
  if (result.kind !== "proof-verification") push(errors, "proof-verification.kind", "must be proof-verification");
  if (typeof result.bundle !== "string") push(errors, "proof-verification.bundle", "must be a string");
  if (typeof result.valid !== "boolean") push(errors, "proof-verification.valid", "must be a boolean");
  if (typeof result.reportValid !== "boolean") push(errors, "proof-verification.reportValid", "must be a boolean");
  if (!Number.isInteger(result.checkedFiles) || result.checkedFiles < 0) push(errors, "proof-verification.checkedFiles", "must be a non-negative integer");
  if (!Array.isArray(result.errors)) push(errors, "proof-verification.errors", "must be an array");
  for (const field of ["reportHash", "evidenceHash", "bundleHash"]) if (result[field] !== undefined && result[field] !== null && !/^[0-9a-f]{64}$/.test(result[field])) push(errors, `proof-verification.${field}`, "must be a SHA-256 digest");
  return { valid: errors.length === 0, errors };
}

function validateProofAttestation(attestation) {
  const errors = [];
  if (!attestation || typeof attestation !== "object" || Array.isArray(attestation)) return { valid: false, errors: ["proof-attestation: expected an object"] };
  if (attestation.schemaVersion !== 1) push(errors, "proof-attestation.schemaVersion", "must be 1");
  if (attestation.kind !== "proof-attestation") push(errors, "proof-attestation.kind", "must be proof-attestation");
  if (attestation.algorithm !== "ed25519") push(errors, "proof-attestation.algorithm", "must be ed25519");
  if (typeof attestation.createdAt !== "string" || !Number.isFinite(Date.parse(attestation.createdAt))) push(errors, "proof-attestation.createdAt", "must be an ISO-8601 timestamp");
  if (!attestation.subject || typeof attestation.subject !== "object" || Array.isArray(attestation.subject)) push(errors, "proof-attestation.subject", "must be an object");
  else for (const field of ["reportHash", "evidenceHash", "bundleHash"]) if (!/^[0-9a-f]{64}$/.test(attestation.subject[field] || "")) push(errors, `proof-attestation.subject.${field}`, "must be a 64-character lowercase SHA-256 digest");
  if (!attestation.key || typeof attestation.key !== "object" || Array.isArray(attestation.key)) push(errors, "proof-attestation.key", "must be an object");
  else {
    if (typeof attestation.key.keyId !== "string" || !attestation.key.keyId) push(errors, "proof-attestation.key.keyId", "must be a non-empty string");
    if (!/^[0-9a-f]{64}$/.test(attestation.key.publicKeySha256 || "")) push(errors, "proof-attestation.key.publicKeySha256", "must be a 64-character lowercase SHA-256 digest");
  }
  if (typeof attestation.signature !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(attestation.signature) || Buffer.from(attestation.signature, "base64").length === 0) push(errors, "proof-attestation.signature", "must be a non-empty base64 signature");
  return { valid: errors.length === 0, errors };
}

function validateProofAttestationVerification(result) {
  const errors = [];
  if (!result || typeof result !== "object" || Array.isArray(result)) return { valid: false, errors: ["proof-attestation-verification: expected an object"] };
  if (result.schemaVersion !== 1) push(errors, "proof-attestation-verification.schemaVersion", "must be 1");
  if (result.kind !== "proof-attestation-verification") push(errors, "proof-attestation-verification.kind", "must be proof-attestation-verification");
  for (const field of ["valid", "signatureValid", "keyTrusted"]) if (typeof result[field] !== "boolean") push(errors, `proof-attestation-verification.${field}`, "must be a boolean");
  if (result.subjectValid !== null && typeof result.subjectValid !== "boolean") push(errors, "proof-attestation-verification.subjectValid", "must be a boolean or null");
  if (result.keyId !== null && typeof result.keyId !== "string") push(errors, "proof-attestation-verification.keyId", "must be a string or null");
  for (const field of ["publicKeySha256", "bundleHash"]) if (result[field] !== null && result[field] !== undefined && !/^[0-9a-f]{64}$/.test(result[field])) push(errors, `proof-attestation-verification.${field}`, "must be a SHA-256 digest or null");
  if (!Array.isArray(result.errors)) push(errors, "proof-attestation-verification.errors", "must be an array");
  return { valid: errors.length === 0, errors };
}

function validateProofManifest(manifest) {
  const errors = [];
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) return { valid: false, errors: ["proof-manifest: expected an object"] };
  if (manifest.schemaVersion !== 1) push(errors, "proof-manifest.schemaVersion", "must be 1");
  if (manifest.algorithm !== "sha256") push(errors, "proof-manifest.algorithm", "must be sha256");
  for (const field of ["reportHash", "evidenceHash", "bundleHash"]) if (!/^[0-9a-f]{64}$/.test(manifest[field] || "")) push(errors, `proof-manifest.${field}`, "must be a 64-character lowercase SHA-256 digest");
  if (!Array.isArray(manifest.files)) push(errors, "proof-manifest.files", "must be an array");
  for (const [index, item] of (manifest.files || []).entries()) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      push(errors, `proof-manifest.files[${index}]`, "must be an object");
      continue;
    }
    if (typeof item.path !== "string" || !item.path || item.path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(item.path)) push(errors, `proof-manifest.files[${index}].path`, "must be a non-empty relative path");
    if (!Number.isInteger(item.bytes) || item.bytes < 0) push(errors, `proof-manifest.files[${index}].bytes`, "must be a non-negative integer");
    if (!/^[0-9a-f]{64}$/.test(item.sha256 || "")) push(errors, `proof-manifest.files[${index}].sha256`, "must be a lowercase SHA-256 digest");
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
  if (report.release !== undefined && report.release !== null) {
    const result = validateRelease(report.release);
    for (const error of result.errors) push(errors, error, "invalid nested release readiness");
  }
  if (report.context !== undefined && report.context !== null) {
    const result = validateExecutionContext(report.context);
    for (const error of result.errors) push(errors, error, "invalid execution context");
  }
  if (report.exceptions !== undefined && report.exceptions !== null) {
    if (typeof report.exceptions !== "object" || Array.isArray(report.exceptions)) push(errors, "report.exceptions", "must be an object");
    else {
      for (const field of ["path", "total", "active", "expired", "invalid"]) {
        if (field === "path" && typeof report.exceptions[field] !== "string") push(errors, "report.exceptions.path", "must be a string");
        if (field !== "path" && (!Number.isInteger(report.exceptions[field]) || report.exceptions[field] < 0)) push(errors, `report.exceptions.${field}`, "must be a non-negative integer");
      }
      if (typeof report.exceptions.applied !== "boolean") push(errors, "report.exceptions.applied", "must be a boolean");
      if (!Array.isArray(report.exceptions.errors)) push(errors, "report.exceptions.errors", "must be an array");
      if (!Array.isArray(report.exceptions.exceptions)) push(errors, "report.exceptions.exceptions", "must be an array");
    }
  }
  if (report.proof !== undefined && report.proof !== null) {
    const result = validateProofManifest(report.proof);
    for (const error of result.errors) push(errors, error, "invalid nested proof manifest");
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
  validateBaseline,
  validateDoctor,
  validateExceptions,
  validateExecutionContext,
  validateFixtureSuite,
  validatePlan,
  validateProofAttestation,
  validateProofAttestationVerification,
  validateProofManifest,
  validateProofVerification,
  validateReport,
  validateRelease,
  validateReview
};
