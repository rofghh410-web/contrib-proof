const fs = require("node:fs");
const readline = require("node:readline");
const { buildChecks } = require("./checks");
const { loadConfig } = require("./config");
const { getChangedFiles, getDiffPatch } = require("./git");
const { analyzeImpact, buildGraph } = require("./graph");
const { buildInventory } = require("./inventory");
const { buildRemediationPlan } = require("./plan");
const { createReport } = require("./report");
const { evaluateGate } = require("./gate");
const { buildReviewPacket } = require("./review");

function reply(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}

function errorReply(id, code, message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } })}\n`);
}

function verify(root, includeDiff = false, base = null, includeGate = false) {
  const configInfo = loadConfig(root);
  const inventory = buildInventory(root);
  const checks = buildChecks(root, configInfo, { includeDiff, base, execute: false, inventory });
  let impact = null;
  let review = null;
  if (includeDiff) {
    const diff = getChangedFiles(root, base);
    const patch = getDiffPatch(root, base);
    if (diff.ok) impact = analyzeImpact(root, diff.files.map((file) => file.path), buildGraph(root, inventory));
    review = buildReviewPacket({
      root,
      base,
      changedFiles: diff.ok && patch.ok ? diff.files : null,
      patch: diff.ok && patch.ok ? patch.patch : null,
      inventory,
      impact
    });
  }
  const report = createReport({ root, checks, configPath: configInfo.path, mode: includeGate ? "gate" : (includeDiff ? "verify+diff" : "verify"), inventory, impact, review });
  report.plan = buildRemediationPlan(report);
  if (includeGate) report.gate = evaluateGate(report, configInfo.config.gatePolicy);
  return report;
}

async function handleRequest(root, request) {
  const id = request.id ?? null;
  if (request.method === "initialize") {
    reply(id, {
      protocolVersion: request.params?.protocolVersion || "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "contrib-proof", version: "0.5.0" }
    });
    return;
  }
  if (request.method === "notifications/initialized") return;
  if (request.method === "tools/list") {
    reply(id, {
      tools: [
        { name: "repo_verify", description: "Run read-only contributor-path checks for the configured repository.", inputSchema: { type: "object", properties: {} } },
        { name: "repo_inventory", description: "Return a read-only inventory of files, languages, manifests, workflows, and package scripts.", inputSchema: { type: "object", properties: {} } },
        { name: "repo_diff", description: "Run read-only change-policy checks against a Git base ref.", inputSchema: { type: "object", properties: { base: { type: "string" } } } },
        { name: "repo_plan", description: "Return a read-only prioritized remediation plan derived from repository checks.", inputSchema: { type: "object", properties: {} } },
        { name: "repo_review", description: "Return a read-only change-risk and test-evidence packet for a Git diff.", inputSchema: { type: "object", properties: { base: { type: "string" } } } },
        { name: "repo_gate", description: "Return a read-only deterministic merge-gate decision for a Git diff.", inputSchema: { type: "object", properties: { base: { type: "string" } } } }
      ]
    });
    return;
  }
  if (request.method !== "tools/call") {
    errorReply(id, -32601, `Unsupported method: ${request.method}`);
    return;
  }
  const name = request.params?.name;
  if (name === "repo_verify") {
    const report = verify(root);
    reply(id, { content: [{ type: "text", text: JSON.stringify(report, null, 2) }], structuredContent: report });
    return;
  }
  if (name === "repo_inventory") {
    const inventory = buildInventory(root);
    reply(id, { content: [{ type: "text", text: JSON.stringify(inventory, null, 2) }], structuredContent: inventory });
    return;
  }
  if (name === "repo_diff") {
    const base = request.params?.arguments?.base || null;
    const report = verify(root, true, typeof base === "string" ? base : null);
    reply(id, { content: [{ type: "text", text: JSON.stringify(report, null, 2) }], structuredContent: report });
    return;
  }
  if (name === "repo_plan") {
    const report = verify(root);
    const plan = report.plan || buildRemediationPlan(report);
    reply(id, { content: [{ type: "text", text: JSON.stringify(plan, null, 2) }], structuredContent: plan });
    return;
  }
  if (name === "repo_review") {
    const base = request.params?.arguments?.base || null;
    const report = verify(root, true, typeof base === "string" ? base : null);
    reply(id, { content: [{ type: "text", text: JSON.stringify(report.review, null, 2) }], structuredContent: report.review });
    return;
  }
  if (name === "repo_gate") {
    const base = request.params?.arguments?.base || null;
    const report = verify(root, true, typeof base === "string" ? base : null, true);
    reply(id, { content: [{ type: "text", text: JSON.stringify(report.gate, null, 2) }], structuredContent: report.gate });
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
