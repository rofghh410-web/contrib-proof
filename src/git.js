const path = require("node:path");
const { spawnSync } = require("node:child_process");

function runGit(root, args, { maxBuffer = 1024 * 1024 } = {}) {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    shell: false,
    maxBuffer
  });
  if (result.error) {
    return { ok: false, error: result.error.message, stdout: "", stderr: "" };
  }
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || ""
  };
}

function getDiffPatch(root, base, { maxBuffer = 8 * 1024 * 1024 } = {}) {
  if (!isGitRepository(root)) {
    return { ok: false, error: "root is not a Git work tree", patch: "", base: null };
  }
  const resolvedBase = resolveDiffBase(root, base);
  const args = ["diff", "--unified=0", "--no-color", "--no-ext-diff", "--find-renames"];
  if (resolvedBase) args.push(`${resolvedBase}...HEAD`);
  args.push("--");
  const result = runGit(root, args, { maxBuffer });
  if (!result.ok) {
    return {
      ok: false,
      error: result.stderr.trim() || `git diff failed with exit code ${result.status}`,
      patch: "",
      base: resolvedBase
    };
  }
  return { ok: true, base: resolvedBase, patch: result.stdout };
}

function isGitRepository(root) {
  const result = runGit(root, ["rev-parse", "--show-toplevel"]);
  if (!result.ok) return false;
  return path.resolve(result.stdout.trim()) === path.resolve(root);
}

function resolveDiffBase(root, explicitBase) {
  if (explicitBase) return explicitBase;
  if (process.env.GITHUB_BASE_REF) {
    return `origin/${process.env.GITHUB_BASE_REF}`;
  }
  const result = runGit(root, ["rev-parse", "--verify", "HEAD~1"]);
  return result.ok ? result.stdout.trim() : null;
}

function getChangedFiles(root, base) {
  if (!isGitRepository(root)) {
    return { ok: false, error: "root is not a Git work tree", files: [] };
  }
  const resolvedBase = resolveDiffBase(root, base);
  const args = resolvedBase
    ? ["diff", "--name-status", "--find-renames", `${resolvedBase}...HEAD`]
    : ["diff", "--name-status"];
  const result = runGit(root, args);
  if (!result.ok) {
    return {
      ok: false,
      error: result.stderr.trim() || `git diff failed with exit code ${result.status}`,
      files: [],
      base: resolvedBase
    };
  }

  const files = [];
  for (const line of result.stdout.split(/\r?\n/).filter(Boolean)) {
    const fields = line.split("\t");
    const status = fields[0] || "?";
    const file = fields[fields.length - 1];
    if (file) files.push({ status, path: file });
  }
  return { ok: true, base: resolvedBase, files };
}

module.exports = {
  getDiffPatch,
  getChangedFiles,
  isGitRepository,
  resolveDiffBase,
  runGit
};
