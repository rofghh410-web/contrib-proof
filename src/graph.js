const fs = require("node:fs");
const path = require("node:path");
const { buildInventory } = require("./inventory");

const CODE_EXTENSIONS = new Set([".c", ".cc", ".cpp", ".cs", ".go", ".java", ".js", ".jsx", ".kt", ".php", ".py", ".rb", ".rs", ".swift", ".ts", ".tsx", ".vue"]);

function readText(root, relative) {
  try {
    const absolute = path.join(root, relative);
    const stat = fs.statSync(absolute);
    if (stat.size > 1024 * 1024) return null;
    return fs.readFileSync(absolute, "utf8");
  } catch {
    return null;
  }
}

function addMatch(symbols, name, kind, line) {
  if (!name || name.length < 2) return;
  symbols.push({ name, kind, line });
}

function extractSymbols(relative, text) {
  const ext = path.extname(relative).toLowerCase();
  const symbols = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((lineText, index) => {
    const line = index + 1;
    if ([".js", ".jsx", ".ts", ".tsx", ".vue"].includes(ext)) {
      for (const match of lineText.matchAll(/\b(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g)) addMatch(symbols, match[1], "function", line);
      for (const match of lineText.matchAll(/\b(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/g)) addMatch(symbols, match[1], "class", line);
      for (const match of lineText.matchAll(/\b(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g)) addMatch(symbols, match[1], "variable", line);
    } else if (ext === ".py") {
      const match = lineText.match(/^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/);
      if (match) addMatch(symbols, match[1], "function", line);
      const classMatch = lineText.match(/^\s*class\s+([A-Za-z_]\w*)/);
      if (classMatch) addMatch(symbols, classMatch[1], "class", line);
    } else if (ext === ".go") {
      const match = lineText.match(/^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/);
      if (match) addMatch(symbols, match[1], "function", line);
    } else if (ext === ".rs") {
      const match = lineText.match(/^\s*(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)/);
      if (match) addMatch(symbols, match[1], "function", line);
      const structMatch = lineText.match(/^\s*(?:pub\s+)?struct\s+([A-Za-z_]\w*)/);
      if (structMatch) addMatch(symbols, structMatch[1], "struct", line);
    }
  });
  return symbols;
}

function extractImports(relative, text) {
  const imports = [];
  const ext = path.extname(relative).toLowerCase();
  const patterns = [];
  if ([".js", ".jsx", ".ts", ".tsx", ".vue"].includes(ext)) {
    patterns.push(/\bfrom\s*["']([^"']+)["']/g, /\bimport\s*["']([^"']+)["']/g, /\brequire\(\s*["']([^"']+)["']\s*\)/g);
  } else if (ext === ".py") {
    patterns.push(/^\s*from\s+([A-Za-z0-9_.]+)/gm, /^\s*import\s+([A-Za-z0-9_.]+)/gm);
  } else if (ext === ".go") {
    patterns.push(/"([^"\n]+)"/g);
  } else if (ext === ".rs") {
    patterns.push(/\b(?:mod|use)\s+([A-Za-z0-9_:]+)/g);
  }
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const target = match[1];
      if (target && (target.startsWith(".") || target.startsWith("/") || ext === ".py" || ext === ".rs")) {
        imports.push({ target, line: text.slice(0, match.index).split(/\r?\n/).length });
      }
    }
  }
  return imports;
}

function resolveRelativeImport(root, source, target, knownFiles) {
  if (!target.startsWith(".") && !target.startsWith("/")) return null;
  const sourceAbsolute = path.join(root, source);
  const base = target.startsWith("/") ? path.join(root, target) : path.resolve(path.dirname(sourceAbsolute), target);
  const candidates = [base, ...[".js", ".jsx", ".ts", ".tsx", ".py", ".go", ".rs"].map((extension) => `${base}${extension}`), path.join(base, "index.js"), path.join(base, "index.ts")];
  const normalized = new Set(knownFiles.map((file) => path.normalize(file)));
  for (const candidate of candidates) {
    const relative = path.relative(root, candidate).split(path.sep).join("/");
    if (normalized.has(path.normalize(relative))) return relative;
  }
  return null;
}

function buildGraph(root, inventory = buildInventory(root)) {
  const knownFiles = inventory.files.filter((file) => CODE_EXTENSIONS.has(file.extension)).map((file) => file.path);
  const nodes = [];
  const edges = [];
  for (const relative of knownFiles) {
    const text = readText(root, relative);
    if (text === null) continue;
    const symbols = extractSymbols(relative, text);
    for (const symbol of symbols) nodes.push({ id: `${relative}:${symbol.name}:${symbol.line}`, file: relative, ...symbol });
    for (const imported of extractImports(relative, text)) {
      const target = resolveRelativeImport(root, relative, imported.target, knownFiles);
      if (target) edges.push({ from: relative, to: target, kind: "imports", line: imported.line });
    }
  }
  return { schemaVersion: 1, nodes, edges, files: knownFiles, fileCount: knownFiles.length };
}

function analyzeImpact(root, changedFiles, graph = buildGraph(root)) {
  const changed = new Set(changedFiles);
  const impacted = new Map();
  for (const file of changed) impacted.set(file, { file, direct: true, reasons: ["changed"] });
  let changedSomething = true;
  while (changedSomething) {
    changedSomething = false;
    for (const edge of graph.edges) {
      if (impacted.has(edge.to) && !impacted.has(edge.from)) {
        impacted.set(edge.from, { file: edge.from, direct: false, reasons: [`imports ${edge.to}`] });
        changedSomething = true;
      }
    }
  }
  const testFiles = (graph.files || []).filter((file) => /(^|\/)(test|tests|__tests__|spec|specs)(\/|$)|\.(test|spec)\./i.test(file));
  const testCandidates = testFiles
    .filter((file) => [...impacted.keys()].some((changedFile) => file.toLowerCase().includes(path.basename(changedFile, path.extname(changedFile)).toLowerCase())))
    .map((file) => ({ file, symbol: null, line: null }));
  return {
    schemaVersion: 1,
    changedFiles: [...changed],
    impactedFiles: [...impacted.values()],
    importEdgesConsidered: graph.edges.length,
    symbolNodes: graph.nodes.length,
    testCandidates
  };
}

module.exports = {
  analyzeImpact,
  buildGraph,
  extractImports,
  extractSymbols,
  resolveRelativeImport
};
