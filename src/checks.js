const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { getChangedFiles } = require("./git");
const { buildSafeEnvironment } = require("./runner");
const { runPolicyChecks } = require("./policies");
const { makeCheck } = require("./check");

const SOURCE_EXTENSIONS = new Set([
  ".c", ".cc", ".cpp", ".cxx", ".cs", ".dart", ".ex", ".exs", ".go",
  ".h", ".hpp", ".java", ".js", ".jsx", ".kt", ".m", ".php", ".py",
  ".rb", ".rs", ".swift", ".ts", ".tsx", ".vue", ".zig"
]);

function relativePath(root, target) {
  return path.relative(root, target).split(path.sep).join("/") || ".";
}

function existsAt(root, relative) {
  try {
    return fs.existsSync(path.resolve(root, relative));
  } catch {
    return false;
  }
}

function checkRequiredFiles(root, requiredFiles) {
  return requiredFiles.map((relative) => {
    const exists = existsAt(root, relative);
    return makeCheck({
      id: `required-file:${relative}`,
      category: "repository-basics",
      status: exists ? "pass" : "fail",
      severity: exists ? "info" : "error",
      title: exists ? `Found ${relative}` : `Missing ${relative}`,
      message: exists
        ? "The configured contributor-facing file is present."
        : "A configured contributor-facing file is missing.",
      remediation: exists ? null : `Add ${relative} or remove it from requiredFiles.`,
      evidence: [{ path: relative }]
    });
  });
}

function collectMarkdownFiles(root) {
  const candidates = ["README.md", "CONTRIBUTING.md", "CODE_OF_CONDUCT.md", "SECURITY.md", "CHANGELOG.md"];
  const files = [];
  for (const candidate of candidates) {
    if (existsAt(root, candidate)) files.push(candidate);
  }
  const docsRoot = path.join(root, "docs");
  if (fs.existsSync(docsRoot)) {
    walk(docsRoot, (absolute) => {
      if (path.extname(absolute).toLowerCase() === ".md") files.push(relativePath(root, absolute));
    });
  }
  return [...new Set(files)];
}

function walk(directory, callback) {
  let entries;
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(absolute, callback);
    else if (entry.isFile()) callback(absolute);
  }
}

function lineNumberAt(text, index) {
  return text.slice(0, index).split(/\r?\n/).length;
}

function parseMarkdownTargets(text) {
  const targets = [];
  const pattern = /!?\[[^\]]*\]\(([^)]+)\)/g;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    let target = match[1].trim();
    if (target.startsWith("<") && target.includes(">")) target = target.slice(1, target.indexOf(">"));
    target = target.split(/\s+/)[0];
    targets.push({ target, line: lineNumberAt(text, match.index) });
  }
  return targets;
}

function isExternalTarget(target) {
  return /^(?:https?:|mailto:|tel:|data:|ftp:)/i.test(target) || target.startsWith("#");
}

function checkLocalLinks(root, markdownFiles) {
  const checks = [];
  for (const relative of markdownFiles) {
    const absolute = path.resolve(root, relative);
    let text;
    try {
      text = fs.readFileSync(absolute, "utf8");
    } catch (error) {
      checks.push(makeCheck({
        id: `links:read:${relative}`,
        category: "documentation",
        status: "fail",
        severity: "error",
        title: `Could not read ${relative}`,
        message: error.message,
        remediation: "Make the documentation file readable before checking links.",
        evidence: [{ path: relative }]
      }));
      continue;
    }
    for (const { target, line } of parseMarkdownTargets(text)) {
      if (!target || isExternalTarget(target)) continue;
      const cleanTarget = decodeURIComponent(target.split("#")[0]);
      if (!cleanTarget) continue;
      const resolved = path.resolve(path.dirname(absolute), cleanTarget);
      const insideRoot = resolved === path.resolve(root) || resolved.startsWith(`${path.resolve(root)}${path.sep}`);
      const exists = insideRoot && fs.existsSync(resolved);
      if (!exists) {
        checks.push(makeCheck({
          id: `broken-link:${relative}:${line}:${target}`,
          category: "documentation",
          status: "fail",
          severity: "error",
          title: `Broken local link in ${relative}`,
          message: `The link target ${target} does not resolve from line ${line}.`,
          remediation: "Fix the link or remove it if the referenced material no longer exists.",
          evidence: [{ path: relative, line, detail: target }]
        }));
      }
    }
  }
  if (checks.length === 0) {
    checks.push(makeCheck({
      id: "links:local",
      category: "documentation",
      status: "pass",
      title: "Local documentation links resolve",
      message: `Checked ${markdownFiles.length} Markdown file(s); external links were not fetched.`,
      remediation: null,
      evidence: markdownFiles.map((file) => ({ path: file }))
    }));
  }
  return checks;
}

