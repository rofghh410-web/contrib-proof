const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const targets = [path.join(root, "bin", "contrib-proof.js")]
  .concat(fs.readdirSync(path.join(root, "src"), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
    .map((entry) => path.join(root, "src", entry.name)));

for (const target of targets) {
  const result = spawnSync(process.execPath, ["--check", target], { encoding: "utf8" });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || `Syntax check failed: ${target}\n`);
    process.exit(result.status || 1);
  }
}

console.log(`Checked ${targets.length} JavaScript files.`);
