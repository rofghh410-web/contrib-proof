const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_ISSUE_TEMPLATE_DIRECTORY = ".github/ISSUE_TEMPLATE";

function safeRepositoryPath(root, relative, label = "path") {
  if (typeof relative !== "string" || !relative || path.isAbsolute(relative) || /^[A-Za-z]:[\\/]/.test(relative)) throw new Error(`${label} must be repository-relative`);
  const rootAbsolute = path.resolve(root);
  const target = path.resolve(rootAbsolute, relative);
  if (!(target === rootAbsolute || target.startsWith(`${rootAbsolute}${path.sep}`))) throw new Error(`${label} must remain inside the repository root`);
  return target;
}

function scalarValue(source, key) {
  const match = String(source || "").match(new RegExp(`^${key}:\\s*["']?([^"'\\n]+?)["']?\\s*$`, "m"));
  return match ? match[1].trim() : null;
}

function parseFormTemplate(relative, source) {
  const lines = String(source || "").split(/\r?\n/);
  const labels = [];
  const requiredFields = [];
  let readingLabels = false;
  let currentField = null;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (/^labels:\s*$/.test(line)) {
      readingLabels = true;
      continue;
    }
    if (readingLabels) {
      const label = line.match(/^-\s*["']?([^"']+?)["']?\s*$/);
      if (label) {
        labels.push(label[1].trim());
        continue;
      }
      if (line && !line.startsWith("#")) readingLabels = false;
    }
    if (/^-\s+type:\s+/.test(line)) {
      currentField = { id: null, required: false };
      continue;
    }
    if (currentField) {
      const id = line.match(/^id:\s*([A-Za-z0-9_-]+)\s*$/);
      if (id) currentField.id = id[1];
      if (/^required:\s*true\s*$/i.test(line) && currentField.id) currentField.required = true;
      if (currentField.required && currentField.id && !requiredFields.includes(currentField.id)) requiredFields.push(currentField.id);
    }
  }
  return {
    id: relative,
    path: relative,
    format: "issue-form",
    name: scalarValue(source, "name") || path.basename(relative),
    labels: [...new Set(labels)].sort(),
    requiredFields: [...new Set(requiredFields)].sort()
  };
}

function readIssueTemplates(root, relative = DEFAULT_ISSUE_TEMPLATE_DIRECTORY) {
  const directory = safeRepositoryPath(root, relative, "issue template directory");
  if (!fs.existsSync(directory)) return { path: relative, templates: [], errors: [`issue template directory not found: ${relative}`] };
  const templates = [];
  const errors = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isFile() || !/\.(?:ya?ml|md)$/i.test(entry.name)) continue;
    const templatePath = path.join(directory, entry.name);
    const repositoryRelative = path.relative(path.resolve(root), templatePath).split(path.sep).join("/");
    try {
      const source = fs.readFileSync(templatePath, "utf8");
      templates.push(/\.md$/i.test(entry.name)
        ? { id: repositoryRelative, path: repositoryRelative, format: "markdown", name: entry.name, labels: [], requiredFields: [] }
        : parseFormTemplate(repositoryRelative, source));
    } catch (error) {
      errors.push(`could not read ${repositoryRelative}: ${error.message}`);
    }
  }
  return { path: relative, templates, errors };
}

function readIssuePayload(root, relative) {
  const file = safeRepositoryPath(root, relative, "issue payload");
  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    return { path: relative, payload: null, errors: [`could not parse issue payload: ${error.message}`] };
  }
  const errors = [];
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) errors.push("issue payload must be a JSON object");
  if (payload?.title !== undefined && typeof payload.title !== "string") errors.push("issue payload title must be a string when provided");
  if (payload?.body !== undefined && typeof payload.body !== "string") errors.push("issue payload body must be a string when provided");
  if (payload?.template !== undefined && typeof payload.template !== "string") errors.push("issue payload template must be a string when provided");
  if (payload?.labels !== undefined && (!Array.isArray(payload.labels) || payload.labels.some((item) => typeof item !== "string"))) errors.push("issue payload labels must be an array of strings when provided");
  if (payload?.fields !== undefined && (!payload.fields || typeof payload.fields !== "object" || Array.isArray(payload.fields) || Object.values(payload.fields).some((value) => typeof value !== "string"))) errors.push("issue payload fields must be an object with string values when provided");
  return { path: relative, payload: errors.length ? null : payload, errors };
}

function selectTemplate(templates, requested) {
  if (typeof requested !== "string" || !requested) return null;
  const normalized = requested.split("\\").join("/");
  return templates.find((template) => template.id === normalized || path.basename(template.id) === normalized || path.basename(template.id, path.extname(template.id)) === normalized) || null;
}

