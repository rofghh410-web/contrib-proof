const fs = require("node:fs");
const path = require("node:path");
const { makeCheck } = require("./check");

const MANIFESTS = {
  "package.json": {
    ecosystem: "npm",
    lockfiles: ["package-lock.json", "npm-shrinkwrap.json", "pnpm-lock.yaml", "yarn.lock", "bun.lock", "bun.lockb"],
    fields: ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]
  },
  "pyproject.toml": { ecosystem: "python", lockfiles: ["poetry.lock", "uv.lock", "Pipfile.lock", "requirements.txt"] },
  "requirements.txt": { ecosystem: "python", lockfiles: [] },
  "Pipfile": { ecosystem: "python", lockfiles: ["Pipfile.lock"] },
  "Cargo.toml": { ecosystem: "rust", lockfiles: ["Cargo.lock"] },
  "go.mod": { ecosystem: "go", lockfiles: ["go.sum"] },
  "Gemfile": { ecosystem: "ruby", lockfiles: ["Gemfile.lock"] },
  "composer.json": { ecosystem: "php", lockfiles: ["composer.lock"] },
  "mix.exs": { ecosystem: "elixir", lockfiles: ["mix.lock"] },
  "pubspec.yaml": { ecosystem: "dart", lockfiles: ["pubspec.lock"] }
};

