const fs = require("node:fs");
const path = require("node:path");
const packageJson = require("../package.json");
const { compareReports, formatComparisonMarkdown } = require("./compare");
const { evaluateBaseline, formatBaselineMarkdown } = require("./baseline");
const { loadConfig, writeDefaultConfig } = require("./config");
const { buildVerificationReport } = require("./engine");
const { startMcpServer } = require("./mcp-server");
const { explainReport } = require("./openai");
const { buildRemediationPlan, formatPlanMarkdown } = require("./plan");
const { createProofManifest, formatProofVerificationMarkdown, verifyProofBundle, writeProofBundle } = require("./proof");
const { formatReport, writeReport } = require("./report");
const { formatValidation, validateBaseline, validateDoctor, validateExceptions, validateFixtureSuite, validateGate, validateHistoryRetention, validateIssueIntake, validatePlan, validateProofAttestation, validateProofAttestationVerification, validateProofManifest, validateProofVerification, validateRelease, validateReport } = require("./validate");
const { formatGithubAnnotations } = require("./annotations");
const { appendHistory, applyHistoryRetention, DEFAULT_HISTORY_PATH, formatHistoryMarkdown, formatHistoryRetentionMarkdown, planHistoryRetention, readHistory, summarizeHistory } = require("./history");
const { buildDoctorReport, formatDoctorMarkdown } = require("./doctor");
const { DEFAULT_EXCEPTIONS_PATH } = require("./exceptions");
const { appendLedger, DEFAULT_LEDGER_PATH, formatLedgerMarkdown, verifyLedger } = require("./ledger");
const { DEFAULT_FIXTURE_MANIFEST, formatFixtureSuiteMarkdown, runFixtureSuite } = require("./fixtures");
const { createProofAttestationFromFiles, formatProofAttestationVerificationMarkdown, generateAttestationKeyPair, verifyProofAttestationFromFiles } = require("./attestation");
const { DEFAULT_ISSUE_TEMPLATE_DIRECTORY, buildIssueIntake, formatIssueIntakeMarkdown } = require("./intake");

function parseNonNegativeInteger(value, flag) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${flag} requires a non-negative integer`);
  return parsed;
}

function usage() {
  return `ContribProof — evidence-first contributor-path verification

