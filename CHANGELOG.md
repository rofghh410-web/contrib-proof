# Changelog

All notable changes to ContribProof are documented here.

## 0.8.2 — 2026-08-12

### Fixed

- quoted every user-facing string in the GitHub Action manifest so GitHub's stricter action-manifest YAML parser loads the complete input definition consistently.

## 0.8.1 — 2026-08-12

Release: [ContribProof v0.8.1](https://github.com/rofghh410-web/contrib-proof/releases/tag/v0.8.1)

### Fixed

- quoted the GitHub Action format description so GitHub's action-manifest YAML parser can load `action.yml` correctly.

## 0.8.0 — 2026-08-12

### Added

- a shared verification engine used by the CLI and MCP server so every interface consumes the same deterministic report pipeline;
- execution-context evidence for Node.js, platform, exact Git root, commit, branch, dirty/shallow state, configuration hash, and effective options;
- `proof-verify` for offline verification of report, manifest, evidence-file, and bundle SHA-256 identities with repository-relative path confinement;
- declarative `.contrib-proof-fixtures.json` contracts with expected statuses, required check IDs/prefixes, forbidden checks, and CLI/MCP runners;
- fixture-manifest, fixture-suite, proof-verification, and execution-context schemas plus validation and regression coverage;
- `repo_proof_verify` and `repo_fixtures` read-only MCP tools, with MCP fixture execution explicitly disabled;
- GitHub Action fixture-suite mode for trusted regression jobs.

### Security

- proof verification rejects absolute, duplicate, and parent-traversing evidence paths before reading files;
- fixture contracts never turn project commands on implicitly, and MCP fixture runs force `execute: false`;
- execution context records whether a report came from a dirty or shallow checkout so incomplete evidence is visible to reviewers.

### Changed

- bumped the public package, report, MCP server, Action examples, and citation metadata to `0.8.0`;
- proof and fixture artifacts now have first-class CLI validation and documentation contracts.

## 0.7.0 — 2026-08-12

### Added

- deterministic `baseline` regression decisions with explicit budgets for newly failing checks, newly warning checks, and readiness-score drops;
- time-bounded policy exceptions with required check IDs, reasons, owners, expiry dates, and preserved original statuses;
- append-only SHA-256 maintenance ledger entries that retain aggregate report summaries and refuse to append after chain verification fails;
- read-only `doctor` diagnostics for Node.js, exact Git roots, shallow history, configuration validity, and configured executable availability;
- `repo_baseline`, `repo_ledger`, and `repo_doctor` MCP tools, plus exception-policy options for the existing read-only analysis tools;
- baseline, doctor, exceptions, exception-summary, and ledger-entry JSON Schema contracts;
- Action inputs for exception application and optional ledger recording.

### Security

- exception application is opt-in, exact-check-ID based, and never permits expired or malformed entries to suppress findings;
- ledger records omit source contents, command output, and finding messages; path traversal is rejected for ledger, exception, and baseline inputs;
- doctor performs executable availability checks without executing configured commands.

### Changed

- bumped the public package, report, MCP server, Action examples, and citation metadata to `0.7.0`;
- report, HTML, proof, validation, and documentation surfaces now expose the maintainer control-plane evidence.

## 0.6.0 — 2026-08-12

### Added

- release-readiness reports that inspect a Git commit range, semantic version metadata, changelog coverage, test and documentation signals, and unresolved high-risk review findings;
- `release` CLI command, `repo_release` read-only MCP tool, release JSON/Markdown proof artifacts, SARIF findings, and offline HTML dashboard coverage;
- privacy-preserving JSONL history records that retain summary metrics and proof identity without copying repository source contents;
- `history` CLI command for recording reports and calculating score, failure-rate, warning-rate, and trend summaries;
- published release-readiness schema and nested report validation.

### Changed

- bumped the public package, report, MCP server, and Action examples to `0.6.0`;
- GitHub Action now supports an explicit `release` mode with a separate `since` ref input.

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
