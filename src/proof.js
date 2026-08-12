const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { formatMarkdown, formatSarif } = require("./report");
const { formatHtml } = require("./html");
const { buildRemediationPlan, formatPlanMarkdown } = require("./plan");
const { formatReviewMarkdown } = require("./review");
const { formatGateMarkdown } = require("./gate");

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
  fs.writeFileSync(path.join(outputDirectory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return outputDirectory;
}

module.exports = {
  canonicalJson,
  canonicalize,
  collectEvidencePaths,
  createProofManifest,
  sha256,
  writeProofBundle
};
