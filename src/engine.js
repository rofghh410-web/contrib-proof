const path = require("node:path");
const { buildChecks } = require("./checks");
const { loadConfig } = require("./config");
const { buildExecutionContext } = require("./context");
const { getChangedFiles, getDiffPatch } = require("./git");
const { analyzeImpact, buildGraph } = require("./graph");
const { buildInventory } = require("./inventory");
const { buildRemediationPlan } = require("./plan");
const { createReport } = require("./report");
const { evaluateGate } = require("./gate");
const { buildReviewPacket } = require("./review");
const { buildReleaseReadiness } = require("./release");
const { DEFAULT_EXCEPTIONS_PATH, activeExceptions, applyExceptions, buildExceptionChecks, readExceptions, summarizeExceptions } = require("./exceptions");

function buildVerificationReport(root, options = {}) {
  const resolvedRoot = path.resolve(root);
  const includeDiff = Boolean(options.includeDiff);
  const base = options.base || null;
  const configInfo = loadConfig(resolvedRoot);
  const inventory = buildInventory(resolvedRoot);
  const checks = buildChecks(resolvedRoot, configInfo, {
    execute: Boolean(options.execute),
    includeDiff,
    base,
    inventory
  });
  const exceptionsPath = options.exceptionsPath || DEFAULT_EXCEPTIONS_PATH;
  const exceptionResult = readExceptions(resolvedRoot, exceptionsPath);
  const configuredChecks = [...checks, ...buildExceptionChecks(exceptionResult)];
  const effectiveChecks = options.applyExceptions
    ? applyExceptions(configuredChecks, activeExceptions(resolvedRoot, exceptionsPath))
    : configuredChecks;

  let impact = null;
  let diff = null;
  let patchResult = null;
  let review = null;
  if (includeDiff) {
    diff = getChangedFiles(resolvedRoot, base);
    patchResult = getDiffPatch(resolvedRoot, base);
    if (diff.ok) impact = analyzeImpact(resolvedRoot, diff.files.map((file) => file.path), buildGraph(resolvedRoot, inventory));
    review = buildReviewPacket({
      root: resolvedRoot,
      base,
      changedFiles: diff.ok && patchResult.ok ? diff.files : null,
      patch: diff.ok && patchResult.ok ? patchResult.patch : null,
      inventory,
      impact
    });
  }

  const mode = options.mode || (options.includeGate ? "gate" : (options.includeRelease ? "release" : (options.includeReview ? "review" : (includeDiff ? "verify+diff" : "verify"))));
  const report = createReport({
    root: resolvedRoot,
    checks: effectiveChecks,
    configPath: configInfo.path,
    mode,
    strict: Boolean(options.strict),
    inventory,
    impact,
    review,
    context: buildExecutionContext(resolvedRoot, configInfo, {
      includeDiff,
      execute: options.execute,
      base,
      applyExceptions: options.applyExceptions,
      exceptionsPath
    }),
    exceptions: {
      ...summarizeExceptions(exceptionResult),
      path: exceptionsPath,
      applied: Boolean(options.applyExceptions)
    }
  });
  if (options.includeRelease) report.release = buildReleaseReadiness({ root: resolvedRoot, since: base, version: options.version || null, report });
  report.plan = buildRemediationPlan(report);
  if (options.includeGate) report.gate = evaluateGate(report, options.gatePolicy || configInfo.config.gatePolicy);
  return report;
}

module.exports = { buildVerificationReport };
