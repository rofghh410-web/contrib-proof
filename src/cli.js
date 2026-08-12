const fs = require("node:fs");
const path = require("node:path");
const { buildChecks } = require("./checks");
const { compareReports, formatComparisonMarkdown } = require("./compare");
const { loadConfig, writeDefaultConfig } = require("./config");
const { getChangedFiles, getDiffPatch } = require("./git");
const { analyzeImpact, buildGraph } = require("./graph");
const { buildInventory } = require("./inventory");
const { startMcpServer } = require("./mcp-server");
const { explainReport } = require("./openai");
const { buildRemediationPlan, formatPlanMarkdown } = require("./plan");
const { createProofManifest, writeProofBundle } = require("./proof");
const { createReport, formatReport, writeReport } = require("./report");
const { evaluateGate } = require("./gate");
const { buildReviewPacket } = require("./review");
const { formatValidation, validateGate, validatePlan, validateReport } = require("./validate");
const { formatGithubAnnotations } = require("./annotations");

function usage() {
  return `ContribProof — evidence-first contributor-path verification

Usage:
  contrib-proof init [--root PATH] [--force]
  contrib-proof verify [--root PATH] [--execute] [--diff] [--base REF] [--format FORMAT] [--output PATH] [--bundle PATH] [--strict] [--github-annotations]
  contrib-proof proof [same options as verify; writes a complete proof bundle]
  contrib-proof review [--root PATH] [--base REF] [--format FORMAT] [--output PATH] [--bundle PATH] [--github-annotations]
  contrib-proof gate [--root PATH] [--base REF] [--format FORMAT] [--output PATH] [--bundle PATH] [--max-risk LEVEL] [--require-review] [--fail-on-warnings] [--github-annotations]
  contrib-proof compare BASELINE.json CURRENT.json [--format FORMAT] [--output PATH] [--strict]
  contrib-proof plan REPORT.json [--format markdown|json] [--output PATH]
  contrib-proof validate ARTIFACT.json [--kind report|plan|gate] [--format markdown|json] [--output PATH]
  contrib-proof mcp [--root PATH]
  contrib-proof explain REPORT.json [--model MODEL]

Formats: markdown, json, sarif, html

Safety:
  Checks are offline by default. Configured commands run only with --execute,
  use shell=false, and are subject to a timeout.
`;
}

function parseArgs(argv) {
  const options = {
    command: "verify",
    root: process.cwd(),
    execute: false,
    includeDiff: false,
    base: null,
    format: "markdown",
    output: null,
    strict: false,
    force: false,
    reportPath: null,
    inputPath: null,
    kind: "report",
    reportPaths: [],
    model: undefined,
    bundle: null,
    githubAnnotations: false,
    gateOverrides: {}
  };
  let index = 0;
  if (argv[0] && !argv[0].startsWith("-")) {
    options.command = argv[0];
    index = 1;
  }
  while (index < argv.length) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      index += 1;
    } else if (arg === "--root") {
      options.root = path.resolve(argv[index + 1] || "");
      index += 2;
    } else if (arg === "--execute") {
      options.execute = true;
      index += 1;
    } else if (arg === "--diff") {
      options.includeDiff = true;
      index += 1;
    } else if (arg === "--base") {
      options.base = argv[index + 1] || null;
      options.includeDiff = true;
      index += 2;
    } else if (arg === "--format") {
      options.format = argv[index + 1] || "markdown";
      index += 2;
    } else if (arg === "--output") {
      options.output = argv[index + 1] || null;
      index += 2;
    } else if (arg === "--bundle") {
      options.bundle = path.resolve(argv[index + 1] || "artifacts/contrib-proof");
      index += 2;
    } else if (arg === "--strict") {
      options.strict = true;
      index += 1;
    } else if (arg === "--max-risk") {
      options.gateOverrides.maxRisk = argv[index + 1] || "";
      index += 2;
    } else if (arg === "--require-review") {
      options.gateOverrides.requireReview = true;
      index += 1;
    } else if (arg === "--fail-on-warnings") {
      options.gateOverrides.failOnWarnings = true;
      index += 1;
    } else if (arg === "--github-annotations") {
      options.githubAnnotations = true;
      index += 1;
    } else if (arg === "--force") {
      options.force = true;
      index += 1;
    } else if (arg === "--model") {
      options.model = argv[index + 1] || undefined;
      index += 2;
    } else if (arg === "--kind") {
      options.kind = argv[index + 1] || "report";
      index += 2;
    } else if (options.command === "compare" && !arg.startsWith("-") && options.reportPaths.length < 2) {
      options.reportPaths.push(path.resolve(arg));
      index += 1;
    } else if (!options.inputPath && (options.command === "explain" || options.command === "plan" || options.command === "validate") && !arg.startsWith("-")) {
      options.inputPath = path.resolve(arg);
      options.reportPath = options.inputPath;
      index += 1;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return options;
}

function exitCodeFor(report, strict) {
  if (report.gate) return report.gate.passed ? 0 : 1;
  return report.summary.fail > 0 || (strict && report.summary.warn > 0) ? 1 : 0;
}

