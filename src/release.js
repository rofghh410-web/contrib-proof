const fs = require("node:fs");
const path = require("node:path");
const { getChangedFiles, getDiffPatch, isGitRepository, resolveDiffBase, runGit } = require("./git");
const { parseDiffPatch, isSourcePath, isTestPath, isDocumentationPath, isChangelogPath } = require("./review");

const VERSION_PATTERN = /^(?:v)?(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?$/;

function readJson(root, relative) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, relative), "utf8"));
  } catch {
    return null;
  }
}

function readText(root, relative) {
  try {
    return fs.readFileSync(path.join(root, relative), "utf8");
  } catch {
    return null;
  }
}

function makeReadinessCheck({ id, status, title, message, remediation = null, evidence = [] }) {
  return { id, status, severity: status === "fail" ? "error" : (status === "warn" ? "warning" : "info"), title, message, remediation, evidence };
}

function parseCommits(root, range) {
  const result = runGit(root, ["log", "--no-merges", "--format=%H%x09%h%x09%aI%x09%an%x09%s", range]);
  if (!result.ok) return { ok: false, error: result.stderr.trim() || "git log failed", commits: [] };
  const commits = result.stdout.split(/\r?\n/).filter(Boolean).map((line) => {
    const [sha, shortSha, date, author, ...subjectParts] = line.split("\t");
    return { sha, shortSha, date, author, subject: subjectParts.join("\t") };
  });
  return { ok: true, commits };
}

