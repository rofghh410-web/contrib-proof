const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_LEDGER_PATH = ".contrib-proof-ledger.jsonl";

function resolveLedgerPath(root, relative = DEFAULT_LEDGER_PATH) {
  const rootAbsolute = path.resolve(root);
  const target = path.resolve(rootAbsolute, relative);
  if (!(target === rootAbsolute || target.startsWith(`${rootAbsolute}${path.sep}`))) {
    throw new Error("ledger path must remain inside the repository root");
  }
  return target;
}

function digest(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}

function ledgerPayload(report, previousHash = null, { recordedAt = new Date().toISOString(), actor = "local" } = {}) {
  return {
    schemaVersion: 1,
    recordedAt,
    actor,
    previousHash,
    mode: report?.mode || "verify",
    status: report?.summary?.status || "unknown",
    score: Number.isInteger(report?.summary?.score) ? report.summary.score : null,
    counts: {
      pass: report?.summary?.pass || 0,
      warn: report?.summary?.warn || 0,
      fail: report?.summary?.fail || 0,
      skip: report?.summary?.skip || 0
    },
    gate: report?.gate ? { status: report.gate.status, violations: report.gate.summary?.violations || 0 } : null,
    release: report?.release ? { version: report.release.version || null, status: report.release.summary?.status || "unknown" } : null,
    proofBundleHash: report?.proof?.bundleHash || null
  };
}

function makeLedgerEntry(report, previousHash = null, options = {}) {
  const payload = ledgerPayload(report, previousHash, options);
  return { ...payload, entryHash: digest(JSON.stringify(canonical(payload))) };
}

function readLedger(root, relative = DEFAULT_LEDGER_PATH) {
  const file = resolveLedgerPath(root, relative);
  if (!fs.existsSync(file)) return { path: file, entries: [], errors: [], valid: true, headHash: null };
  const entries = [];
  const errors = [];
  let expectedPrevious = null;
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  for (const [index, line] of lines.entries()) {
    try {
      if (!line.trim()) throw new Error("blank lines are not permitted in the ledger");
      const entry = JSON.parse(line);
      const { entryHash, ...payload } = entry;
      const expectedHash = digest(JSON.stringify(canonical(payload)));
      if (entry.schemaVersion !== 1) throw new Error("unsupported schema version");
      if (typeof entry.recordedAt !== "string" || Number.isNaN(Date.parse(entry.recordedAt))) throw new Error("recordedAt must be a valid date");
      if (typeof entry.actor !== "string" || !entry.actor) throw new Error("actor must be a non-empty string");
      if (typeof entry.mode !== "string" || !entry.mode) throw new Error("mode must be a non-empty string");
      if (typeof entry.status !== "string" || !entry.status) throw new Error("status must be a non-empty string");
      if (!entry.counts || typeof entry.counts !== "object" || Array.isArray(entry.counts)) throw new Error("counts must be an object");
      if (entry.previousHash !== expectedPrevious) throw new Error("previousHash does not match the prior ledger entry");
      if (entryHash !== expectedHash) throw new Error("entryHash does not match the entry payload");
      entries.push(entry);
      expectedPrevious = entry.entryHash;
    } catch (error) {
      errors.push(`line ${index + 1}: ${error.message}`);
      break;
    }
  }
  return { path: file, entries, errors, valid: errors.length === 0, headHash: entries.at(-1)?.entryHash || null };
}

function appendLedger(root, report, relative = DEFAULT_LEDGER_PATH, options = {}) {
  const current = readLedger(root, relative);
  if (!current.valid) throw new Error(`cannot append to invalid ledger: ${current.errors.join("; ")}`);
  const file = resolveLedgerPath(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const entry = makeLedgerEntry(report, current.headHash, options);
  fs.appendFileSync(file, `${JSON.stringify(entry)}\n`, "utf8");
  return { path: file, entry };
}

function verifyLedger(root, relative = DEFAULT_LEDGER_PATH) {
  const result = readLedger(root, relative);
  return {
    schemaVersion: 1,
    kind: "ledger-verification",
    path: result.path,
    valid: result.valid,
    entries: result.entries.length,
    headHash: result.headHash,
    errors: result.errors
  };
}

function formatLedgerMarkdown(result) {
  const lines = [
    "# ContribProof ledger",
    "",
    `- Status: **${result.valid ? "valid" : "invalid"}**`,
    `- Entries: **${result.entries}**`,
    `- Head hash: \`${result.headHash || "empty"}\``,
    ""
  ];
  if (result.errors?.length) lines.push("## Errors", "", ...result.errors.map((error) => `- ${error}`), "");
  else lines.push("The append-only ledger chain is internally consistent.", "");
  return `${lines.join("\n").trim()}\n`;
}

module.exports = {
  DEFAULT_LEDGER_PATH,
  appendLedger,
  formatLedgerMarkdown,
  ledgerPayload,
  makeLedgerEntry,
  readLedger,
  resolveLedgerPath,
  verifyLedger
};