async function run(argv) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(usage());
    return;
  }
  if (options.command === "--version" || options.command === "version") {
    console.log("0.5.0");
    return;
  }
  if (options.command === "init") {
    const configPath = writeDefaultConfig(options.root, { force: options.force });
    console.log(`Created ${configPath}`);
    return;
  }
  if (options.command === "mcp") {
    await startMcpServer(path.resolve(options.root));
    return;
  }
  if (options.command === "explain") {
    if (!options.reportPath) throw new Error("explain requires a JSON report path");
    const report = JSON.parse(fs.readFileSync(options.reportPath, "utf8"));
    console.log(await explainReport(report, { model: options.model }));
    return;
  }
  if (options.command === "plan") {
    if (!options.inputPath) throw new Error("plan requires a JSON report path");
    const report = JSON.parse(fs.readFileSync(options.inputPath, "utf8"));
    const plan = buildRemediationPlan(report);
    const content = options.format === "json"
      ? `${JSON.stringify(plan, null, 2)}\n`
      : formatPlanMarkdown(plan);
    if (options.output) writeReport(options.output, content);
    else process.stdout.write(content);
    return;
  }
  if (options.command === "validate") {
    if (!options.inputPath) throw new Error("validate requires a JSON artifact path");
    const artifact = JSON.parse(fs.readFileSync(options.inputPath, "utf8"));
    const result = options.kind === "plan" ? validatePlan(artifact) : (options.kind === "gate" ? validateGate(artifact) : validateReport(artifact));
    const content = options.format === "json"
      ? `${JSON.stringify(result, null, 2)}\n`
      : formatValidation(result);
    if (options.output) writeReport(options.output, content);
    else process.stdout.write(content);
    if (!result.valid) process.exitCode = 1;
    return;
  }
  if (options.command === "compare") {
    if (options.reportPaths.length !== 2) throw new Error("compare requires BASELINE.json and CURRENT.json");
    const baseline = JSON.parse(fs.readFileSync(options.reportPaths[0], "utf8"));
    const current = JSON.parse(fs.readFileSync(options.reportPaths[1], "utf8"));
    const comparison = compareReports(baseline, current);
    const content = options.format === "markdown" || options.format === "md"
      ? formatComparisonMarkdown(comparison)
      : `${JSON.stringify(comparison, null, 2)}\n`;
    if (options.output) writeReport(options.output, content);
    else process.stdout.write(content);
    process.exitCode = comparison.regression || (options.strict && comparison.newlyWarning.length > 0) ? 1 : 0;
    return;
  }
  if (options.command !== "verify" && options.command !== "diff" && options.command !== "proof" && options.command !== "review" && options.command !== "gate" && options.command !== "plan" && options.command !== "validate") {
    throw new Error(`unknown command: ${options.command}\n\n${usage()}`);
  }
  if (options.command === "diff" || options.command === "proof" || options.command === "review" || options.command === "gate") options.includeDiff = true;
  if (options.command === "proof" && !options.bundle) options.bundle = path.join(options.root, "artifacts", "contrib-proof");
  if (options.githubAnnotations && !options.output) {
    throw new Error("--github-annotations requires --output so the report stays machine-readable");
  }

  const root = path.resolve(options.root);
  if (!fs.existsSync(root)) throw new Error(`root does not exist: ${root}`);
  const configInfo = loadConfig(root);
  const inventory = buildInventory(root);
  const checks = buildChecks(root, configInfo, {
    execute: options.execute,
    includeDiff: options.includeDiff,
    base: options.base,
    inventory
  });
  let impact = null;
  let diff = null;
  let patchResult = null;
  let review = null;
  if (options.includeDiff) {
    diff = getChangedFiles(root, options.base);
    patchResult = getDiffPatch(root, options.base);
    if (diff.ok) {
      impact = analyzeImpact(root, diff.files.map((file) => file.path), buildGraph(root, inventory));
    }
    review = buildReviewPacket({
      root,
      base: options.base,
      changedFiles: diff.ok && patchResult.ok ? diff.files : null,
      patch: diff.ok && patchResult.ok ? patchResult.patch : null,
      inventory,
      impact
    });
  }
  const report = createReport({
    root,
    checks,
    configPath: configInfo.path,
    mode: options.command === "gate" ? "gate" : (options.command === "review" ? "review" : (options.includeDiff ? "verify+diff" : "verify")),
    strict: options.strict,
    inventory,
    impact,
    review
  });
  report.plan = buildRemediationPlan(report);
  if (options.command === "gate") {
    report.gate = evaluateGate(report, {
      ...configInfo.config.gatePolicy,
      ...options.gateOverrides,
      ...(options.strict ? { failOnWarnings: true } : {})
    });
  }
  const proof = createProofManifest(root, report);
  report.proof = proof;
  if (options.bundle) writeProofBundle(options.bundle, report, proof);
  const content = formatReport(report, options.format);
  if (options.output) {
    writeReport(options.output, content);
  } else {
    process.stdout.write(content);
  }
  if (options.githubAnnotations) process.stdout.write(formatGithubAnnotations(report));
  process.exitCode = exitCodeFor(report, options.strict);
}

module.exports = {
  parseArgs,
  run,
  usage
};
