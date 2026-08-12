const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");
const { buildInventory } = require("./inventory");
const { buildRemediationPlan } = require("./plan");
const { buildVerificationReport } = require("./engine");
const { buildDoctorReport } = require("./doctor");
const { DEFAULT_EXCEPTIONS_PATH } = require("./exceptions");
const { DEFAULT_LEDGER_PATH, verifyLedger } = require("./ledger");
const { evaluateBaseline } = require("./baseline");
const { validateReport } = require("./validate");
const { DEFAULT_FIXTURE_MANIFEST, runFixtureSuite } = require("./fixtures");
const { verifyProofBundle } = require("./proof");

function reply(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}

function errorReply(id, code, message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } })}\n`);
}

function exceptionOptions(args = {}) {
  return [Boolean(args.applyExceptions), typeof args.exceptionsPath === "string" ? args.exceptionsPath : DEFAULT_EXCEPTIONS_PATH];
}

function safeRepositoryPath(root, relative, label = "path") {
  if (typeof relative !== "string" || !relative) throw new Error(`${label} is required`);
  const rootAbsolute = path.resolve(root);
  const target = path.resolve(rootAbsolute, relative);
  if (!(target === rootAbsolute || target.startsWith(`${rootAbsolute}${path.sep}`))) throw new Error(`${label} must remain inside the repository root`);
  return target;
}

function verify(root, includeDiff = false, base = null, includeGate = false, includeRelease = false, version = null, applyExceptionPolicy = false, exceptionsPath = DEFAULT_EXCEPTIONS_PATH) {
  return buildVerificationReport(root, {
    includeDiff,
    includeGate,
    includeRelease,
    includeReview: includeDiff,
    base,
    version,
    applyExceptions: applyExceptionPolicy,
    exceptionsPath,
    mode: includeGate ? "gate" : (includeRelease ? "release" : (includeDiff ? "verify+diff" : "verify"))
  });
}

async function handleRequest(root, request) {
  const id = request.id ?? null;
  if (request.method === "initialize") {
    reply(id, {
      protocolVersion: request.params?.protocolVersion || "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "contrib-proof", version: "0.8.1" }
    });
    return;
  }
  if (request.method === "notifications/initialized") return;
  if (request.method === "tools/list") {
    reply(id, {
      tools: [
        { name: "repo_verify", description: "Run read-only contributor-path checks for the configured repository.", inputSchema: { type: "object", properties: { applyExceptions: { type: "boolean" }, exceptionsPath: { type: "string" } } } },
        { name: "repo_inventory", description: "Return a read-only inventory of files, languages, manifests, workflows, and package scripts.", inputSchema: { type: "object", properties: {} } },
        { name: "repo_diff", description: "Run read-only change-policy checks against a Git base ref.", inputSchema: { type: "object", properties: { base: { type: "string" }, applyExceptions: { type: "boolean" }, exceptionsPath: { type: "string" } } } },
        { name: "repo_plan", description: "Return a read-only prioritized remediation plan derived from repository checks.", inputSchema: { type: "object", properties: { applyExceptions: { type: "boolean" }, exceptionsPath: { type: "string" } } } },
        { name: "repo_review", description: "Return a read-only change-risk and test-evidence packet for a Git diff.", inputSchema: { type: "object", properties: { base: { type: "string" }, applyExceptions: { type: "boolean" }, exceptionsPath: { type: "string" } } } },
        { name: "repo_gate", description: "Return a read-only deterministic merge-gate decision for a Git diff.", inputSchema: { type: "object", properties: { base: { type: "string" }, applyExceptions: { type: "boolean" }, exceptionsPath: { type: "string" } } } },
        { name: "repo_release", description: "Return a read-only release-readiness report from Git history and repository metadata.", inputSchema: { type: "object", properties: { base: { type: "string" }, version: { type: "string" }, applyExceptions: { type: "boolean" }, exceptionsPath: { type: "string" } } } },
        { name: "repo_doctor", description: "Return read-only runtime, Git, configuration, and executable-availability diagnostics.", inputSchema: { type: "object", properties: {} } },
        { name: "repo_ledger", description: "Verify the append-only maintenance ledger without modifying it.", inputSchema: { type: "object", properties: { ledgerPath: { type: "string" } } } },
        { name: "repo_baseline", description: "Evaluate two repository reports against a deterministic regression budget.", inputSchema: { type: "object", properties: { baselinePath: { type: "string" }, currentPath: { type: "string" }, maxNewFailures: { type: "integer", minimum: 0 }, maxNewWarnings: { type: "integer", minimum: 0 }, maxScoreDrop: { type: "integer", minimum: 0 } }, required: ["baselinePath", "currentPath"] } },
        { name: "repo_proof_verify", description: "Verify a proof bundle and its referenced evidence hashes without modifying the repository.", inputSchema: { type: "object", properties: { bundlePath: { type: "string" } }, required: ["bundlePath"] } },
        { name: "repo_fixtures", description: "Run the repository's declarative fixture contract suite without executing project commands.", inputSchema: { type: "object", properties: { fixturesPath: { type: "string" }, applyExceptions: { type: "boolean" }, exceptionsPath: { type: "string" } } } }
      ]
    });
    return;
  }
  if (request.method !== "tools/call") {
    errorReply(id, -32601, `Unsupported method: ${request.method}`);
    return;
  }
  const name = request.params?.name;
  const args = request.params?.arguments || {};
  if (name === "repo_verify") {
    const report = verify(root, false, null, false, false, null, ...exceptionOptions(args));
    reply(id, { content: [{ type: "text", text: JSON.stringify(report, null, 2) }], structuredContent: report });
    return;
  }
  if (name === "repo_inventory") {
    const inventory = buildInventory(root);
    reply(id, { content: [{ type: "text", text: JSON.stringify(inventory, null, 2) }], structuredContent: inventory });
    return;
  }
  if (name === "repo_diff") {
    const base = args.base || null;
    const report = verify(root, true, typeof base === "string" ? base : null, false, false, null, ...exceptionOptions(args));
    reply(id, { content: [{ type: "text", text: JSON.stringify(report, null, 2) }], structuredContent: report });
    return;
  }
  if (name === "repo_plan") {
    const report = verify(root, false, null, false, false, null, ...exceptionOptions(args));
    const plan = report.plan || buildRemediationPlan(report);
    reply(id, { content: [{ type: "text", text: JSON.stringify(plan, null, 2) }], structuredContent: plan });
    return;
  }
  if (name === "repo_review") {
    const base = args.base || null;
    const report = verify(root, true, typeof base === "string" ? base : null, false, false, null, ...exceptionOptions(args));
    reply(id, { content: [{ type: "text", text: JSON.stringify(report.review, null, 2) }], structuredContent: report.review });
    return;
  }
  if (name === "repo_gate") {
    const base = args.base || null;
    const report = verify(root, true, typeof base === "string" ? base : null, true, false, null, ...exceptionOptions(args));
    reply(id, { content: [{ type: "text", text: JSON.stringify(report.gate, null, 2) }], structuredContent: report.gate });
    return;
  }
  if (name === "repo_release") {
    const base = typeof args.base === "string" ? args.base : null;
    const version = typeof args.version === "string" ? args.version : null;
    const report = verify(root, true, base, false, true, version, ...exceptionOptions(args));
    reply(id, { content: [{ type: "text", text: JSON.stringify(report.release, null, 2) }], structuredContent: report.release });
    return;
  }
  if (name === "repo_doctor") {
    const doctor = buildDoctorReport(root);
    reply(id, { content: [{ type: "text", text: JSON.stringify(doctor, null, 2) }], structuredContent: doctor });
    return;
  }
  if (name === "repo_ledger") {
    const ledgerPath = typeof request.params?.arguments?.ledgerPath === "string" ? request.params.arguments.ledgerPath : DEFAULT_LEDGER_PATH;
    const ledger = verifyLedger(root, ledgerPath);
    reply(id, { content: [{ type: "text", text: JSON.stringify(ledger, null, 2) }], structuredContent: ledger });
    return;
  }
  if (name === "repo_baseline") {
    const baseline = JSON.parse(fs.readFileSync(safeRepositoryPath(root, args.baselinePath, "baseline path"), "utf8"));
    const current = JSON.parse(fs.readFileSync(safeRepositoryPath(root, args.currentPath, "current path"), "utf8"));
    if (!validateReport(baseline).valid || !validateReport(current).valid) throw new Error("baseline paths must reference valid report artifacts");
    const decision = evaluateBaseline(baseline, current, {
      maxNewFailures: args.maxNewFailures,
      maxNewWarnings: args.maxNewWarnings,
      maxScoreDrop: args.maxScoreDrop
    });
    reply(id, { content: [{ type: "text", text: JSON.stringify(decision, null, 2) }], structuredContent: decision });
    return;
  }
  if (name === "repo_proof_verify") {
    const bundlePath = args.bundlePath;
    const bundle = safeRepositoryPath(root, bundlePath, "proof bundle");
    const verification = verifyProofBundle(bundle, root);
    reply(id, { content: [{ type: "text", text: JSON.stringify(verification, null, 2) }], structuredContent: verification });
    return;
  }
  if (name === "repo_fixtures") {
    const fixturesPath = typeof args.fixturesPath === "string" ? args.fixturesPath : DEFAULT_FIXTURE_MANIFEST;
    const suite = runFixtureSuite(root, fixturesPath, { execute: false, allowExecute: false, applyExceptions: Boolean(args.applyExceptions), exceptionsPath: typeof args.exceptionsPath === "string" ? args.exceptionsPath : undefined });
    reply(id, { content: [{ type: "text", text: JSON.stringify(suite, null, 2) }], structuredContent: suite });
    return;
  }
  errorReply(id, -32602, `Unknown tool: ${name}`);
}

function startMcpServer(root) {
  const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  input.on("line", (line) => {
    if (!line.trim()) return;
    try {
      const request = JSON.parse(line);
      Promise.resolve(handleRequest(root, request)).catch((error) => errorReply(request.id ?? null, -32000, error.message));
    } catch (error) {
      errorReply(null, -32700, `Invalid JSON: ${error.message}`);
    }
  });
  return new Promise((resolve) => input.on("close", resolve));
}

module.exports = {
  handleRequest,
  startMcpServer
};
