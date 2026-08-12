const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { buildDependencyInventory } = require("./dependencies");

const IGNORED_DIRECTORIES = new Set([
  ".git", ".hg", ".svn", "node_modules", "vendor", "target", "dist", "build", "artifacts",
  "coverage", ".next", ".venv", "venv", "__pycache__"
]);

const MANIFEST_NAMES = new Set([
  "package.json", "package-lock.json", "pnpm-lock.yaml", "yarn.lock", "pyproject.toml",
  "requirements.txt", "Cargo.toml", "Cargo.lock", "go.mod", "go.sum", "pom.xml",
  "build.gradle", "Gemfile", "composer.json", "mix.exs", "pubspec.yaml"
]);

const IGNORED_FILE_PATTERNS = [/^contrib-proof-.*\.(?:tar\.gz|tgz)$/i, /^\.DS_Store$/];

const LANGUAGE_BY_EXTENSION = {
  ".c": "C", ".cc": "C++", ".cpp": "C++", ".cs": "C#", ".dart": "Dart",
  ".ex": "Elixir", ".exs": "Elixir", ".go": "Go", ".h": "C/C++ header",
  ".hpp": "C/C++ header", ".java": "Java", ".js": "JavaScript", ".jsx": "JavaScript",
  ".json": "JSON", ".kt": "Kotlin", ".md": "Markdown", ".mdx": "Markdown",
  ".php": "PHP", ".py": "Python", ".rb": "Ruby", ".rs": "Rust", ".sh": "Shell",
  ".sql": "SQL", ".swift": "Swift", ".toml": "TOML", ".ts": "TypeScript",
  ".tsx": "TypeScript", ".vue": "Vue", ".xml": "XML", ".yaml": "YAML", ".yml": "YAML"
};

function hashBytes(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function relativePath(root, absolute) {
  return path.relative(root, absolute).split(path.sep).join("/");
}

function walkFiles(root, { maxFiles = 10000 } = {}) {
  const files = [];
  function visit(directory) {
    if (files.length >= maxFiles) return;
    let entries;
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files.length >= maxFiles) return;
      if (entry.name.startsWith(".") && entry.name !== ".github") continue;
      if (IGNORED_DIRECTORIES.has(entry.name)) continue;
      if (entry.isFile() && IGNORED_FILE_PATTERNS.some((pattern) => pattern.test(entry.name))) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) files.push(absolute);
    }
  }
  visit(root);
  return files;
}

function fileDescriptor(root, absolute) {
  const relative = relativePath(root, absolute);
  const stat = fs.statSync(absolute);
  const extension = path.extname(relative).toLowerCase();
  const descriptor = {
    path: relative,
    bytes: stat.size,
    language: LANGUAGE_BY_EXTENSION[extension] || null,
    extension: extension || null
  };
  if (stat.size <= 2 * 1024 * 1024) {
    descriptor.sha256 = hashBytes(fs.readFileSync(absolute));
  } else {
    descriptor.hashSkipped = "file-too-large";
  }
  return descriptor;
}

function parsePackageScripts(root) {
  const packagePath = path.join(root, "package.json");
  if (!fs.existsSync(packagePath)) return null;
  try {
    const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
    return {
      name: packageJson.name || null,
      version: packageJson.version || null,
      scripts: packageJson.scripts || {},
      packageManager: packageJson.packageManager || null,
      private: packageJson.private === true
    };
  } catch {
    return { parseError: true };
  }
}

function inspectWorkflow(root, relative) {
  let text = "";
  try {
    text = fs.readFileSync(path.join(root, relative), "utf8");
  } catch {
    return { path: relative, readable: false };
  }
  const permissions = [];
  const permissionsHeader = text.match(/^permissions:\s*(.*?)\s*$/m);
  if (permissionsHeader) {
    if (permissionsHeader[1]) permissions.push({ scope: "*", value: permissionsHeader[1] });
    for (const match of text.matchAll(/^\s{2,}([A-Za-z0-9_-]+):\s*(read|write|none)\s*$/gm)) {
      permissions.push({ scope: match[1], value: match[2] });
    }
  }
  return {
    path: relative,
    readable: true,
    hasCheckout: /actions\/checkout@/i.test(text),
    hasPullRequestTrigger: /pull_request(?:_target)?:?/i.test(text),
    usesPullRequestTarget: /pull_request_target/i.test(text),
    usesWritePermission: /(?:contents|pull-requests|issues):\s*write/i.test(text),
    permissions
  };
}

function buildInventory(root, { maxFiles = 10000 } = {}) {
  const absoluteFiles = walkFiles(root, { maxFiles });
  const files = [];
  const languageCounts = {};
  const manifests = [];
  for (const absolute of absoluteFiles) {
    let descriptor;
    try {
      descriptor = fileDescriptor(root, absolute);
    } catch {
      continue;
    }
    files.push(descriptor);
    if (descriptor.language) languageCounts[descriptor.language] = (languageCounts[descriptor.language] || 0) + 1;
    if (MANIFEST_NAMES.has(path.basename(descriptor.path))) manifests.push(descriptor.path);
  }
  const workflows = files
    .map((file) => file.path)
    .filter((file) => file.startsWith(".github/workflows/") && /\.(yml|yaml)$/i.test(file))
    .map((file) => inspectWorkflow(root, file));
  const markdownFiles = files.filter((file) => /\.(md|mdx)$/i.test(file.path)).map((file) => file.path);
  const dependencies = buildDependencyInventory(root, files);
  return {
    schemaVersion: 1,
    fileCount: files.length,
    truncated: absoluteFiles.length >= maxFiles,
    files,
    languageCounts,
    manifests,
    markdownFiles,
    workflows,
    package: parsePackageScripts(root),
    dependencies
  };
}

module.exports = {
  IGNORED_DIRECTORIES,
  IGNORED_FILE_PATTERNS,
  LANGUAGE_BY_EXTENSION,
  buildInventory,
  hashBytes,
  walkFiles
};
