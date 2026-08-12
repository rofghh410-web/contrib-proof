const path = require("node:path");
const { getChangedFiles, getDiffPatch } = require("./git");

const SOURCE_EXTENSIONS = new Set([
  ".c", ".cc", ".cpp", ".cxx", ".cs", ".dart", ".ex", ".exs", ".go",
  ".h", ".hpp", ".java", ".js", ".jsx", ".kt", ".m", ".php", ".py",
  ".rb", ".rs", ".swift", ".ts", ".tsx", ".vue", ".zig"
]);

const TEST_PATTERN = /(^|\/)(test|tests|__tests__|spec|specs)(\/|$)|(?:\.test|\.spec)\.[^.]+$/i;
const DOC_PATTERN = /(^|\/)(docs?|documentation)(\/|$)|\.(md|mdx|rst|adoc|txt)$/i;
const CHANGELOG_PATTERN = /(^|\/)(change(log|s)|history)(\.|\/|$)/i;
const SECURITY_PATH_PATTERN = /(^|\/)(auth|security|crypto|cryptography|permissions?|iam|oauth|session|token|secrets?|passwords?|billing|payments?|migrations?)(\/|\.|$)|\.github\/workflows\//i;
const CONFIG_PATH_PATTERN = /(^|\/)(package\.json|pyproject\.toml|Cargo\.toml|go\.mod|Gemfile|composer\.json|action\.ya?ml|Dockerfile|Makefile|\.github\/)/i;
const SECRET_PATTERNS = [
  { id: "credential-assignment", pattern: /\b(api[_-]?key|secret|token|password|passwd|private[_-]?key)\b\s*[:=]\s*["'`]([^"'`\n]{8,})["'`]/i },
  { id: "openai-key", pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  { id: "github-token", pattern: /\b(?:ghp|gho|ghs|ghu|github_pat)_[A-Za-z0-9_]{20,}\b/ },
  { id: "aws-access-key", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { id: "private-key-header", pattern: /-----BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----/ }
];

function normalizeDiffPath(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed || trimmed === "/dev/null") return null;
  const unquoted = trimmed.startsWith('"') && trimmed.endsWith('"') ? trimmed.slice(1, -1) : trimmed;
  if (unquoted.startsWith("a/") || unquoted.startsWith("b/")) return unquoted.slice(2);
  return unquoted;
}

function parseHunkHeader(line) {
  const match = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
  if (!match) return null;
  return {
    header: line,
    oldStart: Number(match[1]),
    oldCount: Number(match[2] || 1),
    newStart: Number(match[3]),
    newCount: Number(match[4] || 1),
    additions: [],
    deletions: []
  };
}

function parseDiffPatch(patch, changedFiles = [], { maxAddedLines = 5000 } = {}) {
  const byPath = new Map(changedFiles.map((file) => [file.path, file]));
  const files = [];
  let current = null;
  let hunk = null;
  let newLine = 0;
  let addedLines = 0;

  function finishFile() {
    if (!current) return;
    current.path = current.newPath || current.oldPath || current.path;
    current.status = byPath.get(current.path)?.status || current.status || "M";
    current.additions = current.hunks.reduce((sum, item) => sum + item.additions.length, 0);
    current.deletions = current.hunks.reduce((sum, item) => sum + item.deletions.length, 0);
    current.binary = Boolean(current.binary);
    delete current.oldPath;
    delete current.newPath;
    files.push(current);
    current = null;
    hunk = null;
  }

  for (const line of String(patch || "").split(/\r?\n/)) {
    if (line.startsWith("diff --git ")) {
      finishFile();
      current = { path: null, status: "M", hunks: [], binary: false };
      continue;
    }
    if (!current) continue;
    if (line.startsWith("--- ")) {
      current.oldPath = normalizeDiffPath(line.slice(4));
      continue;
    }
    if (line.startsWith("+++ ")) {
      current.newPath = normalizeDiffPath(line.slice(4));
      continue;
    }
    if (/^Binary files /.test(line)) {
      current.binary = true;
      continue;
    }
    const parsedHunk = parseHunkHeader(line);
    if (parsedHunk) {
      hunk = parsedHunk;
      current.hunks.push(hunk);
      newLine = hunk.newStart;
      continue;
    }
    if (!hunk || line.startsWith("\\ No newline")) continue;
    if (line.startsWith("+") && !line.startsWith("+++")) {
      if (addedLines < maxAddedLines) hunk.additions.push({ line: newLine, text: line.slice(1) });
      addedLines += 1;
      newLine += 1;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      hunk.deletions.push({ line: Math.max(1, newLine), text: line.slice(1) });
    } else {
      newLine += 1;
    }
  }
  finishFile();
  return {
    schemaVersion: 1,
    files,
    additions: files.reduce((sum, file) => sum + file.additions, 0),
    deletions: files.reduce((sum, file) => sum + file.deletions, 0),
    addedLinesTruncated: addedLines > maxAddedLines
  };
}

function isSourcePath(file) {
  return SOURCE_EXTENSIONS.has(path.extname(file).toLowerCase()) && !TEST_PATTERN.test(file);
}

function isTestPath(file) {
  return TEST_PATTERN.test(file);
}

function isDocumentationPath(file) {
  return DOC_PATTERN.test(file);
}

function isChangelogPath(file) {
  return CHANGELOG_PATTERN.test(file);
}

function pathRiskFactors(file) {
  const factors = [];
  if (SECURITY_PATH_PATTERN.test(file)) factors.push({ id: "security-sensitive-path", weight: 30, level: "high", detail: "Path matches an authentication, authorization, secret, migration, billing, or workflow-sensitive area." });
  if (CONFIG_PATH_PATTERN.test(file)) factors.push({ id: "runtime-or-build-config", weight: 15, level: "medium", detail: "Path can change runtime, packaging, build, or CI behavior." });
  if (/\.(lock|sum|resolved)$|(?:^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|poetry\.lock)$/i.test(file)) factors.push({ id: "dependency-lockfile", weight: 12, level: "medium", detail: "Dependency resolution changed and should be reviewed with the manifest." });
  return factors;
}

function redactSecretMatch(match) {
  const value = match[2] || match[0];
  return `[redacted ${String(value).length} characters]`;
}

function scanAddedLines(files) {
  const findings = [];
  for (const file of files) {
    for (const hunk of file.hunks) {
      for (const addition of hunk.additions) {
        if (/^(<{7}|={7}|>{7})/.test(addition.text)) {
          findings.push({ path: file.path, line: addition.line, id: "conflict-marker", detail: "A merge-conflict marker appears in an added line." });
        }
        for (const detector of SECRET_PATTERNS) {
          const match = addition.text.match(detector.pattern);
          if (match) {
            findings.push({ path: file.path, line: addition.line, id: detector.id, detail: `${detector.id} detected; value ${redactSecretMatch(match)}.` });
            break;
          }
        }
      }
    }
  }
  return findings;
}

function levelForScore(score) {
  if (score >= 55) return "high";
  if (score >= 25) return "elevated";
  return "routine";
}

function makeFinding({ id, level, category, title, message, remediation, evidence = [] }) {
  return { id, level, category, title, message, remediation, evidence };
}

function buildReviewPacket({ root, base = null, changedFiles = null, patch = null, inventory = null, impact = null } = {}) {
  const diff = changedFiles && patch !== null
    ? { ok: true, base, files: changedFiles, patch }
    : (() => {
      const files = getChangedFiles(root, base);
      const patchResult = getDiffPatch(root, base);
      return { ok: files.ok && patchResult.ok, base: patchResult.base || files.base || base, files: files.files, patch: patchResult.patch, error: files.error || patchResult.error };
    })();
  if (!diff.ok) {
    return {
      schemaVersion: 1,
      kind: "change-review",
      available: false,
      base: diff.base || base,
      reason: diff.error || "Git diff was unavailable.",
      changedFiles: [],
      diff: { additions: 0, deletions: 0, files: 0 },
      risk: { score: 0, level: "unavailable", factors: [] },
      findings: [],
      testPlan: { changedSourceFiles: [], changedTestFiles: [], candidates: [], missingSignals: [] },
      recommendations: []
    };
  }

  const parsed = parseDiffPatch(diff.patch, diff.files);
  const paths = parsed.files.map((file) => file.path).filter(Boolean);
  const sourceFiles = paths.filter(isSourcePath);
  const testFiles = paths.filter(isTestPath);
  const docsFiles = paths.filter(isDocumentationPath);
  const changelogFiles = paths.filter(isChangelogPath);
  const factors = [];
  const findings = [];

  for (const file of parsed.files) {
    for (const factor of pathRiskFactors(file.path)) {
      factors.push({ ...factor, file: file.path });
    }
  }
  const lineFindings = scanAddedLines(parsed.files);
  for (const item of lineFindings) {
    const highImpact = item.id === "conflict-marker" || item.id === "private-key-header" || item.id === "openai-key" || item.id === "github-token" || item.id === "aws-access-key";
    factors.push({ id: item.id, weight: highImpact ? 60 : 45, level: "high", file: item.path, detail: item.detail });
  }
  if (parsed.additions + parsed.deletions > 500) factors.push({ id: "large-change", weight: 15, level: "medium", detail: "The diff is large enough to benefit from staged review." });
  if (sourceFiles.length && !testFiles.length) factors.push({ id: "source-without-tests", weight: 15, level: "medium", detail: "Source files changed without a changed test path." });

  const uniqueFactors = [...new Map(factors.map((factor) => [`${factor.id}:${factor.file || ""}`, factor])).values()];
  const score = Math.min(100, uniqueFactors.reduce((sum, factor) => sum + factor.weight, 0));
  const level = levelForScore(score);

  for (const item of lineFindings) {
    const isConflict = item.id === "conflict-marker";
    findings.push(makeFinding({
      id: `review:${item.id}:${item.path}:${item.line}`,
      level: "high",
      category: "integrity",
      title: isConflict ? "Added merge-conflict marker" : "Credential-like value added",
      message: item.detail,
      remediation: isConflict ? "Resolve the conflict before review." : "Remove the value, rotate it if it was real, and check repository history before publishing.",
      evidence: [{ path: item.path, line: item.line, detail: item.detail }]
    }));
  }
  for (const file of parsed.files) {
    const fileFactors = uniqueFactors.filter((factor) => factor.file === file.path && (factor.id === "security-sensitive-path" || factor.id === "runtime-or-build-config"));
    if (fileFactors.length) findings.push(makeFinding({
      id: `review:risk-path:${file.path}`,
      level: fileFactors.some((factor) => factor.level === "high") ? "high" : "medium",
      category: "review-risk",
      title: "Sensitive or behavior-changing path was modified",
      message: fileFactors.map((factor) => factor.detail).join(" "),
      remediation: "Ask for focused review from the maintainer responsible for this subsystem and verify the relevant test path.",
      evidence: [{ path: file.path }]
    }));
  }
  if (sourceFiles.length && !testFiles.length) findings.push(makeFinding({
    id: "review:tests-missing",
    level: "medium",
    category: "test-evidence",
    title: "Source changed without a changed test path",
    message: `${sourceFiles.length} source file(s) changed, but no test path changed in this diff.`,
    remediation: "Add or reference focused tests, or record why existing coverage is sufficient.",
    evidence: sourceFiles.map((file) => ({ path: file }))
  }));
  if (parsed.files.some((file) => file.path.startsWith(".github/workflows/"))) findings.push(makeFinding({
    id: "review:workflow-change",
    level: "medium",
    category: "security-maintenance",
    title: "A GitHub workflow changed",
    message: "Workflow changes can alter token permissions, trigger conditions, or the code executed for untrusted pull requests.",
    remediation: "Review permissions, event triggers, action references, and whether fork code can reach write-capable jobs.",
    evidence: parsed.files.filter((file) => file.path.startsWith(".github/workflows/")).map((file) => ({ path: file.path }))
  }));
  if (parsed.files.some((file) => /(?:package\.json|pyproject\.toml|Cargo\.toml|go\.mod|Gemfile|composer\.json)$/.test(file.path))) findings.push(makeFinding({
    id: "review:dependency-manifest",
    level: "medium",
    category: "supply-chain",
    title: "A dependency manifest changed",
    message: "Dependency changes can affect runtime behavior, build scripts, and reproducibility.",
    remediation: "Review the lockfile and install scripts together with the manifest; run the project's dependency checks.",
    evidence: parsed.files.filter((file) => /(?:package\.json|pyproject\.toml|Cargo\.toml|go\.mod|Gemfile|composer\.json)$/.test(file.path)).map((file) => ({ path: file.path }))
  }));

  const testCandidates = impact?.testCandidates || [];
  const missingSignals = sourceFiles.length && !testFiles.length ? sourceFiles : [];
  const recommendations = [];
  if (testCandidates.length) recommendations.push(`Run or inspect ${testCandidates.map((item) => item.file).slice(0, 8).join(", ")} before merging.`);
  if (missingSignals.length) recommendations.push("Require focused test evidence for the changed source paths, or document the exception in the review.");
  if (uniqueFactors.some((factor) => factor.id === "security-sensitive-path")) recommendations.push("Assign a reviewer familiar with the affected security-sensitive subsystem.");
  if (lineFindings.length) recommendations.push("Treat the added-line signal as a release blocker until the content has been reviewed and any exposed credential has been rotated.");
  if (!recommendations.length) recommendations.push("Review the changed files and retain this packet with the merge decision.");

  return {
    schemaVersion: 1,
    kind: "change-review",
    available: true,
    base: diff.base,
    changedFiles: parsed.files.map((file) => ({
      path: file.path,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      binary: file.binary,
      riskFactors: uniqueFactors.filter((factor) => factor.file === file.path).map(({ id, weight, level, detail }) => ({ id, weight, level, detail }))
    })),
    diff: {
      files: parsed.files.length,
      additions: parsed.additions,
      deletions: parsed.deletions,
      addedLinesTruncated: parsed.addedLinesTruncated
    },
    risk: { score, level, factors: uniqueFactors },
    findings,
    testPlan: {
      changedSourceFiles: sourceFiles,
      changedTestFiles: testFiles,
      changedDocumentationFiles: docsFiles,
      changedChangelogFiles: changelogFiles,
      candidates: testCandidates,
      missingSignals
    },
    impact: impact ? {
      impactedFiles: impact.impactedFiles,
      importEdgesConsidered: impact.importEdgesConsidered,
      symbolNodes: impact.symbolNodes
    } : null,
    recommendations
  };
}

function formatReviewMarkdown(review) {
  if (!review || !review.available) return `# ContribProof change review\n\nReview unavailable: ${review?.reason || "no Git diff"}.\n`;
  const lines = [
    "# ContribProof change review",
    "",
    `- Risk level: **${review.risk.level}** (${review.risk.score}/100 heuristic score)`,
    `- Changed files: **${review.diff.files}**`,
    `- Additions / deletions: **${review.diff.additions} / ${review.diff.deletions}**`,
    `- Base: \`${review.base || "working tree"}\``,
    "",
    "## Review findings",
    ""
  ];
  if (!review.findings.length) lines.push("No focused review findings were produced.", "");
  for (const finding of review.findings) {
    lines.push(`### ${finding.level === "high" ? "❗" : "⚠️"} ${finding.title}`, "", `**${finding.category}** · \`${finding.id}\``, "", finding.message, "", `**Next step:** ${finding.remediation}`);
    if (finding.evidence.length) {
      lines.push("", "Evidence:");
      for (const evidence of finding.evidence) lines.push(`- \`${evidence.path}${evidence.line ? `:${evidence.line}` : ""}\`${evidence.detail ? ` — ${evidence.detail}` : ""}`);
    }
    lines.push("");
  }
  lines.push("## Test plan", "", `Changed source files: **${review.testPlan.changedSourceFiles.length}**`, `Changed test files: **${review.testPlan.changedTestFiles.length}**`, `Test candidates: **${review.testPlan.candidates.length}**`, "");
  for (const recommendation of review.recommendations) lines.push(`- ${recommendation}`);
  lines.push("");
  return `${lines.join("\n").trim()}\n`;
}

module.exports = {
  buildReviewPacket,
  formatReviewMarkdown,
  isChangelogPath,
  isDocumentationPath,
  isSourcePath,
  isTestPath,
  normalizeDiffPath,
  parseDiffPatch,
  pathRiskFactors,
  scanAddedLines
};