function truncate(value, limit = 4000) {
  const text = String(value || "");
  return text.length > limit ? `${text.slice(0, limit)}\n…[truncated]` : text;
}

function runConfiguredCommand(root, command) {
  const args = Array.isArray(command.args) ? command.args : [];
  const timeoutMs = command.timeoutMs || 120000;
  const started = Date.now();
  const result = spawnSync(command.run, args, {
    cwd: root,
    encoding: "utf8",
    shell: false,
    timeout: timeoutMs,
    maxBuffer: 1024 * 1024,
    env: buildSafeEnvironment()
  });
  const elapsedMs = Date.now() - started;
  if (result.error) {
    return {
      ok: false,
      timedOut: result.error.code === "ETIMEDOUT",
      exitCode: result.status,
      signal: result.signal,
      elapsedMs,
      stdout: truncate(result.stdout),
      stderr: truncate(result.stderr || result.error.message)
    };
  }
  return {
    ok: result.status === 0,
    timedOut: false,
    exitCode: result.status,
    signal: result.signal,
    elapsedMs,
    stdout: truncate(result.stdout),
    stderr: truncate(result.stderr)
  };
}

function checkCommands(root, commands, execute) {
  if (!commands.length) {
    return [makeCheck({
      id: "commands:configured",
      category: "validation",
      status: "skip",
      severity: "info",
      title: "No validation commands configured",
      message: "Add commands to .contrib-proof.json to make the contributor path executable and repeatable.",
      remediation: "Configure at least one safe command, then run verify with --execute.",
      evidence: [{ path: ".contrib-proof.json" }]
    })];
  }

  if (!execute) {
    return commands.map((command) => makeCheck({
      id: `command:${command.id}`,
      category: "validation",
      status: "skip",
      severity: "info",
      title: `Skipped ${command.name || command.id}`,
      message: `Would run ${[command.run, ...(command.args || [])].join(" ")}. Commands are opt-in at runtime.`,
      remediation: "Run with --execute in a trusted checkout to execute configured commands.",
      evidence: [{ path: ".contrib-proof.json", detail: command.id }]
    }));
  }

  return commands.map((command) => {
    const result = runConfiguredCommand(root, command);
    const required = command.required !== false;
    const passed = result.ok;
    return makeCheck({
      id: `command:${command.id}`,
      category: "validation",
      status: passed ? "pass" : (required ? "fail" : "warn"),
      severity: passed ? "info" : (required ? "error" : "warning"),
      title: passed ? `Passed ${command.name || command.id}` : `Failed ${command.name || command.id}`,
      message: passed
        ? `Completed in ${result.elapsedMs}ms.`
        : `${result.timedOut ? "Timed out" : `Exited with code ${result.exitCode}`}.`,
      remediation: passed ? null : "Run the command locally, fix the failure, and repeat the proof.",
      evidence: [{
        path: ".contrib-proof.json",
        detail: `${command.run} ${(command.args || []).join(" ")}`,
        output: result.stderr || result.stdout
      }]
    });
  });
}

function isTestPath(file) {
  return /(^|\/)(test|tests|__tests__|spec|specs)(\/|$)/i.test(file) || /(?:\.test|\.spec)\.[^.]+$/i.test(file);
}

function isDocumentationPath(file) {
  return /(^|\/)(docs?|documentation)(\/|$)/i.test(file) || /\.(md|mdx|rst|adoc|txt)$/i.test(file);
}

function isChangelogPath(file) {
  return /(^|\/)(change(log|s)|history)(\.|\/|$)/i.test(file);
}

function isSourcePath(file) {
  return SOURCE_EXTENSIONS.has(path.extname(file).toLowerCase()) && !isTestPath(file);
}

