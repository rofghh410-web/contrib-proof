const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { isGitRepository, runGit } = require("./git");

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function readDigest(file) {
  try {
    return sha256(fs.readFileSync(file));
  } catch {
    return null;
  }
}

function buildExecutionContext(root, configInfo, options = {}) {
  const resolvedRoot = path.resolve(root);
  const exactGit = isGitRepository(resolvedRoot);
  const commit = exactGit ? runGit(resolvedRoot, ["rev-parse", "HEAD"]) : null;
  const branch = exactGit ? runGit(resolvedRoot, ["symbolic-ref", "--short", "-q", "HEAD"]) : null;
  const status = exactGit ? runGit(resolvedRoot, ["status", "--porcelain", "--untracked-files=all"]) : null;
  const shallow = exactGit ? runGit(resolvedRoot, ["rev-parse", "--is-shallow-repository"]) : null;
  const configPath = configInfo?.path ? path.resolve(configInfo.path) : null;
  return {
    schemaVersion: 1,
    runtime: {
      node: process.versions.node,
      platform: process.platform,
      arch: process.arch,
      cwd: resolvedRoot
    },
    git: {
      exactRoot: exactGit,
      root: exactGit ? path.resolve((runGit(resolvedRoot, ["rev-parse", "--show-toplevel"]).stdout || "").trim()) : null,
      commit: commit?.ok ? commit.stdout.trim() : null,
      branch: branch?.ok ? branch.stdout.trim() || null : null,
      dirty: status?.ok ? Boolean(status.stdout.trim()) : null,
      shallow: shallow?.ok ? shallow.stdout.trim() === "true" : null
    },
    configuration: {
      path: configPath ? path.relative(resolvedRoot, configPath).split(path.sep).join("/") : null,
      sha256: configPath ? readDigest(configPath) : null,
      usedDefaults: Boolean(configInfo?.usedDefaults),
      errors: configInfo?.errors || []
    },
    options: {
      includeDiff: Boolean(options.includeDiff),
      execute: Boolean(options.execute),
      base: options.base || null,
      applyExceptions: Boolean(options.applyExceptions),
      exceptionsPath: options.exceptionsPath || null
    }
  };
}

module.exports = { buildExecutionContext, sha256 };