Usage:
  contrib-proof init [--root PATH] [--force]
  contrib-proof verify [--root PATH] [--execute] [--diff] [--base REF] [--format FORMAT] [--output PATH] [--bundle PATH] [--strict] [--github-annotations]
  contrib-proof proof [same options as verify; writes a complete proof bundle]
  contrib-proof proof-verify BUNDLE [--root PATH] [--format markdown|json] [--output PATH]
  contrib-proof attest-keygen --private-key PATH --public-key PATH [--force] [--output PATH]
  contrib-proof attest BUNDLE --private-key PATH [--key-id ID] [--output PATH]
  contrib-proof attest-verify ATTESTATION.json --public-key PATH [--bundle BUNDLE] [--format markdown|json] [--output PATH]
  contrib-proof review [--root PATH] [--base REF] [--format FORMAT] [--output PATH] [--bundle PATH] [--github-annotations]
  contrib-proof gate [--root PATH] [--base REF] [--format FORMAT] [--output PATH] [--bundle PATH] [--max-risk LEVEL] [--require-review] [--fail-on-warnings] [--github-annotations]
  contrib-proof release [--root PATH] [--since REF] [--version VERSION] [--format FORMAT] [--output PATH] [--bundle PATH]
  contrib-proof history [--root PATH] [--record REPORT.json] [--history-path PATH] [--retain N] [--apply-retention] [--format markdown|json] [--output PATH]
  contrib-proof ledger [--root PATH] [--record REPORT.json] [--ledger-path PATH] [--format markdown|json] [--output PATH]
  contrib-proof doctor [--root PATH] [--format markdown|json] [--output PATH]
  contrib-proof fixtures [--root PATH] [--fixtures-path PATH] [--case ID] [--execute] [--format markdown|json] [--output PATH]
  contrib-proof intake ISSUE.json [--root PATH] [--templates-path PATH] [--format markdown|json] [--output PATH]
  contrib-proof compare BASELINE.json CURRENT.json [--format FORMAT] [--output PATH] [--strict]
  contrib-proof baseline BASELINE.json CURRENT.json [--max-new-failures N] [--max-new-warnings N] [--max-score-drop N] [--format markdown|json] [--output PATH]
  contrib-proof plan REPORT.json [--format markdown|json] [--output PATH]
  contrib-proof validate ARTIFACT.json [--kind report|plan|gate|release|baseline|doctor|exceptions|fixtures|history-retention|issue-intake|proof-manifest|proof-verification|proof-attestation|proof-attestation-verification] [--format markdown|json] [--output PATH]
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
    rootExplicit: false,
    kind: "report",
    reportPaths: [],
    model: undefined,
    bundle: null,
    githubAnnotations: false,
    since: null,
    version: null,
    recordPath: null,
    historyPath: DEFAULT_HISTORY_PATH,
    ledgerPath: DEFAULT_LEDGER_PATH,
    exceptionsPath: DEFAULT_EXCEPTIONS_PATH,
    fixturesPath: DEFAULT_FIXTURE_MANIFEST,
    applyExceptions: false,
    baselinePolicy: {},
    gateOverrides: {},
    privateKeyPath: null,
    publicKeyPath: null,
    keyId: null,
    caseIds: [],
    templatesPath: DEFAULT_ISSUE_TEMPLATE_DIRECTORY,
    retainHistory: null,
    applyRetention: false
  };
  let index = 0;
  if (argv[0] === "--version" && argv.length === 1) {
    options.command = "version";
    index = 1;
  } else if (argv[0] && !argv[0].startsWith("-")) {
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
      options.rootExplicit = true;
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
    } else if (arg === "--since") {
      options.since = argv[index + 1] || null;
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
    } else if (arg === "--private-key") {
      options.privateKeyPath = path.resolve(argv[index + 1] || "");
      index += 2;
    } else if (arg === "--public-key") {
      options.publicKeyPath = path.resolve(argv[index + 1] || "");
      index += 2;
    } else if (arg === "--key-id") {
      options.keyId = argv[index + 1] || null;
      index += 2;
    } else if (arg === "--case") {
      options.caseIds.push(argv[index + 1] || "");
      index += 2;
    } else if (arg === "--templates-path") {
      options.templatesPath = argv[index + 1] || DEFAULT_ISSUE_TEMPLATE_DIRECTORY;
      index += 2;
    } else if (arg === "--retain") {
      options.retainHistory = parseNonNegativeInteger(argv[index + 1], arg);
      index += 2;
    } else if (arg === "--apply-retention") {
      options.applyRetention = true;
      index += 1;
    } else if (arg === "--model") {
      options.model = argv[index + 1] || undefined;
      index += 2;
    } else if (arg === "--version") {
      options.version = argv[index + 1] || null;
      index += 2;
    } else if (arg === "--record") {
      options.recordPath = path.resolve(argv[index + 1] || "");
      index += 2;
    } else if (arg === "--history-path") {
      options.historyPath = argv[index + 1] || DEFAULT_HISTORY_PATH;
      index += 2;
    } else if (arg === "--ledger-path") {
      options.ledgerPath = argv[index + 1] || DEFAULT_LEDGER_PATH;
      index += 2;
    } else if (arg === "--exceptions-path") {
      options.exceptionsPath = argv[index + 1] || DEFAULT_EXCEPTIONS_PATH;
      index += 2;
    } else if (arg === "--fixtures-path") {
      options.fixturesPath = argv[index + 1] || DEFAULT_FIXTURE_MANIFEST;
      index += 2;
    } else if (arg === "--apply-exceptions") {
      options.applyExceptions = true;
      index += 1;
    } else if (arg === "--max-new-failures") {
      options.baselinePolicy.maxNewFailures = parseNonNegativeInteger(argv[index + 1], arg);
      index += 2;
    } else if (arg === "--max-new-warnings") {
      options.baselinePolicy.maxNewWarnings = parseNonNegativeInteger(argv[index + 1], arg);
      index += 2;
    } else if (arg === "--max-score-drop") {
      options.baselinePolicy.maxScoreDrop = parseNonNegativeInteger(argv[index + 1], arg);
      index += 2;
    } else if (arg === "--kind") {
      options.kind = argv[index + 1] || "report";
      index += 2;
    } else if ((options.command === "compare" || options.command === "baseline") && !arg.startsWith("-") && options.reportPaths.length < 2) {
      options.reportPaths.push(path.resolve(arg));
      index += 1;
    } else if (!options.inputPath && (options.command === "explain" || options.command === "plan" || options.command === "validate" || options.command === "proof-verify" || options.command === "attest" || options.command === "attest-verify" || options.command === "intake") && !arg.startsWith("-")) {
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
  const releaseBlocked = report.release?.summary?.fail > 0 || (strict && report.release?.summary?.warn > 0);
  return report.summary.fail > 0 || (strict && report.summary.warn > 0) || releaseBlocked ? 1 : 0;
}

