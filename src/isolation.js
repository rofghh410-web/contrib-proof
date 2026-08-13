const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ISOLATION_MODES = new Set(["none", "copy"]);
const NETWORK_POLICIES = new Set(["allow", "deny"]);
const EXCLUDED_COPY_NAMES = new Set([".git", "node_modules", ".venv", "venv", "target", "dist", "build", "coverage", "artifacts"]);

function normalizeIsolation(value = {}) {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const mode = input.mode || "none";
  const network = input.network || "allow";
  if (!ISOLATION_MODES.has(mode)) throw new Error(`isolation mode must be one of: ${[...ISOLATION_MODES].join(", ")}`);
  if (!NETWORK_POLICIES.has(network)) throw new Error(`network policy must be one of: ${[...NETWORK_POLICIES].join(", ")}`);
  return { mode, network };
}

function assertNoSymlinks(root, { maxEntries = 20000 } = {}) {
  let visited = 0;
  function visit(current) {
    if (++visited > maxEntries) throw new Error(`fixture isolation exceeded ${maxEntries} filesystem entries`);
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) throw new Error(`fixture isolation refuses symlink: ${current}`);
    if (!stat.isDirectory()) return;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (EXCLUDED_COPY_NAMES.has(entry.name)) continue;
      visit(path.join(current, entry.name));
    }
  }
  visit(root);
}

function copyFilter(source) {
  return !EXCLUDED_COPY_NAMES.has(path.basename(source));
}

function prepareIsolatedWorkspace(sourceRoot, policy = {}) {
  const isolation = normalizeIsolation(policy);
  const source = path.resolve(sourceRoot);
  if (!fs.existsSync(source) || !fs.statSync(source).isDirectory()) throw new Error("fixture root does not exist or is not a directory");
  if (isolation.mode === "none") return {
    root: source,
    isolation: { ...isolation, copied: false, symlinkPolicy: "not-applicable" },
    cleanup() {}
  };
  assertNoSymlinks(source);
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "contrib-proof-fixture-"));
  const destination = path.join(temporaryRoot, "workspace");
  try {
    fs.cpSync(source, destination, { recursive: true, filter: copyFilter, verbatimSymlinks: true });
  } catch (error) {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
    throw error;
  }
  return {
    root: destination,
    isolation: { ...isolation, copied: true, symlinkPolicy: "rejected", excluded: [...EXCLUDED_COPY_NAMES].sort() },
    cleanup() { fs.rmSync(temporaryRoot, { recursive: true, force: true }); }
  };
}

function networkDenySupported() {
  return process.platform === "linux";
}

module.exports = {
  EXCLUDED_COPY_NAMES,
  ISOLATION_MODES,
  NETWORK_POLICIES,
  assertNoSymlinks,
  networkDenySupported,
  normalizeIsolation,
  prepareIsolatedWorkspace
};
