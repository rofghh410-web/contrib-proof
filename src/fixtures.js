const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { buildVerificationReport } = require("./engine");
const { networkDenySupported, normalizeIsolation, prepareIsolatedWorkspace } = require("./isolation");

const DEFAULT_FIXTURE_MANIFEST = ".contrib-proof-fixtures.json";
const FIXTURE_STATUSES = new Set(["pass", "needs-attention", "fail"]);

function resolveFixturePath(root, relative) {
  if (typeof relative !== "string" || !relative || path.isAbsolute(relative) || /^[A-Za-z]:[\\/]/.test(relative)) throw new Error("fixture paths must be repository-relative");
  const rootAbsolute = path.resolve(root);
  const target = path.resolve(rootAbsolute, relative);
  if (!(target === rootAbsolute || target.startsWith(`${rootAbsolute}${path.sep}`))) throw new Error("fixture paths must remain inside the repository root");
  return target;
}

function readFixtureManifest(root, relative = DEFAULT_FIXTURE_MANIFEST) {
  const file = resolveFixturePath(root, relative);
  if (!fs.existsSync(file)) return { path: file, relative, exists: false, manifest: null, errors: [`fixture manifest not found: ${relative}`] };
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    return { path: file, relative, exists: true, manifest: null, errors: [`could not parse ${relative}: ${error.message}`] };
  }
  const errors = [];
  if (!manifest || manifest.version !== 1 || !Array.isArray(manifest.cases)) errors.push("fixture manifest must contain version 1 and a cases array");
  const ids = new Set();
  for (const [index, item] of (manifest?.cases || []).entries()) {
    if (!item || typeof item !== "object") {
      errors.push(`cases[${index}] must be an object`);
      continue;
    }
    if (typeof item.id !== "string" || !item.id.trim()) errors.push(`cases[${index}].id must be a non-empty string`);
    else if (ids.has(item.id)) errors.push(`cases[${index}].id is duplicated: ${item.id}`);
    else ids.add(item.id);
    if (typeof item.root !== "string" || !item.root.trim()) errors.push(`cases[${index}].root must be a non-empty path`);
    else {
      try {
        resolveFixturePath(root, item.root);
      } catch (error) {
        errors.push(`cases[${index}].root is unsafe: ${error.message}`);
      }
    }
    const expected = item.expected;
    if (!expected || typeof expected !== "object" || !FIXTURE_STATUSES.has(expected.status)) errors.push(`cases[${index}].expected.status must be pass, needs-attention, or fail`);
    for (const field of ["requiredChecks", "requiredPrefixes", "forbiddenChecks"]) {
      if (item.expected?.[field] !== undefined && (!Array.isArray(item.expected[field]) || item.expected[field].some((value) => typeof value !== "string"))) errors.push(`cases[${index}].expected.${field} must be an array of strings`);
    }
    if (item.execute !== undefined && typeof item.execute !== "boolean") errors.push(`cases[${index}].execute must be a boolean when provided`);
    if (item.isolation !== undefined) {
      try {
        normalizeIsolation(item.isolation);
      } catch (error) {
        errors.push(`cases[${index}].isolation is invalid: ${error.message}`);
      }
    }
  }
  return { path: file, relative, exists: true, manifest, errors };
}

function effectiveIsolation(item, options = {}) {
  return normalizeIsolation({
    mode: item.isolation?.mode || options.isolationMode || (options.isolate ? "copy" : "none"),
    network: item.isolation?.network || options.networkPolicy || "allow"
  });
}

function executableFixtureReport(root, { applyExceptions, exceptionsPath } = {}) {
  return buildVerificationReport(root, {
    execute: true,
    includeDiff: false,
    applyExceptions: Boolean(applyExceptions),
    exceptionsPath
  });
}

function runNetworkDeniedFixture(root, options = {}) {
  if (!networkDenySupported()) return { report: null, error: "network-deny fixture isolation is unavailable on this platform" };
  const bin = path.resolve(__dirname, "..", "bin", "contrib-proof.js");
  const args = ["--net", "--", process.execPath, bin, "verify", "--root", root, "--execute", "--format", "json"];
  if (options.applyExceptions) args.push("--apply-exceptions");
  if (options.exceptionsPath) args.push("--exceptions-path", options.exceptionsPath);
  const result = spawnSync("unshare", args, {
    encoding: "utf8",
    shell: false,
    timeout: options.timeoutMs || 180000,
    maxBuffer: 1024 * 1024
  });
  if (result.error) return { report: null, error: `network-deny runner failed: ${result.error.message}` };
  let report = null;
  try {
    report = JSON.parse(result.stdout || "");
  } catch {
    const output = String(result.stderr || result.stdout || "").trim();
    return { report: null, error: `network-deny runner did not produce a report (exit ${result.status ?? "unknown"}): ${output.slice(0, 500)}` };
  }
  return { report, error: null };
}

