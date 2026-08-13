const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const required = ["README.md", "LICENSE", "SECURITY.md", "CONTRIBUTING.md", "CHANGELOG.md", "action.yml"];
const problems = [];

for (const relative of required) {
  if (!fs.existsSync(path.join(root, relative))) problems.push(`missing ${relative}`);
}
if (!/^\d+\.\d+\.\d+$/.test(packageJson.version || "")) problems.push("package version must be plain semver");
if (packageJson.name !== "contrib-proof") problems.push("package name must remain contrib-proof unless the migration is documented");

const publicTextFiles = [
  "README.md",
  "package.json",
  "CITATION.cff",
  "docs/OPENAI_OSS_APPLICATION.md",
  "docs/PUBLISH.md",
  "examples/github-actions/contrib-proof.yml",
  "schemas/report.schema.json",
  "schemas/plan.schema.json",
  "schemas/review.schema.json",
  "schemas/gate.schema.json",
  "schemas/release.schema.json",
  "schemas/baseline.schema.json",
  "schemas/doctor.schema.json",
  "schemas/exceptions.schema.json",
  "schemas/exceptions-report.schema.json",
  "schemas/ledger-entry.schema.json",
  "schemas/context.schema.json",
  "schemas/fixture-manifest.schema.json",
  "schemas/fixture-suite.schema.json",
  "schemas/proof-verification.schema.json",
  "schemas/proof-manifest.schema.json",
  "schemas/proof-attestation.schema.json",
  "schemas/proof-attestation-verification.schema.json",
  "docs/ATTESTATIONS.md",
  "docs/MAINTAINER_OPERATIONS.md",
  "schemas/issue-intake.schema.json",
  "schemas/history-retention.schema.json"
];
for (const relative of publicTextFiles) {
  const text = fs.readFileSync(path.join(root, relative), "utf8");
  if (text.includes("OWNER/contrib-proof") || text.includes("github.com/OWNER")) {
    problems.push(`${relative} still contains the OWNER placeholder`);
  }
}

if (problems.length) {
  console.error("Release check failed:");
  for (const problem of problems) console.error(`- ${problem}`);
  process.exit(1);
}

console.log(`Release metadata is ready for ${packageJson.name}@${packageJson.version}.`);