function checkChangePolicy(root, config, base) {
  const diff = getChangedFiles(root, base);
  if (!diff.ok) {
    return [makeCheck({
      id: "changes:available",
      category: "change-policy",
      status: "skip",
      severity: "info",
      title: "Change policy was not evaluated",
      message: diff.error,
      remediation: "Run this check from a Git work tree with a comparable base commit.",
      evidence: []
    })];
  }
  if (!diff.files.length) {
    return [makeCheck({
      id: "changes:available",
      category: "change-policy",
      status: "pass",
      severity: "info",
      title: "No changed files found",
      message: diff.base ? `Compared against ${diff.base}.` : "The working tree diff is empty.",
      remediation: null,
      evidence: []
    })];
  }

  const changed = diff.files.map((item) => item.path);
  const source = changed.filter(isSourcePath);
  const tests = changed.filter(isTestPath);
  const docs = changed.filter(isDocumentationPath);
  const changelog = changed.filter(isChangelogPath);
  const checks = [];

  if (source.length && config.changePolicy.requireTestsForCode && !tests.length) {
    checks.push(makeCheck({
      id: "changes:tests",
      category: "change-policy",
      status: "warn",
      severity: "warning",
      title: "Source changed without a test-file change",
      message: `${source.length} source file(s) changed, but no test path changed in this diff. This is a signal for maintainer review, not an automatic proof that coverage is missing.`,
      remediation: "Add or link the relevant test evidence, or explain why existing tests are sufficient.",
      evidence: source.map((file) => ({ path: file }))
    }));
  } else if (source.length && config.changePolicy.requireTestsForCode) {
    checks.push(makeCheck({
      id: "changes:tests",
      category: "change-policy",
      status: "pass",
      title: "Source change has a test-file signal",
      message: `${source.length} source file(s) and ${tests.length} test file(s) changed.`,
      remediation: null,
      evidence: [...source, ...tests].map((file) => ({ path: file }))
    }));
  }

  if (source.length && config.changePolicy.requireDocsForUserFacingCode && !docs.length) {
    checks.push(makeCheck({
      id: "changes:docs",
      category: "change-policy",
      status: "warn",
      severity: "warning",
      title: "Source changed without a documentation signal",
      message: "The configured policy asks maintainers to look for user-facing documentation evidence.",
      remediation: "Update the relevant documentation or explain why the behavior is internal.",
      evidence: source.map((file) => ({ path: file }))
    }));
  }

  if (source.length && config.changePolicy.requireChangelogForCode && !changelog.length) {
    checks.push(makeCheck({
      id: "changes:changelog",
      category: "change-policy",
      status: "warn",
      severity: "warning",
      title: "Source changed without a changelog signal",
      message: "The configured policy asks maintainers to record user-visible changes.",
      remediation: "Add a changelog entry or explain why this change is not release-facing.",
      evidence: source.map((file) => ({ path: file }))
    }));
  }

  if (!checks.length) {
    checks.push(makeCheck({
      id: "changes:policy",
      category: "change-policy",
      status: "pass",
      title: "Change policy has no findings",
      message: `Analyzed ${changed.length} changed file(s).`,
      remediation: null,
      evidence: changed.map((file) => ({ path: file }))
    }));
  }
  return checks;
}

function buildChecks(root, configInfo, { execute = false, includeDiff = false, base = null, inventory = null } = {}) {
  const checks = [];
  if (configInfo.usedDefaults) {
    checks.push(makeCheck({
      id: "config:defaults",
      category: "configuration",
      status: "warn",
      severity: "warning",
      title: "Using default configuration",
      message: "No .contrib-proof.json was found, so only README.md and LICENSE are required by default.",
      remediation: "Run contrib-proof init and tailor the configuration to this repository.",
      evidence: []
    }));
  } else {
    checks.push(makeCheck({
      id: "config:found",
      category: "configuration",
      status: configInfo.errors.length ? "fail" : "pass",
      severity: configInfo.errors.length ? "error" : "info",
      title: configInfo.errors.length ? "Configuration is invalid" : "Configuration is valid",
      message: configInfo.errors.length ? configInfo.errors.join("; ") : "Loaded .contrib-proof.json successfully.",
      remediation: configInfo.errors.length ? "Fix the listed configuration errors and run the proof again." : null,
      evidence: [{ path: ".contrib-proof.json" }]
    }));
  }
  checks.push(...checkRequiredFiles(root, configInfo.config.requiredFiles));

  if (inventory) checks.push(...runPolicyChecks(root, configInfo.config, inventory));

  const markdownFiles = collectMarkdownFiles(root);
  if (configInfo.config.links.enabled) {
    checks.push(...checkLocalLinks(root, markdownFiles));
  } else {
    checks.push(makeCheck({
      id: "links:local",
      category: "documentation",
      status: "skip",
      severity: "info",
      title: "Local link checking disabled",
      message: "The repository configuration disabled Markdown link checks.",
      remediation: "Enable links.enabled unless the repository has a documented reason not to.",
      evidence: [{ path: ".contrib-proof.json" }]
    }));
  }

  checks.push(...checkCommands(root, configInfo.config.commands, execute));
  if (includeDiff) checks.push(...checkChangePolicy(root, configInfo.config, base));
  return checks;
}

module.exports = {
  buildChecks,
  checkChangePolicy,
  checkCommands,
  checkLocalLinks,
  checkRequiredFiles,
  isChangelogPath,
  isDocumentationPath,
  isSourcePath,
  isTestPath,
  makeCheck,
  parseMarkdownTargets
};