function runFixtureCase(root, item, options = {}) {
  const sourceRoot = resolveFixturePath(root, item.root);
  const expected = item.expected || {};
  const errors = [];
  let workspace = null;
  let report = null;
  let isolation = null;
  const execute = options.allowExecute === false ? false : (item.execute === undefined ? Boolean(options.execute) : item.execute);
  try {
    const policy = effectiveIsolation(item, options);
    if (policy.network === "deny" && policy.mode !== "copy") throw new Error("network-deny requires isolation mode copy");
    workspace = prepareIsolatedWorkspace(sourceRoot, policy);
    isolation = { ...workspace.isolation, networkEnforced: false };
    if (execute && policy.network === "deny") {
      const result = runNetworkDeniedFixture(workspace.root, options);
      if (result.error) errors.push(result.error);
      else {
        report = result.report;
        isolation.networkEnforced = true;
      }
    } else {
      report = buildVerificationReport(workspace.root, {
        execute,
        includeDiff: false,
        applyExceptions: Boolean(options.applyExceptions),
        exceptionsPath: options.exceptionsPath
      });
    }
  } catch (error) {
    errors.push(`fixture execution failed: ${error.message}`);
  } finally {
    if (workspace) workspace.cleanup();
  }
  const ids = new Set((report?.checks || []).map((check) => check.id));
  const missingRequired = (expected.requiredChecks || []).filter((id) => !ids.has(id));
  const missingPrefixes = (expected.requiredPrefixes || []).filter((prefix) => !(report?.checks || []).some((check) => check.id.startsWith(prefix)));
  const forbiddenPresent = (expected.forbiddenChecks || []).filter((id) => ids.has(id));
  if (report && report.summary.status !== expected.status) errors.push(`expected status ${expected.status}, received ${report.summary.status}`);
  if (missingRequired.length) errors.push(`missing required checks: ${missingRequired.join(", ")}`);
  if (missingPrefixes.length) errors.push(`missing required check prefixes: ${missingPrefixes.join(", ")}`);
  if (forbiddenPresent.length) errors.push(`forbidden checks present: ${forbiddenPresent.join(", ")}`);
  return {
    id: item.id,
    root: item.root,
    expectedStatus: expected.status || null,
    actualStatus: report?.summary?.status || null,
    passed: errors.length === 0,
    errors,
    checks: report?.checks?.length || 0,
    score: report?.summary?.score ?? null,
    isolation
  };
}

function selectFixtureCases(cases, requestedIds = []) {
  const requested = [...new Set((Array.isArray(requestedIds) ? requestedIds : []).filter((value) => typeof value === "string" && value.trim()).map((value) => value.trim()))];
  if (!requested.length) return { requested: [], cases, errors: [] };
  const available = new Set(cases.map((item) => item.id));
  const unknown = requested.filter((id) => !available.has(id));
  return {
    requested,
    cases: cases.filter((item) => requested.includes(item.id)),
    errors: unknown.length ? [`requested fixture case(s) not found: ${unknown.join(", ")}`] : []
  };
}

function runFixtureSuite(root, relative = DEFAULT_FIXTURE_MANIFEST, options = {}) {
  const manifestResult = readFixtureManifest(root, relative);
  if (manifestResult.errors.length) return { schemaVersion: 1, kind: "fixture-suite", path: relative, selection: { requested: [], selected: [] }, valid: false, summary: { total: 0, passed: 0, failed: 0 }, cases: [], errors: manifestResult.errors };
  const selection = selectFixtureCases(manifestResult.manifest.cases, options.caseIds);
  if (selection.errors.length) return { schemaVersion: 1, kind: "fixture-suite", path: relative, selection: { requested: selection.requested, selected: selection.cases.map((item) => item.id) }, valid: false, summary: { total: 0, passed: 0, failed: 0 }, cases: [], errors: selection.errors };
  const cases = selection.cases.map((item) => runFixtureCase(root, item, options));
  const passed = cases.filter((item) => item.passed).length;
  return {
    schemaVersion: 1,
    kind: "fixture-suite",
    path: relative,
    selection: { requested: selection.requested, selected: selection.cases.map((item) => item.id) },
    valid: passed === cases.length,
    summary: { total: cases.length, passed, failed: cases.length - passed },
    cases,
    errors: []
  };
}

function formatFixtureSuiteMarkdown(result) {
  const lines = [
    "# ContribProof fixture suite",
    "",
    `- Status: **${result.valid ? "pass" : "fail"}**`,
    `- Cases: **${result.summary.passed}/${result.summary.total}** passed`,
    `- Manifest: \`${result.path}\``,
    `- Selected cases: **${result.selection?.selected?.length || 0}${result.selection?.requested?.length ? ` (requested: ${result.selection.requested.join(", ")})` : ""}**`,
    "",
    "## Cases",
    ""
  ];
  for (const item of result.cases || []) {
    const policy = item.isolation ? `${item.isolation.mode}; network ${item.isolation.network}${item.isolation.networkEnforced ? " (enforced)" : ""}` : "none";
    lines.push(`### ${item.passed ? "pass" : "fail"} ${item.id}`, "", `- Root: \`${item.root}\``, `- Expected: **${item.expectedStatus}**`, `- Actual: **${item.actualStatus || "unavailable"}**`, `- Checks: **${item.checks}**`, `- Isolation: **${policy}**`, "");
    if (item.errors.length) lines.push(...item.errors.map((error) => `- ${error}`), "");
  }
  if (result.errors?.length) lines.push("## Errors", "", ...result.errors.map((error) => `- ${error}`), "");
  return `${lines.join("\n").trim()}\n`;
}

module.exports = {
  DEFAULT_FIXTURE_MANIFEST,
  FIXTURE_STATUSES,
  effectiveIsolation,
  formatFixtureSuiteMarkdown,
  readFixtureManifest,
  resolveFixturePath,
  runFixtureCase,
  runFixtureSuite,
  selectFixtureCases
};