function hasSensitiveSignal(value) {
  const text = String(value || "");
  return /(?:api[_-]?key|token|secret|password|private[_-]?key)\s*[:=]\s*["']?[A-Za-z0-9_\-/.+=]{8,}/i.test(text) || /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/.test(text);
}

function makeCheck(id, status, severity, title, message, evidence = []) {
  return { id, category: "issue-intake", status, severity, title, message, evidence };
}

function summarizeChecks(checks) {
  const summary = { pass: 0, warn: 0, fail: 0, total: checks.length };
  for (const check of checks) summary[check.status] += 1;
  return { ...summary, status: summary.fail ? "fail" : (summary.warn ? "needs-attention" : "pass") };
}

function buildIssueIntake(root, issuePath, { templatesPath = DEFAULT_ISSUE_TEMPLATE_DIRECTORY } = {}) {
  const templatesResult = readIssueTemplates(root, templatesPath);
  const issueResult = readIssuePayload(root, issuePath);
  const checks = [];
  if (templatesResult.errors.length) checks.push(makeCheck("intake:templates", "fail", "error", "Issue templates unavailable", templatesResult.errors.join("; "), [{ path: templatesPath }]));
  else checks.push(makeCheck("intake:templates", "pass", "info", "Issue templates available", `${templatesResult.templates.length} template(s) are available.`, [{ path: templatesPath }]));
  if (issueResult.errors.length) checks.push(makeCheck("intake:payload", "fail", "error", "Issue payload invalid", issueResult.errors.join("; "), [{ path: issuePath }]));
  else checks.push(makeCheck("intake:payload", "pass", "info", "Issue payload parsed", "The structured intake payload is valid JSON with supported fields.", [{ path: issuePath }]));
  const issue = issueResult.payload;
  const template = issue ? selectTemplate(templatesResult.templates, issue.template) : null;
  if (issue && issue.template && !template) checks.push(makeCheck("intake:template", "fail", "error", "Requested issue template is unavailable", `No local issue template matches ${issue.template}.`, [{ path: issuePath, detail: "template identifier" }]));
  else if (template) checks.push(makeCheck("intake:template", "pass", "info", "Issue template resolved", `${template.name} provides ${template.requiredFields.length} required field(s).`, [{ path: template.path }]));
  else checks.push(makeCheck("intake:template", "warn", "warning", "Issue template was not identified", "Provide the template field to validate form-specific required fields and labels.", [{ path: issuePath }]));
  const fields = issue?.fields || {};
  const missingFields = template ? template.requiredFields.filter((id) => !String(fields[id] || "").trim()) : [];
  if (template && missingFields.length) checks.push(makeCheck("intake:required-fields", "fail", "error", "Required issue fields are missing", `Missing required form field(s): ${missingFields.join(", ")}.`, missingFields.map((id) => ({ path: issuePath, detail: `field:${id}` }))));
  else if (template) checks.push(makeCheck("intake:required-fields", "pass", "info", "Required issue fields are present", "All required fields declared by the selected local template are non-empty.", template.requiredFields.map((id) => ({ path: issuePath, detail: `field:${id}` }))));
  const actualLabels = new Set((issue?.labels || []).map((label) => label.trim()).filter(Boolean));
  const missingLabels = template ? template.labels.filter((label) => !actualLabels.has(label)) : [];
  if (template?.labels.length && missingLabels.length) checks.push(makeCheck("intake:labels", "warn", "warning", "Suggested template labels are absent", `The selected template suggests label(s): ${missingLabels.join(", ")}.`, missingLabels.map((label) => ({ path: issuePath, detail: `label:${label}` }))));
  else if (template?.labels.length) checks.push(makeCheck("intake:labels", "pass", "info", "Suggested template labels are present", "The structured payload includes all labels declared by the selected template.", template.labels.map((label) => ({ path: issuePath, detail: `label:${label}` }))));
  const signals = [issue?.title, issue?.body, ...Object.values(fields)].filter(hasSensitiveSignal).length;
  if (signals) checks.push(makeCheck("intake:sensitive-content", "warn", "warning", "Potential sensitive-content signal", "One or more issue fields resemble credential assignments or private-key material. Values are intentionally not copied into this packet.", [{ path: issuePath, detail: `${signals} field(s) signaled` }]));
  else if (issue) checks.push(makeCheck("intake:sensitive-content", "pass", "info", "No simple sensitive-content signal", "The payload did not match the bounded credential-like patterns. This is not a secret-scanning guarantee.", [{ path: issuePath }]));
  const fieldSummary = Object.entries(fields).sort(([left], [right]) => left.localeCompare(right)).map(([id, value]) => ({ id, present: Boolean(String(value || "").trim()), length: String(value || "").length }));
  const summary = summarizeChecks(checks);
  return {
    schemaVersion: 1,
    kind: "issue-intake",
    root: path.resolve(root),
    issuePath,
    templates: { path: templatesPath, available: templatesResult.templates.map((item) => ({ id: item.id, format: item.format, labels: item.labels, requiredFields: item.requiredFields })) },
    issue: issue ? {
      titlePresent: Boolean(issue.title?.trim()),
      bodyPresent: Boolean(issue.body?.trim()),
      template: issue.template || null,
      labels: [...actualLabels].sort(),
      fields: fieldSummary
    } : null,
    selectedTemplate: template ? { id: template.id, name: template.name, format: template.format, labels: template.labels, requiredFields: template.requiredFields } : null,
    summary,
    checks,
    recommendations: checks.filter((check) => check.status !== "pass").map((check) => check.message)
  };
}

function formatIssueIntakeMarkdown(packet) {
  const lines = [
    "# ContribProof issue intake",
    "",
    `- Status: **${packet.summary.status}**`,
    `- Issue payload: \`${packet.issuePath}\``,
    `- Selected template: \`${packet.selectedTemplate?.id || "unidentified"}\``,
    `- Checks: **${packet.summary.pass} pass · ${packet.summary.warn} warn · ${packet.summary.fail} fail**`,
    "",
    "## Checks",
    ""
  ];
  for (const check of packet.checks) lines.push(`- **${check.status}** \`${check.id}\` — ${check.message}`);
  if (packet.recommendations.length) lines.push("", "## Maintainer follow-up", "", ...packet.recommendations.map((item) => `- ${item}`));
  lines.push("");
  return `${lines.join("\n").trim()}\n`;
}

module.exports = {
  DEFAULT_ISSUE_TEMPLATE_DIRECTORY,
  buildIssueIntake,
  formatIssueIntakeMarkdown,
  hasSensitiveSignal,
  parseFormTemplate,
  readIssuePayload,
  readIssueTemplates,
  safeRepositoryPath,
  selectTemplate
};
