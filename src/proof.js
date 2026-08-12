const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { formatMarkdown, formatSarif } = require("./report");
const { formatHtml } = require("./html");
const { buildRemediationPlan, formatPlanMarkdown } = require("./plan");
const { formatReviewMarkdown } = require("./review");
const { formatGateMarkdown } = require("./gate");
const { formatReleaseMarkdown } = require("./release");
const { validateProofManifest, validateReport } = require("./validate");

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function collectEvidencePaths(report) {
  const paths = new Set();
  for (const check of report.checks || []) {
    for (const evidence of check.evidence || []) {
      if (evidence.path && !path.isAbsolute(evidence.path)) paths.add(evidence.path);
    }
  }
  for (const finding of report.review?.findings || []) {
    for (const evidence of finding.evidence || []) {
      if (evidence.path && !path.isAbsolute(evidence.path)) paths.add(evidence.path);
    }
  }
  for (const violation of report.gate?.violations || []) {
    for (const evidence of violation.evidence || []) {
      if (evidence.path && !path.isAbsolute(evidence.path)) paths.add(evidence.path);
    }
  }
  for (const check of report.release?.checks || []) {
    for (const evidence of check.evidence || []) {
      if (evidence.path && !path.isAbsolute(evidence.path)) paths.add(evidence.path);
    }
  }
  if (report.exceptions?.path && !path.isAbsolute(report.exceptions.path)) paths.add(report.exceptions.path);
  return [...paths].sort();
}

function createProofManifest(root, report) {
  const files = [];
  for (const relative of collectEvidencePaths(report)) {
    const absolute = path.resolve(root, relative);
    const rootAbsolute = path.resolve(root);
    if (!(absolute === rootAbsolute || absolute.startsWith(`${rootAbsolute}${path.sep}`))) continue;
    try {
      const stat = fs.statSync(absolute);
      if (!stat.isFile() || stat.size > 2 * 1024 * 1024) continue;
      files.push({ path: relative.split(path.sep).join("/"), bytes: stat.size, sha256: sha256(fs.readFileSync(absolute)) });
    } catch {
      // The report already contains the failure; absent evidence is not hidden here.
    }
  }
  const reportForHash = { ...report, generatedAt: undefined, proof: undefined };
  const reportHash = sha256(canonicalJson(reportForHash));
  const evidenceHash = sha256(canonicalJson(files));
  return {
    schemaVersion: 1,
    algorithm: "sha256",
    reportHash,
    evidenceHash,
    bundleHash: sha256(`${reportHash}:${evidenceHash}`),
    files
  };
}