async function run(argv) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(usage());
    return;
  }
  if (options.command === "--version" || options.command === "version") {
    console.log(packageJson.version);
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
  if (options.command === "doctor") {
    const doctor = buildDoctorReport(path.resolve(options.root));
    const content = options.format === "json" ? `${JSON.stringify(doctor, null, 2)}\n` : formatDoctorMarkdown(doctor);
    if (options.output) writeReport(options.output, content);
    else process.stdout.write(content);
    process.exitCode = doctor.summary.fail > 0 || (options.strict && doctor.summary.warn > 0) ? 1 : 0;
    return;
  }
  if (options.command === "fixtures") {
    const root = path.resolve(options.root);
    if (!fs.existsSync(root)) throw new Error(`root does not exist: ${root}`);
    const suite = runFixtureSuite(root, options.fixturesPath, { execute: options.execute, caseIds: options.caseIds, applyExceptions: options.applyExceptions, exceptionsPath: options.exceptionsPath });
    const content = options.format === "json" ? `${JSON.stringify(suite, null, 2)}\n` : formatFixtureSuiteMarkdown(suite);
    if (options.output) writeReport(options.output, content);
    else process.stdout.write(content);
    process.exitCode = suite.valid ? 0 : 1;
    return;
  }
  if (options.command === "proof-verify") {
    if (!options.inputPath) throw new Error("proof-verify requires a bundle directory");
    const verification = verifyProofBundle(options.inputPath, options.rootExplicit ? path.resolve(options.root) : null);
    const content = options.format === "json" ? `${JSON.stringify(verification, null, 2)}\n` : formatProofVerificationMarkdown(verification);
    if (options.output) writeReport(options.output, content);
    else process.stdout.write(content);
    process.exitCode = verification.valid ? 0 : 1;
    return;
  }
  if (options.command === "attest-keygen") {
    const generated = generateAttestationKeyPair(options.privateKeyPath, options.publicKeyPath, { force: options.force });
    const content = `${JSON.stringify(generated, null, 2)}\n`;
    if (options.output) writeReport(options.output, content);
    else process.stdout.write(content);
    return;
  }
  if (options.command === "attest") {
    if (!options.inputPath) throw new Error("attest requires a proof bundle directory");
    if (!options.privateKeyPath) throw new Error("attest requires --private-key PATH");
    const attestation = createProofAttestationFromFiles(options.inputPath, options.privateKeyPath, { keyId: options.keyId });
    const content = `${JSON.stringify(attestation, null, 2)}\n`;
    const outputPath = options.output || path.join(path.resolve(options.inputPath), "attestation.json");
    writeReport(outputPath, content);
    if (!options.output) process.stdout.write(content);
    return;
  }
  if (options.command === "attest-verify") {
    if (!options.inputPath) throw new Error("attest-verify requires an attestation JSON path");
    if (!options.publicKeyPath) throw new Error("attest-verify requires --public-key PATH");
    const verification = verifyProofAttestationFromFiles(options.inputPath, options.publicKeyPath, options.bundle);
    const content = options.format === "json" ? `${JSON.stringify(verification, null, 2)}\n` : formatProofAttestationVerificationMarkdown(verification);
    if (options.output) writeReport(options.output, content);
    else process.stdout.write(content);
    process.exitCode = verification.valid ? 0 : 1;
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
    let result;
    if (options.kind === "plan") result = validatePlan(artifact);
    else if (options.kind === "gate") result = validateGate(artifact);
    else if (options.kind === "release") result = validateRelease(artifact);
    else if (options.kind === "baseline") result = validateBaseline(artifact);
    else if (options.kind === "doctor") result = validateDoctor(artifact);
    else if (options.kind === "exceptions") result = validateExceptions(artifact);
    else if (options.kind === "fixtures") result = validateFixtureSuite(artifact);
    else if (options.kind === "proof-manifest") result = validateProofManifest(artifact);
    else if (options.kind === "proof-verification") result = validateProofVerification(artifact);
    else if (options.kind === "proof-attestation") result = validateProofAttestation(artifact);
    else if (options.kind === "proof-attestation-verification") result = validateProofAttestationVerification(artifact);
    else if (options.kind === "history-retention") result = validateHistoryRetention(artifact);
    else if (options.kind === "issue-intake") result = validateIssueIntake(artifact);
    else result = validateReport(artifact);
    const content = options.format === "json"
      ? `${JSON.stringify(result, null, 2)}\n`
      : formatValidation(result);
    if (options.output) writeReport(options.output, content);
    else process.stdout.write(content);
    if (!result.valid) process.exitCode = 1;
    return;
  }
  if (options.command === "history") {
    const root = path.resolve(options.root);
    if (options.recordPath) {
      const report = JSON.parse(fs.readFileSync(options.recordPath, "utf8"));
      const validation = validateReport(report);
      if (!validation.valid) throw new Error(`cannot record invalid report: ${validation.errors.join("; ")}`);
      appendHistory(root, report, options.historyPath);
    }
    const history = readHistory(root, options.historyPath);
    const summary = summarizeHistory(history.entries);
    let retention = null;
    if (options.retainHistory !== null) {
      retention = options.applyRetention
        ? applyHistoryRetention(root, options.historyPath, options.retainHistory)
        : { ...planHistoryRetention(history.entries, options.retainHistory), path: options.historyPath };
    }
    const result = { ...summary, path: options.historyPath, errors: history.errors, retention };
    const content = options.format === "json"
      ? `${JSON.stringify(result, null, 2)}\n`
      : (retention ? `${formatHistoryMarkdown(summary)}\n${formatHistoryRetentionMarkdown(retention)}` : formatHistoryMarkdown(summary));
    if (options.output) writeReport(options.output, content);
    else process.stdout.write(content);
    if (history.errors.length) process.exitCode = 1;
    return;
  }
  if (options.command === "intake") {
    if (!options.inputPath) throw new Error("intake requires an issue JSON path");
    const root = path.resolve(options.root);
    const issuePath = path.relative(root, options.inputPath).split(path.sep).join("/");
    const packet = buildIssueIntake(root, issuePath, { templatesPath: options.templatesPath });
    const content = options.format === "json" ? `${JSON.stringify(packet, null, 2)}\n` : formatIssueIntakeMarkdown(packet);
    if (options.output) writeReport(options.output, content);
    else process.stdout.write(content);
    process.exitCode = packet.summary.fail > 0 ? 1 : 0;
    return;
  }
  if (options.command === "ledger") {
    const root = path.resolve(options.root);
    if (options.recordPath) {
      const report = JSON.parse(fs.readFileSync(options.recordPath, "utf8"));
      const validation = validateReport(report);
      if (!validation.valid) throw new Error(`cannot record invalid report: ${validation.errors.join("; ")}`);
      appendLedger(root, report, options.ledgerPath);
    }
    const verification = verifyLedger(root, options.ledgerPath);
    const result = { ...verification, path: options.ledgerPath };
    const content = options.format === "json" ? `${JSON.stringify(result, null, 2)}\n` : formatLedgerMarkdown(result);
    if (options.output) writeReport(options.output, content);
    else process.stdout.write(content);
    if (!verification.valid) process.exitCode = 1;
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
  if (options.command === "baseline") {
    if (options.reportPaths.length !== 2) throw new Error("baseline requires BASELINE.json and CURRENT.json");
    const baseline = JSON.parse(fs.readFileSync(options.reportPaths[0], "utf8"));
    const current = JSON.parse(fs.readFileSync(options.reportPaths[1], "utf8"));
    const baselineValidation = validateReport(baseline);
    const currentValidation = validateReport(current);
    if (!baselineValidation.valid || !currentValidation.valid) throw new Error("baseline and current artifacts must both be valid reports");
    const decision = evaluateBaseline(baseline, current, options.baselinePolicy);
    const content = options.format === "markdown" || options.format === "md"
      ? formatBaselineMarkdown(decision)
      : `${JSON.stringify(decision, null, 2)}\n`;
    if (options.output) writeReport(options.output, content);
    else process.stdout.write(content);
    process.exitCode = decision.passed ? 0 : 1;
    return;
  }
  if (options.command !== "verify" && options.command !== "diff" && options.command !== "proof" && options.command !== "review" && options.command !== "gate" && options.command !== "release" && options.command !== "plan" && options.command !== "validate" && options.command !== "history" && options.command !== "ledger" && options.command !== "doctor" && options.command !== "baseline" && options.command !== "proof-verify" && options.command !== "fixtures" && options.command !== "attest-keygen" && options.command !== "attest" && options.command !== "attest-verify" && options.command !== "intake") {
    throw new Error(`unknown command: ${options.command}\n\n${usage()}`);
  }
  if (options.command === "diff" || options.command === "proof" || options.command === "review" || options.command === "gate" || options.command === "release") options.includeDiff = true;
  if (options.command === "proof" && !options.bundle) options.bundle = path.join(options.root, "artifacts", "contrib-proof");
  if (options.command === "release" && !options.bundle) options.bundle = null;
  if (options.githubAnnotations && !options.output) {
    throw new Error("--github-annotations requires --output so the report stays machine-readable");
  }

  const root = path.resolve(options.root);
  if (!fs.existsSync(root)) throw new Error(`root does not exist: ${root}`);
  const report = buildVerificationReport(root, {
    execute: options.execute,
    includeDiff: options.includeDiff,
    includeGate: options.command === "gate",
    includeRelease: options.command === "release",
    includeReview: options.command === "review",
    mode: options.command === "gate" ? "gate" : (options.command === "review" ? "review" : (options.command === "release" ? "release" : (options.includeDiff ? "verify+diff" : "verify"))),
    base: options.since || options.base,
    version: options.version,
    strict: options.strict,
    applyExceptions: options.applyExceptions,
    exceptionsPath: options.exceptionsPath,
    gatePolicy: options.command === "gate" ? {
      ...loadConfig(root).config.gatePolicy,
      ...options.gateOverrides,
      ...(options.strict ? { failOnWarnings: true } : {})
    } : undefined
  });
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
