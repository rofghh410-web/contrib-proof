const fs = require("node:fs");
const path = require("node:path");
const { makeCheck } = require("./check");

const ADAPTER_CONTRACT_VERSION = 1;

function byExtension(files, extensions) {
  const expected = new Set(extensions);
  return files.filter((file) => expected.has(path.extname(file.path).toLowerCase())).map((file) => file.path).sort();
}

function named(files, filename) {
  return files.filter((file) => path.posix.basename(file.path) === filename).map((file) => file.path).sort();
}

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

function testPaths(paths, expression) {
  return paths.filter((file) => expression.test(file)).sort();
}

function javascriptAdapter(root, files) {
  const sources = byExtension(files, [".js", ".jsx", ".ts", ".tsx", ".vue"]);
  const packageFiles = named(files, "package.json");
  const packages = packageFiles.map((relative) => {
    const parsed = readJson(root, relative);
    return {
      path: relative,
      parseError: !parsed,
      name: parsed?.name || null,
      private: parsed?.private === true,
      scripts: parsed?.scripts && typeof parsed.scripts === "object" ? Object.keys(parsed.scripts).sort() : [],
      testScript: Boolean(parsed?.scripts?.test),
      packageManager: parsed?.packageManager || null
    };
  });
  return {
    id: "javascript-typescript",
    version: ADAPTER_CONTRACT_VERSION,
    status: sources.length || packageFiles.length ? "detected" : "absent",
    languages: ["JavaScript", "TypeScript", "Vue"],
    sourceFiles: sources.length,
    testFiles: testPaths(sources, /(^|\/)(test|tests|__tests__|spec|specs)\/|\.(test|spec)\.(?:[cm]?[jt]sx?|vue)$/i),
    manifests: packageFiles,
    facts: { packages, tsconfigPaths: named(files, "tsconfig.json") }
  };
}

function pythonAdapter(root, files) {
  const sources = byExtension(files, [".py"]);
  const pyprojects = named(files, "pyproject.toml").map((relative) => {
    const source = readText(root, relative);
    return {
      path: relative,
      parseError: source === null,
      projectName: source?.match(/^name\s*=\s*["']([^"']+)["']/m)?.[1] || null,
      hasPytestConfig: /\[tool\.pytest(?:\.ini_options)?\]/.test(source || ""),
      hasProjectTable: /^\[project\]/m.test(source || "")
    };
  });
  return {
    id: "python",
    version: ADAPTER_CONTRACT_VERSION,
    status: sources.length || pyprojects.length ? "detected" : "absent",
    languages: ["Python"],
    sourceFiles: sources.length,
    testFiles: testPaths(sources, /(^|\/)(test|tests)\/|(^|\/)test_[^/]+\.py$|_test\.py$/i),
    manifests: [...named(files, "pyproject.toml"), ...named(files, "requirements.txt"), ...named(files, "Pipfile")],
    facts: { projects: pyprojects, requirements: named(files, "requirements.txt") }
  };
}

function rustAdapter(root, files) {
  const sources = byExtension(files, [".rs"]);
  const cargo = named(files, "Cargo.toml").map((relative) => {
    const source = readText(root, relative);
    return {
      path: relative,
      parseError: source === null,
      packageName: source?.match(/^name\s*=\s*["']([^"']+)["']/m)?.[1] || null,
      workspace: /^\[workspace\]/m.test(source || ""),
      library: /^\[lib\]/m.test(source || "") || /(^|\/)src\/lib\.rs$/.test(relative),
      binaries: (source?.match(/^\[\[bin\]\]/gm) || []).length
    };
  });
  return {
    id: "rust",
    version: ADAPTER_CONTRACT_VERSION,
    status: sources.length || cargo.length ? "detected" : "absent",
    languages: ["Rust"],
    sourceFiles: sources.length,
    testFiles: testPaths(sources, /(^|\/)tests\/|_test\.rs$/i),
    manifests: named(files, "Cargo.toml"),
    facts: { cargo }
  };
}

