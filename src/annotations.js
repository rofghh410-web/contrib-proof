const path = require("node:path");

const DEFAULT_MAX_ANNOTATIONS = 50;

function escapeData(value) {
  return String(value ?? "")
    .replaceAll("%", "%25")
    .replaceAll("\r", "%0D")
    .replaceAll("\n", "%0A");
}

function escapeProperty(value) {
  return escapeData(value)
    .replaceAll(",", "%2C")
    .replaceAll(":", "%3A");
}

function normalizeAnnotationPath(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const normalized = value.replaceAll("\\", "/").trim();
  const canonical = path.posix.normalize(normalized);
  if (
    path.posix.isAbsolute(normalized)
    || path.win32.isAbsolute(normalized)
    || /^[A-Za-z]:/.test(normalized)
    || canonical === ".."
    || canonical.startsWith("../")
    || normalized.includes("\0")
  ) return null;
  return canonical;
}

function annotationProperties(evidence) {
  const properties = [];
  const file = normalizeAnnotationPath(evidence?.path);
  if (file) properties.push(`file=${escapeProperty(file)}`);
  if (Number.isInteger(evidence?.line) && evidence.line > 0) {
    properties.push(`line=${evidence.line}`);
  }
  return properties.length ? `,${properties.join(",")}` : "";
}

function normalizeLevel(level) {
  return level === "error" ? "error" : "warning";
}

function makeAnnotation({ level, title, message, evidence = {} }) {
  const type = normalizeLevel(level);
  const safeTitle = escapeProperty(`ContribProof: ${title || "Finding"}`);
  const safeMessage = escapeData(message || "A ContribProof finding needs review.");
  return `::${type} title=${safeTitle}${annotationProperties(evidence)}::${safeMessage}`;
}

function itemAnnotations(item, level, max = DEFAULT_MAX_ANNOTATIONS) {
  const evidence = Array.isArray(item?.evidence) && item.evidence.length ? item.evidence : [{}];
  return evidence.slice(0, max).map((location) => makeAnnotation({
    level,
    title: item.title,
    message: item.message,
    evidence: location
  }));
}

function buildGithubAnnotations(report, { maxAnnotations = DEFAULT_MAX_ANNOTATIONS } = {}) {
  const limit = Number.isInteger(maxAnnotations) && maxAnnotations > 0
    ? maxAnnotations
    : DEFAULT_MAX_ANNOTATIONS;
  const lines = [];
  let truncated = false;
  const append = (item, level) => {
    const evidence = Array.isArray(item?.evidence) && item.evidence.length ? item.evidence : [{}];
    if (lines.length >= limit) {
      truncated = true;
      return;
    }
    const remaining = limit - lines.length;
    if (evidence.length > remaining) truncated = true;
    lines.push(...itemAnnotations(item, level, remaining));
  };

  for (const check of report?.checks || []) {
    if (check?.status === "fail") append(check, "error");
    else if (check?.status === "warn") append(check, "warning");
  }
  for (const finding of report?.review?.findings || []) {
    append(finding, finding.level === "high" ? "error" : "warning");
  }
  for (const violation of report?.gate?.violations || []) {
    append(violation, violation.level === "warning" ? "warning" : "error");
  }

  return { lines, truncated };
}

function formatGithubAnnotations(report, options = {}) {
  const result = buildGithubAnnotations(report, options);
  const lines = [...result.lines];
  if (result.truncated) {
    lines.push("::notice title=ContribProof::Additional findings were omitted after the annotation limit.");
  }
  return lines.length ? `${lines.join("\n")}\n` : "";
}

module.exports = {
  DEFAULT_MAX_ANNOTATIONS,
  buildGithubAnnotations,
  escapeData,
  escapeProperty,
  formatGithubAnnotations,
  normalizeAnnotationPath
};