function writeProofBundle(outputDirectory, report, manifest) {
  fs.mkdirSync(outputDirectory, { recursive: true });
  const plan = report.plan || buildRemediationPlan(report);
  const jsonReport = `${JSON.stringify({ ...report, proof: manifest }, null, 2)}\n`;
  fs.writeFileSync(path.join(outputDirectory, "report.json"), jsonReport, "utf8");
  fs.writeFileSync(path.join(outputDirectory, "report.md"), formatMarkdown({ ...report, proof: manifest }), "utf8");
  fs.writeFileSync(path.join(outputDirectory, "report.sarif"), formatSarif(report), "utf8");
  fs.writeFileSync(path.join(outputDirectory, "report.html"), formatHtml({ ...report, proof: manifest }), "utf8");
  fs.writeFileSync(path.join(outputDirectory, "plan.json"), `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  fs.writeFileSync(path.join(outputDirectory, "plan.md"), formatPlanMarkdown(plan), "utf8");
  if (report.review) {
    fs.writeFileSync(path.join(outputDirectory, "review.json"), `${JSON.stringify(report.review, null, 2)}\n`, "utf8");
    fs.writeFileSync(path.join(outputDirectory, "review.md"), formatReviewMarkdown(report.review), "utf8");
  }
  if (report.gate) {
    fs.writeFileSync(path.join(outputDirectory, "gate.json"), `${JSON.stringify(report.gate, null, 2)}\n`, "utf8");
    fs.writeFileSync(path.join(outputDirectory, "gate.md"), formatGateMarkdown(report.gate), "utf8");
  }
  if (report.release) {
    fs.writeFileSync(path.join(outputDirectory, "release.json"), `${JSON.stringify(report.release, null, 2)}\n`, "utf8");
    fs.writeFileSync(path.join(outputDirectory, "release.md"), formatReleaseMarkdown(report.release), "utf8");
  }
  fs.writeFileSync(path.join(outputDirectory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return outputDirectory;
}

function relativeEvidencePath(root, candidate) {
  if (typeof candidate !== "string" || !candidate || path.isAbsolute(candidate)) return null;
  const normalized = candidate.split("\\").join("/");
  if (normalized.startsWith("/") || normalized === ".." || normalized.startsWith("../")) return null;
  const absolute = path.resolve(root, normalized);
  const relative = path.relative(path.resolve(root), absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return { absolute, relative: relative.split(path.sep).join("/") };
}

function verifyProofBundle(bundleDirectory, repositoryRoot = null) {
  const bundle = path.resolve(bundleDirectory);
  const errors = [];
  let report;
  let manifest;
  try {
    report = JSON.parse(fs.readFileSync(path.join(bundle, "report.json"), "utf8"));
  } catch (error) {
    errors.push(`could not read report.json: ${error.message}`);
  }
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(bundle, "manifest.json"), "utf8"));
  } catch (error) {
    errors.push(`could not read manifest.json: ${error.message}`);
  }
  if (!report || !manifest) return { schemaVersion: 1, kind: "proof-verification", bundle, valid: false, reportValid: false, checkedFiles: 0, errors };
  const reportValidation = validateReport(report);
  if (!reportValidation.valid) errors.push(...reportValidation.errors.map((item) => `report: ${item}`));
  const manifestValidation = validateProofManifest(manifest);
  if (!manifestValidation.valid) errors.push(...manifestValidation.errors.map((item) => `manifest: ${item}`));
  const files = Array.isArray(manifest.files) ? manifest.files : [];
  const seen = new Set();
  const root = path.resolve(repositoryRoot || report.root || bundle);
  for (const [index, item] of files.entries()) {
    if (!item || typeof item !== "object") {
      errors.push(`manifest.files[${index}]: must be an object`);
      continue;
    }
    const location = relativeEvidencePath(root, item.path);
    if (!location) {
      errors.push(`manifest.files[${index}]: path must remain relative to the repository root`);
      continue;
    }
    if (seen.has(location.relative)) {
      errors.push(`manifest.files[${index}]: duplicate evidence path ${location.relative}`);
      continue;
    }
    seen.add(location.relative);
    if (!Number.isInteger(item.bytes) || item.bytes < 0 || !/^[0-9a-f]{64}$/.test(item.sha256 || "")) {
      errors.push(`manifest.files[${index}]: bytes and lowercase SHA-256 are required`);
      continue;
    }
    try {
      const stat = fs.statSync(location.absolute);
      if (!stat.isFile()) errors.push(`${location.relative}: evidence path is not a file`);
      else {
        if (stat.size !== item.bytes) errors.push(`${location.relative}: byte count changed`);
        if (sha256(fs.readFileSync(location.absolute)) !== item.sha256) errors.push(`${location.relative}: SHA-256 changed`);
      }
    } catch (error) {
      errors.push(`${location.relative}: evidence file is unavailable (${error.message})`);
    }
  }
  const reportForHash = { ...report, generatedAt: undefined, proof: undefined };
  const reportHash = sha256(canonicalJson(reportForHash));
  const evidenceHash = sha256(canonicalJson(files));
  const bundleHash = sha256(`${reportHash}:${evidenceHash}`);
  for (const [field, expected] of [["reportHash", reportHash], ["evidenceHash", evidenceHash], ["bundleHash", bundleHash]]) {
    if (manifest[field] !== expected) errors.push(`manifest.${field}: expected ${expected}, got ${manifest[field] || "missing"}`);
    if (report.proof && report.proof[field] !== expected) errors.push(`report.proof.${field}: does not match the verified value`);
  }
  return {
    schemaVersion: 1,
    kind: "proof-verification",
    bundle,
    root,
    valid: errors.length === 0,
    reportValid: reportValidation.valid,
    checkedFiles: files.length,
    reportHash,
    evidenceHash,
    bundleHash,
    errors
  };
}

function formatProofVerificationMarkdown(result) {
  const lines = [
    "# ContribProof proof verification",
    "",
    `- Status: **${result.valid ? "valid" : "invalid"}**`,
    `- Bundle: \`${result.bundle}\``,
    `- Evidence files checked: **${result.checkedFiles}**`,
    `- Bundle hash: \`${result.bundleHash || "unavailable"}\``,
    ""
  ];
  if (result.errors?.length) lines.push("## Errors", "", ...result.errors.map((error) => `- ${error}`), "");
  else lines.push("The report, manifest, and referenced evidence files match their recorded SHA-256 identities.", "");
  return `${lines.join("\n").trim()}\n`;
}

module.exports = {
  canonicalJson,
  canonicalize,
  collectEvidencePaths,
  createProofManifest,
  formatProofVerificationMarkdown,
  sha256,
  verifyProofBundle,
  writeProofBundle
};