const ACTION_PATTERN = /^\s*-\s*uses:\s*([^\s#]+)(?:\s+#.*)?$/gm;

function readText(root, relative) {
  try {
    return fs.readFileSync(path.join(root, relative), "utf8");
  } catch {
    return null;
  }
}

function countPackageDependencies(parsed, fields) {
  return fields.reduce((count, field) => {
    const value = parsed[field];
    return count + (value && typeof value === "object" ? Object.keys(value).length : 0);
  }, 0);
}

function inspectManifest(root, file, knownFiles) {
  const name = path.basename(file.path);
  const rule = MANIFESTS[name];
  if (!rule) return null;
  const directory = path.posix.dirname(file.path);
  const siblingFiles = new Set(knownFiles
    .filter((candidate) => path.posix.dirname(candidate) === directory)
    .map((candidate) => path.posix.basename(candidate)));
  const lockfiles = rule.lockfiles.filter((candidate) => siblingFiles.has(candidate));
  const descriptor = {
    path: file.path,
    ecosystem: rule.ecosystem,
    lockfiles,
    dependencyCount: null,
    parseError: false
  };

  if (name === "package.json") {
    const text = readText(root, file.path);
    try {
      const parsed = JSON.parse(text || "");
      descriptor.dependencyCount = countPackageDependencies(parsed, rule.fields);
      descriptor.private = parsed.private === true;
    } catch {
      descriptor.parseError = true;
    }
  } else if (name === "requirements.txt") {
    const text = readText(root, file.path) || "";
    descriptor.dependencyCount = text.split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && !line.startsWith("-"))
      .length;
  } else {
    descriptor.dependencyCount = null;
  }
  return descriptor;
}

function buildDependencyInventory(root, files = []) {
  const knownFiles = files.map((file) => file.path);
  const manifests = files
    .map((file) => inspectManifest(root, file, knownFiles))
    .filter(Boolean);
  const lockfiles = files
    .filter((file) => /(?:package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lock(?:b)?|poetry\.lock|uv\.lock|Pipfile\.lock|Cargo\.lock|go\.sum|Gemfile\.lock|composer\.lock|mix\.lock|pubspec\.lock)$/.test(file.path))
    .map((file) => file.path);
  const unlocked = manifests.filter((manifest) => {
    if (manifest.parseError || manifest.dependencyCount === 0) return false;
    return manifest.lockfiles.length === 0;
  });
  return {
    schemaVersion: 1,
    manifests,
    lockfiles,
    ecosystems: [...new Set(manifests.map((manifest) => manifest.ecosystem))].sort(),
    declaredDependencies: manifests.reduce((sum, manifest) => sum + (manifest.dependencyCount || 0), 0),
    unlocked: unlocked.map((manifest) => manifest.path)
  };
}

function checkDependencyHygiene(inventory, config = {}) {
  const dependencyInventory = inventory.dependencies;
  if (!dependencyInventory || dependencyInventory.manifests.length === 0) {
    return [makeCheck({
      id: "dependencies:inventory",
      category: "supply-chain",
      status: "skip",
      severity: "info",
      title: "No supported dependency manifest was found",
      message: "Dependency hygiene is only evaluated for recognized package manifests.",
      remediation: null,
      evidence: []
    })];
  }

  const parseErrors = dependencyInventory.manifests.filter((manifest) => manifest.parseError);
  if (parseErrors.length) {
    return [makeCheck({
      id: "dependencies:parse",
      category: "supply-chain",
      status: "warn",
      severity: "warning",
      title: "Some dependency manifests could not be parsed",
      message: `${parseErrors.length} recognized manifest(s) could not be parsed; lockfile conclusions may be incomplete.`,
      remediation: "Fix the manifest syntax and rerun the proof so dependency evidence is complete.",
      evidence: parseErrors.map((manifest) => ({ path: manifest.path }))
    })];
  }

  if (config.requireLockfile && dependencyInventory.unlocked.length) {
    return [makeCheck({
      id: "dependencies:lockfile",
      category: "supply-chain",
      status: "warn",
      severity: "warning",
      title: "Dependency manifests lack a neighboring lockfile",
      message: `${dependencyInventory.unlocked.length} manifest(s) declare dependencies without a recognized lockfile.`,
      remediation: "Commit the ecosystem's lockfile when reproducible installs are part of the project's support contract.",
      evidence: dependencyInventory.unlocked.map((file) => ({ path: file }))
    })];
  }

  return [makeCheck({
    id: "dependencies:inventory",
    category: "supply-chain",
    status: "pass",
    title: "Dependency manifests are inventoried",
    message: `Found ${dependencyInventory.manifests.length} manifest(s), ${dependencyInventory.lockfiles.length} lockfile(s), and ${dependencyInventory.declaredDependencies} directly declared dependencies.`,
    remediation: null,
    evidence: dependencyInventory.manifests.map((manifest) => ({
      path: manifest.path,
      detail: `${manifest.ecosystem}; ${manifest.lockfiles.length ? "lockfile present" : "no recognized lockfile"}`
    }))
  })];
}

function collectActionReferences(root, workflows) {
  const references = [];
  for (const workflow of workflows || []) {
    const text = readText(root, workflow.path);
    if (text === null) continue;
    for (const match of text.matchAll(ACTION_PATTERN)) {
      const value = match[1];
      if (value.startsWith("./") || value.startsWith("docker://")) continue;
      const at = value.lastIndexOf("@");
      if (at < 1) continue;
      references.push({
        path: workflow.path,
        reference: value,
        line: text.slice(0, match.index).split(/\r?\n/).length,
        pinned: /^[0-9a-f]{40}$/i.test(value.slice(at + 1))
      });
    }
  }
  return references;
}

function checkActionPinning(root, inventory, config = {}) {
  if (!config.checkActionPinning) return [];
  const references = collectActionReferences(root, inventory.workflows);
  const allowed = new Set(config.allowedActionRefs || []);
  const unpinned = references.filter((item) => !item.pinned && !allowed.has(item.reference));
  if (unpinned.length) {
    return [makeCheck({
      id: "workflow:action-pinning",
      category: "supply-chain",
      status: "warn",
      severity: "warning",
      title: "Some workflow actions are not pinned to a commit",
      message: `${unpinned.length} action reference(s) use a mutable tag or branch.`,
      remediation: "Pin third-party actions to a reviewed full-length commit SHA, or document a narrowly scoped allowlist.",
      evidence: unpinned.map((item) => ({ path: item.path, line: item.line, detail: item.reference }))
    })];
  }
  return [makeCheck({
    id: "workflow:action-pinning",
    category: "supply-chain",
    status: "pass",
    title: "Workflow action references are pinned",
    message: `Inspected ${references.length} external action reference(s).`,
    remediation: null,
    evidence: references.map((item) => ({ path: item.path, line: item.line, detail: item.reference }))
  })];
}

module.exports = {
  MANIFESTS,
  buildDependencyInventory,
  checkActionPinning,
  checkDependencyHygiene,
  collectActionReferences
};