function inferVersion(root, explicitVersion) {
  if (explicitVersion) return explicitVersion.replace(/^v/, "");
  const packageJson = readJson(root, "package.json");
  if (typeof packageJson?.version === "string") return packageJson.version;
  const citation = readText(root, "CITATION.cff");
  const match = citation?.match(/^version:\s*['\"]?([^'\"\s]+)['\"]?/m);
  return match ? match[1] : null;
}

function versionStatus(version) {
  return typeof version === "string" && VERSION_PATTERN.test(version) ? "pass" : "fail";
}

function buildReleaseReadiness({ root, since = null, version = null, report = null } = {}) {
  const resolvedSince = resolveDiffBase(root, since);
  if (!isGitRepository(root)) {
    return {
      schemaVersion: 1,
      kind: "release-readiness",
      available: false,
      root: path.resolve(root),
      since: resolvedSince,
      version: version || null,
      reason: "root is not an exact Git work tree",
      commits: [],
      changes: { files: 0, additions: 0, deletions: 0 },
      summary: { status: "unavailable", score: 0, pass: 0, warn: 0, fail: 0, total: 0 },
      checks: [],
      recommendations: ["Run release readiness from the repository root with Git history available."]
    };
  }

  const range = resolvedSince ? `${resolvedSince}..HEAD` : "HEAD";
  const commitResult = parseCommits(root, range);
  const changed = getChangedFiles(root, resolvedSince);
  const patch = getDiffPatch(root, resolvedSince);
  const parsed = patch.ok ? parseDiffPatch(patch.patch, changed.files) : { files: [], additions: 0, deletions: 0 };
  const changedPaths = changed.ok ? changed.files.map((item) => item.path) : [];
  const sourceFiles = changedPaths.filter(isSourcePath);
  const testFiles = changedPaths.filter(isTestPath);
  const docsFiles = changedPaths.filter(isDocumentationPath);
  const changelogFiles = changedPaths.filter(isChangelogPath);
  const packageJson = readJson(root, "package.json");
  const citation = readText(root, "CITATION.cff");
  const changelog = readText(root, "CHANGELOG.md");
  const effectiveVersion = version || inferVersion(root, null);
  const versionEvidence = [
    packageJson ? { path: "package.json" } : null,
    citation ? { path: "CITATION.cff" } : null
  ].filter(Boolean);
  const checks = [];

  checks.push(makeReadinessCheck({
    id: "release:git-range",
    status: commitResult.ok && (resolvedSince ? true : commitResult.commits.length > 0) ? "pass" : "fail",
    title: commitResult.ok ? "Release commit range is readable" : "Release commit range is unavailable",
    message: commitResult.ok ? `Collected ${commitResult.commits.length} non-merge commit(s) from ${resolvedSince || "HEAD"}.` : commitResult.error,
    remediation: commitResult.ok ? null : "Provide a valid --since ref and fetch enough Git history to compare it.",
    evidence: []
  }));

  checks.push(makeReadinessCheck({
    id: "release:version",
    status: versionStatus(effectiveVersion),
    title: versionStatus(effectiveVersion) === "pass" ? `Release version ${effectiveVersion} is valid` : "Release version is missing or invalid",
    message: versionStatus(effectiveVersion) === "pass" ? "The release version follows semantic-version syntax." : "A release requires a valid semantic version such as 0.7.0.",
    remediation: versionStatus(effectiveVersion) === "pass" ? null : "Set package.json.version or pass --version VERSION.",
    evidence: versionEvidence
  }));

  const changelogEntry = effectiveVersion && changelog ? new RegExp(`^##\\s+v?${effectiveVersion.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "m").test(changelog) : false;
  checks.push(makeReadinessCheck({
    id: "release:changelog",
    status: changelogEntry ? "pass" : "fail",
    title: changelogEntry ? "CHANGELOG contains the release entry" : "CHANGELOG is missing the release entry",
    message: changelogEntry ? `Found a CHANGELOG heading for ${effectiveVersion}.` : `No CHANGELOG heading for ${effectiveVersion || "the release version"} was found.`,
    remediation: changelogEntry ? null : "Add release notes under a version heading before publishing.",
    evidence: [{ path: "CHANGELOG.md" }]
  }));

  const packageVersion = packageJson?.version || null;
  const citationVersion = citation?.match(/^version:\s*['\"]?([^'\"\s]+)['\"]?/m)?.[1] || null;
  const versionsAvailable = Boolean(packageVersion && citationVersion);
  const versionsMatch = versionsAvailable && packageVersion === citationVersion;
  const consistencyStatus = versionsAvailable ? (versionsMatch ? "pass" : "fail") : (effectiveVersion ? "warn" : "fail");
  checks.push(makeReadinessCheck({
    id: "release:version-consistency",
    status: consistencyStatus,
    title: consistencyStatus === "pass" ? "Published version metadata is consistent" : (consistencyStatus === "warn" ? "Version metadata has no complete comparison" : "Version metadata is inconsistent"),
    message: consistencyStatus === "pass" ? `Package and citation versions agree on ${packageVersion}.` : (consistencyStatus === "warn" ? "Only one comparable release metadata source was found; the explicit or inferred version is still usable." : `package.json reports ${packageVersion}, while CITATION.cff reports ${citationVersion}.`),
    remediation: consistencyStatus === "pass" ? null : (consistencyStatus === "warn" ? "Add a second release metadata source or document why the project uses only one." : "Update package.json and CITATION.cff to the same version."),
    evidence: versionEvidence
  }));

  const testSignal = !sourceFiles.length || testFiles.length > 0 || report?.checks?.some((check) => check.id?.startsWith("command:") && check.status === "pass");
  checks.push(makeReadinessCheck({
    id: "release:test-evidence",
    status: testSignal ? "pass" : "warn",
    title: testSignal ? "Release has test evidence" : "Release lacks a changed-test signal",
    message: testSignal ? `Found ${testFiles.length} changed test file(s) or a passing configured command.` : `${sourceFiles.length} source file(s) changed without a test-file change.`,
    remediation: testSignal ? null : "Add focused tests or document why existing tests cover the release.",
    evidence: [...sourceFiles, ...testFiles].map((file) => ({ path: file }))
  }));

  const docsSignal = !sourceFiles.length || docsFiles.length > 0;
  checks.push(makeReadinessCheck({
    id: "release:documentation",
    status: docsSignal ? "pass" : "warn",
    title: docsSignal ? "Release has documentation evidence" : "Release lacks a documentation signal",
    message: docsSignal ? `Found ${docsFiles.length} documentation file(s) in the range.` : "Source changed without a README or docs change.",
    remediation: docsSignal ? null : "Update user-facing documentation or record an explicit exception.",
    evidence: [...sourceFiles, ...docsFiles].map((file) => ({ path: file }))
  }));

  const highFindings = (report?.review?.findings || []).filter((finding) => finding.level === "high");
  checks.push(makeReadinessCheck({
    id: "release:review-risk",
    status: highFindings.length ? "fail" : "pass",
    title: highFindings.length ? "High-severity review findings remain" : "No high-severity review findings remain",
    message: highFindings.length ? `${highFindings.length} high-severity finding(s) need resolution before release.` : "The available change review contains no high-severity findings.",
    remediation: highFindings.length ? "Resolve high-severity findings and rerun release readiness." : null,
    evidence: highFindings.flatMap((finding) => finding.evidence || [])
  }));

  const summary = { pass: 0, warn: 0, fail: 0, total: checks.length };
  for (const check of checks) summary[check.status] += 1;
  summary.score = Math.max(0, 100 - summary.fail * 25 - summary.warn * 10);
  summary.status = summary.fail ? "fail" : (summary.warn ? "needs-attention" : "pass");
  const recommendations = [];
  if (summary.fail) recommendations.push("Resolve every release-blocking check before creating a public tag.");
  if (summary.warn) recommendations.push("Review warnings with a maintainer and record accepted exceptions in the release notes.");
  if (!recommendations.length) recommendations.push("Create the tag, publish the release notes, and retain the proof bundle with the release.");

  return {
    schemaVersion: 1,
    kind: "release-readiness",
    available: true,
    root: path.resolve(root),
    since: resolvedSince,
    version: effectiveVersion,
    commits: commitResult.commits,
    changes: {
      files: parsed.files.length,
      additions: parsed.additions,
      deletions: parsed.deletions,
      sourceFiles,
      testFiles,
      documentationFiles: docsFiles,
      changelogFiles
    },
    summary,
    checks,
    recommendations
  };
}

function formatReleaseMarkdown(release) {
  if (!release || !release.available) return `# ContribProof release readiness\n\nUnavailable: ${release?.reason || "no Git history"}.\n`;
  const lines = [
    "# ContribProof release readiness",
    "",
    `- Status: **${release.summary.status}**`,
    `- Score: **${release.summary.score}/100**`,
    `- Version: **${release.version || "unspecified"}**`,
    `- Commits: **${release.commits.length}**`,
    `- Changed files: **${release.changes.files}**`,
    `- Additions / deletions: **${release.changes.additions} / ${release.changes.deletions}**`,
    `- Since: \`${release.since || "HEAD"}\``,
    "",
    "## Readiness checks",
    ""
  ];
  for (const check of release.checks) {
    const icon = check.status === "pass" ? "✅" : (check.status === "warn" ? "⚠️" : "❌");
    lines.push(`### ${icon} ${check.title}`, "", check.message);
    if (check.remediation) lines.push("", `**Next step:** ${check.remediation}`);
    if (check.evidence.length) lines.push("", "Evidence:", ...check.evidence.map((evidence) => `- \`${evidence.path}\``));
    lines.push("");
  }
  lines.push("## Recommendations", "", ...release.recommendations.map((item) => `- ${item}`), "");
  return `${lines.join("\n").trim()}\n`;
}

module.exports = {
  buildReleaseReadiness,
  formatReleaseMarkdown,
  inferVersion,
  parseCommits
};
