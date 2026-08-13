const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_HISTORY_PATH = ".contrib-proof-history.jsonl";

function resolveHistoryPath(root, relative = DEFAULT_HISTORY_PATH) {
  const rootAbsolute = path.resolve(root);
  const target = path.resolve(rootAbsolute, relative);
  if (!(target === rootAbsolute || target.startsWith(`${rootAbsolute}${path.sep}`))) {
    throw new Error("history path must remain inside the repository root");
  }
  return target;
}

function historyEntry(report, { recordedAt = new Date().toISOString() } = {}) {
  return {
    schemaVersion: 1,
    recordedAt,
    generatedAt: report?.generatedAt || null,
    tool: report?.tool || null,
    mode: report?.mode || "verify",
    status: report?.summary?.status || "unknown",
    score: Number.isInteger(report?.summary?.score) ? report.summary.score : null,
    counts: {
      pass: report?.summary?.pass || 0,
      warn: report?.summary?.warn || 0,
      fail: report?.summary?.fail || 0,
      skip: report?.summary?.skip || 0
    },
    gate: report?.gate ? {
      status: report.gate.status,
      violations: report.gate.summary?.violations || 0
    } : null,
    review: report?.review?.available ? {
      risk: report.review.risk?.level || "unknown",
      score: report.review.risk?.score || 0,
      findings: report.review.findings?.length || 0
    } : null,
    release: report?.release ? {
      version: report.release.version || null,
      status: report.release.summary?.status || "unknown",
      score: report.release.summary?.score ?? null
    } : null,
    exceptions: report?.exceptions ? {
      applied: Boolean(report.exceptions.applied),
      active: report.exceptions.active || 0,
      expired: report.exceptions.expired || 0,
      invalid: report.exceptions.invalid || 0
    } : null,
    proofBundleHash: report?.proof?.bundleHash || null
  };
}

function readHistory(root, relative = DEFAULT_HISTORY_PATH) {
  const file = resolveHistoryPath(root, relative);
  if (!fs.existsSync(file)) return { path: file, entries: [], errors: [] };
  const errors = [];
  const entries = [];
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean);
  lines.forEach((line, index) => {
    try {
      const entry = JSON.parse(line);
      if (!entry || entry.schemaVersion !== 1) throw new Error("unsupported schema version");
      entries.push(entry);
    } catch (error) {
      errors.push(`line ${index + 1}: ${error.message}`);
    }
  });
  return { path: file, entries, errors };
}

function appendHistory(root, report, relative = DEFAULT_HISTORY_PATH, { recordedAt } = {}) {
  const file = resolveHistoryPath(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const entry = historyEntry(report, { recordedAt });
  fs.appendFileSync(file, `${JSON.stringify(entry)}\n`, "utf8");
  return { path: file, entry };
}

function planHistoryRetention(entries, keepLast) {
  if (!Number.isInteger(keepLast) || keepLast < 0) throw new Error("keepLast must be a non-negative integer");
  const safeEntries = Array.isArray(entries) ? entries : [];
  const retainedEntries = keepLast === 0 ? [] : safeEntries.slice(-keepLast);
  return {
    schemaVersion: 1,
    kind: "history-retention",
    keepLast,
    total: safeEntries.length,
    kept: retainedEntries.length,
    removed: safeEntries.length - retainedEntries.length,
    applied: false,
    retainedEntries
  };
}

function applyHistoryRetention(root, relative = DEFAULT_HISTORY_PATH, keepLast) {
  const history = readHistory(root, relative);
  if (history.errors.length) throw new Error(`refusing to rewrite history with parse errors: ${history.errors.join("; ")}`);
  const plan = planHistoryRetention(history.entries, keepLast);
  const file = resolveHistoryPath(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, plan.retainedEntries.map((entry) => JSON.stringify(entry)).join("\n") + (plan.retainedEntries.length ? "\n" : ""), "utf8");
  return { ...plan, path: relative, applied: true };
}

function formatHistoryRetentionMarkdown(result) {
  const lines = [
    "# ContribProof history retention",
    "",
    `- Status: **${result.applied ? "applied" : "preview"}**`,
    `- Keep last: **${result.keepLast}**`,
    `- Existing entries: **${result.total}**`,
    `- Retained: **${result.kept}**`,
    `- Removed: **${result.removed}**`,
    ""
  ];
  if (!result.applied) lines.push("No history file was modified. Re-run with an explicit apply flag to write this retention plan.", "");
  return `${lines.join("\n").trim()}\n`;
}

function summarizeHistory(entries) {
  const safeEntries = Array.isArray(entries) ? entries : [];
  const scores = safeEntries.map((entry) => entry.score).filter((score) => Number.isInteger(score));
  const latest = safeEntries.length ? safeEntries[safeEntries.length - 1] : null;
  const previous = safeEntries.length > 1 ? safeEntries[safeEntries.length - 2] : null;
  const failures = safeEntries.filter((entry) => entry.status === "fail").length;
  const warnings = safeEntries.filter((entry) => entry.status === "needs-attention").length;
  const averageScore = scores.length ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length) : null;
  return {
    schemaVersion: 1,
    kind: "history-summary",
    runs: safeEntries.length,
    firstRecordedAt: safeEntries[0]?.recordedAt || null,
    lastRecordedAt: latest?.recordedAt || null,
    averageScore,
    latestScore: latest?.score ?? null,
    scoreDelta: latest?.score !== null && latest?.score !== undefined && previous?.score !== null && previous?.score !== undefined
      ? latest.score - previous.score
      : null,
    failureRate: safeEntries.length ? Number((failures / safeEntries.length).toFixed(3)) : 0,
    warningRate: safeEntries.length ? Number((warnings / safeEntries.length).toFixed(3)) : 0,
    latestStatus: latest?.status || "empty",
    latestGateStatus: latest?.gate?.status || null,
    entries: safeEntries
  };
}

function formatHistoryMarkdown(summary) {
  const lines = [
    "# ContribProof history",
    "",
    `- Runs recorded: **${summary.runs}**`,
    `- Average score: **${summary.averageScore ?? "n/a"}**`,
    `- Latest score: **${summary.latestScore ?? "n/a"}**`,
    `- Score delta: **${summary.scoreDelta === null ? "n/a" : (summary.scoreDelta >= 0 ? `+${summary.scoreDelta}` : summary.scoreDelta)}**`,
    `- Failure rate: **${Math.round(summary.failureRate * 100)}%**`,
    `- Warning rate: **${Math.round(summary.warningRate * 100)}%**`,
    `- Latest status: **${summary.latestStatus}**`,
    "",
    "## Recorded runs",
    ""
  ];
  if (!summary.entries.length) lines.push("No history has been recorded yet.", "");
  for (const entry of summary.entries.slice(-20).reverse()) {
    lines.push(`- ${entry.recordedAt || "unknown time"} · **${entry.status}** · score **${entry.score ?? "n/a"}** · mode \`${entry.mode}\``);
  }
  return `${lines.join("\n").trim()}\n`;
}

module.exports = {
  DEFAULT_HISTORY_PATH,
  appendHistory,
  applyHistoryRetention,
  formatHistoryMarkdown,
  formatHistoryRetentionMarkdown,
  historyEntry,
  planHistoryRetention,
  readHistory,
  resolveHistoryPath,
  summarizeHistory
};