function goAdapter(root, files) {
  const sources = byExtension(files, [".go"]);
  const modules = named(files, "go.mod").map((relative) => {
    const source = readText(root, relative);
    return {
      path: relative,
      parseError: source === null,
      module: source?.match(/^module\s+([^\s]+)/m)?.[1] || null,
      goVersion: source?.match(/^go\s+([^\s]+)/m)?.[1] || null
    };
  });
  return {
    id: "go",
    version: ADAPTER_CONTRACT_VERSION,
    status: sources.length || modules.length ? "detected" : "absent",
    languages: ["Go"],
    sourceFiles: sources.length,
    testFiles: testPaths(sources, /_test\.go$/i),
    manifests: named(files, "go.mod"),
    facts: { modules }
  };
}

const BUILTIN_ADAPTERS = [javascriptAdapter, pythonAdapter, rustAdapter, goAdapter];

function buildLanguageAdapters(root, files = [], { adapters = BUILTIN_ADAPTERS } = {}) {
  const results = adapters.map((adapter) => adapter(root, files));
  const detected = results.filter((adapter) => adapter.status === "detected");
  return {
    schemaVersion: 1,
    kind: "language-adapters",
    contractVersion: ADAPTER_CONTRACT_VERSION,
    adapters: results,
    detected: detected.map((adapter) => adapter.id),
    summary: {
      adapters: results.length,
      detected: detected.length,
      sourceFiles: detected.reduce((sum, adapter) => sum + adapter.sourceFiles, 0),
      testFiles: detected.reduce((sum, adapter) => sum + adapter.testFiles.length, 0)
    }
  };
}

function formatLanguageAdaptersMarkdown(inventory) {
  const lines = [
    "# ContribProof language adapters",
    "",
    `- Contract version: **${inventory.contractVersion}**`,
    `- Detected: **${inventory.summary.detected}/${inventory.summary.adapters}**`,
    `- Source files: **${inventory.summary.sourceFiles}**`,
    `- Test files: **${inventory.summary.testFiles}**`,
    "",
    "## Adapters",
    ""
  ];
  for (const adapter of inventory.adapters || []) lines.push(`- **${adapter.id}** · ${adapter.status} · ${adapter.sourceFiles} source file(s) · ${adapter.testFiles.length} test file(s)`);
  lines.push("");
  return `${lines.join("\n").trim()}\n`;
}

function buildLanguageAdapterChecks(adapterInventory) {
  const inventory = adapterInventory || { adapters: [], detected: [], summary: { detected: 0, sourceFiles: 0, testFiles: 0 } };
  if (!inventory.summary.detected) return [makeCheck({
    id: "adapters:inventory",
    category: "language-adapters",
    status: "skip",
    severity: "info",
    title: "No built-in language adapter matched",
    message: "The built-in adapters currently cover JavaScript/TypeScript, Python, Rust, and Go.",
    remediation: "Use repository checks directly or extend the adapter registry with a versioned adapter.",
    evidence: []
  })];
  const parseErrors = inventory.adapters.flatMap((adapter) => Object.values(adapter.facts || {}).flat().filter((fact) => fact?.parseError).map((fact) => ({ path: fact.path, detail: adapter.id })));
  if (parseErrors.length) return [makeCheck({
    id: "adapters:parse",
    category: "language-adapters",
    status: "warn",
    severity: "warning",
    title: "Some language adapter manifests could not be parsed",
    message: `${parseErrors.length} adapter manifest(s) could not be read completely.`,
    remediation: "Fix the manifest syntax so ecosystem evidence is complete.",
    evidence: parseErrors
  })];
  return [makeCheck({
    id: "adapters:inventory",
    category: "language-adapters",
    status: "pass",
    severity: "info",
    title: "Language adapters produced repository evidence",
    message: `Detected ${inventory.summary.detected} adapter(s), ${inventory.summary.sourceFiles} source file(s), and ${inventory.summary.testFiles} test file(s).`,
    remediation: null,
    evidence: inventory.adapters.filter((adapter) => adapter.status === "detected").flatMap((adapter) => adapter.manifests.map((manifest) => ({ path: manifest, detail: adapter.id })))
  })];
}

module.exports = {
  ADAPTER_CONTRACT_VERSION,
  BUILTIN_ADAPTERS,
  buildLanguageAdapterChecks,
  buildLanguageAdapters,
  formatLanguageAdaptersMarkdown,
  goAdapter,
  javascriptAdapter,
  pythonAdapter,
  rustAdapter
};
