const fs = require("node:fs");
const path = require("node:path");
const { makeCheck } = require("./check");

const DEFAULT_EXCEPTIONS_PATH = ".contrib-proof-exceptions.json";
const EXCEPTION_STATUSES = new Set(["open", "expired", "invalid"]);

function resolveExceptionsPath(root, relative = DEFAULT_EXCEPTIONS_PATH) {
  const rootAbsolute = path.resolve(root);
  const target = path.resolve(rootAbsolute, relative);
  if (!(target === rootAbsolute || target.startsWith(`${rootAbsolute}${path.sep}`))) {
    throw new Error("exceptions path must remain inside the repository root");
  }
  return target;
}

function readExceptions(root, relative = DEFAULT_EXCEPTIONS_PATH, now = new Date()) {
  const file = resolveExceptionsPath(root, relative);
  if (!fs.existsSync(file)) return { path: file, relative, exists: false, version: 1, exceptions: [], errors: [] };
  let document;
  try {
    document = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    return { path: file, relative, exists: true, version: null, exceptions: [], errors: [`could not parse ${relative}: ${error.message}`] };
  }
  const errors = [];
  const seenIds = new Set();
  const seenChecks = new Set();
  if (!document || document.version !== 1 || !Array.isArray(document.exceptions)) {
    return { path: file, relative, exists: true, version: document?.version ?? null, exceptions: [], errors: ["exceptions file must contain version 1 and an exceptions array"] };
  }
  const exceptions = document.exceptions.map((item, index) => {
    const candidate = item && typeof item === "object" ? { ...item } : {};
    const id = typeof candidate.id === "string" && candidate.id.trim() ? candidate.id.trim() : `exception-${index + 1}`;
    const checkId = typeof candidate.checkId === "string" ? candidate.checkId.trim() : "";
    const reason = typeof candidate.reason === "string" ? candidate.reason.trim() : "";
    const owner = typeof candidate.owner === "string" ? candidate.owner.trim() : "";
    const expiresAt = typeof candidate.expiresAt === "string" ? candidate.expiresAt : null;
    const validDate = expiresAt && !Number.isNaN(Date.parse(expiresAt));
    const expired = !validDate || new Date(expiresAt).getTime() <= now.getTime();
    const duplicateId = seenIds.has(id);
    const duplicateCheck = checkId && seenChecks.has(checkId);
    const status = !checkId || !reason || !owner || !validDate || duplicateId || duplicateCheck ? "invalid" : (expired ? "expired" : "open");
    if (status === "invalid") {
      const duplicateReason = duplicateId ? "duplicate id" : (duplicateCheck ? "duplicate checkId" : "missing checkId, reason, owner, or valid expiresAt");
      errors.push(`exceptions[${index}] (${id}) has ${duplicateReason}`);
    }
    seenIds.add(id);
    if (checkId) seenChecks.add(checkId);
    return { id, checkId, reason, owner, expiresAt, status, source: relative };
  });
  return { path: file, relative, exists: true, version: document.version, exceptions, errors };
}

function activeExceptions(root, relative = DEFAULT_EXCEPTIONS_PATH, now = new Date()) {
  return readExceptions(root, relative, now).exceptions.filter((item) => item.status === "open");
}

function exceptionForCheck(checkId, exceptions) {
  return (exceptions || []).find((item) => item.checkId === checkId && item.status === "open") || null;
}

function applyExceptions(checks, exceptions) {
  return (checks || []).map((check) => {
    const exception = exceptionForCheck(check.id, exceptions);
    if (!exception || check.status === "pass" || check.status === "skip") return check;
    return {
      ...check,
      originalStatus: check.status,
      status: "skip",
      severity: "info",
      message: `${check.message} Active exception ${exception.id} is recorded until ${exception.expiresAt}.`,
      remediation: `Revisit exception ${exception.id} before ${exception.expiresAt}; owner: ${exception.owner}.`,
      exception: {
        id: exception.id,
        reason: exception.reason,
        owner: exception.owner,
        expiresAt: exception.expiresAt
      }
    };
  });
}

function summarizeExceptions(result) {
  const exceptions = result?.exceptions || [];
  return {
    path: result?.path || null,
    exists: Boolean(result?.exists),
    total: exceptions.length,
    active: exceptions.filter((item) => item.status === "open").length,
    expired: exceptions.filter((item) => item.status === "expired").length,
    invalid: exceptions.filter((item) => item.status === "invalid").length,
    errors: result?.errors || [],
    exceptions
  };
}

function buildExceptionChecks(result) {
  const evidence = result?.exists ? [{ path: result.relative || path.basename(result.path) }] : [];
  if (!result?.exists) {
    return [makeCheck({
      id: "policy:exceptions",
      category: "policy",
      status: "pass",
      title: "No exception file is configured",
      message: "No policy exceptions will suppress repository findings.",
      evidence
    })];
  }
  if (result.errors.length || result.exceptions.some((item) => item.status === "expired")) {
    const expired = result.exceptions.filter((item) => item.status === "expired").length;
    return [makeCheck({
      id: "policy:exceptions",
      category: "policy",
      status: "fail",
      severity: "error",
      title: "Policy exceptions need maintenance",
      message: `${result.errors.length} invalid exception definition(s) and ${expired} expired exception(s) were found.`,
      remediation: "Remove expired entries or renew them with a concrete owner, reason, and future expiry date.",
      evidence
    })];
  }
  return [makeCheck({
    id: "policy:exceptions",
    category: "policy",
    status: "pass",
    title: "Policy exceptions are time-bounded",
    message: `${result.exceptions.length} exception(s) are valid and have not expired.`,
    remediation: null,
    evidence
  })];
}

module.exports = {
  DEFAULT_EXCEPTIONS_PATH,
  EXCEPTION_STATUSES,
  activeExceptions,
  applyExceptions,
  buildExceptionChecks,
  exceptionForCheck,
  readExceptions,
  resolveExceptionsPath,
  summarizeExceptions
};
