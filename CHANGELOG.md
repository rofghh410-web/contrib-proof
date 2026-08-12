# Changelog

All notable changes to ContribProof are documented here.

## 0.5.0 — 2026-08-12

### Added

- opt-in GitHub workflow annotations for failing checks, review findings, and deterministic gate violations;
- bounded annotation output with safe relative-path handling and escaping for workflow-command data;
- Action input and CLI flag documentation for the annotation integration.

### Security

- annotations are disabled by default, do not execute new commands, and never copy evidence detail fields into workflow-command messages;
- absolute and parent-traversing evidence paths are omitted from annotation locations.

### Changed

- bumped the public package, report, MCP server, and Action examples to `0.5.0`.

## 0.4.0 — 2026-08-12

### Added

- deterministic `gate` CLI command that converts configured checks and change-review signals into an auditable pass/fail decision;
- `gatePolicy` configuration with maximum risk, finding levels, warning behavior, check-failure behavior, and required-review controls;
- gate JSON/Markdown proof artifacts, report integration, HTML dashboard panel, SARIF results, and `repo_gate` MCP tool;
- GitHub Action inputs for gate mode, risk threshold, required review, and warning blocking;
- published gate schema and validation coverage for policy and nested report contracts.

### Changed

- bumped the public package, report, and Action examples to `0.4.0`;
- gate decisions remain deterministic and cannot be approved or altered by the optional model explanation layer.

## 0.3.0 — 2026-08-12

### Added

- deterministic Git change-review packets with changed-file summaries, diff size, risk factors, test candidates, and maintainer recommendations;
- added-line detection for credential-like values and merge-conflict markers with redacted evidence;
- risk signals for security-sensitive paths, workflows, dependency manifests, and unusually large changes;
- `review` CLI command and `repo_review` MCP tool;
- review JSON and Markdown files in proof bundles;
- review findings in SARIF and the offline HTML dashboard;
- review contract validation and a published review schema;
- real Git integration coverage for the review command.

### Changed

- bumped the public package and report version to `0.3.0`;
- proof manifests now include evidence paths referenced by change-review findings.

## 0.2.0 — 2026-08-12

### Added

- dependency-manifest and lockfile inventory for npm, Python, Rust, Go, Ruby, PHP, Elixir, and Dart repositories;
- optional GitHub Actions commit-SHA pinning policy with an explicit allowlist;
- deterministic remediation plans with priority, rough effort, owner, and evidence fields;
- self-contained HTML reports that work offline and do not load a CDN;
- report and plan artifact validators plus published JSON Schema documents;
- `plan` and `validate` CLI commands;
- proof-bundle outputs for HTML and remediation artifacts;
- integration coverage for the new supply-chain, HTML, planning, and validation paths.

### Changed

- bumped the package and report contract to `0.2.0`;
- generated directories and project archives are excluded from repository inventory so reports do not inspect their own outputs;
- npm packaging now includes examples, tests, schemas, and the full offline implementation.

## 0.1.0 — 2026-08-12

### Added

- zero-dependency `verify`, `diff`, `proof`, `init`, `explain`, and `mcp` commands;
- configurable required files, local Markdown-link checks, explicit validation commands, and change-evidence policies;
- repository inventory with language, manifest, package-script, workflow, and file-hash signals;
- lightweight import/symbol impact graph for common programming languages;
- Markdown, JSON, and SARIF reports;
- SHA-256 proof manifests and complete proof bundles;
- read-only MCP tools and an opt-in OpenAI Responses API explanation adapter;
- GitHub Action and contributor-facing repository templates.
